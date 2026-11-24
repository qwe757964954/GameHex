import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZC_QUAKE_STRIKE_PREFAB_PATH, ZC_QUAKE_STRIKE_SECONDS } from '../assets/script/app/zcds/model/ZCQuakeFx';
import {
    ZCSkillTriggerSystem, type IZCSkillTriggerContext,
} from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import type { IZCStrikeOptions } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

/**
 * 第 44 批 · 仙桃行者 68009「腾云驾雾」四段突进连击（2026-11-24）。
 *
 * 用户原话：
 *   「以150px速度突进到目标1身前 攻击1次，以目标1为圆心 200px为半径，内索取额外3个目标（合计4人），
 *    依次突进到这些目标身前攻击1次（每个目标攻击1次），再回到目标1的位置，
 *    给每个目标造成350%410%/480%(对应等级的伤害)，每次攻击都会释放 重击特效
 *    这个技能的攻击不计入普攻的累计数」
 *
 * 配表那一侧（三档参数、两个新名字、两份产物）由 `zcds-xiantao-quake.test.ts` ①② 守着；
 * 本文件只钉**行为**，一条一个「照字面写就会静默出错」的点：
 *
 *  1. 访问顺序在**起手那一帧**拍死：中途死人只跳过，不重新选人（否则四段变成打不完的循环）；
 *  2. 每一下打的是**那一段的人**（`strike` 的 `origin` = 目标本人坐标），不是「眼前最近的那个」；
 *  3. 收尾回的是**起手那一刻目标 1 的坐标**，不是本体起手点、也不是最后一个目标的位置；
 *  4. 这条车道的伤害走 `strikeTargets`，**不碰 `completedAttackCount`**（用户口径「不计入普攻累计数」）；
 *  5. 参数不全（没有 `dashChainSpeed`）整段不启动 —— 不挪人、不打人、也不冻结。
 */

const ROOT = process.cwd();

// ────────────────────────────────────────────── 夹具

const DASH_PARAMS = {
    dashChainSpeed: 150,
    dashChainSpreadRadius: 200,
    dashChainCount: 4,
    dashChainStopDistance: 30,
    dashChainHitRadius: 40,
    dashChainDamageRate: 3.5,
};

const DT = 1 / 30;

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = '68028'): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: y, completedAttackCount: 0,
    };
}

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: { player: 0, enemy: 0, neutral: 0 },
        allRandomNonGoldDraws: { player: 0, enemy: 0, neutral: 0 },
        builtTypeCounts: { player: {}, enemy: {}, neutral: {} },
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

interface IHarness {
    context: IZCSkillTriggerContext;
    blinks: Array<{ id: number; x: number; y: number }>;
    strikes: IZCStrikeOptions[];
}

function triggerContext(
    params: Record<string, number> | null,
    distanceScale = 1,
): IHarness {
    const blinks: Array<{ id: number; x: number; y: number }> = [];
    const strikes: IZCStrikeOptions[] = [];
    const runtime = params
        ? ({ skillChainId: 100904, behaviorKey: 'dash_chain', trigger: 'none', stateMode: 'none',
            parameters: { ...params } } as unknown as ZCSkillRuntimeDefinition)
        : undefined;
    const context = {
        statusSystem: {
            hasDef: () => false,
            apply: () => ({ applied: false }),
            statModsOf: () => ({}),
            remove: () => undefined,
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
        },
        runtimeOf: () => runtime,
        fireBurst: () => undefined,
        castSecondary: () => false,
        //  只接这两根线：别的车道要么各自还有一个 `castXxx` 钩子（本夹具不给 ⇒ 整段不执行），
        //  要么吃自己的 `xxxCooldown` 参数（参数袋里只有 dashChain*）。
        blinkTo: (unit: ZCUnitState, x: number, y: number) => {
            unit.freeX = x;
            unit.freeY = y;
            blinks.push({ id: unit.id, x, y });
        },
        strike: (_unit: ZCUnitState, options: IZCStrikeOptions) => {
            strikes.push(options);
            return 1;
        },
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        distanceScale,
        statPatchOf: () => undefined,
        healUnit: () => undefined,
    } as unknown as IZCSkillTriggerContext;
    return { context, blinks, strikes };
}

