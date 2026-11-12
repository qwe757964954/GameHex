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
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { assetPath } from './helpers/asset-paths';

/**
 * 花果 68006~68010 的配置落地（2026-10-30）。
 *
 * 这五张卡原来都指着**别人的**普攻行（68010 指 30251「风法师普攻」，还挂着
 * `empoweredSkillId=36251` 风法师龙卷风），本轮按设计案逐卡改链。
 *
 * 同时钉住三个新原语 —— 它们都是「缺省关掉、老行为逐字不变」的加法：
 *
 *  1. `normalPierceCount`：普攻穿透（原来 `pierceCount` 只服务强化那一击）；
 *  2. `splashRadius` + `splashDamageRate`：命中溅射（原来只有旧 skillEffect 的
 *     `legacyAreaRadius`，而且一律按全额结算）；
 *  3. `zoneSelfCentered`：区域落在**施法者脚下**而不是目标点（斗气爆发这类「自身周围」）。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
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
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

function skillRow(id: number): Record<string, unknown> {
    const row = readRows('pvpSkill').find((item) => Number(item.skillId) === id);
    assert.ok(row, `pvpSkill 缺少 ${id}`);
    return row!;
}

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('花果五卡：普攻行各归各家，遗留的武将技线全部摘掉', () => {
    prepare();
    const expect: Record<string, { row: number; mode: string; trigger: string; skill: number }> = {
        '68006': { row: 30703, mode: 'melee', trigger: 'every_seconds', skill: 30841 },
        '68007': { row: 30712, mode: 'melee', trigger: 'every_n_attacks', skill: 30842 },
        '68008': { row: 30717, mode: 'projectile', trigger: 'every_seconds', skill: 30843 },
        '68009': { row: 30718, mode: 'melee', trigger: 'every_n_attacks', skill: 30844 },
        '68010': { row: 30719, mode: 'projectile', trigger: 'every_n_attacks', skill: 30845 },
    };
    const cards = new Map(readRows('pvpCard').map((row) => [String(row.id), row]));
    for (const [unitId, meta] of Object.entries(expect)) {
        const card = cards.get(unitId);
        assert.ok(card, `${unitId} 必须存在`);
        assert.equal(Number(card!.unitSkillId), meta.row, `${unitId} 的普攻行`);

        const attack = skillRow(meta.row);
        assert.equal(attack.mode, meta.mode);
        assert.equal(attack.trigger, meta.trigger);
        assert.equal(Number(attack.empoweredSkillId), meta.skill, `${unitId} 强化槽指向自己的主动`);

        // 旧链路：这几张卡原来分别指 36211/36221/36231/36241/36251，都是别的兵种的武将技。
        for (const legacy of [36211, 36221, 36231, 36241, 36251]) {
            assert.notEqual(Number(attack.empoweredSkillId), legacy, `${unitId} 还在指旧武将技 ${legacy}`);
        }

        const active = skillRow(meta.skill);
        assert.ok(String(active.effectPrefabPath || '').length > 0, `${meta.skill} 必须有特效路径`);
    }
});

test('镭射飞龙：bulletNum / bulletAngle 必须走 statId，不能塞进 skillParamJson', () => {
    prepare();
    const plans = readRows('pvpSkillPlan').filter((row) => String(row.unitId) === '68010');
    const chains = new Set(plans.map((row) => Number(row.skillChainId)));
    // 101001 四个词缀 → 主链 + 三条子链（一行只能带一个 statId）
    for (const chain of [101001, 191001, 281001, 371001]) {
        assert.ok(chains.has(chain), `缺子链 ${chain}`);
    }
    const byChain = (chainId: number) => plans
        .filter((row) => Number(row.skillChainId) === chainId)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.deepEqual(byChain(281001).map((row) => [row.statId, Number(row.value)]),
        [['bulletNum', 1], ['bulletNum', 1], ['bulletNum', 2]], '发数是增量口径：+1 = 2 发');
    for (const row of byChain(371001)) {
        assert.equal(row.statId, 'bulletAngle');
        assert.equal(Number(row.value), 12, '总张角 12°（每发偏 6°）');
    }
    // skillParamJson 里不该再出现这两个键
    for (const row of plans) {
        const params = row.skillParamJson ? JSON.parse(String(row.skillParamJson)) : {};
        assert.equal(params.bulletNum, undefined, 'skillParamJson 里的 bulletNum 没有消费点');
        assert.equal(params.bulletAngle, undefined, 'skillParamJson 里的 bulletAngle 没有消费点');
    }
});

test('镭射飞龙 25 级：四类词缀都进了 statPatch', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const loadout = compileZCCombatBuild({
        unitId: '68010', heroLevel: 25, generalStar: { generalId: 68010, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    const patch = loadout!.statPatch;
    assert.equal(patch.bulletNumFlat, 2, '101001 III 级 +2 发');
    assert.equal(patch.bulletAngleFlat, 12);
    // 101001 攻速 26% + 101002 攻速 26%
    assert.equal(patch.attackSpeedPct, 52);
    // 101001 伤害 16% + 101002 附加 78%
    assert.equal(patch.damageRatePct, 94);
    assert.equal(patch.attackRangePct, 16, '101002 III 级射程 +16%');
});

// ── 二、三个新原语（缺省关闭，老行为不变） ─────────────────────────────────────

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68010', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IHarnessOptions {
    mode?: ZCCombatEventType;
    areaRadius?: number;
    durationSeconds?: number;
    waves?: number;
    /** 普攻行自己的强化配置；0 = 永不强化的普攻。 */
    empoweredEvery?: number;
    empoweredProfile?: ZCAttackProfile;
    parameters?: Record<string, number>;
}

