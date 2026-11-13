/**
 * 施法动作与原地锁（2026-11-13 用户需求）：
 *
 *   「角色使用技能的表现调整，当角色在移动中，释放任意的主动技能都需要角色要播放攻击动作
 *     （当前已经是攻击动作就无需打断），释放 buff 类技能（回血，加伤害）时要打断 walk，
 *     停止在原地（不影响攻击），匹配对应的特效或数字加成的动画播放时间结束才继续」
 *
 * 落地口径：
 *  - **两件事、两个字段**：`castActionUntil`（所有主动车道都写，表现层换片段）与
 *    `castHoldUntil`（只有 `self_cast` 写，单位系统原地站定）；
 *  - **"不影响攻击"**：原地锁只拿掉"挪窝"，射程内有目标、普攻 CD 到点照常出拳；
 *  - **"当前已经是攻击动作就无需打断"**：`attack` 分支在锁之前，正在播的那一拳不会被拉回第 0 帧；
 *  - **待触发 / 被拒不写**：那两条路径每帧重试，写下去等于角色原地抖个不停；
 *  - 时长是**动画片段时长**（表现），不是 `selfCastSeconds`（增益持续 4~8 秒），见 `ZCUnitCastAction`。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { ZC_SELF_CAST_HOLD_SECONDS, ZC_SKILL_CAST_ACTION_SECONDS } from '../assets/script/app/zcds/model/ZCUnitCastAction';
import type { IZCStrikeOptions } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

const readSource = (path: string): string => readFileSync(path, 'utf8');

// ────────────────────────────────────────────── 夹具

function triggerUnit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: '68025', owner: 'player', cardId: 'c', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 100, maxHp: 100, battleState: 'idle',
        freeX: 0, freeY: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[]): ZCSnapshot {
    return {
        units, elapsedSeconds: 0, statusEffects: { nextUid: 1, units: [] },
        //  移形换影会往这里推一条「出发地闪一下」的纯表现事件，缺了会当场炸。
        combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
}

function runtime(parameters: Record<string, number>): ZCSkillRuntimeDefinition {
    return {
        unitId: '68025', skillId: 30251, behaviorKey: 'skill_params', trigger: 'every_seconds',
        stateMode: 'none', parameters,
    };
}

interface IHarness {
    readonly casts: string[];
    readonly value: Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    setGate(value: boolean): void;
}

/**
 * 所有车道都「真的放出去」的上下文：验的是**接线**（放出去了要写、没放出去不许写），
 * 至于各车道自己的参数判定由既有用例钉住。
 */
function harness(statusSystem: ZCStatusSystem, parameters: Record<string, number>): IHarness {
    const casts: string[] = [];
    const rt = runtime(parameters);
    let gate = true;
    const value = {
        statusSystem,
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? rt : undefined),
        fireBurst: () => {},
        castSecondary: (target: ZCUnitState) => { casts.push(`secondary:${target.id}`); return true; },
        castSelfAura: (target: ZCUnitState) => { casts.push(`aura:${target.id}`); return true; },
        castBolt: (target: ZCUnitState) => { casts.push(`bolt:${target.id}`); return true; },
        castTrap: (target: ZCUnitState) => { casts.push(`trap:${target.id}`); return true; },
        strike: (_target: ZCUnitState, _options: IZCStrikeOptions) => { casts.push('strike'); return 1; },
        blinkTo: (target: ZCUnitState) => { casts.push(`blink:${target.id}`); },
        unitPosition: (target: ZCUnitState) => ({ x: target.freeX, y: target.freeY }),
        distanceScale: 1,
        attackReachOf: () => 500,
        inAttackRange: () => gate,
        nearestEnemyDistance: () => 0,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return { casts, value, setGate: (next: boolean) => { gate = next; } };
}

/**
 * 把某条车道的 CD 推到就绪（首次推进只会挂 CD，不会放）。
 * 返回「真的放出去」的那一步之后的快照共享单步推进。
 */
function readyUp(state: ZCSnapshot, ctx: IHarness, caster: ZCUnitState): void {
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(caster.castActionUntil, undefined, '首次推进只挂 CD，不该留下施法动作');
}

// ────────────────────────────────────────────── 常量

test('两条时长都是「动画片段时长」量级，且互相独立', () => {
    assert.equal(ZC_SKILL_CAST_ACTION_SECONDS, 0.5);
    assert.equal(ZC_SELF_CAST_HOLD_SECONDS, 0.5);
    //  不能等于 `selfCastSeconds`（4~8 秒的增益持续）：那就不是「动作播完再走」，是站桩半局。
    assert.ok(ZC_SELF_CAST_HOLD_SECONDS >= 0.2 && ZC_SELF_CAST_HOLD_SECONDS <= 1.5);
    const source = readSource('assets/script/app/zcds/model/ZCUnitCastAction.ts');
    assert.ok(!/from 'cc'/.test(source), '★ZCUnitCastAction 必须保持无 cc 依赖，模型层与用例都要读它');
});

// ────────────────────────────────────────────── buff 类（self_cast）：动作窗口 + 原地锁

