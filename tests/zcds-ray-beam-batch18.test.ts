/**
 * 第 18 批（2026-11-19）：103503「射线集束」（科学家 68035）—— 新增 `ray_beam` 车道。
 *
 * 🔴 2026-11-23 第 43 批把这条技能**整体搬给了机甲菇 68015**（101504，参数一行没改），
 * 科学家这条原地改成 `fire_zone`「文明之火」。所以本文件现在钉两件事：
 *  · 前两条：103503 的**新真值**（fire 参数 / 描述 / 修改器号）；
 *  · 后半段：`ray_beam` 车道的几何与播法（代码一行没删，只是换了主人）——
 *    夹具仍用 68035 的普攻袋，因为「按参数在不在分发」这条口径与宿主单位无关。
 *
 * 这条技能的坑集中在「**看着像换了、其实没换**」：
 *  · 表里原本是 `skill_params` + 副轨四键，`desc` 却早就是射线口径 ⇒ 必须整袋换；
 *  · 射线是**矩形**、还跟着本体转，用圆形光环能「放出去」但打不对人；
 *  · `area` 事件不按 radius 缩放 ⇒ 判定长了、画面还是 prefab 原长。
 * 所以本组用例同时钉四件事：配表换干净、矩形几何对、每 0.2 秒复打、III 级光斑在末端炸。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCGroundZoneSystem, zcGroundZoneReaches } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import {
    ZC_EFFECT_PATHS, zcEffectPathsForBehavior,
} from '../assets/script/app/zcds/model/ZCEffectCatalog';
import {
    ZC_EFFECT_SCALE, zcRayBeamEffectScale,
} from '../assets/script/app/zcds/model/ZCEffectTuning';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig, type ZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const CHAIN = 103503;
const UNIT = '68035';
const SKILL_ID = 30709;

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

function prepare(): void {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
}

function makeUnit(id: number, unitId: string, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, owner: ZCOwner.Player, unitId, cardId: unitId, tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1200, maxHp: 1200, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

/** 攻击力 100、无加成 ⇒ 面板伤害 = 100 × 倍率，便于钉绝对值。*/
const DEFINITION = {
    unitId: UNIT, name: '科学家', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 45, attackInterval: 1.8,
    attackDuration: 1.3, attackHitTime: 0.52, bodyRadius: 24, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: true, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: SKILL_ID, name: '科学家普攻', mode: 'ranged',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function params(seconds = 4, extra: Record<string, number> = {}): Record<string, number> {
    return {
        rayEvery: 8, rayHalfLength: 120, rayHalfWidth: 36, rayForward: 30,
        raySeconds: seconds, rayInterval: 0.2, rayDamageRate: 0.35,
        rayVulnPct: 20, rayVulnSeconds: 0.3,
        ...extra,
    };
}

/** 施法夹具：只补 `castRayBeam` 真正读的那几项（构造 / 克制 / 目标）。*/
function rayContext(units: ZCUnitState[], bag: Record<string, number>, target: ZCUnitState | null) {
    const runtime = {
        skillChainId: CHAIN, behaviorKey: 'ray_beam',
        trigger: 'none', stateMode: 'none', parameters: { ...bag },
    } as unknown as ZCSkillRuntimeDefinition;
    const damaged: Array<{ id: number; damage: number }> = [];
    const statuses = new ZCStatusSystem();
    const context = {
        rules: {
            combatDistanceScale: 1, combatDamageMultiplier: 1,
            unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: statuses,
        geometry: { hexIdAt: () => 1 } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (victim: ZCUnitState, damage: number) => {
            damaged.push({ id: victim.id, damage });
            victim.hp = Math.max(0, victim.hp - damage);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([[`${UNIT}:${SKILL_ID}`, runtime]]),
            [ZCOwner.Enemy]: new Map(),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: {
            [ZCOwner.Player]: new Map<string, ZCUnitStatPatch>(),
            [ZCOwner.Enemy]: new Map<string, ZCUnitStatPatch>(),
        },
        deckBonuses: {
            [ZCOwner.Player]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
            [ZCOwner.Enemy]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
        } as unknown as Record<ZCOwner, ZCDeckBonuses>,
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => (target
            ? { kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, cardId: target.unitId }
            : null),
        evaluateLegacySkill: () => ({
            buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0,
        }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: () => undefined,
    } as unknown as IZCAttackResolutionContext;
    return { context, damaged, statuses };
}

function rayState(units: ZCUnitState[], elapsedSeconds: number): ZCSnapshot {
    return {
        elapsedSeconds, units,
        statusEffects: { nextUid: 1, units: [] },
        combatEvents: [], nextCombatEventId: 1,
        projectiles: [], groundZones: [], hexes: [],
    } as unknown as ZCSnapshot;
}

// ────────────────────────────────────────── 配表

test('103503 配表：整袋换成 fire_zone，ray* 一个不剩（射线集束已搬去 68015）', () => {
    //  🔴 2026-11-23 第 43 批：用户把「射线集束」整条技能挪给机甲菇（101504），
    //  科学家这条原地改成「文明之火」（`fire_zone`）。射线车道的几何 / 播法仍由本文件
    //  后半段钉着（`castRayBeam` 一行没删，只是换了主人）。
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在（原本就是三条占位行，原地改写不是追加）');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.equal(row.behaviorKey, 'fire_zone', '还写着 ray_beam 就是「文明之火放出一道射线」');
            assert.equal(row.skillName, '文明之火');
            assert.equal(row.skillKind, 'active_cd', '累计普攻触发也照旧用 active_cd');
            assert.equal(Number(row.unitId), Number(UNIT));
            assert.equal(Number(row.pvpSkillId), SKILL_ID);
            assert.equal(Number(row.unlockHeroLevel), [5, 18, 27][index]);
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('fire')), [],
                '参数袋里不许串进 103501 / 103502 / 103504 的键，也不许留 ray*');
            for (const key of ['rayEvery', 'rayHalfLength', 'rayHalfWidth', 'rayForward',
                'raySeconds', 'rayInterval', 'rayDamageRate', 'rayVulnPct',
                'secondaryCooldown', 'secondaryDamageRate', 'secondaryFanDeg', 'secondaryRadiusScale']) {
                assert.equal(key in bag, false, `旧车道的参数没清干净：${key}`);
            }
            assert.equal(bag.fireEvery, 8, '设计：累计普攻 8 次');
            assert.equal(bag.fireCount, 3, '设计：3 个火焰区域');
            assert.equal(bag.fireSpreadRadius, 200, '设计：目标点 200px 半径圆内');
            assert.equal(bag.fireRadius, 60, '每块必须与灼热地带同尺寸');
            assert.equal(bag.fireSeconds, [6, 8, 10][index]);
            assert.equal(bag.fireInterval, 1, '每秒结算一次');
            assert.equal(bag.fireDamageRate, [1, 1.1, 1.2][index]);
        });
        const zero = plan[0].modifierId;
        assert.equal(Number(zero), 94035031, '修改器号沿用表里既有值，不重算');
    }
});

