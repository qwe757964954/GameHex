import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
    LINEUP_CRIT_CHAIN_ID,
    buildCritDamageGainTable,
    critDamageGainAt,
    formatCritDamageGain,
} from '../assets/script/app/card/CardDetailCritDamage';

function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        enabled: 1,
        skillChainId: LINEUP_CRIT_CHAIN_ID,
        unitId: '68003',
        skillLevel: 1,
        statId: 'critDamage',
        operation: 'add',
        value: 1,
        ...overrides,
    };
}

describe('buildCritDamageGainTable', () => {
    it('只收 109001 链上启用的 critDamage 行，按卡 + 等级入表', () => {
        const table = buildCritDamageGainTable([
            planRow({ skillLevel: 1, value: 1 }),
            planRow({ skillLevel: 2, value: 2 }),
            planRow({ skillLevel: 3, value: 2, statId: 'critRate' }),
            planRow({ skillLevel: 4, value: 2, skillChainId: 100101 }),
            planRow({ skillLevel: 5, value: 2, enabled: 0 }),
            planRow({ skillLevel: 6, value: 0 }),
            planRow({ skillLevel: 7, value: 0.5, unitId: '68001' }),
        ]);
        const gains = table.get('68003');
        assert.deepEqual([...gains!.entries()], [[1, 1], [2, 2]]);
        assert.deepEqual([...table.get('68001')!.entries()], [[7, 0.5]]);
    });

    it('addRate 按比例折算成百分点，坏行跳过', () => {
        const table = buildCritDamageGainTable([
            planRow({ skillLevel: 9, operation: 'addRate', value: 0.03 }),
            planRow({ skillLevel: 0, value: 1 }),
            null,
            { unitId: '68003' },
        ]);
        assert.equal(table.get('68003')!.get(9), 3);
        assert.equal(table.get('68003')!.size, 1);
    });
});

describe('critDamageGainAt', () => {
    const table = buildCritDamageGainTable([
        planRow({ skillLevel: 11, value: 1 }),
        planRow({ skillLevel: 12, value: 2 }),
    ]);

    it('取「目标等级」那一行 —— 升一级加的是下一档的增量', () => {
        assert.equal(critDamageGainAt(table, '68003', 10), 1);
        assert.equal(critDamageGainAt(table, '68003', 11), 2);
    });

    it('已满级 / 没这张卡时是 0（视图据此不显示文案）', () => {
        assert.equal(critDamageGainAt(table, '68003', 12), 0);
        assert.equal(critDamageGainAt(table, '68999', 1), 0);
    });
});

describe('formatCritDamageGain', () => {
    it('整数不带小数点，半档保留一位', () => {
        assert.equal(formatCritDamageGain(2), '2%');
        assert.equal(formatCritDamageGain(0.5), '0.5%');
        assert.equal(formatCritDamageGain(1.25), '1.3%');
    });

    it('0 与非法值返回空串', () => {
        assert.equal(formatCritDamageGain(0), '');
        assert.equal(formatCritDamageGain(-1), '');
        assert.equal(formatCritDamageGain(Number.NaN), '');
    });
});

describe('真表：pvpSkillPlan 的 109001 链', () => {
    const ref = JSON.parse(readFileSync('assets/remoteRef/pvpSkillPlan.json', 'utf8'));
    const rows = (ref.v as unknown[][]).map(row => Object.fromEntries((ref.k as string[]).map((key, index) => [key, row[index]])));
    const table = buildCritDamageGainTable(rows);

    it('35 张卡 × 50 级，每级都有正增量', () => {
        assert.equal(table.size, 35);
        for (const [, byLevel] of table) {
            assert.equal(byLevel.size, 50);
            for (const [, points] of byLevel) assert.ok(points > 0);
        }
    });

    it('蓝卡 68003（火焰树妖）每升一级 +1%', () => {
        assert.equal(critDamageGainAt(table, '68003', 12), 1);
        assert.equal(formatCritDamageGain(critDamageGainAt(table, '68003', 12)), '1%');
        assert.equal(critDamageGainAt(table, '68003', 50), 0, '50 级已满，没有下一档');
    });
});
