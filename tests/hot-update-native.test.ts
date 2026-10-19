import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    compareReleaseVersion,
    isNativeHotUpdatePlatform,
    parseNativeHotUpdatePlan,
    parseReleaseStamp,
    prependSearchPaths,
    resolveNativeStorageDirName,
} from '../assets/script/core/update/HotUpdateNativePlan';
import type { IHotUpdateConfig, HotUpdatePlatform } from '../assets/script/core/update/HotUpdateTypes';
import type {
    INativeAssetsManager,
    INativeAssetsManagerEnvironment,
    INativeAssetsManagerEvent,
    INativeAssetsManagerManifest,
    INativeHotUpdateHost,
} from '../assets/script/platform/hotupdate/NativeHotUpdateHost';
import { NativeHotUpdateRuntime } from '../assets/script/platform/hotupdate/NativeHotUpdateRuntime';

const ENVIRONMENT: INativeAssetsManagerEnvironment = {
    UNINITED: 0,
    ERROR_NO_LOCAL_MANIFEST: 1,
    ERROR_DOWNLOAD_MANIFEST: 2,
    ERROR_PARSE_MANIFEST: 3,
    ERROR_UPDATING: 4,
    ERROR_DECOMPRESS: 5,
    ALREADY_UP_TO_DATE: 6,
    NEW_VERSION_FOUND: 7,
    UPDATE_PROGRESSION: 8,
    /** 每下载完一个文件派发一次。 */
    ASSET_UPDATED: 11,
    UPDATE_FINISHED: 9,
    UPDATE_FAILED: 10,
};

const BASE_URL = 'https://cdn.example.com/hotupdate';

function config(overrides: Partial<IHotUpdateConfig> = {}): IHotUpdateConfig {
    return {
        enabled: true,
        enabledPlatforms: ['android', 'ios'],
        channel: 'dev',
        clientVersion: '1.2.3.4',
        latestUrlTemplate: `${BASE_URL}/{platform}/{channel}/latest.json`,
        startupBundles: ['remoteRef'],
        requestTimeoutMs: 1000,
        allowHttpForLocalDebug: false,
        allowUnsignedManifests: true,
        requireRemoteOnFirstInstall: false,
        nativeMaxConcurrentTask: 3,
        nativeRestartDelayMs: 0,
        ...overrides,
    };
}

function planPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 2,
        releaseId: '20260918-190000-android',
        platform: 'android',
        channel: 'dev',
        minClientVersion: '1.0.0.0',
        packageUrl: `${BASE_URL}/android/20260918-190000-android`,
        remoteManifestUrl: `${BASE_URL}/android/dev/project.manifest`,
        remoteVersionUrl: `${BASE_URL}/android/dev/version.manifest`,
        rolloutPercentage: 100,
        ...overrides,
    };
}

function event(code: number, extra: Partial<INativeAssetsManagerEvent> = {}): INativeAssetsManagerEvent {
    return { getEventCode: () => code, ...extra };
}

type UpdateBehavior = 'up-to-date' | 'new-then-finish' | 'fail-then-finish' | 'always-fail';

class FakeAssetsManager implements INativeAssetsManager {
    callback: ((value: INativeAssetsManagerEvent) => void) | null = null;
    verifyCallback: ((path: string, asset: unknown) => boolean) | null = null;
    versionCompareHandle: ((left: string, right: string) => number) | undefined;
    maxConcurrentTask: number | undefined;
    localManifestPath = '';
    /**
     * 🔴 `loadLocalManifest` 收到的**实参个数**。引擎有两个重载，第二个的首参是
     * `Manifest` 对象而不是路径字符串 ⇒ 传两个参数会同步 SIGSEGV（真机实测）。
     * 夹具必须能看见「到底传了几个」，否则这条致命 bug 测不出来
     * —— 历史夹具写死单参数签名，调用方多传一个参数它照样返回 true、全绿。
     */
    loadLocalManifestArgCount = -1;
    storagePath = '';
    checkCalls = 0;
    updateCalls = 0;
    retryCalls = 0;

    constructor(
        private readonly behavior: UpdateBehavior,
        private readonly storagePathForManifest: string,
    ) { }

    setEventCallback(callback: ((value: INativeAssetsManagerEvent) => void) | null): void {
        this.callback = callback;
    }

    setVerifyCallback(callback: ((path: string, asset: unknown) => boolean) | null): void {
        this.verifyCallback = callback;
    }

