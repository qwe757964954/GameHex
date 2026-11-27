/**
 * 第 37 批：巨力坚果 68002「巨力护盾」100204 的护盾表现。
 * 🔴 2026-11-25 设计案统一命名：原「亡者护盾」→「巨力护盾」。
 *
 * 用户原话：「巨力坚果没有释放刀盾兵的护盾效果」。
 *
 * 🔴 病灶不是「盾没上」——`applySelfShield` 一直是好的（每 12 秒一次、30% 最大生命）。
 *    缺的是**表现**：这条技能写在参数袋车道（`behaviorKey = skill_params`、`triggerEvent = active`）上，
 *    既没有 `pvpSkill.effectPrefabPath`，也没进 `ZCVisualResourcePlan` ⇒ 结算正常、画面全无。
 *
 * 🔴 三个必须同时成立的环节，缺一个就是「盾上了但看不见」：
 *    ① 事件要真被推出来（本文件第二、三节）；
 *    ② 路径要进本局资源清单（第四节，`ZC_EFFECT_PATHS.dashGuard` 的按单位覆盖）；
 *    ③ 时长必须按帧数走完（17 帧 @12fps），拍短了动画截断、拍成 `shieldSeconds` 会钉在原地十几秒。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcWarmupEffectPaths } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { ZC_DASH_GUARD_SECONDS } from '../assets/script/app/zcds/model/ZCDashFx';
import { ZC_EFFECT_TUNING } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const UNIT_ID = '68002';
const CHAIN = 100204;
const SKILL_ID = 30802;
/** 与配表逐字一致（三档只差护盾时长）。*/
const SHIELD_SECONDS = [10, 11, 12];
const UNLOCKS = [7, 24, 36];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClient(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(
        `D:/Alan/Project/POW/doc/塔防数据配置/json/client/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { data: Array<Record<string, unknown>> };
    return Array.isArray(source) ? source : source.data;
}

function prepare(): ZCMatchConfig {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

/** 按兵种等级编译这一档的构筑（27 级 ⇒ 100204 的 II 级那行）。*/
function buildMatch(heroLevel = 27): ZCMatchConfig {
    const captured = prepare();
    const loadout = compileZCCombatBuild({ unitId: UNIT_ID, heroLevel }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    return {
        ...captured,
        rules: {
            ...captured.rules,
            combatDistanceScale: 1, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000,
        },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as ZCMatchConfig;
}

function makeUnit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, owner: ZCOwner.Player, unitId: UNIT_ID, cardId: UNIT_ID, tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1200, maxHp: 1200, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

function makeModel(config: ZCMatchConfig, units: ZCUnitState[]): ZCGameModel {
    const snapshot = ZCGameModel.createInitialState(() => 0.5, config);
    snapshot.units = units;
    snapshot.nextUnitId = 100;
    return new ZCGameModel(snapshot, () => 0.5, config);
}

/** 取模型自己那份（构造时 `ZCSnapshotCodec` 会把 units 逐条重建成新对象）。*/
function liveUnit(model: ZCGameModel, id: number): ZCUnitState {
    const unit = model.snapshot.units.find((item) => item.id === id);
    assert.ok(unit, `模型里找不到 #${id}`);
    return unit!;
}

function runtimeOf(model: ZCGameModel) {
    const runtime = (model as unknown as {
        skillRuntime: Record<string, Map<string, { parameters: Record<string, number> }>>;
    }).skillRuntime[ZCOwner.Player].get(`${UNIT_ID}:${SKILL_ID}`);
    assert.ok(runtime, `${UNIT_ID}:${SKILL_ID} 必须有运行时`);
    return runtime!;
}

/**
 * 让「强化那一击」立刻可用：`consumeEmpoweredAttack` 见 `empoweredReadyAt` 未定义时总是先挂 CD，
 * 直接写 0 就能在第一次普攻那拍上盾，不用真等 12 秒。
 */
function armEmpowered(model: ZCGameModel, id: number): void {
    const unit = liveUnit(model, id);
    unit.empoweredReadyAt = 0;
    unit.completedAttackCount = 0;
    unit.nextAttackAt = 0;
}

/** 推到「上盾」为止（最多 5 秒）；`shield` 在解码时被初始化成 0 ⇒ 只能按表现事件判停。*/
function tickUntilShield(model: ZCGameModel, id: number): void {
    for (let step = 0; step < 100; step += 1) {
        model.tick(0.05);
        if (shieldEvents(model).length > 0) return;
    }
    assert.fail(`推了 5 秒还没上盾（#${id}）`);
}

function shieldEvents(model: ZCGameModel): Array<{ path: string; raw: Record<string, unknown> }> {
    return model.snapshot.combatEvents
        .filter((event) => String(event.effectPrefabPath ?? '') === ZC_EFFECT_PATHS.dashGuard)
        .map((event) => ({ path: ZC_EFFECT_PATHS.dashGuard, raw: event as unknown as Record<string, unknown> }));
}

// ────────────────────────────────────────────── 一、配表真值

test('100204 三档：30% 最大生命 + 10/11/12 秒，两份产物逐格同值', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(String(row.unitId), UNIT_ID);
            assert.equal(String(row.skillName), '巨力护盾');
            assert.equal(String(row.behaviorKey), 'skill_params', '参数袋车道（造型由代码按单位补）');
            assert.equal(String(row.triggerEvent), 'active');
            assert.equal(Number(row.cooldown), 12);
            assert.equal(bag.selfShieldRatio, 0.3, `L${index + 1} 护盾 = 30% 最大生命`);
            assert.equal(bag.shieldSeconds, SHIELD_SECONDS[index], `L${index + 1} 护盾时长`);
            assert.match(String(row.desc), /等同于自身30%最大生命的护盾/);
            assert.match(String(row.desc), new RegExp(`持续${SHIELD_SECONDS[index]}秒`));
            assert.equal(Number(row.unlockHeroLevel), UNLOCKS[index], `L${index + 1} 解锁档位`);
        });
    }
});