function makeHarness(options: IHarnessOptions = {}) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const profile: ZCAttackProfile = {
        skillId: 30719, name: '镭射飞龙普攻', mode: options.mode ?? ZCCombatEventType.Projectile,
        projectileSpeed: 500, areaRadius: 0, damageRate: 1,
        empoweredEvery: options.empoweredEvery ?? 0,
        empoweredSkillId: options.empoweredProfile ? 30845 : 0,
        durationSeconds: 0, waves: 1,
        legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68010', name: '镭射飞龙', maxHp: 1000, attack: 100,
        moveSpeed: 0, attackRange: 500, attackInterval: 1.8, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: true, hero: false,
        prefabPath: '', prefabSize: 1,
        attackProfile: profile,
        ...(options.empoweredProfile ? { empoweredProfile: options.empoweredProfile } : {}),
    } as ZCUnitDefinition;

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68010', skillId: 30719, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none',
        parameters: options.parameters ?? {},
    };

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

    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: () => null,
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: { ...perOwner(() => new Map()), [ZCOwner.Player]: new Map([['68010:30719', runtime]]) },
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
        state,
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
    };
}

test('普攻穿透：normalPierceCount 对**普通**出手生效（pierceCount 仍只服务强化）', () => {
    const plain = makeHarness({ parameters: { normalPierceCount: 2 } });
    plain.attack();
    assert.equal(plain.state.projectiles[0].remainingPierces, 2);

    // 只配 pierceCount 时，普通出手不穿透 —— 既有口径不变。
    const legacy = makeHarness({ parameters: { pierceCount: 2 } });
    legacy.attack();
    assert.equal(legacy.state.projectiles[0].remainingPierces, 0);
});

test('命中溅射：splashRadius 乘距离系数，splashDamageRate 单独给倍率', () => {
    const harness = makeHarness({ parameters: { splashRadius: 38, splashDamageRate: 0.3 } });
    harness.attack();
    const projectile = harness.state.projectiles[0];
    assert.equal(projectile.splashRadius, 38 * 0.3, '屏上 px 要乘 combatDistanceScale');
    assert.equal(projectile.splashDamageRate, 0.3);

    // 不配就整段不执行（老弹道行为不变）。
    const plain = makeHarness();
    plain.attack();
    assert.equal(plain.state.projectiles[0].splashRadius, undefined);
    assert.equal(plain.state.projectiles[0].splashDamageRate, undefined);
});

test('自体中心区域：zoneSelfCentered=1 时区域落在施法者脚下，缺省仍在目标点', () => {
    const profile: ZCAttackProfile = {
        skillId: 30841, name: '斗气爆发', mode: ZCCombatEventType.Area,
        projectileSpeed: 0, areaRadius: 20, damageRate: 0.2,
        empoweredEvery: 0, empoweredSkillId: 0,
        durationSeconds: 5, waves: 10, legacyEffectKeys: [],
    };

    const self = makeHarness({
        mode: ZCCombatEventType.Melee, empoweredEvery: 1, empoweredProfile: profile,
        parameters: { damageRate: 0.2, zoneSelfCentered: 1 },
    });
    self.attack();
    assert.equal(self.state.groundZones.length, 1);
    assert.equal(self.state.groundZones[0].x, 0, '落在施法者（freeX=0）脚下');
    assert.equal(self.state.groundZones[0].y, 0);

    const onTarget = makeHarness({
        mode: ZCCombatEventType.Melee, empoweredEvery: 1, empoweredProfile: profile,
        parameters: { damageRate: 0.2 },
    });
    onTarget.attack();
    assert.equal(onTarget.state.groundZones.length, 1);
    assert.equal(onTarget.state.groundZones[0].x, 60, '不配就仍在目标点');
});

