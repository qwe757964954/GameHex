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
import { ZC_BURST_IMPACT_PREFAB_PATH, zcBurstEffectScale } from '../assets/script/app/zcds/model/ZCBurstFx';
import {
    ZC_FAN_SWEEP_BURSTS, ZC_FAN_SWEEP_BURST_DISTANCE_RATIO, ZC_FAN_SWEEP_BURST_RADIUS_RATIO,
    ZC_FAN_SWEEP_BURST_SPREAD, fanSweepSlowStatusId, zcFanSweepEffectPaths, zcIsFanSweepBehavior,
} from '../assets/script/app/zcds/model/ZCFanSweepFx';
import {
    ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH, ZC_SINGLE_STRIKE_EFFECT_SECONDS,
    singleStrikeHasteStatusId, singleStrikeStunStatusId,
    zcIsSingleStrikeBehavior, zcSingleStrikeEffectPaths,
} from '../assets/script/app/zcds/model/ZCSingleStrikeFx';
import { assetPath } from './helpers/asset-paths';

/**
 * 第 14 批 · 「近身型主动」两条车道（2026-11-17）。
 *
 *   · 机甲菇（68015）「三尖两刃」101503 —— `fan_slow`：
 *     130/160/200% @身前 120° 扇形（半径表值 150）、最多 4/5/6 人、减速 40/45/50%·2s；冷却 14/13/12。
 *   · 分裂菇（68014）「菌丝突刺」101403 —— `single_strike`：
 *     150/180/220% + 眩晕 1/1.5/2s；III 级命中后攻速 +30%·4s；冷却 12/12/11。
 *
 * 这一批有五个「照设计案 P 列字面配就会静默出错 / 做错」的点，正是本用例要钉住的：
 *
 *  1. **参数键必须带 `fan` / `single` 前缀**。68015 的袋子里已经有 101501 的 `splashRadius`
 *     与 101504 的 `ray*`（第 43 批起该链换成射线集束）⇒ 裸 `radius` 会同时改掉普攻溅射与射线长度，不报错。
 *  2. **扇形没有人数上限就错**。设计写「最多 N 名」，副轨那条 `castFanSkill` 是「扇形内全打」，
 *     直接复用它等于把人数上限这条设计约束丢掉。
 *  3. **眩晕必须是硬控且时长跟着档位走**。`pvpStatus` 里那几条 `stun_1/1_5/2` 只是值巧合相同；
 *     用它们的话改配表时长不会跟着变。也**不能**用 `mmb` 那类软控（`numb` 已按设计删除）。
 *  4. **III 级攻速只能「命中后」给**。塞进 `self_cast`（施法即加）会变成「空挥也涨攻速」。
 *  5. **撕裂要贴在目标身上、且必须进加载清单**。`ZCCombatEffectPlacement` 对未登记的 prefab
 *     一律取 `fromX/fromY`，所以两端都写目标坐标；漏收清单则是「照常结算、屏幕上不播」。
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

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = '68015'): ZCUnitState {
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

const FAN_PARAMS: Array<Record<string, number>> = [
    { fanCooldown: 14, fanDamageRate: 1.3, fanRadius: 150, fanAngle: 120, fanMaxTargets: 4, fanSlowRatio: 40, fanSlowSeconds: 2 },
    { fanCooldown: 13, fanDamageRate: 1.6, fanRadius: 150, fanAngle: 120, fanMaxTargets: 5, fanSlowRatio: 45, fanSlowSeconds: 2 },
    { fanCooldown: 12, fanDamageRate: 2.0, fanRadius: 150, fanAngle: 120, fanMaxTargets: 6, fanSlowRatio: 50, fanSlowSeconds: 2 },
];
const SINGLE_PARAMS: Array<Record<string, number>> = [
    { singleCooldown: 12, singleDamageRate: 1.5, singleSearchRadius: 300, singleStopDistance: 30, singleHitRadius: 40, singleStunSeconds: 1 },
    { singleCooldown: 12, singleDamageRate: 1.8, singleSearchRadius: 300, singleStopDistance: 30, singleHitRadius: 40, singleStunSeconds: 1.5 },
    { singleCooldown: 11, singleDamageRate: 2.2, singleSearchRadius: 300, singleStopDistance: 30, singleHitRadius: 40, singleStunSeconds: 2, singleHastePct: 30, singleHasteSeconds: 4 },
];

test('101503 三尖两刃：三档倍数/人数/减速/冷却与设计案一致', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101503)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94015031, 94015032, 94015033]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [9, 18, 27], '技能 3 = 9/18/27');
    assert.deepEqual(rows.map((row) => Number(row.pvpSkillId)), [30241, 30241, 30241], '键 = 本卡普攻 skillId');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68015');
        assert.equal(row.behaviorKey, 'fan_slow');
        assert.equal(row.skillKind, 'active_cd');
        assert.equal(row.statId, null, '机制全在参数袋里，主链不挂属性');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), FAN_PARAMS[index]);
    }
});

test('101403 菌丝突刺：三档倍数/眩晕/冷却与设计案一致，III 级才带攻速', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101403)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => Number(row.modifierId)), [94014031, 94014032, 94014033]);
    assert.deepEqual(rows.map((row) => Number(row.unlockHeroLevel)), [9, 18, 27], '技能 3 = 9/18/27');
    for (const [index, row] of rows.entries()) {
        assert.equal(row.unitId, '68014');
        assert.equal(row.behaviorKey, 'single_strike');
        assert.deepEqual(JSON.parse(String(row.skillParamJson)), SINGLE_PARAMS[index]);
    }
    //  L1 / L2 不许带攻速（设计只在 III 级给）
    for (const row of rows.slice(0, 2)) {
        assert.equal('singleHastePct' in JSON.parse(String(row.skillParamJson)), false);
    }
});

test('参数袋不许出现裸键（会串到普攻 / 爆发车道）', () => {
    prepare();
    const rows = readRows('pvpSkillPlan').filter(
        (row) => Number(row.skillChainId) === 101503 || Number(row.skillChainId) === 101403);
    assert.equal(rows.length, 6);
    for (const row of rows) {
        const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
        for (const banned of ['splashRadius', 'splashDamageRate', 'burstRadius', 'burstDamageRate',
            'damageRate', 'cooldown', 'radius']) {
            assert.equal(banned in params, false,
                `${row.modifierId} 的参数袋里有裸键 ${banned} ⇒ 这张卡别的车道会被顺带改掉`);
        }
        const need = Number(row.skillChainId) === 101503 ? 'fanCooldown' : 'singleCooldown';
        assert.ok(need in params, `${row.modifierId} 缺 ${need}`);
    }
});

test('68015 既有两条车道没被本批带跑（普攻溅射 38/46/55、射线半长 120）', () => {
    prepare();
    const splash = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101501)
        .sort((a, b) => Number(a.modifierId) - Number(b.modifierId));
    assert.deepEqual(
        splash.map((row) => (JSON.parse(String(row.skillParamJson)) as Record<string, number>).splashRadius),
        [38, 46, 55]);
    //  101504 第 43 批从菌毯爆发换成射线集束（`burstRadius` ⇒ `rayHalfLength`）。
    const ray = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === 101504);
    assert.deepEqual(
        [...new Set(ray.map((row) => (JSON.parse(String(row.skillParamJson)) as Record<string, number>).rayHalfLength))],
        [120], '101504 的射线半长被带跑了');
    assert.deepEqual(
        [...new Set(ray.map((row) => row.behaviorKey))], ['ray_beam'], '101504 车道不是射线集束');
});

test('两份产物逐格一致：pvpSkillPlan / armySkillLevelUp', () => {
    prepare();
    for (const name of ['pvpSkillPlan', 'armySkillLevelUp']) {
        const remote = readRows(name);
        const client = readClient(name);
        assert.equal(remote.length, client.length, `${name} 两份行数不一致`);
        const key = name === 'pvpSkillPlan' ? 'modifierId' : 'id';
        const clientById = new Map(client.map((row) => [String(row[key]) + ':' + String(row.skillLevel ?? row.skilllevel), row]));
        const wantChain = (value: number) => value === 101503 || value === 101403;
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
        [101503, '三尖两刃', [94015031, 94015032, 94015033]],
        [101403, '菌丝突刺', [94014031, 94014032, 94014033]],
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

// ────────────────────────────────────────────── 二、登记（漏一处就静默不跑）

test('fan_slow / single_strike 必须双登记 + 表现路径进加载清单', () => {
    const schemaSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCStatSchema.ts'), 'utf8');
    const runtimeSource = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSkillRuntime.ts'), 'utf8');
    for (const key of ['fan_slow', 'single_strike']) {
        assert.match(schemaSource, new RegExp(`SKILL_BEHAVIORS = new Set\\(\\[[\\s\\S]*?'${key}'[\\s\\S]*?\\]\\)`),
            `ZCStatSchema.SKILL_BEHAVIORS 缺 ${key}`);
        assert.match(runtimeSource, new RegExp(`register\\('${key}'`),
            `ZCSkillRuntime 没注册 ${key} ⇒ 参数永远进不了运行时`);
    }
    assert.equal(zcIsFanSweepBehavior('fan_slow'), true);
    assert.equal(zcIsFanSweepBehavior('burst_aura'), false, '第 13 批的车道不许被这条判据收进来');
    assert.equal(zcIsSingleStrikeBehavior('single_strike'), true);
    assert.equal(zcIsSingleStrikeBehavior('blink_strike'), false, '103404 的闪现不许被收进来');
    assert.deepEqual(zcFanSweepEffectPaths('fan_slow'), [ZC_BURST_IMPACT_PREFAB_PATH], '扇形复用普攻爆炸');
    assert.deepEqual(zcSingleStrikeEffectPaths('single_strike'), [ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH]);
    assert.deepEqual(zcSingleStrikeEffectPaths(null), [], '别的行为键不许被收进清单');

    const unit = (unitId: string) => ({ unitId, attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null } });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withStrike = buildZCVisualResourcePlan(
        [unit('68014'), unit('68015'), unit('68001')],
        {
            skillPlans: [plan('68014', 'single_strike'), plan('68015', 'fan_slow'), plan('68001', 'random_strike')],
            textOverrides: new Map(),
        },
    );
    assert.ok(withStrike.effectPaths.includes(ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH),
        '撕裂此前没有技能在用 ⇒ 漏收就是「照常结算、屏幕上不播」');
    assert.ok(withStrike.effectPaths.includes(ZC_BURST_IMPACT_PREFAB_PATH), '扇形爆点也要进清单');
    const without = buildZCVisualResourcePlan(
        [unit('68001')], { skillPlans: [plan('68001', 'random_strike')], textOverrides: new Map() });
    assert.equal(without.effectPaths.includes(ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH), false);
});

test('fanReadyAt / singleReadyAt 必须登记进快照白名单（不还原会读档白送一次）', () => {
    const codec = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCSnapshotCodec.ts'), 'utf8');
    for (const key of ['fanReadyAt', 'singleReadyAt']) {
        assert.match(codec, new RegExp(`'${key}'`), `ZCSnapshotCodec 的字段白名单缺 ${key}`);
    }
    const types = readFileSync(join(ROOT, 'assets/script/app/zcds/model/ZCGameTypes.ts'), 'utf8');
    assert.match(types, /fanReadyAt\?: number/);
    assert.match(types, /singleReadyAt\?: number/);
});

test('撕裂的播放时长 = 8 帧 ÷ 12fps，不是设计案写的 0.3s', () => {
    //  设计案 O 列写「贴目标播 0.3s」，但这条序列帧有 8 张、sample 12 ⇒ 走完要 0.667s。
    //  截到 0.3s 会把后 4 张砍掉（观感是「砍一半就消失」）。与五雷轰顶同一条口径：帧数 ÷ 采样率。
    assert.ok(Math.abs(ZC_SINGLE_STRIKE_EFFECT_SECONDS - 8 / 12) < 1e-9);
    assert.ok(ZC_SINGLE_STRIKE_EFFECT_SECONDS > 0.3);
});

// ────────────────────────────────────────────── 三、castFanSweep：扇形与人数上限

const DEFINITION = {
    unitId: '68015', name: '机甲菇', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 45, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: false, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: 30241, name: '机甲菇普攻', mode: 'melee',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

function fanContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    /** 锁定目标（决定扇形朝向）；`null` ⇒ 退回面朝方向。*/
    target: { id: number; x: number; y: number } | null = null,
) {
    const hit: Array<{ id: number; statusId: string | undefined }> = [];
    //  命中观察点只能走 `damageUnit`：`applyHitStatus` 只在真的传了减速 id 时才会被调用
    //  （`castFanSweep` 里是 `if (slowStatusId) ...`），拿它数命中在「不挂状态」的用例里恒为 0。
    const damaged: number[] = [];
    const runtime = {
        skillChainId: 101503, behaviorKey: 'fan_slow',
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
        damageUnit: (target: ZCUnitState, damage: number) => {
            damaged.push(target.id);
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            [ZCOwner.Player]: new Map([['68015:30241', runtime]]),
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
        applyHitStatus: (victim: ZCUnitState, id: string | undefined) => { hit.push({ id: victim.id, statusId: id }); },
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
        healUnit: () => undefined,
        applyKnockback: () => undefined,
        pushProjectile: () => undefined,
    } as unknown as IZCAttackResolutionContext;
    return { context, hit, damaged };
}

test('三尖两刃：只打扇形里的人，且最多 fanMaxTargets 个', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  150 表值 × 0.3 = 45 世界 px；扇形朝向独立选中的最近敌人。
    //  扇形半角 60°（`fanAngle` 120）：id 5 在 −58° 勉强进圈，id 6 在 21.8° 但最远（32.3）。
    const near1 = makeUnit(2, ZCOwner.Enemy, 22);
    const near2 = makeUnit(3, ZCOwner.Enemy, 14, 6);
    const near3 = makeUnit(4, ZCOwner.Enemy, 26, -8);
    const near4 = makeUnit(5, ZCOwner.Enemy, 10, -16);
    const near5 = makeUnit(6, ZCOwner.Enemy, 30, 12);
    //  扇形外：背后（180°）与正侧方（90°）。
    const behind = makeUnit(7, ZCOwner.Enemy, -30);
    const side = makeUnit(8, ZCOwner.Enemy, 0, 40);
    const units = [caster, near1, near2, near3, near4, near5, behind, side];
    const state = makeState(units);
    const { context, hit } = fanContext(units, FAN_PARAMS[0], { id: 2, x: 22, y: 0 });
    const slowId = fanSweepSlowStatusId(40, 2);

    assert.equal(ZCAttackResolutionSystem.castFanSweep(state, caster, context, slowId), true);
    //  L1 上限 4：扇形里 5 个（id 2/3/4/5/6），按距离丢掉最远的 id 6；
    //  背后与正侧方那两个一个都不许中。
    assert.equal(hit.length, 4, '「最多 4 名敌人」是设计约束，扇形内全打就错了');
    assert.deepEqual(hit.map((item) => item.id).sort((a, b) => a - b), [2, 3, 4, 5]);
    for (const item of hit) assert.equal(item.statusId, slowId, '命中必须挂减速');
});

