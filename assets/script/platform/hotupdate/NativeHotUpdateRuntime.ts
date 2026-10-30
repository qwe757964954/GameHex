import type { NetworkTransport } from '../../core/network/NetworkTransport';
import { appendCacheBust, compareVersion, isRolloutEligible } from '../../core/update/HotUpdateManifest';
import {
    isNativeHotUpdatePlatform,
    parseNativeHotUpdatePlan,
    prependSearchPaths,
    resolveNativeStorageDirName,
} from '../../core/update/HotUpdateNativePlan';
import type {
    IHotUpdateConfig,
    IHotUpdateNativePlan,
    HotUpdatePlatform,
    INativeHotUpdateProgress,
    INativeHotUpdateResult,
} from '../../core/update/HotUpdateTypes';
import type { INativeAssetsManager, INativeAssetsManagerEvent, INativeHotUpdateHost } from './NativeHotUpdateHost';

export interface INativeHotUpdateDependencies {
    readonly network: NetworkTransport;
    readonly host: INativeHotUpdateHost;
    /** 已探测到的运行平台；由组合根注入，便于测试覆盖各分支。 */
    readonly platform: HotUpdatePlatform;
    /** 客户端稳定标识来源（灰度分桶用）。 */
    readonly clientId: () => string;
    /** 可选验签：返回 false 时拒绝该 release。 */
    readonly verifySignature?: (plan: IHotUpdateNativePlan) => Promise<boolean>;
    readonly now?: () => number;
}

/**
 * 原生（Android / iOS）全构建目录热更新编排器。
 *
 * 分工：**文件的逐个 md5 比对、下载、断点续传、失败重试全部交给引擎的
 * native.AssetsManager**；本类只负责控制面——拉取 latest.json、灰度与最低版本门槛、
 * 签名策略、把随包 project.manifest 交给引擎、把热更缓存目录前置进搜索路径，
 * 最后重启游戏让新脚本生效。
 *
 * 为什么必须重启：更新下来的 `src/chunks/*.js` 覆盖的是已经被 SystemJS 执行过的模块，
 * 不重启的话新类会和旧实例混在一起，场景与 Bundle 配置也不会重新读取。
 */
export class NativeHotUpdateRuntime {
    private readonly now: () => number;
    private manager: INativeAssetsManager | null = null;
    private storagePath = '';
    private plan: IHotUpdateNativePlan | null = null;
    private retryEnabled = false;

    constructor(private readonly dependencies: INativeHotUpdateDependencies) {
        this.now = dependencies.now ?? (() => Date.now());
    }

    /** 上次更新失败后是否还能用 downloadFailedAssets 续传。 */
    get canRetryFailedAssets(): boolean {
        return this.retryEnabled && !!this.manager;
    }

    get currentReleaseId(): string | undefined {
        return this.plan?.releaseId;
    }

    async run(
        config: IHotUpdateConfig,
        onProgress?: (progress: INativeHotUpdateProgress) => void,
    ): Promise<INativeHotUpdateResult> {
        const emit = (progress: INativeHotUpdateProgress) => onProgress?.(progress);
        const platform = this.dependencies.platform;
        if (!config.enabled) {
            emit({ phase: 'done', message: '资源热更新未启用，使用随包资源' });
            return disabled('资源热更新未启用');
        }
        if (!isNativeHotUpdatePlatform(platform) || !config.enabledPlatforms.includes(platform)) {
            emit({ phase: 'done', message: '当前平台未开启资源热更新' });
            return disabled('当前平台未开启资源热更新');
        }
        if (!this.dependencies.host.supported) {
            emit({ phase: 'done', message: '资源热更新未启用，使用随包资源' });
            return disabled('当前运行环境不支持原生热更新（仅 Android / iOS 原生包）');
        }

        const host = this.dependencies.host;
        this.retryEnabled = false;
        this.manager = null;
        this.storagePath = host.resolveStoragePath(resolveNativeStorageDirName(config));
        this.resetCacheOnClientVersionChange(config);

        emit({ phase: 'checking', message: '正在检查资源版本' });
        const outcome = await this.loadPlan(config, emit);
        if (outcome.kind === 'stop') return outcome.result;
        this.plan = outcome.plan;

        if (this.plan) {
            if (!isRolloutEligible(this.dependencies.clientId(), this.plan)) {
                emit({ phase: 'done', message: '当前设备未进入本次灰度' });
                return {
                    status: 'deferred',
                    canContinue: true,
                    message: '当前设备未进入本次灰度，继续使用当前资源',
                    releaseId: this.plan.releaseId,
                };
            }
        }

        emit({ phase: 'validating', message: '正在校验本地资源版本' });
        const prepared = this.prepareManager(config);
        if (prepared) return prepared;

        try {
            const check = await this.checkForNewVersion(emit);
            if (check === 'updated') {
                return this.finishUpdate(config, emit);
            }
            if (check === 'up-to-date') {
                emit({ phase: 'done', message: '资源已经是最新版本' });
                return {
                    status: 'up-to-date',
                    canContinue: true,
                    message: '资源已经是最新版本',
                    releaseId: this.plan?.releaseId,
                };
            }
            emit({ phase: 'downloading', message: '正在下载资源更新' });
            await this.runUpdatePhase(onProgress, () => this.manager?.update());
        } catch (error) {
            this.retryEnabled = true;
            host.warn('资源更新失败', error);
            emit({ phase: 'failed', message: '资源更新失败，可点击重试' });
            return {
                status: 'failed',
                canContinue: true,
                message: '资源更新失败，已保留已下载分片，点击重试',
                releaseId: this.plan?.releaseId,
                error,
            };
        }
        return this.finishUpdate(config, emit);
    }

