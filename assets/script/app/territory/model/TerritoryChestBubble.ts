/**
 * 固定奖励宝箱气泡的**底图与排版**（零 cc，纯常量 + 纯函数）。
 *
 * 需求（2026-11-02 用户，附美术资源树截图）：
 *
 * > 「宝箱的气泡框使用新的美术资源 `frame_04`，图标内 icon 和数字的排版参考 screenshot-2 的美术图」
 *
 * ## 为什么不能沿用「章节」气泡那套横向公式
 *
 * | | 章节 / 关卡编号气泡 | 宝箱提示气泡（本文档） |
 * | --- | --- | --- |
 * | 底图 | `frame_03` 蓝 / `frame_02` 红，**94×45 横向胶囊** | `frame_04`，**77×87 竖向水滴**（尖朝下指着宝箱） |
 * | 内容 | 只有一行编号（`1-1` / `章节` / `PVP`） | **上下两行**：上 icon、下数字 |
 * | 排版 | 图标与数字**并排**、整对居中（`LEVEL_BUBBLE_ICON_*`） | 图标在上、数字在下，各自**水平居中** |
 *
 * 两张图的尺寸、形状、内容行数都不同 ⇒ 横向那套「总宽 = 图标宽 + 间距 + 数值宽」在这里无意义，
 * 硬套会把数字挤到水滴的尖端外面（那里只有 12px 宽）。
 *
 * ## 数值怎么来的
 *
 * 底图自然尺寸 77×87（`frame_04.png` 实测）。人工核对过 alpha 逐行宽度：
 * 最宽 77 在 y≈24~48（图的坐标系，原点左上），往下收成尖；对应节点坐标（原点居中）
 * 就是「圆心在 y≈+7，尖端在 y=−43.5」。
 *
 *  - **icon 36**：约占气泡宽 47%，与美术稿里肉块占水滴宽度的比例一致。
 *    2026-11-02 第二轮用户口径「体力 icon 放大 5%」⇒ 旧值 34 × 1.05 = 35.7，取整 **36**。
 *  - **icon 中心 y = +17**：图标须落在最宽那一段（此处 alpha 宽 ≥ 65），不会顶到圆顶；
 *    36 的图标在此处占 y −1 ~ +35，最上一行（y=+35）对应 PNG 第 9 行、alpha 宽 53 ≥ 36 ✓。
 *  - **数字中心 y = −17**：数字包围盒（含描边）约占 y −3 ~ −31（PNG 第 47~75 行），
 *    `12` 这种两位数（含描边 ≈ 33 宽）在第 75 行（alpha 宽 33）刚好放得下；
 *    再往下就会压到尖端。
 *  - **字号 24**：美术稿里 `12` 的字高约占气泡内区 20%（实测 10px / 51px），
 *    按此比例反推 `87 × 0.20 ÷ 0.716(Arial 字高比) ≈ 24`。
 *  - **描边 1**：补字重（见 {@link TERRITORY_CHEST_BUBBLE_OUTLINE_WIDTH}）。
 *
 * ⚠️ 数字**不能再用白字**：底图是奶白 `#F8F0E0`，白字等于没字。改深棕（美术稿同色系）。
 */

/** 宝箱气泡底图：`image/spawn-region/frame_04`（bundle 内相对路径，与章节气泡同目录）。 */
export const TERRITORY_CHEST_BUBBLE_FRAME_PATH = 'image/spawn-region/frame_04/spriteFrame';

/** 底图自然尺寸（像素）。**按原尺寸渲染，不缩放** —— 缩放会让 1px 描边发虚。 */
export const TERRITORY_CHEST_BUBBLE_WIDTH = 77;
export const TERRITORY_CHEST_BUBBLE_HEIGHT = 87;

