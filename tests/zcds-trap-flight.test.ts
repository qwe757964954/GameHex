/**
 * 毒箭蘑菇（68017）「穿甲爆矢」101704（2026-11-18，第 17 批）：
 *
 * 设计案 K/L/M 三档原文要点：
 *   「累计普攻 8 次后朝目标丢出陷阱，飞行速度 100、飞行 2 秒；途中触碰到敌人立即爆炸，
 *     对半径 150 内敌人造成 180/220/270% 伤害，并使其中毒 6 秒、每秒 15/25/35% 伤害；
 *     若 2 秒内没碰到敌人，则在落点停留 6/8/10 秒，期间被敌人触碰同样爆炸，
 *     到期无人触碰直接消失」
 *
 * 三条「照字面配就会静默错」的钉子：
 *
 *  1. **不是冷却制**。`trap_place` 原来是 `trapCooldown` 驱动（103504 精密陷阱），
 *     101704 是「累计普攻 8 次」⇒ 走 `trapEvery` + `unit.trapFiredCount`。
 *     硬套 CD 的话「站着不打人也能一直丢」，而设计要的是「打得够多才丢」。
 *  2. **到期不炸**。既有语义 `expireDamage > 0` 恒等于「到时自爆」，101704 的
 *     「没人踩直接消失」只能靠 `trapExpireOnTimeout: 0` 表达 —— 把伤害配成 0 会连
 *     「踩响了」也不掉血。
 *  3. **触碰不掉血**。设计只给了一份伤害（爆炸那一份），所以 `trapDamageRate` 整个不写；
 *     `castTrap` 只在投掷形态放行「触碰伤害 0」，原地陷阱漏配仍然拒放。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import {
    ZC_TRAP_EXPIRE_PREFAB_PATH, ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_SECONDS,
} from '../assets/script/app/zcds/model/ZCTrapFx';

// ────────────────────────────────────────────── 夹具

const ROOT = join(__dirname, '..');
const UNIT_ID = '68017';
const CHAIN = 101704;
const SKILL_ID = 30701;

/** L1 的参数袋（与配表脚本 `patch_trap_flight_batch17.js` 逐字一致）。 */
const PARAMS = {
    trapEvery: 8, trapFlightSpeed: 100, trapFlightSeconds: 2, trapDuration: 6,
    trapRadius: 50, trapExplodeRadius: 150, trapExplodeDamageRate: 1.8,
    trapStatusSeconds: 6, trapExpireOnTimeout: 0,
};

