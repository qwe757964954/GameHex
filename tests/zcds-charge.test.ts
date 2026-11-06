import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type {
    ZCCombatTarget, ZCHexState, ZCProjectileState, ZCSnapshot, ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
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
 * 运动霸（68033）「203301 拳击冲撞」：**真·撞击**版冲刺 + 气浪（2026-11-02 重做）。
 *
 * 设计案第 162 行原文：
 *   「挥拳冲撞当前目标，近战判定，命中结算 1 次伤害，距离敌人 120px 时开始冲刺，
 *     冲刺阶段的移动速度 *4」
 *   「【P1 沿用】消灭学霸_普攻(15帧) 拳套冲击；命中 受击(坦克) + 气浪，开始冲刺时播放循环的攻击动作」
 *
 * 2026-11-02 用户明确指出老实现的问题：「现在是会索敌的」——
 *   老版冲刺只是**移速倍率**，`move` 分支一直 `advanceTowardUnit / advanceUnitMovement`
 *   追着目标走，只要进了近战射程就必定结算 ⇒ **结构上不可能 miss**，冲刺也就没有躲的余地。
 *
 * 现在的语义（用户逐条拍板）：
 *   ① 发现目标 → 在 `chargeDistance` 内且**攻击冷却就绪**时起冲；
 *   ② 起冲那一刻把目标坐标拍成**终点快照**，此后直线跑过去，中途不再修正朝向；
 *   ③ 每帧用线段扫掠圆判「路径上第一个进碰撞圈的敌人」，撞到才结算 1 次普攻伤害；
 *   ④ 冲空（跑到终点 / 撞墙 / 超时 / 被硬控打断）⇒ **不结算伤害**，但**照吃这次攻击冷却**。
 *   ⑤ 2026-11-03：**城墙 / 建筑目标同样走冲刺**，撞到就停在接触点、结算一次；撞单位也一样停。
 *   ⑥ 2026-11-03：冲刺**就是**普攻本身 ⇒ 0.7s 冷却从**撞上 / 冲空那一刻**起算（不是起冲），
 *      冷却期间原地不动、播待机动作（`charging === false`、`battleState === 'idle'`）。
 *
 * 「受击(坦克)」没法在这里钉：受击特效按**攻击方职业**播（`ZCGameLoader.HIT_FX_DIRECTORY`），
 * 而 68033 的职业是战士 —— 实际播的是「战士受击」，与设计案写的「坦克受击」不一致，
 * 已在设计案落地口径里注明，是否要为此加 per-skill 特例等策划拍板。
 */

const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const IMPACT_FX = 'units/projectiles/重骑兵_践踏/重骑兵_践踏';
const DT = 1 / 30;
/** 运动霸面板值（取自 pvpCard 68033 / pvpSkill 30713）。 */
const MOVE_SPEED = 25;
const ATTACK_RANGE = 45;
/**
 * 普攻间隔 = 冲刺的完整节拍。
 *
 * 2026-11-03 用户口径：「冲刺是运动霸的普通攻击，每次普通攻击都会有 0.7 秒的冷却时间，
 * 冷却时间静止在原地播放待机动作」⇒ 0.7 就是这张卡的 `unitAttackInterval`（原 1.8），
 * 冲锋段（≈0.51s）是这一拳的动作，撞上 / 冲空那一刻起算 0.7s 原地待机。
 */
const ATTACK_INTERVAL = 0.7;
const BODY_RADIUS = 6;
const CHARGE_SCALE = 4;
const CHARGE_DISTANCE = 220;
const DISTANCE_SCALE = 0.3;

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0): ZCUnitState {
    return {
        id, owner, unitId: '68033', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'move', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
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
        moveSpeed: MOVE_SPEED, attackRange: ATTACK_RANGE,
        attackInterval: ATTACK_INTERVAL, attackDuration: 0.667,
        attackHitTime: 0.345, bodyRadius: BODY_RADIUS, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1,
        attackProfile: profile,
    } as ZCUnitDefinition;
}

const CHARGE_PROFILE = () => boxerProfile({ chargeDistance: CHARGE_DISTANCE, chargeSpeedScale: CHARGE_SCALE });

// ------------------------------------------------------------------ ① 冲刺触发距离

test('冲刺起手距离：与 attackRange 同一套 px，乘 combatDistanceScale、补目标碰撞半径', () => {
    // 220px（表值）× 0.3 = 66 世界单位；补上 6 的碰撞半径 → 67.8。
    assert.equal(ZCTargetingSystem.chargeReach(CHARGE_DISTANCE, BODY_RADIUS, DISTANCE_SCALE), 67.8);
    // 表里 bodyRadius 常常还是 0（策划没补），此时就是裸距离。
    assert.equal(ZCTargetingSystem.chargeReach(CHARGE_DISTANCE, 0, DISTANCE_SCALE), 66);
});

test('冲刺距离不走「射程 > 100 打 9 折」那条分支', () => {
    // `attackReach` 对 120 这样的远射程会 ×0.9；冲刺若也打折就是 59.4，
    // 冲锋会莫名其妙提前 10% 触发。这里直接把两条口径的差钉住。
    assert.equal(ZCTargetingSystem.attackReach({ attackRange: 120 } as ZCUnitDefinition, 0, DISTANCE_SCALE), 32.4);
    assert.equal(ZCTargetingSystem.chargeReach(120, 0, DISTANCE_SCALE), 36);
});

// ------------------------------------------------------------------ ② 冲刺门槛（chargeSpeedScale）

interface IChargeHarnessOptions {
    profile: ZCAttackProfile;
    /** 双方在 x 轴上的间距（世界单位）。 */
    gap?: number;
    /** 目标是否同阵营（同阵营 ⇒ `current()` 返回 null，不该起冲）。 */
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
        combatDistanceScale: DISTANCE_SCALE,
        baseDefinition: () => definition,
        geometry: { hexIdAt: () => null },
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        hex: () => null,
        hasExposedWall: () => false,
    } as unknown as IZCUnitTargetingContext);

    return { targeting, me, foe };
}

