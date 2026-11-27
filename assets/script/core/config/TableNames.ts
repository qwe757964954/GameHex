/** 跨 feature 复用的配置表名；feature 私有表名不进这里。 */
export const ITEM_TABLE = 'item';
export const ROLE_PROPERTY_TABLE = 'roleProperty';
export const PAY_CHANNEL_TABLE = 'payChannel';
export const GUANKA_REWARD_TABLE = 'guankaReward';
export const HEAD_TABLE = 'head';
export const ICON_TABLE = 'icon';
export const OPEN_TABLE = 'open';
export const GAME_CONFIG_TABLE = 'gameConfig';
export const ACTIVITY_TABLE = 'activity';
export const ACTIVITY_TAB_TABLE = 'activityTab';
export const MONTH_CARD_ACT_PLAN_TABLE = 'monthCardActPlan';
export const EQUIP_TABLE = 'equip';
export const LEVEL_TABLE = 'level';
export const PVP_CARD_TABLE = 'pvpCard';
export const PVP_BOND_TABLE = 'pvpBond';
export const PVP_SKILL_TABLE = 'pvpSkill';
export const PVP_ARTIFACT_TABLE = 'pvpArtifact';
export const MONSTER_TABLE = 'monster';

/**
 * `cardLevelUp`：卡牌升级消耗表。`costCardID` 是卡牌碎片道具的 `resId`，
 * 与 `pvpCard.id`（`id` 列）同键 —— 碎片 ↔ 卡牌的唯一关联。
 */
export const CARD_LEVEL_UP_TABLE = 'cardLevelUp';
