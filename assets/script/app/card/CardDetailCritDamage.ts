/**
 * 卡牌详情页「升级增加全队暴击伤害」的数据层，不 import cc。
 * 数据源 pvpSkillPlan 的 109001 链：每行是一个等级档的增量，value 单位为百分点。
 * 详情页只读这一条链，告诉玩家再升一级全队暴击伤害还能加多少。
 */

/** 「全队暴击伤害增幅」在 `pvpSkillPlan` 里的固定技能链。 */
export const LINEUP_CRIT_CHAIN_ID = 109001;

/** 暴击伤害的 statId（`pvpSkillPlan.statId`）。 */
const CRIT_DAMAGE_STAT = 'critDamage';

/** `cardId → (等级 → 该级增量百分点)`。 */
export type ZCCritDamageGainTable = ReadonlyMap<string, ReadonlyMap<number, number>>;

/**
 * pvpSkillPlan 原始行转暴击伤害增量表，只收 109001 链上启用的 critDamage 行。
 * add 直接是百分点，addRate 按 ×100 折算。
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
 * 从 level 升到 level + 1 新增的暴击伤害百分点，读目标等级那一行。
 * 没配或已满级返回 0，调用方据此不显示文案。
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
 * 百分点转展示文本：2 转 2%，0.5 转 0.5%。非正数返回空串。
 * 配表有 0.5 这类小数，整数档不显示 .0。
 */
export function formatCritDamageGain(points: number): string {
    if (!Number.isFinite(points) || points <= 0) return '';
    const rounded = Math.round(points * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
