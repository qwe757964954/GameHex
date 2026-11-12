import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import type { ZCPeriodicEvent } from '../assets/script/app/zcds/model/ZCStatusEffect';
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
    return { state, statusSystem, context, events, damageOwners, resolution: new ZCStatusResolutionSystem() };
}

test('状态到期当拍仍结算最后一次周期伤害，随后移除状态并导出快照', () => {
    const source = unit(1, 'player', 0);
    const target = unit(2, 'enemy', 40);
    const { state, statusSystem, context, events, resolution } = setup([source, target]);
    statusSystem.register({
        id: 'burn', name: 'burn', durationSeconds: 1,
        behavior: { kind: 'periodic', intervalSeconds: 1, effect: 'damage', amountPct: 10, basis: 'targetMaxHp' },
    });
    statusSystem.apply('2', 'burn', { at: 0, sourceUnitId: '1' });

    resolution.tick(state, 1, context);
    assert.deepEqual(events, ['damage:10']);
    assert.equal(target.hp, 90);
    assert.equal(statusSystem.instancesOf('2').length, 0);
    assert.deepEqual(state.statusEffects, statusSystem.exportSnapshot());

    state.elapsedSeconds = 2;
    resolution.tick(state, 1, context);
    assert.deepEqual(events, ['damage:10']);
});

test('周期治疗只呈现实际回复量，状态过期后按生命比例恢复上限', () => {
    const target = unit(2, 'player', 0, 90);
    target.maxHp = 200;
    const { state, statusSystem, context, events, resolution } = setup([target]);
    statusSystem.register({
        id: 'blessing', name: 'blessing', durationSeconds: 1, statMods: { maxHpPct: 100 },
        behavior: { kind: 'periodic', intervalSeconds: 1, effect: 'heal', amountPct: 10, basis: 'targetMaxHp' },
    });
    statusSystem.apply('2', 'blessing', { at: 0 });

    resolution.tick(state, 1, context);
    assert.deepEqual(events, ['heal:20']);
    assert.equal(target.maxHp, 100);
    assert.ok(Math.abs(target.hp - 55) < 1e-9);
});

test('旧牵引按源单位 ID 顺序，在周期状态过期前移动敌方单位', () => {
    const target = unit(3, 'enemy', 100);
    const source = unit(1, 'player', 0);
    const { state, statusSystem, context, resolution } = setup([target, source]);
    statusSystem.register({ id: 'pull', name: 'pull' });
    statusSystem.apply('1', 'pull', {
        at: 0,
        runtimeBehavior: { kind: 'legacyTraction', range: 200, speed: 40 },
    });

    resolution.tick(state, .5, context);
    assert.equal(target.freeX, 80);
});

test('旧持续伤害在施加者已移除后仍使用冻结攻击力与来源阵营', () => {
    const target = unit(2, 'enemy', 40);
    const { state, statusSystem, context, events, damageOwners, resolution } = setup([target]);
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

    resolution.tick(state, 1, context);
    assert.deepEqual(events, ['damage:13']);
    assert.deepEqual(damageOwners, ['player']);
    assert.equal(target.hp, 87);
});

test('结算 scratch 跨步复用、不同对局隔离，异常后不持有单位或污染下一步', () => {
    const first = setup([unit(1, 'player', 0)]);
    const second = setup([unit(2, 'enemy', 40)]);
    first.statusSystem.register({ id: 'buff', name: 'buff', durationSeconds: 2 });
    first.statusSystem.apply('1', 'buff', { at: 0 });
    const effectiveDefinition = first.context.effectiveDefinition;
    const scratch = Object.values(first.resolution);
    assert.ok(scratch.length > 0);
    assert.ok(scratch.every((value) => !Object.values(second.resolution).includes(value)));
    first.context.effectiveDefinition = () => { throw new Error('probe'); };
    assert.throws(() => first.resolution.tick(first.state, .5, first.context), /probe/);
    const assertReleased = () => {
        Object.values(first.resolution).forEach((value, index) => assert.equal(value, scratch[index]));
        for (const value of scratch) {
            if (value instanceof Map) assert.equal(value.size, 0);
            else if (Array.isArray(value)) assert.equal(value.length, 0);
        }
    };
    assertReleased();
    first.context.effectiveDefinition = effectiveDefinition;
    first.resolution.tick(first.state, .5, first.context);
    second.resolution.tick(second.state, .5, second.context);
    first.state.units[0].battleState = 'dead';
    first.resolution.tick(first.state, .5, first.context);
    assert.equal(first.statusSystem.hasAny('1'), false);
    assertReleased();
});

