/**
 * 第 38 批：波利奥 68006「吃口菠萝」100603 的群体护盾表现。
 *
 * 用户原话：「波利奥的【吃口菠萝】也是一个群体的护盾效果，没有看到给范围内的己方角色
 * 附上到盾兵的特效」。两次裁定：
 *   · 机制方式 → 「**保留治疗，只补表现**」（一个数值都不动）；
 *   · 表现范围 → 「**自己 + 友军都播**」。
 *
 * 🔴 表里这一行**没有任何护盾参数**：三档都是 `selfCastHealPct 8/10/15` +
 *    `selfCastAllyRadius 252` + `selfCastAllyHealPct 4/5/8`（III 级多一条 `selfCastCleanse 1`）。
 *    所以本批不是「补数值」，而是「同一处推一条纯表现事件」—— 第一节专门钉死「没有盾参数」，
 *    免得后来人以为该去配表加 `selfShieldRatio`。
 *
 * 🔴 三个必须同时成立的环节（与第 37 批同构）：
 *    ① 事件要真被推出来，且**每个**吃到这一下的己方单位各一条（第二节）；
 *    ② 路径要进本局资源清单（`self_cast` 组的按单位覆盖，第三节）;
 *    ③ 时长按 17 帧走完，不拿治疗 CD 当事件时长。
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
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const UNIT_ID = '68006';
const CHAIN = 100603;
const SKILL_NAME = '吃口菠萝';
/** 与配表逐字一致（三档只差治疗量 / 净化）。*/
const SELF_HEAL_PCT = [8, 10, 15];
const ALLY_HEAL_PCT = [4, 5, 8];
const CLEANSE = [0, 0, 1];
const ALLY_RADIUS = 252;
const UNLOCKS = [9, 18, 27];

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

// ────────────────────────────────────────────── 一、配表真值（证明「不是缺数值」）

test('100603 三档：群体治疗，一个护盾参数都没有（本批不动配表）', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(String(row.unitId), UNIT_ID);
            assert.equal(String(row.skillName), SKILL_NAME);
            assert.equal(String(row.behaviorKey), 'self_cast', '冷却型自身施法车道（造型由代码按单位补）');
            //  🔴 `pvpSkillPlan.cooldown` 这一行是空的（CD 只写在参数袋里）——
            //  别照抄别条链路去读这一列，会读到 0。
            assert.equal(Number(row.cooldown ?? 0), 0, 'CD 不在这列');
            assert.equal(bag.selfCastCooldown, 10);
            assert.equal(bag.selfCastHealPct, SELF_HEAL_PCT[index], `L${index + 1} 自身回复`);
            assert.equal(bag.selfCastAllyRadius, ALLY_RADIUS, '群体半径（判定与表现同源）');
            assert.equal(bag.selfCastAllyHealPct, ALLY_HEAL_PCT[index], `L${index + 1} 友军回复`);
            assert.equal(bag.selfCastCleanse ?? 0, CLEANSE[index], `L${index + 1} 净化个数`);
            //  🔴 反向守卫：这一行**不该**有任何护盾数值 —— 否则说明有人去配表上盾了，
            //  而用户的口径是「保留治疗、只补表现」。
            const shieldKeys = Object.keys(bag).filter((key) => /shield/i.test(key));
            assert.deepEqual(shieldKeys, [], `L${index + 1} 不该带护盾参数，实际有 ${shieldKeys.join(',')}`);
            assert.match(String(row.desc), /自身/);
            assert.match(String(row.desc), /友军/);
            assert.equal(Number(row.unlockHeroLevel), UNLOCKS[index], `L${index + 1} 解锁档位`);
        });
    }
});

test('同车道另两张卡是纯自身增益：没有群体半径 ⇒ 天然不播护盾', () => {
    const plans = readRows('pvpSkillPlan');
    for (const chain of [100703, 100903]) {
        const row = plans.find((item) => Number(item.skillChainId) === chain);
        assert.ok(row, `缺少 ${chain}`);
        const bag = JSON.parse(String(row!.skillParamJson)) as Record<string, number>;
        assert.equal(String(row!.behaviorKey), 'self_cast');
        assert.equal(bag.selfCastAllyRadius ?? 0, 0, `${chain} 不该有群体半径`);
    }
});

