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
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import {
    ZC_BURST_IMPACT_PREFAB_PATH, burstGuardStatusId,
    zcBurstEffectPaths, zcBurstEffectScale, zcIsBurstBehavior,
} from '../assets/script/app/zcds/model/ZCBurstFx';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 13 批 · 「以自身为圆心爆一次」两条车道（2026-11-17）。
 *
 *   · 菌壶菇（68015）「菌毯爆发」101504 —— `burst_aura`：
 *     160/190/230% @半径 150 + 自护盾 12/15/18%·4s；III 级护盾期间减伤 15%；冷却 16。
 *   · 菌王菇（68018）「菌核爆裂」101804 —— `burst_knockback`：
 *     140/170/210% @半径 120 + 击退 1/1/2 格；冷却 14。
 *
 * 这一批有五个「照设计案 P 列字面配就会静默出错」的点，正是本用例要钉住的：
 *
 *  1. **参数键必须带 `burst` 前缀**。`skillParamJson` 按 `${unitId}:${pvpSkillId}` 合并成一袋，
 *     而 68015 的另一条技能（爆囊扩散 101501）**已经在同一个袋子里写了 `splashRadius` / `splashDamageRate`**
 *     ⇒ 裸写会把这张卡的普攻溅射从 38 改成 150，不报错。
 *  2. **III 级减伤没有现成 `pvpStatus` 档**。设计案 P 列原来写「走现有 damageReduce 档」，
 *     但那张表里最接近的 `vulnerability*` 是**反方向**（受到伤害提高），只能动态注册。
 *  3. **不能吃普攻射程闸门**。判据是「爆发半径内有没有人」（150 / 120 普遍大于近战普攻射程），
 *     用射程挡会变成「一群怪在 140px 处围着、战士因为普攻打不到而不放大招」。
 *  4. **打空不消费 CD**（与第 12 批同一条口径）。
 *  5. **爆点尺寸必须按事件带**。`ZCCombatEffectView` 从不按 `event.radius` 缩放，
 *     而 `普攻爆炸` 这一个 prefab 被四处共用 ⇒ 没这一格就是「看着半径 183、只有 120 内掉血」。
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

function makeUnit(id: number, owner: ZCOwner, x: number, unitId = '68015'): ZCUnitState {
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

const AURA_PARAMS: Array<Record<string, number>> = [
    { burstCooldown: 16, burstDamageRate: 1.6, burstRadius: 150, burstShieldRatio: 0.12, burstShieldSeconds: 4 },
    { burstCooldown: 16, burstDamageRate: 1.9, burstRadius: 150, burstShieldRatio: 0.15, burstShieldSeconds: 4 },
    { burstCooldown: 16, burstDamageRate: 2.3, burstRadius: 150, burstShieldRatio: 0.18, burstShieldSeconds: 4, burstShieldReducePct: 15 },
];
const KNOCK_PARAMS: Array<Record<string, number>> = [
    { burstCooldown: 14, burstDamageRate: 1.4, burstRadius: 120, burstKnockbackCells: 1 },
    { burstCooldown: 14, burstDamageRate: 1.7, burstRadius: 120, burstKnockbackCells: 1 },
    { burstCooldown: 14, burstDamageRate: 2.1, burstRadius: 120, burstKnockbackCells: 2 },
];

/**
 * 101504 已被第 43 批换成**射线集束**（用户：「科学家的射线集束给机甲菇使用，
 * 直接替换掉机甲菇的菌毯爆发，菌毯爆发弃用」）。
 *
 * 旧断言（三档倍率 / 护盾 / 冷却）不再声称是 101504 的配表值；`AURA_PARAMS` 降级为
 * `castBurstSkill` 的**纯行为夹具**（车道代码仍被别的单位用着，不在本批删除）。但**结构位**仍要钉：
 * modifierId 与解锁等级是 K 表 / 材料位的引用键，换技能不该动它们。
 * 菌毯爆发本身没被删代码（`castBurstSkill` 还有 101804 在用），只是 68015 不再挂它。
 */
test('101504 已换成射线集束：菌毯爆发弃用，三档结构位（修改器号/解锁等级）不动', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101504)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94015041, 94015042, 94015043]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [12, 24, 36], '技能 4 = 12/24/36');
    assert.deepEqual(rows.map((row) => Number(row.pvpSkillId)), [30241, 30241, 30241], '键 = 本卡普攻 skillId');
    for (const row of rows) {
        assert.equal(row.unitId, '68015');
        assert.equal(row.behaviorKey, 'ray_beam', '菌毯爆发（burst_aura）已被射线集束替换');
        assert.equal(row.statId, null, '机制全在参数袋里，主链不挂属性');
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        assert.equal('burstCooldown' in params, false, '旧车道的参数袋不许残留');
        assert.ok('rayEvery' in params, '射线集束的参数袋必须完整');
    }
    //  全表扫一遍：68015 身上再也不能出现 burst_aura（弃用就是弃用，别留一条暗车道）。
    const leftovers = readRows('pvpSkillPlan').filter(
        (row) => row.unitId === '68015' && row.behaviorKey === 'burst_aura');
    assert.deepEqual(leftovers, [], '机甲菇还挂着 burst_aura');
});

