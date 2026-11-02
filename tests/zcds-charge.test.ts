import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCMovementSystem, type ZCMovementContext } from '../assets/script/app/zcds/model/systems/ZCMovementSystem';
import type { IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { ZCUnitTargeting, type IZCUnitTargetingContext } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';

/**
 * 运动霸（68033）「203301 拳击冲撞」：冲刺 + 气浪（2026-10-31）。
 *
 * 设计案第 162 行原文：
 *   「挥拳冲撞当前目标，近战判定，命中结算 1 次伤害，距离敌人 120px 时开始冲刺，
 *     冲刺阶段的移动速度 *4」
 *   「【P1 沿用】消灭学霸_普攻(15帧) 拳套冲击；命中 受击(坦克) + 气浪，开始冲刺时播放循环的攻击动作」
 *
 * 落地拆成三件事，本文件逐个钉住：
 *   ① `pvpSkill.chargeDistance / chargeSpeedScale` → 距敌 120px 起把移速乘 4；
 *   ② 同一组参数派生出 `unit.charging`，表现层据此把移动动作换成循环的攻击动作；
 *   ③ `pvpSkill.impactEffectPrefabPath` → 命中时额外推一条「气浪」表现事件，不参与伤害。
 *
 * 「受击(坦克)」没法在这里钉：受击特效按**攻击方职业**播（`ZCGameLoader.HIT_FX_DIRECTORY`），
 * 而 68033 的职业是战士 —— 实际播的是「战士受击」，与设计案写的「坦克受击」不一致，
 * 已在设计案落地口径里注明，是否要为此加 per-skill 特例等策划拍板。
 */

const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const IMPACT_FX = 'units/projectiles/重骑兵_践踏/重骑兵_践踏';

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68033', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'move', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

function boxerProfile(overrides: Partial<ZCAttackProfile> = {}): ZCAttackProfile {
    return {
        skillId: 30713, name: '运动霸普攻', mode: ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, durationSeconds: 0, waves: 1,
        effectPrefabPath: 'units/projectiles/消灭学霸_普攻/消灭学霸_普攻',
        legacyEffectKeys: [],
        ...overrides,
    };
}

function boxerDefinition(profile: ZCAttackProfile): ZCUnitDefinition {
    return {
        unitId: '68033', name: '运动霸', maxHp: 1000, attack: 120,
        moveSpeed: 25, attackRange: 45, attackInterval: 1.8, attackDuration: 0.667,
        attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1,
        attackProfile: profile,
    } as ZCUnitDefinition;
}

// ------------------------------------------------------------------ ① 冲刺距离

test('冲刺触发距离：与 attackRange 同一套 px，乘 combatDistanceScale、补目标碰撞半径', () => {
    // 120px（设定口径）× 0.3 = 36 世界单位；补上 6 的碰撞半径 → 37.8。
    assert.equal(ZCTargetingSystem.chargeReach(120, 6, 0.3), 37.8);
    // 表里 bodyRadius 常常还是 0（策划没补），此时就是裸距离。
    assert.equal(ZCTargetingSystem.chargeReach(120, 0, 0.3), 36);
});

test('冲刺距离不走「射程 > 100 打 9 折」那条分支', () => {
    // `attackReach` 对 120 这样的远射程会 ×0.9；冲刺若也打折就是 32.4，
    // 冲锋会莫名其妙提前 10% 触发。这里直接把两条口径的差钉住。
    const attack = ZCTargetingSystem.attackReach(
        { attackRange: 120 } as ZCUnitDefinition, 0, 0.3,
    );
    assert.equal(attack, 120 * 0.9 * 0.3);
    assert.equal(ZCTargetingSystem.chargeReach(120, 0, 0.3), 36);
});

// ------------------------------------------------------------------ ② 移速倍率

interface IChargeHarnessOptions {
    profile: ZCAttackProfile;
    /** 双方在 x 轴上的间距（世界单位）。 */
    gap?: number;
    /** 目标是否同阵营（同阵营 ⇒ `current()` 返回 null，不该冲刺）。 */
    sameOwner?: boolean;
    /** 目标是否已经死了。 */
    targetDead?: boolean;
}

function makeTargetingHarness(options: IChargeHarnessOptions) {
    const definition = boxerDefinition(options.profile);
    const me = makeUnit(1, ZCOwner.Player, 0);
    const foe = makeUnit(2, options.sameOwner ? ZCOwner.Player : ZCOwner.Enemy, options.gap ?? 30);
    if (options.targetDead) {
        foe.hp = 0;
        foe.battleState = 'dead';
    }
    me.targetUnitId = foe.id;
    const units = new Map([[me.id, me], [foe.id, foe]]);

    const targeting = new ZCUnitTargeting({
        map: { hexes: [{ id: 0, x: 0, y: 0, neighbors: [] }] },
        units,
        targeting: {
            unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
            effectiveDefinition: () => definition,
            hasExposedWall: () => false,
            units: [me, foe],
            hexes: [],
            now: 0,
            unitById: (id: number) => units.get(id) ?? null,
            hexPosition: () => ({ x: 0, y: 0 }),
        },
        combatDistanceScale: 0.3,
        baseDefinition: () => definition,
        geometry: { hexIdAt: () => null },
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        hex: () => null,
        hasExposedWall: () => false,
    } as unknown as IZCUnitTargetingContext);

    return { targeting, me, foe };
}

test('距敌 120px 内移速 ×4，之外按原速', () => {
    const profile = boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 });
    // reach = (120 + 6) × 0.3 = 37.8
    const near = makeTargetingHarness({ profile, gap: 30 });
    assert.equal(near.targeting.chargeSpeedScale(near.me), 4);
    const far = makeTargetingHarness({ profile, gap: 40 });
    assert.equal(far.targeting.chargeSpeedScale(far.me), 1);
    // 边界：正好 37.8 也算进入（<= 判定）。
    const edge = makeTargetingHarness({ profile, gap: 37.8 });
    assert.equal(edge.targeting.chargeSpeedScale(edge.me), 4);
});