test('103503 卡面：desc 三份一致（pvpSkillPlan 与 armySkillLevelUp 两份产物）', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '文明之火');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [5, 18, 27][index]);
            assert.deepEqual(row.modfiy, [94035031 + index]);
        });
    }
});

// ────────────────────────────────────────── 区域几何

test('103503 射线：矩形从身前起、朝目标方向，长度 / 宽度 / 跳数照表', () => {
    prepare();
    //  本体在原点，目标在正右 200 ⇒ aim = 0°（朝 +x）。
    const caster = makeUnit(1, UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 200, freeY: 0 });
    const units = [caster, foe];
    const bag = params(4);
    const { context } = rayContext(units, bag, foe);
    const state = rayState(units, 3);

    assert.equal(ZCSkillResolutionSystem.castRayBeam(state, caster, context, '__rayvuln:20__'), true);
    assert.equal(state.groundZones.length, 1, 'II 级之前只有主射线');
    const ray = state.groundZones[0];
    //  圆心 = 起点前移 30 + 半长 120 = 150；全长 240 逻辑 px（本夹具 scale = 1）。
    assert.equal(ray.x, 150, '圆心在矩形的几何中心（起点 30 + 半长 120）');
    assert.equal(ray.y, 0);
    assert.equal(ray.rectHalfLength, 120);
    assert.equal(ray.rectHalfHeight, 36);
    assert.equal(ray.angleDegrees, 0, '朝 +x ⇒ 0°');
    assert.equal(ray.remainingSeconds, 4);
    assert.equal(ray.waveInterval, 0.2);
    assert.equal(ray.wavesLeft, 20, '4 秒 ÷ 0.2 秒 = 20 跳');
    assert.equal(ray.damage, 35, '面板 100 × 35%');
    assert.equal(ray.holdVisual, true);
    assert.equal(ray.hitOncePerUnit, undefined, '设计是每秒 5 跳，站在光束里要一直挨');
    assert.equal(ray.hitStatusId, '__rayvuln:20__', '破甲状态由触发系统算好传进来');
    assert.equal(ray.hitStatusChance, 1);
    assert.equal(ray.hitStatusSeconds, 0.3, '残留比一跳稍长、远短于整段');
    assert.equal(ray.followUnitId, 1, '跟着本体走');
    assert.equal(ray.followForward, 150, '圆心到本体的距离 = 起点前移 + 半长');
    assert.equal(ray.effectScale, zcRayBeamEffectScale(120),
        'area 事件不按 radius 缩放 ⇒ 长度靠事件级 effectScale');

    //  判定：矩形内（正右 100）命中、矩形外（正上方 100）不命中。
    assert.equal(zcGroundZoneReaches(ray, 100, 0), true);
    assert.equal(zcGroundZoneReaches(ray, 100, 100), false, '90° 方向在矩形外');
    //  矩形覆盖 x ∈ [30, 270]（圆心 150 ∓ 半长 120）⇒ 20 在起点之前，打不到。
    assert.equal(zcGroundZoneReaches(ray, 20, 0), false, '起点 30 之前');
    assert.equal(zcGroundZoneReaches(ray, 260, 0), true, '末端 270 之内');
});