test('buff 类（self_cast）出手时同时写动作窗口与原地锁', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = triggerUnit(1);
    const state = snapshot([caster]);
    //  只回血、没有增益状态的那一档（`selfCastSeconds = 0`）也要锁 —— 自愈正是最该站定的那一类。
    const ctx = harness(statusSystem, { selfCastCooldown: 10, selfCastSeconds: 0, selfCastHealPct: 8 });

    readyUp(state, ctx, caster);
    assert.equal(caster.selfCastReadyAt, 10);

    state.elapsedSeconds = 10;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(caster.castActionUntil, 10 + ZC_SKILL_CAST_ACTION_SECONDS, 'buff 类要换攻击动作');
    assert.equal(caster.castHoldUntil, 10 + ZC_SELF_CAST_HOLD_SECONDS, 'buff 类要原地站定');
    assert.equal(caster.selfCastReadyAt, 20, 'CD 照常消费');
});

// ────────────────────────────────────────────── 其余车道：只写动作窗口，绝不原地锁

test('副轨扇形 / 自身光环 / 五雷轰顶 / 陷阱 / 多点打击 / 移形换影：只换动作，不原地锁', () => {
    const cases: { name: string; params: Record<string, number> }[] = [
        { name: '副轨扇形', params: { secondaryCooldown: 5 } },
        { name: '自身光环', params: { auraCooldown: 5, auraSeconds: 3, auraDamageRate: 1 } },
        { name: '五雷轰顶', params: { boltCooldown: 5, boltCount: 3, boltDamageRate: 1.6, boltRadius: 60 } },
        { name: '精密陷阱', params: { trapCooldown: 5, trapDuration: 15, trapRadius: 50, trapDamageRate: 2 } },
        {
            name: '多点打击',
            params: { strikeCooldown: 5, strikeCount: 1, strikeRadius: 200, strikeDamageRate: 1.2 },
        },
    ];
    for (const item of cases) {
        const statusSystem = new ZCStatusSystem();
        const caster = triggerUnit(1);
        const state = snapshot([caster]);
        const ctx = harness(statusSystem, item.params);
        readyUp(state, ctx, caster);
        state.elapsedSeconds = 5;
        ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
        assert.ok(ctx.casts.length > 0, `${item.name}：夹具没真的放出去，用例失效`);
        assert.equal(caster.castActionUntil, 5 + ZC_SKILL_CAST_ACTION_SECONDS, `${item.name}：要换攻击动作`);
        assert.equal(caster.castHoldUntil, undefined, `${item.name}：打人的车道不许原地锁`);
    }
});

test('待触发（普攻射程内没人）既不换动作也不锁——那两条路径每帧重试', () => {
    const statusSystem = new ZCStatusSystem();
    const caster = triggerUnit(1);
    const state = snapshot([caster]);
    const ctx = harness(statusSystem, { auraCooldown: 5, auraSeconds: 3, auraDamageRate: 1 });
    readyUp(state, ctx, caster);

    ctx.setGate(false);
    state.elapsedSeconds = 5;
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.deepEqual(ctx.casts, []);
    assert.equal(caster.castActionUntil, undefined, '★待触发时写窗口 = 角色原地抖个不停');

    //  目标进范围当帧补放，这时才写。
    ctx.setGate(true);
    ZCSkillTriggerSystem.tick(state, 0.05, ctx.value);
    assert.equal(caster.castActionUntil, 5 + ZC_SKILL_CAST_ACTION_SECONDS);
});

// ────────────────────────────────────────────── 原地锁在单位系统里的表现

function moveUnit(id: number, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, owner: 'player', unitId: '1', cardId: '1', tier: 1,
        sourceHexId: 1, targetHexId: null, progress: 0, hp: 10, maxHp: 10,
        battleState: 'move', stateTime: 0, targetUnitId: null, targetWallHexId: null,
        targetBuildingHexId: null, nextAttackAt: 0, waitUntil: 0,
        attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null, freeX: 0, freeY: 0,
        ...overrides,
    } as ZCUnitState;
}

function unitContext(units: ReadonlyMap<number, ZCUnitState>, options: {
    readonly now?: number;
    readonly inRange?: boolean;
    readonly target?: ZCCombatTarget | null;
    readonly onMove?: () => void;
} = {}): IZCUnitContext {
    const target = options.target ?? null;
    return {
        now: () => options.now ?? 1,
        effectiveDefinition: () => ({ attackHitTime: 0.2, attackDuration: 0.4, attackInterval: 1 } as ZCUnitDefinition),
        controlOf: () => null,
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
            advanceTowardUnit: (attacker) => { attacker.freeX = 5; options.onMove?.(); },
            advanceUnitMovement: () => { options.onMove?.(); },
            startMarch: () => {},
            advanceMarch: () => {},
        },
        sendAttack: (attacker) => { attacker.attackHitDone = true; },
    };
}

const enemyTarget: ZCCombatTarget = { kind: 'unit', id: 2, x: 10, y: 0, bodyRadius: 1, cardId: null };

