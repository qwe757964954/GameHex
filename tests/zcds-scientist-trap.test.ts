/**
 * 科学家（68035）「精密陷阱」103504（2026-11-12）：
 *
 * 设计案第 175 行原文：
 *   「在原地坐标留下一个持续时间为15/18/23秒的陷阱，目标触碰到该陷阱会收到1次伤害
 *     200%/250%/300%，陷阱会爆炸范围100px圆形，造成1次额外的伤害，爆炸范围内所有敌人
 *     受到均等伤害 180%/220%/280%，陷阱达到指定的秒数后也会主动爆炸」
 *
 * 表里这三行原来是「轨道打击」的占位（`{"damageRate":2.0}` + `statusId=stun_*`），
 * 本轮换掉并补了代码车道，下面每一条都是「换了以后不许退回去」的钉子：
 *
 *  1. 配表：`behaviorKey=trap_place` / `statusId` 清空 / 七个参数逐档（15·18·23、200·250·300、180·220·280）；
 *  2. 🔴 `trap_place` 必须**双登记** + 进资源计划 —— 漏了不报错，只是屏幕上一个像素都没有；
 *  3. 放置点 = **脚下**（`trapForward` 缺省 0），不是锁定目标身上；
 *  4. 触碰 = **两笔**（触碰那一下 + 立刻引爆），爆炸对范围内**所有**敌人**均等**、不递减；
 *  5. 没人踩也会到点自爆；
 *  6. 常驻光环推后 0.4s 出场（`visualDelaySeconds` 与生成动画同源），否则两段美术双影；
 *  7. 冷却到点就放，**不看**普攻射程闸门；被拒（参数不全）不消费 CD。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { ZCGroundZoneSystem } from '../assets/script/app/zcds/model/systems/ZCGroundZoneSystem';
import { ZCAttackResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import {
    ZC_TRAP_BEHAVIOR_KEY, ZC_TRAP_EXPIRE_PREFAB_PATH, ZC_TRAP_EXPIRE_SECONDS,
    ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_SPAWN_PREFAB_PATH, ZC_TRAP_SPAWN_SECONDS, zcTrapEffectPath,
} from '../assets/script/app/zcds/model/ZCTrapFx';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';

// ────────────────────────────────────────────── 夹具

const ROOT = join(__dirname, '..');
const UNIT_ID = '68035';
const CHAIN = 103504;
const BUNDLE = join(ROOT, 'assets', 'bundles', 'battle', 'units', 'projectiles');

/** 表值口径（设计案 J/N 列 + 本轮落地参数），三档只有三个数字变。 */
const TRAP_PARAMS = {
    trapCooldown: 10, trapDuration: 15, trapRadius: 50,
    trapDamageRate: 2, trapExplodeRadius: 100, trapExplodeDamageRate: 1.8, trapForward: 0,
};

/** `assets/remoteRef/*.json` 是列存 `{k, v}`，转表产物是行数组 —— 两种都认。 */
function readTable(name: string): Array<Record<string, unknown>> {
    const packed = JSON.parse(readFileSync(join(ROOT, 'assets', 'remoteRef', `${name}.json`), 'utf8'));
    if (Array.isArray(packed)) return packed as Array<Record<string, unknown>>;
    const keys = packed.k as string[];
    return (packed.v as unknown[][]).map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
}

function readClientTable(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(join(ROOT, '..', 'doc', '塔防数据配置', 'json', 'client', `${name}.json`), 'utf8'));
}

function unit(id: number, owner: ZCOwner, overrides: Partial<ZCUnitState> = {}): ZCUnitState {
    return {
        id, unitId: owner === 'player' ? UNIT_ID : '68001', owner, cardId: '68035', tier: 1,
        sourceHexId: id, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: 0, freeY: 0, completedAttackCount: 0,
        ...overrides,
    } as ZCUnitState;
}

