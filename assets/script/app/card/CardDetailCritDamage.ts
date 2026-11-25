/**
 * 卡牌详情页「升级增加全队暴击伤害」的数据层，不 import cc。
 * 数据源 pvpSkillPlan 的 109001 链：每行是一个等级档的增量，add 的 value 为百分点，addRate 为比例。
 * 详情页只读这一条链，告诉玩家再升一级全队暴击伤害还能加多少。
 */

/** 「全队暴击伤害增幅」在 `pvpSkillPlan` 里的固定技能链。 */
export const LINEUP_CRIT_CHAIN_ID = 109001;

/** 暴击伤害的 statId（`pvpSkillPlan.statId`）。 */
const CRIT_DAMAGE_STAT = 'critDamage';

/** `unitId → (等级 → 该级增量百分点)`。 */
export type ZCCritDamageGainTable = ReadonlyMap<string, ReadonlyMap<number, number>>;

/** `pvpSkillPlan` 109001 链上一行的归一化结果。 */
export interface ZCCritDamageGainRow {
    readonly unitId: string;
    readonly level: number;
    readonly points: number;
}

/**
 * 解析一行 pvpSkillPlan；不是 109001 链上启用的 critDamage 行、或字段类型/取值不合法时返回 null。
 * add 直接是百分点，addRate 按 ×100 折算并归一化到 3 位小数。
 */
export function parseCritDamageGainRow(value: unknown): ZCCritDamageGainRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.skillChainId !== LINEUP_CRIT_CHAIN_ID) return null;
    if (row.statId !== CRIT_DAMAGE_STAT) return null;
    const enabled = row.enabled;
    if (typeof enabled !== 'number' || !Number.isFinite(enabled) || enabled === 0) return null;
    const unitId = row.unitId;
    if (typeof unitId !== 'string' || unitId.length === 0) return null;
    const level = row.skillLevel;
    if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) return null;
    const rawValue = row.value;
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;
    const operation = row.operation;
    let points: number;
    if (operation === 'add') points = rawValue;
    else if (operation === 'addRate') points = Math.round(rawValue * 100000) / 1000;
    else return null;
    if (!Number.isFinite(points) || points <= 0) return null;
    return { unitId, level, points };
}

/**
 * pvpSkillPlan 原始行转暴击伤害增量表，只收 109001 链上启用的 critDamage 行。
 * 重复的 `(unitId, skillLevel)` 后值覆盖。
 */
export function buildCritDamageGainTable(rows: readonly unknown[]): ZCCritDamageGainTable {
    const table = new Map<string, Map<number, number>>();
    for (const raw of rows) {
        const row = parseCritDamageGainRow(raw);
        if (!row) continue;
        let byLevel = table.get(row.unitId);
        if (!byLevel) {
            byLevel = new Map<number, number>();
            table.set(row.unitId, byLevel);
        }
        byLevel.set(row.level, row.points);
    }
    return table;
}

/**
 * 从 level 升到 level + 1 新增的暴击伤害百分点，按 unitId 读目标等级那一行。
 * 没配或已满级返回 0，调用方据此不显示文案。
 */
export function critDamageGainAt(
    table: ZCCritDamageGainTable,
    unitId: string,
    level: number,
): number {
    const target = Math.max(0, Math.floor(level || 0)) + 1;
    return table.get(unitId)?.get(target) ?? 0;
}

/**
 * 百分点转展示文本：2 转 2%，0.5 转 0.5%。非正数返回空串。
 * 配表有 0.5 这类小数，整数档不显示 .0。
 */
export function formatCritDamageGain(points: number): string {
    if (!Number.isFinite(points) || points <= 0) return '';
    const rounded = Math.round(points * 10) / 10;
    if (rounded <= 0) return '';
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
