/**
 * 月卡礼包版面公式 —— 纯逻辑，不 import cc，可单测。
 * 把 FairyGUI「左上角原点、y 向下」坐标换算成 Cocos「中心原点、y 向上」。
 * prefab 数字必须与此文件对得上。
 */

/** 条目本体尺寸。 */
export const MONTHCARD_ENTRY_WIDTH = 633;
export const MONTHCARD_ENTRY_HEIGHT = 380;

/** 外层列表尺寸。 */
export const MONTHCARD_LIST_WIDTH = 711;
export const MONTHCARD_LIST_HEIGHT = 756;

export const MONTHCARD_ENTRY_STRIDE = MONTHCARD_ENTRY_HEIGHT;

/** 奖励格尺寸。 */
export const MONTHCARD_SLOT_WIDTH = 80;
export const MONTHCARD_SLOT_HEIGHT = 80;
export const MONTHCARD_SLOT_STRIDE = MONTHCARD_SLOT_WIDTH + 10;

export const MONTHCARD_PRIVILEGE_ROW_HEIGHT = 34;
export const MONTHCARD_PRIVILEGE_STRIDE = MONTHCARD_PRIVILEGE_ROW_HEIGHT + 6;

export const MONTHCARD_MAX_PRIVILEGE_ROWS = 5;
export const MONTHCARD_MAX_DAY_REWARD_SLOTS = 4;

export interface ILayoutPoint {
    readonly x: number;
    readonly y: number;
}

/** FGUI 左上角坐标 → Cocos 节点中心坐标。 */
export function fguiTopLeftToCocos(
    x: number,
    y: number,
    width: number,
    height: number,
    parentW: number,
    parentH: number,
): ILayoutPoint {
    return {
        x: x + width / 2 - parentW / 2,
        y: parentH / 2 - y - height / 2,
    };
}

/** FGUI 带 anchor 的枢轴点坐标 → Cocos 中心坐标。 */
export function fguiAnchorToCocos(
    pivotX: number,
    pivotY: number,
    parentW: number,
    parentH: number,
): ILayoutPoint {
    return {
        x: pivotX - parentW / 2,
        y: parentH / 2 - pivotY,
    };
}

// ============================================================
// 条目内部各元素坐标（父容器 = 条目 633×380）
// ============================================================

