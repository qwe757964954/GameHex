/**
 * 卡牌详情页六维属性计算。不 import cc，可单测。
 *
 * 数据源：
 *   - `pvpCard` 原始行：`unitMaxHp` / `unitAttack` / `unitMoveSpeed` / `unitAttackRange` /
 *     `soilderAddTime`（生产时间）/ `baseHp`（建筑血量）。
 *   - `pvpUnitGrowth`：一行 = `(unitId, level)` 的一档成长修正（enabled 过滤）。
 *
 * 成长修正的类型与公式落在 `model/UnitGrowthModifier`：一行六个平铺列先归一成
 * 「血量 / 攻击 / 移速 / 射程」四个 `{ flat, rate }` 槽位，本文件只负责查表与组合。
 *
 * 公式与战斗层同口径（`ZCModifierRuntime.compileGrowthLoadout`：按 `(unitId, level)`
 * 取单行，行值本身就是到该级的累计修正）：
 *   value(level) = (base + row(level).flat) × (1 + row(level).rate)
 * `level` 行不存在时按全 0（= 基础值）。
 *
 * 「+60 / +8 / +132」绿色增量 = level+1 的值 − level 的值；已满级（表里没有 level+1 行）
 * 时增量为 0，由视图按「满级不显示增量」处理。
 */

import type { ZCCardLevelAttrs } from './CardLevelAttr';
import {
    growthScaled,
    NO_UNIT_GROWTH_MODIFIERS,
    unitGrowthModifiersOf,
} from './model/UnitGrowthModifier';
import type {
    IGrowthModifier,
    IUnitGrowthColumns,
    IUnitGrowthModifiers,
} from './model/UnitGrowthModifier';

/** `pvpUnitGrowth` 一行（已归一化）：业务字段 + 六个成长列。 */
export interface ZCUnitGrowthRow extends IUnitGrowthColumns {
    readonly unitId: string;
    readonly level: number;
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

/**
 * 解析一行 pvpUnitGrowth；只保留「空 unitId / 非正档位」这类业务上不可用的行。
 *
 * 列类型由导表保证（`unitId: string`，其余 `number`），客户端不再做第二次类型校验；
 * `enabled` 从表里的 1/0 归一成 boolean 是运行口径转换，不是类型校验。
 */
export function parseUnitGrowthRow(row: IRefpvpUnitGrowth | null | undefined): ZCUnitGrowthRow | null {
    if (!row) return null;

    const unitId = String(row.unitId ?? '').trim();
    const level = row.level;
    if (unitId.length === 0 || !(level > 0)) return null;

    return {
        unitId,
        level,
        attackFlat: row.attackFlat,
        attackRate: row.attackRate,
        maxHpFlat: row.maxHpFlat,
        maxHpRate: row.maxHpRate,
        moveSpeedRate: row.moveSpeedRate,
        attackRangeFlat: row.attackRangeFlat,
        enabled: row.enabled !== 0,
    };
}

/** 取该 unit 该级的成长修正（未启用 / 无行按全 0）。与战斗层同一行，不累加。 */
export function resolveGrowthRow(
    rows: readonly ZCUnitGrowthRow[],
    unitId: string,
    level: number,
): IUnitGrowthModifiers {
    const row = rows.find((r) => r.enabled && r.unitId === unitId && r.level === level);
    return row ? unitGrowthModifiersOf(row) : NO_UNIT_GROWTH_MODIFIERS;
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
 * 用 `cardLevelUp.attrList` 的绝对属性覆盖血量 / 攻击 / 建筑血量三项。
 *
 * 只覆盖这三项：射程与移速不在 attrList 里，继续沿用 `pvpUnitGrowth` 那条路算出来的值。
 * `current` 为空（这张卡没配等级属性）⇒ 原样返回，行为与本函数引入前逐字一致。
 *
 * `gain` 取下一级减当前级；下一级没配（满级）时给 0，视图按「满级不显示增量」处理。
 */
function applyLevelAttrs(
    stats: ZCCardDetailStats,
    current: ZCCardLevelAttrs | null | undefined,
    next: ZCCardLevelAttrs | null | undefined,
): ZCCardDetailStats {
    if (!current) return stats;
    const line = (cur: number, nxt: number | undefined): ZCDetailStatValue => ({
        value: cur,
        gain: nxt === undefined ? 0 : Math.max(0, nxt - cur),
    });
    return {
        ...stats,
        unitHp: line(current.maxHp, next?.maxHp),
        unitAttack: line(current.attack, next?.attack),
        buildHp: line(current.buildingHp, next?.buildingHp),
        maxed: !next,
    };
}

/**
 * 算一张卡的详情属性。`base` 取自 pvpCard 原始行；`unitId` 为空（纯建筑卡）时
 * 兵种三维按 0 处理（视图整块隐藏）。
 *
 * `levelAttrs` / `nextLevelAttrs` 是本级与下一级的 `cardLevelUp.attrList` 绝对值。
 * 传了就优先用它们（卡牌等级成长走配置表）；不传或为 `null` 时走原来的
 * `pvpUnitGrowth` 增量口径 —— 两条路并存，老卡不配 attrList 也照旧能显示。
 */
export function computeDetailStats(
    base: ZCCardDetailBase,
    growthRows: readonly ZCUnitGrowthRow[],
    unitId: string,
    level: number,
    levelAttrs?: ZCCardLevelAttrs | null,
    nextLevelAttrs?: ZCCardLevelAttrs | null,
): ZCCardDetailStats {
    const lv = Math.max(0, Math.floor(Number(level) || 0));
    const spawnSeconds = Math.max(0, base.spawnSeconds);
    const buildHpValue: ZCDetailStatValue = { value: Math.max(0, base.baseHp), gain: 0 };
    const emptyStat: ZCDetailStatValue = { value: 0, gain: 0 };

    if (unitId.length === 0) {
        return applyLevelAttrs({
            unitHp: emptyStat, unitAttack: emptyStat, buildHp: buildHpValue,
            spawnSeconds, attackRange: emptyStat, moveSpeed: emptyStat, maxed: true,
        }, levelAttrs, nextLevelAttrs);
    }

    const current = resolveGrowthRow(growthRows, unitId, lv);
    const next = resolveGrowthRow(growthRows, unitId, lv + 1);
    const maxed = !growthRows.some((r) => r.enabled && r.unitId === unitId && r.level === lv + 1);

    const stat = (baseValue: number, cur: IGrowthModifier, nextMod: IGrowthModifier): ZCDetailStatValue => {
        const value = growthScaled(baseValue, cur);
        const gain = maxed ? 0 : growthScaled(baseValue, nextMod) - value;
        return { value, gain };
    };

    return applyLevelAttrs({
        unitHp: stat(Math.max(0, base.unitMaxHp), current.maxHp, next.maxHp),
        unitAttack: stat(Math.max(0, base.unitAttack), current.attack, next.attack),
        buildHp: buildHpValue,
        spawnSeconds,
        attackRange: stat(Math.max(0, base.unitAttackRange), current.attackRange, next.attackRange),
        moveSpeed: stat(Math.max(0, base.unitMoveSpeed), current.moveSpeed, next.moveSpeed),
        maxed,
    }, levelAttrs, nextLevelAttrs);
}
