import type { Color, Graphics } from 'cc';

/** 大地图与章节地图的建筑编号气泡共用一份样式。 */
export const MAP_MARKER_BADGE_WIDTH = 88;
export const MAP_MARKER_BADGE_HEIGHT = 30;
/**
 * 字号：2026-10-28 用户「字号略微调大 15%」⇒ `15 × 1.15 = 17.25`，取整数 **17**。
 *
 * 上限：宽度不再是瓶颈（最长固定文案「章节」两字，`2 × 字号 ≤ 88` ⇒ 字号 ≤ 44），
 * 真正卡住的是高度 —— 行高必须 `≤ MAP_MARKER_BADGE_HEIGHT`(30) 且 `≥ 字号` ⇒ 字号最多 30；
 * 超了文字框装不下，`Overflow.SHRINK` 会把刚调大的字反缩回去
 * （守卫 `tests/territory-level-bubble-style.test.ts`）。
 */
export const MAP_MARKER_BADGE_FONT_SIZE = 17;
export const MAP_MARKER_BUBBLE_HEIGHT = 45;

/**
 * 编号气泡底图：**统一用蓝色那张**（`image/spawn-region/frame_03`，94×45 带小尾巴）。
 *
 * 🔴 2026-10-28 16:23 用户：「蓝色的气泡改成绿色了，改回蓝色」。
 *    `frame_01` 绿 / `frame_02` 红 是**选点界面**（`ZCSpawnRegionHintOverlay`，「红 = 前区 / 绿 = 中后区」）
 *    的语义图，被借到领地气泡上做过一版「已通关绿 / 未通关红」，用户否决 ⇒ 全部退回蓝色。
 *
 * 两个常量都指向同一张图：`PENDING` 留着是为了不打乱 `ITerritoryBattleArt` / `TerritoryStationView`
 * 的二选一管线，将来若要重新分色，只改这一个值即可，不必再动调用方。
 *
 * ⚠️ 别拿 `image/buildings/frame_01` 当气泡：那个**同名**文件是首领的**红色六边形格面框**，
 *    尺寸与形状都完全不同（踩过一次，表现为气泡被拉成一张大六边形）。
 */
export const MAP_MARKER_BUBBLE_FRAME_PASSED_PATH = 'image/spawn-region/frame_03/spriteFrame';
export const MAP_MARKER_BUBBLE_FRAME_PENDING_PATH = 'image/spawn-region/frame_03/spriteFrame';

/**
 * 编号气泡的文字样式（2026-10-28 按美术效果图对齐）。
 *
 * 美术稿上的 `1-1` 有三个特征：**超粗**、**三字紧贴**、白字压黑描边。
 * 系统字体（Arial）只能靠 `isBold` + `outlineWidth`（{@link MAP_MARKER_BADGE_OUTLINE_WIDTH}）逼近字重，
 * 靠 `spacingX` 逼近紧贴，字距**不能**靠字符串里塞空格 —— 空格宽度跟字号绑定，换字号就全乱。
 */
/** 行高跟字号同比：15 → 17 时 20 → 23（≈1.35×字号），且必须 `≤ MAP_MARKER_BADGE_HEIGHT`(30) */
export const MAP_MARKER_BADGE_LINE_HEIGHT = 23;
/** 负字距：Arial 数字的侧边距偏大，`1-1` 会显得松，收紧一档才接近美术稿 */
export const MAP_MARKER_BADGE_SPACING_X = -1;
/** 美术稿的笔画约占字高 25%，常规体只有 14% ⇒ 必须加粗 */
export const MAP_MARKER_BADGE_BOLD = true;
/**
 * 描边宽度（2026-10-28 用户「字体大小调粗」）。
 *
 * 系统字体只有**常规 / 加粗**两档，`isBold` 已经是上限；17 号字要再厚一档，
 * 只能加厚白字压着的黑描边（描边吃掉的是字形外缘，视觉上等于笔画变粗）。
 * `2 → 3`：再厚就会糊掉 `1-1` 的连字符，需要更粗请换 TTF 字重而不是继续加描边。
 *
 * ⚠️ 这个值**必须由代码覆盖**（`renderLevelBubble`）：prefab 里 `BadgeLabel` 的 2 是旧角标口径，
 *    只改 prefab 会在运行时被这里盖掉 —— 两处要一起改。
 */
export const MAP_MARKER_BADGE_OUTLINE_WIDTH = 3;
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