test('三尖两刃：扇形方向独立选择最近合法目标，同距按 id', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    caster.facingRadians = Math.PI;                    // 面朝 −x
    const front = makeUnit(2, ZCOwner.Enemy, -30);     // 面朝方向上有怪
    const back = makeUnit(3, ZCOwner.Enemy, 30);       // 背后有怪
    const units = [caster, front, back];
    const state = makeState(units);
    const { context, hit, damaged } = fanContext(units, FAN_PARAMS[0], null);

    assert.equal(ZCAttackResolutionSystem.castFanSweep(state, caster, context, undefined), true);
    assert.deepEqual(damaged, [2], '独立选敌，同距选择 id 较小的 2');
    assert.equal(hit.length, 0, '不传减速 id ⇒ 一个状态都不许挂');
});

test('三尖两刃：扇形里没人 / 参数不全 ⇒ 返回 false，且不推表现事件', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const behind = makeUnit(2, ZCOwner.Enemy, -100);
    const units = [caster, behind];
    const state = makeState(units);
    //  锁定目标无效；唯一敌人在技能半径外 ⇒ 不出手。
    const empty = fanContext(units, FAN_PARAMS[0], { id: 9, x: 40, y: 0 });
    assert.equal(ZCAttackResolutionSystem.castFanSweep(state, caster, empty.context), false);
    assert.equal(state.combatEvents.length, 0);

    const front = [caster, makeUnit(3, ZCOwner.Enemy, 20)];
    const broken = fanContext(front, { fanCooldown: 14, fanRadius: 150, fanAngle: 120 });
    assert.equal(
        ZCAttackResolutionSystem.castFanSweep(makeState(front), caster, broken.context), false,
        '缺 fanDamageRate ⇒ 不出手');
});

