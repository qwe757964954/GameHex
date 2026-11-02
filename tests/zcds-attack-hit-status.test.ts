import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

/**
 * 火焰树妖「点燃」的**节拍闸门**。
 *
 * 表侧真值（2026-10-30）：
 *  · `pvpSkillPlan` 点燃三档的 `skillParamJson = {"statusEveryNAttacks":3}`，`pvpSkillId` 指 30711（树妖普攻行）；
 *  · `pvpSkillPlan` 灼热地带三档的 `pvpSkillId` 也是 30711（强化那一击挂在普攻行上），
 *    `skillParamJson = {"damageRate":0.35}`、`pvpSkill.empoweredEvery = 6`。
 *
 * 两者合流的后果：第 6 次普攻**既**放灼热地带、**又**正好轮到点燃。
 * 区域分支原本会提前 `return`，把这次点燃吞掉 —— 这里一并钉住。
 *
 * 本文件只驱动 `ZCAttackResolutionSystem.sendAttack`，上下文用最小桩件，
 * 不加载地图 / 卡表，目的是把「第 N 次才挂」这条判定单独锁死。
 */

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68003', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IHarnessOptions {
    /** `skillParamJson.statusEveryNAttacks`；缺省 = 不配（每次都挂，即改动前行为）。 */
    statusEveryNAttacks?: number;
    /** 计划行声明的命中状态 id（点燃）；缺省 = 不挂。 */
    statusId?: string;
    /** 普攻行自带的 `empoweredEvery`（树妖 = 6）。 */
    empoweredEvery?: number;
    /** 强化那一击的档案（灼热地带：area + 5 秒区域）。 */
    empoweredProfile?: ZCAttackProfile;
}

function makeHarness(options: IHarnessOptions) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const applied: (string | undefined)[] = [];

    const profile: ZCAttackProfile = {
        skillId: 30711, name: '树妖普攻', mode: ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: options.empoweredEvery ?? 0,
        empoweredSkillId: options.empoweredProfile ? 30811 : 0,
        durationSeconds: 0, waves: 1,
        legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68003', name: '火焰树妖', maxHp: 1000, attack: 100,
        moveSpeed: 0, attackRange: 30, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1,
        attackProfile: profile,
        ...(options.empoweredProfile ? { empoweredProfile: options.empoweredProfile } : {}),
    } as ZCUnitDefinition;

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68003', skillId: 30711, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none',
        parameters: options.statusEveryNAttacks ? { statusEveryNAttacks: options.statusEveryNAttacks } : {},
        ...(options.statusId ? { statusId: options.statusId } : {}),
    };

    const state = {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units: [source, target], nextUnitId: 3,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1,
        groundZones: [],
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY,
        bodyRadius: 6, cardId: null,
    };

    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: { ...perOwner(() => new Map()), [ZCOwner.Player]: new Map([['68003:30711', runtime]]) },
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map([[source.id, source], [target.id, target]]),
        currentTarget: () => targetRef,
        evaluateLegacySkill: () => ({
            buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0,
        }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: (_unit, statusId) => { applied.push(statusId); },
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
    };

    return {
        source, target, state, context, applied,
        /** 打一次普攻（内部会把 `completedAttackCount` 自增）。 */
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
    };
}

test('火焰树妖点燃：每 3 次普攻的第 3 次才挂状态', () => {
    const harness = makeHarness({ statusEveryNAttacks: 3, statusId: 'burn_ignite_l1' });
    for (let index = 0; index < 6; index += 1) harness.attack();
    // 6 次出手只挂 2 次，且落在第 3 / 第 6 拍上。
    // 非节拍那一拍 `applyHitStatus` 仍会被调用、只是 id 为 undefined（下游即空操作），
    // 所以这里按**原始调用序列**断言，顺带把「不是没结算、是没挂上」也钉住。
    assert.deepEqual(harness.applied, [
        undefined, undefined, 'burn_ignite_l1',
        undefined, undefined, 'burn_ignite_l1',
    ]);
    assert.equal(harness.source.completedAttackCount, 6);
});

test('火焰树妖点燃：节拍闸门不影响第 1、2 次普攻的普通伤害事件', () => {
    const harness = makeHarness({ statusEveryNAttacks: 3, statusId: 'burn_ignite_l1' });
    harness.attack();
    harness.attack();
    // 前两拍：抬手事件照发、状态一个都不挂（区分「不挂状态」与「没出手」）。
    assert.equal(harness.state.combatEvents.length, 2);
    assert.deepEqual(harness.applied, [undefined, undefined]);
});

test('未配 statusEveryNAttacks 时每次普攻都挂状态（改动前行为不变）', () => {
    const harness = makeHarness({ statusId: 'burn_ignite_l1' });
    for (let index = 0; index < 4; index += 1) harness.attack();
    assert.equal(harness.applied.length, 4);
});

test('第 6 次普攻同时触发灼热地带时，点燃不会被区域分支吞掉', () => {
    const harness = makeHarness({
        statusEveryNAttacks: 3,
        statusId: 'burn_ignite_l1',
        empoweredEvery: 6,
        empoweredProfile: {
            skillId: 30811, name: '树妖·灼热地带', mode: ZCCombatEventType.Area,
            projectileSpeed: 0, areaRadius: 60, damageRate: 0.35,
            empoweredEvery: 0, empoweredSkillId: 0,
            durationSeconds: 5, waves: 5,
            effectPrefabPath: 'units/projectiles/火焰树妖_灼热地带技能/火焰树妖_灼热地带技能',
        },
    });
    for (let index = 0; index < 6; index += 1) harness.attack();
    // 第 3 拍（普通命中）与第 6 拍（强化区域）各挂一次。
    assert.deepEqual(harness.applied, [
        undefined, undefined, 'burn_ignite_l1',
        undefined, undefined, 'burn_ignite_l1',
    ]);
    // 第 6 拍确实走了区域分支：落了一个 5 秒的灼热地带。
    assert.equal(harness.state.groundZones.length, 1);
    assert.equal(harness.state.groundZones[0].remainingSeconds, 5);
    assert.equal(harness.state.groundZones[0].skillId, 30811);
    // 60 表值 × combatDistanceScale 0.3 = 18 世界半径。
    assert.equal(harness.state.groundZones[0].radius, 18);
    // 区域那一击的伤害倍率取技能行 0.35。
    assert.equal(harness.state.groundZones[0].damage, 35);
});
