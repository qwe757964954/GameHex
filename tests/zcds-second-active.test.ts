import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCDamageSource, ZCFloatText, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillRuntimeRegistry } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCDamageResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCDamageResolutionSystem';
import { ZCUnitRegistry } from '../assets/script/app/zcds/model/systems/ZCUnitRegistry';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { assetPath } from './helpers/asset-paths';

/**
 * 六条「第二个主动」的落地（2026-10-30）。
 *
 * 这一批的共同困境是**没有出手位**：一条普攻行只有「一强化槽 + 一副轨（扇形伤害）」，
 * 而吃口菠萝（100603）/ 嗜血（100703）/ 迅击（100903）/ 舞王召唤（103103）既不出弹也不打人，
 * 戈壁狂箭（100804）/ 追踪导弹（101003）要的是「在半径里挑 N 个人各打一发」而不是扇形。
 *
 * 所以新增两条只带数据、没有状态机的 behaviorKey：
 *
 *  1. `self_cast`     —— 冷却到点给自己开一段限时增益（可带自愈 / 友军治疗 / 净化），
 *                        由 `ZCSkillTriggerSystem.applySelfCast` 按 `selfCastCooldown` 推进；
 *  2. `random_strike` —— 冷却（或累计普攻）到点在半径里挑 N 个敌人各打一发，
 *                        挑人在 trigger system、结算在 `ZCAttackResolutionSystem.strikeTargets`。
 *
 * 另外两条被动原语的消费点也钉在这里：
 *  · `ZCStatusStatMods.damageRatePct` / `lifestealRate`（限时增伤 / 限时吸血）；
 *  · `ZCStatusStatMods.dodgePct`（迅击的闪避，走 `ZCDamageResolutionSystem.damageUnit`）。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/standard.json'), 'utf8')));
    return captureZCMatchConfig();
}

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number, unitId = '68007'): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

function makeState(units: ZCUnitState[], now = 1): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: now, durationSeconds: 300,
        units, projectiles: [], combatEvents: [], groundZones: [], statusEffects: [],
        nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('六条第二个主动：计划行的 behaviorKey / 关键参数都在', () => {
    prepare();
    const plans = readRows('pvpSkillPlan');
    const paramsOf = (chain: number): Record<string, number> => {
        const row = plans.find((item) => Number(item.skillChainId) === chain);
        assert.ok(row, `pvpSkillPlan 缺少 ${chain}`);
        return JSON.parse(String(row!.skillParamJson)) as Record<string, number>;
    };
    const behaviorOf = (chain: number): string | null => {
        const row = plans.find((item) => Number(item.skillChainId) === chain);
        return (row!.behaviorKey as string | null) ?? null;
    };

    assert.equal(behaviorOf(100603), 'self_cast', '吃口菠萝 = 自愈 + 友军治疗 + 净化');
    assert.equal(paramsOf(100603).selfCastCooldown, 10);
    assert.equal(paramsOf(100603).selfCastHealPct, 8, 'L1 自身回复 8%');
    assert.equal(paramsOf(100603).selfCastAllyHealPct, 4, 'L1 友军回复 4%');

    assert.equal(behaviorOf(100703), 'self_cast', '嗜血 = 限时增伤 + 吸血');
    assert.deepEqual(
        [paramsOf(100703).selfCastDamagePct, paramsOf(100703).selfCastLifestealPct, paramsOf(100703).selfCastSeconds],
        [50, 10, 6], 'L1：伤害+50% / 吸血 10% / 6 秒');

    assert.equal(behaviorOf(100804), 'random_strike', '戈壁狂箭 = 累计 8 次普攻的箭雨');
    assert.deepEqual(
        [paramsOf(100804).strikeEvery, paramsOf(100804).strikeCount, paramsOf(100804).strikeSeconds],
        [8, 5, 6], 'L1：每 8 次普攻 / 5 个目标 / 持续 6 秒');

    assert.equal(behaviorOf(100903), 'self_cast', '迅击 = 常驻连击 + 限时增伤闪避');
    assert.deepEqual(
        [paramsOf(100903).selfCastDamagePct, paramsOf(100903).selfCastDodgePct],
        [20, 8], 'L1：伤害+20% / 闪避 8%');

    assert.equal(behaviorOf(101003), 'random_strike', '追踪导弹 = 就近多目标 + 落点爆炸');
    assert.deepEqual(
        [paramsOf(101003).strikeCount, paramsOf(101003).strikeNearest, paramsOf(101003).strikeSplashRadius,
            paramsOf(101003).strikeSplashDamageRate],
        [3, 1, 80, 0.5], 'L1：最近的 3 个 / 爆炸半径 80 / 溅射 50%（2026-11-03 需求，由 100/0.3333 上调口径）');

    assert.equal(behaviorOf(103103), 'self_cast', '舞王召唤本轮是替代口径（折算成限时增伤）');

    //  迅击的「2 连击」是常驻词缀，落在 unit 域 attackCount 上：
    //  `multiHitFlat` 是**额外**段数，1 = 多打一段 = 共 2 连击。
    const chain = plans.find((item) => Number(item.skillChainId) === 100903);
    assert.deepEqual([chain!.statId, chain!.operation, chain!.value], ['attackCount', 'add', 1]);
});

// ── 二、self_cast 运行时 ───────────────────────────────────────────────────────

function selfCastHarness(parameters: Record<string, number>, now = 1) {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68007');
    const near = makeUnit(2, ZCOwner.Player, 30, '68007');
    const far = makeUnit(3, ZCOwner.Player, 500, '68007');
    const enemy = makeUnit(4, ZCOwner.Enemy, 10, '68028');
    caster.hp = 500;
    near.hp = 200;
    const state = makeState([caster, near, far, enemy], now);
    const statusSystem = new ZCStatusSystem();
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68007', skillId: 30712, behaviorKey: 'self_cast',
        trigger: 'none', stateMode: 'none', parameters,
    };
    const heals: Array<{ unitId: number; amount: number }> = [];
    const tick = (at: number): void => {
        state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(state, 0.1, {
            statusSystem,
            runtimeOf: (unit) => (unit.id === caster.id ? runtime : undefined),
            fireBurst: () => undefined,
            castSecondary: () => false,
            distanceScale: 0.3,
            healUnit: (unit, amount) => {
                heals.push({ unitId: unit.id, amount });
                unit.hp = Math.min(unit.maxHp, unit.hp + amount);
            },
        });
    };
    return { tick, statusSystem, caster, near, far, enemy, heals };
}

test('自身施法：开局不立刻放，CD 到点才把限时增益挂上', () => {
    const harness = selfCastHarness({
        selfCastCooldown: 12, selfCastSeconds: 6, selfCastDamagePct: 50, selfCastLifestealPct: 10,
    });
    harness.tick(1);
    assert.deepEqual(harness.statusSystem.statModsOf('1'), {}, '第一次推进只记下 readyAt，不立刻开');
    assert.equal(harness.caster.selfCastReadyAt, 13);

    harness.tick(12.9);
    assert.deepEqual(harness.statusSystem.statModsOf('1'), {}, 'CD 没到不加增益');

    harness.tick(13);
    const mods = harness.statusSystem.statModsOf('1');
    assert.equal(mods.damageRatePct, 50, '伤害 +50% 落 damageRatePct');
    assert.equal(mods.lifestealRate, 0.1, '吸血 10% 落 lifestealRate（比例）');
    assert.equal(harness.caster.selfCastReadyAt, 25, '下一次要再等一个完整 CD');
});

test('自身施法：自愈 + 半径内友军治疗，半径外不回', () => {
    const harness = selfCastHarness({
        selfCastCooldown: 10, selfCastHealPct: 8, selfCastAllyRadius: 252, selfCastAllyHealPct: 4,
    });
    harness.tick(1);
    harness.tick(11);
    const byUnit = new Map(harness.heals.map((item) => [item.unitId, item.amount]));
    assert.equal(byUnit.get(1), 80, '自身 1000 上限的 8%');
    assert.equal(byUnit.get(2), 40, '半径内友军 4%');
    assert.equal(byUnit.has(3), false, '半径外友军不回');
    assert.equal(byUnit.has(4), false, '敌方不回');
});

test('自身施法：净化只解减益，增益留着', () => {
    const harness = selfCastHarness({
        selfCastCooldown: 10, selfCastCleanse: 1,
    });
    harness.statusSystem.register({
        id: 'slow', name: 'slow', durationSeconds: 30, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: { moveSpeedPct: -30 }, behavior: { kind: 'none' },
    });
    harness.statusSystem.register({
        id: 'buff', name: 'buff', durationSeconds: 30, maxStacks: 1, refreshPolicy: 'refresh',
        statMods: { attackPct: 20 }, behavior: { kind: 'none' },
    });
    harness.statusSystem.apply('1', 'slow', { at: 1, durationSeconds: 30 });
    harness.statusSystem.apply('1', 'buff', { at: 1, durationSeconds: 30 });
    harness.tick(1);
    harness.tick(11);
    assert.equal(harness.statusSystem.stacksOf('1', 'slow'), 0, '减益被解掉');
    assert.equal(harness.statusSystem.stacksOf('1', 'buff'), 1, '增益不动');
});

test('自身施法：没配 selfCastCooldown 时整段不执行', () => {
    const harness = selfCastHarness({ selfCastSeconds: 6, selfCastDamagePct: 50 });
    harness.tick(1);
    harness.tick(100);
    assert.deepEqual(harness.statusSystem.statModsOf('1'), {});
    assert.equal(harness.caster.selfCastReadyAt, undefined);
});

// ── 三、random_strike 运行时 ───────────────────────────────────────────────────

function strikeHarness(parameters: Record<string, number>, opts: { targets?: number; hits?: number } = {}) {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68008');
    const state = makeState([caster], 1);
    const statusSystem = new ZCStatusSystem();
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68008', skillId: 30717, behaviorKey: 'random_strike',
        trigger: 'none', stateMode: 'none', parameters,
    };
    const calls: Array<{ count: number; radius: number; nearest: boolean }> = [];
    const hits = opts.hits ?? 1;
    const tick = (at: number, unit = caster): void => {
        state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(state, 0.1, {
            statusSystem,
            runtimeOf: (item) => (item.id === unit.id ? runtime : undefined),
            fireBurst: () => undefined,
            castSecondary: () => false,
            distanceScale: 0.3,
            strike: (item, options) => {
                calls.push({ count: options.count, radius: options.radius, nearest: options.nearest });
                return hits;
            },
        });
    };
    return { tick, calls, caster };
}

test('多点打击：按 CD 触发时开局不立刻打，到点打一波且半径乘距离系数', () => {
    const harness = strikeHarness({
        strikeCooldown: 12, strikeCount: 3, strikeRadius: 336, strikeNearest: 1, strikeDamageRate: 3,
    });
    harness.tick(1);
    assert.equal(harness.calls.length, 0, '第一次推进只记 readyAt');
    harness.tick(13);
    assert.equal(harness.calls.length, 1);
    assert.deepEqual(harness.calls[0], { count: 3, radius: 336 * 0.3, nearest: true });
});

test('多点打击：没有目标时不消费 CD，下一帧还能再试', () => {
    const harness = strikeHarness({ strikeCooldown: 12, strikeCount: 3, strikeRadius: 210 }, { hits: 0 });
    harness.tick(1);
    harness.tick(13);
    assert.equal(harness.calls.length, 1, '打了一波但没打到人');
    assert.equal(harness.caster.strikeReadyAt, 13, '没打到人就不推进冷却');
    harness.tick(13.5);
    assert.equal(harness.calls.length, 2);
});

test('多点打击：持续窗口内每秒再补一波，窗口结束就收工', () => {
    const harness = strikeHarness({
        strikeEvery: 8, strikeCount: 5, strikeRadius: 210, strikeSeconds: 6, strikeInterval: 1,
    });
    //  按累计普攻：第一次推进只记下当前计数
    harness.tick(1);
    assert.equal(harness.calls.length, 0);
    harness.caster.completedAttackCount = 8;
    harness.tick(2);
    assert.equal(harness.calls.length, 1, '累计够 8 次打第一波');
    assert.equal(harness.caster.strikeUntil, 8, '窗口 = 触发时刻 + 6 秒');
    for (const at of [3, 4, 5, 6, 7]) harness.tick(at);
    assert.equal(harness.calls.length, 6, '窗口内每秒补一波，共 6 波');
    harness.tick(8);
    assert.equal(harness.calls.length, 6, '窗口结束后不再打');
    assert.equal(harness.caster.strikeUntil, undefined);
});

// ── 四、strikeTargets 选人与结算 ───────────────────────────────────────────────

function strikeContext(units: ZCUnitState[], random: () => number) {
    const definition = {
        unitId: '68010', name: '镭射飞龙', maxHp: 600, attack: 100,
        moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
        attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
        attackProfile: {
            skillId: 30719, name: '镭射飞龙普攻', mode: ZCCombatEventType.Projectile,
            projectileSpeed: 500, areaRadius: 0, damageRate: 1,
            empoweredEvery: 0, empoweredSkillId: 30845, secondarySkillId: 0,
            durationSeconds: 0, waves: 1, legacyEffectKeys: [],
        } satisfies ZCAttackProfile,
        secondaryProfile: undefined,
    } as unknown as ZCUnitDefinition;
    const damaged: Array<{ id: number; damage: number }> = [];
    const context: IZCAttackResolutionContext = {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0 } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (unit, damage) => {
            damaged.push({ id: unit.id, damage: Math.round(damage) });
            return { value: Math.round(damage), kind: 'damage' } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: perOwner(() => new Map()) as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => null,
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0 }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: () => undefined,
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
    };
    return { context, damaged };
}

test('多点打击：strikeNearest 挑最近的那几个，不碰远处与友军', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68010');
    const closeBy = makeUnit(2, ZCOwner.Enemy, 20, '68028');
    const middle = makeUnit(3, ZCOwner.Enemy, 40, '68028');
    const far = makeUnit(4, ZCOwner.Enemy, 80, '68028');
    const ally = makeUnit(5, ZCOwner.Player, 10, '68010');
    const outside = makeUnit(6, ZCOwner.Enemy, 900, '68028');
    const units = [caster, closeBy, middle, far, ally, outside];
    const state = makeState(units, 5);
    const { context, damaged } = strikeContext(units, () => 0.5);
    const hit = ZCAttackResolutionSystem.strikeTargets(state, caster, {
        count: 2, radius: 336 * 0.3, damageRate: 3, nearest: true,
    }, context);
    assert.equal(hit, 2);
    assert.deepEqual(damaged.map((item) => item.id).sort(), [2, 3], '只打最近的 2 个敌人');
    assert.ok(damaged.every((item) => item.damage > 0));
});

test('多点打击：随机模式用同一套随机序列就能重演出同一批目标', () => {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68008');
    const units = [caster, makeUnit(2, ZCOwner.Enemy, 10, '68028'), makeUnit(3, ZCOwner.Enemy, 20, '68028'),
        makeUnit(4, ZCOwner.Enemy, 30, '68028'), makeUnit(5, ZCOwner.Enemy, 40, '68028')];
    const run = (): number[] => {
        const state = makeState(units.map((unit) => ({ ...unit })), 5);
        //  每次用新的 seed 起点，模拟「同一份回放」
        let cursor = 0;
        const sequence = [0.9, 0.1, 0.5, 0.3];
        const { context, damaged } = strikeContext(units.map((unit) => ({ ...unit })), () => sequence[cursor++ % sequence.length]);
        ZCAttackResolutionSystem.strikeTargets(state, state.units[0], {
            count: 2, radius: 210 * 0.3, damageRate: 0.5, nearest: false,
        }, context);
        return damaged.map((item) => item.id).sort();
    };
    assert.deepEqual(run(), run(), '同一随机序列 → 同一批目标');
});

// ── 五、状态域的两个消费点 ─────────────────────────────────────────────────────

function damageContext(mods: Record<string, number>, random: () => number) {
    const units = new ZCUnitRegistry();
    return {
        statusSystem: { statModsOf: () => mods } as unknown as { statModsOf: () => Record<string, number> },
        units,
        damageDealt: perOwner(() => 0),
        damageTaken: perOwner(() => 0),
        random,
    } as unknown as Parameters<typeof ZCDamageResolutionSystem.damageUnit>[4];
}

test('闪避：dodgePct > 0 且抽中时这一下完全不掉血', () => {
    const target = makeUnit(2, ZCOwner.Enemy, 10, '68009');
    const source: ZCDamageSource = { owner: ZCOwner.Player, kind: 'unit', unitId: 1 };
    const state = makeState([target], 5);

    const dodged = ZCDamageResolutionSystem.damageUnit(state, target, 100, source,
        damageContext({ dodgePct: 0.2 }, () => 0.0));
    assert.deepEqual(dodged, { applied: 0, killed: false });
    assert.equal(target.hp, 1000, '闪避成功不掉血');

    const hit = ZCDamageResolutionSystem.damageUnit(state, target, 100, source,
        damageContext({ dodgePct: 0.2 }, () => 0.99));
    assert.equal(hit?.applied, 100, '没抽中就正常吃伤害');
});

test('闪避：没配 dodgePct 的单位一次随机都不抽', () => {
    const target = makeUnit(2, ZCOwner.Enemy, 10, '68009');
    const source: ZCDamageSource = { owner: ZCOwner.Player, kind: 'unit', unitId: 1 };
    const state = makeState([target], 5);
    let rolls = 0;
    ZCDamageResolutionSystem.damageUnit(state, target, 100, source,
        damageContext({}, () => { rolls += 1; return 0.0; }));
    assert.equal(rolls, 0, '缺省不抽 ⇒ 既有对局的随机序列不受影响');
});

// ── 六、behaviorKey 注册 ───────────────────────────────────────────────────────

test('self_cast / random_strike 已进 SKILL_BEHAVIORS 与运行时注册表', () => {
    const registry = new ZCSkillRuntimeRegistry();
    for (const key of ['self_cast', 'random_strike']) {
        const runtime = registry.compile({
            legacySkillId: 0, pvpSkillId: 30712, targetUnitId: '68007',
            behaviorKey: key, trigger: 'none', stateMode: 'none', enabled: true,
        }, []);
        assert.equal(runtime.behaviorKey, key);
    }
});
