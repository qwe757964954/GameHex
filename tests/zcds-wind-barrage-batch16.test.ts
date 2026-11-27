import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import { ZCProjectileSystem } from '../assets/script/app/zcds/model/systems/ZCProjectileSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import {
    ZC_BARRAGE_IMPACT_PREFAB_PATH, ZC_BARRAGE_MISSILE_PREFAB_PATH,
    ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH,
    ZC_BARRAGE_BEHAVIOR_KEY, ZC_WIND_BOLT_BEHAVIOR_KEY,
    zcIsMissileBarrageBehavior, zcIsWindBoltBehavior,
    zcMissileBarrageEffectPaths, zcWindBoltEffectPaths,
} from '../assets/script/app/zcds/model/ZCWindBarrageFx';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 16 批 · 风炮菇 68013 的两条主动（2026-11-18，设计案 V12）。
 *
 *   · 「风炮弹」101303（原「孢爆箭」，2026-11-23 改名）—— `wind_bolt`：射一枚风弹
 *     （150/180/220%），命中点留一片半径 30 / 3 秒的飓风，接触者各吃一次 90/108/132%
 *     （同一敌人只结算一次）。风弹前段移速同日口径改为 **表值 175 px/s**（原 70，×2.5）。
 *   · 「连射导弹」101304 —— `missile_barrage`：每累计 10 次普攻，1.2 秒内抛 3 枚炸弹，
 *     落点在目标周围随机，**到达落点才爆炸**（途中不碰目标），半径 180 内一次性 160/200/220%。
 *
 * 这一批有五个「看着能跑、其实是静默失效」的点，正是本用例要钉住的：
 *
 *  1. **101303 换了行为键**。第 12 批的 `splash_shot` 是「命中点炸一次」，
 *     V12 要的是「命中点留一片持续区域」。不换键的话表能读、技能也放，
 *     但飓风永远不会出现（`splash_shot` 的结算里没有区域这个概念）。
 *  2. **参数键前缀是 `wind*` / `barrage*`**。`skillParamJson` 按 `${unitId}:${pvpSkillId}`
 *     合并成一袋，68013 这两条技能共用 30401 这个键 ⇒ 任何裸键（`damageRate` / `radius`）
 *     都会同时改掉两条技能，甚至串到普攻链路（`splashRadius` 那套），且不报错。
 *  3. **飓风必须「同一敌人只结算一次」**。区域默认是「每波都打」，3 秒 / 每 0.1 秒 = 30 波
 *     ⇒ 不设 `zoneHitOnce` 的话踩进去的敌人会挨 30 下。
 *  4. **连射导弹的落点必须是「到点才炸」**。用弹道实现的话沿路径会扫掠命中，
 *     与设计「途中不碰目标」冲突；这里走「会飞的地面区域」（`wavesLeft = 0` + `expireDamage`）。
 *  5. **同一个累计普攻数只能开一轮排射**。`completedAttackCount % 10 === 0` 会在
 *     下一次普攻之前一直成立，没有 `barrageLastCount` 门闩就会每帧重开一轮。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const ROOT = process.cwd();
const SCALE = 0.3;

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

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number, unitId = '68013'): ZCUnitState {
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

function makeState(units: ZCUnitState[]): ZCSnapshot {
    return {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units, nextUnitId: units.length + 1,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

// ────────────────────────────────────────────── 一、配表真值

//  2026-11-23（第 44 批）：`windSpeed` 70 → 175（前段移速 ×2.5），三档同步。
const WIND_PARAMS: Array<Record<string, number>> = [
    { windCooldown: 12, windDamageRate: 1.5, windSpeed: 175, windLifeSeconds: 4, windZoneRadius: 30, windZoneSeconds: 3, windZoneDamageRate: 0.9 },
    { windCooldown: 12, windDamageRate: 1.8, windSpeed: 175, windLifeSeconds: 4, windZoneRadius: 30, windZoneSeconds: 3, windZoneDamageRate: 1.08 },
    { windCooldown: 12, windDamageRate: 2.2, windSpeed: 175, windLifeSeconds: 4, windZoneRadius: 30, windZoneSeconds: 3, windZoneDamageRate: 1.32 },
];
const BARRAGE_PARAMS: Array<Record<string, number>> = [
    { barrageEvery: 10, barrageCount: 3, barrageInterval: 0.4, barrageDamageRate: 1.6, barrageRadius: 180 },
    { barrageEvery: 10, barrageCount: 3, barrageInterval: 0.4, barrageDamageRate: 2, barrageRadius: 180 },
    { barrageEvery: 10, barrageCount: 3, barrageInterval: 0.4, barrageDamageRate: 2.2, barrageRadius: 180 },
];

test('101303 风炮弹（V12）：三档直击/飓风倍率与设计案一致', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101303)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94013031, 94013032, 94013033]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [5, 18, 27], '技能 3 = 5/18/27');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68013');
        assert.equal(row.behaviorKey, ZC_WIND_BOLT_BEHAVIOR_KEY);
        assert.equal(row.skillKind, 'active_cd');
        assert.equal(row.statId, null, '机制全在参数袋里，主链不挂属性');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), WIND_PARAMS[index]);
    }
});

