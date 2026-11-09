/**
 * 「阵容战力」= 上阵卡牌的攻击力之和。**不 import cc，可单测**。
 *
 * ## 口径（山猫 2026-11-06：「战力图标 = 阵容内攻击力总和」）
 *
 * ```
 * 战力 = Σ 每张上阵卡的 unitAttack
 * unitAttack = (pvpCard.unitAttack + cardLevelUp.attrList.attack 的加成) × 成长率
 * ```
 *
 * 即反馈里说的「卡牌基础属性 + 账号养成属性」：
 *   · **卡牌基础属性** ← `pvpCard.unitAttack`（表里的白值）；
 *   · **账号养成属性** ← 卡牌等级成长（`cardLevelUp.attrList` 的绝对值优先，
 *     没配时回落 `pvpUnitGrowth` 的 `attackFlat/attackRate`）。
 *
 * 两者怎么合、按哪个公式合，**一律复用 `CardDetailStats.computeDetailStats`** ——
 * 详情页六维里的「攻击」就是这个数，战力若另写一套算法，两处迟早对不上。
 *
 * ## 为什么不是老端 `ModelRole.getRoleAtk()`
 *
 * 老端那个方法最终调 `ModelTeam.GetTotalAtk()`，算的是**装备/禁军/技能的属性袋**
 * （塔防养成），跟卡牌阵容没有关系。它值得借鉴的是「**本地算、不向服务端要**」这一点：
 * 本项目同样全部读配置表 + 后端英雄等级缓存，一次网络请求都不发。
 * 移植到塔防那套口径的版本已经在 `role/RolePowerTable.ts`，别和本文件混用。
 *
 * ## 建筑卡
 *
 * 主城 / 金矿这类卡没有兵种（`unitId` 为空），`computeDetailStats` 会给 `unitAttack = 0`，
 * 于是它们对战力贡献 0 —— 这是对的，它们的价值在 `baseHp` / 产金，不在攻击。
 */

import { computeDetailStats } from './CardDetailStats';
import type { ZCCardDetailBase, ZCUnitGrowthRow } from './CardDetailStats';
import type { ZCCardLevelAttrs } from './CardLevelAttr';

/** 一张上阵卡算攻击力需要的全部输入（由调用方查表拼好）。 */
export interface ICardPowerInput {
    /** 卡牌 id（只用于排查，不参与计算）。 */
    readonly cardId: string;
    /** `pvpCard` 原始行 → 基础值。 */
    readonly base: ZCCardDetailBase;
    /** 兵种 id；建筑卡为空串（贡献 0）。 */
    readonly unitId: string;
    /** 该卡的当前等级（`heroLevels`）。 */
    readonly level: number;
    /** `cardLevelUp.attrList` 的绝对属性；没配时为 `null`（回落成长表）。 */
    readonly levelAttrs: ZCCardLevelAttrs | null;
}

/** 单卡攻击力（与详情页「攻击」那一格同源同式）。 */
export function cardAttackOf(
    input: ICardPowerInput,
    growthRows: readonly ZCUnitGrowthRow[],
): number {
    const stats = computeDetailStats(
        input.base,
        growthRows,
        input.unitId,
        input.level,
        input.levelAttrs,
        null,
    );
    const value = stats.unitAttack.value;
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 战力文案：`1716` → `1716`、`15980` → `15.98K`、`1234567` → `1.23M`。
 *
 * 千位以下照原样（阵容战力大多是三位到四位，别把它缩写成一个 K 看不出变化）；
 * 万位起才缩写，保留两位并去掉尾随 0（`12.50K` → `12.5K`），与设计稿上 `15.98K` 的写法一致。
 * 非有限值 / 负数按 `0`。
 */
export function formatPowerText(value: number): string {
    const num = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (num < 10000) return String(num);
    const trim = (text: string): string => text.replace(/\.?0+$/, '');
    if (num >= 1000000) return `${trim((num / 1000000).toFixed(2))}M`;
    return `${trim((num / 1000).toFixed(2))}K`;
}

/**
 * 阵容战力 = 上阵卡攻击力之和，取整。
 *
 * 非有限值（表里配了字符串 / 空行）按 0 计，不让一个坏行把整块战力变成 `NaN`。
 * 空阵容返回 0 —— 调用方按「还没拿到阵容」处理，不要显示成「战力 0」。
 */
export function lineupAttackTotal(
    inputs: readonly ICardPowerInput[],
    growthRows: readonly ZCUnitGrowthRow[],
): number {
    let sum = 0;
    for (const input of inputs) {
        const attack = cardAttackOf(input, growthRows);
        if (Number.isFinite(attack)) sum += attack;
    }
    return Math.max(0, Math.round(sum));
}
