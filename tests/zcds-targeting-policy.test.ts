import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../assets/script/core/hex/HexGridLayout';

function fixture() {
    const definition = { unitId: 'u', canAttackAir: true, flying: false, bodyRadius: 20, attackRange: 100,
        attackInterval: 1, attackHitTime: 0.1, attackDuration: 0.2, attackProfile: {} } as ZCUnitDefinition;
    const unit = (id: number, x: number): ZCUnitState => ({
        id, owner: id === 1 ? 'player' : 'enemy', unitId: 'u', cardId: 'u', tier: 1, sourceHexId: 0,
        freeX: x, freeY: 0, hp: 100, maxHp: 100, targetHexId: null, progress: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null, battleState: 'target',
        stateTime: 0, nextAttackAt: 0, waitUntil: 0, attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null,
    });
    const me = unit(1, 0), attacker = unit(2, 100), nearest = unit(3, 60);
    const units = [me, attacker, nearest];
    const byId = new Map(units.map(value => [value.id, value]));
    const map = { hexes: [{ id: 0, x: 0, y: 0, neighbors: [], playable: true }] } as unknown as ZCMatchMap;
    let now = 0;
    const position = (value: ZCUnitState, out = { x: 0, y: 0 }) => {
        out.x = value.freeX; out.y = value.freeY; return out;
    };
    const targetContext = {
        get now() { return now; }, units, hexes: [], unitById: (id: number) => byId.get(id) ?? null,
        effectiveDefinition: () => definition, baseDefinition: () => definition, unitPosition: position,
        hexPosition: () => ({ x: 0, y: 0 }), hasExposedWall: () => false,
    };
    const targeting = new ZCUnitTargeting({
        map, geometry: new ZCMapGeometry(map), units: byId, targeting: targetContext, combatDistanceScale: 1,
        effectiveDefinition: () => definition, baseDefinition: () => definition, unitPosition: position,
        hex: () => null, hasExposedWall: () => false,
    });
    const context: IZCUnitContext = {
        now: () => now, effectiveDefinition: () => definition, random: () => 0, controlOf: () => null,
        unitById: byId, targeting, sendAttack: value => { value.attackHitDone = true; },
        movement: { advanceTowardUnit: () => {}, advanceUnitMovement: () => {},
            startMarch: value => { value.marchAngle = 0; }, advanceMarch: value => { value.freeX += 1; } },
    };
    return { me, attacker, nearest, targeting, targetContext, context, definition, setNow: (value: number) => { now = value; } };
}

test('仇恨评分在有效期内×0.25，过期回到最近，同分先保持当前目标再按 id', () => {
    const f = fixture();
    f.me.hatredUnitId = f.attacker.id; f.me.hatredUntil = 5;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.attacker.id);
    f.setNow(5.01);
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.nearest.id);
    f.attacker.freeX = 60; f.me.targetUnitId = f.nearest.id;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.nearest.id);
    f.me.targetUnitId = null;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.attacker.id);
});

test('射程 A 连续跨过 100，统一补一半目标半径并只缩放一次', () => {
    const f = fixture();
    for (const range of [60, 100, 101, 120, 500]) {
        f.definition.attackRange = range;
        assert.equal(ZCTargetingSystem.attackReach(f.definition, 20, 0.3), (range + 10) * 0.3);
    }
});

test('卡牌价值与距离、仇恨相乘，索引和普通扫描一致，技能仍取最近', () => {
    const f = fixture();
    f.attacker.unitId = 'valuable';
    f.nearest.unitId = 'tank';
    f.attacker.freeX = 80;
    const baseDefinition = (id: string) => ({ ...f.definition, valueFactor: id === 'valuable' ? 0.65 : 1.25 });
    const context = { ...f.targetContext, baseDefinition };
    const indexed = { ...context, unitsOf: owner => context.units.filter(unit => unit.owner === owner) };
    for (const candidate of [context, indexed]) {
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.attacker.id, '80px 高价值优于60px坦克');
        f.attacker.freeX = 90;
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.nearest.id, '价值不能压过足够大的距离差');
        f.me.hatredUnitId = f.attacker.id;
        f.me.hatredUntil = 5;
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.attacker.id, '仇恨与价值同时生效');
        f.attacker.freeX = 80;
        f.me.hatredUnitId = null;
    }
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, context.units, 200, context)?.id, f.nearest.id);
});

test('仇恨快捷候选也乘价值系数，等评分保持当前再按 id', () => {
    const f = fixture();
    f.attacker.unitId = 'low';
    const context = { ...f.targetContext,
        baseDefinition: (id: string) => ({ ...f.definition, valueFactor: id === 'low' ? 4 : 1 }) };
    f.me.hatredUnitId = f.attacker.id; f.me.hatredUntil = 5;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.nearest.id);
    f.me.hatredUnitId = null;
    f.attacker.freeX = 30;
    f.me.targetUnitId = f.nearest.id;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.nearest.id);
    f.me.targetUnitId = null;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.attacker.id);
});

test('等待出手和追击时保持合法目标，不因更近单位出现而换人', () => {
    const f = fixture();
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'waitAttack';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.battleState, 'attack');
    f.me.battleState = 'move'; f.attacker.freeX = 200;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, f.attacker.id);
});

test('追击满 5 秒即脱战，原目标回射程前不再锁，回射程恢复', () => {
    const f = fixture();
    f.nearest.hp = 0; f.attacker.freeX = 200;
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.setNow(5);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.battleState, 'moveForward');
    assert.equal(f.me.targetUnitId, null);
    f.targeting.acquire(f.me);
    assert.equal(f.me.targetUnitId, null);
    f.attacker.freeX = f.me.freeX + 100;
    f.targeting.acquire(f.me);
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.disengagedUnitIds, undefined);
});

test('追击离开起点 3 格即脱战；射程内战斗清掉追击计时', () => {
    const f = fixture();
    f.nearest.hp = 0; f.attacker.freeX = 500;
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.me.freeX = 3 * HEX_GRID_LOGICAL_ROW_STEP;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, null);
    f.attacker.freeX = f.me.freeX + 50;
    f.targeting.acquire(f.me); f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.chase, undefined);
});

test('技能独立选敌：Range 限半径，All 全场；不改普攻锁定，同距按 id，过滤无效目标', () => {
    const f = fixture();
    f.me.targetWallHexId = 9;
    const units = [f.me, f.nearest, f.attacker];
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 50, f.targetContext), null);
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 50, f.targetContext, 2)?.id, f.nearest.id);
    f.attacker.freeX = f.nearest.freeX;
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 100, f.targetContext)?.id, f.attacker.id);
    f.attacker.battleState = 'dead'; f.nearest.hp = 0;
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 100, f.targetContext, 2), null);
    assert.equal(f.me.targetWallHexId, 9);
});

test('追击后在 idle 近身交战会清除旧追击，新追击重新计时', () => {
    const f = fixture();
    f.me.targetUnitId = f.attacker.id;
    f.me.battleState = 'idle';
    f.me.nextAttackAt = 100;
    f.me.chase = { x: 0, y: 0, startedAt: 0 };
    f.setNow(10);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.chase, undefined);
    f.attacker.freeX = 200;
    f.setNow(11);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.setNow(11.05);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.battleState, 'move');
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.chase?.startedAt, 11.05);
});
