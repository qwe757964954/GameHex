/**
 * 首充礼包版面推导 —— 纯函数，可单测。
 * 横排可变宽布局：日牌宽度随当天奖励条数走，整排在 DayList 里居中。
 */

export const DAY_LIST_WIDTH = 657;
export const DAY_PLATE_GAP = 10;
export const REWARD_SLOT_SIZE = 76;
export const REWARD_SLOT_GAP = 5;
export const DAY_PLATE_WIDTH_TWO = 186;
export const DAY_PLATE_WIDTH_THREE = 269;
export const MAX_REWARDS_PER_DAY = 3;

/** 当天奖励条数 → 日牌宽度。 */
export function dayPlateWidth(rewardCount: number): number {
    return rewardCount >= 3 ? DAY_PLATE_WIDTH_THREE : DAY_PLATE_WIDTH_TWO;
}

/** 当天奖励条数 → 每个奖励格相对 SlotBar 中心的 x。 */
export function rewardSlotOffsets(rewardCount: number): number[] {
    const count = Math.max(0, Math.floor(rewardCount));
    const step = REWARD_SLOT_SIZE + REWARD_SLOT_GAP;
    return Array.from({ length: count }, (_unused, index) => (index - (count - 1) / 2) * step);
}

/** 当天奖励条数 → 奖励排宽度。 */
export function rewardRowWidth(rewardCount: number): number {
    const count = Math.max(0, Math.floor(rewardCount));
    if (count === 0) return 0;
    return count * REWARD_SLOT_SIZE + (count - 1) * REWARD_SLOT_GAP;
}

/** 三天奖励条数 → 每块日牌相对 DayList 中心的 x。 */
export function dayPlateOffsets(rewardCounts: readonly number[]): number[] {
    const widths = rewardCounts.map(dayPlateWidth);
    const total = widths.reduce((sum, width) => sum + width, 0)
        + DAY_PLATE_GAP * Math.max(0, widths.length - 1);
    let cursor = (DAY_LIST_WIDTH - total) / 2;
    return widths.map((width) => {
        const center = cursor + width / 2 - DAY_LIST_WIDTH / 2;
        cursor += width + DAY_PLATE_GAP;
        return center;
    });
}