test('距敌 chargeDistance 内返回倍率（= 可起冲），之外返回 1', () => {
    const profile = CHARGE_PROFILE();
    // reach = (220 + 6) × 0.3 = 67.8
    const near = makeTargetingHarness({ profile, gap: 60 });
    assert.equal(near.targeting.chargeSpeedScale(near.me), CHARGE_SCALE);
    const far = makeTargetingHarness({ profile, gap: 70 });
    assert.equal(far.targeting.chargeSpeedScale(far.me), 1);
    // 边界：正好 67.8 也算进入（<= 判定）。
    const edge = makeTargetingHarness({ profile, gap: 67.8 });
    assert.equal(edge.targeting.chargeSpeedScale(edge.me), CHARGE_SCALE);
});

test('没配冲刺 / 倍率不大于 1 / 没目标 / 目标已死或同阵营 ⇒ 一律 1', () => {
    const noDistance = boxerProfile({ chargeSpeedScale: CHARGE_SCALE });
    const a = makeTargetingHarness({ profile: noDistance, gap: 10 });
    assert.equal(a.targeting.chargeSpeedScale(a.me), 1, '没配 chargeDistance 不冲');

    const noScale = boxerProfile({ chargeDistance: CHARGE_DISTANCE });
    const b = makeTargetingHarness({ profile: noScale, gap: 10 });
    assert.equal(b.targeting.chargeSpeedScale(b.me), 1, '没配 chargeSpeedScale 不冲');

    const oneScale = boxerProfile({ chargeDistance: CHARGE_DISTANCE, chargeSpeedScale: 1 });
    const c = makeTargetingHarness({ profile: oneScale, gap: 10 });
    assert.equal(c.targeting.chargeSpeedScale(c.me), 1, '倍率 1 等于不加速，不该起冲');

    const dead = makeTargetingHarness({ profile: CHARGE_PROFILE(), gap: 10, targetDead: true });
    assert.equal(dead.targeting.chargeSpeedScale(dead.me), 1, '目标已死 ⇒ current() 为空');

    const ally = makeTargetingHarness({ profile: CHARGE_PROFILE(), gap: 10, sameOwner: true });
    assert.equal(ally.targeting.chargeSpeedScale(ally.me), 1, '同阵营不是目标');
});

// ------------------------------------------------------------------ ③ 碰撞判定（dashFirstHit）

interface IHitHarnessOptions {
    /** 其他单位：[id, x, y, owner?]。 */
    others: Array<[number, number, number, ZCOwner?]>;
}

function makeHitHarness(options: IHitHarnessOptions) {
    const definition = boxerDefinition(CHARGE_PROFILE());
    const me = makeUnit(1, ZCOwner.Player, 0);
    const units = new Map([[me.id, me]]);
    for (const [id, x, y, owner] of options.others) {
        units.set(id, makeUnit(id, owner ?? ZCOwner.Enemy, x, y));
    }
    const targeting = new ZCUnitTargeting({
        map: { hexes: [{ id: 0, x: 0, y: 0, neighbors: [] }] },
        units,
        targeting: {
            unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
            effectiveDefinition: () => definition,
            hasExposedWall: () => false,
            units: [...units.values()],
            hexes: [],
            now: 0,
            unitById: (id: number) => units.get(id) ?? null,
            hexPosition: () => ({ x: 0, y: 0 }),
        },
        combatDistanceScale: DISTANCE_SCALE,
        baseDefinition: () => definition,
        geometry: { hexIdAt: () => null },
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        hex: () => null,
        hasExposedWall: () => false,
    } as unknown as IZCUnitTargetingContext);
    return { targeting, me, units };
}

/** 近战 reach = (45 + 6) × 0.3 = 15.3 —— 碰撞判定就用它当半径。 */
const REACH = 15.3;

test('碰撞半径 = 自己的近战 reach（不是裸 bodyRadius 求和）', () => {
    // 正对着 15.2 处：reach 15.3 ⇒ 判中；且起点就已经在圈里，接触点回落到 0。
    const head = makeHitHarness({ others: [[2, 15.2, 0]] });
    const hit = head.targeting.dashFirstHit(head.me, 0, 0, 30, 0);
    assert.ok(hit, '15.2 < reach 15.3，必须判撞上');
    assert.equal(hit!.id, 2);
    assert.equal(hit!.x, 0, '起点已在碰撞圈内 ⇒ 接触点就是起点');

    // 横向偏 10：近战 reach 15.3 判中；换成「双方 bodyRadius 求和」只有 (6+6)×0.3 = 3.6，
    // 会判不中 —— 这就是不用 bodyRadius 的原因。
    const lateral = makeHitHarness({ others: [[2, 15, 10]] });
    assert.ok(lateral.targeting.dashFirstHit(lateral.me, 0, 0, 40, 0) !== null,
        '横向 10 在 reach 之内，擦到就算撞到');
    assert.ok(10 > (BODY_RADIUS + BODY_RADIUS) * DISTANCE_SCALE, '而 bodyRadius 求和尚不到 10');

    // 横向 16 > reach 15.3 ⇒ 真的碰不到。
    const tooFar = makeHitHarness({ others: [[2, 15, 16]] });
    assert.equal(tooFar.targeting.dashFirstHit(tooFar.me, 0, 0, 40, 0), null, '16 > reach，擦不到');
});

