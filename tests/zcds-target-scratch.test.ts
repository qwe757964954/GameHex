import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCUnitTargeting, type IZCUnitTargetingContext } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';

/**
 * P1-3：`current()` / `unitPosition()` 的 scratch 复用。
 *
 * 口径：同一个单位连续索敌时返回同一个对象（调用方只在当前拍读取），不同单位各自独立；
 * 传入 out 时写 out 并返回 out，避免 `ZCAttackResolutionSystem.prepareAttack` 这类跨调用持有点
 * 在下一拍被同单位的另一次索敌覆盖。目标失效仍返回 null，不能复用上一次的残留字段。
 */

function unit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id,
        owner,
        unitId: 'u',
        cardId: null,
        hp: 10,
        maxHp: 10,
        battleState: 'idle',
        freeX: x,
        freeY: 0,
        sourceHexId: 0,
        targetUnitId: null,
        targetWallHexId: null,
        targetBuildingHexId: null,
    } as unknown as ZCUnitState;
}

function harness() {
    const me = unit(1, ZCOwner.Player, 0);
    const foe = unit(2, ZCOwner.Enemy, 10);
    me.targetUnitId = foe.id;
    const units = new Map([[me.id, me], [foe.id, foe]]);
    const definition = { canAttackAir: true, bodyRadius: 6, attackRange: 40 } as ZCUnitDefinition;
    const positionCalls: Array<ZCUnitState['id']> = [];
    let lastOut: { x: number; y: number } | undefined;
    const context = {
        map: { hexes: [{ id: 0, x: 0, y: 0, neighbors: [] }] },
        units,
        targeting: {
            unitPosition: (target: ZCUnitState, out?: { x: number; y: number }) => {
                positionCalls.push(target.id);
                lastOut = out;
                if (out) { out.x = target.freeX; out.y = target.freeY; return out; }
                return { x: target.freeX, y: target.freeY };
            },
            effectiveDefinition: () => definition,
            hasExposedWall: () => false,
            units: [me, foe],
            hexes: [],
            now: 0,
            unitById: (id: number) => units.get(id) ?? null,
            hexPosition: () => ({ x: 0, y: 0 }),
        },
        combatDistanceScale: 1,
        baseDefinition: () => definition,
        geometry: { hexIdAt: () => null },
        effectiveDefinition: () => definition,
        unitPosition: (target: ZCUnitState, out?: { x: number; y: number }) => {
            positionCalls.push(target.id);
            lastOut = out;
            if (out) { out.x = target.freeX; out.y = target.freeY; return out; }
            return { x: target.freeX, y: target.freeY };
        },
        hex: () => null,
        hasExposedWall: () => false,
    } as unknown as IZCUnitTargetingContext;
    return {
        targeting: new ZCUnitTargeting(context),
        me,
        foe,
        getLastOut: () => lastOut,
    };
}

test('同一单位连续 current() 返回同一个 scratch 对象', () => {
    const h = harness();
    const first = h.targeting.current(h.me);
    const second = h.targeting.current(h.me);
    assert.equal(first, second, '同单位同目标应复用 scratch，不能每次返回新字面量');
    assert.deepEqual(first && { ...first }, {
        kind: 'unit', id: 2, x: 10, y: 0, bodyRadius: 6, cardId: null,
    });
});

test('不同单位各自的 current() scratch 不共享', () => {
    const h = harness();
    const other = unit(3, ZCOwner.Player, 20);
    other.targetUnitId = h.foe.id;
    const a = h.targeting.current(h.me);
    const b = h.targeting.current(other);
    assert.notEqual(a, b, '不同单位不能共用同一个目标对象');
});

test('传入 out 时写 out 并返回 out，字段与当前目标一致', () => {
    const h = harness();
    const out = { kind: 'wall', id: 0, x: 0, y: 0, bodyRadius: 0, cardId: null } as ZCCombatTarget;
    const result = h.targeting.current(h.me, out);
    assert.equal(result, out, '传入 out 必须复用调用方对象，避免跨调用别名');
    assert.deepEqual({ ...out }, {
        kind: 'unit', id: 2, x: 10, y: 0, bodyRadius: 6, cardId: null,
    });
});

test('目标失效时返回 null，不残留上一拍字段', () => {
    const h = harness();
    const first = h.targeting.current(h.me);
    assert.ok(first);
    h.foe.hp = 0;
    h.foe.battleState = 'dead';
    assert.equal(h.targeting.current(h.me), null);
});

test('current() 把 out 传给 unitPosition（坐标也不每拍分配）', () => {
    const h = harness();
    const out = { kind: 'unit', id: 0, x: 0, y: 0, bodyRadius: 0, cardId: null } as ZCCombatTarget;
    h.targeting.current(h.me, out);
    assert.ok(h.getLastOut(), 'unitPosition 必须收到复用坐标对象');
});
