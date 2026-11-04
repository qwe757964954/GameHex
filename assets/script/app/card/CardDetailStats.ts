/**
 * 卡牌详情页六维属性计算。**不 import cc，可单测**。
 *
 * 数据源：
 *   - `pvpCard` 原始行：`unitMaxHp` / `unitAttack` / `unitMoveSpeed` / `unitAttackRange` /
 *     `soilderAddTime`（生产时间）/ `baseHp`（建筑血量）。
 *   - `pvpUnitGrowth`：一行 = `(unitId, level)` 的一档成长修正（enabled 过滤）。
 *
 * 公式与战斗层同口径（`ZCModifierRuntime.compileGrowthLoadout`：按 `(unitId, level)`
 * 取**单行**，行值本身就是到该级的累计修正）：
 *   value(level) = (base + row(level).flat) × (1 + row(level).rate)
 * `level` 行不存在时按全 0（= 基础值）。
 *
 * 「+60 / +8 / +132」绿色增量 = level+1 的值 − level 的值；已满级（表里没有 level+1 行）
 * 时增量为 0，由视图按「满级不显示增量」处理。
 */

/** `pvpUnitGrowth` 一行（已归一化）。 */
export interface ZCUnitGrowthRow {
    readonly unitId: string;
    readonly level: number;
    readonly attackFlat: number;
    readonly attackRate: number;
    readonly maxHpFlat: number;
    readonly maxHpRate: number;
    readonly moveSpeedRate: number;
    readonly attackRangeFlat: number;
    readonly enabled: boolean;
}

/** 详情页六维属性的一维：当前级数值 + 升一级增量。 */
export interface ZCDetailStatValue {
    readonly value: number;
    /** level+1 − level；满级恒 0。 */
    readonly gain: number;
}

/** 一张卡的详情属性（建筑血量 / 生产时间不参与成长，gain 恒 0）。 */
export interface ZCCardDetailStats {
    readonly unitHp: ZCDetailStatValue;
    readonly unitAttack: ZCDetailStatValue;
    readonly buildHp: ZCDetailStatValue;
    readonly spawnSeconds: number;
    readonly attackRange: ZCDetailStatValue;
    readonly moveSpeed: ZCDetailStatValue;
    /** 表里没有 level+1 的成长行 = 满级（兵种属性不再成长）。 */
    readonly maxed: boolean;
}

/** `pvpCard` 原始行里详情页用到的字段（其余列忽略）。 */
export interface ZCCardDetailBase {
    readonly unitMaxHp: number;
    readonly unitAttack: number;
    readonly unitMoveSpeed: number;
    readonly unitAttackRange: number;
    readonly spawnSeconds: number;
    readonly baseHp: number;
}

function toCount(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.floor(num);
}

function toRate(value: unknown): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

/** 解析一行 pvpUnitGrowth；坏行（缺 unitId/level）返回 null。 */
export function parseUnitGrowthRow(value: unknown): ZCUnitGrowthRow | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;

    const unitId = typeof row.unitId === 'string' ? row.unitId.trim() : String(row.unitId ?? '').trim();
    const level = toCount(row.level);
    if (unitId.length === 0 || level === null) return null;

    return {
        unitId,
        level,
        attackFlat: toRate(row.attackFlat),
        attackRate: toRate(row.attackRate),
        maxHpFlat: toRate(row.maxHpFlat),
        maxHpRate: toRate(row.maxHpRate),
        moveSpeedRate: toRate(row.moveSpeedRate),
        attackRangeFlat: toRate(row.attackRangeFlat),
        enabled: toCount(row.enabled) !== 0,
    };
}

/** 与战斗层 `scaled` 同式：`(base + Σflat) × (1 + Σrate)`。 */
function scaled(base: number, flat: number, rate: number): number {
    return (base + flat) * (1 + rate);
}

/** 取该 unit 该级的成长行（未启用 / 无行按全 0）。与战斗层同一行，不累加。 */
export function resolveGrowthRow(
    rows: readonly ZCUnitGrowthRow[],
    unitId: string,
    level: number,
): { attackFlat: number; attackRate: number; maxHpFlat: number; maxHpRate: number; moveSpeedRate: number; attackRangeFlat: number } {
    const row = rows.find((r) => r.enabled && r.unitId === unitId && r.level === level);
    if (!row) return { attackFlat: 0, attackRate: 0, maxHpFlat: 0, maxHpRate: 0, moveSpeedRate: 0, attackRangeFlat: 0 };
    return {
        attackFlat: row.attackFlat, attackRate: row.attackRate,
        maxHpFlat: row.maxHpFlat, maxHpRate: row.maxHpRate,
        moveSpeedRate: row.moveSpeedRate, attackRangeFlat: row.attackRangeFlat,
    };
}

/** 表里该 unit 的最大成长档；没有行返回 0（= 永远按满级处理）。 */
export function growthMaxLevel(rows: readonly ZCUnitGrowthRow[], unitId: string): number {
    let max = 0;
    for (const row of rows) {
        if (row.unitId === unitId && row.level > max) max = row.level;
    }
    return max;
}

/**
 * 算一张卡的详情属性。`base` 取自 pvpCard 原始行；`unitId` 为空（纯建筑卡）时
 * 兵种三维按 0 处理（视图整块隐藏）。
 */
export function computeDetailStats(
    base: ZCCardDetailBase,
    growthRows: readonly ZCUnitGrowthRow[],
    unitId: string,
    level: number,
): ZCCardDetailStats {
    const lv = Math.max(0, Math.floor(Number(level) || 0));
    const spawnSeconds = Math.max(0, base.spawnSeconds);
    const buildHpValue: ZCDetailStatValue = { value: Math.max(0, base.baseHp), gain: 0 };
    const emptyStat: ZCDetailStatValue = { value: 0, gain: 0 };

    if (unitId.length === 0) {
        return {
            unitHp: emptyStat, unitAttack: emptyStat, buildHp: buildHpValue,
            spawnSeconds, attackRange: emptyStat, moveSpeed: emptyStat, maxed: true,
        };
    }

    const sum = resolveGrowthRow(growthRows, unitId, lv);
    const nextSum = resolveGrowthRow(growthRows, unitId, lv + 1);
    const maxed = !growthRows.some((r) => r.enabled && r.unitId === unitId && r.level === lv + 1);

    const stat = (pick: (s: ReturnType<typeof resolveGrowthRow>) => { flat: number; rate: number }, baseValue: number): ZCDetailStatValue => {
        const cur = pick(sum);
        const value = scaled(baseValue, cur.flat, cur.rate);
        const gain = maxed ? 0 : scaled(baseValue, pick(nextSum).flat, pick(nextSum).rate) - value;
        return { value, gain };
    };

    return {
        unitHp: stat((s) => ({ flat: s.maxHpFlat, rate: s.maxHpRate }), Math.max(0, base.unitMaxHp)),
        unitAttack: stat((s) => ({ flat: s.attackFlat, rate: s.attackRate }), Math.max(0, base.unitAttack)),
        buildHp: buildHpValue,
        spawnSeconds,
        attackRange: stat((s) => ({ flat: s.attackRangeFlat, rate: 0 }), Math.max(0, base.unitAttackRange)),
        moveSpeed: stat((s) => ({ flat: 0, rate: s.moveSpeedRate }), Math.max(0, base.unitMoveSpeed)),
        maxed,
    };
}