test('三尖两刃的爆点铺在扇形里（3 发、尺寸按半径反算）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 22);
    const units = [caster, enemy];
    const state = makeState(units);
    const { context } = fanContext(units, FAN_PARAMS[0], { id: 2, x: 22, y: 0 });

    assert.equal(ZCAttackResolutionSystem.castFanSweep(state, caster, context, undefined), true);
    assert.equal(state.combatEvents.length, ZC_FAN_SWEEP_BURSTS, '设计案 O 列「沿扇形展开」');
    const burstTable = 150 * ZC_FAN_SWEEP_BURST_RADIUS_RATIO;
    for (const event of state.combatEvents) {
        assert.equal(event.type, 'area');
        assert.equal(event.effectPrefabPath, ZC_BURST_IMPACT_PREFAB_PATH);
        assert.ok(Math.abs(Number(event.effectScale) - zcBurstEffectScale(burstTable)) < 1e-9,
            '扇形爆点同样走 zcBurstEffectScale（视图不读 radius）');
        const distance = Math.hypot(event.fromX - 0, event.fromY - 0);
        assert.ok(Math.abs(distance - 150 * 0.3 * ZC_FAN_SWEEP_BURST_DISTANCE_RATIO) < 1e-6);
    }
    //  三发都落在扇形半角之内（SPREAD < 1 ⇒ 最外侧那发仍在 60° 内）。
    assert.ok(ZC_FAN_SWEEP_BURST_SPREAD < 1);
});

