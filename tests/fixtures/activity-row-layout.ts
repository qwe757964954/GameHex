/**
 * 每日任务「任务行」版面夹具。
 *
 * 生产侧已把行内几何迁进 `Activity.prefab` / `ActivityTaskRow.prefab` 的
 * `cc.Layout`，`LayerActivityLayout` 不再导出这些常量；测试保留同一组权威数值，
 * 只用于验证 FGUI → Cocos 坐标换算与 Layout 结果对拍，不参与运行时。
 */
import { fguiTopLeftToCocos, rewardNumLayout } from '../../assets/script/app/activity/LayerActivityLayout';

export const ACTIVITY_ROW_WIDTH = 679;
export const ACTIVITY_ROW_HEIGHT = 190;
export const ACTIVITY_ROW_REWARD_SLOTS = 5;
export const ACTIVITY_ROW_BG_POS = fguiTopLeftToCocos(19, 13, 658, 175, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_BG_SIZE = { width: 658, height: 175 } as const;
export const ACTIVITY_ROW_RIBBON_POS = {
    x: -ACTIVITY_ROW_WIDTH / 2 - 2,
    y: ACTIVITY_ROW_HEIGHT / 2,
} as const;
export const ACTIVITY_ROW_RIBBON_SIZE = { width: 420, height: 105 } as const;
export const ACTIVITY_ROW_RIBBON_SCALE_Y = 0.7;
export const ACTIVITY_ROW_TITLE_POS = fguiTopLeftToCocos(21, 15, 340, 30, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_TITLE_SIZE = { width: 340, height: 30 } as const;
export const ACTIVITY_ROW_TITLE_LEFT = 21 - ACTIVITY_ROW_WIDTH / 2;
export const ACTIVITY_ROW_REWARD_BAR_POS = fguiTopLeftToCocos(74, 71, 350, 90, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_REWARD_BAR_SIZE = { width: 350, height: 90 } as const;
export const ACTIVITY_ROW_REWARD_SLOT_SIZE = 85;
export const ACTIVITY_ROW_REWARD_SLOT_GAP = 5;

export function rewardSlotX(index: number): number {
    return -ACTIVITY_ROW_REWARD_BAR_SIZE.width / 2
        + ACTIVITY_ROW_REWARD_SLOT_SIZE / 2
        + index * (ACTIVITY_ROW_REWARD_SLOT_SIZE + ACTIVITY_ROW_REWARD_SLOT_GAP);
}

const ROW_NUM_LAYOUT = rewardNumLayout(ACTIVITY_ROW_REWARD_SLOT_SIZE);
export const ACTIVITY_ROW_REWARD_NUM_SCALE = ROW_NUM_LAYOUT.scale;
export const ACTIVITY_ROW_REWARD_NUM_POS = ROW_NUM_LAYOUT.pos;
export const ACTIVITY_ROW_REWARD_NUM_FONT_SIZE = ROW_NUM_LAYOUT.fontSize;
export const ACTIVITY_ROW_ACTION_POS = fguiTopLeftToCocos(509, 89, 132, 63, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_ACTION_SIZE = { width: 132, height: 63 } as const;
export const ACTIVITY_ROW_STAMP_POS = fguiTopLeftToCocos(509, 75, 119, 74, ACTIVITY_ROW_WIDTH, ACTIVITY_ROW_HEIGHT);
export const ACTIVITY_ROW_STAMP_SIZE = { width: 119, height: 74 } as const;
