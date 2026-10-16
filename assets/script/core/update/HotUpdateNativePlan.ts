import {
    HOT_UPDATE_NATIVE_SCHEMA_VERSION,
    HotUpdateNativePlan,
    HotUpdatePlatform,
    NativeVersionCompareMode,
} from './HotUpdateTypes';
import { assertRemoteUrl, compareVersion } from './HotUpdateManifest';

const RELEASE_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
const SUPPORTED_PLATFORMS = new Set<HotUpdatePlatform>(['web', 'wechat', 'douyin', 'android', 'ios']);

export function isNativeHotUpdatePlatform(platform: HotUpdatePlatform): boolean {
    return platform === 'android' || platform === 'ios';
}

function requireObject(value: unknown, name: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} 必须是对象`);
    }
    return value as Record<string, any>;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
    return value.trim();
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, '') + '/';
}

/**
 * 解析原生热更控制文件（latest.json schemaVersion = 2）。
 *
 * 只做"能不能用"的判断，不碰网络也不碰引擎 —— 平台、渠道、地址合法性、灰度、
 * 主版本门槛都在这层收敛，方便单测。
 */
export function parseNativeHotUpdatePlan(
    value: unknown,
    expectedPlatform: HotUpdatePlatform,
    expectedChannel: string,
    allowHttpForLocalDebug = false,
): HotUpdateNativePlan {
    const input = requireObject(value, 'latest.json');
    if (input.schemaVersion !== HOT_UPDATE_NATIVE_SCHEMA_VERSION) {
        throw new Error(
            `latest.json schemaVersion 不支持原生热更：期望 ${HOT_UPDATE_NATIVE_SCHEMA_VERSION}，实际 ${String(input.schemaVersion)}`,
        );
    }
    const releaseId = requireString(input.releaseId, 'latest.releaseId');
    if (!RELEASE_ID_PATTERN.test(releaseId)) throw new Error('latest.releaseId 格式非法');

    const platform = requireString(input.platform, 'latest.platform') as HotUpdatePlatform;
    if (!SUPPORTED_PLATFORMS.has(platform) || platform !== expectedPlatform) {
        throw new Error(`latest 平台不匹配：期望 ${expectedPlatform}，实际 ${platform}`);
    }
    const channel = requireString(input.channel, 'latest.channel');
    if (channel !== expectedChannel) throw new Error(`latest 渠道不匹配：期望 ${expectedChannel}，实际 ${channel}`);

    const packageUrl = normalizeBaseUrl(requireString(input.packageUrl, 'latest.packageUrl'));
    assertRemoteUrl(packageUrl, 'latest.packageUrl', allowHttpForLocalDebug);

    const remoteManifestUrl = requireString(input.remoteManifestUrl, 'latest.remoteManifestUrl');
    assertRemoteUrl(remoteManifestUrl, 'latest.remoteManifestUrl', allowHttpForLocalDebug);
    const remoteVersionUrl = optionalString(input.remoteVersionUrl);
    if (remoteVersionUrl) assertRemoteUrl(remoteVersionUrl, 'latest.remoteVersionUrl', allowHttpForLocalDebug);

    const rolloutPercentage = input.rolloutPercentage == null ? undefined : Number(input.rolloutPercentage);
    if (rolloutPercentage != null && (!Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)) {
        throw new Error('latest.rolloutPercentage 必须在 0 到 100 之间');
    }

    return {
        schemaVersion: HOT_UPDATE_NATIVE_SCHEMA_VERSION,
        releaseId,
        platform,
        channel,
        minClientVersion: requireString(input.minClientVersion, 'latest.minClientVersion'),
        packageUrl,
        remoteManifestUrl,
        remoteVersionUrl,
        projectManifestSha256: optionalString(input.projectManifestSha256),
        versionManifestSha256: optionalString(input.versionManifestSha256),
        rolloutPercentage,
        rolloutSalt: optionalString(input.rolloutSalt),
        signature: optionalString(input.signature),
        keyId: optionalString(input.keyId),
    };
}

/**
 * 解析 releaseId 里的时间戳前缀（发布脚本默认生成 `YYYYMMDD-HHMMSS-<platform>`）。
 * 解出来就能把"包内版本 / 已缓存版本 / 远端版本"排成单调序列，
 * 否则 AssetsManager 在"缓存 manifest 与包内 manifest 谁更新"上会判错。
 */
export function parseReleaseStamp(value: string): number | null {
    const match = /^(\d{8})-(\d{6})/.exec(value.trim());
    if (!match) return null;
    const stamp = Number(`${match[1]}${match[2]}`);
    return Number.isSafeInteger(stamp) ? stamp : null;
}

/**
 * 原生热更的主版本比较函数，语义与引擎一致：>0 表示 left 更新。
 *
 * 优先级：releaseId 时间戳 → 四段数字版本 → 字典序兜底。
 *
 * 注意不能像"不相等就返回 1"那样糊：引擎用它同时判断"远端是否比本地新"和
 * "缓存清单与包内清单谁更新"，非全序会让缓存判定飘。
 * 但"补零差异"（`1.2.3.0` vs `1.2.3`）必须判等 —— 与项目里 `compareVersion` 口径一致。
 */
export function compareReleaseVersion(left: string, right: string): number {
    if (left === right) return 0;
    const leftStamp = parseReleaseStamp(left);
    const rightStamp = parseReleaseStamp(right);
    if (leftStamp !== null && rightStamp !== null) {
        return leftStamp === rightStamp ? 0 : leftStamp > rightStamp ? 1 : -1;
    }
    const numeric = compareVersion(left, right);
    if (numeric !== 0) return numeric;
    // 两边都是纯数字点分版本 → 语义相等；否则用字典序给任意 id 一个确定的顺序。
    if (DOTTED_VERSION_PATTERN.test(left) && DOTTED_VERSION_PATTERN.test(right)) return 0;
    return left > right ? 1 : -1;
}

const DOTTED_VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

/**
 * ⚠️ **不要再把 JS 比较器传给引擎的 AssetsManager**（真机 SIGSEGV，已删除此函数）。
 *
 * 引擎 `Manifest::versionGreaterOrEquals` 原文：
 * ```cpp
 * if (handle) { greater = handle(localVersion, bVersion) >= 0; }
 * ```
 * 这个 handle 是构造 `AssetsManager` 时传进去的 **JS 函数**，而调用链是
 * `onFileTaskSuccess → onSuccess → parseVersion()`，即**原生下载线程**。
 * JS 引擎不在那个线程上 ⇒ 跨线程调用 JS ⇒ 同步 SIGSEGV
 * （实测 `SEGV_MAPERR`、`fault addr 0xd5e4` 固定偏移、Thread-2、`checkUpdate` 返回后约 0.4 秒）。
 *
 * **替代方案**：不传 handle，走引擎默认的 `cmpVersion`
 * （`sscanf("%d.%d.%d.%d")` 逐段比较，解析不了则 `strcmp`；releaseId 形如
 * `YYYYMMDD-HHMMSS-<平台>`，字典序等价于时间戳顺序，够用）。
 * 需要 release-stamp 全序比较的地方放在 **JS 侧**（`loadPlan` 里的 `compareReleaseVersion`），
 * 那是主线程调用，不存在跨线程问题。
 *
 * 同一个坑还适用于 `setVerifyCallback` —— 同样在下载线程被调，本工程也**故意不注册**。
 *
 * 版本比较的正确性判据见 `compareReleaseVersion` 的用例（纯函数，主线程安全）。
 */

/**
 * 把热更缓存目录前置到搜索路径最前面（并把重复项去掉）。
 *
 * 必须在 `game.restart()` 之前持久化，`main.js` 在下一帧启动时读它 ——
 * 否则新下载的脚本不会被加载，热更看起来"下载成功但没生效"。
 */
export function prependSearchPaths(current: readonly string[], prepend: readonly string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    const append = (path: string) => {
        if (!path || seen.has(path)) return;
        seen.add(path);
        result.push(path);
    };
    // 刻意用下标循环而不是 `[...a, ...b]`：release 构建会把数组展开降级成 `[].concat(x)`，
    // 项目里已因此踩过坑（见铁律：非数组可迭代一律 Array.from）。
    for (let index = 0; index < prepend.length; index += 1) append(prepend[index]);
    for (let index = 0; index < current.length; index += 1) append(current[index]);
    return result;
}

/** 原生缓存目录名：按渠道隔离，避免 dev / release 互相污染。 */
export function resolveNativeStorageDirName(config: {
    nativeStorageDir?: string;
    channel: string;
}): string {
    const explicit = config.nativeStorageDir?.trim();
    if (explicit) return explicit;
    const channel = config.channel.trim() || 'dev';
    return `hotupdate-${channel}`;
}
