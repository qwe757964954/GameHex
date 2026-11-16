import { AssetManager } from 'cc';
import type { AssetType } from '../../core/asset/AssetService';
import { bundleForPath } from '../../core/asset/BundleCatalog';
import { loadAssetBundle } from '../../platform/cocos/AssetBundleLoader';

/** `resources.load` 回调签名（与 Creator 3.8 一致）。 */
export type RoutedLoadCallback<T> = (error: Error | null, asset: T | null) => void;

/**
 * 按路径解析目标 bundle：未命中 BundleCatalog 归属表（含显式首包）→ resources；
 * 命中分包 → 交给 `loadAssetBundle`（已加载走缓存，未加载时它负责 loadBundle、
 * 从热更 manifest 取远程 url/version，并对同名并发去重）。
 */
const resolveBundle = (path: string): Promise<AssetManager.Bundle> => loadAssetBundle(bundleForPath(path));

/**
 * `resources.load` 的路由等价物：路径命中分包时自动改走对应 bundle，未命中保持首包原行为。
 * 回调签名与 `resources.load` 一致，可逐点平替。
 *
 * 功能页的美术加载器是模块级静态工具，没有构造注入通道拿不到 AssetService；
 * 这里是它们唯一的加载入口，路由规则仍由 core 的 BundleCatalog 持有。
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
export function routedLoadDir<T>(
    path: string,
    type: AssetType<T>,
    onLoaded: (error: Error | null, assets: T[]) => void,
): void {
    resolveBundle(path).then(
        (bundle) => {
            (bundle.loadDir as any)(path, type, (error: Error | null, assets: T[]) => {
                onLoaded(error, assets ?? []);
            });
        },
        (error: Error) => onLoaded(error, []),
    );
}
