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
    ZCAttackResolutionSystem, type IZCAttackResolutionContext, type IZCChargeDashOptions,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import { zcCombatEffectAnchorOf } from '../assets/script/app/zcds/view/ZCCombatEffectPlacement';
import { zcCombatEffectNodeScaleOf } from '../assets/script/app/zcds/view/ZCCombatEffectScale';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../assets/script/core/hex/HexGridLayout';
import {
    ZC_CHARGE_SHIELD_BEHAVIOR_KEY, ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_EFFECT_SECONDS,
    ZC_DASH_GUARD_PREFAB_PATH, ZC_DASH_GUARD_SECONDS, ZC_LEGACY_DASH_BEHAVIOR_KEY,
    dashGuardStatusId, dashVulnerableStatusId,
    zcChargeEffectPaths, zcIsChargeBehavior,
} from '../assets/script/app/zcds/model/ZCDashFx';
import { singleStrikeStunStatusId } from '../assets/script/app/zcds/model/ZCSingleStrikeFx';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 15 批 · 「冲锋」车道三条技能（2026-11-17）。
 *
 *   · 菇八戒（68012）「菌盾冲锋」101204 —— `charge_shield`：
 *     100/120/140% @朝目标方向定长 1 格；护盾 12/15/18% 最大生命 · 3/3/4s；冷却恒 12。
 *   · 南瓜战神（68023）「冲锋」102303 —— `legacy_dash`：
 *     100/140/220% @朝最近敌人 + 眩晕 1/1.5/2s；III 级落地受伤 −25%·3s；冷却恒 12。
 *   · 爆锤莲王（68027）「尖刺冲锋」102703 —— `legacy_dash`：
 *     120/160/220% @朝面朝方向；II/III 级易伤 20%·4s / 破甲 35%·6s；III 级落地护盾 20%·4s。
 *
 * 这一批要钉住的四点：
 *
 *  1. **命中集合是一整条线段**（起点 → 落点），不是圆、也不是扇形。用 `strikeTargets`
 *     （圆形）或 `castFanSweep`（扇形）都表达不了「从两个怪中间穿过去两个都挨」。
 *  2. **命中 0 人也消费 CD、落地自保照样生效**（人已经冲出去了）—— 与扇形 / 爆发 / 突刺
 *     「打不出去不消费 CD」刻意相反。
 *  3. **`damageTakenPct` 一个字段两个方向**：102703 的破甲是正值（受伤提高），
 *     102303 的自减伤是负值（受伤降低）。写反一处就是「自保变成自残」，且不报错。
 *  4. **`轻骑兵_冲锋` 的锚点必须是 `midpoint`**：视图没有「沿路径平移」这条通道，
 *     只写 `from`（起冲点）会变成「原地挥一下然后瞬移」。
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

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = '68012'): ZCUnitState {
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
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;
}

// ────────────────────────────────────────────── 一、配表真值

const CHARGE_PARAMS: Array<Record<string, number>> = [
    { chargeCooldown: 12, chargeDamageRate: 1.0, chargeCells: 1, chargeHitRadius: 40, chargeShieldRatio: 0.12, chargeShieldSeconds: 3 },
    { chargeCooldown: 12, chargeDamageRate: 1.2, chargeCells: 1, chargeHitRadius: 40, chargeShieldRatio: 0.15, chargeShieldSeconds: 3 },
    { chargeCooldown: 12, chargeDamageRate: 1.4, chargeCells: 1, chargeHitRadius: 40, chargeShieldRatio: 0.18, chargeShieldSeconds: 4 },
];

const DASH_2303_PARAMS: Array<Record<string, number>> = [
    { dashCooldown: 12, dashDamageRate: 1.0, dashCells: 3, dashHitRadius: 40, dashTowardNearest: 1, dashSearchRadius: 300, dashStunSeconds: 1 },
    { dashCooldown: 12, dashDamageRate: 1.4, dashCells: 3, dashHitRadius: 40, dashTowardNearest: 1, dashSearchRadius: 300, dashStunSeconds: 1.5 },
    {
        dashCooldown: 12, dashDamageRate: 2.2, dashCells: 3, dashHitRadius: 40, dashTowardNearest: 1,
        dashSearchRadius: 300, dashStunSeconds: 2, dashGuardReducePct: 25, dashGuardSeconds: 3,
    },
];

