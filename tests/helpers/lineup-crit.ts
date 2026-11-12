/**
 * 「全队暴击伤害增幅」计划行（2026-11-10）。
 *
 * 每张可上场卡（35 张）在 `pvpSkillPlan` 里多了 50 行：`skillChainId = 109001`、
 * `skillLevel = unlockHeroLevel = 1..50`、`progressionMode = accumulate`、
 * `statId = critDamage`。它**不是任何一张卡的技能链**，而是「按卡牌等级逐级累加的全队属性」，
 * 每级增量按品质定额（绿 0.5 / 蓝 1 / 紫 2 / 金 3，百分数口径）。
 *
 * 各卡的技能链用例只关心自己的链，凡是要按 `unitId` 数「这张卡有几条几档」的地方，
 * 计数前统一用它剔掉 —— 否则每张卡都会凭空多出 50 行。
 *
 * ⚠️ 2026-11-10 起 `critDamage` **只允许**来自这条链（用户口径：卡牌自身技能不许带暴击伤害加成）。
 * 原来 68016/68025/68033/68034 的「裂变暴击·暴伤」12 行（90/120/150）已删除；同卡改由
 * `critRate` 承担，**保留原设计值 22/30/38%**。`tests/zcds-lineup-crit.test.ts` 有一条全表守卫钉这个口径。
 *
 * 生成脚本：`tools/config/patch_lineup_crit_damage.js`（配套 `_excel.py` 写源表）。
 */
export const LINEUP_CRIT_CHAIN_ID = 109001;

export function withoutLineupCrit<T extends { skillChainId?: unknown }>(rows: readonly T[]): T[] {
    return rows.filter((row) => Number(row.skillChainId) !== LINEUP_CRIT_CHAIN_ID);
}