test('没配冲刺 / 倍率不大于 1 / 没目标 / 目标已死或同阵营 ⇒ 一律 1', () => {
    const noCharge = boxerProfile({ chargeSpeedScale: 4 });
    const a = makeTargetingHarness({ profile: noCharge, gap: 10 });
    assert.equal(a.targeting.chargeSpeedScale(a.me), 1, '没配 chargeDistance 不冲');

    const noScale = boxerProfile({ chargeDistance: 120 });
    const b = makeTargetingHarness({ profile: noScale, gap: 10 });
    assert.equal(b.targeting.chargeSpeedScale(b.me), 1, '没配 chargeSpeedScale 不冲');

    const oneScale = boxerProfile({ chargeDistance: 120, chargeSpeedScale: 1 });
    const c = makeTargetingHarness({ profile: oneScale, gap: 10 });
    assert.equal(c.targeting.chargeSpeedScale(c.me), 1, '倍率 1 等于不加速，不该把 charging 点亮');

    const dead = makeTargetingHarness({ profile: boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 }), gap: 10, targetDead: true });
    assert.equal(dead.targeting.chargeSpeedScale(dead.me), 1, '目标已死 ⇒ current() 为空');

    const ally = makeTargetingHarness({ profile: boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 }), gap: 10, sameOwner: true });
    assert.equal(ally.targeting.chargeSpeedScale(ally.me), 1, '同阵营不是目标');
});

// ------------------------------------------------------------------ ③ 推进真的变快

function makeMovementContext(definition: ZCUnitDefinition, moveTo: number[] = []): ZCMovementContext {
    return {
        map: { hexes: [{ id: 0, x: 0, y: 0, neighbors: [1] }, { id: 1, x: 100, y: 0, neighbors: [0] }] },
        geometry: { hexIdAt: () => null },
        effectiveDefinition: () => definition,
        bonuses: () => ({ moveSpeedMultiplier: 1 } as ZCDeckBonuses),
        hex: () => null,
        hasExposedWall: () => false,
        rules: { artifactEnemySpeedMultiplier: 1 },
        goalHomeId: () => 0,
        frozenSeconds: () => 0,
        moveUnitToHex: (unit, id) => { moveTo.push(id); },
    } as unknown as ZCMovementContext;
}

