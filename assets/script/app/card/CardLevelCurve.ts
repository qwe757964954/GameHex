/**
 * 卡牌等级曲线（等级 → 累计倍率）。不 import cc，可单测。
 *
 * 为什么要单独量一条曲线，而不是让怪物卡也去查 `cardLevelUp`：
 *   怪物卡（`monsterCard.json`，id 50001 起）和卡牌（`pvpCard.json`，id 68001 起）
 *   是同一个单位的两个 id 体系，数值一模一样但 id 对不上，
 *   无法用 `cardLevelUp` 的 (卡 id, 等级) 直接查。而需求是「怪物卡同步升级属性、
 *   不建怪物卡升级表」—— 那就只借曲线，不借绝对值：
 *
 *      怪物卡属性(level) = 怪物卡自身基础值 × 曲线倍率(level)
 *
 *   曲线从 `cardLevelUp` 实测而来（不写死 1.133），策划改成长表，
 *   怪物卡这边自动跟着变，全程不需要第二张表。
 *
 * 同一条曲线对全部卡成立，这个前提由「卡牌成长表全品级共用一条曲线」保证；
 * 这里对多张卡取中位数而不是取第一张，避免个别卡数值手滑把整条曲线带偏。
 */

import type { ZCCardLevelUpTable } from './CardUpgradeCost';

/** 从一行 attrList 里取某项；没配返回 0。 */
function statOf(row: { attrList?: readonly { statId: string; value: number }[] } | undefined, statId: string): number {
    if (!row?.attrList) return 0;
    for (const entry of row.attrList) {
        if (entry.statId === statId) return Math.max(0, entry.value);
    }
    return 0;
}

/**
 * 实测「等级 → 累计倍率」。
 *
 * 基准级优先取 Lv0（= 基础值），没有 Lv0 的卡退回 Lv1。
 * 只有同时有基准血量与该级血量的卡参与采样 —— 缺数据的卡不影响结果。
 * 返回的 Map 只含真实采到的等级，查不到就是没配这一级。
 */
export function measureLevelRates(table: ZCCardLevelUpTable): ReadonlyMap<number, number> {
    const samples = new Map<number, number[]>();
    for (const levels of table.values()) {
        const baseRow = levels.get(0) ?? levels.get(1);
        const baseHp = statOf(baseRow, 'maxHp');
        if (baseHp <= 0) continue;
        for (const [level, row] of levels) {
            const hp = statOf(row, 'maxHp');
            if (hp <= 0) continue;
            const list = samples.get(level) ?? [];
            list.push(hp / baseHp);
            samples.set(level, list);
        }
    }

    const rates = new Map<number, number>();
    for (const [level, list] of samples) {
        list.sort((a, b) => a - b);
        rates.set(level, list[Math.floor(list.length / 2)]);
    }
    return rates;
}

/** 取曲线倍率；没采到该等级就给 `null`（调用方决定回落还是报错）。 */
export function levelRateOf(rates: ReadonlyMap<number, number>, level: number): number | null {
    const lv = Math.max(0, Math.floor(Number(level) || 0));
    return rates.get(lv) ?? null;
}

/** 曲线上的最大等级（= 表里配到的最高级）。 */
export function curveMaxLevel(rates: ReadonlyMap<number, number>): number {
    let max = 0;
    for (const level of rates.keys()) {
        if (level > max) max = level;
    }
    return max;
}
