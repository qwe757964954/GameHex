import { HOT_UPDATE_SCHEMA_VERSION } from './HotUpdateTypes';
import type {
    IHotUpdateBundleDescriptor,
    IHotUpdateManifest,
    HotUpdatePlatform,
    IHotUpdateReleasePointer,
} from './HotUpdateTypes';

const RELEASE_ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
const BUNDLE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SUPPORTED_PLATFORMS = new Set<HotUpdatePlatform>(['web', 'wechat', 'douyin', 'android', 'ios']);

function requireObject(value: unknown, name: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} 必须是对象`);
    }
    return value as Record<string, any>;
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
    return value;
}

/**
 * 校验远端地址：强制 HTTPS（本地联调可放行 loopback / RFC1918），并拒绝空白与 `..` 穿越。
 * v1（Bundle 清单）与 v2（原生全目录清单）共用，避免两套口径。
 */
export function assertRemoteUrl(value: string, name: string, allowHttpForLocalDebug: boolean): void {
    const isHttps = /^https:\/\//i.test(value);
    // 本地联调既可能走同机 loopback，也可能由手机访问开发机的 RFC 1918 局域网地址。
    // 只有显式打开 allowHttpForLocalDebug 才接受这些 HTTP 地址；公网地址仍强制 HTTPS。
    const isLocalHttp = /^http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?:\/|$)/i.test(value);
    if (!isHttps && !(allowHttpForLocalDebug && isLocalHttp)) {
        throw new Error(`${name} 必须使用 HTTPS${allowHttpForLocalDebug ? '（本地调试地址除外）' : ''}`);
    }
    if (/\s/.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) {
        throw new Error(`${name} 包含非法路径`);
    }
}

const assertHttpsUrl = assertRemoteUrl;

export function parseReleasePointer(value: unknown, allowHttpForLocalDebug = false): IHotUpdateReleasePointer {
    const input = requireObject(value, 'latest.json');
    if (input.schemaVersion !== HOT_UPDATE_SCHEMA_VERSION) {
        throw new Error(`latest.json schemaVersion 不支持：${String(input.schemaVersion)}`);
    }
    const releaseId = requireString(input.releaseId, 'latest.releaseId');
    if (!RELEASE_ID_PATTERN.test(releaseId)) throw new Error('latest.releaseId 格式非法');
    const manifestUrl = requireString(input.manifestUrl, 'latest.manifestUrl');
    assertHttpsUrl(manifestUrl, 'latest.manifestUrl', allowHttpForLocalDebug);

    const rolloutPercentage = input.rolloutPercentage == null ? undefined : Number(input.rolloutPercentage);
    if (rolloutPercentage != null && (!Number.isFinite(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)) {
        throw new Error('latest.rolloutPercentage 必须在 0 到 100 之间');
    }
    return {
        schemaVersion: HOT_UPDATE_SCHEMA_VERSION,
        releaseId,
        manifestUrl,
        manifestSha256: typeof input.manifestSha256 === 'string' ? input.manifestSha256 : undefined,
        signature: typeof input.signature === 'string' ? input.signature : undefined,
        keyId: typeof input.keyId === 'string' ? input.keyId : undefined,
        rolloutPercentage,
        rolloutSalt: typeof input.rolloutSalt === 'string' ? input.rolloutSalt : undefined,
    };
}

export function parseHotUpdateManifest(
    value: unknown,
    expectedPlatform: HotUpdatePlatform,
    expectedChannel: string,
    allowHttpForLocalDebug = false,
): IHotUpdateManifest {
    const input = requireObject(value, 'manifest.json');
    if (input.schemaVersion !== HOT_UPDATE_SCHEMA_VERSION) {
        throw new Error(`manifest schemaVersion 不支持：${String(input.schemaVersion)}`);
    }
    const releaseId = requireString(input.releaseId, 'manifest.releaseId');
    if (!RELEASE_ID_PATTERN.test(releaseId)) throw new Error('manifest.releaseId 格式非法');
    const platform = requireString(input.platform, 'manifest.platform') as HotUpdatePlatform;
    if (!SUPPORTED_PLATFORMS.has(platform) || platform !== expectedPlatform) {
        throw new Error(`manifest 平台不匹配：期望 ${expectedPlatform}，实际 ${platform}`);
    }
    const channel = requireString(input.channel, 'manifest.channel');
    if (channel !== expectedChannel) throw new Error(`manifest 渠道不匹配：期望 ${expectedChannel}，实际 ${channel}`);
    const minClientVersion = requireString(input.minClientVersion, 'manifest.minClientVersion');
    const bundleInput = requireObject(input.bundles, 'manifest.bundles');
    const bundles: Record<string, IHotUpdateBundleDescriptor> = {};

    for (const [name, raw] of Object.entries(bundleInput)) {
        if (!BUNDLE_NAME_PATTERN.test(name)) throw new Error(`Bundle 名称非法：${name}`);
        const bundle = requireObject(raw, `manifest.bundles.${name}`);
        const url = requireString(bundle.url, `manifest.bundles.${name}.url`).replace(/\/+$/, '');
        assertHttpsUrl(url, `manifest.bundles.${name}.url`, allowHttpForLocalDebug);
        const version = requireString(bundle.version, `manifest.bundles.${name}.version`);
        if (!VERSION_PATTERN.test(version)) throw new Error(`Bundle 版本格式非法：${name}`);
        const dependencies = bundle.dependencies == null
            ? []
            : Array.isArray(bundle.dependencies)
                ? bundle.dependencies.map((item: unknown) => requireString(item, `${name}.dependencies[]`))
                : (() => { throw new Error(`${name}.dependencies 必须是数组`); })();
        const size = bundle.size == null ? undefined : Number(bundle.size);
        if (size != null && (!Number.isSafeInteger(size) || size < 0)) throw new Error(`${name}.size 格式非法`);
        bundles[name] = {
            url,
            version,
            requiredAt: bundle.requiredAt ?? 'onDemand',
            dependencies,
            size,
        };
    }
    validateBundleDependencies(bundles);
    return {
        schemaVersion: HOT_UPDATE_SCHEMA_VERSION,
        releaseId,
        platform,
        channel,
        minClientVersion,
        createdAt: typeof input.createdAt === 'string' ? input.createdAt : undefined,
        bundles,
    };
}

export function resolveBundleLoadOrder(
    bundles: Readonly<Record<string, IHotUpdateBundleDescriptor>>,
    roots: readonly string[],
): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (name: string) => {
        if (visited.has(name)) return;
        const bundle = bundles[name];
        if (!bundle) throw new Error(`Manifest 不包含启动 Bundle：${name}`);
        if (visiting.has(name)) throw new Error(`Bundle 依赖形成环：${name}`);
        visiting.add(name);
        for (const dependency of bundle.dependencies ?? []) visit(dependency);
        visiting.delete(name);
        visited.add(name);
        order.push(name);
    };
    for (const root of roots) visit(root);
    return order;
}

function validateBundleDependencies(bundles: Readonly<Record<string, IHotUpdateBundleDescriptor>>): void {
    for (const [name, bundle] of Object.entries(bundles)) {
        for (const dependency of bundle.dependencies ?? []) {
            if (!bundles[dependency]) throw new Error(`Bundle ${name} 依赖不存在的 Bundle：${dependency}`);
            if (dependency === name) throw new Error(`Bundle ${name} 不能依赖自身`);
        }
    }
    resolveBundleLoadOrder(bundles, Object.keys(bundles));
}

export function compareVersion(left: string, right: string): number {
    const parse = (value: string) => value.split('.').map((part) => {
        const match = /^(\d+)/.exec(part);
        return match ? Number(match[1]) : 0;
    });
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const delta = (a[index] ?? 0) - (b[index] ?? 0);
        if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
}

/** 灰度分桶只需要这三个字段，v1 的 ReleasePointer 与 v2 的 NativePlan 都天然满足。 */
export interface IRolloutDescriptor {
    readonly releaseId: string;
    readonly rolloutPercentage?: number;
    readonly rolloutSalt?: string;
}

export function isRolloutEligible(clientId: string, pointer: IRolloutDescriptor): boolean {
    const percentage = pointer.rolloutPercentage ?? 100;
    if (percentage >= 100) return true;
    if (percentage <= 0) return false;
    let hash = 0x811c9dc5;
    const value = `${pointer.rolloutSalt ?? pointer.releaseId}:${clientId}`;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % 10_000 < Math.round(percentage * 100);
}

export function appendCacheBust(url: string, now = Date.now()): string {
    return `${url}${url.includes('?') ? '&' : '?'}_hu=${now}`;
}