const DASH_2703_PARAMS: Array<Record<string, number>> = [
    { dashCooldown: 12, dashDamageRate: 1.2, dashCells: 2, dashHitRadius: 40, dashTowardNearest: 0 },
    { dashCooldown: 12, dashDamageRate: 1.6, dashCells: 2, dashHitRadius: 40, dashTowardNearest: 0, dashVulnerablePct: 20, dashVulnerableSeconds: 4 },
    {
        dashCooldown: 12, dashDamageRate: 2.2, dashCells: 2, dashHitRadius: 40, dashTowardNearest: 0,
        dashVulnerablePct: 35, dashVulnerableSeconds: 6, dashShieldRatio: 0.2, dashShieldSeconds: 4,
    },
];

test('101204 菌盾冲锋：三档倍数/护盾/冷却与设计案一致', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101204)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94012041, 94012042, 94012043]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [12, 24, 36], '技能 4 = 12/24/36');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68012');
        assert.equal(row.pvpSkillId, 30271, '键 = 本卡普攻 skillId');
        assert.equal(row.behaviorKey, 'charge_shield');
        assert.equal(row.skillKind, 'active_cd');
        assert.equal(row.statId, null, '机制全在参数袋里，主链不挂属性');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), CHARGE_PARAMS[index]);
    }
});

test('102303 冲锋 / 102703 尖刺冲锋：三档与设计案一致，III 级才带自保', () => {
    prepare();
    const cases: Array<[number, string, Array<Record<string, number>>, number]> = [
        [102303, '68023', DASH_2303_PARAMS, 30216],
        [102703, '68027', DASH_2703_PARAMS, 30241],
    ];
    for (const [chain, unitId, params, pvpSkillId] of cases) {
        const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === chain)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(rows.length, 3, `${chain} 应有三档`);
        assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [9, 18, 27], '技能 3 = 9/18/27');
        for (const [index, row] of rows.entries()) {
            assert.equal(row.unitId, unitId);
            assert.equal(row.pvpSkillId, pvpSkillId);
            assert.equal(row.behaviorKey, 'legacy_dash', '两条冲锋共用同一个行为键');
            assert.deepEqual(JSON.parse(String(row.skillParamJson)), params[index]);
        }
    }
    //  102303 的「自身减伤」只在自己 III 级；102703 的「自身护盾」同理。
    const guardOnOther = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === 102303)
        .filter((row) => 'dashGuardReducePct' in JSON.parse(String(row.skillParamJson)));
    assert.deepEqual(guardOnOther.map((row) => Number(row.skillLevel)), [3]);
    const shieldOnOther = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === 102703)
        .filter((row) => 'dashShieldRatio' in JSON.parse(String(row.skillParamJson)));
    assert.deepEqual(shieldOnOther.map((row) => Number(row.skillLevel)), [3]);
});

test('参数袋不许出现裸键（会串到普攻溅射 / 投枪 / 别的车道）', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => [101204, 102303, 102703]
        .includes(Number(row.skillChainId)));
    assert.equal(rows.length, 9);
    for (const row of rows) {
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        for (const banned of ['splashRadius', 'splashDamageRate', 'burstRadius', 'burstDamageRate',
            'lanceDamageRate', 'lancePierceCount', 'damageRate', 'cooldown', 'radius']) {
            assert.equal(banned in params, false,
                `${row.modifierId} 的参数袋里有裸键 ${banned} ⇒ 这张卡别的车道会被顺带改掉`);
        }
        const need = Number(row.skillChainId) === 101204 ? 'chargeCooldown' : 'dashCooldown';
        assert.ok(need in params, `${row.modifierId} 缺 ${need}（少了它整条车道静默不跑）`);
    }
});