test('101804 菌核爆裂：三档倍率/击退格数/冷却与设计案一致', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101804)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94018041, 94018042, 94018043]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [12, 24, 36], '技能 4 = 12/24/36');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68018');
        assert.equal(row.behaviorKey, 'burst_knockback');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), KNOCK_PARAMS[index]);
    }
});

test('参数袋不许出现裸键（会串到普攻链路）', () => {
    prepare();
    //  101504 已换成射线集束（第 43 批），裸键守卫只剩 101804 这条真·爆发的车道。
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101804);
    assert.equal(rows.length, 3);
    for (const row of rows) {
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        for (const banned of ['splashRadius', 'splashDamageRate', 'damageRate', 'cooldown']) {
            assert.equal(banned in params, false,
                `${row.modifierId} 的参数袋里有裸键 ${banned} ⇒ 这张卡的普攻会被顺带改掉`);
        }
        assert.ok('burstCooldown' in params, `${row.modifierId} 缺 burstCooldown`);
    }
});

test('68015 的普攻溅射（爆囊扩散 101501）没有被本批带跑', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101501)
        .sort((a, b) => Number(a.modifierId) - Number(b.modifierId));
    assert.equal(rows.length, 3);
    //  同一个参数袋（`68015:30241`）里那两条技能并存 ⇒ 普攻溅射半径必须还是 38/46/55。
    assert.deepEqual(rows.map((row) => (JSON.parse(String(row.skillParamJson)) as Record<string, number>).splashRadius),
        [38, 46, 55]);
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
                && Number(row.skillChainId) !== 101504 && Number(row.skillChainId) !== 101804) continue;
            if (name === 'armySkillLevelUp' && Number(row.id) !== 101504 && Number(row.id) !== 101804) continue;
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
    const rows = readRows('armySkillLevelUp');
    //  101504 第 43 批换成射线集束：名字、描述全换，修改器号（材料位引用键）不动。
    const expectations: Array<[number, string, number[], RegExp]> = [
        [101504, '射线集束', [94015041, 94015042, 94015043], /集束射线/],
        [101804, '菌核爆裂', [94018041, 94018042, 94018043], /以自身为圆心/],
    ];
    for (const [chain, name, modifierIds, descPattern] of expectations) {
        const tiers = rows.filter((row) => Number(row.id) === chain)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(tiers.length, 3, `${chain} 应有三档`);
        for (const [index, row] of tiers.entries()) {
            assert.equal(row.name, name, `${chain} L${row.skilllevel} 还在用旧名字`);
            assert.deepEqual(row.modfiy, [modifierIds[index]]);
            assert.match(String(row.desc), descPattern, `${chain} L${row.skilllevel} 描述口径不对`);
        }
    }
    //  菌核爆裂仍是「冷却型自心圆」⇒ 这两句还必须写着。
    for (const row of rows.filter((entry) => Number(entry.id) === 101804)) {
        assert.ok(String(row.desc).includes('冷却'), '主动技能的描述必须写清冷却');
        assert.ok(String(row.desc).includes('以自身为圆心'), '自心圆爆发');
    }
    //  射线集束是「累计普攻触发」⇒ 不许再写冷却。
    for (const row of rows.filter((entry) => Number(entry.id) === 101504)) {
        assert.equal(String(row.desc).includes('冷却'), false, '101504 已经不吃冷却了');
        assert.ok(String(row.desc).includes('累计普攻'), '射线集束按累计普攻触发');
    }
});