    /**
     * 重试上次失败的资源（等价官方 `downloadFailedAssets()`）。
     * 只重下失败项，已完成的文件与临时 manifest 都不会重来。
     */
    async retryFailedAssets(
        config: IHotUpdateConfig,
        onProgress?: (progress: INativeHotUpdateProgress) => void,
    ): Promise<INativeHotUpdateResult> {
        const emit = (progress: INativeHotUpdateProgress) => onProgress?.(progress);
        if (!this.canRetryFailedAssets) {
            return { status: 'failed', canContinue: true, message: '当前没有可续传的资源' };
        }
        this.retryEnabled = false;
        emit({ phase: 'downloading', message: '正在续传失败的资源' });
        try {
            await this.runUpdatePhase(onProgress, () => this.manager?.downloadFailedAssets());
        } catch (error) {
            this.retryEnabled = true;
            this.dependencies.host.warn('续传仍然失败', error);
            emit({ phase: 'failed', message: '资源续传失败，可再次重试' });
            return {
                status: 'failed',
                canContinue: true,
                message: '资源续传失败，已保留已下载分片，点击重试',
                releaseId: this.plan?.releaseId,
                error,
            };
        }
        return this.finishUpdate(config, emit);
    }

    /** 更新成功后：前置搜索路径 + 持久化 + 重启。 */
    private finishUpdate(config: IHotUpdateConfig, emit: (progress: INativeHotUpdateProgress) => void): INativeHotUpdateResult {
        const host = this.dependencies.host;
        emit({ phase: 'applying', message: '正在应用资源更新' });
        const manager = this.manager;
        const manifest = manager ? manager.getLocalManifest() : null;
        const declared = manifest && typeof manifest.getSearchPaths === 'function' ? manifest.getSearchPaths() : [];
        // 官方语义：getSearchPaths() 里带的是更新后的搜索路径（至少含缓存目录）。
        // 万一引擎版本不同导致它为空，就直接用缓存目录兜底——否则新脚本不会被加载。
        const hotPaths = declared && declared.length ? declared : [this.storagePath];
        const merged = prependSearchPaths(host.readSearchPaths(), hotPaths);
        host.applySearchPaths(merged);
        host.persistSearchPaths(merged);
        host.info(`热更缓存已前置到搜索路径：${this.storagePath}`);
        emit({ phase: 'done', message: '资源更新完成，正在重启游戏' });
        host.restartGame(config.nativeRestartDelayMs ?? 1200);
        return {
            status: 'restart-required',
            canContinue: false,
            message: '资源更新完成，游戏即将重启以生效',
            releaseId: this.plan?.releaseId,
        };
    }