test('路径上第一个：撞的是先接触的那个，不是锁定目标', () => {
    // 锁定 3 号（x=60），但 2 号挡在 x=30 —— 冲锋撞到谁算谁。
    const lane = makeHitHarness({ others: [[2, 30, 0], [3, 60, 0]] });
    const hit = lane.targeting.dashFirstHit(lane.me, 0, 0, 50, 0);
    assert.equal(hit?.id, 2, 'x=30 的敌人先进入碰撞圈');

    // 掉个个儿：只有 3 号时，同一条线段撞的是 3 号？
    // 不 —— 50 还没走到 60，线段完全没有碰到 3 号的碰撞圈（60 − 15.3 = 44.7 > 50 才碰得到，
    // 这里 50 > 44.7，其实是碰到了，所以顺带把「线段长度真的参与判定」钉住）。
    const only = makeHitHarness({ others: [[3, 60, 0]] });
    assert.equal(only.targeting.dashFirstHit(only.me, 0, 0, 50, 0)?.id, 3);
    assert.equal(only.targeting.dashFirstHit(only.me, 0, 0, 44, 0), null, '44 < 44.7，还差一点');
});

test('同阵营 / 已阵亡 / 空中单位不算，终点重合也不崩', () => {
    const ally = makeHitHarness({ others: [[2, 20, 0, ZCOwner.Player]] });
    assert.equal(ally.targeting.dashFirstHit(ally.me, 0, 0, 40, 0), null, '友军不撞');

    const dead = makeHitHarness({ others: [[2, 20, 0]] });
    dead.units.get(2)!.hp = 0;
    dead.units.get(2)!.battleState = 'dead';
    assert.equal(dead.targeting.dashFirstHit(dead.me, 0, 0, 40, 0), null, '尸体不撞');

    const nobody = makeHitHarness({ others: [] });
    assert.equal(nobody.targeting.dashFirstHit(nobody.me, 10, 10, 10, 10), null, '退化线段不能抛');
});

// ------------------------------------------------------------------ ④ 冲刺推进（dashStep / placeAt）

function makeMovementContext(options: {
    definition: ZCUnitDefinition;
    /** `hexIdAt` 的返回值；默认恒为 0（无障碍）。 */
    hexId?: () => number | null;
    /** `hex()` 的返回值；默认中立空地。 */
    hex?: (id: number) => ZCHexState | null;
}): ZCMovementContext {
    return {
        map: {
            hexes: [{ id: 0, x: 0, y: 0, neighbors: [1] }, { id: 1, x: 100, y: 0, neighbors: [0] }],
        } as unknown as ZCMatchMap,
        geometry: { hexIdAt: options.hexId ?? (() => 0) },
        effectiveDefinition: () => options.definition,
        bonuses: () => ({ moveSpeedMultiplier: 1 } as ZCDeckBonuses),
        hex: options.hex ?? (() => ({ id: 0, owner: 'neutral', building: 'none', cardId: null } as unknown as ZCHexState)),
        hasExposedWall: () => false,
        rules: { artifactEnemySpeedMultiplier: 1 },
        goalHomeId: () => 0,
        frozenSeconds: () => 0,
        moveUnitToHex: () => undefined,
    } as unknown as ZCMovementContext;
}

test('dashStep：直线推进、吃冲刺倍率、最后一步不冲过头', () => {
    const definition = boxerDefinition(CHARGE_PROFILE());
    const system = new ZCMovementSystem(makeMovementContext({ definition }));

    const unit = makeUnit(1, ZCOwner.Player, 0);
    unit.dashX = 60;
    unit.dashY = 0;
    // 移速 25 × 4 = 100 ⇒ dt=0.1 走 10。
    const first = system.dashStep(unit, 0.1, CHARGE_SCALE);
    assert.deepEqual([first.fromX, first.fromY, first.x, first.y, first.landed], [0, 0, 10, 0, false]);

    // 终点并入本步 ⇒ 直接落到终点、`landed` 置真（不许越过终点继续冲）。
    unit.freeX = 55;
    const last = system.dashStep(unit, 0.1, CHARGE_SCALE);
    assert.deepEqual([last.x, last.y, last.landed], [60, 0, true]);

    // 起点是预测值而非落盘值：连调两次必须给出同一个起点，调用方才有机会先判碰撞再落位。
    unit.freeX = 0;
    assert.equal(system.dashStep(unit, 0.1, CHARGE_SCALE).fromX, 0);
    assert.equal(system.dashStep(unit, 0.1, CHARGE_SCALE).fromX, 0, 'dashStep 不许偷改坐标');
});

test('dashStep：敌方城墙 / 建筑挡住 ⇒ 原地不动并收场', () => {
    const definition = boxerDefinition(CHARGE_PROFILE());
    const wall = {
        id: 0, owner: ZCOwner.Enemy, building: 'tower', wallHp: 100, wallMaxHp: 100, cardId: null,
    } as unknown as ZCHexState;
    const blocked = new ZCMovementSystem(makeMovementContext({
        definition,
        hex: () => wall,
    }));
    const unit = makeUnit(1, ZCOwner.Player, 0);
    unit.dashX = 60;
    unit.dashY = 0;
    const step = blocked.dashStep(unit, 0.1, CHARGE_SCALE);
    assert.deepEqual([step.x, step.y, step.landed], [0, 0, true], '撞墙那一步原地停、当场收场');

    // 城墙是**自己家**的就不挡（旗子插在自己城里，冲锋不该被自己墙卡住）。
    const ownWall = { ...wall, owner: ZCOwner.Player } as unknown as ZCHexState;
    const passable = new ZCMovementSystem(makeMovementContext({ definition, hex: () => ownWall }));
    const step2 = passable.dashStep(unit, 0.1, CHARGE_SCALE);
    assert.equal(step2.landed, false);
    assert.equal(step2.x, 10);

    // `hexIdAt` 判不出格子（地图外 / 旧夹具没实现）不当作撞墙。
    const unknown = new ZCMovementSystem(makeMovementContext({ definition, hexId: () => null, hex: () => wall }));
    assert.equal(unknown.dashStep(unit, 0.1, CHARGE_SCALE).landed, false, '判不出格子就别误判成撞墙');
});

