/**
 * 卡牌等级曲线（等级转累计倍率），不 import cc，可单测。
 * 怪物卡和 pvpCard 是同一单位的两个 id 体系，没法用 cardLevelUp 按卡 id 查，
 * 所以只借曲线：怪物卡属性 = 自身基础值 × 曲线倍率。
 * 曲线从 cardLevelUp 实测，多卡取中位数，避免个别卡数值手滑带偏整条线。
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
 * 实测等级到累计倍率。基准级优先 Lv0，没有则退回 Lv1；
 * 只有基准血量和该级血量都有效的卡参与采样，返回表里只含真实采到的等级。
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
