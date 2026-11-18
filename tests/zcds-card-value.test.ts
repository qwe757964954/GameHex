import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseUnits, normalizeCardRow } from '../assets/script/app/zcds/model/ZCPvpTableParser';
import type { ZCAttackProfile } from '../assets/script/app/zcds/model/ZCCombatCatalog';

const packed = JSON.parse(readFileSync('assets/remoteRef/pvpCard.json', 'utf8')) as {
    k: string[]; v: unknown[][];
};
const rows: Record<string, unknown>[] = Array.isArray(packed) ? packed
    : packed.v.map(values => Object.fromEntries(packed.k.map((key, index) => [key, values[index]])));
const unitRows = rows.filter(row => row.unitPrefabPath);
const skills = new Map<number, ZCAttackProfile>(unitRows.map(row => [Number(row.unitSkillId), { skillId: Number(row.unitSkillId), name: 'fixture', mode: 'melee' }]));

test('价值系数解析：旧表空值默认1，有限正数透传，非法值报字段错误', () => {
    assert.ok(unitRows.length > 0);
    const row = unitRows[0];
    for (const value of [undefined, null, '', 0.65, 1, 1.25]) {
        const definition = parseUnits([{ ...row, unitValueFactor: value }], skills).values().next().value;
        assert.equal(definition.valueFactor, typeof value === 'number' ? value : 1);
    }
    for (const value of [0, -1, NaN, Infinity, '0.65', false, {}]) {
        assert.throws(() => parseUnits([{ ...row, unitValueFactor: value }], skills), /unitValueFactor/);
    }
});

test('首版35张兵种卡有差异价值，建筑卡留空，归一和解析完整透传', () => {
    assert.equal(unitRows.length, 35);
    const definitions = parseUnits(rows.map(normalizeCardRow), skills);
    assert.equal(definitions.size, unitRows.length);
    const values = new Set<number>();
    for (const row of rows) {
        assert.ok(Object.hasOwn(row, 'unitValueFactor'), `${row.id} 缺价值列`);
        if (!row.unitPrefabPath) {
            assert.equal(row.unitValueFactor, null);
            continue;
        }
        const value = row.unitValueFactor;
        assert.ok(typeof value === 'number' && Number.isFinite(value) && value > 0, `${row.id} 非法价值`);
        assert.equal(definitions.get(String(row.unitId ?? row.id)).valueFactor, value);
        values.add(value);
    }
    assert.ok(values.size > 1, '首版必须包含差异权重');
    assert.equal(definitions.get('68024').valueFactor, 0.65, '治疗/群控核心');
    assert.equal(definitions.get('68002').valueFactor, 1.25, '基础纯坦');
    assert.equal(definitions.get('68033').valueFactor, 0.75, '高频攻击与眩晕战士');
});
