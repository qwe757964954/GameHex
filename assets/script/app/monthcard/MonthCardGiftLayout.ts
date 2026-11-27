/**
 * 月卡礼包版面公式 —— 纯逻辑，不 import cc，可单测。
 * 把 FairyGUI「左上角原点、y 向下」坐标换算成 Cocos「中心原点、y 向上」。
 * 逐元素坐标已迁入 `MonthCardGift.prefab`，本文件只保留列表排布与条目参数公式。
 */

import { fguiAnchorToCocos, fguiTopLeftToCocos } from '../../core/layout/FguiLayout';

/** 条目本体尺寸。 */
export const MONTHCARD_ENTRY_WIDTH = 633;
export const MONTHCARD_ENTRY_HEIGHT = 380;

/** 外层列表尺寸。 */
export const MONTHCARD_LIST_WIDTH = 711;
export const MONTHCARD_LIST_HEIGHT = 756;

export const MONTHCARD_ENTRY_STRIDE = MONTHCARD_ENTRY_HEIGHT;

export const MONTHCARD_MAX_PRIVILEGE_ROWS = 5;
export const MONTHCARD_MAX_DAY_REWARD_SLOTS = 4;

export interface ILayoutPoint {
    readonly x: number;
    readonly y: number;
}

/** FGUI 坐标换算实现归位 `core/layout/FguiLayout`；旧导出名保留。 */
export { fguiAnchorToCocos, fguiTopLeftToCocos };

// ============================================================
// 条目内部各元素坐标（父容器 = 条目 633×380）
// ============================================================
// 逐元素的坐标/尺寸已由 `MonthCardGift.prefab` 与 `cc.Layout` 接管，
// 这里只保留仍参与公式的条目参数；测试对齐数值在 `tests/fixtures/monthcard-gift-layout.ts`。

export const MONTHCARD_SP_SIZE = { width: 172, height: 127 } as const;

/** spine 恒为 scale 1（老端原样渲染，172×127 只是编辑器占位框）。 */
export const MONTHCARD_SP_SCALE = 1;

/** spine 骨架 setup bounds 边长（不是渲染尺寸，仅留作排查出处）。 */
export const MONTHCARD_SP_BBOX = 1238.4;

/** 未购买态按钮；y 要叠加 layoutDy。 */
export const MONTHCARD_BUY_POS = fguiTopLeftToCocos(402, 259, 166, 61, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

/** 续费态按钮：只挪位置，尺寸仍 166×61。 */
export const MONTHCARD_RENEW_POS = fguiTopLeftToCocos(406, 292, 166, 61, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

/** 已购买角标；y 要叠加 boughtTagDy。 */
export const MONTHCARD_BOUGHT_TAG_POS = fguiTopLeftToCocos(-23, 14, 119, 74, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

export const MONTHCARD_TIME_POS = fguiAnchorToCocos(483, 263, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

/** 有效期说明；y 要叠加 layoutDy。 */
export const MONTHCARD_DESC_POS = fguiTopLeftToCocos(377, 215, 214, 33, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

export const MONTHCARD_PRIVILEGE_LIST_SIZE = { width: 300, height: 155 } as const;
export const MONTHCARD_PRIVILEGE_ROW_SIZE = { width: 240, height: 34 } as const;

/** 每日奖励列表的容器尺寸（`DayList` 的 `cc.Layout` 视窗）。 */
export const MONTHCARD_DAY_LIST_SIZE = { width: 350, height: 80 } as const;

/** 卡名坐标随类型不同。 */
export const MONTHCARD_TITLE_POS: Readonly<Record<number, ILayoutPoint>> = {
    1: fguiTopLeftToCocos(199, 3, 227, 68, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT),
    2: fguiTopLeftToCocos(202, 9, 227, 68, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT),
};

// ============================================================
// 列表排布
// ============================================================

/** 第 index 个条目在容器里的位置（居中、纵向步进）。 */
export function entryPosition(index: number): ILayoutPoint {
    return {
        x: 0,
        y: MONTHCARD_LIST_HEIGHT / 2 - MONTHCARD_ENTRY_HEIGHT / 2 - index * MONTHCARD_ENTRY_STRIDE,
    };
}
