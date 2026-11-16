/**
 * 「领地宝箱开启」奖励页的美术选图（零 `cc`，测试可直接 import）。
 *
 * 设计稿只出 4 张卡框（橙 / 紫 / 绿 / 蓝），工程品质序有 8 档
 * （`ItemDetailTable`：1 白 / 2 绿 / 3 蓝 / 4 紫 / 5 橙 / 6 红 / 7 金 / 8 将）。
 * 映射按「档次归并」：
 *
 * ```
 * q ≥ 5（橙 / 红 / 金 / 将）→ frameOrange
 * q = 4（紫）              → framePurple
 * q = 3（蓝）              → frameBlue
 * q ≤ 2（白 / 绿）         → frameGreen   ← 白色没有对应切图，降级绿框
 * ```
 *
 * ⚠️ 白档降级到绿框是**有意的**：白框切图不存在，退回最低档的绿比「不画框」稳
 * （奖励表里 `quality` 解析不出时也会落到 1，同样走绿框）。
 */
import {
    TERRITORY_CHEST_OPEN_ARTS,
    TERRITORY_CHEST_OPEN_BG_ART_ROOT,
    TERRITORY_CHEST_OPEN_ART_ROOT,
    spriteFramePath,
} from '../../ArtPaths';

export const CHEST_OPEN_FRAME_ORANGE = TERRITORY_CHEST_OPEN_ARTS.frameOrange;
export const CHEST_OPEN_FRAME_PURPLE = TERRITORY_CHEST_OPEN_ARTS.framePurple;
export const CHEST_OPEN_FRAME_GREEN = TERRITORY_CHEST_OPEN_ARTS.frameGreen;
export const CHEST_OPEN_FRAME_BLUE = TERRITORY_CHEST_OPEN_ARTS.frameBlue;

/** 品质 → 卡框切图名（不透明档都归并到最近的一档）。 */
export function chestOpenCardFrameNameOf(quality: number): string {
    if (quality >= 5) return CHEST_OPEN_FRAME_ORANGE;
    if (quality === 4) return CHEST_OPEN_FRAME_PURPLE;
    if (quality === 3) return CHEST_OPEN_FRAME_BLUE;
    return CHEST_OPEN_FRAME_GREEN;
}

/**
 * 切图名 → 可 load 的 SpriteFrame 装配路径（`<root>/<name>/spriteFrame`）。
 *
 * 底图单独在 `image/` 根（大图不进图集），其余 6 张在 `image/territory/chest_open/`。
 */
export function chestOpenArtPathOf(name: string): string {
    const root = name === TERRITORY_CHEST_OPEN_ARTS.bg
        ? TERRITORY_CHEST_OPEN_BG_ART_ROOT
        : TERRITORY_CHEST_OPEN_ART_ROOT;
    return spriteFramePath(root, name);
}
