import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCSnapshot, ZCUnitState, ZCGroundZoneState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillRuntimeRegistry } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCCombatEventType, type ZCAttackProfile, type ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZC_BLINK_CAST_EFFECT_PREFAB_PATH } from '../assets/script/app/zcds/model/ZCBlinkCastFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { zcCombatEffectOverlayChild } from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import { assetPath } from './helpers/asset-paths';

/**
 * 魔术师（68034）按新版设计案重做（2026-11-06）。
 *
 * 设计案把「移形换影」和「鹿神守护」都写成 103404（重复 ID）。本次的落点：
 *   · 103404 移形换影 —— 沿用原「空间置换」那条成长链（K-卡牌升级 里 103404 的三行描述
 *     本来就是移形换影的 L1/L2/L3），换 behaviorKey 为 `blink_strike`；
 *   · 103405 鹿神守护 —— 新技能、新成长链，走强化槽（累计 8 次普攻）+ 移动区域；
 *   · 103403 帽子戏法 / pvpSkill 30855 空间置换 —— 整条下线。
 *
 * 这里钉三件事：
 *  1. 配表真值（计划行参数、普攻行触发方式、成长链）；
 *  2. `blink_strike` 的位移 / 两端伤害 / 分身定时；
 *  3. `damageFalloff` 的「每多一个目标 -50%」。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

function readRows(name: string): Array<Record<string, any>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, any>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

function planRows(chain: number): Array<Record<string, any>> {
    const rows = readRows('pvpSkillPlan')
        .filter((row) => String(row.unitId) === '68034' && Number(row.skillChainId) === chain)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3, `${chain} 必须恰好 3 档`);
    return rows;
}

function paramsOf(chain: number, level: number): Record<string, number> {
    const row = planRows(chain)[level - 1];
    return JSON.parse(String(row.skillParamJson)) as Record<string, number>;
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('魔术师技能链：103401/103402/103404/103405，帽子戏法与空间置换已下线', () => {
    prepare();
    const card = readRows('pvpCard').find((row) => Number(row.unitId) === 68034)!;
    assert.deepEqual(card.skillList, [103401, 103402, 103404, 103405]);
    assert.equal(card.unitSkillId, 30710, '普攻行没换');

    const chains = new Set(readRows('pvpSkillPlan')
        .filter((row) => String(row.unitId) === '68034')
        .map((row) => Number(row.skillChainId)));
    assert.equal(chains.has(103403), false, '帽子戏法整链下线');
    assert.equal(chains.has(103405), true, '鹿神守护是新链');

    const skills = readRows('pvpSkill').map((row) => Number(row.skillId));
    assert.equal(skills.includes(30855), false, '空间置换的技能行下线');
});

test('移形换影：三档参数与设计案 120 / 100 / 140% 对齐', () => {
    prepare();
    for (const row of planRows(103404)) {
        assert.equal(row.skillName, '移形换影');
        assert.equal(row.behaviorKey, 'blink_strike');
        assert.equal(row.pvpSkillId, 30710, '参数并进本卡普攻行的那一个参数袋');
        //  原 103403 挂的 stun_* 不能残留：计划行按 unitId:pvpSkillId 合参数，
        //  留着会让每一次普攻都带眩晕。
        assert.equal(row.statusId ?? null, null);
    }
    const l1 = paramsOf(103404, 1);
    assert.deepEqual(
        [l1.blinkCooldown, l1.blinkDamageRate, l1.blinkRoundTrip, l1.blinkCloneDamageRate],
        [12, 1.2, 0, 0], 'L1：12 秒 CD / 单程 120% / 无往返 / 无分身');
    const l2 = paramsOf(103404, 2);
    assert.deepEqual(
        [l2.blinkDamageRate, l2.blinkRoundTrip, l2.blinkCloneDamageRate],
        [1, 1, 0.6], 'L2：往返各 100% + 分身 60%');
    const l3 = paramsOf(103404, 3);
    assert.deepEqual(
        [l3.blinkDamageRate, l3.blinkRoundTrip, l3.blinkCloneDamageRate, l3.blinkCloneSeconds],
        [1.4, 1, 1, 2], 'L3：往返各 140% + 分身持续 2 秒后爆 100%');
});

test('鹿神守护：走强化槽的移动区域，伤害按 600/700/800 ÷ 面板反算', () => {
    prepare();
    const attack = readRows('pvpSkill').find((row) => Number(row.skillId) === 30710)!;
    assert.equal(attack.trigger, 'every_n_attacks', '累计普攻必须走 every_n_attacks 分支');
    assert.equal(Number(attack.empoweredEvery), 8, '设计案：累计 8 次普攻');
    assert.equal(Number(attack.empoweredSkillId), 30854);
    assert.equal(attack.secondarySkillId ?? null, null, '空间置换下线后副槽要清空');

    const ultimate = readRows('pvpSkill').find((row) => Number(row.skillId) === 30854)!;
    assert.equal(ultimate.name, '鹿神守护');
    assert.equal(ultimate.mode, 'area');
    assert.equal(Number(ultimate.durationSeconds), 2, '冲刺持续 2 秒');
    assert.equal(ultimate.effectPrefabPath, 'units/projectiles/鹿神守护/鹿神守护',
        '小鹿本体 + 上层循环火特效的复合预制（2026-11-07）');

    //  面板 120 ⇒ 600/700/800 分别对应 5 / 5.8333 / 6.6667 倍。
    assert.deepEqual([1, 2, 3].map((level) => paramsOf(103405, level).damageRate), [5, 5.8333, 6.6667]);
    for (const level of [1, 2, 3]) {
        const params = paramsOf(103405, level);
        assert.deepEqual(
            [params.zoneMoveSpeed, params.zoneDuration, params.zoneMaxHits, params.zoneWaveInterval],
            [140, 2, 1, 0.15],
            '快档 140 / 兜底 2 秒 / 命中名额 1（接触即消失）/ 每 0.15 秒探一次接触');
        assert.deepEqual(
            [params.zoneSpawnForward, params.zoneApproachSpeed, params.zoneSprintRange],
            [15, 70, 200],
            '身前 15px 生成 / 慢档 70px/s / 距目标 200px 提速',
        );
        assert.equal(params.zoneDamageFalloff, undefined,
            '2026-11-12 起不再递减：命中即消失，没有第二个目标可减');
        assert.equal(params.zoneHoldVisual, 1,
            '「整个追击阶段循环播火特效」必须开整段持有视觉，否则会闪成一串残影');
    }

    //  成长链也要有，否则界面上点不出这一级。
    const growth = readRows('armySkillLevelUp').filter((row) => Number(row.id) === 103405);
    assert.equal(growth.length, 3);
    assert.deepEqual(growth.map((row) => Number(row.unlockarmylevel)), [9, 18, 24]);
    assert.equal(readRows('armySkillLevelUp').some((row) => Number(row.id) === 103403), false);
});

// ── 二、blink_strike 运行时 ─────────────────────────────────────────────────────

function makeUnit(id: number, owner: ZCOwner, x: number, unitId: string): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as ZCUnitState;
}

function makeState(units: ZCUnitState[], now = 1): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: now, durationSeconds: 300,
        units, projectiles: [], combatEvents: [], groundZones: [], statusEffects: [],
        nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
}

interface IStrikeCall {
    count: number;
    radius: number;
    damageRate: number;
    nearest: boolean;
    origin?: { x: number; y: number };
}

/** 施法者在 x=0，最近的敌人在 x=150（世界 px；搜索半径 600 表值 × 0.3 = 180 世界 px 之内）。 */
function blinkHarness(level: number, withEnemy = true) {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68034');
    const enemy = makeUnit(2, ZCOwner.Enemy, 150, '68028');
    const far = makeUnit(3, ZCOwner.Enemy, 5000, '68028');
    const units = withEnemy ? [caster, enemy, far] : [caster, far];
    const state = makeState(units, 1);
    const statusSystem = new ZCStatusSystem();
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68034', skillId: 30710, behaviorKey: 'blink_strike',
        trigger: 'none', stateMode: 'none', parameters: paramsOf(103404, level),
    };
    const moves: Array<{ x: number; y: number }> = [];
    const strikes: IStrikeCall[] = [];
    const tick = (at: number): void => {
        state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(state, 0.1, {
            statusSystem,
            runtimeOf: (unit) => (unit.id === caster.id ? runtime : undefined),
            fireBurst: () => undefined,
            castSecondary: () => false,
            distanceScale: 0.3,
            unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
            blinkTo: (unit, x, y) => {
                moves.push({ x, y });
                unit.freeX = x;
                unit.freeY = y;
            },
            strike: (unit, options) => {
                strikes.push({
                    count: options.count,
                    radius: options.radius,
                    damageRate: options.damageRate,
                    nearest: options.nearest,
                    origin: options.origin ? { ...options.origin } : undefined,
                });
                return 1;
            },
        });
    };
    return { tick, moves, strikes, caster, enemy, state };
}