export const MONTHCARD_BG_POS = fguiTopLeftToCocos(0, 0, 633, 353, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_BG_SIZE = { width: 633, height: 353 } as const;

export const MONTHCARD_SP_POS = fguiAnchorToCocos(489, 321, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_SP_SIZE = { width: 172, height: 127 } as const;

/** spine 恒为 scale 1（老端原样渲染，172×127 只是编辑器占位框）。 */
export const MONTHCARD_SP_SCALE = 1;

/** spine 骨架 setup bounds 边长（不是渲染尺寸，仅留作排查出处）。 */
export const MONTHCARD_SP_BBOX = 1238.4;

/** 未购买态按钮；y 要叠加 layoutDy。 */
export const MONTHCARD_BUY_POS = fguiTopLeftToCocos(402, 259, 166, 61, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_BUY_SIZE = { width: 166, height: 61 } as const;

/** 续费态按钮：只挪位置，尺寸仍 166×61。 */
export const MONTHCARD_RENEW_POS = fguiTopLeftToCocos(406, 292, 166, 61, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);

/** 已购买角标；y 要叠加 boughtTagDy。 */
export const MONTHCARD_BOUGHT_TAG_POS = fguiTopLeftToCocos(-23, 14, 119, 74, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_BOUGHT_TAG_SIZE = { width: 119, height: 74 } as const;

export const MONTHCARD_TIME_POS = fguiAnchorToCocos(483, 263, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_TIME_SIZE = { width: 87, height: 26 } as const;

/** 有效期说明；y 要叠加 layoutDy。 */
export const MONTHCARD_DESC_POS = fguiTopLeftToCocos(377, 215, 214, 33, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_DESC_SIZE = { width: 214, height: 33 } as const;

export const MONTHCARD_REWARD_POS = fguiTopLeftToCocos(406, 292, 159, 60, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_REWARD_SIZE = { width: 159, height: 60 } as const;

/** 红点相对领取按钮中心的固定偏移。 */
export const MONTHCARD_RED_DOT_OFFSET: ILayoutPoint = { x: 77, y: 25 };
export const MONTHCARD_RED_DOT_SIZE = { width: 29, height: 28 } as const;

export const MONTHCARD_BUBBLE_POS = fguiTopLeftToCocos(506, 41, 114, 110, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_BUBBLE_SCALE = 0.9;

export const MONTHCARD_BUBBLE_LABEL_POS = fguiAnchorToCocos(
    517 + 92 / 2,
    141,
    MONTHCARD_ENTRY_WIDTH,
    MONTHCARD_ENTRY_HEIGHT,
);
export const MONTHCARD_BUBBLE_LABEL_SIZE = { width: 92, height: 32 } as const;

export const MONTHCARD_GAIN_GOODS_POS = fguiTopLeftToCocos(530, 64, 80, 80, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_GAIN_GOODS_SCALE = 0.8;

export const MONTHCARD_DAY_BG_POS = fguiTopLeftToCocos(15, 243, 350, 120, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_DAY_BG_SIZE = { width: 350, height: 120 } as const;

export const MONTHCARD_DAY_DOT_POS = fguiTopLeftToCocos(63, 255, 15, 14, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_DAY_DOT_SIZE = { width: 15, height: 14 } as const;

export const MONTHCARD_DAY_LABEL_POS = fguiAnchorToCocos(88 + 100 / 2, 264, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_DAY_LABEL_SIZE = { width: 100, height: 34 } as const;

export const MONTHCARD_DAY_LIST_POS = fguiTopLeftToCocos(15, 275, 350, 80, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_DAY_LIST_SIZE = { width: 350, height: 80 } as const;
export const MONTHCARD_DAY_LIST_SCALE = 0.8;

export const MONTHCARD_PRIVILEGE_LIST_POS = fguiTopLeftToCocos(47, 86, 300, 155, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT);
export const MONTHCARD_PRIVILEGE_LIST_SIZE = { width: 300, height: 155 } as const;

export const MONTHCARD_PRIVILEGE_DOT_POS = fguiTopLeftToCocos(14, 15, 18, 15, 240, 34);
export const MONTHCARD_PRIVILEGE_DOT_SIZE = { width: 18, height: 15 } as const;
export const MONTHCARD_PRIVILEGE_TEXT_POS = fguiTopLeftToCocos(37, 0, 220, 34, 240, 34);
export const MONTHCARD_PRIVILEGE_TEXT_SIZE = { width: 220, height: 34 } as const;
export const MONTHCARD_PRIVILEGE_ROW_SIZE = { width: 240, height: 34 } as const;

/** 卡名坐标随类型不同。 */
export const MONTHCARD_TITLE_POS: Readonly<Record<number, ILayoutPoint>> = {
    1: fguiTopLeftToCocos(199, 3, 227, 68, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT),
    2: fguiTopLeftToCocos(202, 9, 227, 68, MONTHCARD_ENTRY_WIDTH, MONTHCARD_ENTRY_HEIGHT),
};
export const MONTHCARD_TITLE_SIZE = { width: 227, height: 68 } as const;

// ============================================================
// 外层（父容器 = 画布 720×1280）
// ============================================================

export const MONTHCARD_PANEL_BG_POS = fguiTopLeftToCocos(3.5, 130, 649, 956, 720, 1280);
export const MONTHCARD_PANEL_BG_SIZE = { width: 649, height: 956 } as const;
export const MONTHCARD_PANEL_BG_SCALE = 1.1;

export const MONTHCARD_PANEL_LIST_POS = fguiTopLeftToCocos(5.5, 394, 711, 756, 720, 1280);

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

/** 第 index 个每日奖励格位置。 */
export function dayRewardSlotPosition(index: number): ILayoutPoint {
    return {
        x: index * MONTHCARD_SLOT_STRIDE + MONTHCARD_SLOT_WIDTH / 2 - MONTHCARD_DAY_LIST_SIZE.width / 2,
        y: 0,
    };
}

/** 第 index 行特权位置（靠左）。 */
export function privilegeRowPosition(index: number): ILayoutPoint {
    return {
        x: MONTHCARD_PRIVILEGE_ROW_SIZE.width / 2 - MONTHCARD_PRIVILEGE_LIST_SIZE.width / 2,
        y: MONTHCARD_PRIVILEGE_LIST_SIZE.height / 2
            - MONTHCARD_PRIVILEGE_ROW_HEIGHT / 2
            - index * MONTHCARD_PRIVILEGE_STRIDE,
    };
}
