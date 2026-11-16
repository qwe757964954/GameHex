import type { Color, Graphics } from 'cc';

/** 大地图与章节地图的建筑编号气泡共用一份样式。 */
export const MAP_MARKER_BADGE_WIDTH = 88;
export const MAP_MARKER_BADGE_HEIGHT = 30;

/**
 * 字号：在 15 的基础上调大 15%（15 × 1.15 ≈ 17）。
 * 高度是上限：行高必须 ≤ 30 且 ≥ 字号，超了文字框装不下，
 * `Overflow.SHRINK` 会把刚调大的字反缩回去（守卫 `tests/territory-level-bubble-style.test.ts`）。
 */
export const MAP_MARKER_BADGE_FONT_SIZE = 17;
export const MAP_MARKER_BUBBLE_HEIGHT = 45;

/**
 * 编号气泡底图按「通没通过」二选一：已通关蓝 `frame_03`，未通关红 `frame_02`。
 * 同目录的 `frame_01`（绿）不用；`frame_04` 是领地固定宝箱气泡（77×87 竖向水滴、两行排版），
 * 常量在 `TerritoryChestBubble`，别往这里搬。
 * 另外 `image/buildings/frame_01` 是同名的首领红色六边形格面框，尺寸和形状都不同，不能混用。
 */
export const MAP_MARKER_BUBBLE_FRAME_PASSED_PATH = 'image/spawn-region/frame_03/spriteFrame';
export const MAP_MARKER_BUBBLE_FRAME_PENDING_PATH = 'image/spawn-region/frame_02/spriteFrame';

/*
 * 文字样式按美术效果图对齐：`1-1` 在稿上是超粗、三字紧贴、白字压黑描边。
 * 系统字体只能靠 isBold + outlineWidth 逼近字重，靠 spacingX 逼近紧贴；
 * 不能往字符串里塞空格——空格宽度跟字号绑定，换字号就全乱。
 */
/** 行高与字号同比：15 → 17 时 20 → 23，且必须 ≤ 30 */
export const MAP_MARKER_BADGE_LINE_HEIGHT = 23;
/** 负字距：Arial 数字的侧边距偏大，`1-1` 会显得松，收紧一档才接近美术稿 */
export const MAP_MARKER_BADGE_SPACING_X = -1;
/** 美术稿的笔画约占字高 25%，常规体只有 14%，必须加粗 */
export const MAP_MARKER_BADGE_BOLD = true;
/**
 * 描边宽度。系统字体只有常规 / 加粗两档，isBold 已是上限；17 号字要再厚一档，
 * 只能加厚白字压着的黑描边（描边吃掉字形外缘，视觉上等于笔画变粗）。
 * 2 → 3 再厚就会糊掉 `1-1` 的连字符，需要更粗请换 TTF 字重。
 *
 * 这个值必须由代码覆盖（`renderLevelBubble`）：prefab 里 `BadgeLabel` 的 2 是旧角标口径，
 * 只改 prefab 会在运行时被这里盖掉，两处要一起改。
 */
export const MAP_MARKER_BADGE_OUTLINE_WIDTH = 3;
/** 文字相对气泡中心的抬升，给底部小尾巴让位 */
export const MAP_MARKER_BADGE_TEXT_Y = 5;

export function mapMarkerBadgeY(visibleTop: number, height = MAP_MARKER_BADGE_HEIGHT): number {
    return visibleTop + height / 2 + 3;
}

export function paintMapMarkerBadge(
    graphics: Graphics,
    tint: Color,
    outline: Color,
    width = MAP_MARKER_BADGE_WIDTH,
    height = MAP_MARKER_BADGE_HEIGHT,
): void {
    graphics.clear();
    graphics.fillColor = tint;
    graphics.strokeColor = outline;
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 8);
    graphics.fill();
    graphics.stroke();
}
