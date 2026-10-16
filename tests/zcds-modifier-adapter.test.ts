import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseZCModifierAdapterCatalogs } from '../assets/script/app/zcds/model/ZCStatSchema';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import {
    compileZCCombatBuild,
    compileZCGeneralStarLoadout,
    getZCUnitStatBreakdown,
    parseZCModifierCatalogs,
    resolveZCUnitDefinition,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillRuntimeRegistry } from '../assets/script/app/zcds/model/ZCSkillRuntime';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const unit: ZCUnitDefinition = {
    unitId: '68001', name: '精灵弓箭手', maxHp: 60, attack: 12, moveSpeed: 32,
    attackRange: 300, attackInterval: 2, attackDuration: .6, attackHitTime: .3,
    bodyRadius: 10, spawnSeconds: 7.5, flying: false, canAttackAir: true, hero: true,
    prefabPath: 'unit/test',
    prefabSize: 1,
    attackProfile: { skillId: 30151, name: '弓兵普攻', mode: 'projectile' },
};

function actualCatalogs() {
    return parseZCModifierCatalogs(readRows('skillAttrModifier'), readRows('generalStar'), {
        pvpAttrMap: readRows('pvpAttrMap'),
        pvpModifierOverride: readRows('pvpModifierOverride'),
        pvpUnitGrowth: readRows('pvpUnitGrowth'),
        pvpSkillBinding: readRows('pvpSkillBinding'),
        pvpStatus: readRows('pvpStatus'),
    });
}

test('68001 一星旧攻击 80 经 PVP 覆盖变为 8，并保留技能参数', () => {
    const loadout = compileZCGeneralStarLoadout({ generalId: 68001, star: 1 }, [unit], actualCatalogs());
    assert.equal(loadout.rawAttributes.攻击力, 80);
    assert.equal(loadout.statPatch.attackFlat, 8);
    assert.equal(loadout.typedModifiers.find((item) => item.statId === 'attack')?.value, 8);
    assert.equal(loadout.typedModifiers.find((item) => item.statId === 'projectileCount')?.value, 10);
    assert.deepEqual(loadout.unsupportedAttributes, []);
    assert.equal(resolveZCUnitDefinition(unit, [loadout]).attack, 20);
});

test('等级、升星合并后按 flat → rate 计算，并产生 UI 属性明细', () => {
    const loadouts = compileZCCombatBuild({
        unitId: '68001', level: 4, generalStar: { generalId: 68001, star: 1 },
    }, [unit], actualCatalogs());
    const resolved = resolveZCUnitDefinition(unit, loadouts);
    assert.equal(resolved.attack, 23);
    assert.equal(resolved.maxHp, 69);
    const attack = getZCUnitStatBreakdown(unit, loadouts).find((item) => item.statId === 'attack');
    assert.deepEqual({ base: attack?.base, flat: attack?.flat, rate: attack?.rate, effective: attack?.effective }, {
        base: 12, flat: 8, rate: 0.15, effective: 23,
    });
});

test('技能参数进入显式行为注册表，计数技能不执行旧脚本', () => {
    const catalogs = actualCatalogs();
    const loadout = compileZCGeneralStarLoadout({ generalId: 68001, star: 1 }, [unit], catalogs);
    const binding = catalogs.adapters.skillBindings[0];
    const runtime = new ZCSkillRuntimeRegistry().compile(binding, loadout.typedModifiers);
    assert.equal(runtime.stateMode, 'counter');
    assert.equal(runtime.parameters.projectileCount, 10);
});

test('68006 升星护盾参数绑定到当前普攻行为', () => {
    const catalogs = actualCatalogs();
    const shieldUnit: ZCUnitDefinition = {
        ...unit,
        unitId: '68006',
        attackProfile: { skillId: 30703, name: '波利奥普攻', mode: 'melee' },
    };
    const loadout = compileZCGeneralStarLoadout({ generalId: 68006, star: 1 }, [shieldUnit], catalogs);
    const binding = catalogs.adapters.skillBindings.find((item) => item.targetUnitId === '68006');
    assert.ok(binding);
    assert.equal(binding.pvpSkillId, shieldUnit.attackProfile?.skillId);
    const runtime = new ZCSkillRuntimeRegistry().compile(binding, loadout.typedModifiers);
    assert.equal(runtime.parameters.shieldRatio, 0.15);
});

