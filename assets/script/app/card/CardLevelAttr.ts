/**
 * 卡牌等级属性（`cardLevelUp.attrList`）读取。**不 import cc，可单测**。
 *
 * 与 `CardDetailStats` 里那套 `pvpUnitGrowth` 是**两套口径**，别混：
 *   - `attrList`：该等级的**绝对值**（Lv0 行 = 基础值，Lv50 = 满级值）；
 *   - `pvpUnitGrowth`：叠加在基础值上的 **flat/rate 增量**。
 *
 * 本文件只做前者：把 attrs 解析成三项可直接用的数。没配 attrList 的卡返回 `null`，
 * 由调用方决定回落哪一套（详情页回落 `pvpUnitGrowth`，行为与引入本文件前一致）。
 *
 * `cardLevelUp.id` 与 `pvpCard.id` 是**同一个键**（都是 68001 这种卡牌 id），
 * 所以详情页拿到的 cardId 可以直接查这张表，不需要经过 unitId 转换。
 */

import type { ZCCardAttrEntry, ZCCardLevelUpTable } from './CardUpgradeCost';
import { levelRateOf } from './CardLevelCurve';

/** 等级属性三项。建筑血量单独一项，不并进 maxHp。 */
export interface ZCCardLevelAttrs {
    readonly maxHp: number;
    readonly attack: number;
    readonly buildingHp: number;
}

/**
 * 表里 `statId` → 本结构字段。
 *
 * 只认这几个键：多写别名是为了容错（`hp` / `atk` / `buildHp` 都可能是手填变体），
 * 但**不认任意 statId** —— 认不得的键直接忽略，不猜数值。
 */
const STAT_ALIAS: Readonly<Record<string, keyof ZCCardLevelAttrs>> = {
    maxHp: 'maxHp',
    hp: 'maxHp',
    attack: 'attack',
    atk: 'attack',
    buildingHp: 'buildingHp',
    buildHp: 'buildingHp',
};

/** 一条 attrList 都没有 / 一条都认不得 ⇒ `null`（= 没配，交给调用方回落）。 */
export function attrsOfEntries(entries: readonly ZCCardAttrEntry[]): ZCCardLevelAttrs | null {
    if (entries.length === 0) return null;
    const result: { maxHp: number; attack: number; buildingHp: number } = {
        maxHp: 0, attack: 0, buildingHp: 0,
    };
    let hit = false;
    for (const entry of entries) {
        const key = STAT_ALIAS[entry.statId];
        if (!key) continue;
        result[key] = Math.max(0, entry.value);
        hit = true;
    }
    return hit ? result : null;
}

/** 取某张卡某等级的属性；卡不存在 / 等级没配 / attrList 为空都给 `null`。 */
export function resolveCardLevelAttrs(
    table: ZCCardLevelUpTable,
    cardId: string,
    level: number,
): ZCCardLevelAttrs | null {
    const levels = table.get(String(cardId));
    if (!levels) return null;
    const lv = Math.max(0, Math.floor(Number(level) || 0));
    const row = levels.get(lv);
    if (!row) return null;
    return attrsOfEntries(row.attrList ?? []);
}

/**
 * 取「当前级 + 下一级」两份属性，一次查表。
 *
 * 详情页要算升级增量（`gain`），避免调用方查两遍再自己判空。
 * `next` 为 `null` = 已满级或下一级没配。
 */
export function resolveCardLevelAttrsPair(
    table: ZCCardLevelUpTable,
    cardId: string,
    level: number,
): { current: ZCCardLevelAttrs | null; next: ZCCardLevelAttrs | null } {
    const lv = Math.max(0, Math.floor(Number(level) || 0));
    return {
        current: resolveCardLevelAttrs(table, cardId, lv),
        next: resolveCardLevelAttrs(table, cardId, lv + 1),
    };
}

/**
 * 怪物卡的基础值形状（`monsterCard` 与 `pvpCard` 同列名）。
 *
 * 只取三项：怪物卡不需要知道 `unitMoveSpeed` / `unitAttackRange`，
 * 那两个不随等级成长（卡牌那边 `attrList` 也只配了三项）。
 */
export interface ZCCardBaseStats {
    readonly unitMaxHp: number;
    readonly unitAttack: number;
    readonly baseHp: number;
}

/**
 * 怪物卡按等级出属性 —— **不建怪物卡升级表**，只借卡牌曲线。
 *
 *     maxHp     = 怪物卡 unitMaxHp  × 曲线倍率(level)
 *     attack    = 怪物卡 unitAttack × 曲线倍率(level)
 *     buildingHp= 怪物卡 baseHp     × 曲线倍率(level)
 *
 * 曲线来自 `measureLevelRates(cardLevelUp)`（见 `CardLevelCurve`），所以
 * **策划改卡牌成长表，怪物卡自动跟着变**，不存在第二份成长配置。
 *
 * 该等级在曲线上没有采样（超出卡牌上限 / 表没配）⇒ `null`，由调用方决定
 * 是回落基础值还是拒绝出怪，不在这里兜底。
 */
export function resolveMonsterLevelAttrs(
    rates: ReadonlyMap<number, number>,
    base: ZCCardBaseStats,
    level: number,
): ZCCardLevelAttrs | null {
    const rate = levelRateOf(rates, level);
    if (rate === null) return null;
    return {
        maxHp: Math.max(0, Math.round(base.unitMaxHp * rate)),
        attack: Math.max(0, Math.round(base.unitAttack * rate)),
        buildingHp: Math.max(0, Math.round(base.baseHp * rate)),
    };
}
