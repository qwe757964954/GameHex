import { AssetManager, assetManager, resources } from 'cc';
import type { AssetType } from '../../core/asset/AssetService';
import { bundleForPath } from '../../core/asset/BundleCatalog';

/** `resources.load` 回调签名（与 Creator 3.8 一致）。 */
export type RoutedLoadCallback<T> = (error: Error | null, asset: T | null) => void;

/**
 * 按路径解析目标 bundle：未命中 BundleCatalog 归属表（含显式首包）→ resources；
 * 命中分包 → 已加载直接取缓存，未加载则 loadBundle（幂等，之后走缓存）。
 */
const resolveBundle = (path: string): Promise<AssetManager.Bundle> => {
    const name = bundleForPath(path);
    if (!name || name === 'resources') return Promise.resolve(resources);
    const cached = assetManager.getBundle(name);
    if (cached) return Promise.resolve(cached);
    return new Promise<AssetManager.Bundle>((resolve, reject) => {
        assetManager.loadBundle(name, (error, bundle) => {
            if (error || !bundle) {
                reject(error || new Error(`Asset Bundle 加载失败：${name}`));
                return;
            }
            resolve(bundle);
        });
    });
};

/**
 * `resources.load` 的路由等价物：路径命中 BundleCatalog 分包时自动改走对应 bundle，
 * 未命中保持首包 resources 原行为。回调签名与 `resources.load` 一致，可逐点平替。
 *
 * 分层定位：功能页美术加载器（HeadArt / CardLineupIcons / RoleArtLoader / StoreArt 等）
 * 是模块级静态工具，无构造注入通道，不能拿到 AssetService 实例；本函数是它们唯一的
 * 加载入口（不再直连 resources.load），路由规则仍由 core 的 BundleCatalog 唯一持有。
 */
export function routedLoad<T>(path: string, type: AssetType<T>, onLoaded: RoutedLoadCallback<T>): void {
    resolveBundle(path).then(
        (bundle) => {
            (bundle.load as any)(path, type, (error: Error | null, asset: T | null) => {
                onLoaded(error, asset ?? null);
            });
        },
        (error: Error) => onLoaded(error, null),
    );
}

/** `resources.loadDir` 的路由等价物。 */
export function routedLoadDir<T>(path: string, type: AssetType<T>, onLoaded: (error: Error | null, assets: T[]) => void): void {
    resolveBundle(path).then(
        (bundle) => {
            (bundle.loadDir as any)(path, type, (error: Error | null, assets: T[]) => {
                onLoaded(error, assets ?? []);
            });
        },
        (error: Error) => onLoaded(error, []),
    );
}
