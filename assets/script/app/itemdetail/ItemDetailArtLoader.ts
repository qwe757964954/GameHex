import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { spriteFramePathOf } from '../ArtPaths';
import { ID_ART_NAMES, qualityFrameArtPath, titleArtPathOf } from './ItemDetailArt';

/** 物品详情图的根（`ID_ART_NAMES` 的 value 是**相对 `assets/resources/image/`** 的路径）。 */
export const ID_ART_ROOT = 'image';

/** 相对 `image/` 的路径 → `resources.load` 用的装配路径。 */
export function idFramePathOf(rel: string): string {
    return spriteFramePathOf(`${ID_ART_ROOT}/${rel}`);
}

const cache = createRoutedSpriteFrameCache('ItemDetailArt');

/** 按**相对 `image/` 的路径**取图（动态图与表内图共用一条链）。 */
export function loadIdArtByRel(rel: string): Promise<SpriteFrame | null> {
    if (!rel) return Promise.resolve(null);
    return cache.load(idFramePathOf(rel));
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
    return cache.load(iconPath);
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
    return cache.peek(idFramePathOf(rel));
}

/** 清缓存（测试用）；运行时**不要**调 —— 会把已 `addRef()` 的图丢掉引用来源。 */
export function resetIdArtCacheForTest(): void {
    cache.clear();
}