test('placeAt：落盘 + 按位移方向改朝向（八向取整）+ 清掉寻路残留', () => {
    const definition = boxerDefinition(CHARGE_PROFILE());
    const system = new ZCMovementSystem(makeMovementContext({ definition }));
    const unit = makeUnit(1, ZCOwner.Player, 0);
    unit.targetHexId = 1;
    unit.progress = 0.4;

    system.placeAt(unit, 0, 10);
    assert.deepEqual([unit.freeX, unit.freeY], [0, 10]);
    assert.equal(unit.facingRadians, Math.PI / 2, '朝上');
    assert.equal(unit.targetHexId, null, '冲刺不走寻路，目标格要清掉');
    assert.equal(unit.progress, 0);

    system.placeAt(unit, 10, 10);
    assert.equal(unit.facingRadians, 0, '纯 +x');

    system.placeAt(unit, 20, 20);
    assert.equal(unit.facingRadians, Math.PI / 4, '斜向取 45°');

    // 原地落位不改朝向（避免抖动时朝向乱跳）。
    const keep = unit.facingRadians;
    system.placeAt(unit, 20, 20);
    assert.equal(unit.facingRadians, keep);
});

// ------------------------------------------------------------------ ⑤ 状态机接线（起冲 / 命中 / 冲空）

interface IBattleOptions {
    /** 起手间距（世界单位，x 轴）。 */
    gap: number;
    /** 额外单位：[id, x, y]。 */
    others?: Array<[number, number, number]>;
    /** `now` 起始值（默认 0）。 */
    now?: number;
    /** 普攻冷却就绪时刻（默认 0 = 立即可冲）。 */
    nextAttackAt?: number;
    /** 去掉 `movement.dashStep / placeAt`，模拟老上下文。 */
    legacyMovement?: boolean;
    /** `dashFirstHit` 是否可用（默认可用）。 */
    noHitTest?: boolean;
    /** 结构目标：`kind` + 地块 id（默认 1）/ 地块坐标（默认 x=60）。城墙与建筑共用一套夹具。 */
    structure?: { kind: 'wall' | 'building'; hexId?: number; x?: number };
    /** 结构目标已经作废（墙被拆平 / 建筑被打爆）——用来钉「不该再冲过去」。 */
    structureBroken?: boolean;
}

function makeBattle(options: IBattleOptions) {
    const definition = boxerDefinition(CHARGE_PROFILE());
    const me = makeUnit(1, ZCOwner.Player, 0);
    const foe = makeUnit(2, ZCOwner.Enemy, options.gap);
    const structureHexId = options.structure ? (options.structure.hexId ?? 1) : null;
    const structureHex = options.structure ? {
        id: structureHexId as number,
        owner: ZCOwner.Enemy,
        building: options.structure.kind === 'building' ? 'tower' : 'none',
        wallHp: options.structure.kind === 'wall' && !options.structureBroken ? 500 : 0,
        wallMaxHp: options.structure.kind === 'wall' ? 500 : 0,
        hp: options.structure.kind === 'building' && !options.structureBroken ? 800 : 0,
        cardId: null,
    } as unknown as ZCHexState : null;
    const hexes = [
        { id: 0, x: 0, y: 0, neighbors: [1] },
        { id: 1, x: options.structure?.x ?? 60, y: 0, neighbors: [0] },
    ];
    const hexOf = (id: number): ZCHexState | null => (
        structureHex && id === structureHexId
            ? structureHex
            : { id, owner: 'neutral', building: 'none', cardId: null } as unknown as ZCHexState
    );
    const hasExposedWall = (hex: ZCHexState): boolean => (
        !!structureHex && hex.id === structureHexId && !options.structureBroken
    );

    if (structureHex) {
        me.targetUnitId = null;
        me.targetWallHexId = options.structure!.kind === 'wall' ? structureHexId : null;
        me.targetBuildingHexId = options.structure!.kind === 'building' ? structureHexId : null;
    } else {
        me.targetUnitId = foe.id;
    }
    me.nextAttackAt = options.nextAttackAt ?? 0;
    const units = new Map([[me.id, me], [foe.id, foe]]);
    for (const [id, x, y] of options.others ?? []) units.set(id, makeUnit(id, ZCOwner.Enemy, x, y));

    const clock = { now: options.now ?? 0 };
    let controlled: { kind: string; defId: string } | null = null;

    const targeting = new ZCUnitTargeting({
        map: { hexes },
        units,
        targeting: {
            unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
            effectiveDefinition: () => definition,
            hasExposedWall,
            units: [...units.values()],
            hexes: [],
            now: 0,
            unitById: (id: number) => units.get(id) ?? null,
            hexPosition: () => ({ x: 0, y: 0 }),
        },
        combatDistanceScale: DISTANCE_SCALE,
        baseDefinition: () => definition,
        geometry: { hexIdAt: () => 0 },
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        hex: hexOf,
        hasExposedWall,
    } as unknown as IZCUnitTargetingContext);

    // 「判不出碰撞」的上下文：整条冲刺只会跑到终点，永远不会结算伤害。
    if (options.noHitTest) {
        (targeting as unknown as { dashFirstHit: () => null }).dashFirstHit = () => null;
    }

    const movement = new ZCMovementSystem(makeMovementContext({ definition }));
    const attacks: number[] = [];
    /** 每次 `sendAttack` 打的是什么：`unit` / `wall` / `building`（城墙与建筑共用一块地块 id）。 */
    const attackTags: string[] = [];
    const context = {
        now: () => clock.now,
        effectiveDefinition: () => definition,
        controlOf: () => controlled,
        random: () => 0.5,
        unitById: units,
        targeting,
        movement: options.legacyMovement
            ? {
                advanceTowardUnit: (unit: ZCUnitState, target: ZCUnitState, dt: number) => {
                    movement.advanceTowardUnit(unit, target, dt);
                },
                advanceUnitMovement: (unit: ZCUnitState, dt: number) => movement.advanceUnitMovement(unit, dt),
                startMarch: () => undefined,
                advanceMarch: () => undefined,
            }
            : movement,
        //  与真实 `sendAttack` 同一口径：出手第一件事就是把 `attackHitDone` 置真，
        //  否则进 attack 状态会二次结算（这里顺手把这个契约也钉住）。
        sendAttack: (unit: ZCUnitState) => {
            unit.attackHitDone = true;
            attackTags.push(unit.targetUnitId !== null
                ? 'unit'
                : unit.targetWallHexId !== null ? 'wall' : unit.targetBuildingHexId !== null ? 'building' : 'none');
            attacks.push(unit.targetUnitId ?? -1);
        },
    } as unknown as IZCUnitContext;

    return {
        me, foe, units, clock, attacks, attackTags, context,
        control: (value: { kind: string; defId: string } | null) => { controlled = value; },
    };
}

