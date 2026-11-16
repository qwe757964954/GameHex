/**
 * 固定奖励宝箱气泡的底图与排版（纯常量 + 纯函数，零 cc）。
 *
 * 气泡底图为 `frame_04`（77×87 竖向水滴），内容为图标在上、数字在下两行，
 * 与章节编号的 94×45 横向胶囊不是同一套排版。
 */

/** 宝箱气泡底图（`frame_04`）。 */
export const TERRITORY_CHEST_BUBBLE_FRAME_PATH = 'image/spawn-region/frame_04/spriteFrame';

/** 底图自然尺寸，按原尺寸渲染，缩放会让描边发虚。 */
export const TERRITORY_CHEST_BUBBLE_WIDTH = 77;
export const TERRITORY_CHEST_BUBBLE_HEIGHT = 87;

/** 内部图标边长。 */
export const TERRITORY_CHEST_BUBBLE_ICON_SIZE = 36;
/** 图标中心相对气泡中心的抬升。 */
export const TERRITORY_CHEST_BUBBLE_ICON_Y = 17;
/** 数字中心相对气泡中心的偏移。 */
export const TERRITORY_CHEST_BUBBLE_TEXT_Y = -17;
/** 数字字号与行高。 */
export const TERRITORY_CHEST_BUBBLE_FONT_SIZE = 24;
export const TERRITORY_CHEST_BUBBLE_LINE_HEIGHT = 27;
/** 数字颜色：深棕，奶白底上白字不可读。 */
export const TERRITORY_CHEST_BUBBLE_TEXT_COLOR: readonly [number, number, number] = [0x5a, 0x3a, 0x1e];
/**
 * 数字描边宽度与颜色，用于补足字重。
 * 1px 可让笔画接近美术稿，加到 2px 会糊。
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