test('68013 一星技能伤害参数进入当前 PVP 强化攻击', () => {
    const catalogs = actualCatalogs();
    const summoner: ZCUnitDefinition = {
        ...unit,
        unitId: '68013',
        attackProfile: { skillId: 30401, name: '驭兽师普攻', mode: 'projectile' },
    };
    const loadout = compileZCGeneralStarLoadout({ generalId: 68013, star: 1 }, [summoner], catalogs);
    const binding = catalogs.adapters.skillBindings.find((item) => item.targetUnitId === '68013');
    assert.ok(binding);
    assert.equal(binding.pvpSkillId, summoner.attackProfile?.skillId);
    const runtime = new ZCSkillRuntimeRegistry().compile(binding, loadout.typedModifiers);
    assert.equal(runtime.parameters.damageRate, 4);
});

test('同一武将的多技能参数按技能绑定隔离，不会整包串值', () => {
    const registry = new ZCSkillRuntimeRegistry();
    const bindings = [
        {
            legacySkillId: 1, pvpSkillId: 101, targetUnitId: '68001',
            behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter' as const,
            parameterKey: '撞击伤害', parameterStatId: 'damageRate' as const, enabled: true,
        },
        {
            legacySkillId: 2, pvpSkillId: 102, targetUnitId: '68001',
            behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter' as const,
            parameterKey: '爆炸伤害', parameterStatId: 'damageRate' as const, enabled: true,
        },
    ];
    const modifiers = [
        {
            sourceId: 1, sourceKind: 'generalStar' as const, targetUnitId: '68001', domain: 'skill' as const,
            statId: 'damageRate' as const, operation: 'override' as const, value: 1.5, priority: 1,
            legacyKey: '撞击伤害',
        },
        {
            sourceId: 2, sourceKind: 'generalStar' as const, targetUnitId: '68001', domain: 'skill' as const,
            statId: 'damageRate' as const, operation: 'override' as const, value: 2.5, priority: 1,
            legacyKey: '爆炸伤害',
        },
    ];
    const runtimes = registry.compileBindings(bindings, modifiers);
    assert.equal(runtimes.length, 2);
    assert.equal(runtimes.find((runtime) => runtime.skillId === 101)?.parameters.damageRate, 1.5);
    assert.equal(runtimes.find((runtime) => runtime.skillId === 102)?.parameters.damageRate, 2.5);
});

test('装备和宝石修改器通过同一构筑入口按小数倍率归一', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 1, modify: [{ type: '修改属性', data: { 攻击力百分比: 10 } }] },
        { id: 2, modify: [{ type: '修改属性', data: { 攻击力百分比: 5 } }] },
    ], [], { pvpAttrMap: readRows('pvpAttrMap') });
    const loadouts = compileZCCombatBuild({
        unitId: '68001', equipmentModifierIds: [1], gemModifierIds: [2],
    }, [unit], catalogs);
    assert.ok(Math.abs(resolveZCUnitDefinition(unit, loadouts).attack - 13.8) < 1e-9);
    assert.deepEqual(loadouts.map((item) => item.sourceKind), ['equipment', 'gem']);
});

test('多属性覆盖使用 statId.operation 字段，按目标单位集合展开', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 101, modify: [{ type: '修改属性', data: { 攻击力: 100, 生命值百分比: 50 } }] },
    ], [], {
        pvpAttrMap: readRows('pvpAttrMap'),
        pvpModifierOverride: [{
            modifierId: 101,
            targetUnitIds: '["68001","68002"]',
            valuesJson: '{"attack.add":8,"maxHp.addRate":0.2}',
            sourceKind: 'equipment',
            enabled: 1,
        }],
    });

    assert.equal(catalogs.adapters.overrides.size, 4);
    const loadouts = compileZCCombatBuild({
        unitId: '68001', equipmentModifierIds: [101],
    }, [unit], catalogs);
    const resolved = resolveZCUnitDefinition(unit, loadouts);
    assert.equal(resolved.attack, 20);
    assert.equal(resolved.maxHp, 72);
    assert.deepEqual(
        loadouts[0].typedModifiers.map(({ legacyKey, value }) => ({ legacyKey, value })),
        [{ legacyKey: '攻击力', value: 8 }, { legacyKey: '生命值百分比', value: 0.2 }],
    );
});

