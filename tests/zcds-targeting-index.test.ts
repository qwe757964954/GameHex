import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCHexState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { ZCTargetingSystem, type ZCTargetingContext } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { ZCUnitRegistry } from '../assets/script/app/zcds/model/systems/ZCUnitRegistry';

const DEFINITION = { canAttackAir: true, flying: false, bodyRadius: 8 } as ZCUnitDefinition;
const EMPTY_UNITS = new Set<ZCUnitState>();

function unit(id: number, owner: ZCOwner, x: number, y = 0): ZCUnitState {
    return {
        id, owner, unitId: 'u', cardId: null, tier: 1, sourceHexId: id,
        targetHexId: null, progress: 0, hp: 10, maxHp: 10, battleState: 'idle',
        stateTime: 0, targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    } as unknown as ZCUnitState;
}

function hex(id: number, owner: ZCOwner | 'neutral', x: number, y = 0, options: {
    readonly building?: ZCHexState['building'];
    readonly hp?: number;
    readonly wallHp?: number;
    readonly exposed?: boolean;
} = {}): ZCHexState {
    return {
        id, owner, building: options.building ?? 'none', hp: options.hp ?? 10,
        wallHp: options.wallHp ?? 0, x, y, exposed: options.exposed ?? false,
        neutralResourceId: null, neutralFeature: null,
    } as unknown as ZCHexState;
}

function buckets(units: readonly ZCUnitState[]): Map<ZCOwner, Set<ZCUnitState>> {
    const result = new Map<ZCOwner, Set<ZCUnitState>>();
    for (const candidate of units) {
        let bucket = result.get(candidate.owner);
        if (!bucket) { bucket = new Set(); result.set(candidate.owner, bucket); }
        bucket.add(candidate);
    }
    return result;
}

function context(options: {
    readonly units?: readonly ZCUnitState[];
    readonly unitsOf?: Map<ZCOwner, Set<ZCUnitState>>;
    readonly hexes?: readonly ZCHexState[];
    readonly candidateHexes?: Map<ZCOwner, ZCHexState[]>;
    readonly positions?: Map<number, { x: number; y: number }>;
    readonly preferUnitTargets?: (unit: ZCUnitState) => boolean;
} = {}): ZCTargetingContext {
    const units = options.units ?? [];
    const unitsOf = options.unitsOf ?? buckets(units);
    const hexes = options.hexes ?? [];
    const candidateHexes = options.candidateHexes ?? new Map();
    const positions = options.positions ?? new Map(units.map(candidate => [candidate.id, { x: candidate.freeX, y: candidate.freeY }]));
    const byId = new Map(units.map(candidate => [candidate.id, candidate]));
    return {
        now: 1,
        get units() {
            throw new Error('不应回退到全量 units 扫描');
        },
        unitsOf: owner => unitsOf.get(owner) ?? EMPTY_UNITS,
        get hexes() {
            throw new Error('不应回退到全量 hexes 扫描');
        },
        candidateHexes: owner => candidateHexes.get(owner) ?? [],
        unitById: id => byId.get(id) ?? null,
        unitPosition: (target, out) => {
            const position = positions.get(target.id) ?? { x: target.freeX, y: target.freeY };
            if (out) { out.x = position.x; out.y = position.y; return out; }
            return { x: position.x, y: position.y };
        },
        hexPosition: id => {
            const target = hexes.find(candidate => candidate.id === id);
            return target ? { x: target.x, y: target.y } : { x: 0, y: 0 };
        },
        baseDefinition: () => DEFINITION,
        effectiveDefinition: () => DEFINITION,
        hasExposedWall: target => target.exposed,
        preferUnitTargets: options.preferUnitTargets,
    } as unknown as ZCTargetingContext;
}

test('owner 分桶只遍历敌方 owner，保持最近目标与同距离 id 裁决', () => {
    const me = unit(1, ZCOwner.Player, 0);
    const sameOwner = unit(2, ZCOwner.Player, 1);
    const farther = unit(10, ZCOwner.Enemy, 10);
    const sameDistanceHigherId = unit(12, ZCOwner.Enemy, 8);
    const sameDistanceLowerId = unit(11, ZCOwner.Enemy, -8);
    const nearest = unit(20, ZCOwner.Enemy2, 3);
    const units = [me, sameOwner, farther, sameDistanceHigherId, sameDistanceLowerId, nearest];
    const result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 20 });
});

