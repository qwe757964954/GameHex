/**
 * 技能释放的「触发范围」（2026-11-11 用户需求）：
 *
 *   「所有技能释放有一个触发范围，同角色的普通攻击的范围，否则达到触发条件也不会直接触发，
 *     只是待触发状态，直到目标进入范围才会触发」
 *
 * 落地口径（用户当场拍板）：
 *  - **只有打人类的走闸门** —— 副轨扇形 / 自身光环 / 多点打击 / 移形换影；
 *    自身增益（`self_cast`：自愈 / 嗜血 / 迅击）与被动、连发、低血护体不设闸门；
 *  - **直接压到普攻范围** —— 技能自带的搜索半径封顶到普攻射程，只压不抬；
 *  - **不做表现层提示** —— 纯逻辑，不动 prefab；
 *  - **吃攻击距离 buff**（`attackRangePct` 由 `effectiveDefinition` 算好，闸门直接用）。
 *
 * 「待触发」不是新状态机：`readyAt` 停在过去 + 本帧不执行、一个字节都不消费，
 * 目标进范围的那一帧立刻补放。下面每一条都同时钉住「没放」和「CD 没被消费」两件事。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';
import type { IZCStrikeOptions } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

/** 只造 `ZCSkillTriggerSystem` 真正读到的字段，其余留空。 */
function unit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: '68025', owner: 'player', cardId: 'c', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 100, maxHp: 100, battleState: 'idle',
        freeX: 0, freeY: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[]): ZCSnapshot {
    return {
        units, elapsedSeconds: 0, statusEffects: { nextUid: 1, units: [] },
        //  移形换影会往这里推一条「出发地闪一下」的纯表现事件，缺了会当场炸。
        combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
}

function runtime(parameters: Record<string, number>, extra: Partial<ZCSkillRuntimeDefinition> = {}): ZCSkillRuntimeDefinition {
    return {
        unitId: '68025', skillId: 30251, behaviorKey: 'skill_params', trigger: 'every_seconds',
        stateMode: 'none', parameters, ...extra,
    };
}

interface IHarness {
    readonly casts: string[];
    readonly strikes: IZCStrikeOptions[];
    readonly blinks: { id: number; x: number; y: number }[];
    readonly bursts: number[];
    setGate(value: boolean): void;
    /** 「最近的敌人有多远」（世界 px）；缺省 `Infinity` = 场上没人。 */
    setNearest(value: number): void;
    readonly value: Parameters<typeof ZCSkillTriggerSystem.tick>[2];
}

/**
 * `inAttackRange` 用一个开关模拟「普攻射程内有没有目标」——本文件验的是闸门的**接线**，
 * 闸门自身的判据由最后一条用例（真 `ZCUnitTargeting`）单独钉。
 */
function harness(statusSystem: ZCStatusSystem, parameters: Record<string, number>, options: {
    readonly gate?: boolean;
    readonly attackReach?: number;
    readonly nearest?: number;
} = {}): IHarness {
    const casts: string[] = [];
    const strikes: IZCStrikeOptions[] = [];
    const blinks: { id: number; x: number; y: number }[] = [];
    const bursts: number[] = [];
    //  同一份运行时给**己方**所有单位：本文件每次只验一条车道，不需要按 id 区分；
    //  敌方 `runtimeOf` 返回 undefined，否则双方会互相闪来闪去（移形换影那条会数出两个）。
    const rt = runtime(parameters);
    let gate = options.gate ?? true;
    let nearest = options.nearest ?? Number.POSITIVE_INFINITY;
    const value = {
        statusSystem,
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? rt : undefined),
        fireBurst: (target: ZCUnitState) => { bursts.push(target.id); },
        castSecondary: (target: ZCUnitState) => { casts.push(`secondary:${target.id}`); return true; },
        castSelfAura: (target: ZCUnitState) => { casts.push(`aura:${target.id}`); return true; },
        strike: (_target: ZCUnitState, strikeOptions: IZCStrikeOptions) => {
            strikes.push(strikeOptions);
            return 1;
        },
        blinkTo: (target: ZCUnitState, x: number, y: number) => { blinks.push({ id: target.id, x, y }); },
        unitPosition: (target: ZCUnitState) => ({ x: target.freeX, y: target.freeY }),
        distanceScale: 0.3,
        inAttackRange: () => gate,
        attackReachOf: () => options.attackReach ?? 148.5,
        //  2026-11-12 新增：技能自己的触发距离用得到它（`auraTriggerRange`）。
        nearestEnemyDistance: () => nearest,
    };
    return {
        casts, strikes, blinks, bursts,
        setGate: (next: boolean) => { gate = next; },
        setNearest: (next: number) => { nearest = next; },
        value: value as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2],
    };
}