test('103503 每 0.2 秒复打：站在光束里的敌人一直挨，走出去就停', () => {
    prepare();
    const caster = makeUnit(1, UNIT, { freeX: 0, freeY: 0 });
    const fence = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 100, freeY: 0 });
    const units = [caster, fence];
    const { context } = rayContext(units, params(2), fence);
    const state = rayState(units, 0);
    ZCSkillResolutionSystem.castRayBeam(state, caster, context, '__rayvuln:20__');

    const hits: Array<{ id: number; damage: number }> = [];
    const zoneCtx = {
        hexStep: 42, hexIdAt: () => 1,
        unitsInRadius: () => units,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (victim: ZCUnitState, damage: number) => {
            hits.push({ id: victim.id, damage });
            victim.hp = Math.max(0, victim.hp - damage);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => ({ nextUid: 1, units: [] }),
        random: () => 0,
        combatDistanceScale: 1,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    ZCGroundZoneSystem.tick(state, 0.2, zoneCtx);
    assert.equal(hits.length, 1, '第一跳');
    assert.equal(hits[0].damage, 35);
    state.elapsedSeconds = 0.2;
    ZCGroundZoneSystem.tick(state, 0.2, zoneCtx);
    assert.equal(hits.length, 2, '第二跳：同一个人要再挨（不是「只挨一次」）');

    //  走出光束（正上方 200）⇒ 不再挨，但区域照旧活着。
    fence.freeX = 0; fence.freeY = 300;
    state.elapsedSeconds = 0.4;
    ZCGroundZoneSystem.tick(state, 0.2, zoneCtx);
    assert.equal(hits.length, 2, '离开射线立即停止结算');
    assert.equal(state.groundZones.length, 1, '区域本身不受影响');
});