// ────────────────────────────────────────────── 二、登记（漏一处就静默不跑）

test('burst_aura / burst_knockback 必须双登记 + 表现路径进加载清单', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    const runtimeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
    for (const key of ['burst_aura', 'burst_knockback']) {
        assert.match(schemaSource, new RegExp(`SKILL_BEHAVIORS = new Set\\(\\[[\\s\\S]*?'${key}'[\\s\\S]*?\\]\\)`),
            `ZCStatSchema.SKILL_BEHAVIORS 缺 ${key}`);
        assert.match(runtimeSource, new RegExp(`register\\('${key}'`),
            `ZCSkillRuntime 没注册 ${key} ⇒ 参数永远进不了运行时`);
    }
    assert.equal(zcIsBurstBehavior('burst_aura'), true);
    assert.equal(zcIsBurstBehavior('burst_knockback'), true);
    assert.equal(zcIsBurstBehavior('splash_shot'), false, '第 12 批的车道不许被这条判据收进来');
    assert.deepEqual(zcBurstEffectPaths('burst_knockback'), [ZC_BURST_IMPACT_PREFAB_PATH]);
    assert.deepEqual(zcBurstEffectPaths(null), [], '别的行为键不许被收进清单');

    const unit = (unitId: string) => ({ unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null } });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withBurst = buildZCVisualResourcePlan(
        [unit('68015'), unit('68018'), unit('68001')],
        { skillPlans: [plan('68015', 'burst_aura'), plan('68001', 'random_strike')], textOverrides: new Map() },
    );
    assert.ok(withBurst.effectPaths.includes(ZC_BURST_IMPACT_PREFAB_PATH), '爆点必须进加载清单');
    const withoutBurst = buildZCVisualResourcePlan(
        [unit('68001')], { skillPlans: [plan('68001', 'random_strike')], textOverrides: new Map() });
    assert.equal(withoutBurst.effectPaths.includes(ZC_BURST_IMPACT_PREFAB_PATH), false);
});

test('burstReadyAt 必须登记进快照白名单（不还原会读档白送一次爆发）', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    assert.match(codec, /'burstReadyAt'/, 'ZCSnapshotCodec 的字段白名单缺 burstReadyAt');
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    assert.match(types, /burstReadyAt\?: number/);
});

test('effectScale 的算法：屏上直径 = 逻辑直径 × 0.76875，分母是 prefab 屏上宽 282', () => {
    //  150 逻辑半径 ⇒ 屏上直径 300 × 0.76875 = 230.625 ⇒ 倍率 0.818
    assert.ok(Math.abs(zcBurstEffectScale(150) - 230.625 / 282) < 1e-9);
    assert.ok(Math.abs(zcBurstEffectScale(120) - 184.5 / 282) < 1e-9);
    assert.equal(zcBurstEffectScale(0), 1, '非法值退回 1（不能把节点缩成 0 让特效消失）');
    assert.equal(zcBurstEffectScale(Number.NaN), 1);
});

// ────────────────────────────────────────────── 三、castBurstSkill：全向爆发

const DEFINITION = {
    unitId: '68015', name: '菌壶菇', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 120, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 30241, name: '菌壶菇普攻', mode: 'melee',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function burstContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    /** 参数袋的键是 `${unitId}:${普攻 skillId}` —— 菌核爆裂挂在 68018 上。*/
    keyUnitId = '68015',
    chain = 101504,
) {
    const knocked: Array<{ id: number; distance: number }> = [];
    const statusApplied: Array<{ unitId: string; id: string; durationSeconds: number }> = [];
    const runtime = {
        skillChainId: chain, behaviorKey: 'burst_aura',
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            apply: (unitId: string, id: string, options: { durationSeconds: number }) => {
                statusApplied.push({ unitId, id, durationSeconds: options.durationSeconds });
                return { applied: true };
            },
        } as unknown as IZCAttackResolutionContext['statusSystem'],
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
            [ZCOwner.Player]: new Map([[`${keyUnitId}:30241`, runtime]]),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: () => null,
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
        applyKnockback: (target: ZCUnitState, _source: ZCUnitState, distance: number) => {
            knocked.push({ id: target.id, distance });
        },
        pushProjectile: () => undefined,
    } as unknown as IZCAttackResolutionContext;
    return { context, knocked, statusApplied };
}