// ────────────────────────────────────────────── 闸门缺省 = 不设闸门（既有行为逐字不变）

test('不传 inAttackRange ⇒ 不设闸门：自身光环到点即放', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    const fired: number[] = [];
    const value = {
        statusSystem,
        runtimeOf: () => runtime({ auraCooldown: 5, auraSeconds: 3, auraRadius: 200, auraDamageRate: 1 }),
        fireBurst: () => {},
        castSecondary: () => true,
        castSelfAura: (target: ZCUnitState) => { fired.push(target.id); return true; },
    };
    //  首步只挂冷却，不放（与 `secondaryReadyAt` / `selfCastReadyAt` 同口径）。
    ZCSkillTriggerSystem.tick(state, 0.05, value as never);
    assert.deepEqual(fired, []);
    assert.equal(caster.auraReadyAt, 5);

    state.elapsedSeconds = 5;
    ZCSkillTriggerSystem.tick(state, 0.05, value as never);
    assert.deepEqual(fired, [1]);
    assert.equal(caster.auraReadyAt, 10);
});

// ────────────────────────────────────────────── 待触发：自身光环 / 副轨扇形

test('待触发：冷却到点但普攻范围内没人 ⇒ 不放、不消费 CD，目标进范围当帧补放', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    const ctx = harness(statusSystem, {
        auraCooldown: 5, auraSeconds: 3, auraRadius: 200, auraDamageRate: 1,
    }, { gate: false });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(caster.auraReadyAt, 5);

    //  到点，但范围内没人 ⇒ 待触发：一次都没放，`auraReadyAt` 仍停在 5（没被推到 10）。
    state.elapsedSeconds = 5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, []);
    assert.equal(caster.auraReadyAt, 5, '待触发不许消费冷却');

    //  再过几帧仍然没人 ⇒ 继续待触发，依旧不消费。
    state.elapsedSeconds = 9;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, []);
    assert.equal(caster.auraReadyAt, 5);

    //  目标进范围：同一帧补放，CD 从现在重新起算。
    ctx.setGate(true);
    state.elapsedSeconds = 9.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, ['aura:1']);
    assert.equal(caster.auraReadyAt, 14.5);
});

test('待触发：副轨扇形不再对着半张图外的锁定目标空放', () => {
    const statusSystem = new ZCStatusSystem();
    const sweeper = unit(2);
    const state = snapshot([sweeper]);
    //  `castFanSkill` 只判「有没有锁定目标」，锁敌是仇恨锁 ⇒ 目标可能在远处正跑过来。
    const ctx = harness(statusSystem, { secondaryCooldown: 8 }, { gate: false });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(sweeper.secondaryReadyAt, 8);

    state.elapsedSeconds = 8;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, [], '范围内没人不该清一片空气');
    assert.equal(sweeper.secondaryReadyAt, 8);

    ctx.setGate(true);
    state.elapsedSeconds = 8.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, ['secondary:2']);
    assert.equal(sweeper.secondaryReadyAt, 16.5);
});

// ────────────────────────────────────────────── 搜索半径压到普攻射程（只压不抬）

