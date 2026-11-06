import { FRAME_ART_ROOT, spriteFramePath } from '../ArtPaths';

/**
 * 通用品质框（`image/frame/common_img_pzk_01..04`）。
 *
 * 实测颜色：`01` 金 / `02` 紫 / `03` 绿 / `04` 蓝 —— 与卡牌品级表的 `frame` 列同一批图。
 * 七日 / 活动 / 礼包 / 战令 / 挂机 / 首充 / OS 排行榜共用本模块；
 * 卡牌卡框走 `cardUiArtRarity.frame`（业务映射），这里按框档直取（通用 UI 资源），两者不互为配置。
 */
export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

export const QUALITY_FRAME_LEVELS = 4;

export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);

/** 框档（1..4）→ 资源名；越界钳到 1..4。 */
export function qualityFrameNameOfLevel(level: number): string {
    return QUALITY_FRAME_NAMES[Math.min(QUALITY_FRAME_LEVELS, Math.max(1, Math.floor(level))) - 1];
}

/** 物品品质档 → 框档（1..4）：`clamp(floor(q) - 1, 1, 4)`。 */
export function qualityFrameLevel(quality: number): number {
    const raw = Math.floor(quality) - 1;
    return Math.min(QUALITY_FRAME_LEVELS, Math.max(1, raw > 0 ? raw : 1));
}

/** 物品品质档 → 框资源名（不带扩展名）。 */
export function qualityFrameName(quality: number): string {
    return qualityFrameNameOfLevel(qualityFrameLevel(quality));
}

/** 品质框的 `resources.load` 路径。 */
export function qualityFramePath(quality: number): string {
    return spriteFramePath(QUALITY_FRAME_ROOT, qualityFrameName(quality));
}
