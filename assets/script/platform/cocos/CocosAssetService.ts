import { Asset, assetManager, Director, director, SpriteFrame } from 'cc';
import type { AssetLoadOptions, AssetService, AssetType } from '../../core/asset/AssetService';
import { bundleForPath } from '../../core/asset/BundleCatalog';
import { loadAssetBundle } from './AssetBundleLoader';
import { reportDeadSpriteFrames } from './SpriteFrameGuard';

const RESOURCES_BUNDLE = 'resources';

/** 未显式指定 bundle 时按路径前缀路由，命中分包表走对应 bundle，否则走首包。 */
const resolveBundle = (path: string, options: AssetLoadOptions): string | undefined =>
    options.bundle ?? bundleForPath(path);

/** Creator 3.8 AssetManager 的业务适配入口。 */
export class CocosAssetService implements AssetService {
    private pendingReleases: Asset[] = [];
    private releaseScheduled = false;
    async preload(path: string, options: AssetLoadOptions = {}): Promise<void> {
        if (options.scope?.disposed) return;
        const bundle = await loadAssetBundle(resolveBundle(path, options));
        if (options.scope?.disposed) return;
        await new Promise<void>((resolve, reject) => {
            // default 预设只下载不解析，绕开 preload 预设每帧 2 项的低速调度；并发由调用方限制。
            assetManager.preloadAny({ path, bundle: bundle.name, priority: options.priority ?? -1 },
                { preset: 'default' }, (error: Error | null) => error ? reject(error) : resolve());
        });
    }
    async load<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> {
        const bundle = await loadAssetBundle(resolveBundle(path, options));
        const asset = await new Promise<T>((resolve, reject) => {
            const callback = (error: Error | null, value: Asset) => {
                if (error || !value) {
                    reject(error || new Error(`资源加载失败：${resolveBundle(path, options) ?? RESOURCES_BUNDLE}://${path}`));
                    return;
                }
                resolve(value as unknown as T);
            };
            const assetType = type as unknown as typeof Asset;
            if (options.priority === undefined) bundle.load(path, assetType, callback);
            else assetManager.loadAny({ path, type: assetType, bundle: bundle.name, priority: options.priority }, callback);
        });
        this.retainInScope(asset, options);
        return asset;
    }

    async has<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<boolean> {
        const bundle = await loadAssetBundle(resolveBundle(path, options));
        // 只查 bundle 构建索引，不触发下载或反序列化。
        const assetType = type as unknown as typeof Asset;
        return bundle.getInfoWithPath(path, assetType) != null;
    }

    async loadDir<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T[]> {
        const bundle = await loadAssetBundle(resolveBundle(path, options));
        const assets = await new Promise<T[]>((resolve, reject) => {
            const callback = (error: Error | null, values: Asset[]) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(values as unknown as T[]);
            };
            const assetType = type as unknown as typeof Asset;
            if (options.priority === undefined) bundle.loadDir(path, assetType, callback);
            else assetManager.loadAny({ dir: path, type: assetType, bundle: bundle.name, priority: options.priority }, { __outputAsArray__: true }, callback);
        });
        for (const asset of assets) this.retainInScope(asset, options);
        return assets;
    }

    private retainInScope<T>(value: T, options: AssetLoadOptions): void {
        const asset = value as unknown as Asset;
        if (!options.scope || !(asset instanceof Asset)) return;
        asset.addRef();
        options.scope.defer(() => this.releaseAfterDraw(asset));
    }

    private releaseAfterDraw(asset: Asset): void {
        // Node/Component.destroy 在逻辑更新结束后才真正销毁，当前帧先保留贴图引用。
        this.pendingReleases.push(asset);
        if (this.releaseScheduled) return;
        this.releaseScheduled = true;
        director.once(Director.EVENT_AFTER_DRAW, () => {
            const releases = this.pendingReleases;
            this.pendingReleases = [];
            this.releaseScheduled = false;
            for (const retained of releases) retained.decRef();
            // 临时探针：本批含 SpriteFrame 时扫场景，把挂着已释放贴图的 Sprite 点名置空（见 SpriteFrameGuard）。
            if (releases.some((asset) => asset instanceof SpriteFrame)) {
                reportDeadSpriteFrames(`释放 ${releases.length} 个资源后`);
            }
        });
    }
}
