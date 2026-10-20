import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCStatusResolutionSystem, type IZCStatusResolutionContext } from '../assets/script/app/zcds/model/systems/ZCStatusResolutionSystem';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

function unit(id: number, owner: 'player' | 'enemy', x: number, hp = 100): ZCUnitState {
    return {
        id, owner, freeX: x, freeY: 0, hp, maxHp: 100,
        battleState: 'idle', attackMultiplier: 1,
    } as ZCUnitState;
}

function setup(units: ZCUnitState[]) {
    const statusSystem = new ZCStatusSystem();
    const events: string[] = [];
    const damageOwners: string[] = [];
    const state = { units, elapsedSeconds: 1, statusEffects: undefined } as unknown as ZCSnapshot;
    const context: IZCStatusResolutionContext = {
        statusSystem,
        unitById: new Map(units.map((entry) => [entry.id, entry])),
        owners: ['player', 'enemy'],
        combatDistanceScale: 1,
        // 接口取的是 IZCModelServices.effectiveDefinition（完整定义），本替身只关心
        // attack / maxHp 两项 —— 与上面 `unit()` 的 `as ZCUnitState` 同一种替身写法。
        effectiveDefinition: (entry) => ({
            attack: 30,
            maxHp: 100 * (1 + (statusSystem.statModsOf(String(entry.id)).maxHpPct ?? 0) / 100),
        } as ZCUnitDefinition),
        unitPosition: (entry) => ({ x: entry.freeX, y: entry.freeY }),
        displaceUnit: (entry, dx, dy) => { entry.freeX += dx; entry.freeY += dy; },
        damageUnit: (entry, amount, source) => {
            events.push(`damage:${amount}`);
            damageOwners.push(source.owner);
            entry.hp -= amount;
            // 接口取的是 IZCModelServices.damageUnit（返回飘字或 null），替身不需要飘字。
            return null;
        },
        presentHeal: (_entry, amount) => { events.push(`heal:${amount}`); },
    };
    return { state, statusSystem, context, events, damageOwners };
}

test('状态到期当拍仍结算最后一次周期伤害，随后移除状态并导出快照', () => {
    const source = unit(1, 'player', 0);
    const target = unit(2, 'enemy', 40);
    const { state, statusSystem, context, events } = setup([source, target]);
    statusSystem.register({
        id: 'burn', name: 'burn', durationSeconds: 1,
        behavior: { kind: 'periodic', intervalSeconds: 1, effect: 'damage', amountPct: 10, basis: 'targetMaxHp' },
    });
    statusSystem.apply('2', 'burn', { at: 0, sourceUnitId: '1' });

    ZCStatusResolutionSystem.tick(state, 1, context);
    assert.deepEqual(events, ['damage:10']);
    assert.equal(target.hp, 90);
    assert.equal(statusSystem.instancesOf('2').length, 0);
    assert.deepEqual(state.statusEffects, statusSystem.exportSnapshot());

    state.elapsedSeconds = 2;
    ZCStatusResolutionSystem.tick(state, 1, context);
    assert.deepEqual(events, ['damage:10']);
});

test('周期治疗只呈现实际回复量，状态过期后按生命比例恢复上限', () => {
    const target = unit(2, 'player', 0, 90);
    target.maxHp = 200;
    const { state, statusSystem, context, events } = setup([target]);
    statusSystem.register({
        id: 'blessing', name: 'blessing', durationSeconds: 1, statMods: { maxHpPct: 100 },
        behavior: { kind: 'periodic', intervalSeconds: 1, effect: 'heal', amountPct: 10, basis: 'targetMaxHp' },
    });
    statusSystem.apply('2', 'blessing', { at: 0 });

    ZCStatusResolutionSystem.tick(state, 1, context);
    assert.deepEqual(events, ['heal:20']);
    assert.equal(target.maxHp, 100);
    assert.ok(Math.abs(target.hp - 55) < 1e-9);
});

test('旧牵引按源单位 ID 顺序，在周期状态过期前移动敌方单位', () => {
    const target = unit(3, 'enemy', 100);
    const source = unit(1, 'player', 0);
    const { state, statusSystem, context } = setup([target, source]);
    statusSystem.register({ id: 'pull', name: 'pull' });
    statusSystem.apply('1', 'pull', {
        at: 0,
        runtimeBehavior: { kind: 'legacyTraction', range: 200, speed: 40 },
    });

    ZCStatusResolutionSystem.tick(state, .5, context);
    assert.equal(target.freeX, 80);
});

test('旧持续伤害在施加者已移除后仍使用冻结攻击力与来源阵营', () => {
    const target = unit(2, 'enemy', 40);
    const { state, statusSystem, context, events, damageOwners } = setup([target]);
    statusSystem.register({ id: 'legacyBurn', name: 'legacyBurn', durationSeconds: 1 });
    statusSystem.apply('2', 'legacyBurn', {
        at: 0,
        sourceUnitId: '99',
        runtimeBehavior: {
            kind: 'legacyDot', intervalSeconds: 1,
            flatDamagePerStack: 5, targetMaxHpPctPerStack: 10,
            capAttackMultiplier: 2, senderAttack: 3, sourceOwner: 'player',
            extraEveryTicks: 1, extraFlatDamage: 2,
        },
    });

    ZCStatusResolutionSystem.tick(state, 1, context);
    assert.deepEqual(events, ['damage:13']);
    assert.deepEqual(damageOwners, ['player']);
    assert.equal(target.hp, 87);
});