// ────────────────────────────────────────────── 四、触发系统：CD 与状态

function harness(params: Record<string, number>, behaviorKey: string, chain: number) {
    const caster = makeUnit(1, ZCOwner.Player, 0, 0, chain === 101503 ? '68015' : '68014');
    const state = makeState([caster]);
    const runtime = {
        skillChainId: chain, behaviorKey,
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const registered = new Map<string, Record<string, unknown>>();
    const applied: Array<{ unitId: string; id: string }> = [];
    const struck: Array<Record<string, unknown>> = [];
    const context = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: (id: string) => registered.has(id),
            register: (definition: Record<string, unknown>) => { registered.set(String(definition.id), definition); },
            apply: (unitId: string, id: string) => { applied.push({ unitId, id }); return { applied: true }; },
        },
        //  表值 px → 世界 px（与实战同一条口径）。缺了它默认 1，`singleSearchRadius: 300`
        //  会变成「300 世界 px 都能扑」，用例里「够不着」那档就永远测不出来。
        distanceScale: 0.3,
        //  🔴 只给施法者自己那本技能书：真实 `runtimeOf` 返回的是「这个单位自己的技能配置」。
        //  若对所有单位都返回同一份（含被扑的敌人），敌人也会放一次突刺，
        //  于是 `strike` 被调两次、落点被敌人那次覆盖 —— 用例会以假红的形式指错方向。
        runtimeOf: (unit: ZCUnitState) => (unit.id === caster.id ? runtime : undefined),
        fireBurst: () => undefined,
        castSecondary: () => false,
        castSplashShot: () => false,
        //  普攻射程闸门：这两条车道都**不许**读它，故意给 false。
        inAttackRange: () => false,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return { caster, state, context, registered, applied, struck };
}