test('移形换影：开局不立刻闪，CD 到点闪到最近敌人身前并结算一次', () => {
    const harness = blinkHarness(1);
    harness.tick(1);
    assert.equal(harness.moves.length, 0, '第一次推进只记 readyAt');
    assert.equal(harness.caster.blinkReadyAt, 13);

    harness.tick(12.9);
    assert.equal(harness.moves.length, 0, 'CD 没到不动');

    harness.tick(13);
    assert.equal(harness.moves.length, 1, 'L1 单程，只挪一次');
    //  落点停在目标身前 30 表值 px × 0.3 = 9 世界 px。
    assert.deepEqual(harness.moves[0], { x: 141, y: 0 });
    assert.equal(harness.strikes.length, 1, '落点结算一次');
    assert.deepEqual(
        [harness.strikes[0].count, harness.strikes[0].damageRate, harness.strikes[0].radius],
        [1, 1.2, 40 * 0.3], '打 1 个 / 120% / 判定半径 40 表值 px');
    assert.equal(harness.caster.blinkReadyAt, 25, '下一次再等一个完整 CD');
    assert.equal(harness.caster.blinkCloneAt, undefined, 'L1 不留分身');
});

test('移形换影：II 级起往返各打一次，回位点是施法前的原位', () => {
    const harness = blinkHarness(2);
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.moves.length, 2, '去 + 回');
    assert.deepEqual(harness.moves[1], { x: 0, y: 0 }, '回到**施法时**的原位');
    assert.equal(harness.strikes.length, 2, '往返各一发');
    assert.deepEqual(harness.strikes.map((call) => call.damageRate), [1, 1]);
    assert.equal(harness.caster.blinkCloneAt, 13.05, 'L2 分身 0.05 秒后就炸（等价于立即炸）');
    assert.deepEqual([harness.caster.blinkCloneX, harness.caster.blinkCloneY], [0, 0]);
});

test('移形换影：分身爆炸用**留下时的坐标**，不跟着本体跑', () => {
    const harness = blinkHarness(3);
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.caster.blinkCloneAt, 15, 'L3 分身持续 2 秒');
    assert.equal(harness.strikes.length, 2, '此刻只结算了往返两发');

    //  本体自己走开：分身仍然应该在原点炸。
    harness.caster.freeX = 2000;
    harness.tick(15);
    assert.equal(harness.strikes.length, 3, '到点炸一次');
    const burst = harness.strikes[2];
    assert.deepEqual(burst.origin, { x: 0, y: 0 }, '爆炸点 = 留下分身的原位');
    assert.deepEqual([burst.count, burst.damageRate, burst.radius], [6, 1, 50 * 0.3],
        '最多 6 个 / 100% / 半径 50 表值 px');
    assert.equal(harness.caster.blinkCloneAt, undefined, '炸完就清干净');
});

test('移形换影：搜索半径内没有敌人时空闪不消费 CD', () => {
    const harness = blinkHarness(3, false);
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.moves.length, 0, '没目标不动');
    assert.equal(harness.caster.blinkReadyAt, 13, 'CD 不推进，下一帧还能再试');
});

test('移形换影：没配 blinkCooldown 时整段不执行', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68034');
    const enemy = makeUnit(2, ZCOwner.Enemy, 150, '68028');
    const state = makeState([caster, enemy], 1);
    let moved = 0;
    ZCSkillTriggerSystem.tick(state, 0.1, {
        statusSystem: new ZCStatusSystem(),
        runtimeOf: () => ({
            unitId: '68034', skillId: 30710, behaviorKey: 'blink_strike',
            trigger: 'none', stateMode: 'none', parameters: { blinkDamageRate: 1.2 },
        }),
        fireBurst: () => undefined,
        castSecondary: () => false,
        distanceScale: 0.3,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        blinkTo: () => { moved += 1; },
        strike: () => 1,
    });
    assert.equal(moved, 0);
    assert.equal(caster.blinkReadyAt, undefined);
});

