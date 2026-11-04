import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveGrowthRow,
    computeDetailStats,
    growthMaxLevel,
    parseUnitGrowthRow,
    type ZCCardDetailBase,
} from '../assets/script/app/card/CardDetailStats';

const BASE: ZCCardDetailBase = {
    unitMaxHp: 400,
    unitAttack: 52,
    unitMoveSpeed: 32,
    unitAttackRange: 45,
    spawnSeconds: 21,
    baseHp: 800,
};

/** 椰蛋战士（68005）的真实成长表形状：每级 +5% 血攻。 */
function growthRows(): ReturnType<typeof parseUnitGrowthRow>[] {
    return [
        { unitId: '68005', level: 1, attackFlat: 0, attackRate: 0, maxHpFlat: 0, maxHpRate: 0, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
        { unitId: '68005', level: 2, attackFlat: 0, attackRate: 0.05, maxHpFlat: 0, maxHpRate: 0.05, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
        { unitId: '68005', level: 3, attackFlat: 0, attackRate: 0.1, maxHpFlat: 0, maxHpRate: 0.1, moveSpeedRate: 0, attackRangeFlat: 0, enabled: true },
    ].map((row) => parseUnitGrowthRow(row)).filter((row) => row !== null);
}

describe('parseUnitGrowthRow', () => {
    it('解析全部数值列；enabled 数字转布尔', () => {
        const row = parseUnitGrowthRow({
            unitId: '68005', level: 2, attackFlat: 0, attackRate: 0.05,
            maxHpFlat: 0, maxHpRate: 0.05, moveSpeedRate: 0, attackRangeFlat: 0, enabled: 1,
        });
        assert.ok(row);
        assert.equal(row.unitId, '68005');
        assert.equal(row.level, 2);
        assert.equal(row.attackRate, 0.05);
        assert.equal(row.enabled, true);
    });

    it('缺 unitId / level 的行返回 null（整行丢弃）', () => {
        assert.equal(parseUnitGrowthRow({ level: 2 }), null);
        assert.equal(parseUnitGrowthRow({ unitId: '68005' }), null);
        assert.equal(parseUnitGrowthRow(null), null);
    });
});

describe('resolveGrowthRow', () => {
    it('精确匹配 (unitId, level) 单行；未启用/无行按全 0', () => {
        const rows = growthRows();
        assert.ok(Math.abs(resolveGrowthRow(rows, '68005', 2).maxHpRate - 0.05) < 1e-9);
        assert.ok(Math.abs(resolveGrowthRow(rows, '68005', 3).maxHpRate - 0.1) < 1e-9);
        assert.equal(resolveGrowthRow(rows, '68005', 9).maxHpRate, 0);
        assert.equal(resolveGrowthRow(rows, '68001', 2).maxHpRate, 0);
    });
});

describe('growthMaxLevel', () => {
    it('取该 unit 的最大成长档', () => {
        assert.equal(growthMaxLevel(growthRows(), '68005'), 3);
        assert.equal(growthMaxLevel(growthRows(), '99999'), 0);
    });
});

describe('computeDetailStats', () => {
    it('level 1 = 纯基础值，增量为 level+1 差值', () => {
        const stats = computeDetailStats(BASE, growthRows(), '68005', 1);
        assert.equal(stats.unitHp.value, 400);
        assert.ok(Math.abs(stats.unitHp.gain - 20) < 1e-9);      // 400×0.05
        assert.equal(stats.unitAttack.value, 52);
        assert.ok(Math.abs(stats.unitAttack.gain - 2.6) < 1e-9);
        // 建筑血量 / 生产时间不成长
        assert.equal(stats.buildHp.value, 800);
        assert.equal(stats.buildHp.gain, 0);
        assert.equal(stats.spawnSeconds, 21);
        assert.equal(stats.maxed, false);
    });

    it('level 2 叠加成长：血量 420、攻击 54.6', () => {
        const stats = computeDetailStats(BASE, growthRows(), '68005', 2);
        assert.ok(Math.abs(stats.unitHp.value - 420) < 1e-9);
        assert.ok(Math.abs(stats.unitHp.gain - 20) < 1e-9);
        assert.ok(Math.abs(stats.unitAttack.value - 54.6) < 1e-9);
    });

    it('超过最大成长档 = 满级，增量为 0', () => {
        const stats = computeDetailStats(BASE, growthRows(), '68005', 3);
        assert.equal(stats.maxed, true);
        assert.ok(Math.abs(stats.unitHp.value - 440) < 1e-9);
        assert.equal(stats.unitHp.gain, 0);
        assert.equal(stats.unitAttack.gain, 0);
    });

    it('无成长行的 unit：值为基础值且判满级', () => {
        const stats = computeDetailStats(BASE, growthRows(), '68001', 5);
        assert.equal(stats.maxed, true);
        assert.equal(stats.unitHp.value, 400);
        assert.equal(stats.unitHp.gain, 0);
    });

    it('纯建筑卡（unitId 空）：兵种三维为 0，建筑血量保留', () => {
        const stats = computeDetailStats(BASE, growthRows(), '', 3);
        assert.equal(stats.unitHp.value, 0);
        assert.equal(stats.unitAttack.value, 0);
        assert.equal(stats.buildHp.value, 800);
        assert.equal(stats.maxed, true);
    });

    it('负数 / 非法 level 按下限 0 处理', () => {
        const stats = computeDetailStats(BASE, growthRows(), '68005', -3);
        assert.equal(stats.unitHp.value, 400);
    });
});