function snapshot(units: ZCUnitState[], elapsedSeconds = 0): ZCSnapshot {
    return {
        version: 4, elapsedSeconds, nextCombatEventId: 1,
        units, projectiles: [], groundZones: [], combatEvents: [], hexes: {},
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

/** 面板攻击 30：触碰 30×2.0=60、爆炸 30×1.8=54 —— 数字好认，算错一眼能看出来。 */
function trapContext(caster: ZCUnitState, params: Record<string, number>) {
    const definition = {
        unitId: UNIT_ID, name: '科学家', maxHp: 800, attack: 30, moveSpeed: 40,
        attackRange: 550, attackInterval: 1.6, attackDuration: 0.5, attackHitTime: 0.2,
        bodyRadius: 26, spawnSeconds: 0, flying: false, canAttackAir: false, hero: true,
        prefabPath: 'units/units/科学家', prefabSize: 1,
        attackProfile: { skillId: 30709, name: '能量射线', mode: 'projectile' },
    };
    return {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0.16, counterDamageMultiplier: 1.3 },
        counters: [],
        cards: { [ZCOwner.Player]: new Map(), [ZCOwner.Enemy]: new Map() },
        deckBonuses: {
            [ZCOwner.Player]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
            [ZCOwner.Enemy]: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1, moveSpeedMultiplier: 1,
                towerAttackMultiplier: 1, incomeBonus: 0, spawnIntervalMultiplier: 1,
            },
        },
        statPatches: { [ZCOwner.Player]: new Map([[UNIT_ID, {}]]), [ZCOwner.Enemy]: new Map() },
        skillRuntime: {
            [ZCOwner.Player]: new Map([[`${UNIT_ID}:30709`, { parameters: params }]]),
            [ZCOwner.Enemy]: new Map(),
        },
        unitById: new Map([[caster.id, caster]]),
        statusSystem: { statModsOf: () => ({}), controlOf: () => null },
        geometry: { hexIdAt: () => 0 },
        random: () => 1,
        effectiveDefinition: () => definition,
        unitPosition: (item: ZCUnitState) => ({ x: item.freeX, y: item.freeY }),
        //  「原地坐标」⇒ 陷阱不挑目标；这里给一个远处的目标，只为验证落点**不跟着它跑**。
        currentTarget: () => ({ kind: 'unit', id: 99, x: 900, y: 900, bodyRadius: 24, cardId: '68001' }),
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false }),
        applyLegacySelfBuffs: () => [],
        damageUnit: () => null,
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => {},
    } as unknown as Parameters<typeof ZCAttackResolutionSystem.castTrap>[2];
}