    /**
     * 拉取并校验 latest.json。
     *
     * `stop` = 流程到此结束（门槛不过 / 校验不通过 / 首装强制远端但拿不到控制文件）；
     * `plan: null` = 控制文件不可用但有随包清单可自举，继续走官方原生流程。
     */
    private async loadPlan(
        config: IHotUpdateConfig,
        emit: (progress: INativeHotUpdateProgress) => void,
    ): Promise<PlanOutcome> {
        const platform = this.dependencies.platform;
        let plan: IHotUpdateNativePlan;
        try {
            const raw = await this.dependencies.network.requestJson<unknown>({
                url: appendCacheBust(this.expandLatestUrl(config.latestUrlTemplate, platform, config.channel), this.now()),
                method: 'GET',
                timeoutMs: config.requestTimeoutMs,
            });
            plan = parseNativeHotUpdatePlan(raw, platform, config.channel, config.allowHttpForLocalDebug);
        } catch (error) {
            // 控制文件拿不到不等于不能更新：随包 project.manifest 里带着渠道地址，
            // 官方流程本身就能自举。但首装强制远端时仍要阻断。
            this.dependencies.host.warn('latest.json 不可用，退回随包清单自举', error);
            if (config.requireRemoteOnFirstInstall && !this.dependencies.host.resolveLocalManifestPath(config.localManifestPath)) {
                return {
                    kind: 'stop',
                    result: {
                        status: 'failed',
                        canContinue: false,
                        message: '首次资源准备失败，请检查网络后重试',
                        error,
                    },
                };
            }
            emit({ phase: 'validating', message: '未取到版本控制文件，按随包清单校验' });
            return { kind: 'plan', plan: null };
        }

        if (config.clientVersion && plan.minClientVersion) {
            if (this.compareClientVersion(config.clientVersion, plan.minClientVersion) < 0) {
                emit({ phase: 'failed', message: `客户端版本过低，需要升级到 ${plan.minClientVersion} 或以上` });
                return {
                    kind: 'stop',
                    result: {
                        status: 'mandatory-client-update',
                        canContinue: false,
                        message: `客户端版本过低，需要升级到 ${plan.minClientVersion} 或以上`,
                        releaseId: plan.releaseId,
                    },
                };
            }
        }
        if (!plan.signature && !config.allowUnsignedManifests) {
            return {
                kind: 'stop',
                result: {
                    status: 'integrity-error',
                    canContinue: false,
                    message: '正式环境 latest.json 缺少签名，已拒绝本次更新',
                },
            };
        }
        const verifier = this.dependencies.verifySignature;
        if (verifier && !(await verifier(plan))) {
            return {
                kind: 'stop',
                result: {
                    status: 'integrity-error',
                    canContinue: false,
                    message: '版本控制文件签名校验失败，已拒绝本次更新',
                    releaseId: plan.releaseId,
                },
            };
        }
        return { kind: 'plan', plan };
    }

