import type { NetworkTransport } from '../../core/network/NetworkTransport';
import {
    appendCacheBust,
    compareVersion,
    isRolloutEligible,
    parseHotUpdateManifest,
    parseReleasePointer,
} from '../../core/update/HotUpdateManifest';
import type {
    IHotUpdateBundleRuntime,
    IHotUpdateConfig,
    IHotUpdateManifest,
    IHotUpdateManifestVerifier,
    HotUpdatePlatform,
    IHotUpdateProgress,
    IHotUpdateResult,
    IHotUpdateStore,
} from '../../core/update/HotUpdateTypes';

export interface IHotUpdateManagerDependencies {
    readonly network: NetworkTransport;
    readonly store: IHotUpdateStore;
    readonly runtime: IHotUpdateBundleRuntime;
    readonly verifier: IHotUpdateManifestVerifier;
    readonly platform: HotUpdatePlatform;
    readonly now?: () => number;
}

/**
 * 与具体平台无关的热更新编排器。
 *
 * 远端 Bundle 的下载和缓存交给 Creator AssetManager；本类只负责控制面、版本选择、
 * 安全校验、启动 Bundle 收敛以及 active/previous 两版状态提交。
 */
export class HotUpdateManager {
    private readonly now: () => number;

    constructor(private readonly dependencies: IHotUpdateManagerDependencies) {
        this.now = dependencies.now ?? (() => Date.now());
    }

    async run(
        config: IHotUpdateConfig,
        onProgress?: (progress: IHotUpdateProgress) => void,
    ): Promise<IHotUpdateResult> {
        const emit = (progress: IHotUpdateProgress) => onProgress?.(progress);
        const actualPlatform = this.dependencies.platform;
        const platform = config.platformOverride ?? actualPlatform;
        const isNativeRuntime = actualPlatform === 'android' || actualPlatform === 'ios';
        const isNativeTarget = platform === 'android' || platform === 'ios';
        if (!config.enabled || !isNativeRuntime || !isNativeTarget || !config.enabledPlatforms.includes(platform)) {
            emit({ phase: 'done', message: '资源热更新未启用，使用随包资源' });
            return { status: 'disabled', canContinue: true, message: '资源热更新未启用' };
        }

        const stored = this.dependencies.store.read();
        const latestUrl = this.expandLatestUrl(config.latestUrlTemplate, platform, config.channel);
        emit({ phase: 'checking', message: '正在检查资源版本' });

        try {
            const pointerRaw = await this.dependencies.network.requestJson<unknown>({
                url: appendCacheBust(latestUrl, this.now()),
                method: 'GET',
                timeoutMs: config.requestTimeoutMs,
            });
            const pointer = parseReleasePointer(pointerRaw, config.allowHttpForLocalDebug);
            if (!isRolloutEligible(stored.clientId, pointer)) {
                await this.activateFallback(stored.activeManifest, config, emit);
                return {
                    status: 'rollout-deferred',
                    canContinue: true,
                    message: '当前设备未进入本次灰度',
                    releaseId: stored.activeManifest?.releaseId,
                };
            }

            const manifestRaw = await this.dependencies.network.requestJson<unknown>({
                url: appendCacheBust(pointer.manifestUrl, this.now()),
                method: 'GET',
                timeoutMs: config.requestTimeoutMs,
            });
            emit({ phase: 'validating', message: '正在校验资源版本' });
            const manifest = parseHotUpdateManifest(
                manifestRaw,
                platform,
                config.channel,
                config.allowHttpForLocalDebug,
            );
            if (manifest.releaseId !== pointer.releaseId) {
                throw new IntegrityError(`latest 与 manifest 的 releaseId 不一致：${pointer.releaseId} / ${manifest.releaseId}`);
            }
            if (compareVersion(config.clientVersion, manifest.minClientVersion) < 0) {
                return {
                    status: 'mandatory-client-update',
                    canContinue: false,
                    message: `客户端版本过低，需要升级到 ${manifest.minClientVersion} 或以上`,
                    releaseId: manifest.releaseId,
                };
            }
            if (!pointer.signature && !config.allowUnsignedManifests) {
                throw new IntegrityError('正式环境 latest.json 缺少签名');
            }
            if (!(await this.dependencies.verifier.verify(pointer, manifest))) {
                throw new IntegrityError('Manifest 签名校验失败');
            }

            if (stored.activeManifest?.releaseId === manifest.releaseId) {
                await this.dependencies.runtime.apply(manifest, config.startupBundles, emit);
                emit({ phase: 'done', message: '资源已经是最新版本' });
                return {
                    status: 'up-to-date',
                    canContinue: true,
                    message: '资源已经是最新版本',
                    releaseId: manifest.releaseId,
                };
            }

            await this.dependencies.runtime.apply(manifest, config.startupBundles, emit);
            emit({ phase: 'applying', message: '正在提交资源版本' });
            this.dependencies.store.commit(manifest);
            emit({ phase: 'done', message: '资源更新完成' });
            return {
                status: 'applied',
                canContinue: true,
                message: '资源更新完成',
                releaseId: manifest.releaseId,
            };
        } catch (error) {
            const integrityFailure = error instanceof IntegrityError;
            emit({ phase: 'rolling-back', message: '更新未完成，正在恢复可用版本' });
            try {
                await this.activateFallback(stored.activeManifest, config, emit);
            } catch (fallbackError) {
                return this.firstInstallFailure(config, integrityFailure, error, fallbackError);
            }
            if (stored.activeManifest) {
                return {
                    status: integrityFailure ? 'fatal-integrity-error' : 'degraded',
                    canContinue: true,
                    message: integrityFailure ? '新版本校验失败，已恢复上一可用版本' : '更新失败，已使用上一可用版本',
                    releaseId: stored.activeManifest.releaseId,
                    error,
                };
            }
            return this.firstInstallFailure(config, integrityFailure, error);
        }
    }

    private async activateFallback(
        manifest: IHotUpdateManifest | undefined,
        config: IHotUpdateConfig,
        emit: (progress: IHotUpdateProgress) => void,
    ): Promise<void> {
        if (!manifest) return;
        await this.dependencies.runtime.apply(manifest, config.startupBundles, emit);
    }

    private firstInstallFailure(
        config: IHotUpdateConfig,
        integrityFailure: boolean,
        error: unknown,
        fallbackError?: unknown,
    ): IHotUpdateResult {
        const canContinue = !config.requireRemoteOnFirstInstall;
        return {
            status: integrityFailure ? 'fatal-integrity-error' : 'degraded',
            canContinue,
            message: canContinue
                ? '远端资源不可用，使用随包资源继续'
                : '首次资源准备失败，请检查网络后重试',
            error: fallbackError ?? error,
        };
    }

    private expandLatestUrl(template: string, platform: HotUpdatePlatform, channel: string): string {
        const value = template
            .replace(/\{platform\}/g, encodeURIComponent(platform))
            .replace(/\{channel\}/g, encodeURIComponent(channel));
        if (!/^https?:\/\//i.test(value)) throw new Error('热更新 latestUrlTemplate 配置无效');
        return value;
    }
}

class IntegrityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IntegrityError';
    }
}