function readTable(name: string): Array<Record<string, unknown>> {
    const raw = readFileSync(join(ROOT, 'assets', 'remoteRef', `${name}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    const keys = parsed.k as string[];
    return (parsed.v as unknown[][]).map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
}

function readClientTable(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(
        join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

function unit(id: number, owner: ZCOwner, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: owner === 'player' ? UNIT_ID : '68001', owner, cardId: '68017', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[], elapsedSeconds = 0): ZCSnapshot {
    return {
        version: 4, elapsedSeconds, nextCombatEventId: 1,
        units, projectiles: [], groundZones: [], combatEvents: [], hexes: {},
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

/** 施法上下文：面板攻击 30、距离缩放 0.3（与项目口径一致）。 */
function trapContext(target: { x: number; y: number } | null, params: Record<string, number> = PARAMS,
    statusId: string | undefined = 'poison_bolt_l1') {
    const definition = {
        unitId: UNIT_ID, name: '毒箭蘑菇', maxHp: 800, attack: 30, moveSpeed: 40,
        attackRange: 550, attackInterval: 1.6, attackDuration: 0.5, attackHitTime: 0.2,
        bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
        prefabPath: 'units/units/毒箭蘑菇', prefabSize: 1,
        attackProfile: { skillId: SKILL_ID, name: '苔针', mode: 'projectile' },
    };
    return {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0.16, counterDamageMultiplier: 1.3 },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        deckBonuses: {
            [ZCOwner.Player]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
            [ZCOwner.Enemy]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
        },
        statPatches: { [ZCOwner.Player]: new Map([[UNIT_ID, {}]]), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([[`${UNIT_ID}:${SKILL_ID}`, { parameters: params, statusId }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        unitById: new Map(),
        statusSystem: { statModsOf: () => ({}), controlOf: () => null },
        geometry: { hexIdAt: () => 0 },
        random: () => 1,
        effectiveDefinition: () => definition,
        unitPosition: (item: ZCUnitState) => ({ x: item.freeX, y: item.freeY }),
        currentTarget: () => (target ? { kind: 'unit', id: 99, x: target.x, y: target.y, bodyRadius: 24, cardId: '68001' } : null),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false }),
        applyLegacySelfBuffs: () => [],
        damageUnit: () => null,
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => {},
    } as unknown as Parameters<typeof ZCAttackResolutionSystem.castTrap>[2];
}

function zoneContext(targets: ZCUnitState[], overrides: Record<string, unknown> = {}) {
    return {
        hexIdAt: () => 0,
        unitsInRadius: () => targets,
        unitPosition: (item: ZCUnitState) => ({ x: item.freeX, y: item.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => { target.hp -= damage; return null; },
        lifestealFromHit: () => {},
        applyStatus: () => {},
        ensureSlowStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
        random: () => 0.99,
        ...overrides,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];
}

function closeTo(actual: number, expected: number, message?: string): void {
    assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≠ ${expected}`);
}

// ────────────────────────────────────────────── 一、投掷形态：建区那一刻的参数

test('castTrap 投掷形态：朝目标飞 2 秒、落地停 6 秒、到期不炸、不带触碰伤害', () => {
    const caster = unit(1, 'player', { freeX: 0, freeY: 0 });
    const state = snapshot([caster]);
    //  目标在正右方 100 逻辑 px 处 ⇒ 速度应当朝 +x，且大小 = 100 × 距离缩放 0.3
    const context = trapContext({ x: 100, y: 0 });
    assert.equal(ZCAttackResolutionSystem.castTrap(state, caster, context), true);

    assert.equal(state.groundZones.length, 1);
    const zone = state.groundZones[0];
    //  总寿命 = 投掷 2 秒 + 停留 6 秒 —— 两段共用一个 remainingSeconds，落地后不会重新数一遍
    closeTo(zone.remainingSeconds, 8);
    closeTo(zone.flightSeconds ?? 0, 2);
    closeTo(zone.moveVelocityX ?? 0, 30, '100 逻辑 px/s × 0.3 = 30 世界 px/s');
    closeTo(zone.moveVelocityY ?? 0, 0);
    //  ⚠ 半径：爆炸 150 → 45 世界 px；触碰 50 → 15 世界 px（两个半径分工不同）
    closeTo(zone.radius, 45);
    closeTo(zone.contactRadius ?? 0, 15);
    //  设计只给一份伤害 ⇒ 触碰那一下是 0；把 0 也调 damageUnit 会飘出一个「-0」
    closeTo(zone.contactDamage ?? 0, 0);
    //  180% × 面板 30 = 54（暴击倍率 1）
    assert.equal(zone.expireDamage, 54);
    assert.equal(zone.expireRequiresContact, true, '「到期无人触碰直接消失」');
    assert.equal(zone.expireStatusId, 'poison_bolt_l1', '爆炸顺手挂中毒，id 走计划行的 statusId 列');
    closeTo(zone.expireStatusDuration ?? 0, 6);
    closeTo(zone.x, 0, '从脚下起飞');
    closeTo(zone.y, 0);
});

test('锁不到目标就朝正面丢：不能因为「没人可丢」把整次出手吞掉', () => {
    const caster = unit(1, 'player', { freeX: 0, freeY: 0, facingRadians: Math.PI / 2 });
    const state = snapshot([caster]);
    assert.equal(ZCAttackResolutionSystem.castTrap(state, caster, trapContext(null)), true);
    const zone = state.groundZones[0];
    closeTo(zone.moveVelocityX ?? 0, 0);
    closeTo(zone.moveVelocityY ?? 0, 30, '正面朝下 ⇒ 往 +y 丢');
});

test('参数不全就不放：触碰伤害为 0 只在投掷形态放行', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    //  去掉飞行段 ⇒ 退回「原地陷阱」语义，此时触碰伤害还是 0 属于漏配 ⇒ 必须拒放
    const withoutFlight = { ...PARAMS, trapFlightSpeed: 0, trapFlightSeconds: 0 };
    assert.equal(ZCAttackResolutionSystem.castTrap(state, caster, trapContext({ x: 100, y: 0 }, withoutFlight)), false);
    assert.equal(state.groundZones.length, 0, '被拒时一个区域都不该建');
    //  爆炸半径漏配也拒
    assert.equal(ZCAttackResolutionSystem.castTrap(state, caster,
        trapContext({ x: 100, y: 0 }, { ...PARAMS, trapExplodeRadius: 0 })), false);
});

