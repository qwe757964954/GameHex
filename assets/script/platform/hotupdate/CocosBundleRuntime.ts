import { assetManager, AssetManager } from 'cc';
import { resolveBundleLoadOrder } from '../../core/update/HotUpdateManifest';
import type {
    HotUpdateBundleRuntime,
    HotUpdateManifest,
    HotUpdateProgress,
} from '../../core/update/HotUpdateTypes';
import { CocosBundleRegistry } from './CocosBundleRegistry';

/** 使用 Creator 的远程 Bundle 管线统一覆盖小游戏和原生平台。 */
export class CocosBundleRuntime implements HotUpdateBundleRuntime {
    private readonly loadedVersions = new Map<string, string>();

    async apply(
        manifest: HotUpdateManifest,
        startupBundles: readonly string[],
        onProgress?: (progress: HotUpdateProgress) => void,
    ): Promise<void> {
        const previous = CocosBundleRegistry.snapshot();
        const loadedThisAttempt: string[] = [];
        CocosBundleRegistry.replace(manifest.bundles);
        try {
            const roots = startupBundles.length
                ? startupBundles
                : Object.entries(manifest.bundles)
                    .filter(([, bundle]) => bundle.requiredAt === 'startup')
                    .map(([name]) => name);
            const order = resolveBundleLoadOrder(manifest.bundles, roots);
            for (let index = 0; index < order.length; index += 1) {
                const name = order[index];
                const descriptor = manifest.bundles[name];
                onProgress?.({
                    phase: 'loading-bundles',
                    message: `正在准备资源 ${name}`,
                    completed: index,
                    total: order.length,
                    bundle: name,
                });
                await this.loadBundle(name, descriptor.url, descriptor.version);
                loadedThisAttempt.push(name);
                onProgress?.({
                    phase: 'loading-bundles',
                    message: `资源 ${name} 已就绪`,
                    completed: index + 1,
                    total: order.length,
                    bundle: name,
                });
            }
        } catch (error) {
            CocosBundleRegistry.replace(previous);
            for (const name of loadedThisAttempt.reverse()) this.removeLoadedBundle(name);
            throw error;
        }
    }

    private async loadBundle(name: string, url: string, version: string): Promise<AssetManager.Bundle> {
        const existing = assetManager.getBundle(name);
        if (existing && this.loadedVersions.get(name) === version) return existing;
        if (existing) assetManager.removeBundle(existing);

        const bundle = await new Promise<AssetManager.Bundle>((resolve, reject) => {
            (assetManager.loadBundle as any)(url, { version }, (error: Error | null, value?: AssetManager.Bundle) => {
                if (error || !value) {
                    reject(error || new Error(`远端 Bundle 加载失败：${name}`));
                    return;
                }
                resolve(value);
            });
        });
        const actualName = (bundle as any).name as string | undefined;
        if (actualName && actualName !== name) {
            assetManager.removeBundle(bundle);
            throw new Error(`Bundle 名称不匹配：期望 ${name}，实际 ${actualName}`);
        }
        this.loadedVersions.set(name, version);
        return bundle;
    }

    private removeLoadedBundle(name: string): void {
        const bundle = assetManager.getBundle(name);
        if (bundle) assetManager.removeBundle(bundle);
        this.loadedVersions.delete(name);
    }
}
