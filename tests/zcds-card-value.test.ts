import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GAME_END_PREFAB_SIZE_LIMIT,
    normalizeCardRow,
    parseUnits,
} from '../assets/script/app/zcds/model/ZCPvpTableParser';
import type { ZCAttackProfile } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { readRefRows } from './helpers/ref-kvc';

const rows = readRefRows('pvpCard');
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
    // ⚠️ 「列被整列冲掉」只能按**表级**判：导表对空值列是**整行省略**的
    //    （主城 / 金矿就没有 `unitValueFactor` 这个键），所以逐行 `Object.hasOwn` 一定会误报。
    //    真正的故障形态是 37 行里一行都不带这一列 —— 那才是列被冲掉。
    assert.ok(rows.some(row => Object.hasOwn(row, 'unitValueFactor')),
        'pvpCard 整列缺 unitValueFactor（导表把它冲掉了？）');
    const definitions = parseUnits(rows.map(normalizeCardRow), skills);
    assert.equal(definitions.size, unitRows.length);
    const values = new Set<number>();
    for (const row of rows) {
        // 缺键 = 留空，与显式 null 同义（`normalizeCardRow` 也按 null 处理）。
        const value = (row.unitValueFactor ?? null) as number | null;
        if (!row.unitPrefabPath) {
            assert.equal(value, null, `${row.id} 建筑卡应留空价值`);
            continue;
        }
        assert.ok(typeof value === 'number' && Number.isFinite(value) && value > 0, `${row.id} 非法价值`);
        assert.equal(definitions.get(String(row.unitId ?? row.id)).valueFactor, value);
        values.add(value);
    }
    assert.ok(values.size > 1, '首版必须包含差异权重');
    // 权重阶梯在 11-20 重排过一轮：细粒度系数（0.65 / 1.25 / 0.75）收敛成 1 / 1.1 / 1.5 / 1.8 四档。
    assert.equal(definitions.get('68024').valueFactor, 1, '治疗/群控核心');
    assert.equal(definitions.get('68002').valueFactor, 1.8, '基础纯坦');
    assert.equal(definitions.get('68033').valueFactor, 1.5, '高频攻击与眩晕战士');
});

test('结算体型上限：真表解析后每张兵种卡 ≤1.2，磁电菇 prefabSize 1.8 但结算只用 1.2', () => {
    const definitions = parseUnits(rows.map(normalizeCardRow), skills);
    for (const definition of definitions.values()) {
        assert.ok(definition.gameEndPrefabSize <= GAME_END_PREFAB_SIZE_LIMIT + 1e-9,
            `${definition.unitId} 的结算体型 ${definition.gameEndPrefabSize} 超过上限`);
        assert.equal(definition.gameEndPrefabSize,
            Math.min(definition.prefabSize, GAME_END_PREFAB_SIZE_LIMIT),
            `${definition.unitId} 的结算体型必须是 min(prefabSize, 上限)`);
    }
    const magdi = definitions.get('68016');
    assert.ok(magdi, '真表里找不到 68016 磁电菇');
    assert.equal(magdi!.prefabSize, 1.8, '战场口径不受影响');
    assert.equal(magdi!.gameEndPrefabSize, 1.2, '结算口径被上限收到 1.2');
});