    /** 准备 AssetsManager：随包清单 + 版本比较函数 + 校验回调。 */
    private prepareManager(config: IHotUpdateConfig): INativeHotUpdateResult | null {
        const host = this.dependencies.host;
        const localManifestPath = host.resolveLocalManifestPath(config.localManifestPath);
        if (!localManifestPath) {
            return {
                status: 'failed',
                canContinue: !config.requireRemoteOnFirstInstall,
                message: '找不到随包 project.manifest，无法进行原生热更（请确认构建扩展已在构建时执行）',
            };
        }
        if (this.plan) this.assertPlanMatchesLocalManifest(localManifestPath, this.plan);

        // 🔴 **绝不能把 JS 比较器交给引擎。**
        // 引擎 `Manifest::versionGreaterOrEquals` 原文：
        //     if (handle) { greater = handle(localVersion, bVersion) >= 0; }
        // 这个 `handle` 是我们在 `new AssetsManager(..., handle)` 时传进去的 **JS 函数**，
        // 而调用它的是 `parseVersion()` —— 位于 `onFileTaskSuccess` 回调链上，即
        // **原生下载线程**。JS 引擎不在那个线程上 ⇒ 跨线程调用 JS ⇒ 同步 SIGSEGV
        // （真机实测：`si_code=1 SEGV_MAPERR`、`fault addr 0xd5e4` 固定偏移、Thread-2）。
        //
        // 崩溃发生在 `checkUpdate()` **同步返回之后约 0.4 秒**（网络往返），
        // 现场没有任何 JS 栈可读。
        //
        // 引擎自带的默认比较（`cmpVersion`）是 `sscanf("%d.%d.%d.%d")` 逐段比较，
        // 解析不了就 `strcmp`。我们的 releaseId 是 `YYYYMMDD-HHMMSS-<平台>`，
        // 走 `strcmp` 的字典序恰好等价于时间戳顺序 ⇒ 够用。
        // 真正的 release-stamp 全序比较放在 JS 侧（`loadPlan` 里的 compareReleaseVersion），
        // 那是在主线程上调的，不存在跨线程问题。
        const manager = host.createAssetsManager(this.storagePath);
        if (!manager) {
            return {
                status: 'failed',
                canContinue: !config.requireRemoteOnFirstInstall,
                message: '无法创建原生热更新管理器（AssetsManager 不可用）',
            };
        }
        // ⚠️ **故意不注册 `setVerifyCallback`。**
        // 它和 `VersionCompareHandle` 是同一类陷阱：引擎在 `onSuccess()` 里调它，
        // 而 `onSuccess` 位于 `onFileTaskSuccess` 链上 = **原生下载线程** ⇒ 跨线程调 JS。
        // 引擎对 `_verifyCallback` 的默认值就是「放行」，且本工程没有 md5 桥
        // （`__CITY1001_HOT_UPDATE_MD5__` 未实现，见 verifyDownloadedAsset 的说明），
        // 注册一个恒返回 true 的 JS 回调**没有任何收益，只有跨线程风险**。
        // 等真的要接 md5 桥时，必须改成原生侧校验，或先验证该回调所在线程。
        const concurrency = config.nativeMaxConcurrentTask;
        if (typeof concurrency === 'number' && concurrency > 0 && manager.setMaxConcurrentTask) {
            manager.setMaxConcurrentTask(concurrency);
        }
        // 🔴 **必须只传 manifestUrl 一个参数。**
        // 引擎（3.8 `native.AssetsManager`）有两个重载：
        //   1. `loadLocalManifest(manifestUrl: string)`
        //   2. `loadLocalManifest(localManifest: Manifest, storagePath: string)`
        // 重载 2 的第一个参数是 **Manifest 对象**，传路径字符串进去会被当 `Manifest*`
        // 解引用 ⇒ **同步 SIGSEGV（fault addr 0x0、无 JS 栈、Thread-2）**。
        // 存储路径不必再传：它已在 `new AssetsManager('', storagePath)` 里给过，
        // 引擎 `loadLocalManifest` 的第 1 步就是「Reset storage path」到该值。
        if (!manager.loadLocalManifest(localManifestPath)) {
            return {
                status: 'failed',
                canContinue: !config.requireRemoteOnFirstInstall,
                message: `载入随包清单失败：${localManifestPath}`,
            };
        }
        this.manager = manager;
        host.info(`随包清单：${localManifestPath}；缓存目录：${this.storagePath}`);
        // 这行是**崩溃取证哨兵**：真机一旦在这里之前 SIGSEGV，说明崩在 prepareManager
        // 内部（loadLocalManifest / createAssetsManager）；打出来则范围已推进到 checkUpdate 之后。
        host.info(`热更管理器就绪：versionCompare=${config.nativeVersionCompare ?? 'release-stamp'}；`
            + `远端=${this.plan ? this.plan.remoteManifestUrl : '(随包清单)'}`);
        return null;
    }

    /**
     * 控制文件与随包清单指向不同远端时只告警不阻断。
     *
     * 客户端实际用的是**随包清单里的 remoteManifestUrl**（引擎会优先取缓存目录里更新过的清单），
     * 因为只有这样才能复用已下载文件、避免每次启动全量重下。这里做一次交叉核对，
     * 用来暴露"渠道清单没跟着 release 走"这类发布事故。
     */
    private assertPlanMatchesLocalManifest(localManifestPath: string, plan: IHotUpdateNativePlan): void {
        const host = this.dependencies.host;
        const text = host.readTextFile(localManifestPath);
        if (!text) return;
        try {
            const parsed = JSON.parse(text) as { remoteManifestUrl?: string };
            if (parsed.remoteManifestUrl && parsed.remoteManifestUrl !== plan.remoteManifestUrl) {
                host.warn(
                    `渠道清单与控制文件不一致：随包清单指向 ${parsed.remoteManifestUrl}，latest.json 指向 ${plan.remoteManifestUrl}`,
                );
            }
        } catch (error) {
            host.warn(`随包清单不是合法 JSON：${localManifestPath}`, error);
        }
    }

