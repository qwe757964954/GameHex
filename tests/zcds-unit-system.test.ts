import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';

function unit(id: number, battleState: ZCUnitState['battleState']): ZCUnitState {
    return {
        id, owner: 'player', unitId: '1', cardId: '1', tier: 1,
        sourceHexId: 1, targetHexId: null, progress: 0, hp: 10, maxHp: 10,
        battleState, stateTime: 0, targetUnitId: null, targetWallHexId: null,
        targetBuildingHexId: null, nextAttackAt: 0, waitUntil: 0,
        attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null, freeX: 0, freeY: 0,
    };
}

function context(units: ReadonlyMap<number, ZCUnitState>, options: {
    readonly now?: number;
    readonly controlled?: boolean;
    readonly inRange?: boolean;
    readonly target?: ZCCombatTarget | null;
    readonly onHit?: (attacker: ZCUnitState) => void;
} = {}): IZCUnitContext {
    const target = options.target ?? null;
    return {
        now: () => options.now ?? 1,
        effectiveDefinition: () => ({ attackHitTime: 0.2, attackDuration: 0.4, attackInterval: 1 } as ZCUnitDefinition),
        controlOf: () => options.controlled ? { kind: 'stun', defId: 'stun' } : null,
        random: () => 0.5,
        unitById: units,
        targeting: {
            acquire: (attacker) => { attacker.targetUnitId = target?.kind === 'unit' ? target.id : null; },
            current: (attacker) => attacker.targetUnitId === target?.id ? target : null,
            isInAttackRange: () => options.inRange ?? false,
            isOutOfAttackRange: () => !(options.inRange ?? false),
            findStepToward: () => null,
            face: (attacker) => { attacker.facingRadians = 1.5; },
        },
        movement: {
            advanceTowardUnit: (attacker) => { attacker.freeX = 5; },
            advanceUnitMovement: () => {},
            startMarch: () => {},
            advanceMarch: () => {},
        },
        sendAttack: (attacker) => {
            attacker.attackHitDone = true;
            options.onHit?.(attacker);
        },
    };
}

const enemyTarget: ZCCombatTarget = { kind: 'unit', id: 2, x: 10, y: 0, bodyRadius: 1, cardId: null };

test('控制状态冻结单位；出生完成后切目标态并清理行军状态', () => {
    const soldier = unit(1, 'born');
    soldier.stateTime = 0.15;
    soldier.marchAngle = 1;
    soldier.targetHexId = 3;
    soldier.progress = 0.5;
    const units = new Map([[soldier.id, soldier]]);

    ZCUnitSystem.update([soldier], 0.05, context(units, { controlled: true }));
    assert.equal(soldier.stateTime, 0.15);
    assert.equal(soldier.battleState, 'born');

    ZCUnitSystem.update([soldier], 0.05, context(units));
    assert.equal(soldier.battleState, 'target');
    assert.equal(soldier.stateTime, 0);
    assert.equal(soldier.marchAngle, null);
    assert.equal(soldier.targetHexId, null);
    assert.equal(soldier.progress, 0);
});

test('等待攻击遵守绝对时间，出手前重新确认目标与射程', () => {
    const soldier = unit(1, 'waitAttack');
    soldier.targetUnitId = 2;
    soldier.waitUntil = 1.225;
    const units = new Map([[soldier.id, soldier]]);

    ZCUnitSystem.update([soldier], 0.05, context(units, { now: 1.2, inRange: true, target: enemyTarget }));
    assert.equal(soldier.battleState, 'waitAttack');
    assert.equal(soldier.waitUntil, 1.225);

    ZCUnitSystem.update([soldier], 0.05, context(units, { now: 1.25, inRange: false, target: enemyTarget }));
    assert.equal(soldier.battleState, 'target');

    soldier.battleState = 'waitAttack';
    soldier.targetUnitId = 2;
    ZCUnitSystem.update([soldier], 0.05, context(units, { now: 1.25, inRange: true, target: enemyTarget }));
    assert.equal(soldier.battleState, 'attack');
    assert.equal(soldier.nextAttackAt, 2.25);
    assert.equal(soldier.facingRadians, 1.5);
    assert.equal(soldier.attackHitDone, false);
});

test('攻击命中帧只发送一次，同格追击使用目标的连续位置', () => {
    const soldier = unit(1, 'attack');
    soldier.stateTime = 0.15;
    const enemy = unit(2, 'idle');
    const units = new Map([[soldier.id, soldier], [enemy.id, enemy]]);
    let hits = 0;
    const attacking = context(units, { onHit: () => { hits++; } });

    ZCUnitSystem.update([soldier], 0.05, attacking);
    ZCUnitSystem.update([soldier], 0.05, attacking);
    assert.equal(hits, 1);
    assert.equal(soldier.attackHitDone, true);

    soldier.battleState = 'move';
    soldier.targetUnitId = 2;
    ZCUnitSystem.update([soldier], 0.05, context(units, { target: enemyTarget }));
    assert.equal(soldier.freeX, 5);
});

test('单位索敌保留射程滞回，目标死亡后立即失效', () => {
    const soldier = unit(1, 'idle');
    const enemy = unit(2, 'idle');
    enemy.owner = 'enemy';
    enemy.freeX = 35;
    const units = new Map([[soldier.id, soldier], [enemy.id, enemy]]);
    const map: ZCMatchMap = {
        id: 'range-test', rows: 0, columns: 0, playerHomeId: 0, enemyHomeId: 0,
        hexes: [], owners: [],
    };
    const definition = {
        attackRange: 30, bodyRadius: 10, canAttackAir: true, flying: false,
    } as ZCUnitDefinition;
    const unitPosition = (candidate: ZCUnitState): { x: number; y: number } => ({ x: candidate.freeX, y: candidate.freeY });
    const targeting = new ZCUnitTargeting({
        map, geometry: new ZCMapGeometry(map), units, combatDistanceScale: 1,
        targeting: {
            now: 1, units: [soldier, enemy], hexes: [],
            unitById: (id) => units.get(id) ?? null,
            unitPosition, hexPosition: () => ({ x: 0, y: 0 }),
            effectiveDefinition: () => definition,
            hasExposedWall: () => false,
        },
        baseDefinition: () => definition,
        effectiveDefinition: () => definition,
        unitPosition,
        hex: () => null,
        hasExposedWall: () => false,
    });

    targeting.acquire(soldier);
    assert.equal(soldier.targetUnitId, enemy.id);
    assert.equal(targeting.isInAttackRange(soldier), true);
    enemy.freeX = 48;
    assert.equal(targeting.isInAttackRange(soldier), false);
    assert.equal(targeting.isOutOfAttackRange(soldier), false);
    enemy.freeX = 53;
    assert.equal(targeting.isOutOfAttackRange(soldier), true);
    enemy.battleState = 'dead';
    assert.equal(targeting.current(soldier), null);
});
