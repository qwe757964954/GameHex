/**
 * 物品详情模块美术的**加载层**（表在 `ItemDetailArt.ts`，这里只管缓存 + `resources.load`）。
 *
 * 分两层的原因（**别合并回去**）：`ItemDetailArt.ts` 是纯数据、零 `cc`，
 * `tests/itemdetail.test.ts` 才能直接 import 它做「映射 ↔ 磁盘文件」双向对账；
 * 一旦那边出现 `import { resources } from 'cc'`，整组用例 `Cannot find module 'cc'` 静默失效。
 *
 * ⚠️ 缓存**必须** `addRef()`（项目规则 81）：模块级 `Map` 不参与引用计数，
 * `SpriteFrame.refCount` 停在 0 会被 `ReleaseManager._freeAssets()` 直接 `destroy()`，
 * 而 `cc.Sprite._spriteFrame` 仍指着它 ⇒ 下次标脏渲染炸
 * `Simple.updateUVs: Cannot read properties of null (reading '0')`
 * （只在重新渲染那一刻炸，看着像别的模块的锅）。
 */
import { resources, SpriteFrame } from 'cc';
import { spriteFramePathOf } from '../ArtPaths';
import { ID_ART_NAMES, qualityFrameArtPath, titleArtPathOf } from './ItemDetailArt';

/** 物品详情图的根（`ID_ART_NAMES` 的 value 是**相对 `assets/resources/image/`** 的路径）。 */
export const ID_ART_ROOT = 'image';

/** 相对 `image/` 的路径 → `resources.load` 用的装配路径。 */
export function idFramePathOf(rel: string): string {
    return spriteFramePathOf(`${ID_ART_ROOT}/${rel}`);
}

const cache = new Map<string, SpriteFrame>();
const pending = new Map<string, Promise<SpriteFrame | null>>();
let generation = 0;

/**
 * 内部实现：`key` 作缓存键、`path` 作 `resources.load` 的装配路径。
 *
 * ⚠️ 两条口径的键空间**不重叠**（`image/` 侧的键形如 `itemdetail/id_panel_bg`，
 * `resources/` 侧形如 `icons/item/xxx`），才能共用一个 `Map` 不串图。
 */
function loadByPath(key: string, path: string): Promise<SpriteFrame | null> {
    const cached = cache.get(key);
    if (cached?.isValid) return Promise.resolve(cached);
    if (cached) cache.delete(key);
    const running = pending.get(key);
    if (running) return running;

    const mark = generation;
    const task = new Promise<SpriteFrame | null>((resolve) => {
        resources.load(path, SpriteFrame, (error, frame) => {
            if (error || !frame || !frame.isValid) {
                console.warn(`[ItemDetailArt] 加载失败：${path}`, error);
                resolve(null);
                return;
            }
            if (mark !== generation) {
                resolve(null);
                return;
            }
            frame.addRef();
            cache.set(key, frame);
            resolve(frame);
        });
    });
    pending.set(key, task);
    const clear = (): void => {
        if (pending.get(key) === task) pending.delete(key);
    };
    void task.then(clear, clear);
    return task;
}

/** 按**相对 `image/` 的路径**取图（动态图与表内图共用一条链）。 */
export function loadIdArtByRel(rel: string): Promise<SpriteFrame | null> {
    if (!rel) return Promise.resolve(null);
    return loadByPath(rel, idFramePathOf(rel));
}

/**
 * 物品图标（`item.icon`）。
 *
 * ⚠️ **与 `ID_ART_NAMES` 不是同一条路径口径**：那张表的 value 是相对
 * `assets/resources/image/`，而 `item.icon` 存的是**相对 `assets/resources/`**
 * 的完整路径（如 `icons/item/图标_兵书随机`）—— 所以这里不能走 `idFramePathOf`。
 * `spriteFramePathOf` 本身是幂等的（已带 `/spriteFrame` 不会拼第二次）。
 */
export function loadItemIconArt(iconPath: string): Promise<SpriteFrame | null> {
    if (!iconPath) return Promise.resolve(null);
    return loadByPath(iconPath, spriteFramePathOf(iconPath));
}

/** 按 `ID_ART_NAMES` 的 key 取图。 */
export function loadIdArt(key: string): Promise<SpriteFrame | null> {
    const rel = ID_ART_NAMES[key];
    if (!rel) {
        console.warn(`[ItemDetailArt] 没有 key ${key}`);
        return Promise.resolve(null);
    }
    return loadIdArtByRel(rel);
}

/** 品质缎带（`quality` 1..7 ⇒ gray..caise）。 */
export function loadTitleArt(titleStep: string): Promise<SpriteFrame | null> {
    return loadIdArtByRel(titleArtPathOf(titleStep));
}

/** 品质框（`quality` 1..8 ⇒ `cu_quality_01`..`08`）。 */
export function loadQualityFrameArt(suffix: string): Promise<SpriteFrame | null> {
    return loadIdArtByRel(qualityFrameArtPath(suffix));
}

/** 批量预加载（失败的记 `null`，调用方按 `null` 留白）。 */
export async function loadIdArtAll(keys: readonly string[]): Promise<Map<string, SpriteFrame | null>> {
    const out = new Map<string, SpriteFrame | null>();
    await Promise.all(keys.map(async (key) => {
        out.set(key, await loadIdArt(key));
    }));
    return out;
}

/** 已有缓存（不触发加载）。 */
export function peekIdArt(key: string): SpriteFrame | null {
    const rel = ID_ART_NAMES[key];
    if (!rel) return null;
    const cached = cache.get(rel);
    return cached?.isValid ? cached : null;
}

/** 清缓存（测试用）；运行时**不要**调 —— 会把已 `addRef()` 的图丢掉引用来源。 */
export function resetIdArtCacheForTest(): void {
    generation += 1;
    for (const frame of cache.values()) {
        if (frame.isValid) frame.decRef();
    }
    cache.clear();
    pending.clear();
}