test('三尖两刃：扇形半径内没人 ⇒ 待触发不消费 CD，目标进圈当帧补放', () => {
    prepare();
    const test1 = harness(FAN_PARAMS[2], 'fan_slow', 101503);
    let calls = 0;
    (test1.context as unknown as Record<string, unknown>).castFanSweep =
        () => { calls += 1; return true; };
    //  最近敌人距离可控：默认远处（够不着），后段拉进扇形半径。
    //  闸门用的是**扇形自己的半径** 150 表值 × distanceScale 0.3 = 45 世界 px，
    //  不是普攻射程（68015 只有 45 表值 = 13.5 世界 px，用那个会把技能卡死）。
    let nearest = 999;
    (test1.context as unknown as Record<string, unknown>).nearestEnemyDistance = () => nearest;
    const step = (at: number) => {
        test1.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(test1.state, 0.05, test1.context);
    };
    step(0);
    assert.equal(test1.caster.fanReadyAt, 12, '开局只挂 CD');
    step(12);
    assert.equal(calls, 0, '冷却到点但扇形半径内没人 ⇒ 不放');
    assert.equal(test1.caster.fanReadyAt, 12, '被拦下 ⇒ 冷却保持就绪，不消费');
    nearest = 10;
    //  同一时刻再跑一拍（tick 幂等，`elapsedSeconds` 不动）⇒ 当帧就补放。
    step(12);
    assert.equal(calls, 1, '目标一进扇形半径立刻补放');
    assert.equal(test1.caster.fanReadyAt, 24, '放出去才推到下一个 CD');
});