test('原有单属性覆盖行继续兼容', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 103, modify: [{ type: '修改属性', data: { 攻击力: 100 } }] },
    ], [], {
        pvpAttrMap: readRows('pvpAttrMap'),
        pvpModifierOverride: [{
            modifierId: 103,
            legacyKey: '攻击力',
            targetUnitId: '68001',
            domain: 'unit',
            statId: 'attack',
            operation: 'add',
            value: 7,
            sourceKind: 'equipment',
            enabled: 1,
        }],
    });
    const loadouts = compileZCCombatBuild({
        unitId: '68001', equipmentModifierIds: [103],
    }, [unit], catalogs);
    assert.equal(resolveZCUnitDefinition(unit, loadouts).attack, 19);
});

test('修改器覆盖禁止混填单属性列和多属性 JSON', () => {
    assert.throws(() => parseZCModifierCatalogs([
        { id: 102, modify: [{ type: '修改属性', data: { 攻击力: 100 } }] },
    ], [], {
        pvpAttrMap: readRows('pvpAttrMap'),
        pvpModifierOverride: [{
            modifierId: 102,
            legacyKey: '攻击力',
            targetUnitId: '68001',
            domain: 'unit',
            statId: 'attack',
            operation: 'add',
            value: 99,
            targetUnitIds: '["68001"]',
            valuesJson: '{"攻击力":8}',
            enabled: 1,
        }],
    }), /多属性模式不能同时填写单属性字段/);

    assert.throws(() => parseZCModifierCatalogs([], [], {
        pvpAttrMap: readRows('pvpAttrMap'),
        pvpModifierOverride: [{ modifierId: 102, targetUnitIds: '["68001"]', enabled: 1 }],
    }), /targetUnitIds 只能与 valuesJson 同时使用/);
});

test('选中构筑出现未映射属性时在开战前失败', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 9, modify: [{ type: '修改属性', data: { 未接入属性: 1 } }] },
    ], [], { pvpAttrMap: readRows('pvpAttrMap') });
    assert.throws(
        () => compileZCCombatBuild({ unitId: '68001', gemModifierIds: [9] }, [unit], catalogs),
        /存在未映射属性：未接入属性/,
    );
});

test('状态系统快照保存层数和剩余时间，并能无损恢复', () => {
    const source = new ZCStatusSystem().register({
        id: 'burn', name: '燃烧', durationSeconds: 3, maxStacks: 5, refreshPolicy: 'extend',
    });
    source.apply('101', 'burn', { stacks: 2, at: 1 });
    source.tick(['101'], .5);
    const snapshot = source.exportSnapshot();
    const restored = new ZCStatusSystem().register({
        id: 'burn', name: '燃烧', durationSeconds: 3, maxStacks: 5, refreshPolicy: 'extend',
    });
    restored.restore(snapshot);
    assert.deepEqual(restored.exportSnapshot(), snapshot);
    assert.equal(restored.stacksOf('101', 'burn'), 2);
    assert.equal(restored.instancesOf('101')[0].remainingSeconds, 2.5);
});