// ── 三、移动区域：逐目标递减 ────────────────────────────────────────────────────

test('damageFalloff 槽位仍在：移动区域内每多命中一个目标就再降一半（103405 已不用）', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68034');
    const victims = [1, 2, 3].map((offset) => makeUnit(10 + offset, ZCOwner.Enemy, offset, '68028'));
    const state = makeState([caster, ...victims], 1);
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 30, owner: ZCOwner.Player, sourceUnitId: 1,
        skillId: 30854, skillName: '鹿神守护', effectPrefabPath: null,
        remainingSeconds: 1, wavesLeft: 1, nextWaveAt: 1, waveInterval: 0.15,
        damage: 600, slowRatio: 0, hitUnitIds: [], maxHits: 5, damageFalloff: 0.5,
    };
    state.groundZones.push(zone);

    const dealt = new Map<number, number>();
    state.elapsedSeconds = 1;
    ZCGroundZoneSystem.tick(state, 0.1, {
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        hexStep: 42,
        hexIdAt: () => 0,
        unitsInRadius: () => victims,
        ensureSlowStatus: () => undefined,
        applyStatus: () => undefined,
        exportStatusEffects: () => undefined,
        damageUnit: (target, amount) => {
            dealt.set(target.id, amount);
            const text = { value: amount } as never;
            return text;
        },
    } as never);

    assert.deepEqual([...dealt.values()], [600, 300, 150], '600 → 300 → 150');
    assert.equal(dealt.size, 3);
});

test('blink_strike 已进 SKILL_BEHAVIORS 与运行时注册表', () => {
    const registry = new ZCSkillRuntimeRegistry();
    const runtime = registry.compile({
        legacySkillId: 0, pvpSkillId: 30710, targetUnitId: '68034',
        behaviorKey: 'blink_strike', trigger: 'none', stateMode: 'none', enabled: true,
    } as never, []);
    assert.equal(runtime.behaviorKey, 'blink_strike');
});

// ── 四、鹿神守护的「整段持有视觉」（2026-11-07） ───────────────────────────────
//
// 需求：「在小鹿冲刺的整个阶段都需要循环播放【火法师火船】特效…小鹿冲刺结束后所有特效同步消失」。
// 区域默认是「每波在自己当时的位置推一条 0.15s 的 area 事件」⇒ 移动区域会闪成一串残影，
// 一只小鹿都看不出来。`zoneHoldVisual = 1` 把口径改成「一条长效事件跟着区域走」。

/** 只跑区域系统的最小上下文：不结算伤害，只关心 combatEvents 长什么样。 */
function zoneHarness(options: {
    duration: number;
    speed?: number;
    holdVisual?: boolean;
    maxHits?: number;
    hits?: number;
}) {
    const state = makeState([makeUnit(1, ZCOwner.Player, 0, '68034')], 0);
    const zone: ZCGroundZoneState = {
        x: 0, y: 0, radius: 30, owner: ZCOwner.Player, sourceUnitId: 1,
        skillId: 30854, skillName: '鹿神守护',
        effectPrefabPath: 'units/projectiles/鹿神守护/鹿神守护',
        remainingSeconds: options.duration,
        wavesLeft: Math.max(1, Math.ceil(options.duration / 0.15)),
        nextWaveAt: 0, waveInterval: 0.15,
        damage: 600, slowRatio: 0,
        moveVelocityX: options.speed ?? 42, moveVelocityY: 0,
        hitUnitIds: [], maxHits: options.maxHits ?? 0,
        holdVisual: options.holdVisual ? true : undefined,
    };
    state.groundZones.push(zone);
    //  用来触发「命中名额」的靶子：贴在区域起点（半径 30 之内），由 `unitsInRadius` 每 tick 放一个出来。
    const victims = Array.from({ length: options.hits ?? 0 }, (_, index) => makeUnit(20 + index, ZCOwner.Enemy, 0, '68028'));
    let hex = 0;
    const seenVisualIds = new Set<number>();
    const tick = (dt: number): void => {
        state.elapsedSeconds = Math.round((state.elapsedSeconds + dt) * 1e9) / 1e9;
        state.combatEvents = state.combatEvents.filter((event) => state.elapsedSeconds < event.startedAt + event.durationSeconds);
        hex += 1;
        ZCGroundZoneSystem.tick(state, dt, {
            unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
            hexStep: 42,
            //  每次 tick 换一个格子 ⇒ 每一波都真的“探到”敌人，`hitUnitIds` 才会涨。
            hexIdAt: () => hex,
            unitsInRadius: () => (hex <= (options.hits ?? 0) ? victims.slice(hex - 1, hex) : []),
            ensureSlowStatus: () => undefined,
            applyStatus: () => undefined,
            exportStatusEffects: () => undefined,
            damageUnit: () => ({ value: 0 }) as never,
        } as never);
        for (const visual of state.combatEvents) {
            if (visual.effectPrefabPath) seenVisualIds.add(visual.id);
        }
    };
    const visuals = () => state.combatEvents.filter((event) => event.effectPrefabPath);
    return { state, zone, tick, visuals, seenVisualIds };
}

