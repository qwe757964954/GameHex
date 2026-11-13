/**
 * 阵容战力 = 上阵卡攻击力之和，纯 TS，可单测。
 *
 * 单卡攻击 =（pvpCard.unitAttack + 等级成长加成）× 成长率。
 * 这部分统一走 CardDetailStats.computeDetailStats，别在详情页和这里各算一套。
 * 主城、金矿这类建筑卡没有兵种，攻击按 0，不影响战力。
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
 * 战力显示：四位数以内原样输出，上万才缩成 K/M，保留两位并去掉尾零。
 * 负数和非法值按 0。
 */
export function formatPowerText(value: number): string {
    const num = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (num < 10000) return String(num);
    const trim = (text: string): string => text.replace(/\.?0+$/, '');
    if (num >= 1000000) return `${trim((num / 1000000).toFixed(2))}M`;
    return `${trim((num / 1000).toFixed(2))}K`;
}

/**
 * 上阵卡攻击求和后取整。坏行按 0 计，避免 NaN；空阵容返回 0。
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