test('菌毯爆发：全向命中半径 150 内的敌人，并给自己套 12% 护盾', () => {
    prepare();
    //  150 表值 × 0.3 = 45 世界 px。60 在圈外、-40 在圈内（背后也算 —— 全向，不判朝向）。
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const near = makeUnit(2, ZCOwner.Enemy, 30, '68028');
    const behind = makeUnit(3, ZCOwner.Enemy, -40, '68028');
    const far = makeUnit(4, ZCOwner.Enemy, 60, '68028');
    const units = [caster, near, behind, far];
    const state = makeState(units);
    const { context } = burstContext(units, AURA_PARAMS[0]);

    assert.equal(ZCAttackResolutionSystem.castBurstSkill(state, caster, context), true);
    assert.equal(state.combatEvents.length, 1);
    const event = state.combatEvents[0];
    assert.equal(event.type, 'area');
    assert.equal(event.effectPrefabPath, ZC_BURST_IMPACT_PREFAB_PATH);
    assert.equal(event.fromX, 0, '圆心恒等于自己');
    assert.equal(event.toX, 0);
    assert.ok(Math.abs(Number(event.radius) - 45) < 1e-6, '150 表值 × 0.3 = 45 世界 px');
    assert.ok(Math.abs(Number(event.effectScale) - zcBurstEffectScale(150)) < 1e-9,
        '爆点尺寸必须按事件带（视图不读 radius）');
    //  1000 血 × 0.12 = 120 护盾，4 秒后到期。
    assert.equal(caster.shield, 120);
    assert.equal(caster.shieldExpireAt, 4);
});

test('菌毯爆发 III 级：护盾期间的减伤状态挂到自己身上，L1/L2 不注册', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 30, '68028');
    const units = [caster, enemy];

    const tier3 = burstContext(units, AURA_PARAMS[2]);
    const guardId = burstGuardStatusId(15, 4);
    assert.equal(
        ZCAttackResolutionSystem.castBurstSkill(makeState(units), caster, tier3.context, guardId), true);
    assert.deepEqual(tier3.statusApplied,
        [{ unitId: '1', id: guardId, durationSeconds: 4 }], '减伤跟着护盾时长走');

    const tier1 = burstContext(units, AURA_PARAMS[0]);
    const fresh = makeUnit(1, ZCOwner.Player, 0);
    assert.equal(
        ZCAttackResolutionSystem.castBurstSkill(makeState([fresh, enemy]), fresh, tier1.context), true);
    assert.equal(tier1.statusApplied.length, 0, 'L1 没有 burstShieldReducePct ⇒ 不挂减伤');
});

test('菌核爆裂：爆完把命中目标推开 N 格（格数 × 一格行距）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0, '68018');
    const near = makeUnit(2, ZCOwner.Enemy, 30, '68028');
    const units = [caster, near];
    const state = makeState(units);
    const { context, knocked } = burstContext(units, KNOCK_PARAMS[2], '68018', 101804);

    assert.equal(ZCAttackResolutionSystem.castBurstSkill(state, caster, context), true);
    assert.equal(knocked.length, 1);
    assert.equal(knocked[0].id, 2);
    //  `HEX_GRID_LOGICAL_ROW_STEP` 是一格行距；世界换算由 `applyLegacyKnockback` 自己乘。
    assert.ok(knocked[0].distance > 0, '2 格的原始距离参与换算，不是 0');
    assert.equal(caster.shield, undefined, '菌核爆裂不套盾');
});

