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
    ZCAttackResolutionSystem, type IZCAttackResolutionContext } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCSkillResolutionSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { ZC_EFFECT_BEHAVIOR_KEYS, ZC_EFFECT_PATHS, zcEffectPathsForBehavior } from '../assets/script/app/zcds/model/ZCEffectCatalog';
import { splashShotSlowStatusId } from '../assets/script/app/zcds/model/ZCEffectTuning';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 12 批 · 「冷却到点射一枚会爆开的弹」车道（2026-11-17）。
 *
 *   · 水手菇（68011）「孢子凝珠」101104 —— `spore_burst`：60/75/90% + 半径 90 + 减速 15/20/25%·2/2/3s。
 *   · 风炮菇（68013）「孢爆箭」101303 **已于 2026-11-18 第 16 批改口径**（设计案重写为
 *     「慢速风弹 + 命中点留飓风」，`behaviorKey` 从 `splash_shot` 换成 `wind_bolt`），
 *     新口径的配表/实现/表现全部由 `tests/zcds-wind-barrage-batch16.test.ts` 覆盖。
 *     ⇒ 本文件里 101303 的旧配表断言已随口径一起撤掉；`splash_shot` 这条车道本身
 *     （`resolveSplashShot` / `applySplashShot` / `splashReadyAt`）仍在服役、由 101104 复用，
 *     下面的通用能力用例继续钉它，样例参数取的是原 101303 那一版数值。
 *
 * 这一批有四个「照设计案 P 列字面配就会静默出错」的点，正是本用例要钉住的：
 *
 *  1. **参数键必须带 `shot` 前缀**。`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，
 *     而 `splashRadius` / `splashDamageRate` 这两个键**普攻链路也在读**（爆囊扩散那套）。
 *     写裸键 ⇒ 给主动技能配的 90px 溅射会顺带把这张卡**每次普攻**也变成 90px 溅射，不报错。
 *  2. **旁溅倍率必须给 1**。`resolveProjectileHit` 里 `splashDamageRate ?? 1`，
 *     但 `strikeTargets` 只有在 `> 0` 时才往弹体上写 —— 给 0 就等于「飞过去、什么都不炸」。
 *  3. **减速状态按档位变比例**，装不进 `pvpStatus` 那张定值档，只能按「参数签名」动态注册
 *     （与友军光环 `__aura:` 同一套做法）。
 *  4. **打空不消费 CD**。射程内没人 / 锁定目标跑远了都不推进 `splashReadyAt`，
 *     否则单位在跑位途中会把这一次机会空转掉。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const ROOT = process.cwd();

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function readClient(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(
        `D:/Alan/Project/POW/doc/塔防数据配置/json/client/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { data: Array<Record<string, unknown>> };
    return Array.isArray(source) ? source : source.data;
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

//  溅射车道的样例参数（原 101303 那一版数值）。101303 改口径后这条车道在配表里
//  只剩 101104 孢子凝珠在用，样例留在这里是给下面的 `resolveSplashShot` /
//  `applySplashShot` 通用能力用例当入参，不再代表任何一条在线的技能档位。
const SHOT_PARAMS: Array<Record<string, number>> = [
    { shotCooldown: 12, shotDamageRate: 0.9, shotRadius: 90 },
    { shotCooldown: 12, shotDamageRate: 1.1, shotRadius: 110 },
    { shotCooldown: 11, shotDamageRate: 1.3, shotRadius: 130 },
];
const SPORE_PARAMS: Array<Record<string, number>> = [
    { shotCooldown: 12, shotDamageRate: 0.6, shotRadius: 90, shotSlowRatio: 15, shotSlowSeconds: 2 },
    { shotCooldown: 12, shotDamageRate: 0.75, shotRadius: 90, shotSlowRatio: 20, shotSlowSeconds: 2 },
    { shotCooldown: 12, shotDamageRate: 0.9, shotRadius: 90, shotSlowRatio: 25, shotSlowSeconds: 3 },
];