test('多点打击：搜索半径封顶到普攻射程，比普攻近的保持原样', () => {
    const statusSystem = new ZCStatusSystem();
    const dragon = unit(1);
    const state = snapshot([dragon]);
    //  镭射飞龙表值 1100 → 世界 330px；普攻射程 148.5px ⇒ 压到 148.5。
    const ctx = harness(statusSystem, {
        strikeCount: 3, strikeRadius: 1100, strikeCooldown: 12, strikeNearest: 1,
    }, { attackReach: 148.5 });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(ctx.strikes.length, 1);
    assert.equal(ctx.strikes[0].radius, 148.5, '超出普攻射程的部分要被压掉');

    //  毒箭蘑菇 252（75.6px）本来就比普攻近 ⇒ 只压不抬，不许被放大到 148.5。
    const shooter = unit(1);
    const nearState = snapshot([shooter]);
    const nearCtx = harness(statusSystem, {
        strikeCount: 3, strikeRadius: 252, strikeCooldown: 12,
    }, { attackReach: 148.5 });
    nearState.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(nearState, 0.05, nearCtx.value);
    nearState.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(nearState, 0.05, nearCtx.value);
    assert.equal(nearCtx.strikes.length, 1);
    assert.ok(Math.abs(nearCtx.strikes[0].radius - 75.6) < 1e-9, '自身更小的搜索半径不该被放大');
});

test('多点打击（按累计次数）：次数攒够但身边没人 ⇒ 待触发，不许记次数，进范围立刻补', () => {
    const statusSystem = new ZCStatusSystem();
    const shooter = unit(1, { completedAttackCount: 6 });
    const state = snapshot([shooter]);
    const ctx = harness(statusSystem, {
        strikeCount: 2, strikeRadius: 500, strikeEvery: 3,
    }, { gate: false });

    //  首步只把基线对齐到当前累计次数（`strikeFiredCount` 缺省 ⇒ 记一次就走）。
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(shooter.strikeFiredCount, 6);

    shooter.completedAttackCount = 9;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(ctx.strikes.length, 0, '攒够 3 次但普攻范围内没人 ⇒ 待触发');
    assert.equal(shooter.strikeFiredCount, 6, '待触发不许记次数，否则进范围后这一波就丢了');

    ctx.setGate(true);
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(ctx.strikes.length, 1, '进范围立刻补这一波，不必再等 3 次普攻');
    assert.equal(shooter.strikeFiredCount, 9);
});

test('移形换影：压到普攻射程后，只闪射程内的敌人，射程外不消费 12 秒 CD', () => {
    const statusSystem = new ZCStatusSystem();
    const magician = unit(1, { freeX: 0, freeY: 0 });
    const victim = unit(9, { owner: 'enemy', freeX: 170, freeY: 0, battleState: 'idle' });
    const state = snapshot([magician, victim]);
    //  表值 600 → 世界 180px；封顶 148.5 ⇒ 170px 的敌人不参与挑选，100px 的参与。
    const ctx = harness(statusSystem, {
        blinkCooldown: 12, blinkSearchRadius: 600, blinkDamageRate: 1.2,
    }, { attackReach: 148.5 });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(magician.blinkReadyAt, 12);

    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(ctx.blinks.length, 0, '170px 在封顶后的 148.5px 之外');
    assert.equal(magician.blinkReadyAt, 12, '空闪不消费 CD');

    victim.freeX = 100;
    state.elapsedSeconds = 12.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(ctx.blinks.length, 1, '目标进射程就闪');
    assert.equal(magician.blinkReadyAt, 24.5);
});

// ────────────────────────────────────────────── 不设闸门的三类（用户 2026-11-11 口径）

test('自身增益不受闸门影响：范围内没人也照放（被远程风筝时残血要能自救）', () => {
    const statusSystem = new ZCStatusSystem();
    const healer = unit(1);
    const state = snapshot([healer]);
    const ctx = harness(statusSystem, {
        selfCastCooldown: 10, selfCastSeconds: 2, selfCastDamagePct: 20,
    }, { gate: false });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(healer.selfCastReadyAt, 10);

    state.elapsedSeconds = 10;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(healer.selfCastReadyAt, 20, 'self_cast 消费 CD，与闸门无关');
    assert.equal(statusSystem.statModsOf('1').damageRatePct, 20);
});