/** 跑到序列结束（或上限）。返回跑了几帧 + 起手那一帧拍下来的访问顺序。*/
function runUntilDone(
    state: ZCSnapshot, caster: ZCUnitState, harness: IHarness, limit = 4000,
): { frames: number; order: number[] } {
    let order: number[] = [];
    for (let frame = 1; frame <= limit; frame += 1) {
        state.elapsedSeconds = frame * DT;
        ZCSkillTriggerSystem.tick(state, DT, harness.context);
        //  收尾时 `clearDashChain` 会把 `dashChainIds` 删掉，所以顺序要在跑的过程中抄下来。
        if (order.length === 0 && caster.dashChainIds) order = [...caster.dashChainIds];
        if (caster.dashChainIndex === undefined) return { frames: frame, order };
    }
    throw new Error(`四段突进 ${limit} 帧还没结束（dashChainIndex=${caster.dashChainIndex}）`);
}

function startChain(caster: ZCUnitState, first: ZCUnitState): void {
    //  与 `ZCAttackResolutionSystem.prepareAttack` 写下的两个标记逐字一致。
    caster.dashChainPendingAt = 0;
    caster.dashChainTargetId = first.id;
}

// ────────────────────────────────────────────── 一、四段：选人、落点、回程

test('① 四段各打一个人：顺序 = 目标 1 → 圆内由近到远补 3 个，圆外与友军都不进队列', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 300, 0);
    const near = makeUnit(3, ZCOwner.Enemy, 300, 50);
    const mid = makeUnit(4, ZCOwner.Enemy, 300, -100);
    const far = makeUnit(5, ZCOwner.Enemy, 300, 180);
    //  圆外（离目标 1 260 > 200）与友军各一个：都不许进队列。
    const outside = makeUnit(6, ZCOwner.Enemy, 300, 260);
    const ally = makeUnit(7, ZCOwner.Player, 300, 20);
    const units = [caster, first, near, mid, far, outside, ally];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    startChain(caster, first);
    const { order } = runUntilDone(state, caster, harness);

    assert.deepEqual(order, [2, 3, 4, 5], '队列应是 目标1 + 圆内由近到远的 3 个');
    assert.equal(order.includes(6), false, '圆外的敌人被算进来了（量的是目标 1 到候选者的距离）');
    assert.equal(order.includes(7), false, '友军被算进来了');

    assert.equal(harness.strikes.length, 4, '每人只打 1 次，合计 4 次');
    //  🔴 `origin` 必须是**被打的那个人**的坐标：`strikeTargets` 只按「离 origin 最近」挑，
    //  刚落地时旁边站着别人，圆心给成本体位置就会打到别人身上（四段变打同一个人）。
    const origins = harness.strikes.map((options) => [
        Math.round(options.origin!.x), Math.round(options.origin!.y),
    ]);
    assert.deepEqual(origins, [[300, 0], [300, 50], [300, -100], [300, 180]],
        '每一下的挑人圆心不是那一段的目标');
    for (const options of harness.strikes) {
        assert.equal(options.count, 1, '一次只打一个');
        assert.equal(options.nearest, true);
        assert.equal(options.damageRate, DASH_PARAMS.dashChainDamageRate, '每段都要吃满 350%');
        assert.equal(options.radius, DASH_PARAMS.dashChainHitRadius, 'distanceScale = 1 时挑人半径 = 表值');
    }

    //  回程：落到**起手那一刻目标 1 的坐标**（300,0），不是本体起手点（0,0）。
    assert.ok(Math.abs(caster.freeX - 300) < 1e-6 && Math.abs(caster.freeY - 0) < 1e-6,
        `收尾没有回到目标 1 的位置：${caster.freeX},${caster.freeY}`);
    assert.equal(caster.dashChainIndex, undefined, '跑完必须清干净（不清就永远冻着）');
    assert.equal(caster.dashChainIds, undefined);
    assert.equal(caster.dashChainReturnX, undefined);
});

