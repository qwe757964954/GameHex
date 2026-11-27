/**
 * 单位成长修正模型（`pvpUnitGrowth` 一行里参与属性计算的部分）。不 import cc，可单测。
 *
 * 表里一行是六个平铺列（attackFlat / attackRate / maxHpFlat / ...）。如果把这六列
 * 直接摊进函数签名，每个调用点都要各写一份 `{ flat, rate }` 匿名结构，口径很容易走散：
 * 「射程只有 flat、移速只有 rate」这类事实只存在于某个调用点的字面量里。
 *
 * 这里按「属性 → 一档修正」归一成四个槽位，公式只保留 `growthScaled` 一个出口，
 * 调用方拿到的就是可直接参与计算的模型，不再关心表列名。
 */

/** 单项属性一档成长修正：`value = (base + flat) × (1 + rate)`。 */
export interface IGrowthModifier {
    readonly flat: number;
    readonly rate: number;
}

/** 一个单位一档成长的四项修正（生产时间 / 建筑血量不参与成长，不在这里）。 */
export interface IUnitGrowthModifiers {
    readonly maxHp: IGrowthModifier;
    readonly attack: IGrowthModifier;
    readonly moveSpeed: IGrowthModifier;
    readonly attackRange: IGrowthModifier;
}

/**
 * `pvpUnitGrowth` 的六个数值列。
 *
 * 列名沿用导表字段，不做改名：解析层（`parseUnitGrowthRow`）按这份契约归一，
 * 模型层再用 `unitGrowthModifiersOf` 转成槽位。
 */
export interface IUnitGrowthColumns {
    readonly attackFlat: number;
    readonly attackRate: number;
    readonly maxHpFlat: number;
    readonly maxHpRate: number;
    readonly moveSpeedRate: number;
    readonly attackRangeFlat: number;
}

/** 某一维没有成长（表里缺该档位）时的全 0 修正。 */
const NO_GROWTH_MODIFIER: IGrowthModifier = Object.freeze({ flat: 0, rate: 0 });

/** 整档没有成长：缺行 / 未启用时统一用它，不每次新建对象。 */
export const NO_UNIT_GROWTH_MODIFIERS: IUnitGrowthModifiers = Object.freeze({
    maxHp: NO_GROWTH_MODIFIER,
    attack: NO_GROWTH_MODIFIER,
    moveSpeed: NO_GROWTH_MODIFIER,
    attackRange: NO_GROWTH_MODIFIER,
});

/** `pvpUnitGrowth` 一行 → 四槽位修正；射程只有 flat、移速只有 rate，另一项按 0。 */
export function unitGrowthModifiersOf(row: IUnitGrowthColumns): IUnitGrowthModifiers {
    return {
        maxHp: { flat: row.maxHpFlat, rate: row.maxHpRate },
        attack: { flat: row.attackFlat, rate: row.attackRate },
        moveSpeed: { flat: 0, rate: row.moveSpeedRate },
        attackRange: { flat: row.attackRangeFlat, rate: 0 },
    };
}

/** 与战斗层 `ZCModifierRuntime` 同式：`(base + Σflat) × (1 + Σrate)`。 */
export function growthScaled(baseValue: number, modifier: IGrowthModifier): number {
    return (baseValue + modifier.flat) * (1 + modifier.rate);
}