test('冲刺倍率直接乘进推进步长：同一 dt 下位移是 4 倍', () => {
    const definition = boxerDefinition(boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 }));
    const dt = 0.1;             // 移速 25 ⇒ 普通 2.5 / 冲刺 10
    const plain = makeUnit(1, ZCOwner.Player, 0);
    plain.battleState = 'idle';
    const foe = makeUnit(2, ZCOwner.Enemy, 40);
    const normal = new ZCMovementSystem(makeMovementContext(definition));
    normal.advanceTowardUnit(plain, foe, dt);
    assert.equal(Number(plain.freeX.toFixed(4)), 2.5);

    const fast = makeUnit(3, ZCOwner.Player, 0);
    fast.battleState = 'idle';
    const charge = new ZCMovementSystem(makeMovementContext(definition));
    charge.advanceTowardUnit(fast, foe, dt, 4);
    assert.equal(Number(fast.freeX.toFixed(4)), 10);

    // 不传倍率 ⇒ 与旧签名逐字一致（存量 34 张卡的调用点不必改）。
    const legacy = makeUnit(4, ZCOwner.Player, 0);
    legacy.battleState = 'idle';
    new ZCMovementSystem(makeMovementContext(definition)).advanceTowardUnit(legacy, foe, dt);
    assert.equal(Number(legacy.freeX.toFixed(4)), 2.5);
});

test('冲刺不会冲过头：单步仍被「剩余距离」截断', () => {
    const definition = boxerDefinition(boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 }));
    const me = makeUnit(1, ZCOwner.Player, 0);
    const foe = makeUnit(2, ZCOwner.Enemy, 3);      // 只剩 3，冲刺一步能走 10
    new ZCMovementSystem(makeMovementContext(definition)).advanceTowardUnit(me, foe, 0.1, 4);
    assert.equal(me.freeX, 3, '贴身那一步必须停在目标身上，不能穿过去');
});

test('跨格推进（advanceUnitMovement）同样吃冲刺倍率', () => {
    const definition = boxerDefinition(boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 }));
    const make = () => {
        const unit = makeUnit(1, ZCOwner.Player, 0);
        unit.targetHexId = 1;       // 目标格在 x=100
        return unit;
    };
    // 移速 25 ⇒ dt=0.1 时普通走 2.5、冲刺走 10。
    const plain = make();
    new ZCMovementSystem(makeMovementContext(definition)).advanceUnitMovement(plain, 0.1);
    assert.equal(Number(plain.freeX.toFixed(4)), 2.5);
    const fast = make();
    new ZCMovementSystem(makeMovementContext(definition)).advanceUnitMovement(fast, 0.1, 4);
    assert.equal(Number(fast.freeX.toFixed(4)), 10);
});

// ------------------------------------------------------------------ ④ 状态机把标记与倍率接起来

interface IUnitSystemHarnessOptions {
    /** `targeting.chargeSpeedScale` 的返回值；`undefined` = 模拟没有这条实现的旧上下文。 */
    chargeScale?: number;
}

function makeUnitSystemHarness(options: IUnitSystemHarnessOptions) {
    const me = makeUnit(1, ZCOwner.Player, 0);
    me.targetUnitId = 2;
    const foe = makeUnit(2, ZCOwner.Enemy, 30);
    const enemyTarget: ZCCombatTarget = { kind: 'unit', id: 2, x: 30, y: 0, bodyRadius: 6, cardId: null };
    const calls: number[] = [];
    const units = new Map([[me.id, me], [foe.id, foe]]);

    const context = {
        now: () => 1,
        effectiveDefinition: () => boxerDefinition(boxerProfile({ chargeDistance: 120, chargeSpeedScale: 4 })),
        controlOf: () => null,
        random: () => 0.5,
        unitById: units,
        targeting: {
            acquire: () => undefined,
            current: () => enemyTarget,
            isInAttackRange: () => false,
            isOutOfAttackRange: () => true,
            findStepToward: () => null,
            face: () => undefined,
            ...(options.chargeScale === undefined
                ? {}
                : { chargeSpeedScale: () => options.chargeScale }),
        },
        movement: {
            advanceTowardUnit: (_unit: ZCUnitState, _target: ZCUnitState, _dt: number, speedScale = 1) => {
                calls.push(speedScale);
            },
            advanceUnitMovement: (_unit: ZCUnitState, _dt: number, speedScale = 1) => { calls.push(speedScale); },
            startMarch: () => undefined,
            advanceMarch: () => undefined,
        },
        sendAttack: () => undefined,
    } as unknown as IZCUnitContext;

    return { me, foe, context, calls };
}