test('② 每次攻击都推一条重击柱表现事件：纯表现（半径/伤害 0）、落在被打的人身上', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 120, 0);
    const second = makeUnit(3, ZCOwner.Enemy, 120, 60);
    const units = [caster, first, second];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    startChain(caster, first);
    runUntilDone(state, caster, harness);

    assert.equal(state.combatEvents.length, 2, '打 2 个人就该有 2 条重击柱事件');
    for (const [index, event] of state.combatEvents.entries()) {
        assert.equal(event.effectPrefabPath, ZC_QUAKE_STRIKE_PREFAB_PATH);
        assert.equal(event.durationSeconds, ZC_QUAKE_STRIKE_SECONDS,
            '寿命短了会被事件寿命截断在半路（29 帧 ÷ 24fps）');
        assert.equal(event.radius, 0, '纯表现：伤害已经由 strike 结算过，这里再写一次就是双倍');
        assert.equal(event.damage, 0);
        assert.equal(event.targetUnitId, index === 0 ? first.id : second.id, '特效要落在被打的那个人身上');
        assert.equal(Math.round(event.toX), 120);
    }
});

test('③ 目标不足：场上只有 2 个敌人 ⇒ 只打 2 段，照样回位', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 150, 0);
    const only = makeUnit(3, ZCOwner.Enemy, 150, 40);
    const units = [caster, first, only];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    startChain(caster, first);
    const { order } = runUntilDone(state, caster, harness);

    assert.deepEqual(order, [2, 3], '不足 4 人就按现有的打，不补位、不重复');
    assert.equal(harness.strikes.length, 2);
    assert.ok(Math.abs(caster.freeX - 150) < 1e-6 && Math.abs(caster.freeY) < 1e-6);
});

test('④ 中途死人：跳过那一段（不空挥、不换人补打），后面的照打', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 100, 0);
    const doomed = makeUnit(3, ZCOwner.Enemy, 100, 40);
    const last = makeUnit(4, ZCOwner.Enemy, 100, -60);
    const units = [caster, first, doomed, last];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    startChain(caster, first);
    //  🔴 必须**先跑一帧**把人选进队列，再打死：起手那一帧之前就死，它压根不会进 `dashChainIds`
    //  （那不是「跳过」，是「本来就没选中」）—— 两件事要分清楚。
    state.elapsedSeconds = DT;
    ZCSkillTriggerSystem.tick(state, DT, harness.context);
    assert.deepEqual(caster.dashChainIds, [2, 3, 4], '起手那一帧就该把 3 个都排好队');
    doomed.hp = 0;
    doomed.battleState = 'dead';
    const { order } = runUntilDone(state, caster, harness);

    assert.deepEqual(order, [2, 3, 4], '顺序在起手那一帧就拍死了，死了也不重选');
    assert.equal(harness.strikes.length, 2, '死掉的那一段跳过，不打、也不换人补');
    const origins = harness.strikes.map((options) => Math.round(options.origin!.y));
    assert.deepEqual(origins, [0, -60], '跳过之后要接着打第 3 段，不能原地卡住');
});

// ────────────────────────────────────────────── 二、不计入普攻累计数

test('⑤ 不计入普攻累计数：整条链路跑完，completedAttackCount 一格不动', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 200, 0);
    const units = [caster, first];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    //  触发它的那一次普攻已经把这一格 +1 过（`consumeEmpoweredAttack`），四段本身不再记。
    caster.completedAttackCount = 5;
    startChain(caster, first);
    runUntilDone(state, caster, harness);

    assert.equal(caster.completedAttackCount, 5, '四段突进不许推进 completedAttackCount');
    assert.equal(harness.strikes.length, 1);
});

// ────────────────────────────────────────────── 三、参数与登记

test('⑥ 参数不全（没有 dashChainSpeed）⇒ 整段不启动：不挪人、不打人、不冻结', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 200, 0);
    const units = [caster, first];
    const state = makeState(units);
    const harness = triggerContext({ ...DASH_PARAMS, dashChainSpeed: 0 });

    startChain(caster, first);
    state.elapsedSeconds = DT;
    ZCSkillTriggerSystem.tick(state, DT, harness.context);

    assert.equal(harness.blinks.length, 0, '没配速度就不该动');
    assert.equal(harness.strikes.length, 0);
    assert.equal(caster.dashChainIndex, undefined, '更不能把单位冻住（那是「整局站着不动」）');
    assert.equal(caster.freeX, 0);
});