// ────────────────────────────────────────────── 二、飞行段 → 落地 → 静止

test('飞满 2 秒就地落地：速度归零、剩下的时间当停留', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(state, caster, trapContext({ x: 100, y: 0 }));
    const zone = state.groundZones[0];
    const context = zoneContext([]);

    //  1.9 秒时还在飞
    for (let step = 0; step < 38; step += 1) ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.ok((zone.flightSeconds ?? 0) > 0, '1.9 秒时仍在飞行段');
    closeTo(zone.x, 57, '30 世界 px/s × 1.9s');

    //  走到 2 秒之后（多跑两帧，避开浮点误差）
    for (let step = 0; step < 4; step += 1) ZCGroundZoneSystem.tick(state, 0.05, context);
    closeTo(zone.flightSeconds ?? -1, 0, '落地后飞行秒数清零');
    closeTo(zone.moveVelocityX ?? -1, 0, '速度必须归零，否则会一直往前飘');
    closeTo(zone.x, 60, '飞满 2 秒 = 30 × 2 = 60 世界 px');
    const landedX = zone.x;
    for (let step = 0; step < 10; step += 1) ZCGroundZoneSystem.tick(state, 0.05, context);
    closeTo(zone.x, landedX, '落地后原地不动');
    assert.ok(zone.remainingSeconds > 0, '停留段还在读秒');
});

test('踩响 = 立即引爆：按当前位置结算爆炸 + 挂中毒，并摘掉常驻光环', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(state, caster, trapContext({ x: 100, y: 0 }));
    const zone = state.groundZones[0];
    const victim = unit(2, 'enemy', { freeX: 10, freeY: 0 });
    const applied: string[] = [];
    const context = zoneContext([victim], {
        applyStatus: (target: ZCUnitState, id: string) => { applied.push(`${target.id}:${id}`); },
    });

    ZCGroundZoneSystem.tick(state, 0.05, context);
    assert.equal(victim.hp, 1000 - 54, '爆炸 180% × 面板 30 = 54，踩响那一刻就掉');
    assert.deepEqual(applied, ['2:poison_bolt_l1'], '中毒挂在被打的人身上');
    assert.equal(state.groundZones.length, 0, '引爆后区域立刻消失');
    const expire = state.combatEvents.filter((event) => event.effectPrefabPath === ZC_TRAP_EXPIRE_PREFAB_PATH);
    assert.equal(expire.length, 1, '爆炸表现要推一条');
});

test('到期无人触碰：直接消失，不掉血也不播爆炸', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(state, caster, trapContext({ x: 100, y: 0 }));
    //  停留 6 秒 ⇒ 把剩余寿命压到最后一帧，期间没有任何敌人进触碰半径
    const zone = state.groundZones[0];
    zone.remainingSeconds = 0.02;
    zone.flightSeconds = 0;
    zone.moveVelocityX = 0;
    const victim = unit(2, 'enemy', { freeX: 999, freeY: 999 });
    ZCGroundZoneSystem.tick(state, 0.05, zoneContext([victim]));

    assert.equal(state.groundZones.length, 0, '到点消失');
    assert.equal(victim.hp, 1000, '远处的人不该挨打');
    assert.equal(state.combatEvents.filter((event) => event.effectPrefabPath === ZC_TRAP_EXPIRE_PREFAB_PATH).length,
        0, '「没人踩」不该播爆炸');
});