test('整段持有视觉：一只小鹿跟完全程，不再按波次闪成一串残影', () => {
    const held = zoneHarness({ duration: 2, holdVisual: true });
    //  冲刺进行中（t = 1.0s）看：只有一条，且已经跟到 42 × 1.0 = 42。
    for (let step = 0; step < 10; step += 1) held.tick(0.1);
    assert.equal(held.visuals().length, 1, '2 秒冲刺 + 0.15s 波间隔：有且只有一个视觉事件');
    const visual = held.visuals()[0];
    assert.equal(visual.toX, held.zone.x, '视觉坐标每帧跟着区域走');
    assert.ok(Math.abs(visual.toX - 42) < 1e-6, `1 秒跑到 42，实际 ${visual.toX}`);
    assert.equal(visual.fromX, visual.toX, 'from/to 同点 ⇒ 视图把它当「一片地」而不是一条线');
    assert.equal(visual.type, 'area');
    assert.equal(visual.damage, 0, '纯表现事件不背伤害，免得下游按 damage 重复结算');

    //  同一段时间里老口径（逐波一条）换了多少个 id：这才是「闪」与「一直播」的真正差别 ——
    //  屏上同时挂几条并不说明问题（每条只活 0.15s），换来换去才是残影的来源。
    const strobe = zoneHarness({ duration: 2, holdVisual: false });
    for (let step = 0; step < 10; step += 1) strobe.tick(0.1);
    assert.equal(held.seenVisualIds.size, 1, '整段持有：1 秒内自始至终同一条事件');
    assert.ok(strobe.seenVisualIds.size > 3,
        `老口径（暴风在用）1 秒内换了 ${strobe.seenVisualIds.size} 条，就是要消掉的频闪`);
});

test('整段持有视觉：冲刺结束（到点或打满名额）时视觉事件同步消失', () => {
    //  ① 自然到点
    const expired = zoneHarness({ duration: 0.5, holdVisual: true });
    assert.equal(expired.state.groundZones.length, 1);
    expired.tick(0.3);
    assert.equal(expired.visuals().length, 1, '冲刺进行中一直在');
    expired.tick(0.2);
    expired.tick(0.1);
    assert.equal(expired.state.groundZones.length, 0, '区域到点消散');
    assert.equal(expired.visuals().length, 0, '视觉与区域同一拍消失');

    //  ② 打满命中名额提前散（maxHits = 2，每 tick 放出一个靶子 ⇒ 第 2 拍就打满）
    const saturated = zoneHarness({ duration: 2, speed: 0, holdVisual: true, maxHits: 2, hits: 2 });
    saturated.tick(0.1);
    assert.equal(saturated.state.groundZones.length, 1, '才打中 1 个，还要继续冲');
    assert.equal(saturated.zone.hitUnitIds?.length, 1);
    saturated.tick(0.1);
    assert.equal(saturated.zone.hitUnitIds?.length, 2, '第 2 拍打满 2 个');
    assert.equal(saturated.state.groundZones.length, 0, '命中名额打满 ⇒ 提前散');
    assert.equal(saturated.visuals().length, 0, '提前散也要同拍清掉视觉');
});

test('鹿神守护预制：小鹿在下、火特效在上，火特效是循环 clip', () => {
    const prefab = JSON.parse(readFileSync(
        assetPath('units/projectiles/鹿神守护/鹿神守护.prefab'), 'utf8',
    )) as Array<Record<string, any>>;
    const root = prefab[1];
    assert.equal(root._name, '鹿神守护');
    //  Cocos UI 同层兄弟按 `_children` 顺序绘制 ⇒ 小鹿必须排在前面，火特效在后面才在「上层」。
    const children = (root._children as Array<{ __id__: number }>).map((ref) => prefab[ref.__id__]);
    assert.deepEqual(children.map((node) => node._name), ['spine', 'fx_火船'],
        '顺序反过来火特效就被小鹿盖住了');

    const deer = children[0];
    const deerComponents = (deer._components as Array<{ __id__: number }>).map((ref) => prefab[ref.__id__]);
    const skeleton = deerComponents.find((component) => component.__type__ === 'sp.Skeleton');
    assert.ok(skeleton, '小鹿本体必须是真的 spine（用【魔术师召唤鹿】那份骨骼）');
    assert.equal(skeleton!._skeletonData.__uuid__, 'a9e65251-72eb-4de1-8317-8e934fdf07e8');
    assert.equal(skeleton!.loop, true);
    assert.equal(skeleton!.defaultAnimation, 'idle');

    const fire = children[1];
    //  2026-11-12：火船只在小鹿**提速段**点亮（模型推 `overlayFx`，视图按登记表开关），
    //  所以 prefab 里默认必须是关的 —— 否则慢档赶路的第一帧就会带着一身火。
    assert.equal(fire._active, false, 'fx_火船 默认关：由 `applyOverlayFx` 按阶段打开');
    const fireComponents = (fire._components as Array<{ __id__: number }>).map((ref) => prefab[ref.__id__]);
    const animation = fireComponents.find((component) => component.__type__ === 'cc.Animation');
    assert.ok(animation, '火特效节点必须带 Animation');
    assert.equal(animation!._defaultClip.__uuid__, 'f73e3359-a8ff-40e2-92c6-62893d672d6b',
        '必须是 火法师_火船-loop（wrapMode 2 = Loop），一次性 clip 循环不了整段冲刺');

    //  clip 本身也校验一遍：整段 2 秒要循环，wrapMode 必须真是 Loop。
    const clip = JSON.parse(readFileSync(assetPath(
        'units/projectiles/火法师_火船/anim/火法师_火船-loop.anim'), 'utf8',
    )) as Record<string, any>;
    assert.equal(clip.wrapMode, 2, '2 = cc.WrapMode.Loop');
    assert.ok(Number(clip._duration) < 2, '单次时长必须短于冲刺时长，才谈得上「循环播放」');
});

// ── 五、施法瞬间的「瞬间移动特效」（2026-11-07） ───────────────────────────────
//
// 需求：「魔术师播放【移形换影】在本体位置播放【瞬间移动特效】」。
// 这条特效路径**只在代码里**（行为技能在 `pvpSkill` 里没有造型槽），所以两件事要一起钉：
//   · 触发系统在闪走的同一刻、按**施法前**的本体坐标推一条纯表现事件；
//   · 资源计划把它收进本局加载清单（否则「结算照跑、屏幕上一闪都没有，且不报错」）。

