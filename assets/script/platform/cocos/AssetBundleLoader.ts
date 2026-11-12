import { assetManager, AssetManager, resources } from 'cc';
import { CocosBundleRegistry } from '../hotupdate/CocosBundleRegistry';

const RESOURCES_BUNDLE = 'resources';

/** 在途加载：同名并发只发一次 IO；成功/失败都清掉（成功后续走 `assetManager` 缓存，失败允许重试）。 */
const pending = new Map<string, Promise<AssetManager.Bundle>>();

/**
 * bundle 名 → 已加载的 Bundle 实例（未命中 / `resources` 即首包）。
 *
 * 🔴 这是进入 Asset Bundle 的**唯一入口**。远程 url 与 version 只有这里会从热更 manifest
 * （`CocosBundleRegistry`）解析；任何地方直连 `assetManager.loadBundle(name)` 都会退回
 * Creator 构建期地址 —— 热更后第一次加载 `onDemand` bundle（`tools/hotupdate/build_hotupdate.mjs`
 * 默认只把 `remoteRef` 设为 startup）会拿到旧包或 404，而且全程零报错。
 *
 * 反向守卫见 `tests/asset-bundle-entry.test.ts`：除本文件与 `CocosBundleRuntime`（热更域，
 * 自带版本比对与回滚语义）外，`assets/script` 下不得出现 `assetManager.loadBundle`。
 */
export function loadAssetBundle(name?: string): Promise<AssetManager.Bundle> {
    if (!name || name === RESOURCES_BUNDLE) return Promise.resolve(resources);
    const cached = assetManager.getBundle(name);
    if (cached) return Promise.resolve(cached);
    const inflight = pending.get(name);
    if (inflight) return inflight;

    const remote = CocosBundleRegistry.resolve(name);
    const source = remote?.url ?? name;
    const task = new Promise<AssetManager.Bundle>((resolve, reject) => {
        const callback = (error: Error | null, bundle?: AssetManager.Bundle) => {
            if (error || !bundle) {
                reject(error || new Error(`Asset Bundle 加载失败：${name}`));
                return;
            }
            resolve(bundle);
        };
        // 带远程描述符时必须传 `version`，否则引擎按构建期版本号取 config，热更资源对不上。
        if (remote) (assetManager.loadBundle as any)(source, { version: remote.version }, callback);
        else assetManager.loadBundle(source, callback);
    }).then(
        (bundle) => {
            pending.delete(name);
            return bundle;
        },
        (error: Error) => {
            pending.delete(name);
            throw error;
        },
    );
    pending.set(name, task);
    return task;
}