/** 区域 tick 的最小上下文（与 `tests/zcds-magdi-mushroom.test.ts` 同一套收窄手法）。 */
function zoneContext(targets: ZCUnitState[], overrides: Record<string, unknown> = {}) {
    return {
        hexIdAt: () => 0,
        unitsInRadius: () => targets,
        unitPosition: (item: ZCUnitState) => ({ x: item.freeX, y: item.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => { target.hp -= damage; return null; },
        lifestealFromHit: () => {},
        applyStatus: () => {},
        ensureSlowStatus: () => {},
        exportStatusEffects: () => undefined,
        hexStep: 1,
        random: () => 0.99,
        ...overrides,
    } as unknown as Parameters<typeof ZCGroundZoneSystem.tick>[2];
}

/** 陷阱区域夹具（与 `castTrap` 产出同形，省掉每次都要先摆一个施法者）。 */
function trapZone(overrides: Record<string, unknown> = {}) {
    return {
        x: 0, y: 0, radius: 30, owner: 'player' as ZCOwner, sourceUnitId: 1,
        skillId: 30709, skillName: '能量射线',
        effectPrefabPath: ZC_TRAP_IDLE_PREFAB_PATH, holdVisual: true,
        visualDelaySeconds: ZC_TRAP_SPAWN_SECONDS,
        remainingSeconds: 15, wavesLeft: 0, nextWaveAt: 15, waveInterval: 15, damage: 0,
        slowRatio: 0, floatTextKind: 'damage',
        contactRadius: 15, contactDamage: 60,
        expireDamage: 54, expirePrefabPath: ZC_TRAP_EXPIRE_PREFAB_PATH,
        expireFxSeconds: ZC_TRAP_EXPIRE_SECONDS,
        ...overrides,
    } as never;
}

function closeTo(actual: number, expected: number, message?: string): void {
    assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≠ ${expected}`);
}

// ────────────────────────────────────────────── 一、配表守卫

test('103504 三行 = 精密陷阱 / trap_place / 七个参数逐档对齐设计案', () => {
    for (const rows of [readTable('pvpSkillPlan'), readClientTable('pvpSkillPlan')]) {
        const trap = rows.filter((row) => String(row.unitId) === UNIT_ID && Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(trap.length, 3, '103504 必须三档俱全');
        assert.deepEqual(trap.map((row) => Number(row.unlockHeroLevel)), [1, 20, 25]);
        for (const row of trap) {
            assert.equal(row.skillName, '精密陷阱');
            assert.equal(row.behaviorKey, ZC_TRAP_BEHAVIOR_KEY);
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(row.triggerEvent, 'active');
            //  旧占位「轨道打击」的眩晕必须彻底清掉：陷阱不控人，留着就会白送 1~2 秒硬控
            assert.equal(row.statusId ?? null, null, '陷阱不该挂 stun_*');
            assert.equal(Number(row.enabled), 1);
        }
        //  存活秒数 15/18/23、触碰 200/250/300、爆炸 180/220/280 —— 逐档抄设计案
        assert.deepEqual(
            trap.map((row) => JSON.parse(String(row.skillParamJson)).trapDuration), [15, 18, 23]);
        assert.deepEqual(
            trap.map((row) => JSON.parse(String(row.skillParamJson)).trapDamageRate), [2, 2.5, 3]);
        assert.deepEqual(
            trap.map((row) => JSON.parse(String(row.skillParamJson)).trapExplodeDamageRate), [1.8, 2.2, 2.8]);
        for (const row of trap) {
            const params = JSON.parse(String(row.skillParamJson));
            assert.equal(params.trapCooldown, 10, '设计案 J 列 = 10');
            assert.equal(params.trapRadius, 50, '触碰半径 = idle 序列帧的屏上直径 76.9px 反算');
            assert.equal(params.trapExplodeRadius, 100, '设计案「爆炸范围100px圆形」');
            assert.equal(params.trapForward, 0, '「原地坐标」⇒ 落在脚下，不往前丢');
        }
    }
});

test('103504 的两份产物逐格一致（remoteRef 列存 / 转表行数组）', () => {
    const pick = (rows: Array<Record<string, unknown>>) => rows
        .filter((row) => String(row.unitId) === UNIT_ID && Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    const packed = pick(readTable('pvpSkillPlan'));
    const client = pick(readClientTable('pvpSkillPlan'));
    assert.equal(client.length, packed.length);
    for (let index = 0; index < packed.length; index += 1) {
        for (const field of ['modifierId', 'skillName', 'behaviorKey', 'triggerEvent', 'statusId', 'skillParamJson', 'desc']) {
            assert.deepEqual(client[index][field] ?? null, packed[index][field] ?? null,
                `L${packed[index].skillLevel}.${field} 两份产物不一致`);
        }
    }
});

test('K 表：三档名字都是精密陷阱，卡面描述与技能案逐字相同', () => {
    const plans = readTable('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    const cards = readTable('armySkillLevelUp')
        .filter((row) => Number(row.id) === CHAIN)
        .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
    assert.equal(cards.length, 3);
    for (const row of cards) {
        assert.equal(row.name, '精密陷阱');
        assert.ok(String(row.desc).includes('冷却 10 秒'), '卡面第一句要写清多久放一次');
        assert.ok(String(row.desc).includes('均等'), '「均等伤害」是这个技能的辨识点，不能省');
        const plan = plans.find((item) => Number(item.skillLevel) === Number(row.skilllevel));
        assert.equal(row.desc, plan!.desc, '卡片与技能案必须同一句，否则两个人看到两种说法');
    }
});

// ────────────────────────────────────────────── 二、登记：白名单 + 运行时 + 资源计划

test('trap_place 必须双登记（行为白名单 + 运行时），漏了就是静默不跑', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'ZCStatSchema.ts'), 'utf8');
    assert.match(schemaSource, /SKILL_BEHAVIORS = new Set\(\[[\s\S]*?'trap_place'[\s\S]*?\]\)/,
        'ZCStatSchema.SKILL_BEHAVIORS 缺 trap_place ⇒ 读表阶段直接抛「未注册 behaviorKey」');
    const runtimeSource = readFileSync(join(ROOT, 'assets', 'script', 'app', 'zcds', 'model', 'ZCSkillRuntime.ts'), 'utf8');
    assert.match(runtimeSource, /register\('trap_place'/,
        'ZCSkillRuntime 没注册 trap_place ⇒ 参数永远进不了运行时');
    assert.equal(zcTrapEffectPath('trap_place'), ZC_TRAP_IDLE_PREFAB_PATH);
    assert.equal(zcTrapEffectPath('skill_params'), null, '不是陷阱就一个资源都不插');
});

test('三个预制体都要进本局加载清单，别的技能一个都不多收', () => {
    //  与无尘禁土 / 五雷轰顶同一条坑：路径只写在代码里，漏收 ⇒ `ZCGameLoader` 不加载
    //  ⇒ 技能照常结算、屏幕一次都不亮，而且一条错都不报。
    const visualUnit = (unitId: string) => ({
        unitId,
        prefabPath: `units/${unitId}/${unitId}`,
        attackProfile: { effectPrefabPath: `units/projectiles/${unitId}_普攻/${unitId}_普攻` },
    });
    const plan = buildZCVisualResourcePlan(
        [visualUnit(UNIT_ID), visualUnit('68016')] as never,
        {
            skillPlans: [
                { enabled: true, unitId: UNIT_ID, behaviorKey: ZC_TRAP_BEHAVIOR_KEY },
                { enabled: true, unitId: '68016', behaviorKey: 'bolt_strike' },
            ],
            textOverrides: new Map(),
        } as never);
    for (const path of [ZC_TRAP_SPAWN_PREFAB_PATH, ZC_TRAP_IDLE_PREFAB_PATH, ZC_TRAP_EXPIRE_PREFAB_PATH]) {
        assert.ok(plan.effectPaths.includes(path), `${path} 没被收进加载清单`);
    }
    //  没登记 trap_place 的卡不许白白加载这三个（资源是要预热的，多收就是多等）
    const bare = buildZCVisualResourcePlan(
        [visualUnit(UNIT_ID)] as never,
        {
            skillPlans: [{ enabled: true, unitId: UNIT_ID, behaviorKey: 'skill_params' }],
            textOverrides: new Map(),
        } as never);
    assert.ok(!bare.effectPaths.includes(ZC_TRAP_IDLE_PREFAB_PATH));
});

test('预制体三件套在盘上：start / 爆炸一次性、idle 循环', () => {
    const readAnim = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const spawnAnim = readAnim(join(BUNDLE, '科学家_陷阱', 'anim', '科学家_陷阱-出现.anim'));
    const idleAnim = readAnim(join(BUNDLE, '科学家_陷阱', 'anim', '科学家_陷阱-idle.anim'));
    const expireAnim = readAnim(join(BUNDLE, '科学家_陷阱爆炸', 'anim', '科学家_陷阱爆炸.anim'));
    const frames = (anim: { _tracks: Array<{ _channel: { _curve: { _values: unknown[] } } }> }) =>
        anim._tracks[0]._channel._curve._values.length;

    assert.equal(frames(spawnAnim), 12, 'start00~11 = 12 帧');
    assert.equal(frames(idleAnim), 12, 'idle00~11 = 12 帧');
    assert.equal(frames(expireAnim), 18, '爆炸 18 帧');
    //  wrapMode 1 = Normal（播一次停住）、2 = Loop
    assert.equal(idleAnim.wrapMode, 2, '常驻必须循环，否则 1 秒后陷阱就空了');
    assert.equal(spawnAnim.wrapMode, 1);
    assert.equal(expireAnim.wrapMode, 1);
    //  时长常量与 sample 同源：12/30 = 0.4s、18/30 = 0.6s
    assert.equal(spawnAnim.sample, 30);
    assert.equal(idleAnim.sample, 12);
    closeTo(ZC_TRAP_SPAWN_SECONDS, 12 / 30);
    closeTo(ZC_TRAP_EXPIRE_SECONDS, 18 / 30);
    for (const path of ['科学家_陷阱/科学家_陷阱.prefab', '科学家_陷阱/科学家_陷阱_出现.prefab',
        '科学家_陷阱爆炸/科学家_陷阱爆炸.prefab']) {
        assert.ok(existsSync(join(BUNDLE, path)), `缺预制体 ${path}`);
    }
});

// ────────────────────────────────────────────── 三、放置

test('castTrap：落在**脚下**，两段伤害与延迟出场一次性配齐', () => {
    const caster = unit(1, 'player', { freeX: 100, freeY: 200 });
    const state = snapshot([caster]);
    assert.equal(ZCAttackResolutionSystem.castTrap(state, caster, trapContext(caster, TRAP_PARAMS)), true);

    assert.equal(state.groundZones.length, 1);
    const zone = state.groundZones[0];
    closeTo(zone.x, 100, '「原地坐标」⇒ 不朝目标偏移');
    closeTo(zone.y, 200);
    closeTo(zone.radius, 30, '爆炸半径 100 × 0.3');
    closeTo(zone.contactRadius!, 15, '触碰半径 50 × 0.3');
    assert.equal(zone.contactDamage!, 60, '30 面板 × 200%');
    assert.equal(zone.expireDamage!, 54, '30 面板 × 180%，与触碰是两笔');
    assert.equal(zone.remainingSeconds, 15);
    assert.equal(zone.wavesLeft, 0, '陷阱没有周期性波次');
    assert.equal(zone.holdVisual, true);
    assert.equal(zone.effectPrefabPath, ZC_TRAP_IDLE_PREFAB_PATH);
    closeTo(zone.visualDelaySeconds!, ZC_TRAP_SPAWN_SECONDS);
    assert.equal(zone.expirePrefabPath, ZC_TRAP_EXPIRE_PREFAB_PATH);

    //  生成那一段是**独立**的一条 0.4s 表现，不是区域的持有视觉
    assert.equal(state.combatEvents.length, 1);
    const spawn = state.combatEvents[0];
    assert.equal(spawn.effectPrefabPath, ZC_TRAP_SPAWN_PREFAB_PATH);
    closeTo(spawn.startedAt, 0);
    closeTo(spawn.durationSeconds, ZC_TRAP_SPAWN_SECONDS);
    assert.equal(spawn.damage, 0, '纯表现：伤害由触碰 / 到期各自结算');
});

test('castTrap：三档参数各自生效；缺任一参数 ⇒ 返回 false，一个区域都不建', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(state, caster,
        trapContext(caster, { ...TRAP_PARAMS, trapDuration: 23, trapDamageRate: 3, trapExplodeDamageRate: 2.8 }));
    assert.equal(state.groundZones[0].remainingSeconds, 23);
    assert.equal(state.groundZones[0].contactDamage, 90);
    assert.equal(state.groundZones[0].expireDamage, 84);

    for (const missing of ['trapDuration', 'trapRadius', 'trapDamageRate', 'trapExplodeRadius', 'trapExplodeDamageRate']) {
        const broken = { ...TRAP_PARAMS } as Record<string, number>;
        delete broken[missing];
        const fresh = snapshot([caster]);
        assert.equal(ZCAttackResolutionSystem.castTrap(fresh, caster, trapContext(caster, broken)), false,
            `缺 ${missing} 还放出了陷阱`);
        assert.equal(fresh.groundZones.length, 0);
    }
});

test('trapForward 是「往前丢一格」的备用槽：配了才偏，缺省恒等于脚下', () => {
    const caster = unit(1, 'player', { freeX: 0, freeY: 0, facingRadians: 0 });
    const forward = snapshot([caster]);
    ZCAttackResolutionSystem.castTrap(forward, caster,
        trapContext(caster, { ...TRAP_PARAMS, trapForward: 30 }));
    closeTo(forward.groundZones[0].x, 9, '30 表值 px × 0.3 = 9 世界 px');
    closeTo(forward.groundZones[0].y, 0);
});

// ────────────────────────────────────────────── 四、触碰 / 到点自爆

test('触碰：只打第一个踩进来的，随后整片当场引爆（两笔伤害）', () => {
    const inside = unit(2, 'enemy', { freeX: 0, freeY: 0 });      // 触点内（< 15）
    const nearby = unit(3, 'enemy', { freeX: 20, freeY: 0 });     // 触点外、爆炸内（15 < 20 < 30）
    const faraway = unit(4, 'enemy', { freeX: 50, freeY: 0 });    // 爆炸外（> 30）
    const zone = trapZone();
    const state = {
        elapsedSeconds: 0, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;

    ZCGroundZoneSystem.tick(state, 0.05, zoneContext([inside, nearby, faraway]));

    assert.equal(inside.hp, 1000 - 60 - 54, '踩中 = 触碰 60 + 立刻爆炸 54');
    assert.equal(nearby.hp, 1000 - 54, '没踩中也要吃爆炸（均等）');
    assert.equal(faraway.hp, 1000, '爆炸半径外一发不打');
    assert.equal(state.groundZones.length, 0, '踩响就消失，不是「踩一次还在」');
    //  爆炸表现与伤害同一拍
    const expire = state.combatEvents.filter((event) => event.effectPrefabPath === ZC_TRAP_EXPIRE_PREFAB_PATH);
    assert.equal(expire.length, 1);
    closeTo(expire[0].durationSeconds, ZC_TRAP_EXPIRE_SECONDS);
});

test('到点自爆：没人踩也炸，爆炸范围内所有敌人**均等**掉血', () => {
    //  两个人都在**触点外**（15 之外）、爆炸圈内（30 之内）—— 踩不到，只能等到点自爆
    const first = unit(2, 'enemy', { freeX: 20, freeY: 0 });
    const second = unit(3, 'enemy', { freeX: -25, freeY: 0 });
    const outside = unit(4, 'enemy', { freeX: 80, freeY: 0 });
    //  还剩 0.04s ⇒ 这一拍就到期
    const zone = trapZone({ remainingSeconds: 0.04 });
    const state = {
        elapsedSeconds: 5, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;

    ZCGroundZoneSystem.tick(state, 0.05, zoneContext([first, second, outside]));

    assert.equal(state.groundZones.length, 0);
    assert.equal(first.hp, 1000 - 54, '不是「人数越多摊得越薄」，每人都是满额');
    assert.equal(second.hp, 1000 - 54);
    assert.equal(outside.hp, 1000);
    assert.equal(state.combatEvents.length, 1, '只推一条爆炸表现');
    assert.equal(state.combatEvents[0].effectPrefabPath, ZC_TRAP_EXPIRE_PREFAB_PATH);
});

test('常驻光环推后 0.4s 出场：`startedAt` / `durationSeconds` 两处都要带上延迟', () => {
    const zone = trapZone({ remainingSeconds: 5 });
    const state = {
        elapsedSeconds: 2, groundZones: [zone], combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;

    ZCGroundZoneSystem.tick(state, 0.05, zoneContext([]));

    assert.equal(state.combatEvents.length, 1);
    const hold = state.combatEvents[0];
    assert.equal(hold.effectPrefabPath, ZC_TRAP_IDLE_PREFAB_PATH);
    closeTo(hold.startedAt, 2 + ZC_TRAP_SPAWN_SECONDS, '晚 0.4s 出场，生成动画才播得完');
    closeTo(hold.durationSeconds, ZC_TRAP_SPAWN_SECONDS + (5 - 0.05), '延迟要加进时长，否则光环会提前到期消失');
});

// ────────────────────────────────────────────── 五、冷却：到点就放，不看射程

test('applyTrap：首次只挂 CD；到点才放；不看普攻射程闸门；被拒不消费 CD', () => {
    const caster = unit(1, 'player');
    const state = snapshot([caster]);
    const runtimeDefinition = {
        unitId: UNIT_ID, skillId: 30709, behaviorKey: ZC_TRAP_BEHAVIOR_KEY,
        trigger: 'every_seconds', stateMode: 'none', parameters: TRAP_PARAMS,
    } as unknown as ZCSkillRuntimeDefinition;

    let casts = 0;
    let accepted = true;
    const context = {
        statusSystem: new ZCStatusSystem(),
        runtimeOf: (target: ZCUnitState) => (target.owner === 'player' ? runtimeDefinition : undefined),
        castTrap: () => { casts += 1; return accepted; },
        unitPosition: (target: ZCUnitState) => ({ x: target.freeX, y: target.freeY }),
        distanceScale: 0.3,
        //  🔴 恒 false：陷阱放在脚下，落点与目标无关 —— 等目标进射程才落会永远落在追兵身后
        inAttackRange: () => false,
        nearestEnemyDistance: () => Number.POSITIVE_INFINITY,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 0, '开局不立刻放');
    closeTo(caster.trapReadyAt!, 10, '首次挂 CD = 10s');

    state.elapsedSeconds = 10;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 1, '到点就放（射程闸门恒 false 也照放）');
    closeTo(caster.trapReadyAt!, 20);

    //  参数不全时 castTrap 返回 false ⇒ CD 不消费，下一帧还有机会
    accepted = false;
    state.elapsedSeconds = 20;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 2);
    closeTo(caster.trapReadyAt!, 20, '被拒不推进 CD');

    accepted = true;
    state.elapsedSeconds = 20.5;
    ZCSkillTriggerSystem.tick(state, 0.05, context);
    assert.equal(casts, 3);
    closeTo(caster.trapReadyAt!, 30.5);
});