test('移形换影：闪走的一瞬在**本体位置**闪一次「瞬间移动特效」', () => {
    const harness = blinkHarness(3);
    harness.tick(1);
    assert.equal(harness.state.combatEvents.length, 0, 'CD 没到不闪，也不该凭空出特效');

    harness.tick(13);
    const flashes = harness.state.combatEvents
        .filter((event) => event.effectPrefabPath === ZC_BLINK_CAST_EFFECT_PREFAB_PATH);
    assert.equal(flashes.length, 1, '往返（去 + 回）是同一个动作，只闪一次');
    const flash = flashes[0];
    assert.deepEqual([flash.fromX, flash.fromY, flash.toX, flash.toY], [0, 0, 0, 0],
        '落点 = 施法前的本体坐标；先位移再取就成落点了');
    assert.equal(flash.type, 'melee', 'melee 才画在角色层；area 会被插到棋盘层被模型盖住');
    assert.equal(flash.durationSeconds, 0.75, '与 clip 时长一致：18 帧 / 24fps');
    assert.deepEqual([flash.damage, flash.radius], [0, 0], '纯表现事件不背伤害、也不带判定半径');
    assert.equal(flash.startedAt, 13, '与位移同一拍');
    assert.equal(flash.skillId, 30710, '参数并在本卡普攻行上');
    assert.equal(flash.sourceUnitId, harness.caster.id);
});

test('移形换影：没目标（空闪）时一帧特效都不推', () => {
    const harness = blinkHarness(3, false);
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.state.combatEvents.length, 0, '不位移就没有「人没了」这一下');
});

test('瞬间移动特效：单节点 18 帧动画，可见峰值缩到 80px', () => {
    const prefab = JSON.parse(readFileSync(
        assetPath('units/projectiles/瞬间移动特效/瞬间移动特效.prefab'), 'utf8',
    )) as Array<Record<string, any>>;
    const node = prefab[1];
    assert.equal(node._name, '瞬间移动特效');
    assert.equal(node._children.length, 0, '与磁电菇 / 雷弹两件套同构：单节点，动画写在节点自己身上');
    const components = (node._components as Array<{ __id__: number }>).map((ref) => prefab[ref.__id__]);
    assert.ok(components.some((component) => component.__type__ === 'cc.Sprite'));
    assert.ok(components.some((component) => component.__type__ === 'cc.Animation'), '18 帧靠 Animation 播');

    //  80 / 1166（第 15 帧可见峰值，alpha ≥ 8 的 bbox）= 0.06861。
    //  分母取可见内容而不是 1296 的画布（见 `tools/build_blink_fx.py` 文件头）。
    assert.ok(Math.abs(node._lscale.x - 80 / 1166) < 1e-4,
        `烘焙缩放应为 80/1166 ≈ 0.0686，实际 ${node._lscale.x}`);

    const clip = JSON.parse(readFileSync(assetPath(
        'units/projectiles/瞬间移动特效/anim/瞬间移动特效.anim'), 'utf8',
    )) as Record<string, any>;
    const track = clip._tracks[0];
    const curve = track._channel._curve;
    assert.equal(curve._values.length, 18, '18 帧一张不少');
    assert.equal(curve._times.length, 18);
    assert.equal(clip.wrapMode, 1, '1 = Normal：一次性特效播完停末帧，不能 loop');
    assert.equal(clip.sample, 24);
    assert.equal(clip._duration, 0.75, '帧数 / sample，两者必须成对改');
    assert.ok(Math.abs(curve._times[17] - 17 / 24) < 1e-6, '键时刻 = i / sample');
});

test('瞬间移动特效进本局特效清单：只有带 blink_strike 计划的单位才收', () => {
    const unit = (unitId: string) => ({
        unitId,
        prefabPath: `units/probe/${unitId}`,
        attackProfile: { effectPrefabPath: `units/projectiles/${unitId}_普攻/${unitId}_普攻` },
    });
    const adapters = {
        skillPlans: [
            { enabled: true, unitId: '68034', behaviorKey: 'blink_strike' },
            { enabled: false, unitId: '68099', behaviorKey: 'blink_strike' },
            { enabled: true, unitId: '68028', behaviorKey: 'random_strike' },
        ],
        textOverrides: new Map(),
    };
    const withBlink = buildZCVisualResourcePlan([unit('68034'), unit('68028')] as never, adapters as never);
    assert.ok(withBlink.effectPaths.includes(ZC_BLINK_CAST_EFFECT_PREFAB_PATH),
        '有移形换影的局必须加载这张图，否则技能结算了但一次都不闪');

    const withoutBlink = buildZCVisualResourcePlan([unit('68028')] as never, adapters as never);
    assert.equal(withoutBlink.effectPaths.includes(ZC_BLINK_CAST_EFFECT_PREFAB_PATH), false,
        '没带这条行为的兵不该吃这份加载（18 帧 1296×1228 的图不小）');
    assert.equal(withoutBlink.effectPaths.includes('units/projectiles/68099_普攻/68099_普攻'), false,
        'enabled=false 的计划不参与');
});

test('鹿神守护：小鹿 + 火船的整体倍率 = 100/685（画布高 685 落到 100px）', () => {
    //  `lu.skel` 的 canvas 是 657 × 685（二进制头大端读出：x=-236.2 / y=-6.15 / w=657 / h=685），
    //  sp.Skeleton 只按 canvas 渲染、prefab 上的 UITransform 不参与（与 `ZCUnitView` 同一结论），
    //  所以宿上倍率原来是 1 时屏上就是 ~657×685 —— 比一个兵（可见高 67px）大近十倍。
    const scale = zcCombatEffectNodeScaleOf('units/projectiles/鹿神守护/鹿神守护');
    assert.ok(Math.abs(scale - 100 / 685) < 1e-12, `应为 100/685，实际 ${scale}`);
    assert.ok(Math.abs(685 * scale - 100) < 1e-9, '画布高正好落到 100px');
    //  没登记的特效必须仍是 1（默认「美术原样」），否则会静默改掉一堆别人家的尺寸。
    assert.equal(zcCombatEffectNodeScaleOf('units/projectiles/雷弹命中/雷弹命中'), 1);
});

// ── 六、鹿神守护：先走近、再冲刺（2026-11-07 需求 1/2） ─────────────────────────
//
// 需求原话：
//   1. 小鹿初始位置在魔术师**前进方向**、距离魔术师 30px 的位置；
//   2. 生成后先以 70px 速度移动并播对应的移动动画，接近攻击目标 200px 再播冲刺。
//
// 两件事分开钉：① 出生点与参数接线走**真**的 `sendAttack`（配表值 → 世界 px）；
// ② 两段式切换走区域系统（`move` → `attack`、接近段不扣时长不结算）。

