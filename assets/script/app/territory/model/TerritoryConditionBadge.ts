/**
 * 固定资源格条件标注的竖直排版（纯常量 + 纯函数，零 cc）。
 *
 * 可激活状态下，宝箱图标在上、银币图标与数字在下，两行整体绕格心居中；
 * 没有宝箱图标时退回单行，价格行必须保持零偏移，避免池化节点串版。
 */

/** 宝箱图标与价格行之间的间距（像素）。 */
export const TERRITORY_CONDITION_CHEST_GAP = 1;

/** 宝箱图标的显示缩放。 */
export const TERRITORY_CONDITION_CHEST_SCALE = 0.95;

/**
 * 条件标注与格面边缘的最小留白（像素）。
 *
 * 整块按格面 123×90 竖直居中，实际留白由块高反推；1px 是验收下限。
 */
export const TERRITORY_CONDITION_FACE_MIN_MARGIN = 1;

/** 一块条件标注的纵向布局（全部相对格心，正 = 上）。 */
export interface ITerritoryConditionBlock {
    /** 价格行（银币 icon + 数字）中心相对格心的偏移；没有宝箱时恒为 0。 */
    readonly rowY: number;
    /** 宝箱 icon 中心相对格心的偏移；没有宝箱时恒为 0（调用方据此跳过落位）。 */
    readonly chestY: number;
    /** 两行合起来的高度（没有宝箱时 = 价格行高度）。 */
    readonly height: number;
}

/**
 * 算条件标注的纵向布局。
 *
 * @param rowHeight 价格行高度（取展开后的值）
 * @param chestHeight 宝箱图标高度；`<= 0` 表示没有宝箱图标
 */
export function territoryConditionBlockLayout(
    rowHeight: number,
    chestHeight: number,
): ITerritoryConditionBlock {
    const row = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;
    const chest = Number.isFinite(chestHeight) && chestHeight > 0 ? chestHeight : 0;
    if (chest === 0) return { rowY: 0, chestY: 0, height: row };
    const height = chest + TERRITORY_CONDITION_CHEST_GAP + row;
    return {
        rowY: -height / 2 + row / 2,
        chestY: height / 2 - chest / 2,
        height,
    };
}