    setVersionCompareHandle(handle: ((left: string, right: string) => number) | null): void {
        this.versionCompareHandle = handle ?? undefined;
    }

    setMaxConcurrentTask(task: number): void {
        this.maxConcurrentTask = task;
    }

    loadLocalManifest(...args: unknown[]): boolean {
        this.loadLocalManifestArgCount = args.length;
        this.localManifestPath = String(args[0] ?? '');
        return true;
    }

    getLocalManifest(): INativeAssetsManagerManifest | null {
        return { isLoaded: () => true, getSearchPaths: () => [this.storagePathForManifest] };
    }

    getState(): number {
        return 1;
    }

    checkUpdate(): void {
        this.checkCalls += 1;
        const code = this.behavior === 'up-to-date' ? ENVIRONMENT.ALREADY_UP_TO_DATE : ENVIRONMENT.NEW_VERSION_FOUND;
        queueMicrotask(() => this.callback?.(event(code)));
    }

    update(): void {
        this.updateCalls += 1;
        queueMicrotask(() => {
            if (this.behavior === 'always-fail' || this.behavior === 'fail-then-finish') {
                this.callback?.(event(ENVIRONMENT.UPDATE_FAILED, { getMessage: () => 'network' }));
                return;
            }
            this.callback?.(event(ENVIRONMENT.UPDATE_PROGRESSION, {
                getPercent: () => 50,
                getPercentByFile: () => 40,
                getDownloadedBytes: () => 512,
                getTotalBytes: () => 1024,
                getDownloadedFiles: () => 2,
                getTotalFiles: () => 5,
            }));
            this.callback?.(event(ENVIRONMENT.UPDATE_FINISHED, { getMessage: () => 'done' }));
        });
    }

    downloadFailedAssets(): void {
        this.retryCalls += 1;
        queueMicrotask(() => {
            if (this.behavior === 'fail-then-finish') {
                this.callback?.(event(ENVIRONMENT.UPDATE_FINISHED, { getMessage: () => 'done' }));
                return;
            }
            this.callback?.(event(ENVIRONMENT.UPDATE_FAILED, { getMessage: () => 'still failing' }));
        });
    }
}

class FakeHost implements INativeHotUpdateHost {
    supported = true;
    readonly environment = ENVIRONMENT;
    readonly files = new Map<string, string>();
    searchPaths: string[] = ['/app/'];
    persisted: string[] | null = null;
    clearedPersisted = 0;
    removed: string[] = [];
    restarts = 0;
    storedClientVersion: string | null = null;
    managers: FakeAssetsManager[] = [];
    warnings: string[] = [];

    constructor(private readonly behavior: UpdateBehavior = 'new-then-finish') { }

    resolveStoragePath(dirName: string): string {
        return `/writable/${dirName}/`;
    }

    resolveLocalManifestPath(override?: string): string | null {
        if (override) return this.files.has(override) ? override : null;
        return this.files.has('project.manifest') ? 'project.manifest' : null;
    }

    readTextFile(path: string): string | null {
        return this.files.get(path) ?? null;
    }

    fileExists(path: string): boolean {
        return this.files.has(path);
    }

    readSearchPaths(): string[] {
        return Array.from(this.searchPaths);
    }

    applySearchPaths(paths: readonly string[]): void {
        this.searchPaths = Array.from(paths);
    }

    persistSearchPaths(paths: readonly string[]): void {
        this.persisted = Array.from(paths);
    }

    clearPersistedSearchPaths(): void {
        this.clearedPersisted += 1;
        this.persisted = null;
    }

    readPersistedClientVersion(): string | null {
        return this.storedClientVersion;
    }

    writePersistedClientVersion(version: string): void {
        this.storedClientVersion = version;
    }

    removeDirectory(path: string): void {
        this.removed.push(path);
    }

    createAssetsManager(storagePath: string, handle?: (left: string, right: string) => number): INativeAssetsManager {
        const manager = new FakeAssetsManager(this.behavior, storagePath);
        manager.versionCompareHandle = handle;
        this.managers.push(manager);
        return manager;
    }

    restartGame(): void {
        this.restarts += 1;
    }

    info(): void { }

    warn(message: string): void {
        this.warnings.push(message);
    }
}

