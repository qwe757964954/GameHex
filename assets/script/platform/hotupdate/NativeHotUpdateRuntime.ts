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
 * 原生全构建目录热更编排器。文件 md5 比对、下载、断点续传交给引擎 AssetsManager，
 * 本类只管控制面：latest.json、灰度与版本门槛、验签、搜索路径前置和重启。
 * 必须重启：新下载的 js 覆盖的是已执行过的模块，不重启会新旧实例混用。
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
        // 引擎版本差异导致路径为空时用缓存目录兜底，否则新脚本不会被加载。
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
     * 拉取并校验 latest.json。stop = 门槛不过或校验失败，流程结束；
     * plan: null = 控制文件不可用，靠随包清单自举继续。
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

    /** 准备 AssetsManager：载入随包清单、设置并发，不注册 JS 回调。 */
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

        // 不能把 JS 比较器交给引擎：它在原生下载线程上被同步调用，跨线程调 JS 会 SIGSEGV。
        // releaseId 是时间戳格式，引擎默认 cmpVersion 走 strcmp 的字典序即时间顺序，够用；
        // 全序比较放在主线程的 compareReleaseVersion。
        const manager = host.createAssetsManager(this.storagePath);
        if (!manager) {
            return {
                status: 'failed',
                canContinue: !config.requireRemoteOnFirstInstall,
                message: '无法创建原生热更新管理器（AssetsManager 不可用）',
            };
        }
        // 故意不注册校验回调：同样在下载线程上调用，且引擎默认放行，本工程又没有
        // md5 桥，注册恒 true 的 JS 回调零收益。接 md5 桥时必须走原生侧校验。
        const concurrency = config.nativeMaxConcurrentTask;
        if (typeof concurrency === 'number' && concurrency > 0 && manager.setMaxConcurrentTask) {
            manager.setMaxConcurrentTask(concurrency);
        }
        // 只传 manifestUrl 一个参数：另一个重载首参是 Manifest 对象，传字符串会
        // 被当 Manifest* 解引用，同步 SIGSEGV。存储路径已在构造器里给过。
        if (!manager.loadLocalManifest(localManifestPath)) {
            return {
                status: 'failed',
                canContinue: !config.requireRemoteOnFirstInstall,
                message: `载入随包清单失败：${localManifestPath}`,
            };
        }
        this.manager = manager;
        host.info(`随包清单：${localManifestPath}；缓存目录：${this.storagePath}`);
        // 取证哨兵：这行打出来说明 prepareManager 已走完，崩溃点在 checkUpdate 之后。
        host.info(`热更管理器就绪：versionCompare=${config.nativeVersionCompare ?? 'release-stamp'}；`
            + `远端=${this.plan ? this.plan.remoteManifestUrl : '(随包清单)'}`);
        return null;
    }

    /**
     * 交叉核对随包清单与 latest.json 的远端地址，不一致只告警。
     * 实际生效的是随包清单（才能复用已下载文件），核对用来暴露串渠道的发布事故。
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
                    // 检查阶段要下完整清单，首装耗时较长，把字节数写进文案避免像卡死；
                    // 原生 percent 不进应用进度契约，只能体现在文字上。
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
                    // 空差异修复在检查阶段直接完成，引擎已处于 UP_TO_DATE，不再调 update。
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
            // 取证哨兵：两条日志框定 checkUpdate 的同步段，崩溃点在其后的下载线程回调。
            host.info('checkUpdate 调用前');
            try {
                manager.checkUpdate();
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
                    // 事件方法保持可选链：不同版本暴露的方法可能不全，断言会在无栈的
                    // 原生回调线程上抛 TypeError。
                    const message = event.getMessage?.();
                    // 引擎返回 0~1，应用层进度契约用 0~100。
                    const ratio = event.getPercent?.();
                    const fileRatio = event.getPercentByFile?.();
                    onProgress?.({
                        phase: 'downloading',
                        message: message ? `正在更新：${message}` : '正在下载资源更新',
                        percent: ratio === undefined ? undefined : ratio * 100,
                        percentByFile: fileRatio === undefined ? undefined : fileRatio * 100,
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
     * md5 桥挂在 globalThis.__CITY1001_HOT_UPDATE_MD5__；没有桥时放行，
     * 校验不了不能假装校验过了。
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

    /** 大版本更替时底层可能不匹配，清掉旧缓存，别让它盖住新包。 */
    private resetCacheOnClientVersionChange(config: IHotUpdateConfig): void {
        const host = this.dependencies.host;
        const previous = host.readPersistedClientVersion();
        if (previous && previous !== config.clientVersion) {
            host.removeDirectory(this.storagePath);
            // 只清待恢复的搜索路径标记，已生效的路径留给 main.js 下次重读。
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
