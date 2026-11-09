import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cardAttackOf, formatPowerText, lineupAttackTotal } from '../assets/script/app/card/CardLineupPower';
import { parseUnitGrowthRow } from '../assets/script/app/card/CardDetailStats';
import type { ZCCardDetailBase, ZCUnitGrowthRow } from '../assets/script/app/card/CardDetailStats';

const BASE: ZCCardDetailBase = {
    unitMaxHp: 400,
    unitAttack: 52,
    unitMoveSpeed: 32,
    unitAttackRange: 45,
    spawnSeconds: 21,
    baseHp: 800,
};

/** 与 `card-detail-stats.test.ts` 同一套成长口径：椰蛋战士（68005）每级 +5% 攻。 */
function growthRows(): ZCUnitGrowthRow[] {
    return [
        { unitId: '68005', level: 1, attackFlat: 0, attackRate: 0, maxHpFlat: 0, maxHpRate: 0, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
        { unitId: '68005', level: 2, attackFlat: 0, attackRate: 0.05, maxHpFlat: 0, maxHpRate: 0.05, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
        { unitId: '68005', level: 3, attackFlat: 0, attackRate: 0.1, maxHpFlat: 0, maxHpRate: 0.1, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
    ].map((row) => parseUnitGrowthRow(row)!);
}

describe('cardAttackOf', () => {
    it('单卡攻击 = pvpCard 白值 × 等级成长（与详情页「攻击」同源）', () => {
        const rows = growthRows();
        const at = (level: number): number => cardAttackOf(
            { cardId: '68005', base: BASE, unitId: '68005', level, levelAttrs: null },
            rows,
        );
        assert.equal(at(1), 52);
        assert.ok(Math.abs(at(2) - 52 * 1.05) < 1e-9);
        assert.ok(Math.abs(at(3) - 52 * 1.1) < 1e-9);
    });

    it('建筑卡（unitId 为空）攻击恒为 0，不参与战力', () => {
        const rows = growthRows();
        assert.equal(cardAttackOf(
            { cardId: '71001', base: BASE, unitId: '', level: 3, levelAttrs: null },
            rows,
        ), 0);
    });

    it('cardLevelUp.attrList 配了绝对值时覆盖成长值（养成属性优先）', () => {
        const rows = growthRows();
        const withAttrs = cardAttackOf(
            { cardId: '68005', base: BASE, unitId: '68005', level: 3, levelAttrs: { maxHp: 900, attack: 130, buildingHp: 0 } },
            rows,
        );
        assert.equal(withAttrs, 130);
    });
});

describe('lineupAttackTotal', () => {
    it('阵容战力 = 上阵卡攻击之和（8 张同卡 3 级）', () => {
        const rows = growthRows();
        const inputs = Array.from({ length: 8 }, () => ({
            cardId: '68005', base: BASE, unitId: '68005', level: 3, levelAttrs: null,
        }));
        // 8 × 52 × 1.1 = 457.6 → 取整 458
        assert.equal(lineupAttackTotal(inputs, rows), 458);
    });

    it('建筑卡混在阵容里贡献 0，不拉高也不拉低', () => {
        const rows = growthRows();
        const inputs = [
            { cardId: '68005', base: BASE, unitId: '68005', level: 1, levelAttrs: null },
            { cardId: '71001', base: BASE, unitId: '', level: 1, levelAttrs: null },
        ];
        assert.equal(lineupAttackTotal(inputs, rows), 52);
    });

    it('空阵容返回 0（调用方据此保留占位，不显示「战力 0」）', () => {
        assert.equal(lineupAttackTotal([], growthRows()), 0);
    });

    it('等级不在成长表里时按基础值算，不会变成 NaN', () => {
        const rows = growthRows();
        const value = lineupAttackTotal(
            [{ cardId: '68005', base: BASE, unitId: '68005', level: 99, levelAttrs: null }],
            rows,
        );
        assert.equal(Number.isFinite(value), true);
        assert.equal(value, 52);
    });
});

describe('formatPowerText', () => {
    it('万元以下照原样，万位起缩写并去掉尾随 0', () => {
        assert.equal(formatPowerText(0), '0');
        assert.equal(formatPowerText(1716), '1716');
        assert.equal(formatPowerText(9999), '9999');
        assert.equal(formatPowerText(15980), '15.98K');
        assert.equal(formatPowerText(12000), '12K');
        assert.equal(formatPowerText(12500), '12.5K');
        assert.equal(formatPowerText(1234567), '1.23M');
    });

    it('非有限值 / 负数按 0', () => {
        assert.equal(formatPowerText(Number.NaN), '0');
        assert.equal(formatPowerText(-5), '0');
        assert.equal(formatPowerText(Number.POSITIVE_INFINITY), '0');
    });
});