/** 用真实配表参数驱动一次「强化那一击」，断言落下来的区域长什么样。 */
function deerZoneHarness(options: { level?: number; targetX?: number; facing?: number } = {}) {
    const level = options.level ?? 1;
    const caster = makeUnit(1, ZCOwner.Player, 0, '68034');
    caster.facingRadians = options.facing ?? 0;
    const target = makeUnit(2, ZCOwner.Enemy, options.targetX ?? 300, '68028');
    const state = makeState([caster, target], 0);
    const params = paramsOf(103405, level);
    const base = {
        skillId: 30710, name: '魔术师普攻', mode: ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 1, empoweredSkillId: 30854,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } as unknown as ZCAttackProfile;
    //  强化那一击的技能行：`pvpSkill 30854` 的真实形状（area / 半径 50 / 2 秒 1 波）。
    const ultimate = {
        ...base, skillId: 30854, name: '鹿神守护', mode: ZCCombatEventType.Area,
        areaRadius: 50, durationSeconds: 2, waves: 1,
        effectPrefabPath: 'units/projectiles/鹿神守护/鹿神守护',
    } as unknown as ZCAttackProfile;
    const definition = {
        unitId: '68034', name: '魔术师', maxHp: 600, attack: 120,
        moveSpeed: 25, attackRange: 550, attackInterval: 1.8, attackDuration: 1.333,
        attackHitTime: 0.533, bodyRadius: 24, spawnSeconds: 0,
        flying: false, canAttackAir: true, hero: true,
        prefabPath: 'skel/哈利波特/哈利波特', prefabSize: 0.85,
        attackProfile: base, empoweredProfile: ultimate,
    } as unknown as ZCUnitDefinition;
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68034', skillId: 30710, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none', parameters: params,
    };
    const targetRef = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null,
    };
    const context = {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0 },
        statusSystem: { statModsOf: () => ({}) },
        geometry: { hexIdAt: () => null },
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        counters: [],
        cards: { player: new Map(), enemy: new Map(), enemy2: new Map(), enemy3: new Map() },
        //  与 `sendAttack` 同一取键口径：运行时挂在**普攻行**上（`unitId:profile.skillId`）。
        skillRuntime: {
            player: new Map([['68034:30710', runtime]]),
            enemy: new Map(), enemy2: new Map(), enemy3: new Map(),
        },
        statPatches: { player: new Map(), enemy: new Map(), enemy2: new Map(), enemy3: new Map() },
        deckBonuses: {
            player: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1 },
            enemy: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1 },
            enemy2: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1 },
            enemy3: { activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1 },
        },
        unitById: new Map([[caster.id, caster], [target.id, target]]),
        currentTarget: () => targetRef,
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0 }),
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
    };
    return { state, caster, target, params, attack: () => ZCAttackResolutionSystem.sendAttack(state, caster, context as never) };
}

test('鹿神守护：小鹿落在魔术师**前进方向** 15px（表值）处，不是目标处', () => {
    const harness = deerZoneHarness({ level: 1, targetX: 300, facing: 0 });
    harness.attack();
    assert.equal(harness.state.groundZones.length, 1);
    const zone = harness.state.groundZones[0];
    //  朝向 0（朝右）⇒ 前移 15 表值 px × 0.3 = 4.5 世界 px。
    assert.ok(Math.abs(zone.x - 4.5) < 1e-9, `应落在 x=4.5，实际 ${zone.x}`);
    assert.ok(Math.abs(zone.y) < 1e-9);

    //  换朝向验证「沿着 facing 走」：朝上（-90°）⇒ 落点 (0, -4.5)，不是朝目标偏。
    const up = deerZoneHarness({ level: 1, targetX: 300, facing: -Math.PI / 2 });
    up.attack();
    assert.ok(Math.abs(up.state.groundZones[0].x) < 1e-9, '朝上时 x 不该动');
    assert.ok(Math.abs(up.state.groundZones[0].y + 4.5) < 1e-9,
        `朝上时 y 应为 -4.5，实际 ${up.state.groundZones[0].y}`);
});

test('鹿神守护：三档参数接线（出生 15 / 慢档 70 / 提速 200 / 快档 140，全部 ×0.3）', () => {
    for (const level of [1, 2, 3]) {
        const harness = deerZoneHarness({ level });
        harness.attack();
        const zone = harness.state.groundZones[0];
        assert.deepEqual(
            [zone.approachSpeed, zone.sprintRange, zone.sprintSpeed, zone.sprinting],
            [70 * 0.3, 200 * 0.3, 140 * 0.3, false],
            `L${level}：慢档 21 / 提速 60 / 快档 42（世界 px/s），且刚出生时还没提速`,
        );
        assert.equal(zone.approachTargetId, harness.target.id, '追的就是这一击的攻击目标');
        assert.equal(zone.maxHits, 1, '接触任意目标就消失 ⇒ 命中名额只有 1');
        assert.equal(zone.damageFalloff, undefined, '不再有「每多一个目标 −50%」');
        //  快档的第一波不能提前打：出生这一拍 `nextWaveAt` 已经到点，但仍在慢档。
        assert.equal(zone.remainingSeconds, 2, '快档 2 秒还没开始读秒');
    }
});