// ────────────────────────────────────────────── 二、触发系统：谁各播一条

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = UNIT_ID): ZCUnitState {
    return {
        id, owner, unitId, cardId: unitId, tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 1e9, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

function makeState(units: ZCUnitState[], now = 1): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: now, durationSeconds: 300,
        units, projectiles: [], combatEvents: [], groundZones: [], statusEffects: [],
        nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
}

/**
 * 直接推 `ZCSkillTriggerSystem`（不经整局）：`distanceScale = 0.3`，252 × 0.3 = 75.6 世界 px。
 * 于是「贴身 0」「30」「75」都在圈内，「200」在圈外 —— 与配表同口径。
 */
function selfCastHarness(parameters: Record<string, number>) {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const near = makeUnit(2, ZCOwner.Player, 30, 0);
    const edge = makeUnit(3, ZCOwner.Player, 0, 75);
    const far = makeUnit(4, ZCOwner.Player, 200, 0);
    const corpse = makeUnit(5, ZCOwner.Player, 10, 0);
    corpse.battleState = 'dead';
    corpse.hp = 0;
    const enemy = makeUnit(6, ZCOwner.Enemy, 10, 0, '68028');
    const state = makeState([caster, near, edge, far, corpse, enemy]);
    const statusSystem = new ZCStatusSystem();
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: UNIT_ID, skillId: 30703, behaviorKey: 'self_cast',
        trigger: 'none', stateMode: 'none', parameters,
    };
    const heals: Array<{ unitId: number; amount: number }> = [];
    const tick = (at: number): void => {
        state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(state, 0.1, {
            statusSystem,
            runtimeOf: (unit) => (unit.id === caster.id ? runtime : undefined),
            fireBurst: () => undefined,
            castSecondary: () => false,
            distanceScale: 0.3,
            healUnit: (unit, amount) => {
                heals.push({ unitId: unit.id, amount });
                unit.hp = Math.min(unit.maxHp, unit.hp + amount);
            },
        });
    };
    const guardEvents = (): Array<Record<string, unknown>> => state.combatEvents
        .filter((event) => String(event.effectPrefabPath ?? '') === ZC_EFFECT_PATHS.dashGuard)
        .map((event) => event as unknown as Record<string, unknown>);
    return { tick, state, statusSystem, caster, near, edge, far, corpse, enemy, heals, guardEvents };
}

const GROUP_PARAMS = {
    selfCastCooldown: 10, selfCastHealPct: 8, selfCastAllyRadius: ALLY_RADIUS, selfCastAllyHealPct: 4,
};

test('吃口菠萝到点：自己 + 半径内友军各挂一条刀盾兵_护盾，圈外 / 尸体 / 敌人都不播', () => {
    const harness = selfCastHarness({ ...GROUP_PARAMS });
    harness.tick(1);
    assert.equal(harness.guardEvents().length, 0, '开局那一拍只记 readyAt，不立刻放');
    harness.tick(11);

    const ids = harness.guardEvents().map((event) => Number(event.sourceUnitId)).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 3], '① 自己（不含自己就漏了施法者）② 30px 友军 ③ 75px 贴边友军');
    //  治疗仍是老口径：自己吃 `selfCastHealPct`、友军吃 `selfCastAllyHealPct`，
    //  两段不重叠 —— 圆盾多一条不等于多回一次血。
    const healIds = harness.heals.map((item) => item.unitId).sort((a, b) => a - b);
    assert.deepEqual(healIds, [1, 2, 3], '治疗没被改动：自己 + 圈内友军各一次');
});

test('护盾事件钉在各自脚下、纯表现、按 17 帧走完', () => {
    const harness = selfCastHarness({ ...GROUP_PARAMS });
    harness.tick(1);
    harness.tick(11);
    const events = harness.guardEvents();
    assert.equal(events.length, 3);

    const byId = new Map(events.map((event) => [Number(event.sourceUnitId), event]));
    const near = byId.get(2)!;
    assert.equal(Number(near.fromX), 30, 'x 取 freeX');
    assert.equal(Number(near.fromY), 0);
    assert.equal(Number(near.toX), Number(near.fromX), '近战事件 from == to：钉在原地、不飞');
    assert.equal(Number(near.toY), Number(near.fromY));
    assert.equal(Number(near.radius), 0, '纯表现：半径 0');
    assert.equal(Number(near.damage), 0, '纯表现：伤害 0');
    assert.equal(Number(near.durationSeconds), ZC_DASH_GUARD_SECONDS, '17 帧 @12fps 一整遍');
    assert.ok(Math.abs(ZC_DASH_GUARD_SECONDS - ZC_EFFECT_TUNING.dashGuardSeconds) < 1e-12, '常量同源');
    //  🔴 拿治疗 CD（10 秒）当事件时长会把 loop 动画钉在原地十几秒。
    assert.ok(Number(near.durationSeconds) < 2, '必须远小于技能 CD');
    assert.ok(Number(near.startedAt) <= 11, '出生时刻不晚于当前');
});

