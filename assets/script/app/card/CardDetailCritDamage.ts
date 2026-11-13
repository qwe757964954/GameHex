/**
 * 卡牌详情页的「升级增加全队暴击伤害」文案数据。不 import cc，可单测。
 *
 * 数据源 `pvpSkillPlan`：每张可上场卡都有 50 行固定链（`skillChainId = 109001`），
 * 一行 = 一个等级档的增量（不是累计值）：
 *   - `skillLevel` / `unlockHeroLevel` = 卡牌等级（两者相等）；
 *   - `statId = critDamage`、`operation = add`、`value` = 百分点（1 = +1%）。
 *
 * 战斗层把本局阵容所有卡的这条链汇总成一个 owner 级共享池
 * （`ZCModifierRuntime.shareLineupCritDamage`），详情页只读这一条链，
 * 告诉玩家「再升一级，全队暴击伤害还能加多少」。
 */

/** 「全队暴击伤害增幅」在 `pvpSkillPlan` 里的固定技能链。 */
export const LINEUP_CRIT_CHAIN_ID = 109001;

/** 暴击伤害的 statId（`pvpSkillPlan.statId`）。 */
const CRIT_DAMAGE_STAT = 'critDamage';

/** `cardId → (等级 → 该级增量百分点)`。 */
export type ZCCritDamageGainTable = ReadonlyMap<string, ReadonlyMap<number, number>>;

/**
 * `pvpSkillPlan` 原始行 → 暴击伤害增量表（只收 109001 链上启用的 `critDamage` 行）。
 *
 * 数值口径：`add` 直接是百分点（1 = +1%）；`addRate` 是比例（0.01 = +1%）按 ×100 折算。
 * 其它 statId / 其它链 / 停用行一律忽略 —— 这张表只服务详情页那一行文案。
 */
export function buildCritDamageGainTable(rows: readonly unknown[]): ZCCritDamageGainTable {
    const table = new Map<string, Map<number, number>>();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const row = raw as Record<string, unknown>;
        if (Number(row.skillChainId) !== LINEUP_CRIT_CHAIN_ID) continue;
        if (String(row.statId ?? '') !== CRIT_DAMAGE_STAT) continue;
        if (!Number(row.enabled)) continue;
        const unitId = String(row.unitId ?? '');
        const level = Math.floor(Number(row.skillLevel));
        const value = Number(row.value);
        if (!unitId || !Number.isSafeInteger(level) || level < 1 || !Number.isFinite(value)) continue;
        const points = row.operation === 'addRate' ? value * 100 : value;
        if (points <= 0) continue;
        let byLevel = table.get(unitId);
        if (!byLevel) {
            byLevel = new Map<number, number>();
            table.set(unitId, byLevel);
        }
        byLevel.set(level, points);
    }
    return table;
}

/**
 * 从 `level` 升到 `level + 1` 会新增的全队暴击伤害（百分点）。
 *
 * 读的是目标等级那一行 —— 链路上每行是「到这一级才给」的增量；
 * 没配 / 已满级（没有 level+1 行）返回 0，调用方据此不显示文案。
 */
export function critDamageGainAt(
    table: ZCCritDamageGainTable,
    cardId: string,
    level: number,
): number {
    const target = Math.max(0, Math.floor(Number(level) || 0)) + 1;
    return table.get(String(cardId))?.get(target) ?? 0;
}

/**
 * 百分点 → 展示文本：`2 → 2%`、`0.5 → 0.5%`。非正数返回空串（不显示这一行）。
 *
 * 用 `toFixed(1)` 兜住配表里的小数（绿卡每级 0.5%），整数档不显示 `.0`。
 */
export function formatCritDamageGain(points: number): string {
    if (!Number.isFinite(points) || points <= 0) return '';
    const rounded = Math.round(points * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