type ZCUnitSystemModule = typeof import('../assets/script/app/zcds/model/systems/ZCUnitSystem');

/** 推进一帧：时钟先走、再更新状态机（与 `ZCGameModel` 的步进顺序一致）。 */
function tick(battle: ReturnType<typeof makeBattle>, system: ZCUnitSystemModule): void {
    battle.clock.now = Math.round((battle.clock.now + DT) * 1e9) / 1e9;
    system.ZCUnitSystem.update([battle.me], DT, battle.context);
}

/** 一直推进到 `until` 成立（最多 `max` 帧），返回实际用了多少帧。 */
function tickUntil(
    battle: ReturnType<typeof makeBattle>, system: ZCUnitSystemModule, until: () => boolean, max = 60,
): number {
    let frames = 0;
    while (frames < max && !until()) {
        tick(battle, system);
        frames += 1;
    }
    return frames;
}

test('撞上：起冲 → 跑到接触点 → 结算 1 次普攻 → 原地待机 0.7s', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const battle = makeBattle({ gap: 60 });

    // 第一帧就该起冲（冷却就绪、在 220px 内、目标是单位）。
    system.ZCUnitSystem.update([battle.me], DT, battle.context);
    assert.equal(battle.me.battleState, 'move', '起冲不改主状态，冲刺是 move 的子阶段');
    assert.ok(battle.me.dashUntil !== undefined, '有截止时刻 ⇒ 正在冲刺');
    assert.equal(battle.me.dashX, 60, '终点 = 起冲那一刻目标的坐标');
    assert.equal(battle.me.dashY, 0);
    assert.equal(battle.me.charging, true, '表现层靠它播循环的攻击动作');
    // 2026-11-03 口径变了：冲刺**就是**普攻，冷却从撞上 / 冲空那一刻起算，不是起冲。
    assert.equal(battle.me.nextAttackAt, 0, '起冲不扣冷却（否则冲空要白等一次）');
    assert.equal(battle.me.dashRecoverUntil, undefined, '还没收场，不进待机');
    assert.equal(battle.attacks.length, 0, '刚起冲还没撞到人');

    // 一路冲到撞上为止（60 → 15.3，每帧 3.33）。
    const frames = tickUntil(battle, system, () => battle.attacks.length > 0, 40);
    assert.ok(frames > 5, `冲锋要跑好几帧才撞得上，实际 ${frames}`);
    assert.equal(battle.attacks.length, 1, '撞上只结算一次');
    assert.equal(battle.attacks[0], battle.foe.id, '撞的是锁定目标');
    assert.equal(battle.me.attackHitDone, true, 'sendAttack 已置真 ⇒ 不会有第二次结算');
    assert.equal(battle.me.dashUntil, undefined, '冲刺已收场');
    assert.equal(battle.me.charging, false, '收场后不再挂冲刺标记（否则待机会被出拳姿势盖住）');
    assert.equal(battle.me.battleState, 'idle', '撞完就是待机 —— 出拳动作＝刚才那段冲锋');
    assert.ok(Math.abs(battle.me.freeX - (60 - REACH)) < 0.6,
        `必须停在接触点（约 ${(60 - REACH).toFixed(1)}），实际 ${battle.me.freeX.toFixed(2)}`);

    // 冷却从「撞上那一刻」起算 0.7s，两个字段同值：一个管何时能再出手，一个管这 0.7s 别挪窝。
    const hitAt = battle.clock.now;
    assert.ok(Math.abs(battle.me.nextAttackAt - (hitAt + ATTACK_INTERVAL)) < 1e-6,
        `冷却应从撞上时刻 +${ATTACK_INTERVAL}s，实际 ${battle.me.nextAttackAt}`);
    assert.equal(battle.me.dashRecoverUntil, battle.me.nextAttackAt, '待机截止＝冷却截止');

    // 0.7s 里原地不动：坐标、朝向都不许变，也不许再起冲。
    const frozen = { x: battle.me.freeX, y: battle.me.freeY, facing: battle.me.facingRadians };
    for (let i = 0; i < 6; i += 1) {
        tick(battle, system);
        assert.equal(battle.me.dashUntil, undefined, '冷却没好不起冲');
        assert.equal(battle.me.battleState, 'idle', '整段冷却都是待机');
        assert.equal(battle.me.charging, false, '待机不是冲刺姿势');
        assert.equal(battle.me.freeX, frozen.x, '冷却期间不挪窝');
        assert.equal(battle.me.freeY, frozen.y);
        assert.equal(battle.me.facingRadians, frozen.facing, '朝向也不许转');
    }
    assert.equal(battle.attacks.length, 1, '冷却期间不许再结算');

    // 冷却过后接着打：此时已贴身 ⇒ 下一拳是零距离冲刺，但仍然走「冲 → 撞 → 待机」这条路。
    // 不能等 `dashRecoverUntil === undefined`：冷却到点那一帧会当场重新起冲、再写一次截止时刻，
    // 帧与帧之间根本观察不到 undefined（这也正是要的：冷却一好就出手，不多站一帧）。
    tickUntil(battle, system, () => battle.attacks.length > 1, 40);
    assert.equal(battle.attacks.length, 2, '冷却过后必须再出一拳');
    const gapSeconds = battle.clock.now - hitAt;
    assert.ok(gapSeconds >= ATTACK_INTERVAL - 1e-6, `不许提前解除待机，实际 ${gapSeconds.toFixed(3)}s`);
    assert.ok(gapSeconds <= ATTACK_INTERVAL + 2 * DT, `也不许拖到冷却之后才出手，实际 ${gapSeconds.toFixed(3)}s`);
});