test('68027 既有两条车道没被本批带跑（普攻溅射 38/46/55、投枪每 4/3/2 次）', () => {
    prepare();
    const splash = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 102701)
        .sort((a, b) => Number(a.modifierId) - Number(b.modifierId));
    assert.deepEqual(
        splash.map((row) => (JSON.parse(String(row.skillParamJson)) as Record<string, number>).splashRadius),
        [38, 46, 55]);
    const lance = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 102702)
        .sort((a, b) => Number(a.modifierId) - Number(b.modifierId));
    assert.deepEqual(
        lance.map((row) => (JSON.parse(String(row.skillParamJson)) as Record<string, number>).lanceEvery),
        [4, 3, 2]);
});

test('两份产物逐格一致：pvpSkillPlan / armySkillLevelUp', () => {
    prepare();
    for (const name of ['pvpSkillPlan', 'armySkillLevelUp']) {
        const remote = readRows(name);
        const client = readClient(name);
        assert.equal(remote.length, client.length, `${name} 两份行数不一致`);
        const key = name === 'pvpSkillPlan' ? 'modifierId' : 'id';
        const clientById = new Map(client.map((row) => [String(row[key]) + ':' + String(row.skillLevel ?? row.skilllevel), row]));
        const wantChain = (value: number) => value === 101204 || value === 102303 || value === 102703;
        for (const row of remote) {
            if (name === 'pvpSkillPlan' && !wantChain(Number(row.skillChainId))) continue;
            if (name === 'armySkillLevelUp' && !wantChain(Number(row.id))) continue;
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
    const expectations: Array<[number, string, number[]]> = [
        [101204, '菌盾冲锋', [94012041, 94012042, 94012043]],
        [102303, '冲锋', [94023031, 94023032, 94023033]],
        [102703, '尖刺冲锋', [94027031, 94027032, 94027033]],
    ];
    for (const [chain, name, modifierIds] of expectations) {
        const tiers = rows.filter((row) => Number(row.id) === chain)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(tiers.length, 3, `${chain} 应有三档`);
        for (const [index, row] of tiers.entries()) {
            assert.equal(row.name, name, `${chain} L${row.skilllevel} 还在用旧名字/空名字`);
            assert.deepEqual(row.modfiy, [modifierIds[index]]);
            assert.ok(String(row.desc).includes('冷却'), '主动技能的描述必须写清冷却');
        }
    }
});

// ────────────────────────────────────────────── 二、登记与表现

test('charge_shield / legacy_dash 必须双登记 + 两个 prefab 都进加载清单', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    const runtimeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
    for (const key of [ZC_CHARGE_SHIELD_BEHAVIOR_KEY, ZC_LEGACY_DASH_BEHAVIOR_KEY]) {
        assert.match(schemaSource, new RegExp(`SKILL_BEHAVIORS = new Set\\(\\[[\\s\\S]*?'${key}'[\\s\\S]*?\\]\\)`),
            `ZCStatSchema.SKILL_BEHAVIORS 缺 ${key}`);
        assert.match(runtimeSource, new RegExp(`register\\('${key}'`),
            `ZCSkillRuntime 没注册 ${key} ⇒ 参数永远进不了运行时`);
    }
    assert.equal(zcIsChargeBehavior(ZC_CHARGE_SHIELD_BEHAVIOR_KEY), true);
    assert.equal(zcIsChargeBehavior(ZC_LEGACY_DASH_BEHAVIOR_KEY), true);
    assert.equal(zcIsChargeBehavior('fan_slow'), false, '第 14 批的车道不许被这条判据收进来');
    assert.equal(zcIsChargeBehavior('blink_strike'), false, '闪现不是冲锋（它命中一个、不扫整条线）');
    assert.deepEqual(zcChargeEffectPaths(ZC_CHARGE_SHIELD_BEHAVIOR_KEY),
        [ZC_DASH_EFFECT_PREFAB_PATH, ZC_DASH_GUARD_PREFAB_PATH]);
    assert.deepEqual(zcChargeEffectPaths(null), []);

    const unit = (unitId: string) => ({ unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null } });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withDash = buildZCVisualResourcePlan(
        [unit('68012'), unit('68023'), unit('68027'), unit('68001')],
        {
            skillPlans: [
                plan('68012', 'charge_shield'), plan('68023', 'legacy_dash'),
                plan('68027', 'legacy_dash'), plan('68001', 'random_strike'),
            ],
            textOverrides: new Map(),
        },
    );
    assert.ok(withDash.effectPaths.includes(ZC_DASH_EFFECT_PREFAB_PATH),
        '轻骑兵_冲锋此前没有技能在用 ⇒ 漏收就是「照常结算、屏幕上不播」');
    assert.ok(withDash.effectPaths.includes(ZC_DASH_GUARD_PREFAB_PATH), '102303 III 级的护盾表现也要进清单');
    const without = buildZCVisualResourcePlan(
        [unit('68001')], { skillPlans: [plan('68001', 'random_strike')], textOverrides: new Map() });
    assert.equal(without.effectPaths.includes(ZC_DASH_EFFECT_PREFAB_PATH), false);
});