test('101304 连射导弹（V12）：累计 10 次普攻 / 3 枚 / 间隔 0.4 / 半径 180', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101304)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94013041, 94013042, 94013043]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [7, 24, 36], '技能 4 = 7/24/36');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68013');
        assert.equal(row.behaviorKey, ZC_BARRAGE_BEHAVIOR_KEY);
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), BARRAGE_PARAMS[index]);
    }
});

test('参数袋前缀必须是 wind* / barrage*，不许出现裸键', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter(
        (row) => Number(row.skillChainId) === 101303 || Number(row.skillChainId) === 101304);
    assert.equal(rows.length, 6);
    const BANNED = ['damageRate', 'radius', 'cooldown', 'splashRadius', 'splashDamageRate', 'interval', 'count'];
    for (const row of rows) {
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        for (const banned of BANNED) {
            assert.equal(banned in params, false,
                `${row.modifierId} 的参数袋里有裸键 ${banned} ⇒ 68013 的普攻 / 另一条技能会被顺带改掉`);
        }
        const prefix = Number(row.skillChainId) === 101303 ? 'wind' : 'barrage';
        for (const key of Object.keys(params)) {
            assert.ok(key.startsWith(prefix),
                `${row.modifierId} 的参数键 ${key} 没有 ${prefix} 前缀 ⇒ 会和同卡另一条技能串袋`);
        }
    }
});

// ────────────────────────────────────────────── 二、登记（漏一处就静默不跑）

test('wind_bolt / missile_barrage 必须双登记（白名单 + 运行时注册表）', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    const runtimeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
    for (const key of [ZC_WIND_BOLT_BEHAVIOR_KEY, ZC_BARRAGE_BEHAVIOR_KEY]) {
        assert.match(schemaSource, new RegExp(`SKILL_BEHAVIORS = new Set\\(\\[[\\s\\S]*?'${key}'[\\s\\S]*?\\]\\)`),
            `ZCStatSchema.SKILL_BEHAVIORS 缺 ${key} ⇒ 读表阶段直接抛「未注册 behaviorKey」`);
        assert.match(runtimeSource, new RegExp(`this\\.register\\('${key}'`),
            `ZCSkillRuntimeRegistry 缺 ${key} ⇒ compile 阶段抛「未注册 behaviorKey」`);
    }
});

test('行为键 → 表现路径：两条车道各自成套，且不互相认领', () => {
    assert.equal(zcIsWindBoltBehavior(ZC_WIND_BOLT_BEHAVIOR_KEY), true);
    assert.equal(zcIsWindBoltBehavior(ZC_BARRAGE_BEHAVIOR_KEY), false);
    assert.equal(zcIsMissileBarrageBehavior(ZC_BARRAGE_BEHAVIOR_KEY), true);
    assert.equal(zcIsMissileBarrageBehavior(ZC_WIND_BOLT_BEHAVIOR_KEY), false);
    assert.deepEqual(zcWindBoltEffectPaths(ZC_WIND_BOLT_BEHAVIOR_KEY), [
        ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH,
    ]);
    assert.deepEqual(zcMissileBarrageEffectPaths(ZC_BARRAGE_BEHAVIOR_KEY), [
        ZC_BARRAGE_MISSILE_PREFAB_PATH, ZC_BARRAGE_IMPACT_PREFAB_PATH,
    ]);
});

test('68013 的四条 prefab 必须进加载清单（漏一条就是「技能照常结算、屏幕没东西」）', () => {
    prepare();
    const plan = buildZCVisualResourcePlan([DEFINITION], {
        skillPlans: [
            { enabled: true, unitId: '68013', behaviorKey: ZC_WIND_BOLT_BEHAVIOR_KEY },
            { enabled: true, unitId: '68013', behaviorKey: ZC_BARRAGE_BEHAVIOR_KEY },
        ],
        textOverrides: new Map(),
    });
    const paths = plan.effectPaths;
    for (const path of [
        ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH,
        ZC_BARRAGE_MISSILE_PREFAB_PATH, ZC_BARRAGE_IMPACT_PREFAB_PATH,
    ]) {
        assert.ok(paths.includes(path), `加载清单缺 ${path}`);
    }
});

