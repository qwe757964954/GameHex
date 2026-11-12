import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import type { ZCGroundZoneState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';

test('持续区域按绝对时刻结算多波，并在到期后只结算一次额外伤害', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 2, skillName: '暴风雪', remainingSeconds: .2,
        wavesLeft: 2, nextWaveAt: 1, waveInterval: .1,
        damage: 7, slowRatio: 0, expireDamage: 3,
    };
    const target = { id: 2, owner: 'enemy', hp: 30, battleState: 'attack' } as ZCUnitState;
    const state = { elapsedSeconds: 1.1, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [target],
        unitPosition: () => ({ x: 0, y: 0 }),
        damageUnit: (unit: ZCUnitState, damage: number) => { unit.hp -= damage; return null; },
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
    };
    ZCGroundZoneSystem.tick(state, .2, context);
    assert.equal(target.hp, 13);
    assert.equal(state.combatEvents.length, 2);
    assert.equal(state.groundZones.length, 0);
    ZCGroundZoneSystem.tick(state, .2, context);
    assert.equal(target.hp, 13);
});

/**
 * 跟随本体（2026-11-09 大威天芦「无尘禁土」102503）。
 *
 * 设计案：「本体携带的范围持续伤害，跟随本体移动」。落地方式是给区域一个
 * `followUnitId`，由区域系统每帧把圆心拍回施法者 —— 不新增第二份「光环跟谁走」的状态。
 *
 * 三种退化都必须「把剩下的波次在原地打完」：没配 `followUnitId`（全部既有区域）、
 * 上下文没给 `unitById`（只跑结算的轻量上下文）、施法者已阵亡（人没了不该继续输出）。
 */
test('跟随本体：光环每帧把圆心拍回施法者，人走了光环跟着走', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 102503, skillName: '无尘禁土', remainingSeconds: 5,
        wavesLeft: 5, nextWaveAt: 999, waveInterval: 1,
        damage: 0, slowRatio: 0, followUnitId: 1,
    };
    const caster = { id: 1, owner: 'player', hp: 100, battleState: 'march', freeX: 30, freeY: 0 } as ZCUnitState;
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        unitById: (id: number) => (id === 1 ? caster : undefined),
        hexStep: 1,
    };

    ZCGroundZoneSystem.tick(state, .05, context);
    assert.equal(zone.x, 30, '圆心跟着本体走到 30');

    caster.freeX = 120;
    ZCGroundZoneSystem.tick(state, .05, context);
    assert.equal(zone.x, 120, '本体再走，光环继续跟');

    //  施法者阵亡 ⇒ 停在最后位置把剩下的波次打完（不提前掐掉已经放出来的那片）。
    caster.battleState = 'dead';
    caster.hp = 0;
    caster.freeX = 400;
    ZCGroundZoneSystem.tick(state, .05, context);
    assert.equal(zone.x, 120, '人没了就不再跟');
});

test('跟随本体：没有 followUnitId 的区域原地不动（全部既有区域行为不变）', () => {
    const zone: ZCGroundZoneState = {
        x: 5, y: 5, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 2, skillName: '灼热地带', remainingSeconds: 5,
        wavesLeft: 5, nextWaveAt: 999, waveInterval: 1,
        damage: 0, slowRatio: 0,
    };
    const caster = { id: 1, owner: 'player', hp: 100, battleState: 'march', freeX: 90, freeY: 0 } as ZCUnitState;
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    ZCGroundZoneSystem.tick(state, .05, {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        unitById: () => caster,
        hexStep: 1,
    });
    assert.deepEqual([zone.x, zone.y], [5, 5]);
});

test('跟随本体：光环每秒只打半径内的敌人，半径外与友军都不吃伤害', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 102503, skillName: '无尘禁土', remainingSeconds: 4,
        wavesLeft: 4, nextWaveAt: 0, waveInterval: 1,
        damage: 7, slowRatio: 0, followUnitId: 1,
    };
    const inside = { id: 2, owner: 'enemy', hp: 100, battleState: 'attack', freeX: 4, freeY: 0 } as ZCUnitState;
    const outside = { id: 3, owner: 'enemy', hp: 100, battleState: 'attack', freeX: 40, freeY: 0 } as ZCUnitState;
    const ally = { id: 4, owner: 'player', hp: 100, battleState: 'attack', freeX: 2, freeY: 0 } as ZCUnitState;
    const caster = { id: 1, owner: 'player', hp: 100, battleState: 'attack', freeX: 0, freeY: 0 } as ZCUnitState;
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [inside, outside, ally],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (unit: ZCUnitState, damage: number) => { unit.hp -= damage; return null; },
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        unitById: (id: number) => (id === 1 ? caster : undefined),
        hexStep: 1,
    };

    ZCGroundZoneSystem.tick(state, 0, context);
    assert.equal(inside.hp, 93, '半径内敌人吃一跳');
    assert.equal(outside.hp, 100, '半径外不吃');
    assert.equal(ally.hp, 100, '友军不吃');
    assert.equal(zone.wavesLeft, 3);

    //  每秒补一跳；4 波打完 `wavesLeft` 归零（区域本身按 `remainingSeconds` 到期）。
    for (const at of [1, 2, 3]) {
        state.elapsedSeconds = at;
        ZCGroundZoneSystem.tick(state, 0, context);
    }
    assert.equal(inside.hp, 72, '4 秒共 4 跳 × 7');
    assert.equal(zone.wavesLeft, 0);
});

