import type { NetworkTransport } from '../../core/network/NetworkTransport';
import type { HotUpdateConfig, HotUpdateNativePlan, HotUpdatePlatform } from '../../core/update/HotUpdateTypes';
import { EngineMain } from '../../engine/EngineMain';
import { HotUpdateManager } from '../../app/update/HotUpdateManager';
import { CocosBundleRuntime } from './CocosBundleRuntime';
import { CocosHotUpdateStore } from './CocosHotUpdateStore';
import { CocosManifestVerifier } from './CocosManifestVerifier';
import { CocosNativeHotUpdateHost } from './NativeHotUpdateHost';
import { NativeHotUpdateRuntime } from './NativeHotUpdateRuntime';

export function createCocosHotUpdateManager(
    network: NetworkTransport,
    config: HotUpdateConfig,
): HotUpdateManager {
    return new HotUpdateManager({
        network,
        store: new CocosHotUpdateStore(),
        runtime: new CocosBundleRuntime(),
        verifier: new CocosManifestVerifier(config.allowUnsignedManifests),
        platform: config.platformOverride ?? detectHotUpdatePlatform(),
    });
}

/**
 * 原生全构建目录热更（官方 native.AssetsManager 方案）。
 *
 * 只在 Android / iOS 生效；Web 与小游戏由 `createCocosHotUpdateManager` 那条
 * 远程 Bundle 路径负责（那边解决的是包体而非脚本热更）。
 */
export function createNativeHotUpdateRuntime(
    network: NetworkTransport,
    config: HotUpdateConfig,
): NativeHotUpdateRuntime {
    const store = new CocosHotUpdateStore();
    return new NativeHotUpdateRuntime({
        network,
        host: new CocosNativeHotUpdateHost(),
        platform: config.platformOverride ?? detectHotUpdatePlatform(),
        clientId: () => store.read().clientId,
        verifySignature: createSignatureVerifier(config),
    });
}

/**
 * 原生路径的验签：改成校验 latest.json 本身（v1 是校验 pointer + manifest 两份，
 * 原生方案的 project.manifest 由引擎自己拉，客户端不代管）。
 */
function createSignatureVerifier(
    config: HotUpdateConfig,
): ((plan: HotUpdateNativePlan) => Promise<boolean>) | undefined {
    type VerifyHook = (payload: string, signature: string, keyId?: string) => boolean | Promise<boolean>;
    const hook = (globalThis as { __CITY1001_VERIFY_HOT_UPDATE__?: VerifyHook }).__CITY1001_VERIFY_HOT_UPDATE__;
    if (!hook) return undefined;
    return async (plan) => {
        if (!plan.signature) return config.allowUnsignedManifests;
        const payload = JSON.stringify({
            schemaVersion: plan.schemaVersion,
            releaseId: plan.releaseId,
            platform: plan.platform,
            channel: plan.channel,
            minClientVersion: plan.minClientVersion,
            packageUrl: plan.packageUrl,
            remoteManifestUrl: plan.remoteManifestUrl,
            projectManifestSha256: plan.projectManifestSha256,
            versionManifestSha256: plan.versionManifestSha256,
            rolloutPercentage: plan.rolloutPercentage,
            rolloutSalt: plan.rolloutSalt,
            keyId: plan.keyId,
        });
        return await hook(payload, plan.signature, plan.keyId);
    };
}

export function detectHotUpdatePlatform(): HotUpdatePlatform {
    if (EngineMain.isMiniGameWeiXin) return 'wechat';
    if (EngineMain.isMiniGameDouyin) return 'douyin';
    if (EngineMain.isAndroid) return 'android';
    if (EngineMain.isIOS) return 'ios';
    return 'web';
}