test('状态查询可复用输出缓冲，默认返回仍独立；空状态实例只读共享', () => {
    const system = new ZCStatusSystem();
    assert.equal(system.instancesOf('1'), system.instancesOf('2'));
    assert.equal(Object.isFrozen(system.instancesOf('1')), true);
    system.register({ id: 'burn', name: 'burn', durationSeconds: 2,
        behavior: { kind: 'periodic', intervalSeconds: 1, effect: 'damage', amountPct: 10, basis: 'targetMaxHp' } });
    system.apply('1', 'burn', { at: 0 });
    const ids = ['stale'];
    assert.equal(system.unitIdsWithStatuses(ids), ids);
    assert.deepEqual(ids, ['1']);
    const snapshotIds = system.unitIdsWithStatuses();
    const events: ZCPeriodicEvent[] = [];
    assert.equal(system.collectPeriodicEvents(1, events), events);
    assert.equal(events.length, 1);
    const saved = system.collectPeriodicEvents(2);
    system.collectPeriodicEvents(2, events);
    assert.equal(events.length, 0, '复用缓冲不残留上一步事件');
    assert.equal(saved.length, 1, '不传缓冲时保持独立结果');
    system.removeAll('1');
    system.unitIdsWithStatuses(ids);
    assert.deepEqual(ids, []);
    assert.deepEqual(snapshotIds, ['1']);
});

test('没有状态时不遍历全军位置或创建牵引工作', () => {
    const { state, context, resolution } = setup([unit(1, 'player', 0)]);
    context.unitPosition = () => { throw new Error('无状态时不应查询位置'); };
    resolution.tick(state, .05, context);
    assert.deepEqual(state.statusEffects.units, []);
});


// 报告 20261111-2 未覆盖风险 3：逐帧 tick 的「行为级等价」补测。
// 双指针原地压缩替换链式构造后，真正的风险不是分配，而是「删中间项时漏推进后续实例」
// 或「跨实例复用容器串味」。以下只测可观察行为，不复制算法。
test('ZCStatusSystem.tick 双指针：到期实例夹在中间时，后续实例仍被完整推进且不重不漏', () => {
    const system = new ZCStatusSystem();
    for (const [id, durationSeconds] of [['expire-a', .1], ['survive', 10], ['expire-b', .1]] as const) {
        system.register({ id, name: id, durationSeconds });
        system.apply('1', id, { at: 0 });
    }
    assert.deepEqual(system.instancesOf('1').map((inst) => inst.defId),
        ['expire-a', 'survive', 'expire-b']);
    system.tick(['1'], .2);
    const left = system.instancesOf('1');
    assert.deepEqual(left.map((inst) => inst.defId), ['survive'],
        '两个到期项应被原地压缩掉，其后的实例不能漏掉');
    assert.ok(Math.abs((left[0].remainingSeconds ?? 0) - 9.8) < 1e-6,
        '存活实例每拍只衰减一次 dt，不能被重复推进');
    system.tick(['1'], 20);
    assert.equal(system.instancesOf('1').length, 0);
    assert.equal(system.hasAny('1'), false);
    system.tick(['1'], 1);
    assert.equal(system.instancesOf('1').length, 0, '清空后再 tick 不应复活');
});

test('ZCStatusSystem 跨实例隔离：一实例 tick 不影响另一实例，也不为未知单位建条目', () => {
    const a = new ZCStatusSystem();
    const b = new ZCStatusSystem();
    for (const system of [a, b]) system.register({ id: 'buff', name: 'buff', durationSeconds: 5 });
    a.apply('1', 'buff', { at: 0 });
    b.apply('2', 'buff', { at: 0 });
    a.tick(['1', '2', '999'], 6);
    assert.equal(a.instancesOf('1').length, 0, 'a 的状态应到期');
    assert.equal(b.instancesOf('2').length, 1, 'b 的状态不能被 a 的 tick 推进');
    assert.deepEqual(a.unitIdsWithStatuses(), []);
    assert.deepEqual(b.unitIdsWithStatuses(), ['2']);
    assert.equal(a.hasAny('999'), false, '未知单位不应被建出状态条目');
});