/** 内部 icon 的边长（正方形；`图标_体力` 原图是方的，不需要按宽高比拉伸）。 */
export const TERRITORY_CHEST_BUBBLE_ICON_SIZE = 36;
/** icon 中心相对气泡中心的抬升（正 = 上）。 */
export const TERRITORY_CHEST_BUBBLE_ICON_Y = 17;
/** 数字中心相对气泡中心的偏移（负 = 下）。 */
export const TERRITORY_CHEST_BUBBLE_TEXT_Y = -17;
/** 数字字号 / 行高（行高 ≥ 字号，否则 `SHRINK` 会把字缩回去）。 */
export const TERRITORY_CHEST_BUBBLE_FONT_SIZE = 24;
export const TERRITORY_CHEST_BUBBLE_LINE_HEIGHT = 27;
/**
 * 数字颜色：深棕 `#5A3A1E`（与美术稿的 `12` 同色系）。
 *
 * 底图是奶白，**白字看不见**；也不用纯黑 —— 纯黑在暖白底上比美术稿硬一档。
 */
export const TERRITORY_CHEST_BUBBLE_TEXT_COLOR: readonly [number, number, number] = [0x5a, 0x3a, 0x1e];
/**
 * 描边宽度（像素）与描边色 —— **补字重**用，不是装饰。
 *
 * ## 为什么要描边
 *
 * 2026-11-02 第二轮用户口径：「体力 icon 放大 5%，字体样式也要匹配原来的大小和粗细」。
 * 逐像素比对美术稿（`frame_04` 那张 77×87 的成品图 + 参考截图）与实机截图后，
 * 差距**不在字号**而在笔画：美术稿的 `12` 笔画约占字高 25%（项目里那条既有口径，
 * 见 `MapMarkerBadge` 的注释），实机只有约 12% —— 系统字体 `isBold` 到顶也只有
 * 「常规 / 加粗」两档，单靠它补不满。
 *
 * ⇒ 与编号气泡同一套做法：`isBold` 之后再叠一圈**同色系更深的描边**把笔画吃厚
 * （描边色 `#3A2410` 比文字色深一档，避免描边看起来像"发黑的边框"）。
 *
 * 宽度取 **1** 而不是 2：24 号字涨到 2 会把 `12` 糊成一团（实测合成图对照美术稿，
 * 2 明显偏粗）；1 之后笔画约占字高 24%，与美术稿的 ~25% 基本对齐。
 *
 * ⚠️ 描边会向外扩 `2×宽度`，排版余量必须按它算（`tests/territory-chest-bubble`
 *   的几何判据把描边计进数字的包围盒）。
 */
export const TERRITORY_CHEST_BUBBLE_OUTLINE_WIDTH = 1;
export const TERRITORY_CHEST_BUBBLE_OUTLINE_COLOR: readonly [number, number, number] = [0x3a, 0x24, 0x10];

/** 一整套排版（视图只读这一份，别在视图里再写一遍数字）。 */
export interface ITerritoryChestBubbleLayout {
    readonly width: number;
    readonly height: number;
    readonly iconSize: number;
    readonly iconY: number;
    readonly textY: number;
    readonly fontSize: number;
    readonly lineHeight: number;
    /** 数字颜色 `[r, g, b]`（0~255）。 */
    readonly textColor: readonly [number, number, number];
    /** 描边宽度（像素；`0` = 不描边）。 */
    readonly outlineWidth: number;
    /** 描边颜色 `[r, g, b]`（0~255）。 */
    readonly outlineColor: readonly [number, number, number];
}

export function territoryChestBubbleLayout(): ITerritoryChestBubbleLayout {
    return {
        width: TERRITORY_CHEST_BUBBLE_WIDTH,
        height: TERRITORY_CHEST_BUBBLE_HEIGHT,
        iconSize: TERRITORY_CHEST_BUBBLE_ICON_SIZE,
        iconY: TERRITORY_CHEST_BUBBLE_ICON_Y,
        textY: TERRITORY_CHEST_BUBBLE_TEXT_Y,
        fontSize: TERRITORY_CHEST_BUBBLE_FONT_SIZE,
        lineHeight: TERRITORY_CHEST_BUBBLE_LINE_HEIGHT,
        textColor: TERRITORY_CHEST_BUBBLE_TEXT_COLOR,
        outlineWidth: TERRITORY_CHEST_BUBBLE_OUTLINE_WIDTH,
        outlineColor: TERRITORY_CHEST_BUBBLE_OUTLINE_COLOR,
    };
}