test('新增的持久字段必须登记进快照校验（脏值不许悄悄过）', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['windBoltReadyAt', 'barrageNextAt', 'barrageLastCount', 'barrageVolleyLeft']) {
        assert.match(codec, new RegExp(`'${key}'`), `ZCSnapshotCodec 缺 ${key}`);
    }
    for (const key of ['zoneRadius', 'zoneWaveInterval', 'zoneHitOnce', 'zoneEffectPrefabPath']) {
        assert.match(codec, new RegExp(`projectile\\.${key}`), `ZCSnapshotCodec 缺 projectile.${key}`);
    }
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    for (const key of ['windBoltReadyAt', 'barrageLastCount', 'barrageVolleyLeft', 'barrageNextAt']) {
        assert.match(types, new RegExp(`${key}\\?: number`), `ZCUnitState 缺 ${key}`);
    }
});

// ────────────────────────────────────────────── 三、castWindBolt / castMissileBarrage

const DEFINITION = {
    unitId: '68013', name: '风炮菇', maxHp: 600, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 500, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 30401, name: '风炮菇普攻', mode: 'projectile',
        projectileSpeed: 500, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function attackContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    behaviorKey: string,
    target: { id: number; x: number; y: number } | null,
    random: () => number = () => 0.5,
) {
    const pushed: Array<Record<string, unknown>> = [];
    const runtime = {
        skillChainId: 101303, behaviorKey,
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const context = {
        rules: {
            combatDistanceScale: SCALE, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_unit: ZCUnitState, damage: number) =>
            ({ value: Math.round(damage), kind: 'damage', x: 0, y: 0 }) as unknown as ZCFloatText,
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            [ZCOwner.Player]: new Map([[`68013:30401`, runtime]]),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => (target
            ? { kind: 'unit', id: target.id, x: target.x, y: target.y, bodyRadius: 24, cardId: '68001' }
            : null),
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
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: (projectile: Record<string, unknown>) => { pushed.push(projectile); },
    } as unknown as IZCAttackResolutionContext;
    return { context, pushed };
}

test('castWindBolt：射一枚风弹，弹体带「命中后留飓风」的全套字段', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context, pushed } = attackContext(units, WIND_PARAMS[0], ZC_WIND_BOLT_BEHAVIOR_KEY,
        { id: enemy.id, x: 40, y: 0 });

    assert.equal(ZCSkillResolutionSystem.castWindBolt(state, caster, context), true);
    assert.equal(pushed.length, 1, '一次施法只射一枚');
    const projectile = pushed[0];
    assert.equal(projectile.effectPrefabPath, ZC_WIND_BOLT_PREFAB_PATH);
    assert.equal(projectile.impactEffectPrefabPath, undefined,
        '直击不另挂命中特效：风弹弹体本身就是表现，命中点留给飓风');
    //  直击不溅射：范围那部分由飓风自己结算（表里是两列）。
    assert.equal(projectile.splashRadius, undefined);
    //  弹速是**世界 px/秒**（与 `projectileSpeed` 同口径），不乘 combatDistanceScale。
    assert.equal(projectile.velocityX === undefined || Number(projectile.velocityX) !== 0, true);
    //  飓风：30 表值 px × 0.3 = 9 世界 px、活 3 秒、每 0.1 秒扫一遍、同一敌人只结算一次。
    assert.ok(Math.abs(Number(projectile.hurricaneRadius) - 30 * SCALE) < 1e-6);
    assert.equal(projectile.hurricaneSeconds, 3);
    assert.equal(projectile.hurricanePrefabPath, ZC_WIND_HURRICANE_PREFAB_PATH);
    //  区域伤害按 windZoneDamageRate 另算一份（0.9），与直击（1.5）不是一个数。
    assert.ok(Number(projectile.hurricaneDamage) > 0);
    assert.notEqual(projectile.hurricaneDamage, projectile.baseDamage);
});