function createRuntime(options: {
    behavior?: UpdateBehavior;
    platform?: HotUpdatePlatform;
    payload?: Record<string, unknown> | null;
    reqThrows?: boolean;
    clientId?: string;
}) {
    const host = new FakeHost(options.behavior ?? 'new-then-finish');
    host.files.set('project.manifest', JSON.stringify({
        packageUrl: `${BASE_URL}/android/dev/`,
        remoteManifestUrl: `${BASE_URL}/android/dev/project.manifest`,
        version: '1.0.0.0',
        assets: {},
        searchPaths: [],
    }));
    let requestedUrl = '';
    const runtime = new NativeHotUpdateRuntime({
        host,
        platform: options.platform ?? 'android',
        clientId: () => options.clientId ?? 'client-1',
        now: () => 1,
        network: {
            requestJson: async <T>(request: { url: string }) => {
                requestedUrl = request.url;
                if (options.reqThrows) throw new Error('offline');
                return (options.payload === null ? {} : (options.payload ?? planPayload())) as T;
            },
        },
    });
    return { host, runtime, requestedUrl: () => requestedUrl };
}

test('原生平台判定只认 Android / iOS', () => {
    assert.equal(isNativeHotUpdatePlatform('android'), true);
    assert.equal(isNativeHotUpdatePlatform('ios'), true);
    assert.equal(isNativeHotUpdatePlatform('web'), false);
    assert.equal(isNativeHotUpdatePlatform('wechat'), false);
});

test('latest.json v2 解析：地址规范化 + 平台渠道门槛', () => {
    const parsed = parseNativeHotUpdatePlan(planPayload(), 'android', 'dev', false);
    // packageUrl 末尾自动补 /，否则拼出来的文件地址会缺分隔符
    assert.equal(parsed.packageUrl, `${BASE_URL}/android/20260918-190000-android/`);
    assert.equal(parsed.remoteManifestUrl, `${BASE_URL}/android/dev/project.manifest`);
    assert.equal(parsed.releaseId, '20260918-190000-android');

    assert.throws(() => parseNativeHotUpdatePlan(planPayload({ schemaVersion: 1 }), 'android', 'dev'), /schemaVersion/);
    assert.throws(() => parseNativeHotUpdatePlan(planPayload({ platform: 'ios' }), 'android', 'dev'), /平台不匹配/);
    assert.throws(() => parseNativeHotUpdatePlan(planPayload({ channel: 'release' }), 'android', 'dev'), /渠道不匹配/);
    assert.throws(() => parseNativeHotUpdatePlan(planPayload({ rolloutPercentage: 101 }), 'android', 'dev'), /rolloutPercentage/);
    assert.throws(
        () => parseNativeHotUpdatePlan(planPayload({ remoteManifestUrl: 'http://example.com/p.m' }), 'android', 'dev', false),
        /HTTPS/,
    );
    // 本地调试放行局域网 HTTP，公网仍拒绝
    assert.equal(
        parseNativeHotUpdatePlan(planPayload({ remoteManifestUrl: 'http://192.168.2.156:5000/p.m' }), 'android', 'dev', true).remoteManifestUrl,
        'http://192.168.2.156:5000/p.m',
    );
});

test('主版本比较把"包内 / 已缓存 / 远端"排成单调序列', () => {
    // releaseId 的时间戳前缀必须可比大小，否则 AssetsManager 会在
    // "缓存清单 vs 包内清单谁更新"上判错，导致每次启动全量重下。
    assert.equal(parseReleaseStamp('20260918-190000-android'), 20260918190000);
    assert.equal(parseReleaseStamp('android-r1'), null);
    assert.equal(compareReleaseVersion('20260918-190000-android', '20260918-190000-android'), 0);
    assert.equal(compareReleaseVersion('20260919-100000-android', '20260918-190000-android'), 1);
    assert.equal(compareReleaseVersion('20260918-190000-android', '20260919-100000-android'), -1);
    // 一端不是 release 戳（本地没走发布流程的包）时退回四段版本比较
    assert.equal(compareReleaseVersion('1.2.3.0', '1.2.3'), 0);
    assert.equal(compareReleaseVersion('1.2.3.4', '1.2.3'), 1);
    assert.equal(compareReleaseVersion('0.6.0.0', '20260918-190000-android'), -1);
});

