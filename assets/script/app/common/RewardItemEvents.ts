/** 公共奖励格点击意图；由应用组合层打开物品详情。 */
export const REWARD_ITEM_DETAIL_INTENT = 'reward-item:detail';

export interface IRewardItemDetailIntent {
    readonly resId: number;
}

/**
 * 宝石奖励格点击意图：宝石不是道具，`resId` 实际是宝石实例 id（gemId），
 * 不能进物品详情（`item` / `roleProperty` 查不到，会显示「未知物品」）。
 */
export const REWARD_GEM_DETAIL_INTENT = 'reward-item:gem-detail';

export interface IRewardGemDetailIntent {
    readonly gemId: string;
}