test('chargeReadyAt / dashReadyAt 必须登记进快照白名单（不还原会读档白送一次冲锋）', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['chargeReadyAt', 'dashReadyAt']) {
        assert.match(codec, new RegExp(`'${key}'`), `ZCSnapshotCodec 的字段白名单缺 ${key}`);
    }
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    assert.match(types, /chargeReadyAt\?: number/);
    assert.match(types, /dashReadyAt\?: number/);
});

test('表现：残影锚点是线段中点、两个路径倍率都在表里', () => {
    //  视图没有「沿路径平移」这条通道（`ZCCombatEffectView` 只按锚点定位一次），
    //  所以冲锋只能画在路的中间；只写 `from` 的话锚点退化成起点。
    assert.equal(zcCombatEffectAnchorOf(ZC_DASH_EFFECT_PREFAB_PATH), 'midpoint');
    assert.equal(zcCombatEffectAnchorOf(ZC_DASH_GUARD_PREFAB_PATH), 'caster', '护盾贴在落点的自己身上');
    //  300×140 的武将技画布缩到行程的约 2 倍；100×100 的护盾按设计原话缩 55%。
    assert.ok(Math.abs(zcCombatEffectNodeScaleOf(ZC_DASH_EFFECT_PREFAB_PATH) - 0.4) < 1e-9);
    assert.ok(Math.abs(zcCombatEffectNodeScaleOf(ZC_DASH_GUARD_PREFAB_PATH) - 0.55) < 1e-9);
    //  两条 prefab 的时长口径不同：残影是**静态单帧**（时长由设计给的 0.3s 定），
    //  护盾是**17 帧序列**（时长必须按帧数走完，截短会播一半就消失）。
    assert.ok(Math.abs(ZC_DASH_EFFECT_SECONDS - 0.3) < 1e-9);
    assert.ok(Math.abs(ZC_DASH_GUARD_SECONDS - 17 / 12) < 1e-9);
    assert.ok(ZC_DASH_GUARD_SECONDS > ZC_DASH_EFFECT_SECONDS);
});

// ────────────────────────────────────────────── 三、castChargeDash：线段命中

