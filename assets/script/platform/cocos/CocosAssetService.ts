import { Asset, assetManager, AssetManager, Director, director, resources } from 'cc';
import type { AssetLoadOptions, AssetService, AssetType } from '../../core/asset/AssetService';
import { CocosBundleRegistry } from '../hotupdate/CocosBundleRegistry';

const RESOURCES_BUNDLE = 'resources';

/** Creator 3.8 AssetManager 的唯一业务适配入口。 */
export class CocosAssetService implements AssetService {
    private pendingReleases: Asset[] = [];
    private releaseScheduled = false;
    async load<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> {
        const bundle = await this.getBundle(options.bundle);
        const asset = await new Promise<T>((resolve, reject) => {
            (bundle.load as any)(path, type, (error: Error | null, value: T) => {
                if (error || !value) {
                    reject(error || new Error(`资源加载失败：${options.bundle ?? RESOURCES_BUNDLE}://${path}`));
                    return;
                }
                resolve(value);
            });
        });
        this.retainInScope(asset, options);
        return asset;
    }

    async has<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<boolean> {
        const bundle = await this.getBundle(options.bundle);
        try {
            // getInfoWithPath 查 bundle 构建索引（config.json 的 paths），不触发实际下载/反序列化。
            // Creator 3.8 的 Bundle 标准方法；防御性调用，方法缺失/异常时放行给 load 报真实错误。
            const getInfo = (bundle as unknown as {
                getInfoWithPath?: (p: string, t?: unknown) => { uuid: string } | null;
            }).getInfoWithPath;
            if (typeof getInfo !== 'function') return true; // 平台不支持预检 → 放行给 load
            return getInfo(path, type) != null;
        } catch {
            return true;
        }
    }

    async loadDir<T>(path: string, type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T[]> {
        const bundle = await this.getBundle(options.bundle);
        const assets = await new Promise<T[]>((resolve, reject) => {
            (bundle.loadDir as any)(path, type, (error: Error | null, values: T[]) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(values ?? []);
            });
        });
        for (const asset of assets) this.retainInScope(asset, options);
        return assets;
    }

    private async getBundle(name = RESOURCES_BUNDLE): Promise<AssetManager.Bundle> {
        if (name === RESOURCES_BUNDLE) return resources;
        const cached = assetManager.getBundle(name);
        if (cached) return cached;
        const remote = CocosBundleRegistry.resolve(name);
        return new Promise<AssetManager.Bundle>((resolve, reject) => {
            const source = remote?.url ?? name;
            const callback = (error: Error | null, bundle?: AssetManager.Bundle) => {
                if (error || !bundle) {
                    reject(error || new Error(`Asset Bundle 加载失败：${name}`));
                    return;
                }
                resolve(bundle);
            };
            if (remote) {
                (assetManager.loadBundle as any)(source, { version: remote.version }, callback);
            } else {
                assetManager.loadBundle(source, callback);
            }
        });
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
        });
    }
}
