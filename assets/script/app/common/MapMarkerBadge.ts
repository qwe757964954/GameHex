import type { Color, Graphics } from 'cc';

/** 大地图与章节地图的建筑编号气泡共用一份样式。 */
export const MAP_MARKER_BADGE_WIDTH = 88;
export const MAP_MARKER_BADGE_HEIGHT = 30;
export const MAP_MARKER_BADGE_FONT_SIZE = 15;
export const MAP_MARKER_BUBBLE_FRAME_PATH = 'image/spawn-region/frame_03/spriteFrame';
export const MAP_MARKER_BUBBLE_HEIGHT = 45;

/**
 * 编号气泡的文字样式（2026-10-28 按美术效果图对齐）。
 *
 * 美术稿上的 `1-1` 有三个特征：**超粗**、**三字紧贴**、白字压黑描边。
 * 系统字体（Arial）只能靠 `isBold` 逼近字重，靠 `spacingX` 逼近紧贴，
 * 字距**不能**靠字符串里塞空格 —— 空格宽度跟字号绑定，换字号就全乱。
 */
export const MAP_MARKER_BADGE_LINE_HEIGHT = 20;
/** 负字距：Arial 数字的侧边距偏大，`1-1` 会显得松，收紧一档才接近美术稿 */
export const MAP_MARKER_BADGE_SPACING_X = -1;
/** 美术稿的笔画约占字高 25%，常规体只有 14% ⇒ 必须加粗 */
export const MAP_MARKER_BADGE_BOLD = true;
/** 文字相对气泡中心的抬升，给底部小尾巴让位 */
export const MAP_MARKER_BADGE_TEXT_Y = 5;

export function mapMarkerBadgeY(visibleTop: number, height = MAP_MARKER_BADGE_HEIGHT): number {
    return visibleTop + height / 2 + 3;
}

export function paintMapMarkerBadge(graphics: Graphics, tint: Color, outline: Color): void {
    graphics.clear();
    graphics.fillColor = tint;
    graphics.strokeColor = outline;
    graphics.lineWidth = 2;
    graphics.roundRect(-MAP_MARKER_BADGE_WIDTH / 2, -MAP_MARKER_BADGE_HEIGHT / 2,
        MAP_MARKER_BADGE_WIDTH, MAP_MARKER_BADGE_HEIGHT, 8);
    graphics.fill();
    graphics.stroke();
}
