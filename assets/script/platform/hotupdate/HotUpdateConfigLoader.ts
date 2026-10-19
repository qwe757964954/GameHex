import { JsonAsset, resources } from 'cc';
import type { IHotUpdateConfig, HotUpdatePlatform } from '../../core/update/HotUpdateTypes';

const CONFIG_PATH = 'config/hot_update';

export const DEFAULT_HOT_UPDATE_CONFIG: IHotUpdateConfig = {
    enabled: false,
    enabledPlatforms: ['android', 'ios'],
    channel: 'dev',
    clientVersion: '0.6.0.0',
    latestUrlTemplate: 'https://cdn.example.invalid/hotupdate/{platform}/{channel}/latest.json',
    startupBundles: ['remoteRef'],
    requestTimeoutMs: 8_000,
    allowHttpForLocalDebug: true,
    allowUnsignedManifests: true,
    requireRemoteOnFirstInstall: false,
    nativeStorageDir: '',
    nativeMaxConcurrentTask: 3,
    nativeVersionCompare: 'release-stamp',
    nativeRestartDelayMs: 1_200,
};

export async function loadHotUpdateConfig(): Promise<IHotUpdateConfig> {
    const json = await new Promise<Record<string, unknown> | null>((resolve) => {
        resources.load(CONFIG_PATH, JsonAsset, (error, asset) => {
            if (error || !asset?.json) {
                console.warn('[HotUpdate] 配置读取失败，使用内置关闭配置', error);
                resolve(null);
                return;
            }
            resolve(asset.json as Record<string, unknown>);
        });
    });
    if (!json) return DEFAULT_HOT_UPDATE_CONFIG;
    return {
        enabled: json.enabled === true,
        enabledPlatforms: Array.isArray(json.enabledPlatforms)
            ? json.enabledPlatforms.filter(isPlatform)
            : DEFAULT_HOT_UPDATE_CONFIG.enabledPlatforms,
        channel: stringValue(json.channel, DEFAULT_HOT_UPDATE_CONFIG.channel),
        clientVersion: stringValue(json.clientVersion, DEFAULT_HOT_UPDATE_CONFIG.clientVersion),
        latestUrlTemplate: stringValue(json.latestUrlTemplate, DEFAULT_HOT_UPDATE_CONFIG.latestUrlTemplate),
        startupBundles: Array.isArray(json.startupBundles)
            ? json.startupBundles.filter((item): item is string => typeof item === 'string' && !!item)
            : DEFAULT_HOT_UPDATE_CONFIG.startupBundles,
        requestTimeoutMs: positiveNumber(json.requestTimeoutMs, DEFAULT_HOT_UPDATE_CONFIG.requestTimeoutMs),
        allowHttpForLocalDebug: json.allowHttpForLocalDebug === true,
        allowUnsignedManifests: json.allowUnsignedManifests === true,
        requireRemoteOnFirstInstall: json.requireRemoteOnFirstInstall === true,
        platformOverride: isPlatform(json.platformOverride) ? json.platformOverride : undefined,
        nativeStorageDir: optionalString(json.nativeStorageDir),
        nativeMaxConcurrentTask: integerOrUndefined(json.nativeMaxConcurrentTask),
        nativeVersionCompare: isVersionCompareMode(json.nativeVersionCompare) ? json.nativeVersionCompare : undefined,
        nativeRestartDelayMs: integerOrUndefined(json.nativeRestartDelayMs),
        localManifestPath: optionalString(json.localManifestPath),
    };
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integerOrUndefined(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isVersionCompareMode(value: unknown): value is 'release-stamp' | 'strict' {
    return value === 'release-stamp' || value === 'strict';
}


function stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPlatform(value: unknown): value is HotUpdatePlatform {
    return value === 'web' || value === 'wechat' || value === 'douyin' || value === 'android' || value === 'ios';
}