test('⑦ 突进速度按表值 × combatDistanceScale：0.3 比例下一帧只走 150 × 0.3 / 30', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 300, 0);
    const units = [caster, first];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS, 0.3);

    startChain(caster, first);
    state.elapsedSeconds = DT;
    ZCSkillTriggerSystem.tick(state, DT, harness.context);

    //  起手那一帧就建好序列并**接着推第一段**（同一帧完成，不额外停一帧）。
    assert.equal(caster.dashChainIndex, 0);
    assert.ok(Math.abs(caster.freeX - 1.5) < 1e-9,
        `一帧应推进 150 × 0.3 ÷ 30 = 1.5 世界 px，实际 ${caster.freeX}`);
    assert.equal(caster.freeY, 0, '直线推进不许有横向漂移');
    state.elapsedSeconds = DT * 2;
    ZCSkillTriggerSystem.tick(state, DT, harness.context);
    assert.ok(Math.abs(caster.freeX - 3) < 1e-9,
        `第二帧应到 3 世界 px（两帧累计 3），实际 ${caster.freeX}`);
});

test('⑧ 登记与快照：三处白名单齐全，六个字段都能进快照', () => {
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    for (const key of ['dashChainPendingAt', 'dashChainTargetId', 'dashChainIds',
        'dashChainIndex', 'dashChainReturnX', 'dashChainReturnY']) {
        assert.match(types, new RegExp(`${key}\\?:`), `ZCUnitState 缺字段 ${key}`);
    }

    const runtimeSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
    assert.match(runtimeSrc, /register\('dash_chain'/, 'ZCSkillRuntime 没注册 dash_chain');

    const schemaSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    assert.match(schemaSrc, /SKILL_BEHAVIORS = new Set\(\[[\s\S]*?'dash_chain'[\s\S]*?\]\)/,
        'ZCStatSchema.SKILL_BEHAVIORS 缺 dash_chain ⇒ 读表阶段直接抛「未注册 behaviorKey」');

    const catalogSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCEffectCatalog.ts'), 'utf8');
    assert.match(catalogSrc, /dashChain: 'dash_chain'/, 'ZCEffectCatalog 行为键缺 dashChain');

    const codecSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['dashChainPendingAt', 'dashChainTargetId', 'dashChainIndex',
        'dashChainReturnX', 'dashChainReturnY', 'dashChainIds']) {
        //  `dashChainIds` 在 codec 里走的是属性访问（`unit.dashChainIds`），不是字符串键。
        assert.match(codecSrc, new RegExp(`['\\.]${key}`),
            `ZCSnapshotCodec 白名单缺 ${key}（不还原 = 读档回来单位冻在半路）`);
    }

    //  冻结：`ZCUnitSystem` 必须靠 `dashChainIndex` 整段跳过（不索敌 / 不出手 / 不自己挪窝）。
    const unitSrc = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCUnitSystem.ts'), 'utf8');
    assert.match(unitSrc, /if \(unit\.dashChainIndex !== undefined\) return;/,
        'ZCUnitSystem 没有在四段突进期间冻结单位（会和 blinkTo 抢坐标）');
    //  🔴 位置很关键：必须排在 `dashUntil` 冲刺分支之后，否则冲刺中的单位会先被冲刺逻辑推走。
    const dashIdx = unitSrc.indexOf('if (unit.dashChainIndex !== undefined) return;');
    const dashBlockIdx = unitSrc.indexOf('if (unit.dashUntil !== undefined)');
    assert.ok(dashBlockIdx > 0 && dashIdx > dashBlockIdx,
        '冻结必须在 dashUntil 块之后');
});

test('⑨ 起手目标在留标记与建序列之间死了 ⇒ 这一拍空过，不补打也不冻人', () => {
    //  `prepareAttack` 只留标记、不当场出手（`return null`），中间隔着同一帧的普攻推进；
    //  目标要是正好在这个缝里死了，这一拍就该空过 —— 补打给谁都是错的，而冻住单位是致命的。
    const caster = makeUnit(1, ZCOwner.Player, 0, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 200, 0);
    const units = [caster, first];
    const state = makeState(units);
    const harness = triggerContext(DASH_PARAMS);

    startChain(caster, first);
    first.hp = 0;
    first.battleState = 'dead';
    state.elapsedSeconds = DT;
    ZCSkillTriggerSystem.tick(state, DT, harness.context);

    assert.equal(harness.strikes.length, 0);
    assert.equal(caster.dashChainIndex, undefined);
    assert.equal(caster.dashChainIds, undefined, '标记要清干净，不能留一个「起手了但没有目标」的残局');
    assert.equal(caster.freeX, 0);
});