    /** checkUpdate 的异步结果靠事件回调拿，这里包成 Promise。 */
    private checkForNewVersion(emit: (progress: INativeHotUpdateProgress) => void): Promise<'new' | 'up-to-date' | 'updated'> {
        const manager = this.manager;
        if (!manager) return Promise.reject(new Error('热更新管理器未初始化'));
        const environment = this.dependencies.host.environment;
        const host = this.dependencies.host;
        return new Promise<'new' | 'up-to-date' | 'updated'>((resolve, reject) => {
            // 首次安装没有资源差异时，原生准备阶段会直接完成；检查任务也必须处理这个终态。
            manager.setEventCallback((event: INativeAssetsManagerEvent) => {
                const code = event.getEventCode();
                if (code === environment.UPDATE_PROGRESSION) {
                    // 检查阶段也要下载 620KB 完整清单（5073 条 assets），首次安装实测约 27 秒。
                    // 这段时间过去完全没有反馈，看起来就是卡死 —— 这里把字节数写进文案。
                    // 注意进度条走不通：原生层的 percent/bytes 不会传到 IHotUpdateProgress
                    // （那边只认 completed/total），所以只能体现在文字上。
                    const downloaded = event.getDownloadedBytes?.() ?? 0;
                    const total = event.getTotalBytes?.() ?? 0;
                    if (total > 0) {
                        emit({
                            phase: 'validating',
                            message: `正在获取更新信息 ${formatKb(downloaded)} / ${formatKb(total)}`,
                        });
                    }
                    return;
                }
                if (code === environment.NEW_VERSION_FOUND) {
                    resolve('new');
                    return;
                }
                if (code === environment.UPDATE_FINISHED) {
                    // 原生空差异修复会在检查阶段直接完成更新，仍需保存搜索路径并重启。
                    // 不再调用 update()：此时引擎已经处于 UP_TO_DATE。
                    host.info('检查阶段已完成更新，准备保存搜索路径并重启');
                    resolve('updated');
                    return;
                }
                if (code === environment.ALREADY_UP_TO_DATE) {
                    resolve('up-to-date');
                    return;
                }
                if (code === environment.ERROR_NO_LOCAL_MANIFEST
                    || code === environment.ERROR_DOWNLOAD_MANIFEST
                    || code === environment.ERROR_PARSE_MANIFEST) {
                    reject(new Error(describeEvent(event, '检查更新失败')));
                }
            });
            // 哨兵 A：打出来 = 已进入 checkUpdate 的同步段（它会走 downloadVersion 启动后台下载）
            host.info('checkUpdate 调用前');
            try {
                manager.checkUpdate();
                // 哨兵 B：打出来 = checkUpdate 同步段安全返回，崩溃在其后的**下载线程回调**里
                host.info('checkUpdate 同步返回');
            } catch (error) {
                host.info('checkUpdate 同步抛错');
                reject(error);
            }
        });
    }