test('castWindBolt：参数不全 / 射程内没人 ⇒ false 且不推弹', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);

    const broken = attackContext(units, { windCooldown: 12, windDamageRate: 1.5 },
        ZC_WIND_BOLT_BEHAVIOR_KEY, { id: enemy.id, x: 40, y: 0 });
    assert.equal(ZCSkillResolutionSystem.castWindBolt(state, caster, broken.context), false,
        '缺 windZoneRadius / windZoneSeconds ⇒ 不出弹（否则会「命中一下、什么都不留」）');
    assert.equal(broken.pushed.length, 0);

    const loneUnits = [caster];
    const loneState = makeState(loneUnits);
    const lone = attackContext(loneUnits, WIND_PARAMS[0], ZC_WIND_BOLT_BEHAVIOR_KEY, null);
    assert.equal(ZCSkillResolutionSystem.castWindBolt(loneState, caster, lone.context), false);
    assert.equal(lone.pushed.length, 0);
});

test('castMissileBarrage：一枚「会飞的区域」，到点才炸、飞行段不结算', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 60, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context, pushed } = attackContext(units, BARRAGE_PARAMS[0], ZC_BARRAGE_BEHAVIOR_KEY,
        { id: enemy.id, x: 60, y: 0 });

    assert.equal(ZCAttackResolutionSystem.castMissileBarrage(state, caster, context), true);
    assert.equal(pushed.length, 0, '不走弹道 —— 弹道沿路径会扫掠命中，与「途中不碰目标」冲突');
    assert.equal(state.groundZones.length, 1);
    const zone = state.groundZones[0];
    //  飞行段：`wavesLeft = 0` ⇒ 波次循环空转、飞行途中一波都不结算。
    assert.equal(zone.wavesLeft, 0);
    assert.equal(zone.damage, 0, '飞行段没有伤害');
    //  到点那一下：到期通道结算 `expireDamage` 并播爆炸。
    assert.ok(Number(zone.expireDamage) > 0);
    assert.equal(zone.expirePrefabPath, ZC_BARRAGE_IMPACT_PREFAB_PATH);
    //  180 表值 px × 0.3 = 54 世界 px。
    assert.ok(Math.abs(zone.radius - 180 * SCALE) < 1e-6);
    //  从一开始就在往落点飞，且落点在爆炸半径之内（不然三枚都炸在圈外）。
    assert.ok(Math.abs(Number(zone.moveVelocityX)) + Math.abs(Number(zone.moveVelocityY)) > 0);
    assert.equal(zone.holdVisual, true, '飞行段要有常驻视觉，否则炸弹只在落点凭空出现');
});

test('castMissileBarrage：落点随机但落在「目标周围 ±0.6R」内，且不同随机值给不同落点', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 60, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const spread = 180 * SCALE * 0.6;

    const seen: Array<number> = [];
    for (const value of [0, 0.25, 0.75, 0.99]) {
        state.groundZones.length = 0;
        const { context } = attackContext(units, BARRAGE_PARAMS[0], ZC_BARRAGE_BEHAVIOR_KEY,
            { id: enemy.id, x: 60, y: 0 }, () => value);
        assert.equal(ZCAttackResolutionSystem.castMissileBarrage(state, caster, context), true);
        const zone = state.groundZones[0];
        //  落点 = 出生点 + 速度 × 飞行时长 ⇒ 用它反推落点，再检查散布半径。
        const seconds = zone.remainingSeconds;
        const landX = zone.x + Number(zone.moveVelocityX) * seconds;
        const landY = zone.y + Number(zone.moveVelocityY) * seconds;
        assert.ok(Math.hypot(landX - 60, landY - 0) <= spread + 1e-6,
            `落点离目标 ${Math.hypot(landX - 60, landY).toFixed(2)} > 散布半径 ${spread}`);
        seen.push(Number(landX.toFixed(3)) * 1000 + Number(landY.toFixed(3)));
    }
    assert.ok(new Set(seen).size > 1, '落点必须随 random 变化（写死就不是「随机落点」了）');
});

// ────────────────────────────────────────────── 四、触发系统：CD / 排射节拍

function triggerHarness(params: Record<string, number>, behaviorKey: string, unitId = '68013') {
    const caster = makeUnit(1, ZCOwner.Player, 0, unitId);
    const state = makeState([caster]);
    const runtime = {
        skillChainId: 101303, behaviorKey, trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const calls: number[] = [];
    let result = true;
    const context = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: () => false,
            register: () => undefined,
        },
        runtimeOf: () => runtime,
        fireBurst: () => undefined,
        castSecondary: () => false,
        castWindBolt: () => { calls.push(state.elapsedSeconds); return result; },
        castMissileBarrage: () => { calls.push(state.elapsedSeconds); return result; },
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return {
        caster, state, calls,
        setResult: (value: boolean) => { result = value; },
        step: (at: number, dt = 0.05) => {
            state.elapsedSeconds = at;
            ZCSkillTriggerSystem.tick(state, dt, context);
        },
    };
}