test('101104 孢子凝珠：三档减速 15/20/25%·2/2/3s，半径恒定 90', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101104)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94011041, 94011042, 94011043]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [7, 24, 36], '技能 4 = 7/24/36');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68011');
        assert.equal(row.behaviorKey, 'spore_burst');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), SPORE_PARAMS[index]);
    }
});

test('参数袋不许出现裸键（会串到普攻链路）', () => {
    prepare();
    //  101303 的袋子由 batch16 用例单独管（它的四把键换成了 `wind*`），
    //  这里只扫还留在这条车道上的 101104。
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101104);
    assert.equal(rows.length, 3);
    for (const row of rows) {
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        for (const banned of ['splashRadius', 'splashDamageRate', 'damageRate', 'cooldown']) {
            assert.equal(banned in params, false,
                `${row.modifierId} 的参数袋里有裸键 ${banned} ⇒ 这张卡的普攻会被顺带改掉`);
        }
        assert.ok('shotCooldown' in params, `${row.modifierId} 缺 shotCooldown`);
    }
});

test('两份产物逐格一致：pvpSkillPlan / armySkillLevelUp', () => {
    prepare();
    for (const name of ['pvpSkillPlan', 'armySkillLevelUp']) {
        const remote = readRows(name);
        const client = readClient(name);
        assert.equal(remote.length, client.length, `${name} 两份行数不一致`);
        const key = name === 'pvpSkillPlan' ? 'modifierId' : 'id';
        const clientById = new Map(client.map((row) => [String(row[key]) + ':' + String(row.skillLevel ?? row.skilllevel), row]));
        for (const row of remote) {
            if (name === 'pvpSkillPlan'
                && Number(row.skillChainId) !== 101303 && Number(row.skillChainId) !== 101104) continue;
            if (name === 'armySkillLevelUp' && Number(row.id) !== 101303 && Number(row.id) !== 101104) continue;
            const match = clientById.get(String(row[key]) + ':' + String(row.skillLevel ?? row.skilllevel));
            assert.ok(match, `${name} client 版缺 ${row[key]}`);
            for (const column of Object.keys(match!)) {
                assert.equal(String(row[column]), String(match![column]),
                    `${name} ${row[key]} 的 ${column} 两份不一致`);
            }
        }
    }
});

test('K 表（armySkillLevelUp）：名字/描述/修改器号三档都指向新技能', () => {
    prepare();
    //  101303 / 101304 的 K 表三档由 batch16 用例管（它们已不在 `splash_shot` 车道上）。
    const rows = readRows('armySkillLevelUp');
    const expectations: Array<[number, string, number[], string[]]> = [
        [101104, '孢子凝珠', [94011041, 94011042, 94011043], ['孢子凝珠', '冷却']],
    ];
    for (const [chain, name, modifierIds, keywords] of expectations) {
        const tiers = rows.filter((row) => Number(row.id) === chain)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(tiers.length, 3, `${chain} 应有三档`);
        for (const [index, row] of tiers.entries()) {
            assert.equal(row.name, name, `${chain} L${row.skilllevel} 还在用旧名字`);
            assert.deepEqual(row.modfiy, [modifierIds[index]]);
            for (const keyword of keywords) {
                assert.ok(String(row.desc).includes(keyword),
                    `${chain} L${row.skilllevel} 的描述里没有「${keyword}」`);
            }
        }
    }
});

// ────────────────────────────────────────────── 二、登记（漏一处就静默不跑）