test('103503 III 级末端光斑：射线末端多一个小区域，消失那一刻炸一次 50%', () => {
    prepare();
    const caster = makeUnit(1, UNIT, { freeX: 0, freeY: 0 });
    const foe = makeUnit(2, '68001', { owner: ZCOwner.Enemy, freeX: 200, freeY: 0 });
    const units = [caster, foe];
    const { context } = rayContext(units, params(4, { raySpotRadius: 60, raySpotDamageRate: 0.5 }), foe);
    const state = rayState(units, 0);
    ZCSkillResolutionSystem.castRayBeam(state, caster, context, '__rayvuln:20__');

    assert.equal(state.groundZones.length, 2, '主射线 + 末端光斑');
    const spot = state.groundZones[1];
    //  末端 = 起点 30 + 全长 240 = 270。
    assert.equal(spot.x, 270, '光斑在射线末端，不是射线中心');
    assert.equal(spot.y, 0);
    assert.equal(spot.radius, 60);
    assert.equal(spot.wavesLeft, 0, '全程不结算波次');
    assert.equal(spot.remainingSeconds, 4, '与主射线同生共死');
    assert.equal(spot.expireDamage, 50, '面板 100 × 50%');
    assert.equal(spot.followUnitId, 1, '跟着本体，射线一转它也跟着转');
    assert.equal(spot.followForward, 270);
    assert.ok(spot.expirePrefabPath, '到期那一下要有爆点表现');

    //  把敌人挪到末端 ⇒ 射线消失那一拍吃一次 50%。
    foe.freeX = 270; foe.freeY = 0;
    const hits: Array<{ id: number; damage: number }> = [];
    const zoneCtx = {
        hexStep: 42, hexIdAt: () => 1,
        unitsInRadius: () => units,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (victim: ZCUnitState, damage: number) => {
            hits.push({ id: victim.id, damage });
            victim.hp = Math.max(0, victim.hp - damage);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => ({ nextUid: 1, units: [] }),
        random: () => 0,
        combatDistanceScale: 1,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];

    //  🔴 `remainingSeconds` 是**每帧按 dt 递减**的，不是「和 elapsedSeconds 比」——
    //  直接把时间设到 4 秒不会让区域到期。一次喂满整段 dt，让它和波次一起收尾。
    state.elapsedSeconds = 4.2;
    ZCGroundZoneSystem.tick(state, 4.2, zoneCtx);
    const spotHit = hits.find((hit) => hit.damage === 50);
    assert.ok(spotHit, `光斑到期要炸 50%（实际 ${JSON.stringify(hits)}）`);
    assert.equal(state.groundZones.length, 0, '两个区域同一拍都消失');
});

// ────────────────────────────────────────── 触发

test('103503 触发：累计普攻 8 次才射，被拒 / 射程外都不消费次数', () => {
    prepare();
    const caster = makeUnit(1, UNIT);
    const units = [caster];
    const runtime = {
        skillChainId: CHAIN, behaviorKey: 'ray_beam', trigger: 'none', stateMode: 'none',
        parameters: params(4),
    } as unknown as ZCSkillRuntimeDefinition;
    let casts = 0;
    let reject = false;
    const tickParams = (release: boolean) => ({
        statusSystem: new ZCStatusSystem(),
        //  只给持链的那个单位：否则同场敌人也会拿到这本「书」自己射线。
        runtimeOf: (unit: ZCUnitState) => (unit.id === 1 ? runtime : undefined),
        inAttackRange: () => release,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        castRayBeam: (_unit: ZCUnitState, vulnStatusId?: string) => {
            vulnStatusIdRef = vulnStatusId;
            casts += 1;
            return !reject;
        },
    }) as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    let vulnStatusIdRef: string | undefined;

    const state = rayState(units, 0);
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams(true));
    assert.equal(casts, 0, '首次只记基线，不补放');
    assert.equal(caster.rayFiredCount, 0);

    //  打 7 次：不够。
    caster.completedAttackCount = 7;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams(true));
    assert.equal(casts, 0, '7 < 8');

    //  打满 8 次但这帧射程内没人 ⇒ 待触发、不消费。
    caster.completedAttackCount = 8;
    state.elapsedSeconds = 1;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams(false));
    assert.equal(casts, 0, '射程外不射');
    assert.equal(caster.rayFiredCount, 0, '没放出去就不许记账');

    //  进范围 ⇒ 补放，且「受到伤害提高」的状态 id 按参数拼好传下去。
    state.elapsedSeconds = 1.2;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams(true));
    assert.equal(casts, 1);
    assert.equal(caster.rayFiredCount, 8);
    assert.equal(vulnStatusIdRef, '__rayvuln:20.0000:0.30__', '状态 id 必须带参数（同参数复用同一条定义）');

    //  被拒（参数不全）⇒ 不推进计数，下帧重试。
    reject = true;
    caster.completedAttackCount = 16;
    state.elapsedSeconds = 3;
    ZCSkillTriggerSystem.tick(state, 0.05, tickParams(true));
    assert.equal(casts, 2, '确实调到了');
    assert.equal(caster.rayFiredCount, 8, '被拒不消费次数');
});

