export const HOT_UPDATE_SCHEMA_VERSION = 1;

/**
 * 原生（Android/iOS）全构建目录热更的 latest.json 版本号。
 *
 * v1 = 远程 Asset Bundle 清单（旧方案，只有资源和数据，改不了脚本）
 * v2 = 官方 native.AssetsManager 方案（src + assets + jsb-adapter 全量文件级清单）
 */
export const HOT_UPDATE_NATIVE_SCHEMA_VERSION = 2;

export type HotUpdatePlatform = 'web' | 'wechat' | 'douyin' | 'android' | 'ios';

export type BundleRequiredAt = 'startup' | 'login' | 'main' | 'battle' | 'onDemand';

export interface IHotUpdateBundleDescriptor {
    /** Asset Bundle 根 URL，不包含 config.json。 */
    readonly url: string;
    /** Creator MD5 Cache 生成的 config 版本 Hash。 */
    readonly version: string;
    readonly requiredAt?: BundleRequiredAt;
    readonly dependencies?: readonly string[];
    readonly size?: number;
}

export interface IHotUpdateManifest {
    readonly schemaVersion: number;
    readonly releaseId: string;
    readonly platform: HotUpdatePlatform;
    readonly channel: string;
    readonly minClientVersion: string;
    readonly createdAt?: string;
    readonly bundles: Readonly<Record<string, IHotUpdateBundleDescriptor>>;
}

export interface IHotUpdateReleasePointer {
    readonly schemaVersion: number;
    readonly releaseId: string;
    readonly manifestUrl: string;
    readonly manifestSha256?: string;
    readonly signature?: string;
    readonly keyId?: string;
    readonly rolloutPercentage?: number;
    readonly rolloutSalt?: string;
}

export interface IHotUpdateConfig {
    readonly enabled: boolean;
    readonly enabledPlatforms: readonly HotUpdatePlatform[];
    readonly channel: string;
    readonly clientVersion: string;
    readonly latestUrlTemplate: string;
    readonly startupBundles: readonly string[];
    readonly requestTimeoutMs: number;
    readonly allowHttpForLocalDebug: boolean;
    readonly allowUnsignedManifests: boolean;
    readonly requireRemoteOnFirstInstall: boolean;
    readonly platformOverride?: HotUpdatePlatform;
    /** 原生热更缓存目录名（落在应用可写目录下），默认 `hotupdate-<channel>`。 */
    readonly nativeStorageDir?: string;
    /** AssetsManager 并发下载数，默认 3。 */
    readonly nativeMaxConcurrentTask?: number;
    /**
     * 主版本比较口径：
     * - `release-stamp`（默认）按 releaseId 的 `YYYYMMDD-HHMMSS` 时间戳前缀比较，
     *   保证"包内 < 已缓存 < 远端新版本"单调，服务端把 latest 指回旧 release 也能收敛；
     * - `strict` 交给引擎默认语义（远端主版本更大才更新）。
     */
    readonly nativeVersionCompare?: NativeVersionCompareMode;
    /** 覆盖随包 project.manifest 的绝对路径（默认用 search path 自动定位）。 */
    readonly localManifestPath?: string;
    /** 更新完成后自动重启游戏的延时（毫秒），默认 1200。 */
    readonly nativeRestartDelayMs?: number;
}

export type NativeVersionCompareMode = 'release-stamp' | 'strict';

export interface IHotUpdateStoredState {
    readonly activeManifest?: IHotUpdateManifest;
    readonly previousManifest?: IHotUpdateManifest;
    readonly clientId: string;
}

export type HotUpdatePhase =
    | 'idle'
    | 'checking'
    | 'validating'
    | 'loading-bundles'
    | 'applying'
    | 'rolling-back'
    | 'done'
    | 'failed';

export interface IHotUpdateProgress {
    readonly phase: HotUpdatePhase;
    readonly message: string;
    readonly completed?: number;
    readonly total?: number;
    readonly bundle?: string;
}

export type HotUpdateResultStatus =
    | 'disabled'
    | 'up-to-date'
    | 'applied'
    | 'rollout-deferred'
    | 'degraded'
    | 'mandatory-client-update'
    | 'fatal-integrity-error';

export interface IHotUpdateResult {
    readonly status: HotUpdateResultStatus;
    readonly canContinue: boolean;
    readonly message: string;
    readonly releaseId?: string;
    readonly error?: unknown;
}

export interface IHotUpdateStore {
    read(): IHotUpdateStoredState;
    commit(manifest: IHotUpdateManifest): IHotUpdateStoredState;
}

export interface IHotUpdateBundleRuntime {
    apply(
        manifest: IHotUpdateManifest,
        startupBundles: readonly string[],
        onProgress?: (progress: IHotUpdateProgress) => void,
    ): Promise<void>;
}

export interface IHotUpdateManifestVerifier {
    verify(pointer: IHotUpdateReleasePointer, manifest: IHotUpdateManifest): Promise<boolean>;
}

/**
 * 原生热更目标版本（latest.json schemaVersion = 2）。
 *
 * 与 v1 的差别：v1 描述的是"要加载哪几个远程 Bundle"，v2 描述的是
 * "官方 project.manifest / version.manifest 在哪"。文件的逐个 md5 比对、下载、
 * 断点续传、失败重试全部交给引擎的 native.AssetsManager，客户端只做控制面：
 * 灰度、包内最低版本、签名策略、把远端地址覆盖到随包清单上。
 */
export interface IHotUpdateNativePlan {
    readonly schemaVersion: number;
    readonly releaseId: string;
    readonly platform: HotUpdatePlatform;
    readonly channel: string;
    readonly minClientVersion: string;
    /** 远端资源根地址（与远端 project.manifest 的 packageUrl 一致，须以 / 结尾）。 */
    readonly packageUrl: string;
    readonly remoteManifestUrl: string;
    readonly remoteVersionUrl?: string;
    readonly projectManifestSha256?: string;
    readonly versionManifestSha256?: string;
    readonly rolloutPercentage?: number;
    readonly rolloutSalt?: string;
    readonly signature?: string;
    readonly keyId?: string;
}

export type NativeHotUpdateStatus =
    /** 未启用 / 非原生平台，直接使用随包资源。 */
    | 'disabled'
    /** 与远端一致，无需下载。 */
    | 'up-to-date'
    /** 已下载完成，需要重启才生效。 */
    | 'restart-required'
    /** 本次未进入灰度，继续用当前的包内或缓存版本。 */
    | 'deferred'
    /** 客户端版本低于门槛，必须整包升级。 */
    | 'mandatory-client-update'
    /** 下载/校验失败，可重试（已下载的分片会被保留）。 */
    | 'failed'
    /** 控制文件本身不合法（平台/渠道/地址/签名）。 */
    | 'integrity-error';

export interface INativeHotUpdateResult {
    readonly status: NativeHotUpdateStatus;
    readonly canContinue: boolean;
    readonly message: string;
    readonly releaseId?: string;
    readonly error?: unknown;
}

export type NativeHotUpdatePhase = 'checking' | 'validating' | 'downloading' | 'applying' | 'done' | 'failed';

export interface INativeHotUpdateProgress {
    readonly phase: NativeHotUpdatePhase;
    readonly message: string;
    /** 字节进度 0~100（与官方 event.getPercent() 同为百分数）。 */
    readonly percent?: number;
    /** 文件进度 0~100。 */
    readonly percentByFile?: number;
    readonly downloadedBytes?: number;
    readonly totalBytes?: number;
    readonly downloadedFiles?: number;
    readonly totalFiles?: number;
}