test('三叶小丑的飓风缩到 50%：视觉倍率与判定半径必须同步', () => {
    //  需求 2026-11-09：「三叶小丑的【飓风】技能，特效节点缩小 50%」
    //  ＋追加「得把 areaRadius 改成 30，两处必须同步」。
    //  36251「风法师武将技」= 三叶小丑（68020）`unitSkillId` 30714 的强化那一击。
    const PREFAB = 'units/projectiles/风法师_龙卷风/风法师_龙卷风';

    // ① 视觉：宿主节点必须乘 0.5（prefab 烘焙 4 倍 ⇒ 屏上约 512×616 缩到 256×308）。
    assert.equal(zcCombatEffectNodeScaleOf(PREFAB), 0.5, '飓风宿主节点必须乘 0.5');
    //  同一张表里还有椰蛋战士的旋风（2026-11-10 起是 0.7）：改这条不许顺手动它。
    assert.equal(zcCombatEffectNodeScaleOf('units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风'), 0.7);
    //  没登记的一律美术原样 —— 包括同职业的普攻风刃。
    assert.equal(zcCombatEffectNodeScaleOf('units/projectiles/风法师_绿风/风法师_绿风'), 1);
    assert.equal(zcCombatEffectNodeScaleOf(null), 1);

    // ② 判定：配表半径同样砍半（60 → 30 逻辑 px ⇒ 世界半径 18 → 9），两处一比一。
    //    只改一边的症状是「看着小了一圈、打到的还是原来那么大」（或反过来），实机看不出来、
    //    只能靠这条断言钉住 —— 所以这里连着链路一起查，不孤立地只看 36251 的数字。
    const card = readRows('pvpCard').find((row) => String(row.id) === '68020');
    assert.ok(card, '三叶小丑 68020 必须存在');
    const attack = skillRow(Number(card!.unitSkillId));
    assert.equal(attack.empoweredSkillId, 36251, '68020 的强化那一击必须是「飓风」36251');

    const hurricane = skillRow(36251);
    assert.equal(hurricane.mode, 'area', '飓风必须是 area 模式才会建持续区域');
    assert.equal(hurricane.areaRadius, 30,
        'areaRadius 必须跟着视觉一起砍半（60 → 30）；改它等于改判定范围，别只改特效倍率');
    assert.equal(hurricane.effectPrefabPath, PREFAB, '判定行的特效路径必须就是被缩的那张 prefab');

    // ③ 世界半径与另一半（`combatDistanceScale`）对得上：30 × 0.3 = 9。
    const global = readRows('pvpGlobal').find((row) => row.key === 'combatDistanceScale');
    assert.ok(global, 'pvpGlobal 缺 combatDistanceScale');
    assert.equal(Number(hurricane.areaRadius) * Number(global!.value), 9,
        '世界半径 9px（原 18px）：视觉与判定同比例，才叫"两处同步"');
});

test('椰蛋战士的暴风缩到 70%：视觉倍率与判定半径必须同步', () => {
    //  需求 2026-11-10：「68005 椰蛋战士的【暴风】技能，3 个飓风的大小调成 70% 大」
    //  ＋追加「只改了视觉，也要同步改判定」。
    //
    //  30831「椰蛋战士·暴风」= 68005 的 `unitSkillId` 30707 的强化那一击
    //  （每 5 次普攻，`on_cast_end_spawn_zone` 生成 3 道旋风）。
    const PREFAB = 'units/projectiles/椰蛋战士_暴风/椰蛋战士_暴风';
    const BEFORE_SCALE = 0.8;
    const AFTER_SCALE = 0.7;
    const BEFORE_RADIUS = 30;

    //  ① 视觉：宿主节点倍率。
    assert.equal(zcCombatEffectNodeScaleOf(PREFAB), AFTER_SCALE, '暴风宿主节点必须乘 0.7');

    //  ② 判定：半径按同一比例收 —— 30 × 0.7 / 0.8 = 26.25 ⇒ 取整 26。
    //     只改视觉的症状是「看着小了一圈、打到的还是原来那么大」，实机看不出来。
    const storm = skillRow(30831);
    assert.equal(storm.mode, 'area', '暴风必须是 area 模式才会建持续区域');
    assert.equal(storm.effectPrefabPath, PREFAB, '判定行的特效路径必须就是被缩的那张 prefab');
    assert.equal(storm.areaRadius, 26,
        `areaRadius 必须跟着视觉一起收（${BEFORE_RADIUS} → 26）；改它等于改判定范围，别只改特效倍率`);

    //  ③ 比例守卫：两边收缩比必须一致（26/30 ≈ 0.7/0.8 = 0.875），偏差超过 2% 就是漂了。
    const radiusRatio = Number(storm.areaRadius) / BEFORE_RADIUS;
    const scaleRatio = AFTER_SCALE / BEFORE_SCALE;
    assert.ok(Math.abs(radiusRatio - scaleRatio) / scaleRatio < 0.02,
        `判定收缩比 ${radiusRatio.toFixed(3)} 与视觉收缩比 ${scaleRatio.toFixed(3)} 已经对不上`);

    //  ④ 世界半径：26 × combatDistanceScale 0.3 = 7.8。
    const global = readRows('pvpGlobal').find((row) => row.key === 'combatDistanceScale');
    assert.ok(global, 'pvpGlobal 缺 combatDistanceScale');
    assert.equal(Number(storm.areaRadius) * Number(global!.value), 7.8,
        '世界半径 7.8px（原 9px）');
});