test('鹿神守护：慢档按 70px/s 追、不结算；进入 200px 才提速并换动画 / 点亮火船', () => {
    //  世界坐标：小鹿在 x=9，目标在 x=200 ⇒ 相距 191 > 60（200 表值 px），要先走。
    const caster = makeUnit(1, ZCOwner.Player, 9, '68034');
    const target = makeUnit(2, ZCOwner.Enemy, 200, '68028');
    const state = makeState([caster, target], 0);
    const zone: ZCGroundZoneState = {
        x: 9, y: 0, radius: 15, owner: ZCOwner.Player, sourceUnitId: 1,
        skillId: 30854, skillName: '鹿神守护',
        effectPrefabPath: 'units/projectiles/鹿神守护/鹿神守护',
        remainingSeconds: 2, wavesLeft: 14, nextWaveAt: 0, waveInterval: 0.15,
        damage: 600, slowRatio: 0, hitUnitIds: [], maxHits: 1,
        holdVisual: true,
        approachSpeed: 21, approachTargetId: target.id, sprintRange: 60, sprintSpeed: 42,
        sprinting: false,
    };
    state.groundZones.push(zone);
    let waves = 0;
    const units = new Map([[caster.id, caster], [target.id, target]]);
    const tick = (dt: number): void => {
        state.elapsedSeconds = Math.round((state.elapsedSeconds + dt) * 1e9) / 1e9;
        state.combatEvents = state.combatEvents.filter(
            (event) => state.elapsedSeconds < event.startedAt + event.durationSeconds);
        ZCGroundZoneSystem.tick(state, dt, {
            unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
            unitById: (id: number) => units.get(id),
            hexStep: 42,
            hexIdAt: () => 1,
            unitsInRadius: () => [target],
            ensureSlowStatus: () => undefined,
            applyStatus: () => undefined,
            exportStatusEffects: () => undefined,
            damageUnit: () => { waves += 1; return { value: 0 } as never; },
        } as never);
    };

    //  ① 慢档：1 秒走 21。位置在涨、时长不动、一次都不打。
    tick(1);
    assert.ok(Math.abs(zone.x - 30) < 1e-6, `1 秒后应走到 30，实际 ${zone.x}`);
    assert.equal(zone.remainingSeconds, 2, '慢档不扣快档时长');
    assert.equal(waves, 0, '慢档不结算任何一波');
    assert.equal(zone.sprinting, false);
    assert.equal(zone.visualAnimation, 'move', '慢档播 move（骨架里的走路段，没有 walk）');

    //  ② 表现事件跟着走，而且时长被续住（初始只有「快档 2 秒」，走 4 秒就没了会半路消失）。
    const visual = state.combatEvents.find((event) => event.effectPrefabPath);
    assert.ok(visual, '整段持有视觉还在');
    assert.equal(visual!.toX, zone.x, '视觉坐标跟着区域');
    assert.equal(visual!.spineAnimation, 'move');
    assert.equal(visual!.overlayFx, undefined, '慢档身上不点火船');
    const bornDuration = visual!.durationSeconds;
    tick(0.5);
    assert.ok(visual!.durationSeconds > bornDuration,
        `慢档每帧要把事件续长，${bornDuration} → ${visual!.durationSeconds}`);

    //  ③ 一直走到进入 60 世界 px（目标 200 ⇒ 小鹿约 140 时提速）。
    let switchedAt = 0;
    for (let step = 0; step < 60 && !zone.sprinting; step += 1) {
        tick(0.15);
        if (zone.sprinting) switchedAt = zone.x;
    }
    assert.equal(zone.sprinting, true, '进入 200 表值 px 就提速');
    assert.ok(200 - switchedAt <= 60,
        `提速必须发生在「距目标 ≤ 200 表值 px」之内，实际还差 ${200 - switchedAt}`);
    assert.ok(switchedAt > 130, `提速点不能提前太多，实际 ${switchedAt}`);
    assert.deepEqual(
        [zone.moveVelocityX, zone.moveVelocityY, zone.visualAnimation],
        [42, 0, 'attack'], '快档速度换成 140 表值 px/s，动画换 attack',
    );
    const sprintVisual = state.combatEvents.find((event) => event.effectPrefabPath);
    assert.equal(sprintVisual!.spineAnimation, 'attack', '事件上的动画名也要跟着换');
    assert.equal(sprintVisual!.overlayFx, true, '提速段才在小鹿身上点起火船');

    //  ④ 快档才开始结算：贴上去那一下必须真的打到人（半径 15 世界 px，要先贴上）。
    assert.equal(waves, 0, '提速那一拍离目标还有 58 世界 px，够不着');
    for (let step = 0; step < 20 && waves === 0; step += 1) tick(0.15);
    assert.ok(waves > 0, '快档撞到目标后必须造成伤害');
    assert.equal(zone.remainingSeconds < 2, true, '快档时长从提速那一刻开始读秒');
});

// ── 七、鹿神守护改成「会追踪目标的子弹」（2026-11-12） ─────────────────────────
//
// 需求原话：「小鹿应该是类似子弹一样的效果，只是一个会追踪目标的子弹……当原目标死亡后，
// 小鹿会转向新目标，接触到任意目标后造成伤害，子弹消失」。
//
// 三条新行为各自钉一颗钉子：换目标 / 接触即消失 / 没有目标也别卡死。

/**
 * 只跑区域系统的最小上下文（世界 px）：小鹿一个、敌人若干，`unitById` 与 `unitsInRadius` 都给真的。
 *
 * `unitsInRadius` 直接返回全部敌人 —— 它在本系统里只是**粗筛**，真正的形状由
 * `zcGroundZoneReaches` 按 `radius` 收口，所以这里放宽不会让判定变松。
 */
function chaseHarness(startX: number, enemies: ZCUnitState[]) {
    const deer = makeUnit(1, ZCOwner.Player, startX, '68034');
    const state = makeState([deer, ...enemies], 0);
    const byId = new Map(state.units.map((unit) => [unit.id, unit]));
    const zone: ZCGroundZoneState = {
        x: startX, y: 0, radius: 15, owner: ZCOwner.Player, sourceUnitId: 1,
        skillId: 30854, skillName: '鹿神守护',
        effectPrefabPath: 'units/projectiles/鹿神守护/鹿神守护',
        remainingSeconds: 2, wavesLeft: 14, nextWaveAt: 0, waveInterval: 0.15,
        damage: 600, slowRatio: 0, hitUnitIds: [], maxHits: 1,
        holdVisual: true,
        approachSpeed: 21, approachTargetId: enemies[0]?.id, sprintRange: 60, sprintSpeed: 42,
        sprinting: false,
    };
    state.groundZones.push(zone);
    const damaged: number[] = [];
    const tick = (dt: number): void => {
        state.elapsedSeconds = Math.round((state.elapsedSeconds + dt) * 1e9) / 1e9;
        state.combatEvents = state.combatEvents.filter(
            (event) => state.elapsedSeconds < event.startedAt + event.durationSeconds);
        ZCGroundZoneSystem.tick(state, dt, {
            unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
            unitById: (id: number) => byId.get(id),
            hexStep: 42,
            hexIdAt: () => 0,
            unitsInRadius: () => state.units.filter((unit) => unit.owner !== ZCOwner.Player),
            ensureSlowStatus: () => undefined,
            applyStatus: () => undefined,
            exportStatusEffects: () => undefined,
            damageUnit: (target: ZCUnitState) => { damaged.push(target.id); return { value: 0 } as never; },
        } as never);
    };
    return { state, zone, tick, damaged, deer };
}

