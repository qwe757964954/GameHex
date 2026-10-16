import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCStatusResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCStatusResolutionSystem';
import { configureZCMap, type ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import {
    compileZCLegacyExpression,
    parseZCLegacySkillEffectConfig,
    parseZCLegacySkillViewBindings,
    ZCLegacySkillEffectRuntime,
} from '../assets/script/app/zcds/model/ZCLegacySkillEffect';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('受限表达式支持旧客户端公式语法且不能越过白名单访问原型', () => {
    const attr = {
        GetValue: (key: string) => ({ 攻击: 20, 加成: 50 }[key] ?? 0),
        random: () => .25,
        randomInt: (min: number, max: number) => min + Math.floor(.5 * (max - min + 1)),
    };
    const formula = compileZCLegacyExpression("(attr.GetValue('攻击')*2)*(1+attr.GetValue('加成')*.01)");
    assert.equal(formula({ attr }), 60);
    assert.equal(compileZCLegacyExpression('attr.randomInt(0,100)<=50')({ attr }), true);
    assert.throws(() => compileZCLegacyExpression('attr.constructor')({ attr }), /禁止访问成员/);
    assert.throws(() => compileZCLegacyExpression('globalThis.process()')({}), /非函数/);
});

test('真实 skillView/skillEffect/skillAttr 可完整编译并复现长枪兵公式', () => {
    const empoweredByNormal = new Map(rows('pvpSkill').map((row) => [
        Number(row.skillId), Number(row.empoweredSkillId) || undefined,
    ]));
    const bindings = parseZCLegacySkillViewBindings(rows('skillView'), empoweredByNormal);
    const referenced = new Set(Object.values(bindings).flat());
    const config = parseZCLegacySkillEffectConfig(
        rows('skillAttr'), rows('skillEffect'), rows('skillBuff'), rows('pvpStatus'), referenced,
    );
    assert.deepEqual(bindings[30171], ['长枪兵_普攻']);
    assert.deepEqual(bindings[36171], ['长枪兵_武将普攻']);
    // Several legacy skillView rows left exSkillId empty; current pvpSkill owns
    // that binding, so exHurt must still reach the empowered profile.
    assert.deepEqual(bindings[36181], ['火法师_武将火球术']);
    assert.equal(Object.keys(config.effectsByKey).length, referenced.size);

    const runtime = new ZCLegacySkillEffectRuntime(config);
    const normal = runtime.evaluate(bindings[30171], {
        random: () => .5,
        attributes: { 角色攻击力: 100 },
        targetId: 7,
    });
    const empowered = runtime.evaluate(bindings[36171], {
        random: () => .5,
        attributes: { 角色攻击力: 100 },
        targetId: 7,
    });
    assert.equal(normal.hasDamageFormula, true);
    assert.equal(normal.damage, 196);
    assert.equal(empowered.damage, 470.4);
    assert.equal(runtime.evaluate(bindings[30251], {
        random: () => .5, attributes: { 角色攻击力: 100 }, targetId: 7,
    }).range, 100);
});

test('buff 条件只抽一次随机并把 skillBuff 默认参数与公式覆盖合并', () => {
    let draws = 0;
    const runtime = new ZCLegacySkillEffectRuntime(parseZCLegacySkillEffectConfig(
        [{ key: '概率', type: 'number', value: '50' }],
        [{ key: '测试攻击', effects: [
            { condiction: '默认', script: '基础伤害', effect: { 基础伤害: "attr.GetValue('角色攻击力')*2" } },
            { condiction: "attr.randomInt(0,100)<=attr.GetValue('概率')", script: 'buff', effect: {
                id: '测试眩晕', param: { 持续时间秒: "attr.GetValue('概率')*.02" },
            } },
        ] }],
        [{ key: '测试眩晕', param: { 持续时间秒: 3, 叠加上限: 2 } }],
        [{ legacyBuffKey: '测试眩晕', statusId: 'test_stun' }],
    ));
    const result = runtime.evaluate(['测试攻击'], {
        random: () => { draws += 1; return .4; },
        attributes: { 角色攻击力: 10 },
    });
    assert.equal(draws, 1);
    assert.equal(result.damage, 20);
    assert.deepEqual(result.buffs, [{
        legacyKey: '测试眩晕', params: { 持续时间秒: 1, 叠加上限: 2 }, sourceAttack: 10,
    }]);
    assert.equal(runtime.config.legacyStatusIds['测试眩晕'], 'test_stun');
});

test('旧效果表跨段复制的相同行只执行一次，段内重复仍保留', () => {
    const damage = { condiction: '默认', script: '基础伤害', effect: { 基础伤害: '10' } };
    const rows = [
        { key: 'A', effects: [damage, damage] },
        { key: 'B', effects: [] },
        { key: 'A', effects: [damage] },
    ];
    const runtime = new ZCLegacySkillEffectRuntime(parseZCLegacySkillEffectConfig([], rows, [], []));
    assert.equal(runtime.evaluate(['A'], { random: () => .5, attributes: {} }).damage, 20);
});

test('正式战斗优先使用旧公式，弹道快照恢复不重抽公式与 buff', () => {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
        'skillAttr', 'skillView', 'skillEffect', 'skillBuff',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
    const captured = captureZCMatchConfig();
    const sourceDefinition = captured.units.find((item) => item.attackProfile.skillId === 30171)!;
    const config = captureZCMatchConfig({
        ...captured,
        rules: { ...captured.rules, combatDamageMultiplier: 1, combatDistanceScale: 1 },
        units: captured.units.map((item) => item.unitId === sourceDefinition.unitId ? {
            ...item,
            attack: 100,
            attackProfile: { ...item.attackProfile, mode: 'projectile' as const, projectileSpeed: 100 },
        } : item),
    });
    const makeUnit = (id: number, owner: ZCOwner, x: number): ZCUnitState => ({
        id, owner, unitId: sourceDefinition.unitId,
        cardId: owner === 'player' ? String(config.playerDeck.find((card) => card.unitId === sourceDefinition.unitId)!.id) : String(config.enemyDeck[0].id),
        tier: 1, sourceHexId: owner === 'player' ? config.map.playerHomeId : config.map.enemyHomeId,
        targetHexId: null, progress: 0, hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: owner === 'player' ? 2 : 1, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 999, waitUntil: 999, attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    });
    const snapshot = ZCGameModel.createInitialState(() => .25, config);
    snapshot.units = [makeUnit(1, 'player', -50), makeUnit(2, 'enemy', 50)];
    snapshot.nextUnitId = 3;
    const model = new ZCGameModel(snapshot, () => .25, config);
    const source = (model as any).state.units[0] as ZCUnitState;
    (model as any).sendAttack(source);
    const projectile = model.snapshot.projectiles[0];
    assert.ok(projectile);
    // The match's current tier/deck attack scaling raises the standalone 196 formula result.
    assert.equal(projectile.baseDamage, 207.2);
    assert.deepEqual(projectile.legacyBuffs, []);

    const restored = new ZCGameModel(model.snapshot, () => { throw new Error('恢复在途弹道不应重算公式'); }, config);
    assert.deepEqual(restored.snapshot.projectiles[0].legacyBuffs, []);
    assert.equal(restored.snapshot.projectiles[0].baseDamage, 207.2);
});

test('启用旧状态时，燃烧、流血、撕裂、击退和牵引可结算并恢复', () => {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
        'skillAttr', 'skillView', 'skillEffect', 'skillBuff',
    ];
    const tables = Object.fromEntries(names.map((name) => [name, rows(name)])) as unknown as ZCPvpTables;
    const enabledLegacyKeys = new Set(['燃烧', '流血', '撕裂', '击退', '牵引']);
    tables.pvpStatus = rows('pvpStatus').map((row) => enabledLegacyKeys.has(String(row.legacyBuffKey))
        ? { ...row, enabled: 1, periodicBasis: row.handlerKey === 'periodic_damage' ? 'senderAttack' : null }
        : row);
    loadPvpTables(tables);
    configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));
    const baseConfig = captureZCMatchConfig();
    const config = captureZCMatchConfig({
        ...baseConfig,
        map: { ...baseConfig.map, playerCount: 4 },
    });
    const definition = config.units.find((item) => item.attackProfile.skillId === 30171)!;
    const makeUnit = (id: number, owner: ZCOwner, x: number): ZCUnitState => ({
        id, owner, unitId: definition.unitId,
        cardId: owner === 'player'
            ? String(config.playerDeck.find((card) => card.unitId === definition.unitId)!.id)
            : String(config.enemyDeck[0].id),
        tier: 1, sourceHexId: owner === 'player' ? config.map.playerHomeId : config.map.enemyHomeId,
        targetHexId: null, progress: 0, hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: owner === 'player' ? 2 : 1, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 999, waitUntil: 999, attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    });
    const snapshot = ZCGameModel.createInitialState(() => .5, config);
    snapshot.units = [
        makeUnit(1, 'player', 0),
        makeUnit(2, 'enemy', 60),
        makeUnit(3, 'enemy2', 80),
        makeUnit(4, 'enemy3', 120),
    ];
    snapshot.nextUnitId = 5;
    const model = new ZCGameModel(snapshot, () => .5, config);
    const source = (model as any).state.units[0] as ZCUnitState;
    const target = (model as any).state.units[1] as ZCUnitState;
    const targetMaxHp = (model as any).effectiveUnitDefinition(target).maxHp as number;
    target.maxHp = targetMaxHp;
    target.hp = targetMaxHp;

    const buff = (legacyKey: string, params: Record<string, unknown>) => ({ legacyKey, params, sourceAttack: 100 });
    // Burn stacks twice: 100 attack × 25% coefficient × 2 stacks = 50.
    (model as any).applyLegacyBuffs(target, [buff('燃烧', {
        伤害系数: .25, 伤害间隔: .5, 叠加上限: 2, 持续时间秒: 2,
    })], source.id);
    (model as any).applyLegacyBuffs(target, [buff('燃烧', {
        伤害系数: .25, 伤害间隔: .5, 叠加上限: 2, 持续时间秒: 2,
    })], source.id);
    // Bleed and rend share TF_BuffSustainHurt semantics.
    (model as any).applyLegacyBuffs(target, [buff('流血', {
        伤害系数: .1, 伤害间隔: .5, 叠加上限: 5, 持续时间秒: 2,
    }), buff('撕裂', {
        伤害系数: .2, 伤害间隔: .5, 叠加上限: 10, 持续时间秒: 2,
    })], source.id);
    assert.equal((model as any).statusSystem.stacksOf('2', 'burn'), 2);

    // Repel is immediate and away from the sender.
    (model as any).applyLegacyBuffs(target, [buff('击退', { 击退距离: 10 })], source.id);
    assert.equal(target.freeX, 60 + 10 * config.rules.combatDistanceScale);

    // Traction lives on the caster and continuously pulls all hostiles in range.
    const targetPayload = (model as any).applyLegacySelfBuffs(source, [buff('牵引', {
        牵引范围: 300, 牵引力度: 40, 持续时间秒: -1,
    })]);
    assert.deepEqual(targetPayload, []);
    assert.equal((model as any).statusSystem.instancesOf('1')[0].runtimeBehavior.kind, 'legacyTraction');

    const frozen = model.snapshot;
    const restored = new ZCGameModel(frozen, () => .5, config);
    for (const current of [model, restored]) {
        (current as any).state.elapsedSeconds = .5;
        ZCStatusResolutionSystem.tick((current as any).state, .5, (current as any).statusResolutionContext);
    }
    assert.deepEqual(
        JSON.parse(JSON.stringify(restored.snapshot.statusEffects)),
        JSON.parse(JSON.stringify(model.snapshot.statusEffects)),
    );
    assert.equal((model as any).state.units[1].freeX,
        60 + 10 * config.rules.combatDistanceScale - 40 * config.rules.combatDistanceScale * .5);
    assert.equal((model as any).state.units[2].freeX,
        80 - 40 * config.rules.combatDistanceScale * .5);
    assert.equal((model as any).state.units[3].freeX, 120);
    assert.equal(Math.round((model as any).state.units[1].hp), targetMaxHp - 80); // 50 burn + 10 bleed + 20 rend
});
