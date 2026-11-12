/**
 * 「未解锁格条件标注」的竖直排版（零 `cc`，纯常量 + 纯函数）。
 *
 * 需求（2026-11-10 用户，附美术效果图）：
 *
 * > 「当固定格资源处于可激活状态时，除了展示银币 icon + 数字外，**新增宝箱 icon 展示**，
 * >  宝箱 icon 使用美术资源 `icon_baoxiang`，整个格子的排版参照美术效果图。
 * >  当银币不足，只有数字 UI 显示红色的逻辑不变。固定格未解锁，仍然只显示锁 icon。」
 *
 * ## 排版长什么样
 *
 * 美术图里宝箱格是**上下两行**：宝箱 icon 在上，`银币 icon + 数字` 在下，
 * 两行合成一块、在格心**整体居中**。原来的「银币 + 数字」只有一行（横向并排、整对居中），
 * 现在多一颗宝箱，就多一件事要算：这块两行有多高、每行各自往哪挪。
 *
 * ## 为什么退化成一行时必须是**零偏移**
 *
 * 站点节点是**池化复用**的（见 `TerritoryStationView` 头注释），同一个节点这一秒画宝箱格、
 * 下一秒可能画关卡格。`chestHeight <= 0`（没有宝箱图标）时这里返回 `rowY = 0`，
 * 与旧版「价格行中心压格心」逐像素一致 —— 非宝箱格的排版**一个像素都不许跟着动**。
 *
 * 反过来 `chestHeight > 0` 时，价格行整体下移 `(宝箱高 + 间距) / 2`、宝箱上抬同样的量，
 * 两行仍然关于格心对称（美术图里那块就是居中的，不是贴着格子下沿）。
 *
 * ## 尺寸约束（2026-11-10 第二轮）
 *
 * 整块必须落在格面 123×90 内、且与边缘至少留 {@link TERRITORY_CONDITION_FACE_MIN_MARGIN} 像素。
 * 当前配数：宝箱 45×0.95 = 42.75 + 间距 1 + 价格行 40×0.85 = 34 ⇒ **块高 77.75**，
 * 上下各留 6.1px。验收用例会按真实常量重算这条，改任何一个常量它都会红。
 */

/**
 * 宝箱 icon（`icon_baoxiang`，58×45）与下方价格行之间的间距（像素）。
 *
 * 2026-11-10 第二轮：2 → **1**。用户口径「宝箱 icon 和银币和数字行的间隙可以再小点，不重叠就行」——
 * 1px 就是「不重叠」的下限，再小会在大屏上被 subpixel 抹成一坨。
 */
export const TERRITORY_CONDITION_CHEST_GAP = 1;

/**
 * 宝箱 icon 的显示缩放（需求原文：「宝箱缩小成 **0.95** 比例」）。
 *
 * 58×45 × 0.95 = 55.1×**42.75**。这一档是**用户点名的**，别再"顺手凑整"到 1 或 0.9 ——
 * 整块高度直接吃这个数（见 {@link territoryConditionBlockLayout} 的调用方）。
 */
export const TERRITORY_CONDITION_CHEST_SCALE = 0.95;

/**
 * 条件标注与格面边缘的最小留白（像素）。
 *
 * 用户口径（2026-11-10 第二轮）：「保证所有 icon 和 UI 都在格子内，且和格子边缘留有 1~像素的间距」。
 * 格面 123×90（`HEX_GRID_FACE_WIDTH/HEIGHT`，以格心为中心），整块**竖直居中** ⇒ 上下留白相等；
 * 实际值由整块高度反推：`(90 − 块高) / 2`，只要 ≥ 本值就算达标。
 *
 * ⚠️ 这是**验收下限**，不是配数目标：调大 icon / 调小间距之前先跑
 * `tests/territory-condition-chest.test.ts` 的「都在格面内」那条，别把留白吃到 1px 以下。
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
 * 算一块条件标注的纵向布局。
 *
 * @param rowHeight 价格行高度（银币图标可见高 × 1.1；取**展开后**的值，与横向「位置按展开宽度摆」
 *                  同一条口径 —— 生成动画期间不动版）
 * @param chestHeight 宝箱图标高度（**未乘**生成缩放）；`<= 0` = 这一格没有宝箱图标
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