const DEFINITION = {
    unitId: '68012', name: '菇八戒', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 45, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 30271, name: '菇八戒普攻', mode: 'melee',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function dashContext(units: ZCUnitState[], applied: Array<{ unitId: string; id: string }>,
    damaged: number[] = []) {
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: {
            statModsOf: () => ({}),
            apply: (unitId: string, id: string) => { applied.push({ unitId, id }); return { applied: true }; },
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: () => true,
        } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => {
            damaged.push(target.id);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            [ZCOwner.Player]: new Map([['68012:30271', {
                skillChainId: 101204, behaviorKey: 'charge_shield',
                trigger: 'none', stateMode: 'none', parameters: CHARGE_PARAMS[0],
            } as unknown as ZCSkillRuntimeDefinition]]),
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
        applyKnockback: () => undefined,
        pushProjectile: () => undefined,
    } as unknown as IZCAttackResolutionContext;
    return context;
}

function options(overrides: Partial<IZCChargeDashOptions> = {}): IZCChargeDashOptions {
    return {
        origin: { x: 0, y: 0 },
        destination: { x: 20, y: 0 },
        hitRadius: 40 * 0.3,       // 12 世界 px
        damageRate: 1,
        ...overrides,
    };
}

test('冲锋按「点到线段距离」收人：路上三个都吃，线外的不吃', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  线段 (0,0) → (20,0)、判定宽 12 ⇒ 这三个都在路上。
    const start = makeUnit(2, ZCOwner.Enemy, 1, 4);
    const middle = makeUnit(3, ZCOwner.Enemy, 10, -8);
    const end = makeUnit(4, ZCOwner.Enemy, 19, 6);
    //  线段外：侧向 20（超出判定宽）、以及「落点前方」—— 后者专门钉「不能退化成整条直线」。
    const beside = makeUnit(5, ZCOwner.Enemy, 10, 20);
    const beyond = makeUnit(6, ZCOwner.Enemy, 40, 0);
    const units = [caster, start, middle, end, beside, beyond];
    const state = makeState(units);
    const applied: Array<{ unitId: string; id: string }> = [];
    const damaged: number[] = [];
    const hits = ZCAttackResolutionSystem.castChargeDash(
        state, caster, dashContext(units, applied, damaged), options());

    assert.equal(hits, 3, '撞到的人数');
    assert.deepEqual(damaged.sort((a, b) => a - b), [2, 3, 4]);
    assert.equal(damaged.includes(6), false, '落点前方的怪不在冲锋路径上（不能按整条直线算）');
    assert.equal(state.combatEvents.length, 0, 'castChargeDash 只管结算，残影事件由触发系统推');
});

test('命中 0 人也照样给护盾 / 挂减伤（人已经冲出去了）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const units = [caster];
    const state = makeState(units);
    const applied: Array<{ unitId: string; id: string }> = [];
    const guardId = dashGuardStatusId(25, 3);
    const hits = ZCAttackResolutionSystem.castChargeDash(state, caster, dashContext(units, applied),
        options({ shieldRatio: 0.12, shieldSeconds: 3, guardStatusId: guardId, guardSeconds: 3 }));

    assert.equal(hits, 0);
    assert.equal(caster.shield, 120, '12% × 1000 最大生命');
    assert.equal(caster.shieldExpireAt, 3);
    assert.deepEqual(applied.map((item) => item.id), [guardId]);
    assert.equal(applied[0].unitId, '1', '减伤挂在自己身上');
    //  减伤不是护盾 ⇒ 按设计案 O 列在落点补一条 `刀盾兵_护盾`，纯表现。
    const guardFx = state.combatEvents.filter((event) => event.effectPrefabPath === ZC_DASH_GUARD_PREFAB_PATH);
    assert.equal(guardFx.length, 1);
    assert.equal(guardFx[0].damage, 0);
    assert.equal(guardFx[0].fromX, 20, '画在落点，不是起冲点');
    assert.ok(Math.abs(Number(guardFx[0].durationSeconds) - ZC_DASH_GUARD_SECONDS) < 1e-9);
});

test('伤害取一份：路上所有人吃同一个数，暴击按最近那个算一次', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const units = [caster, makeUnit(2, ZCOwner.Enemy, 6), makeUnit(3, ZCOwner.Enemy, 14)];
    const state = makeState(units);
    const applied: Array<{ unitId: string; id: string }> = [];
    const damaged: number[] = [];
    const values: number[] = [];
    const context = dashContext(units, applied, damaged);
    const raw = context.damageUnit;
    (context as unknown as { damageUnit: typeof raw }).damageUnit =
        (target: ZCUnitState, damage: number, source?: unknown) => {
            values.push(damage);
            return (raw as unknown as (t: ZCUnitState, d: number, s?: unknown) => ZCFloatText)(target, damage, source);
        };
    ZCAttackResolutionSystem.castChargeDash(state, caster, context, options());
    assert.equal(values.length, 2);
    assert.equal(new Set(values).size, 1, 'AoE 一律单值，逐目标各算会让同一发里飘出「这个暴击、那个不暴击」');
});

