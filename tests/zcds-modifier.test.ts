import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    mergeSkillAttrModifierRows,
    ZCModifierExecutor,
} from '../assets/script/app/zcds/model/ZCModifierEngine';
import { mapModifierCommand } from '../assets/script/app/zcds/model/ZCModifierMapper';
import {
    compileZCGeneralStarLoadout,
    parseZCModifierCatalogs,
    resolveZCUnitDefinition,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';

test('skillAttrModifier 同 id 多行按顺序合并并执行属性修改', () => {
    const catalog = mergeSkillAttrModifierRows([
        { id: 10, modify: [{ type: '修改属性', data: { 攻击力: 20 } }] },
        { id: 10, modify: [{ type: '修改属性', data: { 攻击力: 5, 连射数量: 3 } }] },
        { id: 11, modify: [{ type: '替换属性', data: { 连射数量: 8 } }] },
    ]);
    const result = new ZCModifierExecutor().execute([10, 11], catalog);
    assert.equal(result.attributes.攻击力, 25);
    assert.equal(result.attributes.连射数量, 8);
});

test('行为型旧修改器保留为占城命令', () => {
    const catalog = mergeSkillAttrModifierRows([
        { id: 20, modify: [{ type: '添加召唤物', data: { monster: 123 } }] },
    ]);
    const result = new ZCModifierExecutor().execute([20], catalog);
    assert.deepEqual(result.commands, [{ modifierId: 20, type: '添加召唤物', data: { monster: 123 } }]);
});

test('数组型 buff 数据不会在解析阶段丢失', () => {
    const catalog = mergeSkillAttrModifierRows([
        { id: 30, modify: [{ type: '添加兵种buff列表', data: [{ 兵种: '弓兵', buff: '连射' }] }] },
    ]);
    const command = new ZCModifierExecutor().execute([30], catalog).commands[0];
    assert.deepEqual(command.data, [{ 兵种: '弓兵', buff: '连射' }]);
    assert.deepEqual(mapModifierCommand(command), [{
        kind: 'addStatus', modifierId: 30, statusName: '连射', unitName: '弓兵',
    }]);
});

const unit: ZCUnitDefinition = {
    unitId: '68001', name: '精灵弓箭手', maxHp: 60, attack: 12, moveSpeed: 100,
    attackRange: 300, attackInterval: 1, attackDuration: .6, attackHitTime: .3,
    bodyRadius: 10, spawnSeconds: 1, flying: false, canAttackAir: true, hero: true,
    prefabPath: 'unit/test',
    attackProfile: { skillId: 30151, name: '普攻', mode: 'projectile' },
};

test('generalStar 编译为指定武将的通用数值与后续技能效果', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 100, modify: [{ type: '添加武将', data: { monster: 68001, 兵种: '弓兵', 技能: [30151] } }] },
        { id: 101, modify: [{ type: '修改属性', data: { 攻击力: 80, 弓兵武将技能箭矢数量: 10 } }] },
        { id: 102, modify: [{ type: '修改属性', data: { 攻击速度百分比: 20 } }] },
    ], [
        { id: 68001, star: 1, modify: [100, 101], impactData: [102] },
    ]);
    const loadout = compileZCGeneralStarLoadout({ generalId: 68001, star: 1 }, [unit], catalogs);
    assert.deepEqual(loadout.appliedModifierIds, [100, 101, 102]);
    assert.deepEqual(loadout.legacyAttributeOperations, [
        { mode: 'add', values: { 攻击力: 80, 弓兵武将技能箭矢数量: 10 } },
        { mode: 'add', values: { 攻击速度百分比: 20 } },
    ]);
    assert.deepEqual(loadout.statPatch, { attackFlat: 80, attackSpeedPct: 20 });
    assert.deepEqual(loadout.unsupportedAttributes, ['弓兵武将技能箭矢数量']);
    assert.equal(loadout.effects[0].kind, 'addUnit');

    const resolved = resolveZCUnitDefinition(unit, [loadout]);
    assert.equal(resolved.attack, 92);
    assert.equal(resolved.attackInterval, .8);
    assert.equal(unit.attack, 12, '不得修改全局单位目录');
    assert.equal(unit.attackInterval, 1);
});

test('显式选择不存在的星级会失败，不会静默生成空修正', () => {
    const catalogs = parseZCModifierCatalogs([], []);
    assert.throws(
        () => compileZCGeneralStarLoadout({ generalId: 68001, star: 9 }, [unit], catalogs),
        /generalStar 不存在：68001:9/,
    );
});

test('当前 remoteRef 可把 68001 一星攻击力修正编译为有效属性', () => {
    const modifierRows = JSON.parse(readFileSync('assets/remoteRef/skillAttrModifier.json', 'utf8'));
    const generalStarRows = JSON.parse(readFileSync('assets/remoteRef/generalStar.json', 'utf8'));
    const catalogs = parseZCModifierCatalogs(modifierRows, generalStarRows);
    const loadout = compileZCGeneralStarLoadout({ generalId: 68001, star: 1 }, [unit], catalogs);
    assert.equal(loadout.rawAttributes.攻击力, 80);
    assert.equal(loadout.statPatch.attackFlat, 80);
    assert.ok(loadout.appliedModifierIds.includes(36800796));
});