test('护盾不吃普攻的造型槽：30803 只有名字，没有 effectPrefabPath', () => {
    const skills = readRows('pvpSkill');
    const attack = skills.find((row) => Number(row.skillId) === SKILL_ID);
    assert.ok(attack);
    //  有 `empoweredEvery = 0` + `trigger = every_seconds` + `cooldown 12` ⇒ 走冷却制的强化那一击。
    assert.equal(Number(attack!.empoweredEvery), 0);
    assert.equal(String(attack!.trigger), 'every_seconds');
    assert.equal(Number(attack!.cooldown), 12);
    assert.equal(Number(attack!.empoweredSkillId), 30803);
});

// ────────────────────────────────────────────── 二、模型：盾 + 表现

test('强化那一击上盾：30% 最大生命 + 一条纯表现的刀盾兵_护盾', () => {
    const config = buildMatch();
    const enemy = makeUnit(9, {
        owner: ZCOwner.Enemy, freeX: 20, freeY: 0, hp: 200000, maxHp: 200000,
        //  让它只当靶子：不然它会顺手打本体，护盾结算前就被啃掉几十点，断言没法钉死 1500。
        nextAttackAt: 1e9,
    });
    const model = makeModel(config, [makeUnit(1, { hp: 5000, maxHp: 5000 }), enemy]);
    armEmpowered(model, 1);

    tickUntilShield(model, 1);

    const nut = liveUnit(model, 1);
    assert.equal(nut.shield, 1500, '护盾 = 5000 × 30%');
    assert.ok((nut.shieldExpireAt ?? 0) > model.snapshot.elapsedSeconds, '带到期时刻（到点由 expireShield 清）');

    const events = shieldEvents(model);
    assert.equal(events.length, 1, '上盾那一刻必须有一条护盾表现');
    const event = events[0].raw;
    assert.equal(event.sourceUnitId, 1, '挂在上盾的单位身上');
    assert.equal(Number(event.radius), 0, '纯表现：半径 0');
    assert.equal(Number(event.damage), 0, '纯表现：伤害 0');
    //  近战事件的 from == to ⇒ 不飞、不指向目标，就钉在本体脚下。
    assert.equal(Number(event.fromX), Number(event.toX));
    assert.equal(Number(event.fromY), Number(event.toY));
    assert.ok(Number(event.startedAt) <= model.snapshot.elapsedSeconds, '出生时刻不晚于当前');
});

test('护盾表现按 17 帧走完，不拿 shieldSeconds 当事件时长', () => {
    const config = buildMatch();
    const model = makeModel(config, [
        makeUnit(1, { hp: 5000, maxHp: 5000 }),
        makeUnit(9, {
            owner: ZCOwner.Enemy, freeX: 20, freeY: 0, hp: 200000, maxHp: 200000, nextAttackAt: 1e9,
        }),
    ]);
    armEmpowered(model, 1);
    tickUntilShield(model, 1);

    const event = shieldEvents(model)[0].raw;
    assert.equal(Number(event.durationSeconds), ZC_DASH_GUARD_SECONDS, '17 帧 @12fps 一整遍');
    assert.ok(Math.abs(ZC_DASH_GUARD_SECONDS - ZC_EFFECT_TUNING.dashGuardSeconds) < 1e-12, '常量同源');
    //  🔴 拍成 10~12 秒会把 loop 动画钉在原地十几秒，而本体早就走开了。
    assert.ok(Number(event.durationSeconds) < 2, '必须远小于护盾时长');
});

