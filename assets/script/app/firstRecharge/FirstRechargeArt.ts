/**
 * 首充礼包道具展示：品质框。
 * 物品图标按物品表 icon 路径直接加载，见 CardLineupIcons.loadIconByArtPath。
 */

import { FRAME_ART_ROOT } from '../ArtPaths';

export interface IFirstRechargeItemInfo {
    readonly resId: number;
    readonly name: string;
    /** 物品图标在 resources 下的直接路径（icons/ 开头）；空 = 无图。 */
    readonly icon: string;
    readonly quality: number;
}

const QUALITY_FRAME_LEVELS = 4;

/** 品质档 → 框档（1..4）。 */
function qualityFrameLevel(quality: number): number {
    const raw = Math.floor(quality) - 1;
    return Math.min(QUALITY_FRAME_LEVELS, Math.max(1, raw > 0 ? raw : 1));
}

export function qualityFrameName(quality: number): string {
    return `common_img_pzk_0${qualityFrameLevel(quality)}`;
}

export const QUALITY_FRAME_ROOT = FRAME_ART_ROOT;

/** 全部品质框资源名（恰好 4 张）。 */
export const QUALITY_FRAME_NAMES: readonly string[] = Array.from(
    { length: QUALITY_FRAME_LEVELS },
    (_unused, index) => `common_img_pzk_0${index + 1}`,
);
