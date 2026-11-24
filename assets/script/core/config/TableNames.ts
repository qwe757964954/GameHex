/** 跨 feature 复用的配置表名；feature 私有表名不进这里。 */
export const ITEM_TABLE = 'item';
export const ROLE_PROPERTY_TABLE = 'roleProperty';
export const PAY_CHANNEL_TABLE = 'payChannel';
export const GUANKA_REWARD_TABLE = 'guankaReward';
export const HEAD_TABLE = 'head';
export const ICON_TABLE = 'icon';
export const OPEN_TABLE = 'open';

/**
 * `cardLevelUp`：卡牌升级消耗表。`costCardID` 是卡牌碎片道具的 `resId`，
 * 与 `pvpCard.id`（`id` 列）同键 —— 碎片 ↔ 卡牌的唯一关联。
 */
export const CARD_LEVEL_UP_TABLE = 'cardLevelUp';