    /**
     * 驱动 update / downloadFailedAssets。
     * 监听器在成功后解除；失败时保留，好让 downloadFailedAssets 继续回同一处。
     */
    private runUpdatePhase(
        onProgress: ((progress: INativeHotUpdateProgress) => void) | undefined,
        trigger: () => void,
    ): Promise<void> {
        const manager = this.manager;
        if (!manager) return Promise.reject(new Error('热更新管理器未初始化'));
        const environment = this.dependencies.host.environment;
        return new Promise<void>((resolve, reject) => {
            manager.setEventCallback((event: INativeAssetsManagerEvent) => {
                const code = event.getEventCode();
                if (code === environment.UPDATE_PROGRESSION) {
                    // ⚠️ 这些事件方法用 `?.` 取，不要用 `!` 断言：引擎不同版本的
                    // `EventAssetsManager` 暴露的方法可能不全，断言等于在**原生回调线程**
                    // 上直接抛 TypeError，而那条链没有 JS 栈可读，只会看到 SIGSEGV。
                    const message = event.getMessage?.();
                    onProgress?.({
                        phase: 'downloading',
                        message: message ? `正在更新：${message}` : '正在下载资源更新',
                        percent: event.getPercent?.(),
                        percentByFile: event.getPercentByFile?.(),
                        downloadedBytes: event.getDownloadedBytes?.(),
                        totalBytes: event.getTotalBytes?.(),
                        downloadedFiles: event.getDownloadedFiles?.(),
                        totalFiles: event.getTotalFiles?.(),
                    });
                    return;
                }
                if (code === environment.UPDATE_FINISHED) {
                    manager.setEventCallback(null);
                    resolve();
                    return;
                }
                const isFailure = code === environment.UPDATE_FAILED
                    || code === environment.ERROR_UPDATING
                    || code === environment.ERROR_DECOMPRESS
                    || code === environment.ERROR_NO_LOCAL_MANIFEST
                    || code === environment.ERROR_DOWNLOAD_MANIFEST
                    || code === environment.ERROR_PARSE_MANIFEST
                    || code === environment.ALREADY_UP_TO_DATE;
                if (isFailure) reject(new Error(describeEvent(event, '更新资源失败')));
            });
            try {
                trigger();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 下载后校验回调。
     *
     * 引擎不提供纯 JS 的 md5，正式包应把原生/JS 实现的 md5 桥挂到
     * `globalThis.__CITY1001_HOT_UPDATE_MD5__`；没有桥时只能放行并记日志
     * （与官方范例一致：md5 是否校验由业务决定，但**校验不了不能假装校验过了**）。
     */
    private verifyDownloadedAsset(path: string, asset: unknown): boolean {
        const compressed = !!(asset && typeof asset === 'object' && (asset as { compressed?: boolean }).compressed);
        if (compressed) return true;
        const bridge = (globalThis as unknown as { __CITY1001_HOT_UPDATE_MD5__?: (file: string) => string }).__CITY1001_HOT_UPDATE_MD5__;
        if (!bridge) return true;
        const expected = (asset as { md5?: string } | null)?.md5;
        if (!expected) return true;
        try {
            const actual = bridge(path);
            if (actual && actual !== expected) {
                this.dependencies.host.warn(`资源 md5 校验失败：${path}（期望 ${expected}，实际 ${actual}）`);
                return false;
            }
        } catch (error) {
            this.dependencies.host.warn(`资源 md5 校验异常：${path}`, error);
        }
        return true;
    }

    /**
     * 大版本升级后清理旧缓存。
     *
     * 引擎/大版本更替时 `src/cocos-js/cc.js` 与 C++ 底层可能不匹配，官方建议整包更新；
     * 万一没有整包，至少别让旧缓存盖住新包。
     */
    private resetCacheOnClientVersionChange(config: IHotUpdateConfig): void {
        const host = this.dependencies.host;
        const previous = host.readPersistedClientVersion();
        if (previous && previous !== config.clientVersion) {
            host.removeDirectory(this.storagePath);
            // 只清"待恢复的搜索路径"标记，不动已生效的搜索路径——main.js 下次会重新读。
            host.clearPersistedSearchPaths();
            host.info(`客户端版本 ${previous} → ${config.clientVersion}，已清理热更缓存`);
        }
        host.writePersistedClientVersion(config.clientVersion);
    }

    private compareClientVersion(clientVersion: string, minClientVersion: string): number {
        return compareVersion(clientVersion, minClientVersion);
    }

    private expandLatestUrl(template: string, platform: HotUpdatePlatform, channel: string): string {
        const value = template
            .replace(/\{platform\}/g, encodeURIComponent(platform))
            .replace(/\{channel\}/g, encodeURIComponent(channel));
        if (!/^https?:\/\//i.test(value)) throw new Error('热更新 latestUrlTemplate 配置无效');
        return value;
    }
}

function disabled(message: string): INativeHotUpdateResult {
    return { status: 'disabled', canContinue: true, message };
}

type PlanOutcome =
    | { readonly kind: 'plan'; readonly plan: IHotUpdateNativePlan | null }
    | { readonly kind: 'stop'; readonly result: INativeHotUpdateResult };

function describeEvent(event: INativeAssetsManagerEvent, fallback: string): string {
    const message = event.getMessage?.();
    const assetId = event.getAssetId?.();
    if (assetId) return `${fallback}：${assetId}${message ? ` (${message})` : ''}`;
    return message ? `${fallback}：${message}` : fallback;
}

/** 检查阶段的 manifest 下载进度文案用；小于 1KB 也显示成 0KB，不出现小数。 */
function formatKb(bytes: number): string {
    return `${Math.round(bytes / 1024)}KB`;
}
