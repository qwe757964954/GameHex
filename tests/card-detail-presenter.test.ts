import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildDetailChain,
    buildDetailMilestones,
    buildDetailStats,
    detailBaseOfRow,
    milestoneAnchorIndex,
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

    it('按卡表顺序出格，几个技能就几格（不再补空占位）', () => {
        const chain = buildDetailChain(table, [101, 102], 3);
        assert.equal(chain.length, 2, '每张卡只有 4 个技能，补第 5 格会多出个假技能');
        assert.equal(chain[0].name, '克制');
        assert.equal(chain[0].unlockLevel, 0);
        assert.equal(chain[0].unlocked, true);
        assert.equal(chain[1].name, '被动');
        assert.equal(chain[1].unlocked, true);
        assert.equal(chain[1].empty, false);
    });

    it('最多 5 格：多配的技能只进里程碑，不撑破横排', () => {
        const many = skillTable([
            [201, 'A', [[1, 0, 'x']]], [202, 'B', [[1, 0, 'x']]], [203, 'C', [[1, 0, 'x']]],
            [204, 'D', [[1, 0, 'x']]], [205, 'E', [[1, 0, 'x']]], [206, 'F', [[1, 0, 'x']]],
        ]);
        assert.equal(buildDetailChain(many, [201, 202, 203, 204, 205, 206], 1).length, 5);
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

    it('每个技能的每一档都出列（含首档），按解锁等级升序且行内带技能名', () => {
        const rows = buildDetailMilestones(table, [101, 102], 3);
        assert.deepEqual(rows.map((row) => row.unlockLevel), [0, 1, 3, 9]);
        assert.deepEqual(rows.map((row) => row.name), ['克制', '被动', '克制', '克制']);
        assert.equal(rows[0].desc, '一档');
        assert.equal(rows[0].unlocked, true, '解锁等级 0 = 一级就有');
        assert.equal(rows[2].unlocked, true);
        assert.equal(rows[3].unlocked, false);
    });

    it('同等级同描述的不同技能各留一行；同一技能重复配置只留一次', () => {
        const doubled = skillTable([
            [201, 'A', [[1, 0, 'x'], [2, 6, '同文']]],
            [202, 'B', [[1, 0, 'x'], [2, 6, '同文']]],
        ]);
        assert.deepEqual(
            buildDetailMilestones(doubled, [201, 202], 1).map((row) => `${row.name}@${row.unlockLevel}`),
            ['A@0', 'B@0', 'A@6', 'B@6'],
        );
        assert.equal(buildDetailMilestones(doubled, [201, 201], 1).length, 2, '同一技能列两次不重复出列');
    });

    it('描述为空的档整档不出列（表里有 24 个技能 72 行 desc/name 全空）', () => {
        const partial = skillTable([
            [301, '有描述', [[1, 0, '一档'], [2, 9, '二档']]],
            [302, '', [[1, 0, ''], [2, 9, '   ']]],
        ]);
        assert.deepEqual(
            buildDetailMilestones(partial, [301, 302], 0).map((row) => `${row.name}@${row.unlockLevel}`),
            ['有描述@0', '有描述@9'],
            '空描述 / 纯空白的档一并滤掉',
        );
        assert.equal(buildDetailMilestones(partial, [302], 0).length, 0, '整个技能都没描述 = 一行不剩');
    });
});

describe('milestoneAnchorIndex', () => {
    const rows = (levels: Array<[number, boolean]>) =>
        levels.map(([unlockLevel, unlocked]) => ({ name: `技能${unlockLevel}`, unlockLevel, desc: `${unlockLevel}档`, unlocked }));

    it('落在最新解锁的那一档（不删行，历史档位仍在上方可滚）', () => {
        assert.equal(milestoneAnchorIndex(rows([[0, true], [6, true], [14, false], [16, false]])), 1);
    });

    it('一档都没解锁时落在第一行', () => {
        assert.equal(milestoneAnchorIndex(rows([[14, false], [16, false]])), 0);
    });

    it('全部解锁时退一格，让最后两档同屏', () => {
        assert.equal(milestoneAnchorIndex(rows([[14, true], [16, true], [18, true], [20, true]])), 2);
        assert.equal(milestoneAnchorIndex(rows([[14, true]])), 0);
    });

    it('空列表为 0', () => {
        assert.equal(milestoneAnchorIndex([]), 0);
    });

    it('覆盖活数据：12 级火焰树妖的落点是「灼热地带」那一档', () => {
        const table = skillTable([
            [100301, '魔力塑能', [[1, 0, '攻击提高10%'], [2, 14, '攻击提高10%'], [3, 22, '攻击提高10%']]],
            [100302, '魔力回路', [[1, 6, '射程提高10%'], [2, 16, '射程提高10%'], [3, 23, '射程提高10%']]],
            [100303, '点燃', [[1, 9, '点燃10%'], [2, 18, '点燃15%'], [3, 24, '点燃20%']]],
            [100304, '灼热地带', [[1, 12, '灼热35%'], [2, 20, '灼热55%'], [3, 25, '灼热75%']]],
        ]);
        const all = buildDetailMilestones(table, [100301, 100302, 100303, 100304], 12);
        assert.equal(all.length, 12, '4 个技能 × 3 档全部在列表里');
        const anchor = milestoneAnchorIndex(all);
        assert.deepEqual(all.map((row) => row.unlockLevel)[anchor], 12);
        assert.equal(all[anchor].name, '灼热地带');
    });
});