test('三尖两刃：首次只挂 CD、到点才甩；减速状态按档位签名注册', () => {
    prepare();
    const test1 = harness(FAN_PARAMS[2], 'fan_slow', 101503);
    let calls = 0;
    let result = true;
    (test1.context as unknown as Record<string, unknown>).castFanSweep =
        (_unit: ZCUnitState, slowStatusId?: string) => {
            calls += 1;
            if (slowStatusId === undefined) throw new Error('L3 必须带减速 id');
            return result;
        };
    const step = (at: number) => {
        test1.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(test1.state, 0.05, test1.context);
    };
    step(0);
    assert.equal(test1.caster.fanReadyAt, 12, '开局不立刻甩');
    assert.equal(calls, 0);
    step(11.9);
    assert.equal(calls, 0, '没到点不许甩');
    step(12);
    assert.equal(calls, 1);
    assert.equal(test1.caster.fanReadyAt, 24, '甩完把 CD 推到 now + fanCooldown');
    const slowId = fanSweepSlowStatusId(50, 2);
    assert.ok(test1.registered.has(slowId), '减速状态必须按参数签名注册');
    assert.deepEqual(test1.registered.get(slowId)!.statMods, { moveSpeedPct: -50 },
        '百分点口径，-50 = 移速 −50%');
    //  打空不消费 CD
    result = false;
    step(30);
    assert.equal(calls, 2, '尝试过但被拒');
    assert.equal(test1.caster.fanReadyAt, 24, '被拒 ⇒ 冷却保持就绪，下帧重试');
});