test('状态机：move 分支把倍率传给移动、并把 charging 置真', async () => {
    const { ZCUnitSystem } = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const charging = makeUnitSystemHarness({ chargeScale: 4 });
    ZCUnitSystem.update([charging.me], 1 / 30, charging.context);
    assert.deepEqual(charging.calls, [4], '冲刺倍率必须原样传到推进函数');
    assert.equal(charging.me.charging, true, '视图靠这个标记把移动动作换成攻击动作');

    const normal = makeUnitSystemHarness({ chargeScale: 1 });
    ZCUnitSystem.update([normal.me], 1 / 30, normal.context);
    assert.deepEqual(normal.calls, [1]);
    assert.equal(normal.me.charging, false);
});

test('状态机：没有 chargeSpeedScale 的旧上下文按 1 处理，不会抛', async () => {
    const { ZCUnitSystem } = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const harness = makeUnitSystemHarness({});
    ZCUnitSystem.update([harness.me], 1 / 30, harness.context);
    assert.deepEqual(harness.calls, [1]);
    assert.equal(harness.me.charging, false);
});

test('状态机：每帧先清标记 —— 离开 move 的那一帧 charging 必须立刻落回 false', async () => {
    const { ZCUnitSystem } = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const harness = makeUnitSystemHarness({ chargeScale: 4 });
    ZCUnitSystem.update([harness.me], 1 / 30, harness.context);
    assert.equal(harness.me.charging, true);
    // 进射程了：状态机切成 idle（不是 move），本帧就该把标记清掉，
    // 否则尸体会停在出拳姿势、或者进射程后还在做出拳动作。
    harness.me.battleState = 'idle';
    ZCUnitSystem.update([harness.me], 1 / 30, harness.context);
    assert.equal(harness.me.charging, false);
});

// ------------------------------------------------------------------ ⑤ 气浪

interface IImpactHarnessOptions {
    /** 普攻行的命中附加特效；缺省 = 不配。 */
    impactEffectPrefabPath?: string;
}

function makeImpactHarness(options: IImpactHarnessOptions) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    source.battleState = 'attack';
    const target = makeUnit(2, ZCOwner.Enemy, 12);

    const profile = boxerProfile({
        ...(options.impactEffectPrefabPath ? { impactEffectPrefabPath: options.impactEffectPrefabPath } : {}),
    });
    const definition = boxerDefinition(profile);

    const state = {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units: [source, target], nextUnitId: 3,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1,
        groundZones: [],
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY,
        bodyRadius: 6, cardId: null,
    };

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68033', skillId: 30713, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none', parameters: {},
    };
    const damageCalls: number[] = [];

    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_unit, amount) => { damageCalls.push(amount); return null; },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: { ...perOwner(() => new Map()), [ZCOwner.Player]: new Map([['68033:30713', runtime]]) },
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map([[source.id, source], [target.id, target]]),
        currentTarget: () => targetRef,
        evaluateLegacySkill: () => ({
            buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0,
        }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
    };

    return {
        state, source, target, context, damageCalls,
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
    };
}