test('一个 CD 只推一轮，不会每帧重复叠', () => {
    const harness = selfCastHarness({ ...GROUP_PARAMS });
    harness.tick(1);
    harness.tick(11);
    assert.equal(harness.guardEvents().length, 3);
    harness.tick(11.2);
    harness.tick(12);
    assert.equal(harness.guardEvents().length, 3, 'CD 没到不该再推');
    harness.tick(21.1);
    assert.equal(harness.guardEvents().length, 6, '下一个 CD 才再来一轮');
});

test('没有群体半径 ⇒ 一条护盾事件都不推（嗜血 / 迅击不会连带播）', () => {
    const harness = selfCastHarness({
        selfCastCooldown: 12, selfCastSeconds: 6, selfCastDamagePct: 50, selfCastLifestealPct: 10,
    });
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.guardEvents().length, 0);
    assert.equal(harness.statusSystem.statModsOf('1').damageRatePct, 50, '增益照常生效（本批没碰它）');
});

// ────────────────────────────────────────────── 三、本局资源清单

test('资源清单按单位补收：68006 收刀盾兵_护盾，同车道的 68007 零资源', () => {
    const adapters = (unitId: string) => ({
        skillPlans: [{ enabled: true, unitId, behaviorKey: ZC_EFFECT_BEHAVIOR_KEYS.selfCast }],
        textOverrides: new Map(),
    });
    const definitions = [{
        unitId: UNIT_ID, prefabPath: 'unit/68006',
        attackProfile: { effectPrefabPath: 'units/projectiles/波利奥_普攻/波利奥_普攻' },
    }];
    const plan = buildZCVisualResourcePlan(definitions as never, adapters(UNIT_ID) as never);
    assert.ok(plan.effectPaths.includes(ZC_EFFECT_PATHS.dashGuard), '漏收 = 预热有、实战没有');

    const other = buildZCVisualResourcePlan(
        [{ unitId: '68007', prefabPath: 'unit/68007', attackProfile: { effectPrefabPath: 'a' } }] as never,
        adapters('68007') as never);
    assert.deepEqual(other.effectPaths, ['a'], '嗜血在这条车道不该被连带预载一张护盾');
});

test('护盾 prefab 仍在全局预热里（charge_shield 组），本批只补本局清单', () => {
    assert.ok(zcWarmupEffectPaths().includes(ZC_EFFECT_PATHS.dashGuard));
});

// ────────────────────────────────────────────── 四、整局接线（参数袋真的挂得上）

