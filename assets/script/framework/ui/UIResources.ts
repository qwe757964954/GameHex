/**
 * UIResources — UI prefab 加载 / 释放工具
 * ------------------------------------------------------------------
 * 统一从 `resources/ui/<path>` 加载 prefab 并缓存。
 *
 * 关键点：
 *  1. CC 3.x 的 `resources.load()` 只接受相对 resources/ 的路径（如 `'ui/uidemo/UIDemoLayer'`）
 *  2. 加载完成回调签名是 (err, asset)，不是 Promise —— 本类同时提供 `loadAsync` 包一层
 *  3. 缓存以最终 URL 为 key，避免重复 load
 *  4. `releasePrefab` 用 `resources.release(url)` 释放底层资源
 *
 *  本文件原先 import 旧 UI 框架的 `UIDef`（只为了拿 `UI_RESOURCE_ROOT` 常量）。
 *    旧框架下线后前缀常量就地定义，本文件现在**只依赖 cc**。
 * ------------------------------------------------------------------
 */
import { Prefab, resources } from 'cc';

/** UI prefab 在 resources/ 下的统一根目录。 */
export const UI_RESOURCE_ROOT = 'ui';

type LoadPrefabCb = (err: Error | null, prefab: Prefab | null) => void;

export class UIResources {

    private static _cache: Map<string, Prefab> = new Map();

    /**
     * 加载 UI prefab（自动加 'ui/' 前缀，自动缓存）。回调风格，对齐 CC 3.x。
     * @param path 业务给的 prefab 相对路径，如 'uidemo/ListTab'
     * @param cb   (err, prefab) 完成回调
     */
    public static loadPrefab(path: string, cb: LoadPrefabCb): void {
        const url = this.resolveUrl(path);

        const cached = this._cache.get(url);
        if (cached) {
            cb(null, cached);
            return;
        }

        resources.load(url, Prefab, (err, asset) => {
            if (err || !asset) {
                cb(err || new Error(`UIResources: ${url} 加载结果为空`), null);
                return;
            }
            this._cache.set(url, asset as Prefab);
            cb(null, asset as Prefab);
        });
    }

    /**
     * Promise 版加载，写 async 流程时比回调版顺手。
     * 失败只返回 null（错误已打日志），调用方判空即可。
     */
    public static loadAsync(path: string): Promise<Prefab | null> {
        return new Promise<Prefab | null>((resolve) => {
            this.loadPrefab(path, (err, prefab) => {
                if (err || !prefab) {
                    console.error(`[UIResources] 加载 ${path} 失败:`, err && err.message);
                    resolve(null);
                    return;
                }
                resolve(prefab);
            });
        });
    }

    /** 释放单个 prefab（缓存也一并清掉）。 */
    public static releasePrefab(path: string): void {
        const url = this.resolveUrl(path);
        if (!this._cache.has(url)) return;
        resources.release(url);
        this._cache.delete(url);
    }

    /** 释放所有缓存的 UI prefab。 */
    public static releaseAll(): void {
        this._cache.forEach((_prefab, url) => {
            resources.release(url);
        });
        this._cache.clear();
    }

    /** 给相对路径加上 'ui/' 前缀（已经带前缀的就不再加）。 */
    public static resolveUrl(path: string): string {
        if (!path) return '';
        if (path.startsWith(`${UI_RESOURCE_ROOT}/`)) return path;
        return `${UI_RESOURCE_ROOT}/${path}`;
    }

    /** 测试 / 调试用：当前缓存了多少个 prefab。 */
    public static get cacheSize(): number {
        return this._cache.size;
    }
}