test('pvpAttrMap 占位行跳过、文本字段单独收录、纯拷贝重复折叠', () => {
    //  三类都是真实表里存在的形态，任何一类回归都会让登录期抛错、整局进不去：
    //   ① 整行占位（只有 legacyKey、statId 空）—— 跳过；
    //   ② 文本覆盖类（type/model/attackType）—— 收入独立的文本 schema；
    //   ③ 同 legacyKey 的纯拷贝（2348 行只有 2132 个不同 key）—— 内容一致就覆盖。
    const rows = readRows('pvpAttrMap');
    const blank = rows.filter((row) => row.statId == null || row.statId === '');
    const textOnly = rows.filter((row) => typeof row.sourceUnit === 'string'
        && row.sourceUnit === 'text'
        && typeof row.statId === 'string'
        && !['attack', 'maxHp', 'moveSpeed', 'attackRange', 'attackInterval', 'attackSpeed',
            'attackDuration', 'attackHitTime', 'projectileCount', 'damageRate', 'pierceCount',
            'executeChance', 'impactDamageRate', 'explosionDamageRate', 'zoneCount', 'slowRatio',
            'expireDamageRate', 'freezeDuration', 'shieldRatio', 'directionCount', 'moveSpeedBoost',
            'bannerTargetCount', 'bannerCritRate', 'empoweredEvery',
            'critRate', 'critDamage', 'bulletNum', 'bulletAngle', 'attackCount',
            'recruitCd', 'recruitMaxNum', 'singleRecruitNum', 'singleRecruitLegionCount'].includes(row.statId));
    assert.ok(blank.length > 0, `表里应有整行占位（statId 空），实际 ${blank.length}`);
    assert.ok(textOnly.length > 0, `表里应有文本覆盖类 statId，实际 ${textOnly.length}`);
    // 真能跑通 = 不抛错，且把占位/文本类都排除掉了。
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    let catalogs: ReturnType<typeof parseZCModifierAdapterCatalogs>;
    try {
        console.warn = (...args: unknown[]) => { warnings.push(args); };
        catalogs = parseZCModifierAdapterCatalogs({ pvpAttrMap: rows }, new Map());
    } finally {
        console.warn = originalWarn;
    }
    assert.deepEqual(warnings, []);
    const { attrMap, textAttrMap } = catalogs;
    assert.equal(textAttrMap.size, new Set(textOnly.map((row) => row.legacyKey)).size);
    for (const row of textOnly) {
        assert.equal(textAttrMap.get(String(row.legacyKey))?.statId, row.statId);
    }
    assert.equal(textAttrMap.get('主城类型')?.statId, 'type');
    assert.equal(textAttrMap.get('主城子弹模型')?.statId, 'model');
    assert.equal(textAttrMap.get('主城普攻类型')?.statId, 'attackType');
    //  占位行跳过，重复 legacyKey 折叠；文本和数值各有明确归属。
    const distinctKeys = new Set(rows.map((row) => row.legacyKey)).size;
    assert.ok(attrMap.size + textAttrMap.size < rows.length);
    assert.ok(attrMap.size + textAttrMap.size > distinctKeys * 0.7);
    assert.ok(attrMap.size > 1500, `attrMap 应有 1500+ 条有效映射，实际 ${attrMap.size}`);
});

test('文本覆盖值保留为字符串，单属性与多属性行都按目标单位展开', () => {
    const catalogs = parseZCModifierAdapterCatalogs({
        pvpAttrMap: [
            { legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 },
            { legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 },
            { legacyKey: '攻击力', domain: 'unit', statId: 'attack', operation: 'add', sourceUnit: 'flat', scale: 1, enabled: 1 },
        ],
        pvpModifierOverride: [
            { modifierId: 1, legacyKey: '子弹模型', targetUnitId: '68001', domain: 'skill', statId: 'model', operation: 'override', value: 'units/projectiles/ice_arrow/ice_arrow', enabled: 1 },
            { modifierId: 2, targetUnitIds: '["68001","68002"]', valuesJson: '{"普攻类型":"projectile","攻击力":8}', enabled: 1 },
        ],
    });
    assert.equal(catalogs.textOverrides.get('1:子弹模型:68001:')?.value, 'units/projectiles/ice_arrow/ice_arrow');
    assert.equal(catalogs.textOverrides.get('2:普攻类型:68002:')?.value, 'projectile');
    assert.equal(catalogs.overrides.get('2:攻击力:68001:')?.value, 8);
    assert.equal(catalogs.textOverrides.size, 3);
    assert.equal(catalogs.overrides.size, 2);
});

test('文本 schema 拒绝非法操作与非字符串覆盖值', () => {
    const textMapping = { legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 };
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [{ ...textMapping, operation: 'add' }],
    }), /pvpAttrMap\[0\]\.operation/);
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [textMapping],
        pvpModifierOverride: [{ modifierId: 1, legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', value: 3, enabled: 1 }],
    }), /pvpModifierOverride\[0\]\.value/);
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [textMapping],
        pvpModifierOverride: [{ modifierId: 1, valuesJson: '{"子弹模型":3}', enabled: 1 }],
    }), /valuesJson\.子弹模型/);
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [textMapping],
        pvpModifierOverride: [{ modifierId: 1, legacyKey: '子弹模型', domain: 'skill', statId: 'attackType', operation: 'override', value: 'projectile', enabled: 1 }],
    }), /文本覆盖与属性映射不一致/);
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [textMapping],
        pvpModifierOverride: [
            { modifierId: 1, legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', value: 'units/effects/ice/ice', enabled: 1 },
            { modifierId: 1, legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', value: 'units/effects/fire/fire', enabled: 1 },
        ],
    }), /修改器覆盖重复/);
});