test('冲空：目标让开 ⇒ 一分伤害都不打，但从冲空那一刻起照吃 0.7s 冷却', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const battle = makeBattle({ gap: 60 });

    system.ZCUnitSystem.update([battle.me], DT, battle.context);
    assert.ok(battle.me.dashUntil !== undefined);
    // 冲刺途中目标横移出去（比 reach 15.3 远得多）——这就是「能躲」的那条缝。
    battle.foe.freeY = 40;
    tickUntil(battle, system, () => battle.me.dashUntil === undefined, 40);
    assert.equal(battle.attacks.length, 0, '没撞到人 ⇒ 零伤害');
    assert.equal(battle.me.dashUntil, undefined, '跑完终点收场');
    assert.ok(Math.abs(battle.me.freeX - 60) < 1e-6, '冲到自己起手时拍下的那个点（不是目标的新位置）');
    assert.ok(Math.abs(battle.me.freeY) < 1e-6, '横向一点没跟 —— 冲刺不索敌');
    assert.ok(Math.abs(battle.me.nextAttackAt - (battle.clock.now + ATTACK_INTERVAL)) < 1e-6,
        `冲空也照吃冷却，且从冲空那一刻起算，实际 ${battle.me.nextAttackAt} vs ${battle.clock.now}`);
    assert.equal(battle.me.dashRecoverUntil, battle.me.nextAttackAt, '冲空同样站着待机');
    assert.equal(battle.me.battleState, 'idle');
    assert.equal(battle.me.charging, false);
});

test('路径上第一个：挡在路上的敌人先挨打，锁定目标反而没事', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    // 锁定 2 号（x=60），3 号挡在 x=30。
    const battle = makeBattle({ gap: 60, others: [[3, 30, 0]] });

    tickUntil(battle, system, () => battle.attacks.length > 0, 40);
    assert.deepEqual(battle.attacks, [3], '撞到的是挡路的那个');
    assert.equal(battle.me.targetUnitId, 3, '仇恨跟着撞击对象改，落地后接着打它');
    assert.ok(battle.me.freeX < 30, `撞点必须在 3 号之前，实际 ${battle.me.freeX.toFixed(2)}`);
});

// --------------------------------------------------------- ⑤b 结构目标（城墙 / 建筑）也走冲刺

/** 结构目标的碰撞半径是 `ZCUnitTargeting.STRUCTURE_TARGET_BODY_RADIUS = 80` ⇒ reach = (45+80)×0.3。 */
const STRUCTURE_REACH = (ATTACK_RANGE + 80) * DISTANCE_SCALE;

for (const [kind, tag] of [['wall', '城墙'], ['building', '建筑']] as const) {
    test(`撞${tag}：同样走冲刺，停在${tag}前、结算一次普攻、然后 0.7s 待机`, async () => {
        const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
        // 目标单位摆到 400 外（不在这条冲锋线上），只留结构目标。
        const battle = makeBattle({ gap: 400, structure: { kind, x: 60 } });

        system.ZCUnitSystem.update([battle.me], DT, battle.context);
        assert.ok(battle.me.dashUntil !== undefined, '结构目标也要起冲');
        assert.equal(battle.me.charging, true, '表现层同样换循环攻击动作');
        assert.equal(battle.me.dashX, 60, '终点 = 地块中心');
        assert.equal(battle.attacks.length, 0);

        const frames = tickUntil(battle, system, () => battle.attacks.length > 0, 40);
        assert.ok(frames > 3, `冲上去要跑几帧才撞到，实际 ${frames}`);
        assert.equal(battle.attacks.length, 1, '撞结构也只结算一次');
        assert.equal(battle.attackTags[0], kind, `结算对象必须是${tag}`);
        // 撞完目标就锁在那个地块上：`sendAttack` 靠它分流到 damageWall / damageBuilding。
        assert.equal(battle.me.targetUnitId, null);
        assert.equal(battle.me.targetWallHexId, kind === 'wall' ? 1 : null);
        assert.equal(battle.me.targetBuildingHexId, kind === 'building' ? 1 : null);
        assert.equal(battle.me.dashUntil, undefined, '撞到即收场');
        assert.equal(battle.me.charging, false);
        assert.ok(Math.abs(battle.me.freeX - (60 - STRUCTURE_REACH)) < 0.6,
            `停在接触点（约 ${(60 - STRUCTURE_REACH).toFixed(1)}），实际 ${battle.me.freeX.toFixed(2)}`);

        // 和撞单位一样：从撞上那一刻起 0.7s 原地待机。
        assert.ok(Math.abs(battle.me.nextAttackAt - (battle.clock.now + ATTACK_INTERVAL)) < 1e-6,
            `撞结构也要吃冷却，实际 ${battle.me.nextAttackAt}`);
        assert.equal(battle.me.dashRecoverUntil, battle.me.nextAttackAt);
        const frozen = battle.me.freeX;
        tick(battle, system);
        assert.equal(battle.me.freeX, frozen, '冷却期间不挪窝');
        assert.equal(battle.me.battleState, 'idle');
    });
}

