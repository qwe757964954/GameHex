import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCDamageResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCDamageResolutionSystem';
import { ZCSkillTriggerSystem, lowHpGuardStatusId } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';

/** 只造 `ZCSkillTriggerSystem` 真正读到的字段，其余留空。 */
function unit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: '68002', owner: 'player', cardId: 'c', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 100, maxHp: 100, battleState: 'idle',
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[]): ZCSnapshot {
    return {
        units, elapsedSeconds: 0, statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

function runtime(parameters: Record<string, number>, extra: Partial<ZCSkillRuntimeDefinition> = {}): ZCSkillRuntimeDefinition {
    return {
        unitId: '68002', skillId: 30802, behaviorKey: 'empowered_attack', trigger: 'every_seconds',
        stateMode: 'counter', parameters, ...extra,
    };
}

function context(statusSystem: ZCStatusSystem, runtimes: Map<number, ZCSkillRuntimeDefinition>) {
    const fired: number[] = [];
    return {
        fired,
        value: {
            statusSystem,
            runtimeOf: (target: ZCUnitState) => runtimes.get(target.id),
            fireBurst: (target: ZCUnitState) => { fired.push(target.id); },
        },
    };
}

test('常驻被动状态只挂一次，缺省不挂', () => {
    const statusSystem = new ZCStatusSystem();
    statusSystem.register({
        id: 'thorn', name: 'thorn', durationSeconds: 0, refreshPolicy: 'refresh',
        statMods: { damageTakenRangedPct: -10 }, behavior: { kind: 'none' },
    });
    const withPassive = unit(1);
    const withoutPassive = unit(2);
    const state = snapshot([withPassive, withoutPassive]);
    const runtimes = new Map([[1, runtime({}, { passiveStatusId: 'thorn' })]]);
    const ctx = context(statusSystem, runtimes);

    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(withPassive.passiveStatusApplied, true);
    assert.equal(statusSystem.statModsOf('1').damageTakenRangedPct, -10);
    assert.deepEqual(statusSystem.statModsOf('2'), {});

    //  再走一步不会叠第二层（`maxStacks` 默认 1，叠加会变成 -20）。
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(statusSystem.statModsOf('1').damageTakenRangedPct, -10);
    assert.equal(withoutPassive.passiveStatusApplied, undefined);
});

test('单体护盾按时到期清零，没登记到期的旧护盾不动', () => {
    const statusSystem = new ZCStatusSystem();
    const timed = unit(1, { shield: 30, shieldExpireAt: 1 });
    const legacy = unit(2, { shield: 30 });
    const state = snapshot([timed, legacy]);
    const ctx = context(statusSystem, new Map());

    state.elapsedSeconds = 0.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(timed.shield, 30);

    state.elapsedSeconds = 1;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(timed.shield, 0);
    assert.equal(timed.shieldExpireAt, undefined);
    assert.equal(legacy.shield, 30);
});

test('连发到点发弹，发满后清空连发字段', () => {
    const statusSystem = new ZCStatusSystem();
    const shooter = unit(1, {
        burstShotsLeft: 2, burstInterval: 0.25, burstNextAt: 0.25, burstDamageRate: 0.8,
    });
    const state = snapshot([shooter]);
    const ctx = context(statusSystem, new Map());

    state.elapsedSeconds = 0.2;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.fired, []);

    state.elapsedSeconds = 0.25;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.fired, [1]);
    assert.equal(shooter.burstShotsLeft, 1);
    assert.equal(shooter.burstNextAt, 0.5);

    state.elapsedSeconds = 0.5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.fired, [1, 1]);
    assert.equal(shooter.burstShotsLeft, undefined);
    assert.equal(shooter.burstNextAt, undefined);
    assert.equal(shooter.burstInterval, undefined);
    assert.equal(shooter.burstDamageRate, undefined);
});

test('低血护体：跌破阈值才触发，按内置冷却重复，未达阈值不触发', () => {
    const statusSystem = new ZCStatusSystem();
    const guarded = unit(1, { hp: 70, maxHp: 100 });
    const healthy = unit(2, { hp: 100, maxHp: 100 });
    const state = snapshot([guarded, healthy]);
    const params = { lowHpThreshold: 0.6, lowHpReducePct: 20, lowHpSeconds: 10, lowHpCooldown: 20 };
    const runtimes = new Map([[1, runtime(params)], [2, runtime(params)]]);
    const ctx = context(statusSystem, runtimes);

    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(guarded.lowHpGuardFiredAt, undefined);
    assert.deepEqual(statusSystem.statModsOf('1'), {});

    guarded.hp = 50;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(guarded.lowHpGuardFiredAt, 0);
    assert.equal(statusSystem.statModsOf('1').damageTakenPct, -20);
    assert.equal(healthy.lowHpGuardFiredAt, undefined);
    assert.equal(statusSystem.hasDef(lowHpGuardStatusId(20, 10)), true);

    //  内置冷却未到，不刷新触发时刻。
    state.elapsedSeconds = 10;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(guarded.lowHpGuardFiredAt, 0);

    state.elapsedSeconds = 20;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(guarded.lowHpGuardFiredAt, 20);
});

test('受击反弹减益只压攻击者攻速，且护体有效期外不生效', () => {
    const statusSystem = new ZCStatusSystem();
    const tank = unit(1, { retaliateSlowPct: 10, retaliateUntil: 5 });
    const attacker = unit(2, { owner: 'enemy' });
    const state = snapshot([tank, attacker]);
    const registry = {
        byId: new Map([[1, tank], [2, attacker]]),
        markDead: () => undefined,
    };
    const damageContext = {
        statusSystem, units: registry as never,
        damageDealt: { player: 0, enemy: 0, enemy2: 0, enemy3: 0 },
        damageTaken: { player: 0, enemy: 0, enemy2: 0, enemy3: 0 },
    };

    state.elapsedSeconds = 1;
    ZCDamageResolutionSystem.damageUnit(state, tank, 10, { owner: 'enemy', kind: 'unit', unitId: 2 }, damageContext);
    assert.equal(statusSystem.statModsOf('2').attackIntervalPct, -10);
    assert.deepEqual(statusSystem.statModsOf('1'), {});

    //  过了 `retaliateUntil` 就不再反弹。
    const late = unit(3, { owner: 'enemy' });
    registry.byId.set(3, late);
    state.elapsedSeconds = 6;
    ZCDamageResolutionSystem.damageUnit(state, tank, 10, { owner: 'enemy', kind: 'unit', unitId: 3 }, damageContext);
    assert.deepEqual(statusSystem.statModsOf('3'), {});
});