test('没解锁 / 参数被摘掉 ⇒ 既不上盾也不出表现（反向守卫）', () => {
    const config = buildMatch();
    const model = makeModel(config, [
        makeUnit(1, { hp: 5000, maxHp: 5000 }),
        makeUnit(9, {
            owner: ZCOwner.Enemy, freeX: 20, freeY: 0, hp: 200000, maxHp: 200000, nextAttackAt: 1e9,
        }),
    ]);
    armEmpowered(model, 1);
    const runtime = runtimeOf(model);
    const saved = runtime.parameters.selfShieldRatio;
    delete runtime.parameters.selfShieldRatio;
    try {
        for (let step = 0; step < 100; step += 1) model.tick(0.05);
        assert.equal(liveUnit(model, 1).shield ?? 0, 0, '没参数就不该有盾');
        assert.equal(shieldEvents(model).length, 0, '也不该有表现');
    } finally {
        runtime.parameters.selfShieldRatio = saved;
    }
});

test('到期清零：护盾时长走完就摘掉，不会一直挂着', () => {
    const config = buildMatch();
    const model = makeModel(config, [
        makeUnit(1, { hp: 5000, maxHp: 5000 }),
        makeUnit(9, {
            owner: ZCOwner.Enemy, freeX: 20, freeY: 0, hp: 200000, maxHp: 200000, nextAttackAt: 1e9,
        }),
    ]);
    armEmpowered(model, 1);
    tickUntilShield(model, 1);
    const nut = liveUnit(model, 1);
    const expireAt = nut.shieldExpireAt ?? 0;
    assert.ok(expireAt > 0, '上盾时写了到期时刻');

    //  把下一发强化那一击推到很远的将来，只为看「这一面盾自己会到期」。
    nut.empoweredReadyAt = 1e9;
    nut.nextAttackAt = 1e9;
    while (model.snapshot.elapsedSeconds <= expireAt + 0.1) model.tick(0.05);

    assert.equal(nut.shield, 0, '到点由 `expireShield` 清零');
    assert.equal(nut.shieldExpireAt, undefined);
});

// ────────────────────────────────────────────── 三、本局资源清单

test('资源清单按单位补收：68002 收刀盾兵_护盾，别的卡在这条车道零资源', () => {
    const adapters = (unitId: string) => ({
        skillPlans: [{ enabled: true, unitId, behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.skillParams }],
        textOverrides: new Map(),
    });
    const definitions = [{
        unitId: UNIT_ID, prefabPath: 'unit/68002',
        attackProfile: { effectPrefabPath: 'units/projectiles/巨力坚果_普攻/巨力坚果_普攻' },
    }];
    const plan = buildZCVisualResourcePlan(definitions as never, adapters(UNIT_ID) as never);
    assert.ok(plan.effectPaths.includes(ZC_EFFECT_PATHS.dashGuard), '漏收 = 预热有、实战没有');

    //  同一条车道上的其它卡不该被连带预载一张护盾。
    const other = buildZCVisualResourcePlan(
        [{ unitId: '68001', prefabPath: 'unit/68001', attackProfile: { effectPrefabPath: 'a' } }] as never,
        adapters('68001') as never);
    assert.deepEqual(other.effectPaths, ['a']);

    //  没带这条车道的卡同样零资源。
    const none = buildZCVisualResourcePlan(
        definitions as never,
        { skillPlans: [], textOverrides: new Map() } as never);
    assert.ok(!none.effectPaths.includes(ZC_EFFECT_PATHS.dashGuard));
});

test('护盾 prefab 仍在全局预热里（charge_shield 组），本批只补本局清单', () => {
    //  两处都要有：预热（`zcWarmupEffectPaths`）管下载 / 解析，本局清单管 `ZCGameLoader.effects`。
    //  上一批的教训：只进本局清单时，首战仍然可能因为没预热而在第一帧抢不到资源。
    assert.ok(zcWarmupEffectPaths().includes(ZC_EFFECT_PATHS.dashGuard),
        'charge_shield / legacy_dash 组标了 warmup ⇒ 护盾本该在首战预热里');
});