test('气浪：命中后多推一条 area 事件，落在受击点、伤害为 0', () => {
    const harness = makeImpactHarness({ impactEffectPrefabPath: IMPACT_FX });
    harness.attack();
    assert.equal(harness.state.combatEvents.length, 2, '一次出手 = 一条近战事件 + 一条气浪事件');
    const [hit, impact] = harness.state.combatEvents;
    assert.equal(hit.type, ZCCombatEventType.Melee);
    assert.equal(hit.effectPrefabPath, 'units/projectiles/消灭学霸_普攻/消灭学霸_普攻', '拳套冲击照旧');

    assert.equal(impact.type, ZCCombatEventType.Area, 'area 才会落到地面层（气浪压在脚下）');
    assert.equal(impact.effectPrefabPath, IMPACT_FX);
    assert.equal(impact.damage, 0, '气浪是纯表现，不能再结算一次伤害');
    assert.deepEqual(
        [impact.fromX, impact.fromY, impact.toX, impact.toY],
        [harness.target.freeX, harness.target.freeY, harness.target.freeX, harness.target.freeY],
        '落在受击目标身上，不是出手点',
    );
    assert.equal(impact.skillId, hit.skillId);
    assert.equal(impact.owner, hit.owner);
    assert.ok(impact.id !== hit.id, '事件 id 必须唯一，否则视图会把两条合并成一条');
    // 伤害只结算了一次。
    assert.equal(harness.damageCalls.length, 1);
});

test('没配命中附加特效时不额外推事件（存量技能一行都不变）', () => {
    const harness = makeImpactHarness({});
    harness.attack();
    assert.equal(harness.state.combatEvents.length, 1);
    assert.equal(harness.state.combatEvents[0].type, ZCCombatEventType.Melee);
});

// ------------------------------------------------------------------ ⑥ 配置与资源

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('配表：只有 30713 配了冲刺三件套，其余行一律为空', () => {
    const rows = readPvpRows('pvpSkill');
    const boxer = rows.find((row) => Number(row.skillId) === 30713);
    assert.ok(boxer, 'pvpSkill 里必须有 30713');
    assert.equal(boxer.mode, 'melee', '拳击冲撞是近战判定');
    assert.equal(boxer.chargeDistance, 120);
    assert.equal(boxer.chargeSpeedScale, 4);
    assert.equal(boxer.impactEffectPrefabPath, IMPACT_FX);
    // 设计案写「P1 沿用」，所以出手特效仍是消灭学霸_普攻。
    assert.match(String(boxer.effectPrefabPath), /消灭学霸_普攻/);
    const others = rows.filter((row) => Number(row.skillId) !== 30713
        && (row.chargeDistance != null || row.chargeSpeedScale != null || row.impactEffectPrefabPath != null));
    assert.deepEqual(others.map((row) => row.skillId), [], '别的技能行不该被带上冲刺/气浪');
});

test('气浪资源真的在包里（配了不存在的路径运行时不报错、只是不出现）', () => {
    assert.ok(existsSync(`assets/bundles/battle/${IMPACT_FX}.prefab`), `${IMPACT_FX}.prefab 不存在`);
    assert.ok(existsSync('assets/bundles/battle/units/projectiles/消灭学霸_普攻/消灭学霸_普攻.prefab'));
});

test('解析层：三个新字段从表里读进 ZCAttackProfile，缺省不产生 undefined 之外的副作用', async () => {
    const { parseAttackProfiles } = await import('../assets/script/app/zcds/model/ZCPvpTableParser');
    const parsed = parseAttackProfiles([
        {
            skillId: 30713, name: '运动霸普攻', mode: 'melee',
            projectileSpeed: 0, areaRadius: 0, damageRate: null,
            chargeDistance: 120, chargeSpeedScale: 4, impactEffectPrefabPath: IMPACT_FX,
        },
        {
            skillId: 30714, name: '对照普攻', mode: 'melee',
            projectileSpeed: 0, areaRadius: 0,
        },
    ]);
    const boxer = parsed.get(30713)!;
    assert.equal(boxer.chargeDistance, 120);
    assert.equal(boxer.chargeSpeedScale, 4);
    assert.equal(boxer.impactEffectPrefabPath, IMPACT_FX);
    const plain = parsed.get(30714)!;
    assert.equal(plain.chargeDistance, undefined);
    assert.equal(plain.chargeSpeedScale, undefined);
    assert.equal(plain.impactEffectPrefabPath, undefined);
});