test('splash_shot / spore_burst 必须双登记 + 表现路径进加载清单', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    for (const key of ['splash_shot', 'spore_burst']) {
        assert.match(schemaSource, new RegExp(`SKILL_BEHAVIORS = new Set\\(\\[[\\s\\S]*?'${key}'[\\s\\S]*?\\]\\)`),
            `ZCStatSchema.SKILL_BEHAVIORS 缺 ${key}`);
        const runtimeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
        assert.match(runtimeSource, new RegExp(`register\\('${key}'`),
            `ZCSkillRuntime 没注册 ${key} ⇒ 参数永远进不了运行时`);
    }
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.splashShot),
        [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact]);
    assert.deepEqual(zcEffectPathsForBehavior(ZC_EFFECT_BEHAVIOR_KEYS.sporeBurst),
        [ZC_EFFECT_PATHS.splashMissile, ZC_EFFECT_PATHS.burstImpact]);
    assert.deepEqual(zcEffectPathsForBehavior(null), [], '别的行为键不许被收进清单');

    //  资源清单：本局有这条车道的单位才收它的两条 prefab。
    const unit = (unitId: string) => ({ unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null } });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withShot = buildZCVisualResourcePlan(
        [unit('68013'), unit('68011'), unit('68001')],
        { skillPlans: [plan('68013', 'splash_shot'), plan('68011', 'random_strike')], textOverrides: new Map() },
    );
    assert.ok(withShot.effectPaths.includes(ZC_EFFECT_PATHS.splashMissile), '弹体必须进加载清单');
    assert.ok(withShot.effectPaths.includes(ZC_EFFECT_PATHS.burstImpact), '爆点必须进加载清单');
    const withoutShot = buildZCVisualResourcePlan(
        [unit('68001')], { skillPlans: [plan('68001', 'random_strike')], textOverrides: new Map() });
    assert.equal(withoutShot.effectPaths.includes(ZC_EFFECT_PATHS.splashMissile), false);
});

test('splashReadyAt 必须登记进快照白名单（不还原会读档白送一发）', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    assert.match(codec, /'splashReadyAt'/, 'ZCSnapshotCodec 的字段白名单缺 splashReadyAt');
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    assert.match(types, /splashReadyAt\?: number/);
});

// ────────────────────────────────────────────── 三、castSplashShot：发弹形态

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

function shotContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    target: { id: number; x: number; y: number } | null,
    /** 参数袋的键是 `${unitId}:${普攻 skillId}` —— 孢子凝珠挂在 68011 上，键就不是 68013 了。*/
    keyUnitId = '68013',
) {
    const pushed: Array<Record<string, unknown>> = [];
    const runtime = {
        //  链号只是标签：这条车道上现在已经没有 101303（它改成 `wind_bolt` 了），
        //  用 101104 更贴近实况 —— 唯一还在 `splash_shot` 上跑的就是孢子凝珠。
        skillChainId: 101104, behaviorKey: 'splash_shot',
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_unit: ZCUnitState, damage: number) =>
            ({ value: Math.round(damage), kind: 'damage', x: 0, y: 0 }) as unknown as ZCFloatText,
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            [ZCOwner.Player]: new Map([[`${keyUnitId}:30401`, runtime]]),
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

test('溅射车道：射一枚弹，弹体带弹体/爆点特效、爆点半径 = 表值 × 0.3、旁溅同额', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context, pushed } = shotContext(units, SHOT_PARAMS[0], { id: enemy.id, x: 40, y: 0 });

    assert.equal(ZCSkillResolutionSystem.castSplashShot(state, caster, context), true);
    assert.equal(pushed.length, 1, '一次施法只射一枚');
    const projectile = pushed[0];
    assert.equal(projectile.effectPrefabPath, ZC_EFFECT_PATHS.splashMissile);
    assert.equal(projectile.impactEffectPrefabPath, ZC_EFFECT_PATHS.burstImpact);
    //  90 表值 px × combatDistanceScale 0.3 = 27 世界 px（屏上 90 × 0.76875 ≈ 69px）
    assert.ok(Math.abs(Number(projectile.splashRadius) - 27) < 1e-6);
    assert.equal(projectile.splashDamageRate, 1, '旁溅必须与直击同额（给 0 就等于不炸）');
    assert.ok(Number(projectile.baseDamage) > 0);
    assert.equal(projectile.onHitStatusId, undefined, '样例参数不带减速 ⇒ 弹体上不许挂状态 id');
});

test('孢子凝珠：命中状态跟着弹体走（不是「出手就挂」）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0, '68011');
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);
    const { context, pushed } = shotContext(units, SPORE_PARAMS[0], { id: enemy.id, x: 40, y: 0 }, '68011');
    const slowId = splashShotSlowStatusId(15, 2);
    assert.equal(ZCSkillResolutionSystem.castSplashShot(state, caster, context, slowId), true);
    assert.equal(pushed[0].onHitStatusId, slowId,
        '减速必须随弹体在命中时挂（`resolveProjectileHit` 读 `onHitStatusId`）');
});