test('被动 / 连发 / 低血护体不受闸门影响：它们不是「释放」', () => {
    const statusSystem = new ZCStatusSystem();
    const guard = unit(1, { hp: 40, maxHp: 100 });
    const shooter = unit(2, {
        burstShotsLeft: 2, burstInterval: 0.2, burstNextAt: 0, burstDamageRate: 0.8,
    });
    const state = snapshot([guard, shooter]);
    const ctx = harness(statusSystem, {
        lowHpThreshold: 0.6, lowHpReducePct: 20, lowHpSeconds: 10, lowHpCooldown: 0,
    }, { gate: false });

    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(guard.lowHpGuardFiredAt, 0, '低血护体照常触发');
    assert.equal(statusSystem.statModsOf('1').damageTakenPct, -20);
    assert.deepEqual(ctx.bursts, [2], '连发是普攻的延续，闸门管不着');
});

// ────────────────────────────────────────────── 闸门自身的判据（真 ZCUnitTargeting）

test('hasTargetInAttackRange：与普攻同一套 attackReach，且不依赖锁敌', () => {
    const soldier = unit(1, { freeX: 0, freeY: 0 });
    const enemy = unit(2, { owner: 'enemy', freeX: 35, freeY: 0 });
    //  飞行单位（68003 的 baseDefinition）在「不能打空」的射手眼里永远不算目标。
    const airborne = unit(3, { owner: 'enemy', unitId: '68003', freeX: 5, freeY: 0 });
    const dead = unit(4, { owner: 'enemy', freeX: 5, freeY: 0, battleState: 'dead' });
    const units = new Map([[1, soldier], [2, enemy], [3, airborne], [4, dead]]);
    const map: ZCMatchMap = {
        id: 'trigger-range-test', rows: 0, columns: 0, playerHomeId: 0, enemyHomeId: 0,
        hexes: [], owners: [],
    };
    //  射程 30 ≤ 100 ⇒ reach = (30 + 目标身体 10) × 1 = 40。
    const definition = {
        attackRange: 30, bodyRadius: 10, canAttackAir: false, flying: false,
    } as ZCUnitDefinition;
    const airborneDefinition = {
        attackRange: 30, bodyRadius: 10, canAttackAir: false, flying: true,
    } as ZCUnitDefinition;
    const unitPosition = (candidate: ZCUnitState): { x: number; y: number } => ({ x: candidate.freeX, y: candidate.freeY });
    const targeting = new ZCUnitTargeting({
        map, geometry: new ZCMapGeometry(map), units, combatDistanceScale: 1,
        targeting: {
            now: 1, units: [...units.values()], hexes: [],
            unitById: (id) => units.get(id) ?? null,
            unitPosition, hexPosition: () => ({ x: 0, y: 0 }),
            effectiveDefinition: (candidate) => (candidate.unitId === '68003' ? airborneDefinition : definition),
            hasExposedWall: () => false,
        },
        baseDefinition: (id) => (id === '68003' ? airborneDefinition : definition),
        effectiveDefinition: () => definition,
        unitPosition,
        hex: () => null,
        hasExposedWall: () => false,
    });

    //  没锁敌也照样判：35px 的敌人在 40px 射程内。
    assert.equal(soldier.targetUnitId ?? null, null);
    assert.equal(targeting.hasTargetInAttackRange(soldier), true);
    assert.equal(targeting.attackReachOf(soldier), 40);

    enemy.freeX = 45;
    assert.equal(targeting.hasTargetInAttackRange(soldier), false, '45px 超出 40px 射程');

    //  唯一的近处候选是飞行单位 ⇒ 打不到；再补一个死掉的敌人也不算。
    assert.equal(targeting.hasTargetInAttackRange(soldier), false);
    enemy.battleState = 'dead';
    enemy.freeX = 10;
    assert.equal(targeting.hasTargetInAttackRange(soldier), false, '死人不算目标');
});

// ────────────────────────────────────────────── 技能自己的触发距离（2026-11-12，喷火 102603）