test('已经踩响的区域即使这一帧到期，也必须把爆炸结算完', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(state, caster, trapContext({ x: 100, y: 0 }));
    const zone = state.groundZones[0];
    //  踩响标记已经置位（同帧到期）⇒ `expireRequiresContact` 不能再拦一次
    zone.contactTriggered = true;
    zone.remainingSeconds = 0.02;
    zone.flightSeconds = 0;
    zone.moveVelocityX = 0;
    const victim = unit(2, 'enemy', { freeX: 0, freeY: 0 });
    ZCGroundZoneSystem.tick(state, 0.05, zoneContext([victim]));
    assert.equal(victim.hp, 1000 - 54);
});

// ────────────────────────────────────────────── 三、触发：累计普攻 8 次

function trapTrigger(caster: ZCUnitState, params: Record<string, number> = PARAMS) {
    const runtimeDefinition = {
        unitId: UNIT_ID, skillId: SKILL_ID, behaviorKey: 'trap_place',
        trigger: 'every_seconds', stateMode: 'none', parameters: params,
    } as unknown as ZCSkillRuntimeDefinition;
    const counters = { casts: 0, accepted: true };
    const state = snapshot([caster]);
    const context = {
        statusSystem: new ZCStatusSystem(),
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? runtimeDefinition : undefined),
        castTrap: () => { counters.casts += 1; return counters.accepted; },
        unitPosition: (target: ZCUnitState) => ({ x: target.freeX, y: target.freeY }),
        distanceScale: 0.3,
        inAttackRange: () => false,
        nearestEnemyDistance: () => Number.POSITIVE_INFINITY,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return { state, context, counters };
}

test('累计普攻 8 次才丢陷阱：首次只记数，之后每满 8 次一次', () => {
    const caster = unit(1, 'player');
    const { state, context, counters } = trapTrigger(caster);

    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 0, '开局不立刻丢');
    assert.equal(caster.trapFiredCount, 0, '第一次推进只记下当前计数');
    assert.equal(caster.trapReadyAt, undefined, '累计普攻制不该碰 CD 字段');

    caster.completedAttackCount = 7;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 0, '差一次不放');

    caster.completedAttackCount = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 1, '满 8 次丢一个');
    assert.equal(caster.trapFiredCount, 8, '推到最后一次消耗掉的计数');
    assert.ok((caster.castActionUntil ?? 0) > 0, '丢陷阱算一次主动出手（`markCastAction` 落 `castActionUntil`）');

    //  再打 7 次还不够，第 16 次才再丢一个
    caster.completedAttackCount = 15;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 1);
    caster.completedAttackCount = 16;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 2);
});

test('被拒（参数不全）不消费次数：攒满的机会不能一次配错就吞掉', () => {
    const caster = unit(1, 'player', { completedAttackCount: 8 });
    const { state, context, counters } = trapTrigger(caster);
    ZCSkillTriggerSystem.tick(state, 0.05, context);   // 首次只记数 ⇒ 记 8
    assert.equal(caster.trapFiredCount, 8);

    counters.accepted = false;
    caster.completedAttackCount = 16;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 1);
    assert.equal(caster.trapFiredCount, 8, '被拒不推进计数');

    counters.accepted = true;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 2, '下一帧重试成功');
    assert.equal(caster.trapFiredCount, 16);
});

test('103504 的冷却制不受影响：trapCooldown 与 trapEvery 各走各的', () => {
    const caster = unit(1, 'player');
    const cooldownParams = { trapCooldown: 10, trapDuration: 15, trapRadius: 50, trapDamageRate: 2, trapExplodeRadius: 100, trapExplodeDamageRate: 1.8, trapForward: 0 };
    const { state, context, counters } = trapTrigger(caster, cooldownParams);
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 0);
    closeTo(caster.trapReadyAt ?? -1, 10, 'CD 制还是首次挂 CD');
    assert.equal(caster.trapFiredCount, undefined, '不该碰累计计数');

    state.elapsedSeconds = 10;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(counters.casts, 1);
    closeTo(caster.trapReadyAt ?? -1, 20);
});