// ────────────────────────────────────────────── 四、触发系统：CD / 选向 / 落点

/** 表值 → 世界：一格行距 = `HEX_GRID_LOGICAL_ROW_STEP` 逻辑 px × 0.3。*/
const CELL_WORLD = HEX_GRID_LOGICAL_ROW_STEP * 0.3;

function harness(params: Record<string, number>, behaviorKey: string, chain: number, unitId: string) {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0, unitId);
    const state = makeState([caster]);
    const runtime = {
        skillChainId: chain, behaviorKey,
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const registered = new Map<string, Record<string, unknown>>();
    const applied: Array<{ unitId: string; id: string }> = [];
    const landed: Array<{ x: number; y: number }> = [];
    const dashOptions: IZCChargeDashOptions[] = [];
    const blocked = new Set<string>();
    let dashHits = 0;
    const context = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: (id: string) => registered.has(id),
            register: (definition: Record<string, unknown>) => { registered.set(String(definition.id), definition); },
            apply: (unitId: string, id: string) => { applied.push({ unitId, id }); return { applied: true }; },
        },
        //  表值 px → 世界 px（与实战同一条口径）。缺了它默认 1，`dashCells` 会放大 3.3 倍。
        distanceScale: 0.3,
        //  🔴 只给施法者自己那本技能书：真实 `runtimeOf` 返回的是「这个单位自己的技能配置」。
        //  对所有单位返回同一份的话，被打的敌人也会冲一次，落点 / 调用次数都会被覆盖。
        runtimeOf: (unit: ZCUnitState) => (unit.id === caster.id ? runtime : undefined),
        fireBurst: () => undefined,
        castSecondary: () => false,
        castSplashShot: () => false,
        castBurstSkill: () => false,
        castFanSweep: () => false,
        //  普攻射程闸门：冲锋**不许**读它，故意给 false。
        inAttackRange: () => false,
        //  `blocked` 里的坐标视为不可站立（模拟地图边缘 / 城墙外）。
        hexIdAt: (x: number, y: number) => (blocked.has(`${x.toFixed(3)},${y.toFixed(3)}`) ? null : 1),
        blinkTo: (_unit: ZCUnitState, x: number, y: number) => { landed.push({ x, y }); },
        castChargeDash: (_unit: ZCUnitState, opts: IZCChargeDashOptions) => {
            dashOptions.push(opts);
            return dashHits;
        },
        currentTarget: () => null,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return { caster, state, context, registered, applied, landed, dashOptions, blocked };
}

test('菌盾冲锋：首次只挂 CD、到点才冲；朝锁定目标、1 格；残影事件两端都写', () => {
    prepare();
    const tester = harness(CHARGE_PARAMS[2], 'charge_shield', 101204, '68012');
    //  目标在 (100, 0) ⇒ 朝 +x，冲 1 格 = 42 × 0.3 = 12.6 世界 px。
    (tester.context as unknown as { currentTarget: () => { x: number; y: number } | null }).currentTarget =
        () => ({ x: 100, y: 0 });
    const step = (at: number) => {
        tester.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    };
    step(0);
    assert.equal(tester.caster.chargeReadyAt, 12, '开局不立刻冲');
    assert.equal(tester.landed.length, 0);
    step(11.9);
    assert.equal(tester.landed.length, 0, '没到点不许冲');
    step(12);
    assert.equal(tester.landed.length, 1);
    assert.ok(Math.abs(tester.landed[0].x - CELL_WORLD) < 1e-9, `落点应为 12.6，实际 ${tester.landed[0].x}`);
    assert.ok(Math.abs(tester.landed[0].y) < 1e-9);
    assert.equal(tester.caster.chargeReadyAt, 24, '冲完把 CD 推到 now + 12');

    const fx = tester.state.combatEvents.filter((event) => event.effectPrefabPath === ZC_DASH_EFFECT_PREFAB_PATH);
    assert.equal(fx.length, 1);
    assert.equal(fx[0].fromX, 0, 'from = 起冲点（挪人之前取）');
    assert.ok(Math.abs(fx[0].toX - CELL_WORLD) < 1e-9, 'to = 落点（锚点取中点才画在路中间）');
    assert.ok(Math.abs(Number(fx[0].durationSeconds) - ZC_DASH_EFFECT_SECONDS) < 1e-9);
    //  自护盾交给攻击系统（`castChargeDash`）：参数按档位传下去。
    assert.equal(tester.dashOptions.length, 1);
    assert.equal(tester.dashOptions[0].shieldRatio, 0.18);
    assert.equal(tester.dashOptions[0].shieldSeconds, 4);
    assert.ok(Math.abs(tester.dashOptions[0].hitRadius - 40 * 0.3) < 1e-9, '判定宽度是表值 × 世界换算');
});

