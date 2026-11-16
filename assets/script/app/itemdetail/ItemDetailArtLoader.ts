import type { SpriteFrame } from 'cc';
import { createRoutedSpriteFrameCache } from '../common/SpriteFrameCache';
import { spriteFramePathOf } from '../ArtPaths';
import { ID_ART_NAMES, qualityFrameArtPath, titleArtPathOf } from './ItemDetailArt';
import { qualityFrameSuffixOf } from './ItemDetailTable';

/** 物品详情图的根（`ID_ART_NAMES` 的 value 是相对 `assets/resources/image/` 的路径）。 */
export const ID_ART_ROOT = 'image';

/** 相对 `image/` 的路径 → `resources.load` 用的装配路径。 */
export function idFramePathOf(rel: string): string {
    return spriteFramePathOf(`${ID_ART_ROOT}/${rel}`);
}

const cache = createRoutedSpriteFrameCache('ItemDetailArt');

/** 按相对 `image/` 的路径取图（动态图与表内图共用一条链）。 */
export function loadIdArtByRel(rel: string): Promise<SpriteFrame | null> {
    if (!rel) return Promise.resolve(null);
    return cache.load(idFramePathOf(rel));
}

/**
 * 物品图标（`item.icon`）。
 *
 * 与 `ID_ART_NAMES` 不是同一条路径口径：那张表相对 `assets/resources/image/`，
 * 而 `item.icon` 相对 `assets/resources/`（如 `icons/item/图标_兵书随机`），
 * 所以这里不能走 `idFramePathOf`。`spriteFramePathOf` 本身幂等，已带 `/spriteFrame` 不会重复拼。
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

/** 品质档位 → 相对 `resources` 的路径（不带 `/spriteFrame`；给控制器级 loader 用）。 */
export function itemQualityFrameRelPath(quality: number): string {
    return `${ID_ART_ROOT}/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`;
}

/** 品质档位 → `resources.load` 用的完整装配路径。 */
export function itemQualityFramePathOf(quality: number): string {
    return spriteFramePathOf(itemQualityFrameRelPath(quality));
}

/** 品质档位 → 模块缓存取图。 */
export function loadItemQualityFrame(quality: number): Promise<SpriteFrame | null> {
    return cache.load(itemQualityFramePathOf(quality));
}

/** 已有缓存（不触发加载）。 */
export function peekIdArt(key: string): SpriteFrame | null {
    const rel = ID_ART_NAMES[key];
    if (!rel) return null;
    return cache.peek(idFramePathOf(rel));
}

/** 清缓存（测试用）；运行时不要调，会把已 `addRef()` 的图丢掉引用来源。 */
export function resetIdArtCacheForTest(): void {
    cache.clear();
}