test('鹿神守护：原目标阵亡后**改追最近的敌人**，不是朝原方向撞出去', () => {
    //  小鹿在 x=9；一号目标在 x=300（正右方），二号敌人在 (9, 200)（正上方，也在搜索半径内）。
    const first = makeUnit(2, ZCOwner.Enemy, 300, '68028');
    const second = makeUnit(3, ZCOwner.Enemy, 9, '68028');
    second.freeY = 200;
    const harness = chaseHarness(9, [first, second]);

    //  ① 先朝一号目标走：x 涨、y 不动。
    harness.tick(0.5);
    assert.ok(harness.zone.x > 9, '慢档朝目标前进');
    assert.ok(Math.abs(harness.zone.y) < 1e-9, '此时还不该有纵向位移');
    assert.equal(harness.zone.approachTargetId, first.id);

    //  ② 一号目标倒下 ⇒ 下一拍改追二号，方向立刻拐上去。
    first.hp = 0;
    first.battleState = 'dead';
    const beforeX = harness.zone.x;
    harness.tick(0.5);
    assert.equal(harness.zone.approachTargetId, second.id, '必须换成最近的活敌人');
    assert.ok(harness.zone.y > 0, `要朝新目标拐上来，实际 y=${harness.zone.y}`);
    assert.ok(harness.zone.x < beforeX + 1e-9, '旧方向的推进要停，不能继续往右飞');

    //  ③ 慢档/快档都跟着转：再跑一段，全程都在缩小与二号目标的距离。
    let last = Math.hypot(harness.zone.x - second.freeX, harness.zone.y - second.freeY);
    for (let step = 0; step < 6; step += 1) {
        harness.tick(0.15);
        const now = Math.hypot(harness.zone.x - second.freeX, harness.zone.y - second.freeY);
        assert.ok(now < last, `第 ${step} 拍必须还在逼近新目标（${last} → ${now}）`);
        last = now;
    }
});

test('鹿神守护：接触到任意目标后造成一次伤害就消失（不再多次结算 / 不再递减）', () => {
    //  目标贴在 11 世界 px 处（半径 15 之内）⇒ 第一拍就提速并接触。
    const victim = makeUnit(2, ZCOwner.Enemy, 20, '68028');
    const harness = chaseHarness(9, [victim]);
    harness.tick(0.1);

    assert.deepEqual(harness.damaged, [victim.id], '只打一发，且打的就是碰到的那个');
    assert.equal(harness.state.groundZones.length, 0, '子弹碰到目标立刻消失');
    assert.equal(harness.state.combatEvents.filter((event) => event.effectPrefabPath).length, 0,
        '小鹿的表现事件与区域同一拍摘掉（不会留个残影在原地）');

    //  再跑几拍也不能「复活」二次结算。
    harness.tick(0.5);
    harness.tick(0.5);
    assert.equal(harness.damaged.length, 1, '消失后不许再结算');
});

test('鹿神守护：场上一个活敌人都没有时，按原方向提速飞完 2 秒兜底散场（不卡在慢档）', () => {
    const dead = makeUnit(2, ZCOwner.Enemy, 300, '68028');
    dead.hp = 0;
    dead.battleState = 'dead';
    const harness = chaseHarness(9, [dead]);
    harness.tick(0.1);
    //  出生时带的目标已经死了 ⇒ 找不到替代 ⇒ 直接提速，朝原速度方向（+x）飞。
    assert.equal(harness.zone.sprinting, true, '没有目标也要进快档读秒，否则永远不会消失');
    assert.equal(harness.zone.approachTargetId, undefined);
    assert.ok(harness.zone.moveVelocityX > 0, '朝原方向（+x）继续飞');
    for (let step = 0; step < 3; step += 1) harness.tick(1);
    assert.equal(harness.state.groundZones.length, 0, '2 秒兜底到点必须散场');
});

test('鹿神守护：叠层节点按登记表开关（火船 = fx_火船，其他特效一律不碰）', () => {
    assert.equal(zcCombatEffectOverlayChild('units/projectiles/鹿神守护/鹿神守护'), 'fx_火船');
    assert.equal(zcCombatEffectOverlayChild('units/projectiles/雷弹命中/雷弹命中'), null,
        '没登记的特效视图一次都不许碰 `active`');
    assert.equal(zcCombatEffectOverlayChild(null), null);

    //  登记的名字必须真在 prefab 的**根节点直下**（视图用 `visualNode.getChildByName` 找）。
    const prefab = JSON.parse(readFileSync(
        assetPath('units/projectiles/鹿神守护/鹿神守护.prefab'), 'utf8',
    )) as Array<Record<string, any>>;
    const rootChildren = (prefab[1]._children as Array<{ __id__: number }>)
        .map((ref) => String(prefab[ref.__id__]._name));
    assert.ok(rootChildren.includes(zcCombatEffectOverlayChild('units/projectiles/鹿神守护/鹿神守护')!),
        `fx_火船 必须挂在根节点下，实际 ${rootChildren.join(' / ')}`);
});

//  ⚠️ 与上面「三档参数接线」重复了一部分：那一条挂在 `prepare()` 后面，而 `prepare()` 现在
//  因为 `config/maps/standard.json` 缺失（本仓库只有 standard_3 / standard_4）直接抛错，
//  断言根本跑不到。这里直接读 `remoteRef` 再钉一遍，保证「追踪弹参数」这组真值有人守。
test('鹿神守护：三档参数真值（绕开地图配置，直接读 remoteRef）', () => {
    for (const level of [1, 2, 3]) {
        const params = paramsOf(103405, level);
        assert.deepEqual(
            [params.zoneSpawnForward, params.zoneApproachSpeed, params.zoneSprintRange, params.zoneMoveSpeed],
            [15, 70, 200, 140],
            `L${level}：身前 15px 生成 / 慢档 70 / 距目标 200 提速 / 快档 140`,
        );
        assert.equal(params.zoneMaxHits, 1, '接触任意目标即消失');
        assert.equal(params.zoneDamageFalloff, undefined, '不再有「每多一个目标 −50%」');
        assert.equal(params.zoneHoldVisual, 1, '整段持有一条跟随视觉');
    }
});