test('菌盾冲锋：没有锁定目标时朝面朝方向；落点不合法就逐步缩短', () => {
    prepare();
    const tester = harness(CHARGE_PARAMS[0], 'charge_shield', 101204, '68012');
    tester.caster.facingRadians = Math.PI;         // 面朝 −x
    const step = (at: number) => {
        tester.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    };
    step(0);
    step(12);
    assert.equal(tester.landed.length, 1);
    assert.ok(tester.landed[0].x < 0, '朝面朝方向冲（−x），不是 +x');
    assert.ok(Math.abs(tester.landed[0].x + CELL_WORLD) < 1e-9);

    //  地图边缘：整格不可站 ⇒ 退到 0.75 格。
    const edge = harness(CHARGE_PARAMS[0], 'charge_shield', 101204, '68012');
    edge.caster.facingRadians = 0;
    edge.blocked.add(`${CELL_WORLD.toFixed(3)},0.000`);
    edge.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(edge.state, 0.05, edge.context);
    edge.state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(edge.state, 0.05, edge.context);
    assert.equal(edge.landed.length, 1);
    assert.ok(Math.abs(edge.landed[0].x - CELL_WORLD * 0.75) < 1e-9,
        `整格不可站应退到 0.75 格，实际 ${edge.landed[0].x}`);
});

test('冲锋 102303：朝最近敌人冲、冲到他身上为止；半径内没人 ⇒ 不消费 CD', () => {
    prepare();
    const tester = harness(DASH_2303_PARAMS[0], 'legacy_dash', 102303, '68023');
    const step = (at: number) => {
        tester.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    };
    step(0);
    assert.equal(tester.caster.dashReadyAt, 12);
    //  18 世界 px 处的敌人：3 格（37.8）比它远 ⇒ 只冲 18，不能穿过它冲到背后。
    tester.state.units.push(makeUnit(9, ZCOwner.Enemy, 18, 0, '68028'));
    step(12);
    assert.equal(tester.landed.length, 1);
    assert.ok(Math.abs(tester.landed[0].x - 18) < 1e-9, `应停在目标身上，实际 ${tester.landed[0].x}`);
    assert.equal(tester.dashOptions[0].statusId, singleStrikeStunStatusId(1), '眩晕走参数化硬控签名');
    assert.equal(tester.registered.get(singleStrikeStunStatusId(1))!.control, 'stun');

    //  搜索半径（300 表值 = 90 世界）内没人 ⇒ 不冲、CD 保持就绪。
    const lonely = harness(DASH_2303_PARAMS[0], 'legacy_dash', 102303, '68023');
    lonely.state.units.push(makeUnit(9, ZCOwner.Enemy, 200, 0, '68028'));
    lonely.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(lonely.state, 0.05, lonely.context);
    lonely.state.elapsedSeconds = 20;
    ZCSkillTriggerSystem.tick(lonely.state, 0.05, lonely.context);
    assert.equal(lonely.landed.length, 0);
    assert.equal(lonely.caster.dashReadyAt, 12, '够不着 ⇒ 冷却保持就绪，下帧重试');
});