test('applyWindBolt：首次只挂 CD、到点出手、打空不消费 CD', () => {
    const harness = triggerHarness(WIND_PARAMS[0], ZC_WIND_BOLT_BEHAVIOR_KEY);
    harness.step(0);
    assert.equal(harness.caster.windBoltReadyAt, 12, '开局不立刻放');
    assert.equal(harness.calls.length, 0);

    harness.step(11.9);
    assert.equal(harness.calls.length, 0, '没到点不许放');

    harness.setResult(false);
    harness.step(12);
    assert.equal(harness.calls.length, 1, '尝试过，但被拒');
    assert.equal(harness.caster.windBoltReadyAt, 12, '被拒 ⇒ 冷却保持就绪，下帧重试');

    harness.setResult(true);
    harness.step(12.05);
    assert.equal(harness.calls.length, 2);
    assert.equal(harness.caster.windBoltReadyAt, 24.05, '打出去才把 CD 推后');
});

test('applyMissileBarrage：累计到 10 次普攻才开一轮，同一个累计数只开一轮', () => {
    const harness = triggerHarness(BARRAGE_PARAMS[0], ZC_BARRAGE_BEHAVIOR_KEY);
    harness.caster.completedAttackCount = 9;
    harness.step(0);
    assert.equal(harness.calls.length, 0, '第 9 次普攻不满足「每 10 次」');

    harness.caster.completedAttackCount = 10;
    harness.step(0.1);
    //  起轮当帧只记进度、不发弹（下一帧才出膛）。
    assert.equal(harness.caster.barrageVolleyLeft, 3);
    assert.equal(harness.caster.barrageLastCount, 10);

    //  再跑 3 秒，10 次这个累计数一直没变 —— 不许因此重开第二轮。
    for (let at = 0.15; at <= 3; at += 0.05) harness.step(at);
    assert.equal(harness.calls.length, 3, '一轮只有 3 枚（重开的话会超过 3）');
    assert.equal(harness.caster.barrageVolleyLeft, 0);
});

test('applyMissileBarrage：三枚按 barrageInterval 逐拍发出，不是齐射', () => {
    const harness = triggerHarness(BARRAGE_PARAMS[0], ZC_BARRAGE_BEHAVIOR_KEY);
    harness.caster.completedAttackCount = 10;
    harness.step(0);
    for (let at = 0.05; at <= 1.5; at += 0.05) harness.step(at);
    assert.equal(harness.calls.length, 3);
    const gaps = harness.calls.slice(1).map((at, index) => Number((at - harness.calls[index]).toFixed(3)));
    for (const gap of gaps) {
        assert.ok(Math.abs(gap - 0.4) < 0.06, `相邻两枚间隔 ${gap}s，应≈ barrageInterval(0.4)`);
    }
});

test('applyMissileBarrage：某一枚打不出去 ⇒ 本轮作废，不会永久卡在「还剩 N 枚」', () => {
    const harness = triggerHarness(BARRAGE_PARAMS[0], ZC_BARRAGE_BEHAVIOR_KEY);
    harness.caster.completedAttackCount = 10;
    harness.step(0);
    harness.setResult(false);
    harness.step(0.05);
    assert.equal(harness.caster.barrageVolleyLeft, 0, '打不出去要收尾，不能一直挂着');
    assert.equal(harness.caster.barrageLastCount, 10, '这一轮已经算触发过 —— 下一个 10 次才再开');
});

// ────────────────────────────────────────────── 五、「命中留区域」的通道本身

test('resolveProjectileHit 的区域分支：zoneHitOnce 走 hitUnitIds 去重 + holdVisual', () => {
    const source = readFileSync(join(ROOT, 'assets/script/app/zcds/model/systems/ZCAttackResolutionSystem.ts'), 'utf8');
    //  这三个必须成组出现：只开去重不给 `maxHits` 的话 `resolveWave` 根本不会读 `hitUnitIds`；
    //  只给去重不开 `holdVisual` 的话 30 波各推一条 area 事件，屏幕上一串残影。
    assert.match(source, /hitUnitIds: hitOnce \? \[\] : undefined/, 'zoneHitOnce 没接到 hitUnitIds');
    assert.match(source, /maxHits: hitOnce \? ZC_ZONE_HIT_ONCE_MAX_HITS : undefined/, 'zoneHitOnce 没接到 maxHits');
    assert.match(source, /holdVisual: hitOnce \? true : undefined/, 'zoneHitOnce 没开 holdVisual');
    assert.match(source, /zoneEffectPrefabPath \?\? 'units\/projectiles\/普攻爆炸\/普攻爆炸'/,
        '区域美术必须允许覆盖（风弹要龙卷风），缺省仍是普攻爆炸');
});