/**
 * 跟随本体 + 身前固定距离（2026-11-12 磁电菇「磁电冲击」101604）。
 *
 * 用户口径：「磁电冲击技能应该跟随角色一起移动，固定在角色身前」。
 *
 * `followUnitId` 单独用是「圆心拍在本体身上」（无尘禁土那类自体光环）；多给一个
 * `followForward` 就改成「落点 = 本体 + 朝向前移 N」。两件事必须同源：落点沿朝向偏、
 * 矩形的 `angleDegrees` 却还朝旧角度的话，判定中心与画面上的光束会立刻错开。
 */
test('跟随本体 + 身前距离：落点永远在角色朝向前方 N 处，朝向同步刷新', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 48, owner: 'player', sourceUnitId: 1,
        skillId: 30231, skillName: '磁电菇普攻', remainingSeconds: 3,
        wavesLeft: 3, nextWaveAt: 999, waveInterval: 1,
        damage: 0, slowRatio: 0,
        effectPrefabPath: 'units/projectiles/雷电冲击/雷电冲击', holdVisual: true,
        //  `auraRadius=160 × combatDistanceScale 0.3 = 48`，`auraForward` 同值。
        followUnitId: 1, followForward: 48,
        rectHalfLength: 48, rectHalfHeight: 16.2,
    };
    const caster = {
        id: 1, owner: 'player', hp: 100, battleState: 'attack',
        freeX: 30, freeY: 0, facingRadians: 0,
    } as ZCUnitState;
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    const context = {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        unitById: (id: number) => (id === 1 ? caster : undefined),
        hexStep: 1,
    };

    //  朝右（0°）⇒ 落点 = 本体 + (48, 0)，矩形也朝右。
    ZCGroundZoneSystem.tick(state, .05, context);
    assert.deepEqual([zone.x, zone.y], [78, 0], '落点必须在本体右侧 48，不是贴在本体 30');
    assert.equal(zone.angleDegrees, 0);

    //  本体走位 + 转身朝上（-90°）⇒ 落点跟着转到正上方，朝向一起转。
    caster.freeX = 120;
    caster.freeY = 60;
    caster.facingRadians = -Math.PI / 2;
    ZCGroundZoneSystem.tick(state, .05, context);
    assert.ok(Math.abs(zone.x - 120) < 1e-9, `朝上时 x 不该偏，实际 ${zone.x}`);
    assert.ok(Math.abs(zone.y - 12) < 1e-9, `朝上时落点在上方 48（60 − 48 = 12），实际 ${zone.y}`);
    assert.ok(Math.abs((zone.angleDegrees ?? 0) + 90) < 1e-9, '矩形朝向必须同步到 −90°');

    //  表现事件与判定同拍同点同角度（跟随是靠 `syncHoldVisual` 每帧搬坐标实现的）。
    const event = state.combatEvents[0];
    assert.ok(event, '整段持有视觉已经建出来');
    assert.deepEqual([event.fromX, event.fromY], [zone.x, zone.y]);
    assert.equal(event.angleDegrees, zone.angleDegrees);
});

test('跟随本体：followForward 缺省 0 ⇒ 圆心仍拍在本体身上（无尘禁土行为不变）', () => {
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 10, owner: 'player', sourceUnitId: 1,
        skillId: 102503, skillName: '无尘禁土', remainingSeconds: 5,
        wavesLeft: 5, nextWaveAt: 999, waveInterval: 1,
        damage: 0, slowRatio: 0, followUnitId: 1,
    };
    const caster = {
        id: 1, owner: 'player', hp: 100, battleState: 'march',
        freeX: 30, freeY: 40, facingRadians: -Math.PI / 2,
    } as ZCUnitState;
    const state = { elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1 };
    ZCGroundZoneSystem.tick(state, .05, {
        hexIdAt: () => 0,
        unitsInRadius: () => [],
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        ensureSlowStatus: () => {},
        applyStatus: () => {},
        exportStatusEffects: () => undefined,
        unitById: () => caster,
        hexStep: 1,
    });
    assert.deepEqual([zone.x, zone.y], [30, 40], '没有 followForward 就贴本体');
    assert.equal(zone.angleDegrees, undefined, '也不许顺手改朝向');
});
