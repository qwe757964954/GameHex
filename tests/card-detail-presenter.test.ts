import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDetailChain,
    buildDetailMilestones,
    buildDetailStats,
    detailBaseOfRow,
    parseGrowthRows,
} from '../assets/script/app/card/CardDetailPresenter';
import type { ZCArmySkillTable } from '../assets/script/app/card/CardSkillList';

const BASE = detailBaseOfRow({
    unitMaxHp: 400, unitAttack: 52, unitMoveSpeed: 32,
    unitAttackRange: 45, soilderAddTime: 21, baseHp: 800,
});

const GROWTH = parseGrowthRows([
    { unitId: '68005', level: 1, attackFlat: 0, attackRate: 0, maxHpFlat: 0, maxHpRate: 0, moveSpeedRate: 0, attackRangeFlat: 0, enabled: 1 },
    { unitId: '68005', level: 2, attackFlat: 0, attackRate: 0.05, maxHpFlat: 0, maxHpRate: 0.05, moveSpeedRate: 0, attackRangeFlat: 0, enabled: 1 },
]);

function skillTable(entries: Array<[number, string, Array<[number, number, string]>]>): ZCArmySkillTable {
    const table = new Map();
    for (const [skillId, name, levels] of entries) {
        table.set(skillId, {
            skillId,
            name,
            levels: levels.map(([level, unlockHeroLevel, desc]) => ({ skillId, level, unlockHeroLevel, skillType: 1, desc })),
        });
    }
    return table;
}

describe('buildDetailStats', () => {
    it('六维顺序与效果图一致，gain 文本带 + 号', () => {
        const stats = buildDetailStats(BASE, GROWTH, '68005', 1);
        assert.deepEqual(stats.map((line) => line.key), ['hp', 'attack', 'buildHp', 'spawn', 'range', 'speed']);
        assert.equal(stats[0].value, '400');
        assert.equal(stats[0].gain, '+20');
        assert.equal(stats[1].value, '52');
        assert.equal(stats[1].gain, '+3');        // 2.6 → 取整 +3
        assert.equal(stats[2].gain, '');          // 建筑血量不成长
        assert.equal(stats[3].value, '21');       // 生产时间
        assert.equal(stats[4].value, '45.0');     // 范围 1 位小数
        assert.equal(stats[5].value, '32.0');
    });

    it('缺列的 pvpCard 行按 0 兜底', () => {
        const stats = buildDetailStats(detailBaseOfRow({ unitMaxHp: 100 }), GROWTH, '', 1);
        assert.equal(stats[2].value, '0');
        assert.equal(stats[3].value, '0');
    });
});

describe('buildDetailChain', () => {
    const table = skillTable([
        [101, '克制', [[1, 0, '一档'], [2, 3, '二档']]],
        [102, '被动', [[1, 1, '一档']]],
    ]);

    it('按卡表顺序填格，空位补占位格（总数恒 5）', () => {
        const chain = buildDetailChain(table, [101, 102], 3);
        assert.equal(chain.length, 5);
        assert.equal(chain[0].name, '克制');
        assert.equal(chain[0].unlockLevel, 0);
        assert.equal(chain[0].unlocked, true);
        assert.equal(chain[1].name, '被动');
        assert.equal(chain[1].unlocked, true);
        assert.equal(chain[1].empty, false);
        for (let i = 2; i < 5; i++) assert.equal(chain[i].empty, true);
    });

    it('英雄等级不够 = 锁定', () => {
        const chain = buildDetailChain(table, [102], 0);
        assert.equal(chain[0].unlocked, false);
    });

    it('表里没有的技能 id 也占位，不炸', () => {
        const chain = buildDetailChain(table, [999], 5);
        assert.equal(chain[0].empty, true);
    });
});

describe('buildDetailMilestones', () => {
    const table = skillTable([
        [101, '克制', [[1, 0, '一档'], [2, 3, '二档描述'], [3, 9, '三档描述']]],
        [102, '被动', [[1, 1, '一档']]],
    ]);

    it('只收非首档且解锁等级 > 0 的行，按等级升序', () => {
        const rows = buildDetailMilestones(table, [101, 102], 3);
        assert.deepEqual(rows.map((row) => row.unlockLevel), [3, 9]);
        assert.equal(rows[0].desc, '二档描述');
        assert.equal(rows[0].unlocked, true);
        assert.equal(rows[1].unlocked, false);
    });

    it('同解锁等级同描述的行去重', () => {
        const doubled = skillTable([
            [201, 'A', [[1, 0, 'x'], [2, 6, '同文']],
            ],
            [202, 'B', [[1, 0, 'x'], [2, 6, '同文']]],
        ]);
        const rows = buildDetailMilestones(doubled, [201, 202], 1);
        assert.equal(rows.length, 1);
    });
});