test('结构目标作废（墙拆平 / 建筑爆了）⇒ 不再是冲刺对象', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');

    const wall = makeBattle({ gap: 400, structure: { kind: 'wall', x: 60 }, structureBroken: true });
    system.ZCUnitSystem.update([wall.me], DT, wall.context);
    assert.equal(wall.me.dashUntil, undefined, '墙都没了还冲过去 = 撞空气');
    assert.equal(wall.attacks.length, 0);

    const building = makeBattle({ gap: 400, structure: { kind: 'building', x: 60 }, structureBroken: true });
    system.ZCUnitSystem.update([building.me], DT, building.context);
    assert.equal(building.me.dashUntil, undefined);
    assert.equal(building.attacks.length, 0);
});

test('冷却没好 / 老上下文没有 dash 能力 ⇒ 一律不起冲', async () => {    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');

    // ① 冷却没好：老老实实按原速走。
    const cooling = makeBattle({ gap: 60, nextAttackAt: 5 });
    system.ZCUnitSystem.update([cooling.me], DT, cooling.context);
    assert.equal(cooling.me.dashUntil, undefined, '冷却没好不起冲');
    assert.equal(cooling.me.charging, false, '也不该挂冲刺姿势');
    assert.ok(cooling.me.freeX > 0 && cooling.me.freeX < 1, '按面板移速走，不是 4 倍');

    // ② 老上下文（没有 dashStep / placeAt）：维持原行为，不抛。
    const legacy = makeBattle({ gap: 60, legacyMovement: true });
    system.ZCUnitSystem.update([legacy.me], DT, legacy.context);
    assert.equal(legacy.me.dashUntil, undefined);
    assert.equal(legacy.attacks.length, 0);
    assert.ok(legacy.me.freeX > 0, '还是会朝目标走');

    // ③ 没有碰撞判定的上下文：跑完全程也不会凭空结算伤害。
    const blind = makeBattle({ gap: 60, noHitTest: true });
    system.ZCUnitSystem.update([blind.me], DT, blind.context);   // 先起冲（没起冲时 dashUntil 本来就是 undefined）
    tickUntil(blind, system, () => blind.me.dashUntil === undefined, 40);
    assert.equal(blind.attacks.length, 0, '判不出碰撞就不能结算伤害');
    assert.ok(Math.abs(blind.me.freeX - 60) < 1e-6, '但里程是照跑的');
});

test('冲刺中挨硬控 ⇒ 冲刺当场作废，并按冲空同责进 0.7s 待机', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const battle = makeBattle({ gap: 60 });

    system.ZCUnitSystem.update([battle.me], DT, battle.context);
    tick(battle, system);
    const frozenAt = battle.me.freeX;
    battle.control({ kind: 'stun', defId: 'stun_1' });
    tick(battle, system);
    assert.equal(battle.me.dashUntil, undefined, '被硬控打断 ⇒ 冲刺收场');
    assert.equal(battle.me.freeX, frozenAt, '硬控期间不动');
    assert.equal(battle.me.charging, false);
    assert.equal(battle.attacks.length, 0, '被打断不是命中');
    //  起冲时不再扣冷却了 ⇒ 这条路径必须自己扣，否则解控后下一帧又是一次免费冲锋。
    assert.ok(Math.abs(battle.me.nextAttackAt - (battle.clock.now + ATTACK_INTERVAL)) < 1e-6,
        `打断也要吃冷却，实际 ${battle.me.nextAttackAt}`);
    assert.equal(battle.me.dashRecoverUntil, battle.me.nextAttackAt);

    battle.control(null);
    tick(battle, system);
    assert.equal(battle.me.dashUntil, undefined, '解控后不会续上刚才那一下冲锋');
});

test('超时兜底：`dashUntil` 过期就按冲空收场，不结算伤害但进冷却', async () => {
    const system = await import('../assets/script/app/zcds/model/systems/ZCUnitSystem');
    const battle = makeBattle({ gap: 60 });

    system.ZCUnitSystem.update([battle.me], DT, battle.context);
    assert.ok(battle.me.dashUntil !== undefined);
    // 把截止时刻压到过去：模拟终点不可达 / 极端帧长。
    battle.me.dashUntil = -1;
    tick(battle, system);
    assert.equal(battle.me.dashUntil, undefined, '过期即清');
    assert.equal(battle.me.charging, false);
    assert.equal(battle.attacks.length, 0, '超时不是命中');
    assert.ok(Math.abs(battle.me.nextAttackAt - (battle.clock.now + ATTACK_INTERVAL)) < 1e-6,
        '超时同样要进冷却，不然每帧都会重起一次冲锋');
    assert.equal(battle.me.dashRecoverUntil, battle.me.nextAttackAt);
});

// ------------------------------------------------------------------ ⑥ 气浪

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
        combatEvents: [], projectiles: [] as ZCProjectileState[], nextCombatEventId: 1,
        groundZones: [],
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY,
        bodyRadius: BODY_RADIUS, cardId: null,
    };

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68033', skillId: 30713, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none', parameters: {},
    };
    const damageCalls: number[] = [];

    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: DISTANCE_SCALE, combatDamageMultiplier: 1, unitAttackPerTier: 0,
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

// ------------------------------------------------------------------ ⑦ 配置与资源

function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClientRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`../doc/塔防数据配置/json/client/${name}.json`, 'utf8'));
}