test('参数不全 / 半径内没人：返回 false（不消费 CD），且不推事件', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 30, '68028');
    const units = [caster, enemy];
    const state = makeState(units);

    const broken = burstContext(units, { burstCooldown: 16, burstRadius: 150 });
    assert.equal(ZCAttackResolutionSystem.castBurstSkill(state, caster, broken.context), false,
        '缺 burstDamageRate ⇒ 不爆');
    assert.equal(state.combatEvents.length, 0);

    //  150 表值 × 0.3 = 45 世界 px；把敌人放到 100 就够在圈外了。
    const lone = [caster, makeUnit(3, ZCOwner.Enemy, 100, '68028')];
    const loneState = makeState(lone);
    const empty = burstContext(lone, AURA_PARAMS[0]);
    assert.equal(ZCAttackResolutionSystem.castBurstSkill(loneState, caster, empty.context), false,
        '半径内没人 ⇒ 不放、不消费 CD');
    assert.equal(loneState.combatEvents.length, 0);
});

// ────────────────────────────────────────────── 四、触发系统：CD 与减伤状态

function triggerHarness(params: Record<string, number>) {
    const caster = makeUnit(1, ZCOwner.Player, 0, '68015');
    const state = makeState([caster]);
    const runtime = {
        skillChainId: 101504, behaviorKey: 'burst_aura',
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const calls: Array<string | undefined> = [];
    const registered: Array<Record<string, unknown>> = [];
    let result = true;
    let release = false;
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
        castSplashShot: () => false,
        //  普攻射程闸门：本车道**不许**读它（判据是爆发半径），这里故意给 false。
        inAttackRange: () => release,
        castBurstSkill: (_unit: ZCUnitState, guardStatusId?: string) => {
            calls.push(guardStatusId);
            return result;
        },
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return {
        caster, state, calls, registered, context,
        setResult: (value: boolean) => { result = value; },
        setRelease: (value: boolean) => { release = value; },
        step: (at: number) => {
            state.elapsedSeconds = at;
            ZCSkillTriggerSystem.tick(state, 0.05, context);
        },
    };
}

test('首次 tick 只挂 CD：到点才爆，爆完把 CD 推到 now + burstCooldown', () => {
    const harness = triggerHarness(AURA_PARAMS[0]);
    harness.step(0);
    assert.equal(harness.caster.burstReadyAt, 16, '开局不立刻放');
    assert.equal(harness.calls.length, 0);

    harness.step(15.9);
    assert.equal(harness.calls.length, 0, '没到点不许放');

    harness.step(16);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.caster.burstReadyAt, 32);
    assert.ok(harness.caster.castActionUntil != null, '爆一次要刷施法动作窗口');
});

test('不吃普攻射程闸门：inAttackRange 为 false 也照放', () => {
    const harness = triggerHarness(AURA_PARAMS[0]);
    harness.setRelease(false);
    harness.step(0);
    harness.step(16);
    assert.equal(harness.calls.length, 1,
        '爆发判据是「半径内有没有人」，不是「普攻够不够得着」—— 否则近战永远放不出大招');
});

test('打空不消费 CD：castBurstSkill 返回 false 时 burstReadyAt 原地不动', () => {
    const harness = triggerHarness(AURA_PARAMS[0]);
    harness.step(0);
    harness.setResult(false);
    harness.step(20);
    assert.equal(harness.calls.length, 1, '尝试过，但被拒');
    assert.equal(harness.caster.burstReadyAt, 16, '被拒 ⇒ 冷却保持就绪，下帧重试');
});

test('III 级的减伤是按参数签名动态注册的状态（pvpStatus 里没有通用减伤档）', () => {
    const harness = triggerHarness(AURA_PARAMS[2]);
    harness.step(0);
    harness.step(16);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0], burstGuardStatusId(15, 4), '状态 id 由百分点 + 秒数拼出来');
    assert.equal(harness.registered.length, 1);
    const definition = harness.registered[0];
    assert.equal(Number(definition.durationSeconds), 4);
    assert.deepEqual(definition.statMods, { damageTakenPct: -15 }, '百分点口径，-15 = 受到伤害 −15%');
});

test('L1 / L2 没有减伤参数 ⇒ 既不注册状态、也不传 id', () => {
    const harness = triggerHarness(AURA_PARAMS[0]);
    harness.step(0);
    harness.step(16);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0], undefined);
    assert.equal(harness.registered.length, 0);
});
