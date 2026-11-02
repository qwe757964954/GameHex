import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import { ZCSkillRuntimeRegistry } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillTriggerSystem, teamAuraStatusId } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { assetPath } from './helpers/asset-paths';

/**
 * 僵尸 68028~68035 的配置落地（2026-10-30）。
 *
 * 这八张卡原来都把 `empoweredSkillId` 指在**别人的**武将技上
 * （30705/30706 指 36271 饥饿战士武将技、30704 指 36211 刀盾兵护盾、30702/30709 指 36151
 * 弓兵武将技、30708 指 36201 冰法师冰雕、30713 指 36241 重骑兵武将技、30710 指 36401
 * 驭兽师巨象践踏），本轮按设计案逐卡改链。
 *
 * 同时钉住本轮新增/修正的三个点：
 *
 *  1. `team_aura`：友军光环（共生信号·攻 / 守 / 矩阵），带 `teamAura{k}*` 槽位下标；
 *  2. `secondaryAppliesHitStatus`：副轨扇形的命中挂状态闸门（声波扫射 II/III 级减速）；
 *  3. `pvpStatus.control`：眩晕/减速这类状态必须真的写进 `control` 列，
 *     否则 `ZCStatusSystem.controlOf` 读不到、表现为「表填了、人不晕」。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

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

function skillRow(id: number): Record<string, unknown> {
    const row = readRows('pvpSkill').find((item) => Number(item.skillId) === id);
    assert.ok(row, `pvpSkill 缺少 ${id}`);
    return row!;
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('僵尸八卡：普攻行各归各家，遗留的武将技线全部摘掉', () => {
    prepare();
    const expect: Record<string, { row: number; mode: string; trigger: string; skill: number; secondary?: number }> = {
        '68028': { row: 30705, mode: 'melee', trigger: 'every_n_attacks', skill: 30846 },
        '68029': { row: 30704, mode: 'melee', trigger: 'every_n_attacks', skill: 30847 },
        '68030': { row: 30702, mode: 'projectile', trigger: 'every_seconds', skill: 30848 },
        '68031': { row: 30706, mode: 'melee', trigger: 'every_seconds', skill: 30849 },
        '68032': { row: 30708, mode: 'projectile', trigger: 'every_seconds', skill: 30851, secondary: 30850 },
        '68033': { row: 30713, mode: 'melee', trigger: 'every_seconds', skill: 30853, secondary: 30852 },
        '68034': { row: 30710, mode: 'projectile', trigger: 'every_seconds', skill: 30854, secondary: 30855 },
        '68035': { row: 30709, mode: 'projectile', trigger: 'every_seconds', skill: 30857, secondary: 30856 },
    };
    const legacy = [36271, 36211, 36151, 36201, 36241, 36401];
    const cards = new Map(readRows('pvpCard').map((row) => [String(row.id), row]));
    for (const [unitId, meta] of Object.entries(expect)) {
        const card = cards.get(unitId);
        assert.ok(card, `${unitId} 必须存在`);
        assert.equal(Number(card!.unitSkillId), meta.row, `${unitId} 的普攻行`);

        const attack = skillRow(meta.row);
        assert.equal(attack.mode, meta.mode, `${unitId} 普攻形态`);
        assert.equal(attack.trigger, meta.trigger);
        assert.equal(Number(attack.empoweredSkillId), meta.skill, `${unitId} 强化槽指向自己的主动`);
        assert.equal(attack.secondarySkillId ?? null,
            meta.secondary ?? null, `${unitId} 副槽`);

        for (const old of legacy) {
            assert.notEqual(Number(attack.empoweredSkillId), old, `${unitId} 还在指旧武将技 ${old}`);
        }
        for (const id of [meta.skill, meta.secondary].filter(Boolean) as number[]) {
            const active = skillRow(id);
            assert.ok(String(active.effectPrefabPath || '').length > 0, `${id} 必须有特效路径`);
        }
    }
});

test('篮球天才：三路友军光环各占一个槽位（整卡共用一份参数袋，不能重名）', () => {
    prepare();
    const plans = readRows('pvpSkillPlan').filter((row) => String(row.unitId) === '68030');
    const byChain = new Map(plans.map((row) => [Number(row.skillChainId), row]));
    const slots = [103001, 103002, 103003].map((chain) => {
        const row = byChain.get(chain);
        assert.ok(row, `缺 ${chain}`);
        assert.equal(row!.behaviorKey, 'team_aura', `${chain} 必须走 team_aura`);
        const params = JSON.parse(String(row!.skillParamJson)) as Record<string, number>;
        return Object.keys(params).map((key) => Number(/^teamAura(\d)/.exec(key)?.[1])).find((n) => Number.isFinite(n));
    });
    assert.deepEqual(slots, [0, 1, 2], '三条光环必须落在 0/1/2 三个不同槽位');
});

test('科学家 26 级：穿透 / 处决 / 暴击三路词缀都进了 statPatch', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const loadout = compileZCCombatBuild({
        unitId: '68035', heroLevel: 26,
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    const patch = loadout!.statPatch;
    // 103501 攻速 22% / 伤害 14%；103502 暴击率 36 / 伤害 32%
    assert.equal(patch.attackSpeedPct, 22);
    assert.equal(patch.damageRatePct, 46);
    assert.equal(patch.critRatePct, 36);
    // 103502 的处决走 skillParamJson（unit 域没有 executeChance）
    const plan = loadout!.skillPlans.find((row) => row.skillChainId === 103502 && row.skillLevel === 3);
    assert.equal(plan?.skillParams?.executeChance, 0.55);
});

test('眩晕状态必须写进 control 列，否则 controlOf 读不到', () => {
    prepare();
    const statuses = new Map(readRows('pvpStatus').map((row) => [String(row.statusId), row]));
    for (const id of ['stun_1', 'stun_1_5', 'stun_2s', 'stun_2_5', 'stun_3', 'stun_4']) {
        const row = statuses.get(id);
        assert.ok(row, `pvpStatus 缺少 ${id}`);
        assert.equal(row!.control, 'stun', `${id} 的 control 必须是 stun`);
    }
    for (const id of ['slow_mucus_l1', 'slow_wave_l3']) {
        const row = statuses.get(id);
        assert.ok(row, `pvpStatus 缺少 ${id}`);
        assert.equal(row!.control ?? null, null, `${id} 只是减速，不是硬控`);
        assert.ok(String(row!.statJson).includes('moveSpeedPct'), `${id} 必须带移速修正`);
    }
});

// ── 二、team_aura 运行时 ───────────────────────────────────────────────────────

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number, unitId = '68030'): ZCUnitState {
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

function auraHarness(parameters: Record<string, number>) {
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const near = makeUnit(2, ZCOwner.Player, 10);
    const far = makeUnit(3, ZCOwner.Player, 500);
    const enemy = makeUnit(4, ZCOwner.Enemy, 5);
    const state = {
        version: 4, elapsedSeconds: 1, durationSeconds: 300,
        units: [caster, near, far, enemy],
        projectiles: [], combatEvents: [], groundZones: [], statusEffects: [],
        nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
    const statusSystem = new ZCStatusSystem();
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68030', skillId: 30702, behaviorKey: 'team_aura',
        trigger: 'none', stateMode: 'none', parameters,
    };
    ZCSkillTriggerSystem.tick(state, 0.1, {
        statusSystem,
        runtimeOf: (unit) => (unit.id === caster.id ? runtime : undefined),
        fireBurst: () => undefined,
        castSecondary: () => false,
        distanceScale: 0.3,
    });
    return { statusSystem, near, far, enemy, caster };
}

test('友军光环：半径内同阵营挂上攻击加成，半径外与敌方都不挂', () => {
    const { statusSystem, near, far, enemy } = auraHarness({
        teamAura0Radius: 252, teamAura0AttackPct: 20,
    });
    assert.equal(statusSystem.statModsOf(String(near.id)).attackPct, 20, '半径内友军 +20% 攻击');
    assert.equal(statusSystem.statModsOf(String(far.id)).attackPct, undefined, '半径外不挂');
    assert.equal(statusSystem.statModsOf(String(enemy.id)).attackPct, undefined, '敌方不挂');
    // 半径 252 × 0.3 = 75.6 世界单位：10 在圈内、500 在圈外
    assert.ok(statusSystem.hasDef(teamAuraStatusId({ attackPct: 20 })));
});

test('友军光环：多个槽位互不覆盖（攻 / 守 / 矩阵可以同时挂）', () => {
    const { statusSystem, near } = auraHarness({
        teamAura0Radius: 252, teamAura0AttackPct: 20,
        teamAura1Radius: 252, teamAura1MaxHpPct: 12,
        teamAura2Radius: 252, teamAura2AttackPct: 8, teamAura2MaxHpPct: 8,
    });
    const mods = statusSystem.statModsOf(String(near.id));
    assert.equal(mods.attackPct, 28, '20 + 8 两路攻击光环叠加');
    assert.equal(mods.maxHpPct, 20, '12 + 8 两路生命光环叠加');
});

test('友军光环：一个槽位都没配时整段不执行', () => {
    const { statusSystem, near } = auraHarness({ damageRate: 1.4 });
    assert.deepEqual(statusSystem.statModsOf(String(near.id)), {});
});

// ── 三、副轨扇形的命中状态闸门 ─────────────────────────────────────────────────

function fanHarness(options: { appliesHitStatus: number; statusId?: string }) {
    const source = makeUnit(1, ZCOwner.Player, 0, '68032');
    const target = makeUnit(2, ZCOwner.Enemy, 60, '68028');
    const profile: ZCAttackProfile = {
        skillId: 30708, name: '吉他手普攻', mode: ZCCombatEventType.Projectile,
        projectileSpeed: 500, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 30851, secondarySkillId: 30850,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    };
    const secondary: ZCAttackProfile = {
        skillId: 30850, name: '声波扫射', mode: ZCCombatEventType.Area,
        projectileSpeed: 0, areaRadius: 60, damageRate: 0.9,
        empoweredEvery: 0, empoweredSkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68032', name: '吉他手', maxHp: 600, attack: 120,
        moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
        attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
        attackProfile: profile, secondaryProfile: secondary,
    } as unknown as ZCUnitDefinition;

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68032', skillId: 30708, behaviorKey: 'team_aura',
        trigger: 'none', stateMode: 'none',
        parameters: {
            secondaryCooldown: 10, secondaryDamageRate: 1.2, secondaryFanDeg: 120,
            secondaryRadiusScale: 0.6, secondaryAppliesHitStatus: options.appliesHitStatus,
        },
        ...(options.statusId ? { statusId: options.statusId } : {}),
    };

    const state = {
        version: 4, elapsedSeconds: 1, durationSeconds: 300,
        units: [source, target], projectiles: [], combatEvents: [], groundZones: [],
        nextCombatEventId: 1,
    } as unknown as ZCSnapshot;

    const applied: Array<{ unitId: number; statusId: string | undefined }> = [];
    const context: IZCAttackResolutionContext = {
        rules: { combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0 } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: perOwner(() => new Map()) as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map([[source.id, source], [target.id, target]]),
        currentTarget: () => ({ kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null }) as ZCCombatTarget,
        evaluateLegacySkill: () => ({ buffs: [], hitCount: 0, hasDamageFormula: false, damage: 0 }) as unknown as ReturnType<IZCAttackResolutionContext['evaluateLegacySkill']>,
        applyLegacySelfBuffs: () => [],
        tryExecuteUnit: () => undefined,
        applyHitStatus: (unit, id) => { applied.push({ unitId: unit.id, statusId: id }); },
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
    };
    context.skillRuntime[ZCOwner.Player] = new Map([['68032:30708', runtime]]);

    return {
        cast: () => ZCAttackResolutionSystem.castFanSkill(state, source, context),
        applied,
    };
}

test('副轨扇形：开了 secondaryAppliesHitStatus 才挂命中状态', () => {
    const on = fanHarness({ appliesHitStatus: 1, statusId: 'slow_wave_l3' });
    assert.equal(on.cast(), true);
    assert.deepEqual(on.applied.map((item) => item.statusId), ['slow_wave_l3'], 'II/III 级声波扫射要挂减速');

    // 关掉闸门：同一张卡另一条技能的 statusId 不会被副轨顺手打出去
    const off = fanHarness({ appliesHitStatus: 0, statusId: 'stun_4' });
    assert.equal(off.cast(), true);
    assert.deepEqual(off.applied, [], '未开闸门时副轨不挂任何状态');
});

// ── 四、behaviorKey 注册 ───────────────────────────────────────────────────────

test('team_aura 已进 SKILL_BEHAVIORS 与运行时注册表', () => {
    const registry = new ZCSkillRuntimeRegistry();
    const runtime = registry.compile({
        legacySkillId: 0, pvpSkillId: 30702, targetUnitId: '68030',
        behaviorKey: 'team_aura', trigger: 'none', stateMode: 'none', enabled: true,
    }, []);
    assert.equal(runtime.behaviorKey, 'team_aura');
});