test('配表：运动霸普攻的冲刺三件套完整，其余冲刺技能参数合法', () => {
    const rows = readPvpRows('pvpSkill');
    const boxer = rows.find((row) => Number(row.skillId) === 30713);
    assert.ok(boxer, 'pvpSkill 里必须有 30713');
    assert.equal(boxer.mode, 'melee', '拳击冲撞是近战判定');
    // 2026-11-02 改成真·撞击后，这个值不再是「开始加速的距离」而是**防守手距离**：
    // 220 × 0.3 = 66 世界单位起点 − 近战 15.3 ⇒ 冲锋段约 0.51s，30fps 下 15 帧。
    assert.equal(boxer.chargeDistance, 220, '起手距离 = 冲锋段长度 / 0.3 + 近战 reach');
    assert.equal(boxer.chargeSpeedScale, 4);
    assert.equal(boxer.impactEffectPrefabPath, IMPACT_FX);
    // 设计案写「P1 沿用」，所以出手特效仍是消灭学霸_普攻。
    assert.match(String(boxer.effectPrefabPath), /消灭学霸_普攻/);
    const others = rows.filter((row) => Number(row.skillId) !== 30713
        && (row.chargeDistance != null || row.chargeSpeedScale != null));
    for (const row of others) {
        assert.ok(Number(row.chargeDistance) > 0, `${row.skillId} 冲刺距离`);
        assert.ok(Number(row.chargeSpeedScale) >= 1, `${row.skillId} 冲刺倍率`);
        assert.equal(row.mode, 'melee', `${row.skillId} 冲刺使用近战判定`);
    }
});

test('两份 pvpSkill 的冲刺参数同值（表源与运行时不能各说各话）', () => {
    for (const path of ['assets/remoteRef/pvpSkill.json', '../doc/塔防数据配置/json/client/pvpSkill.json']) {
        const rows = path.includes('remoteRef') ? readPvpRows('pvpSkill') : readClientRows('pvpSkill');
        const row = rows.find((item) => Number(item.skillId) === 30713);
        assert.ok(row, `${path} 里没有 30713`);
        assert.equal(row!.chargeDistance, 220, `${path} 的冲刺距离被改回去了`);
        assert.equal(row!.chargeSpeedScale, 4, `${path} 的冲刺倍率`);
    }
});

test('配表：0.7s 就是运动霸的普攻间隔，两份 pvpCard 同值', () => {
    //  「冲刺是普通攻击，每次普通攻击都会有 0.7 秒冷却」⇒ 不新增「冲刺冷却」列，
    //  直接改 `unitAttackInterval`：表源一处、`nextAttackAt` 一套时钟。
    for (const path of ['assets/remoteRef/pvpCard.json', '../doc/塔防数据配置/json/client/pvpCard.json']) {
        const rows = path.includes('remoteRef') ? readPvpRows('pvpCard') : readClientRows('pvpCard');
        const row = rows.find((item) => Number(item.id) === 68033);
        assert.ok(row, `${path} 里没有卡 68033`);
        assert.equal(Number(row!.unitAttackInterval), ATTACK_INTERVAL,
            `${path} 的运动霸攻击间隔必须是 0.7s`);
    }
    // 别把整张卡表的攻击间隔一起改了。
    const cards = readPvpRows('pvpCard');
    const others = cards.filter((row) => Number(row.id) !== 68033
        && Number(row.unitAttackInterval) === ATTACK_INTERVAL);
    assert.deepEqual(others.map((row) => row.id), [], '只有 68033 是 0.7s');
});

test('冲锋段长度：按真实表值算出来要够长，否则「加速」在画面上看不见', () => {
    // 这条是设计意图守卫，不是实现细节：起冲后要一路跑到近战 reach 才可能撞上，
    // 所以看得见的冲锋段 = (chargeDistance × scale) − reach，用 4 倍速跑完的秒数就是窗口。
    const skills = readPvpRows('pvpSkill');
    const cards = readPvpRows('pvpCard');
    const skill = skills.find((row) => Number(row.skillId) === 30713);
    const card = cards.find((row) => Number(row.id) === 68033);
    assert.ok(skill && card, '运动霸的卡行与普攻行都要在');
    const chargeDistance = Number(skill!.chargeDistance);
    const attackRange = Number(card!.unitAttackRange);
    const bodyRadius = Number(card!.bodyRadius ?? BODY_RADIUS);
    const moveSpeed = Number(card!.unitMoveSpeed);
    const scale = Number(skill!.chargeSpeedScale);
    assert.ok(chargeDistance > attackRange, '起手距离必须比攻击距离远，否则根本没有冲锋段');

    const reach = ZCTargetingSystem.attackReach(
        { attackRange } as ZCUnitDefinition, bodyRadius, DISTANCE_SCALE,
    );
    const bandPx = chargeDistance * DISTANCE_SCALE - reach;        // 看得见的那一段（世界单位）
    const seconds = bandPx / (moveSpeed * scale);                  // 4 倍速下的持续时间
    assert.ok(bandPx >= 40, `冲锋段至少 40 世界单位（约 1.3 个格距），实际 ${bandPx.toFixed(2)}`);
    assert.ok(seconds >= 0.4, `4 倍冲刺至少 0.4s（30fps 下 12 帧）才读得出「先走再冲」，实际 ${seconds.toFixed(3)}s`);

    //  冷却必须比冲锋段长，否则收场瞬间冷却就到期、画面上根本看不到「站着待机」那一段。
    const interval = Number(card!.unitAttackInterval);
    assert.ok(interval > seconds,
        `普攻间隔 ${interval}s 必须长于冲锋段 ${seconds.toFixed(3)}s，否则 0.7s 待机是空谈`);
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
            chargeDistance: 220, chargeSpeedScale: 4, impactEffectPrefabPath: IMPACT_FX,
        },
        {
            skillId: 30714, name: '对照普攻', mode: 'melee',
            projectileSpeed: 0, areaRadius: 0,
        },
    ]);
    const boxer = parsed.get(30713)!;
    assert.equal(boxer.chargeDistance, 220);
    assert.equal(boxer.chargeSpeedScale, 4);
    assert.equal(boxer.impactEffectPrefabPath, IMPACT_FX);
    const plain = parsed.get(30714)!;
    assert.equal(plain.chargeDistance, undefined);
    assert.equal(plain.chargeSpeedScale, undefined);
    assert.equal(plain.impactEffectPrefabPath, undefined);
});
