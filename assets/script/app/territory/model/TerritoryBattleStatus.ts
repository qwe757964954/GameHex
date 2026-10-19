/**
 * 已存战斗记录的结算状态（**唯一事实源**：`TerritoryBattleStatus` 由它推导）。
 *
 * ⚠️ 禁止写 `'victory'` / `'pending'` 这类裸字面量——状态改名或拼错时
 * 字面量比较会静默失配，走本表则编译期就暴露。
 */
export const TERRITORY_BATTLE_STATUS = {
    pending: 'pending',
    victory: 'victory',
    defeat: 'defeat',
} as const;

export type TerritoryBattleStatus = typeof TERRITORY_BATTLE_STATUS[keyof typeof TERRITORY_BATTLE_STATUS];