test('resolveProjectileArrival：explodeOnArrival 弹体到点后对半径内敌军结算且中途不提前结算', () => {
    const config = prepare();
    const shooter = makeUnit(1, ZCOwner.Player, 0);
    const enemyInRange = makeUnit(2, ZCOwner.Enemy, 100, '68028');
    const enemyOutOfRange = makeUnit(3, ZCOwner.Enemy, 220, '68028');
    const ally = makeUnit(4, ZCOwner.Player, 102, '68028');
    const units = [shooter, enemyInRange, enemyOutOfRange, ally];
    const state = makeState(units);
    const unitById = new Map(units.map((u) => [u.id, u]));
    const hits: Array<{ id: number; damage: number }> = [];
    const context = {
        geometry: { hexIdAt: () => 0 },
        unitById,
        unitsInRadius: () => units,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        cards: perOwner(() => new Map()),
        counters: config.counters ?? [],
        effectiveDefinition: () => ({ attackRange: 200, attackInterval: 1, attackDuration: 0.4, attackHitTime: 0.2, moveSpeed: 50, bodyRadius: 12, attackProfile: { skillId: 30401, name: 'test', mode: 'projectile' } }),
        statPatches: perOwner(() => new Map()),
        skillRuntime: perOwner(() => new Map()),
        neutralSkillRuntime: new Map(),
        damageUnit: (target: ZCUnitState, damage: number) => {
            target.hp -= damage;
            hits.push({ id: target.id, damage });
            return null;
        },
        applyHitStatus: () => undefined,
        tryExecuteUnit: () => false,
        statusSystem: { statModsOf: () => ({}) },
    } as unknown as IZCAttackResolutionContext;

    state.projectiles.push({
        id: 1,
        type: 'projectile',
        owner: ZCOwner.Player,
        sourceUnitId: shooter.id,
        targetUnitId: enemyInRange.id,
        skillId: 30401,
        skillName: '连射导弹',
        effectKey: null,
        projectileKey: null,
        effectPrefabPath: ZC_BARRAGE_MISSILE_PREFAB_PATH,
        fromX: 0,
        fromY: 0,
        toX: 100,
        toY: 0,
        x: 0,
        y: 0,
        previousX: 0,
        previousY: 0,
        velocityX: 100,
        velocityY: 0,
        collisionRadius: 3,
        canHitAir: true,
        remainingPierces: 0,
        hitUnitIds: [],
        ignoresMidAirCollision: true,
        explodeOnArrival: true,
        arriveRadius: 20,
        arriveDamage: 80,
        startedAt: 0,
        durationSeconds: 1,
        sourceCardId: shooter.cardId,
        baseDamage: 80,
        targetKind: 'unit',
        targetId: enemyInRange.id,
    });

    const projectileSystem = new ZCProjectileSystem();
    const pCtx = {
        get now() { return state.elapsedSeconds; },
        get units() { return state.units; },
        distanceScale: SCALE,
        effectiveDefinition: context.effectiveDefinition,
        structureTargets: () => undefined,
        hit: () => { throw new Error('ignoresMidAirCollision 弹体不应触发 mid-air hit'); },
        arrive: (p: any) => ZCSkillResolutionSystem.resolveProjectileArrival(state, p, context),
    };
    state.elapsedSeconds = 0.5;
    projectileSystem.beginStep(state.units);
    projectileSystem.update(state.projectiles, 0.5, pCtx);
    assert.equal(hits.length, 0, '飞行中途不结算伤害');

    state.elapsedSeconds = 1.0;
    projectileSystem.beginStep(state.units);
    projectileSystem.update(state.projectiles, 0.5, pCtx);
    assert.equal(state.projectiles.length, 0, '到点后清理弹体');
    assert.deepEqual(hits.map((h) => h.id), [enemyInRange.id], '只伤害到点半径内敌军');
    assert.equal(enemyOutOfRange.hp, 1000);
    assert.equal(ally.hp, 1000);
});