test('原地锁：锁定期内不挪窝（walk 被打断），到期后自己恢复移动', () => {
    const soldier = moveUnit(1, { castHoldUntil: 1.5, castActionUntil: 1.5 });
    soldier.targetUnitId = 2;
    //  敌人必须真的在 `unitById` 里、且同格 —— 否则 `move` 分支拿不到目标本体，
    //  会走 `findStepToward`（夹具里恒 null）直接切回 idle，验不出「有没有在挪」。
    const enemy = moveUnit(2, { owner: 'enemy' });
    const units = new Map([[soldier.id, soldier], [enemy.id, enemy]]);
    let moved = false;

    ZCUnitSystem.update([soldier], 0.05, unitContext(units, {
        now: 1.1, inRange: false, target: enemyTarget, onMove: () => { moved = true; },
    }));
    assert.equal(soldier.battleState, 'idle', 'walk 必须被打断');
    assert.equal(moved, false, '锁定期内不许推进移动');
    assert.equal(soldier.freeX, 0);

    //  到期 ⇒ 清掉字段，交回常规状态机（目标还在射程外 ⇒ 切回 move）。
    ZCUnitSystem.update([soldier], 0.05, unitContext(units, {
        now: 1.6, inRange: false, target: enemyTarget, onMove: () => { moved = true; },
    }));
    assert.equal(soldier.castHoldUntil, undefined, '到期要清字段，别留在快照里');
    assert.equal(soldier.battleState, 'move');
    //  `idle → move` 那一帧只是切状态（常规状态机也是下一帧才真挪），所以再走一帧验移动。
    ZCUnitSystem.update([soldier], 0.05, unitContext(units, {
        now: 1.65, inRange: false, target: enemyTarget, onMove: () => { moved = true; },
    }));
    assert.equal(moved, true, '锁到期之后要能接着走');
});

test('原地锁不影响攻击：射程内有目标、普攻 CD 到点就照常出拳', () => {
    const soldier = moveUnit(1, { castHoldUntil: 2, castActionUntil: 2, nextAttackAt: 0 });
    soldier.targetUnitId = 2;
    const units = new Map([[soldier.id, soldier]]);

    ZCUnitSystem.update([soldier], 0.05, unitContext(units, { now: 1, inRange: true, target: enemyTarget }));
    assert.equal(soldier.battleState, 'attack', '★「不影响攻击」：锁的是走路，不是出手');
    assert.equal(soldier.nextAttackAt, 2, '出手后照常推进普攻 CD（now 1 + attackInterval 1）');
    assert.equal(soldier.facingRadians, 1.5);

    //  普攻 CD 没到 ⇒ 站着等，不乱动。
    const waiting = moveUnit(3, { castHoldUntil: 2, castActionUntil: 2, nextAttackAt: 9 });
    waiting.targetUnitId = 2;
    const units2 = new Map([[waiting.id, waiting]]);
    ZCUnitSystem.update([waiting], 0.05, unitContext(units2, { now: 1, inRange: true, target: enemyTarget }));
    assert.equal(waiting.battleState, 'idle');
});

test('原地锁不打断正在播的那一拳（attack 分支在锁之前）', () => {
    const soldier = moveUnit(1, { battleState: 'attack', stateTime: 0.15, castHoldUntil: 2, castActionUntil: 2 });
    const units = new Map([[soldier.id, soldier]]);

    ZCUnitSystem.update([soldier], 0.05, unitContext(units, { now: 1, inRange: true, target: enemyTarget }));
    assert.equal(soldier.battleState, 'attack', '★正在出拳不许被锁掐断');
    assert.ok(soldier.stateTime > 0.15, '攻击分支照常推进 stateTime');
});

// ────────────────────────────────────────────── 视图片段

test('ZCUnitView：施法窗口必须参与片段选择，且不参与「重播」判定', () => {
    const source = readSource('assets/script/app/zcds/view/ZCUnitView.ts');
    assert.match(source, /const casting = unit\.castActionUntil !== undefined && now < unit\.castActionUntil\s*\n?\s*&& unit\.battleState !== 'dead';/,
        '★视图要读 castActionUntil：移动中放技能得播攻击动作；阵亡不许保持出拳姿势');
    assert.match(source, /attacking \|\| charging \|\| castLift > 0 \|\| casting\s*\n?\s*\? this\.attackClip/,
        '★casting 必须进这条三元，否则配了字段也没人读');
    //  「当前已经是攻击动作就无需打断」：重播只认 attacking，施法窗口不得把正在播的那一拳拉回第 0 帧。
    assert.match(source, /const attackRestarted = attacking && \(unit\.completedAttackCount \?\? 0\) !== this\.lastAttackCount;/,
        '★重播判据只能认 attacking');
});

test('快照校验：两个新字段必须登记进白名单', () => {
    const source = readSource('assets/script/app/zcds/model/ZCSnapshotCodec.ts');
    assert.match(source, /'castActionUntil', 'castHoldUntil'\]/,
        '★新增可选数值字段不登记，回放校验会把脏值放过去');
});