test('参数不全 / 目标跑出射程 / 射程内没人：返回 false 且不推弹', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 40, '68028');
    const units = [caster, enemy];
    const state = makeState(units);

    const broken = shotContext(units, { shotCooldown: 12, shotRadius: 90 }, { id: enemy.id, x: 40, y: 0 });
    assert.equal(ZCSkillResolutionSystem.castSplashShot(state, caster, broken.context), false,
        '缺 shotDamageRate ⇒ 不出弹');
    assert.equal(broken.pushed.length, 0);

    //  锁定目标在射程外（attackRange 500 表值 ≈ 150 世界 px；这里放到 400）
    const far = makeUnit(3, ZCOwner.Enemy, 400, '68028');
    const farUnits = [caster, far];
    const farState = makeState(farUnits);
    const outside = shotContext(farUnits, SHOT_PARAMS[0], { id: far.id, x: 400, y: 0 });
    assert.equal(ZCSkillResolutionSystem.castSplashShot(farState, caster, outside.context), false,
        '锁定目标跑出射程 ⇒ 不放，也不换目标');
    assert.equal(outside.pushed.length, 0);
});

// ────────────────────────────────────────────── 四、触发系统：CD 与减速状态

function triggerHarness(params: Record<string, number>) {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68011');
    const state = makeState([caster]);
    const runtime = {
        skillChainId: 101104, behaviorKey: 'spore_burst',
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const calls: Array<string | undefined> = [];
    const registered: Array<Record<string, unknown>> = [];
    let result = true;
    const context = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: () => false,
            register: (definition: Record<string, unknown>) => { registered.push(definition); },
        },
        runtimeOf: () => runtime,
        fireBurst: () => undefined,
        castSecondary: () => false,
        castSplashShot: (_unit: ZCUnitState, slowStatusId?: string) => {
            calls.push(slowStatusId);
            return result;
        },
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return {
        caster, state, calls, registered, context,
        setResult: (value: boolean) => { result = value; },
        step: (at: number) => {
            state.elapsedSeconds = at;
            ZCSkillTriggerSystem.tick(state, 0.05, context);
        },
    };
}

test('首次 tick 只挂 CD：到点才射，射完把 CD 推到 now + shotCooldown', () => {
    const harness = triggerHarness(SPORE_PARAMS[0]);
    harness.step(0);
    assert.equal(harness.caster.splashReadyAt, 12, '开局不立刻放');
    assert.equal(harness.calls.length, 0);

    harness.step(11.9);
    assert.equal(harness.calls.length, 0, '没到点不许放');

    harness.step(12);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.caster.splashReadyAt, 24);
    assert.ok(harness.caster.castActionUntil != null, '射一发要刷施法动作窗口');
});

test('打空不消费 CD：射程内没人时 splashReadyAt 原地不动', () => {
    const harness = triggerHarness(SHOT_PARAMS[0]);
    harness.step(0);
    harness.setResult(false);
    harness.step(20);
    assert.equal(harness.calls.length, 1, '尝试过，但被拒');
    assert.equal(harness.caster.splashReadyAt, 12, '被拒 ⇒ 冷却保持就绪，下帧重试');
});

test('孢子凝珠的减速是按参数签名动态注册的状态（不是 pvpStatus 定值档）', () => {
    const harness = triggerHarness(SPORE_PARAMS[2]);
    harness.step(0);
    harness.step(12);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0], splashShotSlowStatusId(25, 3), '状态 id 由百分点 + 秒数拼出来');
    assert.equal(harness.registered.length, 1);
    const definition = harness.registered[0];
    assert.equal(Number(definition.durationSeconds), 3);
    assert.deepEqual(definition.statMods, { moveSpeedPct: -25 }, '百分点口径，-25 = 移速 −25%');
});

test('溅射车道没配减速参数 ⇒ 既不注册状态、也不往弹体挂 id', () => {
    const harness = triggerHarness(SHOT_PARAMS[0]);
    harness.step(0);
    harness.step(12);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0], undefined);
    assert.equal(harness.registered.length, 0);
});