test('冲锋 102303 III 级：落地注册减伤（负值）+ 补一条刀盾兵_护盾', () => {
    prepare();
    const tester = harness(DASH_2303_PARAMS[2], 'legacy_dash', 102303, '68023');
    const guardId = dashGuardStatusId(25, 3);
    //  这条用例要走到真实的 `castChargeDash`（护盾事件与状态都在那边推）。
    let forwarded: IZCChargeDashOptions | null = null;
    (tester.context as unknown as Record<string, unknown>).castChargeDash =
        (unit: ZCUnitState, opts: IZCChargeDashOptions) => {
            forwarded = opts;
            return ZCAttackResolutionSystem.castChargeDash(
                tester.state, unit, dashContext(tester.state.units, tester.applied), opts);
        };
    tester.state.units.push(makeUnit(9, ZCOwner.Enemy, 10, 0, '68028'));
    tester.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    tester.state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);

    assert.ok(forwarded, 'III 级必须把减伤一起传下去');
    assert.equal(forwarded!.guardStatusId, guardId, 'III 级必须把减伤 id 一起传下去');
    const def = tester.registered.get(guardId);
    assert.ok(def, '减伤状态必须动态注册');
    assert.deepEqual(def!.statMods, { damageTakenPct: -25 },
        '`damageTakenPct` 取负 = 受到伤害降低（正数是易伤，别写反）');
    assert.deepEqual(tester.applied.map((item) => item.id), [guardId]);
    const guardFx = tester.state.combatEvents.filter((event) => event.effectPrefabPath === ZC_DASH_GUARD_PREFAB_PATH);
    assert.equal(guardFx.length, 1, '设计案 O 列「落地自保叠 刀盾兵_护盾」');
});

test('尖刺冲锋 102703：朝面朝方向定长冲；易伤/破甲走正值，III 级给护盾', () => {
    prepare();
    const tester = harness(DASH_2703_PARAMS[2], 'legacy_dash', 102703, '68027');
    tester.caster.facingRadians = Math.PI / 2;     // 朝 +y
    let forwarded: IZCChargeDashOptions | null = null;
    (tester.context as unknown as Record<string, unknown>).castChargeDash =
        (unit: ZCUnitState, opts: IZCChargeDashOptions) => { forwarded = opts; return 1; };
    tester.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    tester.state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);

    //  2 格 = 84 逻辑 px = 25.2 世界 px。
    assert.ok(Math.abs(tester.landed[0].y - CELL_WORLD * 2) < 1e-9,
        `朝面朝方向冲 2 格，实际 ${tester.landed[0].y}`);
    assert.ok(Math.abs(tester.landed[0].x) < 1e-9);
    assert.ok(forwarded);
    const vulnId = dashVulnerableStatusId(35, 6);
    assert.equal(forwarded!.statusId, vulnId);
    const def = tester.registered.get(vulnId);
    assert.deepEqual(def!.statMods, { damageTakenPct: 35 },
        '破甲 = 受到伤害提高（正值）；与 102303 的自减伤方向相反');
    assert.equal(forwarded!.shieldRatio, 0.2, 'III 级落地给自己 20% 护盾');
    assert.equal(forwarded!.guardStatusId, undefined, '102703 没有自身减伤');

    //  L1 既没有易伤也没有护盾，而且**面朝方向没人也照冲**（它就是一段位移）。
    const tier1 = harness(DASH_2703_PARAMS[0], 'legacy_dash', 102703, '68027');
    let first: IZCChargeDashOptions | null = null;
    (tier1.context as unknown as Record<string, unknown>).castChargeDash =
        (_unit: ZCUnitState, opts: IZCChargeDashOptions) => { first = opts; return 0; };
    tier1.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(tier1.state, 0.05, tier1.context);
    tier1.state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(tier1.state, 0.05, tier1.context);
    assert.equal(tier1.landed.length, 1, '前方是空的也照冲');
    assert.equal(first!.statusId, undefined);
    assert.equal(first!.shieldRatio, 0);
    assert.equal(tier1.caster.dashReadyAt, 24, '照冲就该消费 CD（与「没目标不动」的两条车道相反）');
});
