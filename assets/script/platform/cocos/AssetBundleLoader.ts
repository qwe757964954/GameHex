import { assetManager, AssetManager, resources } from 'cc';
import { CocosBundleRegistry } from '../hotupdate/CocosBundleRegistry';

const RESOURCES_BUNDLE = 'resources';

/** 在途加载：同名并发只发一次 IO；成功走引擎缓存、失败允许重试。 */
const pending = new Map<string, Promise<AssetManager.Bundle>>();

/**
 * 加载 Asset Bundle 的唯一入口。远程 url/version 只在这里从热更 manifest
 * （CocosBundleRegistry）解析；别处直连 assetManager.loadBundle 会退回构建期
 * 地址，热更后的 onDemand bundle 会拿到旧包或 404，且没有报错。
 * 反向守卫见 tests/asset-bundle-entry.test.ts。
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
        // 远程描述符必须带 version，否则引擎按构建期版本号取 config，热更资源对不上。
        if (remote) assetManager.loadBundle(source, { version: remote.version }, callback);
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