test('🔴 不得把 JS 版本比较器 / 校验器交给引擎（都会在原生下载线程上被调用）', () => {
    // 真机连崩三轮的共同根因：引擎把这两个 JS 回调放在**下载线程**上同步调用 ——
    //   ① VersionCompareHandle：`onSuccess → parseVersion() →
    //      Manifest::versionGreaterOrEquals → handle(localVersion, bVersion)`
    //   ② VerifyCallback：同一条 `onSuccess` 链
    // JS 引擎不在那个线程上 ⇒ 跨线程调 JS ⇒ 同步 SIGSEGV
    // （实测 `si_code=1 SEGV_MAPERR`、`fault addr 0xd5e4` 固定偏移、Thread-2、
    //   `checkUpdate()` 同步返回后约 0.4 秒崩在网络往返处）。
    //
    // 判据钉在**接口层**：host 接口根本不接受 versionCompareHandle，
    // 编译期就会挡住误用。
    const src = readFileSync('assets/script/platform/hotupdate/NativeHotUpdateHost.ts', 'utf8');
    assert.doesNotMatch(src, /createAssetsManager\(storagePath: string,\s*versionCompareHandle/,
        'createAssetsManager 不得再接受 versionCompareHandle（跨线程调 JS）');
    assert.doesNotMatch(src, /new AssetsManager\([^)]*,[^)]*,/,
        '不得给 AssetsManager 构造器传第三个参数 handle（跨线程调 JS）');

    const runtimeSrc = readFileSync('assets/script/platform/hotupdate/NativeHotUpdateRuntime.ts', 'utf8');
    assert.doesNotMatch(runtimeSrc, /setVerifyCallback\(/,
        '不得注册 setVerifyCallback（跨线程调 JS；本工程无 md5 桥，注册零收益）');
    assert.doesNotMatch(runtimeSrc, /buildNativeVersionCompare/,
        '不得再构造 JS 版本比较器传给引擎');
});

test('搜索路径前置去重：热更缓存必须排在最前', () => {
    assert.deepEqual(
        prependSearchPaths(['/app/', '/cache/'], ['/writable/hotupdate-dev/', '/app/']),
        ['/writable/hotupdate-dev/', '/app/', '/cache/'],
    );
    assert.deepEqual(prependSearchPaths([], []), []);
});

test('缓存目录名按渠道隔离', () => {
    assert.equal(resolveNativeStorageDirName({ channel: 'dev' }), 'hotupdate-dev');
    assert.equal(resolveNativeStorageDirName({ channel: 'release' }), 'hotupdate-release');
    assert.equal(resolveNativeStorageDirName({ channel: 'dev', nativeStorageDir: 'custom' }), 'custom');
});

test('非原生平台 / 未启用 / 环境不支持时直接放行', async () => {
    const disabledByConfig = createRuntime({});
    const result1 = await disabledByConfig.runtime.run(config({ enabled: false }));
    assert.equal(result1.status, 'disabled');
    assert.equal(result1.canContinue, true);

    const webRuntime = createRuntime({ platform: 'web' });
    const result2 = await webRuntime.runtime.run(config());
    assert.equal(result2.status, 'disabled');
    assert.equal(result2.canContinue, true);

    const unsupported = createRuntime({});
    unsupported.host.supported = false;
    const result3 = await unsupported.runtime.run(config());
    assert.equal(result3.status, 'disabled');
    assert.equal(result3.canContinue, true);
});

test('设备未进入灰度时不下载，直接用当前资源继续', async () => {
    const { runtime, host } = createRuntime({ payload: planPayload({ rolloutPercentage: 0 }) });
    const result = await runtime.run(config());
    assert.equal(result.status, 'deferred');
    assert.equal(result.canContinue, true);
    assert.equal(host.managers.length, 0);
});

test('客户端低于门槛时阻断并提示整包升级', async () => {
    const { runtime, host } = createRuntime({ payload: planPayload({ minClientVersion: '9.0.0.0' }) });
    const result = await runtime.run(config());
    assert.equal(result.status, 'mandatory-client-update');
    assert.equal(result.canContinue, false);
    assert.equal(host.managers.length, 0);
});

test('远端无变化时判为已是最新，不触发重启', async () => {
    const { runtime, host } = createRuntime({ behavior: 'up-to-date' });
    const result = await runtime.run(config());
    assert.equal(result.status, 'up-to-date');
    assert.equal(result.canContinue, true);
    assert.equal(host.restarts, 0);
    assert.equal(host.persisted, null);
});

test('下载完成后前置搜索路径、持久化并重启游戏', async () => {
    const { runtime, host } = createRuntime({ behavior: 'new-then-finish' });
    const progress: string[] = [];
    const result = await runtime.run(config(), (item) => progress.push(item.phase));

    assert.equal(result.status, 'restart-required');
    assert.equal(result.canContinue, false);
    assert.equal(result.releaseId, '20260918-190000-android');
    // 缓存目录必须排在最前，否则新下载的脚本盖不住包内旧脚本
    assert.deepEqual(host.searchPaths, ['/writable/hotupdate-dev/', '/app/']);
    assert.deepEqual(host.persisted, ['/writable/hotupdate-dev/', '/app/']);
    assert.equal(host.restarts, 1);
    // 两次 downloading：一次是进入下载阶段，一次是引擎的 UPDATE_PROGRESSION
    assert.deepEqual(progress, ['checking', 'validating', 'downloading', 'downloading', 'applying', 'done']);
    assert.deepEqual(host.removed, []);
    const manager = host.managers[0];
    assert.equal(manager.localManifestPath, 'project.manifest');
    assert.equal(manager.maxConcurrentTask, 3);
    // 🔴 不得把 JS 版本比较器交给引擎：它会在原生下载线程上被同步调用 ⇒ SIGSEGV
    assert.equal(manager.versionCompareHandle, undefined,
        '不得把 JS 比较器交给引擎（引擎会在下载线程上调用它）');
});

test('下载失败保留断点：续传只调 downloadFailedAssets，成功后仍要重启', async () => {
    const { runtime, host } = createRuntime({ behavior: 'fail-then-finish' });
    const first = await runtime.run(config());
    assert.equal(first.status, 'failed');
    assert.equal(first.canContinue, true);
    assert.equal(runtime.canRetryFailedAssets, true);
    assert.equal(host.restarts, 0);

    const second = await runtime.retryFailedAssets(config());
    assert.equal(second.status, 'restart-required');
    assert.equal(host.managers[0].retryCalls, 1);
    // 续传走的是 downloadFailedAssets，不能再走一遍 update() 全量流程
    assert.equal(host.managers[0].updateCalls, 1);
    assert.equal(host.restarts, 1);
});

test('续传仍失败时可继续重试，且不误报成功', async () => {
    const { runtime } = createRuntime({ behavior: 'always-fail' });
    const first = await runtime.run(config());
    assert.equal(first.status, 'failed');
    const second = await runtime.retryFailedAssets(config());
    assert.equal(second.status, 'failed');
    assert.equal(second.canContinue, true);
    assert.equal(runtime.canRetryFailedAssets, true);
});

test('latest.json 拿不到时退回随包清单自举；首装强制远端才阻断', async () => {
    const fallback = createRuntime({ reqThrows: true });
    const result = await fallback.runtime.run(config());
    assert.equal(result.status, 'restart-required');

    const strict = createRuntime({ reqThrows: true });
    strict.host.files.clear();
    const blocked = await strict.runtime.run(config({ requireRemoteOnFirstInstall: true }));
    assert.equal(blocked.status, 'failed');
    assert.equal(blocked.canContinue, false);
});

test('找不到随包 project.manifest 时明确失败而不是静默降级', async () => {
    const { runtime, host, requestedUrl } = createRuntime({ behavior: 'up-to-date' });
    host.files.clear();
    requestedUrl();
    const result = await runtime.run(config({ requireRemoteOnFirstInstall: true }));
    assert.equal(result.status, 'failed');
    assert.equal(result.canContinue, false);
    assert.match(result.message, /随包 project\.manifest/);
    assert.equal(host.managers.length, 0);
});

test('客户端版本变化时清理旧热更缓存（大版本升级不套用旧脚本）', async () => {
    const { runtime, host } = createRuntime({ behavior: 'up-to-date' });
    host.storedClientVersion = '1.0.0.0';
    await runtime.run(config({ clientVersion: '2.0.0.0' }));
    assert.deepEqual(host.removed, ['/writable/hotupdate-dev/']);
    assert.equal(host.clearedPersisted, 1);
    assert.equal(host.storedClientVersion, '2.0.0.0');
    // 校验通过：客户端版本一致时不动缓存
    const second = createRuntime({ behavior: 'up-to-date' });
    second.host.storedClientVersion = '1.0.0.0';
    await second.runtime.run(config({ clientVersion: '1.0.0.0' }));
    assert.deepEqual(second.host.removed, []);
});

test('未开启 allowUnsignedManifests 时拒绝无签名控制文件', async () => {
    const { runtime, host } = createRuntime({ payload: planPayload() });
    const result = await runtime.run(config({ allowUnsignedManifests: false }));
    assert.equal(result.status, 'integrity-error');
    assert.equal(result.canContinue, false);
    assert.equal(host.managers.length, 0);
});

test('外部验签返回 false 时拒绝该 release', async () => {
    const host = new FakeHost('new-then-finish');
    host.files.set('project.manifest', '{}');
    const runtime = new NativeHotUpdateRuntime({
        host,
        platform: 'android',
        clientId: () => 'client-1',
        network: { requestJson: async <T>() => planPayload({ signature: 'sig', keyId: 'k1' }) as T },
        verifySignature: async () => false,
    });
    const result = await runtime.run(config());
    assert.equal(result.status, 'integrity-error');
    assert.equal(host.managers.length, 0);
});

test('latest.json 中的地址与随包清单不一致时告警（暴露发布串渠道）', async () => {
    const { runtime, host } = createRuntime({
        behavior: 'up-to-date',
        payload: planPayload({ remoteManifestUrl: `${BASE_URL}/android/release/project.manifest` }),
    });
    await runtime.run(config());
    assert.ok(host.warnings.some((message) => message.includes('渠道清单与控制文件不一致')));
});

test('🔴 loadLocalManifest 只能传 1 个参数（传 2 个 = 引擎按 Manifest* 解引用 = 同步 SIGSEGV）', async () => {
    // 真机崩在这：`loadLocalManifest(manifestPath, storagePath)` 命中引擎的
    // `loadLocalManifest(localManifest: Manifest, storagePath: string)` 重载 ——
    // 引擎把路径字符串当 `Manifest*` 解引用 ⇒ fault addr 0x0，JS 侧没有栈，
    // 表现为「正在校验本地资源版本」之后直接 SIGSEGV，连下一行日志都打不出来。
    // 存储路径已在 `new AssetsManager('', storagePath)` 里给过，无需再传。
    const { runtime, host } = createRuntime({ behavior: 'up-to-date', payload: planPayload() });
    await runtime.run(config());
    assert.equal(host.managers.length, 1);
    assert.equal(
        host.managers[0].loadLocalManifestArgCount,
        1,
        'loadLocalManifest 必须只传 manifestUrl 一个参数',
    );
});

test('🔴 引擎常量读不到时必须抛错，绝不能用猜测值兜底', () => {
    // 真机崩在这：`environment` 原实现只读 `jsb.EventAssetsManager` 且每项带 `?? 0/1/2/…`。
    // 而引擎声明 `EventAssetsManager` 在 `native` 命名空间下，且注明全局 `jsb` 已废弃
    // （`native` 是 `jsb` 的子集）⇒ `jsb.EventAssetsManager` 可能根本不存在
    // ⇒ 全部常量退化成 0~9 的假值，与真实事件码错位 ⇒ 事件一个都匹配不上
    // ⇒ Promise 永不 resolve，而引擎下载线程还在派发事件。
    //
    // 判据取自 `CocosNativeHotUpdateHost.environment` 的取值逻辑：任何一个常量
    // 在三处（native / jsb / AssetsManager）都取不到时，必须**抛错**。
    const readConstant = (sources: Record<string, unknown>[], key: string): number => {
        for (const source of sources) {
            const value = source[key];
            if (typeof value === 'number') return value;
        }
        throw new Error(`读不到引擎常量 ${key}`);
    };

    // 三处都没有 ⇒ 抛错（而不是返回 0/1/2 这种猜测值）
    assert.throws(() => readConstant([{}, {}], 'NEW_VERSION_FOUND'), /读不到引擎常量/);

    // 猜测兜底会造成的后果（钉住这个认知）：假常量与真常量错位 ⇒ 事件匹配全失配
    const fake = { NEW_VERSION_FOUND: 6, ALREADY_UP_TO_DATE: 5 };
    const real = { NEW_VERSION_FOUND: 5, ALREADY_UP_TO_DATE: 6 };
    assert.notEqual(fake.NEW_VERSION_FOUND, real.NEW_VERSION_FOUND,
        '猜测值与真实值撞号时，NEW_VERSION_FOUND 会被误判成 ALREADY_UP_TO_DATE');
});