test('auraTriggerRange：最近目标还在 350 表值 px 之外 ⇒ 待触发、不消费 CD', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    //  distanceScale 0.3 ⇒ 350 表值 px = 105 世界 px；普攻射程 148.5 世界 px（= 495 表值）。
    const ctx = harness(statusSystem, {
        auraCooldown: 12, auraSeconds: 3, auraRadius: 50, auraDamageRate: 1,
        auraForward: 300, auraTriggerRange: 350,
    }, { gate: true, nearest: 200 });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(caster.auraReadyAt, 12);

    //  到点，普攻够得着（gate=true），但最近的敌人还在 120 世界 px（= 400 表值）⇒ 不放。
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, [], '350px 外不许放');
    assert.equal(caster.auraReadyAt, 12, '待触发不许消费冷却');

    //  走进 350 表值 px 的那一帧立刻补放（105 世界 px 含等于）。
    ctx.setNearest(105);
    state.elapsedSeconds = 12.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, ['aura:1']);
    assert.equal(caster.auraReadyAt, 24.5);
});

test('不配 auraTriggerRange ⇒ 只走普攻射程闸门（既有技能逐字不变）', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = unit(1);
    const state = snapshot([caster]);
    const ctx = harness(statusSystem, {
        auraCooldown: 5, auraSeconds: 3, auraRadius: 200, auraDamageRate: 1,
    }, { gate: true, nearest: 9999 });

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    state.elapsedSeconds = 5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, ['aura:1'], '没配这条参数 ⇒ 目标再远也照旧放');
    assert.equal(caster.auraReadyAt, 10);
});

test('nearestEnemyDistance：中心到中心，过滤死人 / 打不到的空中单位', () => {
    const soldier = unit(1, { freeX: 0, freeY: 0 });
    const near = unit(2, { owner: 'enemy', freeX: 30, freeY: 40 });   // 50
    const far = unit(3, { owner: 'enemy', freeX: 200, freeY: 0 });    // 200
    const airborne = unit(4, { owner: 'enemy', unitId: '68003', freeX: 5, freeY: 0 });
    const dead = unit(5, { owner: 'enemy', freeX: 6, freeY: 0, battleState: 'dead' });
    const ally = unit(6, { owner: 'player', freeX: 7, freeY: 0 });
    const units = new Map([[1, soldier], [2, near], [3, far], [4, airborne], [5, dead], [6, ally]]);
    const map: ZCMatchMap = {
        id: 'nearest-distance-test', rows: 0, columns: 0, playerHomeId: 0, enemyHomeId: 0,
        hexes: [], owners: [],
    };
    const definition = {
        attackRange: 550, bodyRadius: 24, canAttackAir: false, flying: false,
    } as ZCUnitDefinition;
    const airborneDefinition = {
        attackRange: 550, bodyRadius: 24, canAttackAir: false, flying: true,
    } as ZCUnitDefinition;
    const unitPosition = (candidate: ZCUnitState): { x: number; y: number } => ({ x: candidate.freeX, y: candidate.freeY });
    const targeting = new ZCUnitTargeting({
        map, geometry: new ZCMapGeometry(map), units, combatDistanceScale: 0.3,
        targeting: {
            now: 1, units: [...units.values()], hexes: [],
            unitById: (id) => units.get(id) ?? null,
            unitPosition, hexPosition: () => ({ x: 0, y: 0 }),
            effectiveDefinition: (candidate) => (candidate.unitId === '68003' ? airborneDefinition : definition),
            hasExposedWall: () => false,
        },
        baseDefinition: (id) => (id === '68003' ? airborneDefinition : definition),
        effectiveDefinition: () => definition,
        unitPosition,
        hex: () => null,
        hasExposedWall: () => false,
    });

    //  50 世界 px（= 166.7 表值）：既没补身体半径、也没打九折 —— 用户量的是「敌人处于多少 px」。
    assert.ok(Math.abs(targeting.nearestEnemyDistance(soldier) - 50) < 1e-9);

    near.battleState = 'dead';
    assert.equal(targeting.nearestEnemyDistance(soldier), 200, '死人不算，退到 200');

    far.battleState = 'dead';
    assert.equal(targeting.nearestEnemyDistance(soldier), Number.POSITIVE_INFINITY,
        '只剩会飞的（射手不能打空）⇒ 场上没有可打的目标');
});