test('文本多属性覆盖支持 model.override 选择器且不混入数值覆盖', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 3, modify: [{ type: '修改属性', data: { 子弹模型: 'old_arrow' } }] },
    ], [], {
        pvpAttrMap: [{ legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 }],
        pvpModifierOverride: [{ modifierId: 3, targetUnitIds: '["68001"]', valuesJson: '{"model.override":"units/projectiles/frost_arrow/frost_arrow"}', enabled: 1 }],
    });
    assert.equal(catalogs.adapters.textOverrides.get('3:子弹模型:68001:')?.value, 'units/projectiles/frost_arrow/frost_arrow');
    assert.equal(catalogs.adapters.overrides.size, 0);
});

test('文本覆盖拒绝旧数字编码和旧资源名', () => {
    const mapping = { legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 };
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [mapping],
        pvpModifierOverride: [{ modifierId: 1, legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', value: '0', enabled: 1 }],
    }), /pvpModifierOverride\[0\]\.value/);
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [{ ...mapping, legacyKey: '子弹模型', statId: 'model' }],
        pvpModifierOverride: [{ modifierId: 1, legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', value: '旧资源名', enabled: 1 }],
    }), /pvpModifierOverride\[0\]\.value/);
});

test('文本覆盖按技能绑定修改本局攻击模式和特效路径', () => {
    const path = 'units/projectiles/frost_arrow/frost_arrow';
    const catalogs = parseZCModifierCatalogs([
        { id: 31, modify: [{ type: '替换属性', data: { 普攻类型: '0', 子弹模型: '旧模型', 强化类型: '0' } }] },
    ], [], {
        pvpAttrMap: [
            { legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 },
            { legacyKey: '子弹模型', domain: 'skill', statId: 'model', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 },
            { legacyKey: '强化类型', domain: 'skill', statId: 'type', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 },
        ],
        pvpModifierOverride: [
            { modifierId: 31, targetUnitIds: '["68001"]', valuesJson: JSON.stringify({ 'attackType.override': 'melee', 'model.override': path, 'type.override': 'area' }), enabled: 1 },
        ],
        pvpSkillBinding: [
            { legacySkillId: 1, pvpSkillId: 30151, targetUnitId: '68001', behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter', parameterKey: '普攻类型', enabled: 1 },
            { legacySkillId: 1, pvpSkillId: 30151, targetUnitId: '68001', behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter', parameterKey: '子弹模型', enabled: 1 },
            { legacySkillId: 2, pvpSkillId: 30152, targetUnitId: '68001', behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter', parameterKey: '强化类型', enabled: 1 },
        ],
    });
    const base = { ...unit, empoweredProfile: { ...unit.attackProfile, skillId: 30152, mode: 'projectile' as const } };
    const loadouts = compileZCCombatBuild({ unitId: '68001', equipmentModifierIds: [31] }, [base], catalogs);
    const effective = resolveZCUnitDefinition(base, loadouts);
    assert.equal(effective.attackProfile.mode, 'melee');
    assert.equal(effective.attackProfile.effectPrefabPath, path);
    assert.equal(effective.empoweredProfile?.mode, 'area');
    assert.equal(base.attackProfile.mode, 'projectile');
});

test('技能升级档引用旧修改器时也保留文本覆盖', () => {
    const catalogs = parseZCModifierCatalogs([
        { id: 32, modify: [{ type: '替换属性', data: { 普攻类型: '0' } }] },
    ], [], {
        pvpAttrMap: [{ legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1 }],
        pvpModifierOverride: [{ modifierId: 32, legacyKey: '普攻类型', domain: 'skill', statId: 'attackType', operation: 'override', value: 'melee', enabled: 1 }],
        pvpSkillBinding: [{ legacySkillId: 1, pvpSkillId: 30151, targetUnitId: '68001', behaviorKey: 'empowered_attack', trigger: 'every_n_attacks', stateMode: 'counter', parameterKey: '普攻类型', enabled: 1 }],
        pvpSkillPlan: [{ enabled: 1, modifierId: 32, unitId: '68001', skillChainId: 1, skillLevel: 1, unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30151 }],
    });
    const loadouts = compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, [unit], catalogs);
    assert.equal(resolveZCUnitDefinition(unit, loadouts).attackProfile.mode, 'melee');
});

test('未知文本 statId 报配置错误，不能被历史文本字段的容错规则吞掉', () => {
    assert.throws(() => parseZCModifierAdapterCatalogs({
        pvpAttrMap: [{
            legacyKey: '未来文本属性', domain: 'skill', statId: 'futureTextStat',
            operation: 'override', sourceUnit: 'text', scale: 1, enabled: 1,
        }],
    }), /pvpAttrMap\[0\]\.statId 非法：futureTextStat/);
});

test('9 种新statId 都进 patch；completedAttackCount 改名后旧快照字段仍能读', async () => {
    //  ① 9 种数值 statId（2026-10-13 表补齐）在 `UNIT_STAT_IDS` / `STAT_TO_PATCH` 里都有落点。
    const SCHEMA = readFileSync('assets/script/app/zcds/model/ZCStatSchema.ts', 'utf8');
    for (const statId of ['critRate', 'critDamage', 'bulletNum', 'bulletAngle', 'attackCount',
        'recruitCd', 'recruitMaxNum', 'singleRecruitNum', 'singleRecruitLegionCount']) {
        assert.ok(SCHEMA.includes(statId + ': ['), statId + ' 应有 patch 字段映射');
    }
    //  ② `attackCount` 这个名字归「连击段数」所有；旧的「已完成的普攻次数」改名 `completedAttackCount`。
    //      旧 version 4 快照仍写 `attackCount`，decode 要能读回来。
    const CODEC = readFileSync('assets/script/app/zcds/model/ZCSnapshotCodec.ts', 'utf8');
    assert.ok(CODEC.includes('completedAttackCount'), '快照应写 completedAttackCount');
    assert.ok(CODEC.includes('data.attackCount'), 'decode 仍需兼容旧字段名');
    assert.ok(CODEC.includes('completedAttackCount'), '校验列表里应是 completedAttackCount');
});

test('7 种战斗内行为都接在真实结算点上（不是只算进 patch 就完）', () => {
    const ATTACK = readFileSync('assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts', 'utf8');
    const ECO = readFileSync('assets/script/app/zcds/model/systems/ZCEconomySystem.ts', 'utf8');
    //  ① 暴击：patch 与状态系统的暴击率相加后判定（critPct / critDamagePct）。
    assert.ok(ATTACK.includes('patch.critRatePct'), '暴击率应叠加 patch');
    assert.ok(ATTACK.includes('patch.critDamagePct'), '暴伤应叠加 patch');
    //  ② 弹幕数：加在 profile 弹数上，下限 1。
    assert.ok(ATTACK.includes('patch.bulletNumFlat'), 'bulletNum 应影响 projectileCount');
    //  ③ 弹幕角度：扇形展开；缺省 0 时行为与改造前逐字一致。
    assert.ok(ATTACK.includes('patch.bulletAngleFlat ?? 0'), 'bulletAngle 应参与方向计算');
    assert.ok(ATTACK.includes('halfSpan'), '多发应做角度均分');
    //  ④ 连击：只补伤害，不重复触发处决 / 状态挂载。
    assert.ok(ATTACK.includes('extraHitCountOf'), '连击应有独立查询');
    assert.ok(ATTACK.includes('multiHitFlat'), '连击段数应读 multiHitFlat');
    //  ⑤~⑧ 产兵四项都在 tickBarracks 里真的被消费。
    for (const field of ['recruitCdFlat', 'recruitCdPct', 'recruitMaxNumFlat',
        'singleRecruitNumFlat', 'singleRecruitLegionCountFlat']) {
        assert.ok(ECO.includes(field), `产兵逻辑应消费 ${field}`);
    }
    assert.ok(ECO.includes('context.recruitPatch?.('), 'tickBarracks 应取 recruitPatch');
});

test('新 9 种 statId 不在 ZCUnitDefinition 上（走 patch 而非 definition 改动）', () => {
    //  这9 种没有基础值，加进 `ZCUnitDefinition` 会让「表里没配 ⇒ 取 0」的语义变味。
    const CATALOG = readFileSync('assets/script/app/zcds/model/ZCCombatCatalog.ts', 'utf8');
    const body = CATALOG.slice(CATALOG.indexOf('export interface ZCUnitDefinition'),
        CATALOG.indexOf('export interface ZCUnitDefinition') + 2000);
    for (const field of ['critRate', 'bulletNum', 'recruitCd', 'singleRecruitNum']) {
        assert.ok(!body.includes(field), `ZCUnitDefinition 不该有 ${field}（应只在 patch 里）`);
    }
});