test('菌丝突刺：贴到目标身边、打一发并挂硬控；III 级命中后给攻速', () => {
    prepare();
    const tester = harness(SINGLE_PARAMS[2], 'single_strike', 101403);
    const victim = makeUnit(9, ZCOwner.Enemy, 60, 0, '68028');
    tester.state.units.push(victim);
    let landedTo: { x: number; y: number } | null = null;
    let strikeStatusId: string | undefined;
    let strikes = 0;
    (tester.context as unknown as Record<string, unknown>).blinkTo =
        (_unit: ZCUnitState, x: number, y: number) => { landedTo = { x, y }; };
    (tester.context as unknown as Record<string, unknown>).strike =
        (_unit: ZCUnitState, options: Record<string, unknown>) => {
            strikes += 1;
            strikeStatusId = options.statusId as string | undefined;
            return 1;
        };
    const step = (at: number) => {
        tester.state.elapsedSeconds = at;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    };

    step(0);
    assert.equal(tester.caster.singleReadyAt, 11, '开局不立刻扑');
    assert.equal(strikes, 0);
    step(11);
    assert.equal(strikes, 1, '到点扑一次');
    assert.equal(tester.caster.singleReadyAt, 22);
    //  300 表值 × 0.3 = 90 世界 px；目标在 60 ⇒ 落在离目标 `30 表值 × 0.3 = 9` 的位置，即 51。
    assert.ok(landedTo !== null, '必须真的挪人（复用 blinkTo 原语）');
    assert.ok(Math.abs(landedTo!.x - 51) < 1e-6, `落点应为 51，实际 ${landedTo!.x}`);
    //  眩晕是硬控：control: 'stun'，时长按档位（L3 = 2 秒）
    const stunId = singleStrikeStunStatusId(2);
    assert.equal(strikeStatusId, stunId, '命中状态必须随 strike 传给被打的目标');
    const stunDef = tester.registered.get(stunId);
    assert.ok(stunDef, '眩晕状态必须动态注册');
    assert.equal(stunDef!.control, 'stun', '眩晕是硬控（不要拿软控冒充）');
    assert.equal(Number(stunDef!.durationSeconds), 2);
    //  III 级攻速：命中之后才给，且挂在自己身上
    const hasteId = singleStrikeHasteStatusId(30, 4);
    assert.ok(tester.registered.has(hasteId), 'III 级攻速必须注册');
    assert.deepEqual(tester.registered.get(hasteId)!.statMods, { attackIntervalPct: 30 },
        'attackIntervalPct 正值 = 间隔缩短 = 攻速提升');
    assert.deepEqual(tester.applied.map((item) => item.id), [hasteId]);
    assert.equal(tester.applied[0].unitId, String(tester.caster.id), '增益给自己');
});

test('菌丝突刺：L1/L2 不注册攻速；空放（没打到）不给增益', () => {
    prepare();
    for (const params of [SINGLE_PARAMS[0], SINGLE_PARAMS[1]]) {
        const tester = harness(params, 'single_strike', 101403);
        tester.state.units.push(makeUnit(9, ZCOwner.Enemy, 30, 0, '68028'));
        let strikes = 0;
        (tester.context as unknown as Record<string, unknown>).blinkTo = () => undefined;
        (tester.context as unknown as Record<string, unknown>).strike = () => { strikes += 1; return 1; };
        tester.state.elapsedSeconds = 0;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
        tester.state.elapsedSeconds = 12;
        ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
        assert.equal(strikes, 1);
        assert.equal(tester.applied.length, 0, 'L1/L2 没有 singleHastePct ⇒ 不挂增益');
    }

    //  III 级但 `strike` 一发没打中（返回 0）⇒ 攻速不给。
    const tester = harness(SINGLE_PARAMS[2], 'single_strike', 101403);
    tester.state.units.push(makeUnit(9, ZCOwner.Enemy, 30, 0, '68028'));
    (tester.context as unknown as Record<string, unknown>).blinkTo = () => undefined;
    (tester.context as unknown as Record<string, unknown>).strike = () => 0;
    tester.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    tester.state.elapsedSeconds = 11;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    assert.equal(tester.applied.length, 0, '空放不给攻速（设计案 N 列原话）');
});

test('菌丝突刺：搜索半径内没人 ⇒ 不消费 CD', () => {
    prepare();
    const tester = harness(SINGLE_PARAMS[0], 'single_strike', 101403);
    let strikes = 0;
    (tester.context as unknown as Record<string, unknown>).blinkTo = () => undefined;
    (tester.context as unknown as Record<string, unknown>).strike = () => { strikes += 1; return 1; };
    tester.state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    assert.equal(tester.caster.singleReadyAt, 12);
    //  目标在 90 世界 px 之外（300 表值 × 0.3 = 90 是搜索半径的边界）。
    tester.state.units.push(makeUnit(9, ZCOwner.Enemy, 95, 0, '68028'));
    tester.state.elapsedSeconds = 20;
    ZCSkillTriggerSystem.tick(tester.state, 0.05, tester.context);
    assert.equal(strikes, 0);
    assert.equal(tester.caster.singleReadyAt, 12, '够不着 ⇒ 冷却保持就绪');
});