test('103503 没有冷却格：不许顺手写脏同卡其他链的 CD', () => {
    prepare();
    const caster = makeUnit(1, UNIT);
    const units = [caster];
    const runtime = {
        skillChainId: CHAIN, behaviorKey: 'ray_beam', trigger: 'none', stateMode: 'none',
        parameters: params(4),
    } as unknown as ZCSkillRuntimeDefinition;
    const state = rayState(units, 0);
    caster.completedAttackCount = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, {
        statusSystem: new ZCStatusSystem(),
        runtimeOf: (unit: ZCUnitState) => (unit.id === 1 ? runtime : undefined),
        inAttackRange: () => true,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
        castRayBeam: () => true,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2]);
    assert.equal(caster.rayFiredCount, 8);
    for (const key of ['rayReadyAt', 'trapReadyAt', 'auraReadyAt', 'stormReadyAt'] as const) {
        assert.equal(caster[key], undefined, `不该写 ${key}`);
    }
});

test('103503 端到端：真实构筑把 fire 参数编进模型技能书', () => {
    //  这条守的是「表改了、构筑没捡到」—— 症状是技能一声不响地不触发（`params` 里读不到 fireEvery）。
    prepare();
    const captured = captureZCMatchConfig();
    const loadout = compileZCCombatBuild({ unitId: UNIT, heroLevel: 27 }, captured.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '68035 在兵种 27 级必须编译出技能计划');
    const config = {
        ...captured,
        rules: { ...captured.rules, combatDistanceScale: 1, enemyAiIntervalSeconds: 10000 },
        modifiers: { [ZCOwner.Player]: [loadout!], [ZCOwner.Enemy]: [] },
    } as ZCMatchConfig;
    const model = new ZCGameModel(ZCGameModel.createInitialState(() => 0.5, config), () => 0.5, config);
    const book = (model as unknown as {
        skillRuntime: Record<string, Map<string, ZCSkillRuntimeDefinition>>;
    }).skillRuntime[ZCOwner.Player];
    const withFire = [...book.values()]
        .filter((runtime) => typeof runtime.parameters?.fireSpreadRadius === 'number');
    assert.equal(withFire.length, 1, '三条 fire 参数只应落在一条运行时里（按 pvpSkillId 分袋）');
    const params = withFire[0].parameters!;
    //  🔴 不要在这里断言 `behaviorKey === 'fire_zone'`：`68035:30709` 这一袋里住着四条链，
    //  运行时**只建一条** runtime，`behaviorKey` 由第一个创建它的计划行决定（103501 穿甲苔刺，
    //  值是 `skill_params`），后面的链只往 `parameters` 里并参数（`mergeSkillPlanIntoRuntime`）。
    //  ⇒ 车道分发靠「参数在不在」（`applyFireZone` 只看 `fireEvery`），
    //  表现收拢靠**表行**的 `behaviorKey`（`ZCVisualResourcePlan` 读的是原始计划行，不是 runtime）。
    assert.equal(typeof withFire[0].behaviorKey, 'string');
    assert.equal(params.fireEvery, 8);
    assert.equal(params.fireCount, 3);
    assert.equal(params.fireSpreadRadius, 200);
    assert.equal(params.fireRadius, 60);
    assert.equal(params.fireSeconds, 10, '27 级 = III 级');
    assert.equal(params.fireDamageRate, 1.2);
    //  表行（不是运行时）的 behaviorKey 才是资源清单的判据。
    const planRow = readRows('pvpSkillPlan')
        .find((row) => Number(row.skillChainId) === CHAIN && Number(row.skillLevel) === 3);
    assert.equal(planRow?.behaviorKey, 'fire_zone');
    assert.deepEqual(zcEffectPathsForBehavior(String(planRow?.behaviorKey)), [ZC_EFFECT_PATHS.hotZone],
        '资源清单按表行 behaviorKey 收火焰 prefab —— 收不到就是「照常掉血、地上一片火都没有」');
});

test('103503 表现缩放：事件级 scale 按「半长 ÷ 基准」算，非法值退回 1', () => {
    //  基准是**镭射飞龙那张图**烘进资产的可见半长（第 43 批换图后重算）：
    //  画布 alpha 可见宽 575 屏上 px ÷ 0.76875 = 748 逻辑 px ⇒ 半长 374。
    assert.equal(ZC_EFFECT_SCALE.rayBeamReferenceHalfLength, 374, '发射线的基准半长必须按新图重算');
    assert.equal(zcRayBeamEffectScale(374), 1);
    assert.equal(zcRayBeamEffectScale(120), 120 / 374);
    assert.equal(zcRayBeamEffectScale(0), 1, '非法值不能让节点缩成 0');
    assert.equal(zcRayBeamEffectScale(-5), 1);
});