test('单位与地块共用候选池；同距离按 id 裁决而不是来源优先', () => {
    const me = unit(1, ZCOwner.Player, 0);
    const enemy = unit(7, ZCOwner.Enemy, 5);
    const structure = hex(6, ZCOwner.Enemy, 5, 0, { building: 'hq' });
    const result = ZCTargetingSystem.acquire(me, context({
        units: [me, enemy], unitsOf: buckets([me, enemy]),
        hexes: [structure], candidateHexes: new Map([[ZCOwner.Player, [structure]]]),
    }));
    assert.deepEqual(result, { kind: 'building', id: 6 });
});

test('移动、死亡、出生与阵营迁移实时改变最近目标，不保留过期结果', () => {
    const me = unit(1, ZCOwner.Player, 0);
    const first = unit(2, ZCOwner.Enemy, 5);
    const second = unit(3, ZCOwner.Enemy2, 10);
    const units = [me, first, second];
    const registry = new ZCUnitRegistry();
    for (const candidate of units) registry.register(candidate);

    let result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 2 });

    registry.move(second, 1);
    second.freeX = 1;
    result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 3 });

    registry.markDead(first);
    first.battleState = 'dead';
    result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 3 });

    const born = unit(4, ZCOwner.Enemy, 0.5);
    units.push(born);
    registry.register(born);
    result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 4 });

    registry.changeOwner(second, ZCOwner.Player);
    result = ZCTargetingSystem.acquire(me, context({ units, unitsOf: buckets(units) }), true);
    assert.deepEqual(result, { kind: 'unit', id: 4 });
});

test('空候选返回 null；只有敌方单位/地块、怪物和目标池互不串桶', () => {
    const me = unit(1, ZCOwner.Player, 0);
    const empty = context({ units: [me], unitsOf: buckets([me]) });
    assert.equal(ZCTargetingSystem.acquire(me, empty), null);

    const wall = hex(8, ZCOwner.Enemy, 12, 0, { exposed: true });
    const result = ZCTargetingSystem.acquire(me, context({
        units: [me], unitsOf: buckets([me]),
        hexes: [wall], candidateHexes: new Map([[ZCOwner.Player, [wall]]]),
    }));
    assert.deepEqual(result, { kind: 'wall', id: 8 });
});

test('out 参数复用同一结果对象，调用方只读取当拍内容', () => {
    const me = unit(1, ZCOwner.Player, 0);
    const enemy = unit(2, ZCOwner.Enemy, 5);
    const out = { kind: 'unit' as const, id: 0 };
    const result = ZCTargetingSystem.acquire(me, context({
        units: [me, enemy], unitsOf: buckets([me, enemy]),
    }), true, out);
    assert.equal(result, out);
    assert.equal(out.id, 2);
});

test('ZCUnitRegistry 的 owner 索引覆盖注册、移动、移除和阵营迁移', () => {
    const registry = new ZCUnitRegistry();
    const me = unit(1, ZCOwner.Player, 0);
    const enemy = unit(2, ZCOwner.Enemy, 0);
    registry.register(me);
    registry.register(enemy);

    assert.equal(registry.unitsOf(ZCOwner.Player).size, 1);
    assert.equal(registry.unitsOf(ZCOwner.Enemy).size, 1);
    assert.equal(registry.unitsOf(ZCOwner.Enemy2).size, 0);

    registry.move(enemy, 3);
    assert.equal(registry.unitsOf(ZCOwner.Enemy).size, 1);
    registry.remove(enemy);
    assert.equal(registry.unitsOf(ZCOwner.Enemy).size, 0);

    const migrant = unit(3, ZCOwner.Enemy, 0);
    registry.register(migrant);
    registry.changeOwner(migrant, ZCOwner.Player);
    assert.equal(registry.unitsOf(ZCOwner.Enemy).size, 0);
    assert.equal(registry.unitsOf(ZCOwner.Player).size, 2);
    assert.equal(registry.count(ZCOwner.Enemy), 0);
    assert.equal(registry.count(ZCOwner.Player), 2);
});