function prepare(): ZCMatchConfig {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

function buildMatch(heroLevel = 27): ZCMatchConfig {
    const captured = prepare();
    const loadout = compileZCCombatBuild({ unitId: UNIT_ID, heroLevel }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    return {
        ...captured,
        rules: {
            ...captured.rules,
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, enemyAiIntervalSeconds: 10000,
        },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as ZCMatchConfig;
}

test('整局：68006 的 selfCast 参数确实落在普攻运行时上，CD 到点真的推护盾', () => {
    const config = buildMatch();
    const snapshot = ZCGameModel.createInitialState(() => 0.5, config);
    snapshot.units = [
        makeUnit(50, ZCOwner.Player, 0, 0),
        makeUnit(51, ZCOwner.Player, 10, 0),
        makeUnit(52, ZCOwner.Enemy, 400, 0, '68028'),
    ];
    snapshot.nextUnitId = 60;
    const model = new ZCGameModel(snapshot, () => 0.5, config);

    //  运行时袋里必须有这一组参数 —— 这是「表配了、模型看不到」的那类静默失败的唯一闸门。
    const runtimeMap = (model as unknown as {
        skillRuntime: Record<string, Map<string, ZCSkillRuntimeDefinition>>;
    }).skillRuntime[ZCOwner.Player];
    const key = Array.from(runtimeMap.keys()).find((item) => item.startsWith(`${UNIT_ID}:`));
    assert.ok(key, `没有 ${UNIT_ID} 的运行时`);
    const parameters = runtimeMap.get(key!)!.parameters;
    assert.equal(parameters.selfCastAllyRadius, ALLY_RADIUS, `参数袋缺 selfCastAllyRadius（${key}）`);
    assert.equal(parameters.selfCastCooldown, 10);

    const caster = model.snapshot.units.find((unit) => unit.id === 50)!;
    caster.selfCastReadyAt = 0;
    for (let step = 0; step < 40; step += 1) {
        model.tick(0.05);
        if (model.snapshot.combatEvents.some(
            (event) => String(event.effectPrefabPath ?? '') === ZC_EFFECT_PATHS.dashGuard)) break;
    }
    const ids = model.snapshot.combatEvents
        .filter((event) => String(event.effectPrefabPath ?? '') === ZC_EFFECT_PATHS.dashGuard)
        .map((event) => Number(event.sourceUnitId))
        .sort((a, b) => a - b);
    assert.deepEqual(ids, [50, 51], '整局里也是「自己 + 圈内友军」各一条');
});

// ────────────────────────────────────────────── 五、III 级的净化解的是「友军」

/**
 * 100603 III 级 desc（两份文件一致，`armySkillLevelUp` 是卡牌 UI 真读的那份）：
 * 「自身回复15%，友军回复8%，并解除**友军**身上1个减益」。
 *
 * 2026-11-22 之前 `applySelfCast` 的净化段只扫 `instancesOf(String(unit.id))`（施法者自己），
 * 卡面承诺的「解友军」等于没做 —— 这一批补齐：**圈内每个友军各解 `selfCastCleanse` 个**。
 */
function debuffCount(harness: ReturnType<typeof selfCastHarness>, id: number): number {
    return harness.statusSystem.instancesOf(String(id)).length;
}

function armDebuffs(harness: ReturnType<typeof selfCastHarness>, ids: readonly number[]): void {
    for (const id of ['slow', 'weak'] as const) {
        harness.statusSystem.register({
            id, name: id, durationSeconds: 30, maxStacks: 1, refreshPolicy: 'refresh',
            statMods: id === 'slow' ? { moveSpeedPct: -30 } : { attackPct: -20 },
            behavior: { kind: 'none' },
        });
    }
    for (const id of ids) {
        for (const defId of ['slow', 'weak'] as const) {
            harness.statusSystem.apply(String(id), defId, { at: 1, durationSeconds: 30 });
        }
    }
}

test('III 级净化：圈内每个友军各解 1 个，圈外 / 自己 / 尸体一字不动', () => {
    const harness = selfCastHarness({ ...GROUP_PARAMS, selfCastCleanse: 1 });
    //  1=自己 2=30px 友军 3=75px 贴边友军 4=200px 圈外友军 5=尸体 6=敌人
    armDebuffs(harness, [1, 2, 3, 4, 5, 6]);
    harness.tick(1);
    harness.tick(11);

    assert.equal(debuffCount(harness, 2), 1, '圈内友军解掉 1 个（剩 1）');
    assert.equal(debuffCount(harness, 3), 1, '贴边的也算圈内');
    assert.equal(debuffCount(harness, 1), 2, 'desc 只说友军 ⇒ 施法者自己不动');
    assert.equal(debuffCount(harness, 4), 2, '圈外不动');
    assert.equal(debuffCount(harness, 5), 2, '尸体不碰');
    assert.equal(debuffCount(harness, 6), 2, '敌方不是友军');
});

test('净化只解减益：友军身上的增益留着', () => {
    const harness = selfCastHarness({ ...GROUP_PARAMS, selfCastCleanse: 1 });
    armDebuffs(harness, [2]);
    harness.statusSystem.register({
        id: 'buff', name: 'buff', durationSeconds: 30, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: { attackPct: 20 }, behavior: { kind: 'none' },
    });
    harness.statusSystem.apply('2', 'buff', { at: 1, durationSeconds: 30 });
    harness.tick(1);
    harness.tick(11);

    const left = harness.statusSystem.instancesOf('2').map((instance) => instance.defId);
    assert.ok(left.includes('buff'), `增益不该被解（实际剩 ${left.join(',')}）`);
    assert.equal(left.filter((defId) => defId !== 'buff').length, 1, '只解掉 1 个减益');
});