// ────────────────────────────────────────────── 四、配表守卫

test('101704 三档：trapEvery 8 + 飞行 2 秒 + 到期消失 + 各指一条中毒', () => {
    const stays = [6, 8, 10];
    const rates = [1.8, 2.2, 2.7];
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('trap')), [],
                '参数全带 trap 前缀，否则会串到 101701~101703');
            assert.equal(bag.trapEvery, 8, '设计 J 列 = 累计普攻 8 次');
            assert.equal(bag.trapCooldown, undefined, '不是冷却制');
            assert.equal(bag.trapFlightSpeed, 100, '100 逻辑 px / 秒（用户裁定）');
            assert.equal(bag.trapFlightSeconds, 2);
            assert.equal(bag.trapDuration, stays[index]);
            assert.equal(bag.trapExplodeRadius, 150);
            assert.equal(bag.trapExplodeDamageRate, rates[index]);
            assert.equal(bag.trapExpireOnTimeout, 0, '到期无人触碰直接消失');
            assert.equal(bag.trapDamageRate, undefined, '触碰不给独立伤害');
            assert.equal(row.statusId, `poison_bolt_l${index + 1}`);
            assert.equal(Number(row.unlockHeroLevel), [9, 18, 27][index]);
            assert.equal(row.behaviorKey, 'trap_place');
        });
    }
});

test('三条中毒状态：每秒 15/25/35%、持续 6 秒、按施加者攻击力', () => {
    const pcts = [15, 25, 35];
    for (const rows of [readTable('pvpStatus'), readClientTable('pvpStatus')]) {
        pcts.forEach((pct, index) => {
            const row = rows.find((item) => item.statusId === `poison_bolt_l${index + 1}`);
            assert.ok(row, `poison_bolt_l${index + 1} 必须在 pvpStatus 里`);
            assert.equal(row!.handlerKey, 'periodic_damage');
            assert.equal(Number(row!.intervalSeconds), 1);
            assert.equal(Number(row!.periodicAmountPct), pct);
            assert.equal(Number(row!.durationSeconds), 6);
            assert.equal(row!.periodicBasis, 'senderAttack');
        });
    }
});

test('103504 精密陷阱一字未动：还有 CD、没有飞行段、到期照旧自爆', () => {
    const rows = readClientTable('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 103504);
    assert.equal(rows.length, 3);
    for (const row of rows) {
        const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        assert.equal(bag.trapCooldown, 10);
        assert.equal(bag.trapFlightSpeed, undefined);
        assert.equal(bag.trapExpireOnTimeout, undefined);
        assert.ok(bag.trapDamageRate > 0, '原地陷阱靠踩响那一下掉血');
    }
});

test('K 表 / armySkillLevelUp：卡面名字与描述已补齐，解锁等级 = 9/18/27', () => {
    const plans = readTable('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readTable('armySkillLevelUp'), readClientTable('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '穿甲爆矢');
            assert.equal(row.desc, plans[index].desc, '卡面描述必须与 pvpSkillPlan 逐字相同');
            assert.equal(Number(row.unlockarmylevel), [9, 18, 27][index]);
            assert.deepEqual(row.modfiy, [Number(plans[index].modifierId)]);
        });
    }
});

test('常驻/生成表现仍走 103504 那三条路径，投掷段不需要新资源', () => {
    assert.ok(ZC_TRAP_IDLE_PREFAB_PATH.length > 0);
    assert.ok(ZC_TRAP_SPAWN_SECONDS > 0);
    //  飞行段只改坐标（`syncHoldVisual` 每帧搬事件），不新增 prefab ——
    //  这条断言是「别再往资源计划里塞第四个 path」的提醒。
    const spawn = ZC_TRAP_IDLE_PREFAB_PATH.split('/').pop() ?? '';
    assert.doesNotMatch(spawn, /flight/i);
});
