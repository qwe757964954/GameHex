/**
 * 雷蕉（68022）「闪电链」102203（2026-11-18，第 17 批）—— 纯新增 `chain_damage` 车道。
 *
 * 设计案 K/L/M 三档（J 列冷却 12 秒）：
 *   L1 兵种 9 级：最多命中 4 个敌人，每个 90%；
 *   L2 兵种 18 级：最多命中 6 个，每个 100%，每跳损耗 10%；
 *   L3 兵种 27 级：最多命中 8 个，每个 120%，最后一跳必定暴击 150%。
 * N 列：「连锁跳向最近的未命中敌人，除 II 级起引入的 10% 递减外不再衰减」。
 *
 * 五个「照字面配就会静默错」的点，正是本用例要钉住的：
 *
 *  1. **递减是复利**：第 k 跳 ×(1−0.1)^k ⇒ 100 / 90 / 81 / 72.9。写成线性 `1 − 0.1k`
 *     前两跳一模一样、第 4 跳就差了 3 个点，而且没人会去数 —— 用例直接钉第 4 跳的绝对值。
 *  2. **同一个人不许挨两次**：跳法要排除「这一轮已经挨过的」，靠 id 集合而不是对象引用
 *     （单位池化会换对象）。只剩 2 个人时配 6 跳只能打 2 下，不能原地来回弹。
 *  3. **CD 必须自己一份**（`chainReadyAt`）。雷蕉这张卡上还挂着 102204 嗜血术，
 *     复用 `boltReadyAt` 会让两条技能互相吃冷却，症状只是「偶尔少放一次」。
 *  4. **参数一律 `chain*` 前缀**：`skillParamJson` 按 `68022:30231` 合并成一袋，
 *     袋里还住着 102201 / 102202；裸 `targetCount` / `falloff` 会串过去且不报错。
 *  5. **表现要进加载清单**：每跳的 `area` 事件带的是代码常量里的 prefab 路径，
 *     `pvpSkill` 里没有造型槽 ⇒ 漏收就是「照常掉血、屏幕上一道电弧都没有」。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap, ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type {
    ZCCombatEvent, ZCFloatText, ZCSnapshot, ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import {
    ZC_CHAIN_BEHAVIOR_KEY, ZC_CHAIN_EFFECT_PREFAB_PATH, ZC_CHAIN_EFFECT_SECONDS,
    ZC_CHAIN_FADE_FLOOR, ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH, ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH,
    ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH,
    ZC_CHAIN_SEGMENT_SCREEN_LENGTH, ZC_CHAIN_SEGMENT_VISIBLE_SCREEN_LENGTH, ZC_CHAIN_SEGMENT_WORLD_LENGTH,
    zcChainArcPieceLayout, zcChainEffectAlpha, zcChainLightningEffectPaths,
} from '../assets/script/app/zcds/model/ZCChainLightningFx';
import { assetExists, assetPath } from './helpers/asset-paths';

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const OWNERS = Object.values(ZCOwner) as ZCOwner[];
const ROOT = process.cwd();
const CHAIN = 102203;
const UNIT_ID = '68022';
const SKILL_ID = 30231;

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

function makeUnit(id: number, owner: ZCOwner, x: number, y = 0, unitId = UNIT_ID): ZCUnitState {
    return {
        id, owner, unitId, cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 10000, maxHp: 10000, battleState: 'idle', stateTime: 0,
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

/** 攻击力 100、无任何加成 ⇒ 面板伤害 = 100 × 倍率，便于钉绝对值。 */
const DEFINITION = {
    unitId: UNIT_ID, name: '雷蕉', maxHp: 1000, attack: 100,
    moveSpeed: 0, attackSpeed: 500, attackRange: 120, attackInterval: 1.8,
    attackDuration: 0.667, attackHitTime: 0.345, bodyRadius: 6, spawnSeconds: 0,
    flying: false, canAttackAir: true, hero: true, prefabPath: '', prefabSize: 1,
    attackProfile: {
        skillId: SKILL_ID, name: '雷蕉普攻', mode: 'projectile',
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0, secondarySkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    } satisfies ZCAttackProfile,
    secondaryProfile: undefined,
} as unknown as ZCUnitDefinition;

/** 每一跳「谁挨了多少」——`castChainLightning` 只通过 `damageUnit` 结算。 */
function chainContext(
    units: ZCUnitState[],
    params: Record<string, number>,
    targetId: number | null,
) {
    const damaged: Array<{ id: number; damage: number }> = [];
    const runtime = {
        skillChainId: CHAIN, behaviorKey: ZC_CHAIN_BEHAVIOR_KEY,
        trigger: 'none', stateMode: 'none', parameters: { ...params },
    } as unknown as ZCSkillRuntimeDefinition;
    const context = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1,
            unitAttackPerTier: 0, counterDamageMultiplier: 1,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => DEFINITION,
        unitPosition: (unit: ZCUnitState) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (target: ZCUnitState, damage: number) => {
            damaged.push({ id: target.id, damage });
            return { value: Math.round(damage), kind: 'damage', x: 0, y: 0 } as unknown as ZCFloatText;
        },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: {
            ...perOwner(() => new Map()),
            [ZCOwner.Player]: new Map([[`${UNIT_ID}:${SKILL_ID}`, runtime]]),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: perOwner(() => new Map<string, ZCUnitStatPatch>()),
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById: new Map(units.map((unit) => [unit.id, unit])),
        currentTarget: (unit: ZCUnitState) => {
            const victim = units.find((item) => item.id === targetId);
            return victim
                ? { kind: 'unit', id: victim.id, x: victim.freeX, y: victim.freeY, bodyRadius: 24, cardId: victim.cardId }
                : null;
        },
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
    return { context, damaged };
}

//  三档参数的真值（与配表一致；150 表值 × 0.3 = 45 世界 px）。
const TIER_PARAMS: Array<Record<string, number>> = [
    { chainCooldown: 12, chainTargetCount: 4, chainDamageRate: 0.9, chainFalloff: 0, chainJumpRadius: 150 },
    { chainCooldown: 12, chainTargetCount: 6, chainDamageRate: 1, chainFalloff: 0.1, chainJumpRadius: 150 },
    {
        chainCooldown: 12, chainTargetCount: 8, chainDamageRate: 1.2,
        chainFalloff: 0.1, chainJumpRadius: 150, chainFinalCritMultiplier: 1.5,
    },
];

// ────────────────────────────────────────────── 一、跳数与递减

test('L1：链上 3 个各挨 90%，圈外的第 4 个不在链上', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  同一串、两两间距 ≤ 45（= 150 表值 × 0.3）。
    const near = [makeUnit(2, ZCOwner.Enemy, 20), makeUnit(3, ZCOwner.Enemy, 50), makeUnit(4, ZCOwner.Enemy, 80)];
    //  第 4 个离第 3 个 60 > 45 ⇒ 够不到。
    const far = makeUnit(5, ZCOwner.Enemy, 140);
    const units = [caster, ...near, far];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[0], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.deepEqual(damaged.map((item) => item.id), [2, 3, 4], '从锁定目标起跳，逐跳最近的未命中敌人');
    for (const hit of damaged) {
        assert.equal(hit.damage, 90, 'L1 每个 90%（攻击力 100）');
    }
});

test('L2：4 跳，递减是复利（100 / 90 / 81 / 73），不是线性', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  一字排开，间距 20：每跳都能找到「最近的未命中敌人」。
    const line = [20, 40, 60, 80].map((x, index) => makeUnit(index + 2, ZCOwner.Enemy, x));
    const units = [caster, ...line];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[1], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.equal(damaged.length, 4);
    assert.deepEqual(damaged.map((item) => item.damage), [100, 90, 81, 73],
        '0.9^3 = 0.729 ⇒ 73；线性递减会给 70，这就是两者的分界');
});

test('L3：6 跳 + 终跳强制暴击 150%（120 × 1.5 = 180）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const line = [20, 40, 60, 80, 100, 120].map((x, index) => makeUnit(index + 2, ZCOwner.Enemy, x));
    const units = [caster, ...line];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[2], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.equal(damaged.length, 6, 'L3 命中 6 个');
    //  前五跳：120 × 0.9^k ⇒ 120 / 108 / 97 / 87 / 79（四舍五入）
    assert.deepEqual(damaged.slice(0, 5).map((item) => item.damage), [120, 108, 97, 87, 79]);
    //  终跳：递减**继续走完**（N 列只说「不再衰减」以外没有例外），再叠 150% 的强制暴击
    //  ⇒ 120 × 0.9^5 × 1.5 = 106.3 ⇒ 107。落在 79 之上就是「终跳炸一下」的观感，
    //  而「150% 是把这一跳改成固定 150%」会让终跳比前五跳还小，与「必定暴击」的意图相反。
    assert.equal(damaged[5].damage, 107, '最后一跳必暴：120% × 0.9^5 × 150%');
});

test('只剩 2 个敌人时配 6 跳只打 2 下，绝不原地来回弹', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const a = makeUnit(2, ZCOwner.Enemy, 20);
    const b = makeUnit(3, ZCOwner.Enemy, 30);
    const units = [caster, a, b];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[2], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.deepEqual(damaged.map((item) => item.id), [2, 3], '同一个人只挨一次，链条提前断');
});

test('跳距之外的人不上链（150 表值 × 0.3 = 45 世界 px）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const first = makeUnit(2, ZCOwner.Enemy, 20);
    const justOutside = makeUnit(3, ZCOwner.Enemy, 66);  //  20 + 46 > 45
    const units = [caster, first, justOutside];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[0], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.deepEqual(damaged.map((item) => item.id), [2], '差 1px 都不传过去');
});

// ────────────────────────────────────────────── 二、参数不全 / 目标不合法

test('参数不全（漏了跳距）⇒ 不出手、不消费 CD', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 20);
    const units = [caster, enemy];
    const state = makeState(units);
    const broken = { ...TIER_PARAMS[0] };
    delete (broken as Record<string, number | undefined>).chainJumpRadius;
    const { context, damaged } = chainContext(units, broken, 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), false);
    assert.deepEqual(damaged, [], '漏配跳距时不能「只打首目标」地静默放出去');
    assert.equal(state.combatEvents.length, 0);
});

test('锁定的是建筑 / 死了的目标 ⇒ 按无目标处理', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const dead = makeUnit(2, ZCOwner.Enemy, 20, 0);
    dead.battleState = 'dead';
    dead.hp = 0;
    const units = [caster, dead];
    const state = makeState(units);
    const { context, damaged } = chainContext(units, TIER_PARAMS[0], 2);
    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), false);
    assert.deepEqual(damaged, []);

    //  没有锁定目标（`currentTarget` 返回 null，建筑 / 地块走的就是这条）。
    const { context: noTarget, damaged: second } = chainContext(units, TIER_PARAMS[0], null);
    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, noTarget), false);
    assert.deepEqual(second, []);
});

// ────────────────────────────────────────────── 三、表现事件

test('从卡牌中心起铺：n 个目标 = n 段，z 转 -90°，整条链同帧出现', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const line = [20, 40, 80].map((x, index) => makeUnit(index + 2, ZCOwner.Enemy, x));
    const units = [caster, ...line];
    const state = makeState(units);
    const { context } = chainContext(units, TIER_PARAMS[0], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    const effects = state.combatEvents.filter((event) => event.type === ZCCombatEventType.Area);
    //  链首那一段「卡牌 0 → 目标 20」不再被砍掉（2026-11-19 第 21 批按示意图改口）：
    //  0→20、20→40、40→80 每段都短于单段长度（size ×2 后单段 72.84 世界 px）⇒ 3 条事件。
    assert.equal(effects.length, 3, 'n 个目标 = n 段（含卡牌到目标 1 的那一段）');
    for (const event of effects) {
        assert.equal(event.effectPrefabPath, ZC_CHAIN_EFFECT_PREFAB_PATH);
        //  一对多的事件视图只认 `to` + `angleDegrees`（从不按 radius 缩放）⇒ 起终点必须是这一段的锚点。
        assert.equal(event.fromX, event.toX, '起终点写在同一个锚点上');
        assert.equal(event.fromY, event.toY);
        assert.equal(event.damage, 0, '纯表现事件，伤害已经由 damageUnit 结算');
        assert.ok(Math.abs(event.durationSeconds - ZC_CHAIN_EFFECT_SECONDS) < 1e-9, '单帧静态图，时长只决定它杵多久');
        //  「取消中间飞的过程」：所有段同一帧出现，不再逐跳错开。
        assert.equal(event.startedAt, state.elapsedSeconds, '整条链同帧出现，没有逐跳延迟');
        //  美术长轴是竖的（本地 +y），转到「起点→终点」要 -90°。
        assert.ok(Math.abs(event.angleDegrees! - (-90)) < 1e-6, 'z 轴旋转 -90°（长轴躺平指向下一个目标）');
        //  跟随锚：卡牌 / 目标都可能移动，模型每帧按这两个 id 重算（见「跟随」那条用例）。
        assert.ok(event.followFromUnitId != null && event.followToUnitId != null, '两端都要有跟随锚');
    }
    //  ① 起点回到**卡牌中心**（图上那个红圈），不再从目标 1 开始。
    //  节点沿长轴后退了贴图的透明留白（`ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH`）
    //  ⇒ 锚点落在卡牌中心**之前**一点，有像素的那一截才正好从卡牌中心开始。
    assert.ok(Math.abs(effects[0].toX + ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH) < 1e-6,
        '第一段的锚点 = 卡牌中心 − 透明留白（内容底边才落在卡牌中心）');
    assert.equal(effects[0].followFromUnitId, caster.id, '第一段的起点锚 = 施法者自己');
    assert.equal(effects[0].followToUnitId, 2, '第一段的终点锚 = 目标 1');
    //  ② 段长 ×2 之后（单段 72.84 世界 px），40→80 这段 40 px 用 1 段就够，靠沿长轴拉长覆盖。
    const second = effects.filter((event) => event.followFromUnitId === 3 && event.followToUnitId === 4);
    assert.equal(second.length, 1, '段长翻倍后 40 px 只需 1 段');
    assert.equal(second[0].followPieceIndex, 0);
    assert.equal(second[0].followPieceCount, 1);
    assert.ok(Math.abs((second[0].stretchAlongAxis ?? 1) - 40 / ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH) < 1e-6,
        '一段要正好盖住 40 px ⇒ 倍率 = 40 ÷ 可见覆盖长度');
    //  ③ 逐跳降透明度按「第几段链路」算：卡牌→目标 1 是 1.0，之后 0.88、0.76。
    const bySegment = (from: number) => effects.filter((event) => event.followFromUnitId === from)[0];
    assert.equal(bySegment(caster.id).effectAlpha, 1);
    assert.ok(Math.abs(bySegment(2).effectAlpha! - 0.88) < 1e-9);
    assert.ok(Math.abs(bySegment(3).effectAlpha! - 0.76) < 1e-9);
});

test('复制后压缩：段数 = ceil(段距/单段)，每段压到 段距/段数，末段正好咬住目标中心', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  跳距放到 900 表值（= 270 世界）⇒ 允许一段很长的链路，专门验「复制多少段、压成多长」。
    const far = makeUnit(2, ZCOwner.Enemy, 300);
    const units = [caster, far];
    const state = makeState(units);
    const params = { ...TIER_PARAMS[0], chainTargetCount: 2, chainJumpRadius: 900 };
    const { context } = chainContext(units, params, 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    //  只有一个目标 ⇒ 仍然有「卡牌 → 目标」那一段（不再是「在这个目标身上落一段」的退化路径）。
    const single = state.combatEvents.filter((event) => event.type === ZCCombatEventType.Area);
    assert.equal(single.length, Math.ceil(300 / ZC_CHAIN_SEGMENT_WORLD_LENGTH - 1e-6), '段数按距离算');
    assert.ok(Math.abs(single[0].toX + ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH) < 1e-6,
        '从卡牌中心起铺（锚点扣掉贴图那 11 屏上透明留白）');
    assert.ok(Math.abs(single[0].angleDegrees! - (-90)) < 1e-6, '方向 = 卡牌→目标，再 -90°');

    //  每段压到「段距 / 段数」：复制之后一起压缩，末段右端**正好**落在目标中心。
    const step = 300 / single.length;
    const gap = ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH;
    for (let index = 0; index < single.length; index += 1) {
        assert.ok(Math.abs(single[index].toX - (index * step - gap)) < 1e-6,
            `第 ${index} 段锚点 = 段起点 − 透明留白（${gap.toFixed(2)} 世界 px）`);
        //  只压长轴：均匀倍率仍然是 1（不许把闪电拉粗）。
        assert.equal(single[index].effectScale ?? 1, 1, '不许靠等比放大把一段拉长');
        //  除数是**可见内容长度**（76 屏上），不是 rect 的 89：用 89 会少盖 12%，接缝照漏。
        assert.ok(Math.abs(single[index].stretchAlongAxis! - step / ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH) < 1e-9,
            '每段沿长轴的倍率 = 段长 ÷ 可见内容长度');
        assert.ok(single[index].stretchAlongAxis! > 0 && single[index].stretchAlongAxis! <= 1.2,
            '满段时最多轻微拉长（89/76 ≈ 1.17），不会把闪电拉成虚线');
        //  🔴 2026-11-19 用户圈的缝隙：内容起点在「锚点 + 留白」，长度 = 内容倍率 × 可见长度
        //  ⇒ 末端必须正好落在下一段起点上，一段都不许少。
        const contentEnd = single[index].toX + gap + ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH * single[index].stretchAlongAxis!;
        assert.ok(Math.abs(contentEnd - (index + 1) * step) < 1e-6,
            `第 ${index} 段的内容末端 ${contentEnd.toFixed(3)} 必须咬住下一段起点 ${((index + 1) * step).toFixed(3)}`);
    }
    const last = single[single.length - 1];
    assert.ok(Math.abs(last.toX + gap + step - 300) < 1e-6,
        '末段的右端**正好**咬住目标中心：既不缺口（用户「不能少于」），也不越过半个身子');

    //  两个目标：卡牌 0 → 目标 1 在 300、目标 2 在 570 ⇒ 第二段长 270。
    const second = makeUnit(3, ZCOwner.Enemy, 570);
    const longState = makeState([caster, far, second]);
    const longCtx = chainContext([caster, far, second], params, 2);
    assert.equal(ZCAttackResolutionSystem.castChainLightning(longState, caster, longCtx.context), true);
    const tail = longState.combatEvents
        .filter((event) => event.type === ZCCombatEventType.Area && event.followFromUnitId === 2);
    assert.equal(tail.length, Math.ceil(270 / ZC_CHAIN_SEGMENT_WORLD_LENGTH - 1e-6), '第二段 270 世界 px');
    const tailLast = tail[tail.length - 1];
    assert.ok(Math.abs(tailLast.toX + gap + 270 / tail.length - 570) < 1e-6, '整条链正好收在目标 2 的中心');
});

test('150 px 圆扩散：不是「跳向最近的那一个」—— 只进得了圆的才传导', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    //  目标 1 在 (0,0)；A 在 (0,43)、B 在 (44,0) 都落在它 45 世界 px 的圆内；
    //  C 在 (88,0) 离目标 1 有 88 px，进不了第一个圆，但离 B 只有 44 px。
    const first = makeUnit(2, ZCOwner.Enemy, 0, 0);
    const a = makeUnit(3, ZCOwner.Enemy, 0, 43);
    const b = makeUnit(4, ZCOwner.Enemy, 44, 0);
    const c = makeUnit(5, ZCOwner.Enemy, 88, 0);
    const units = [caster, first, a, b, c];
    const state = makeState(units);
    //  上限 3：目标 1 + 圆内两个。用「最近」的老口径只能打到 A（A→B 相隔 60.8 > 45），
    //  这一条正是新旧判据的分界线。
    const params = { ...TIER_PARAMS[0], chainTargetCount: 3 };
    const { context, damaged } = chainContext(units, params, 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    assert.deepEqual(damaged.map((item) => item.id), [2, 3, 4],
        'A 与 B 都在目标 1 的圆里 ⇒ 两个都被传导；B 不是「离目标 1 最近」的那个也要算');
    assert.equal(damaged.length, 3, '到上限就停，C 不传导');
    assert.ok(!damaged.some((item) => item.id === 5), '圆外的 C 一个伤害都不挨');

    //  上限放开到 4 ⇒ 从 B 的圆再往外扩一层，C 才进链（用户原话「又会产生 1 个目标 2 为圆心的判定范围」）。
    const openState = makeState(units);
    const open = chainContext(units, { ...params, chainTargetCount: 4 }, 2);
    assert.equal(ZCAttackResolutionSystem.castChainLightning(openState, caster, open.context), true);
    assert.deepEqual(open.damaged.map((item) => item.id), [2, 3, 4, 5]);
});

test('跟随：模型每帧按两端单位的当前位置重排（卡牌不动、敌人走开 ⇒ 弧跟着转身并拉长）', () => {
    prepare();
    const game = new ZCGameModel(null, () => 0.5);
    //  🔴 不 spawnUnit：这里只验「每帧重算坐标」这一件事，把单位塞进 `units.byId` 就够
    //  （`syncFollowingCombatEvents` 就是按这个索引查单位的）。走 spawnUnit 反而要另外
    //  铺一张带主基地的地图，把用例耦合到地图配置上。
    const inner = game as unknown as {
        state: ZCSnapshot;
        units: { byId: Map<number, ZCUnitState> };
    };
    const caster = makeUnit(101, ZCOwner.Player, 0, 0);
    const victim = makeUnit(102, ZCOwner.Enemy, 40, 0);
    inner.units.byId.set(caster.id, caster);
    inner.units.byId.set(victim.id, victim);

    const event: ZCCombatEvent = {
        id: inner.state.nextCombatEventId++,
        type: ZCCombatEventType.Area,
        owner: ZCOwner.Player,
        sourceUnitId: caster.id,
        targetUnitId: null,
        skillId: SKILL_ID,
        skillName: '闪电链',
        effectKey: null,
        projectileKey: null,
        effectPrefabPath: ZC_CHAIN_EFFECT_PREFAB_PATH,
        fromX: 0, fromY: 0, toX: 0, toY: 0,
        radius: 0, damage: 0, empowered: false,
        startedAt: inner.state.elapsedSeconds,
        //  比一次 tick 长得多，免得被 `advance()` 开头的裁剪吃掉（那不是这条用例要验的事）。
        durationSeconds: 5,
        angleDegrees: -90,
        followFromUnitId: caster.id,
        followToUnitId: victim.id,
        followPieceIndex: 0,
        followPieceCount: 1,
        stretchAlongAxis: 1,
    };
    inner.state.combatEvents.push(event);

    //  敌人走到卡牌正上方 30 世界 px：弧必须原地转身（-90° 是「朝 +x」，朝 +y 应该是 0°）。
    Object.assign(victim, { freeX: 0, freeY: 30 });
    game.tick(0.05);
    const gap = ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH;
    assert.ok(Math.abs((event.angleDegrees ?? 0) - 0) < 1e-6,
        `敌人绕到正上方 ⇒ 长轴要转到 0°，实际 ${event.angleDegrees}`);
    //  锚点 = 段起点 − 透明留白（沿长轴），朝 +y 走 ⇒ 锚点在卡牌下方 gap 处。
    assert.ok(Math.abs(event.toX) < 1e-6 && Math.abs(event.toY + gap) < 1e-6,
        '第 0 段的锚点 = 卡牌当前位置 − 透明留白（有像素的那截才落在卡牌中心）');
    //  只有 1 段 ⇒ 要覆盖 30 世界 px，而可见内容只有 29.66 ⇒ 倍率 = 30 / 29.66。
    assert.ok(Math.abs((event.stretchAlongAxis ?? 1) - 30 / ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH) < 1e-6,
        '尾端缩到目标身上，而不是让电弧戳过头');

    //  跑到 100 世界 px 外：段数**不重算**（多出来的段没人创建 ⇒ 会缺口），只把这一段拉长。
    Object.assign(victim, { freeX: 100, freeY: 0 });
    game.tick(0.05);
    assert.ok(Math.abs(event.stretchAlongAxis! - 100 / ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH) < 1e-6,
        '距离变长 ⇒ 同一段被拉长（用户原话「跟随旋转或伸缩」）');
    assert.equal(event.followPieceCount, 1, '段数是建链那一刻定下的，跟随时不许改');

    //  卡牌自己也动（被杀兵推走 / 施法者位移）⇒ 起点同样要跟，两端都得跟。
    Object.assign(caster, { freeX: 10, freeY: 10 });
    game.tick(0.05);
    const span = Math.hypot(100 - 10, 0 - 10);
    const anchorX = 10 - gap * (100 - 10) / span;
    const anchorY = 10 - gap * (0 - 10) / span;
    assert.ok(Math.abs(event.toX - anchorX) < 1e-6 && Math.abs(event.toY - anchorY) < 1e-6,
        '起点锚也跟着施法者走（仍然要扣掉沿长轴的透明留白）');
    const expectedAngle = Math.atan2(0 - 10, 100 - 10) * 180 / Math.PI - 90;
    assert.ok(Math.abs((event.angleDegrees ?? 0) - expectedAngle) < 1e-6,
        `(10,10) → (100,0) 的方向要 -90° 摆平，期望 ${expectedAngle}，实际 ${event.angleDegrees}`);

    //  单位没了（阵亡被摘掉）⇒ 冻结在最后一次的位置，不许除零或甩到 0°。
    const frozenX = event.toX;
    inner.units.byId.delete(victim.id);
    game.tick(0.05);
    assert.equal(event.toX, frozenX, '一端查不到 ⇒ 整条跳过，冻在原地');
});

test('电弧预制：三帧序列 + 底端钉在原点，屏上长度 = 常量里的 186.666（size 已 ×2）', () => {
    const rel = `${ZC_CHAIN_EFFECT_PREFAB_PATH}.prefab`;
    assert.ok(assetExists(rel),
        '代码常量指向的预制必须真的在包里，否则「照常掉血、屏幕没东西」');
    assert.ok(rel.includes('闪电链水墨风'), '2026-11-19 第 23 批：换成水墨风素材，不许退回旧的落雷图');
    const objects = JSON.parse(readFileSync(assetPath(rel), 'utf8')) as Array<Record<string, unknown>>;
    const node = objects.find((item) => item.__type__ === 'cc.Node')!;
    const transform = objects.find((item) => item.__type__ === 'cc.UITransform')!;
    const scale = (node._lscale as { x: number; y: number });
    const position = (node._lpos as { x: number; y: number });
    const size = (transform._contentSize as { width: number; height: number });
    const screenLength = size.height * scale.y;
    assert.ok(Math.abs(screenLength - ZC_CHAIN_SEGMENT_SCREEN_LENGTH) < 0.5,
        `单段屏上长度 ${screenLength} 与常量 ${ZC_CHAIN_SEGMENT_SCREEN_LENGTH} 不一致 —— 换美术没同步常量，`
        + '「一段够不够」就会算错（少了链条断开、多了每跳多铺一段）');
    //  「左侧端点在目标 1 的中心点」= 底端落在节点原点 ⇒ 根 `_lpos.y` 必须是屏上一半高度。
    assert.ok(Math.abs(position.y - screenLength / 2) < 0.5,
        '根 _lpos.y 必须是屏上高度的一半，否则链条会整体偏掉半段');

    //  2026-11-19 第二轮（用户「闪电链没有播放序列帧，怎么是静态的」）：必须挂动画 + 三帧轨道。
    const animation = objects.find((item) => item.__type__ === 'cc.Animation');
    assert.ok(animation, '必须挂 cc.Animation：只给一帧就是静态贴图');
    const clipUuid = ((animation!._defaultClip as { __uuid__?: string })?.__uuid__);
    assert.ok(clipUuid, 'cc.Animation 必须有 defaultClip，否则视图拿不到 clipName');
    const animRel = 'units/projectiles/闪电链水墨风/anim/闪电链水墨风.anim';
    assert.ok(assetExists(animRel), '序列帧片段必须真的在包里');
    const clip = JSON.parse(readFileSync(assetPath(animRel), 'utf8')) as Record<string, unknown>;
    assert.equal((clip._name as string), '闪电链水墨风', 'clip 名 = 视图 play(clipName) 用的那个');
    assert.equal((clip.wrapMode as number), 2, '2 = Loop：链路活着期间要一直闪，不是播一遍就定住');
    const track = (clip._tracks as Array<Record<string, unknown>>)[0];
    const paths = ((track._binding as { path: { _paths: unknown[] } }).path._paths);
    assert.equal((paths[0] as { component?: string }).component, 'cc.Sprite');
    assert.equal(paths[1], 'spriteFrame', '轨道要绑 cc.Sprite.spriteFrame');
    const curve = (((track._channel as { _curve: { _times: number[]; _values: Array<{ __uuid__: string }> } })._curve));
    assert.equal(curve._values.length, 3, 'frame_01 / 02 / 03 三帧');
    assert.equal(curve._times.length, 3);
    assert.ok((clip._duration as number) > 0, '时长必须大于 0');
    //  每帧都得是真 spriteFrame（`@f9941` 子资源），不是 png 本体 —— 少一层就永远画不出来。
    for (const value of curve._values) {
        assert.ok(value.__uuid__.endsWith('@f9941'), `轨道帧 ${value.__uuid__} 必须是 spriteFrame 子资源`);
    }
});

test('段间贴合（2026-11-19 第 23 批）：可见长度扣掉贴图透明留白，满段只轻微拉长', () => {
    //  水墨风 rect 186.67 屏上（size 已 ×2），靠锚点那 1 屏上是透明的（原图 108×282、
    //  内容画到 raw 281、rect 覆盖 raw 2..282 ⇒ 实测只空 0.33，留 1 吃掉笔锋那行淡像素）。
    //  这几个数是「一段能盖多长」的唯一口径，换美术必须一起改。
    assert.equal(ZC_CHAIN_SEGMENT_SCREEN_LENGTH, 186.666, '280 × 0.666666');
    assert.equal(ZC_CHAIN_SEGMENT_LEADING_GAP_SCREEN_LENGTH, 1);
    assert.ok(Math.abs(ZC_CHAIN_SEGMENT_VISIBLE_SCREEN_LENGTH - (186.666 - 1)) < 1e-6,
        '可见长度 = rect 186.67 − 透明留白 1');
    assert.ok(Math.abs(ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH - 1 / 2.5625) < 1e-9,
        '透明留白换算成世界 px（屏上 1 ÷ 2.5625）');
    assert.ok(Math.abs(ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH - (186.666 - 1 - 2) / 2.5625) < 1e-9,
        '覆盖长度 = 可见 185.67 − 重叠 2（重叠吃掉接缝处的弱像素）');

    //  刚好一段的距离：内容被拉到 rect 那么长（186.67/183.67 ≈ 1.016），仍然只动长轴。
    const layout = zcChainArcPieceLayout(0, 0, ZC_CHAIN_SEGMENT_WORLD_LENGTH, 0, 0);
    assert.equal(layout.count, 1);
    assert.ok(layout.stretch > 1 && layout.stretch < 1.1,
        `满段倍率 ${layout.stretch.toFixed(3)} 应是轻微拉伸（把透明留白挤出段外），不是翻倍`);
    //  节点后退的量正好等于透明留白 ⇒ 「锚点 + 留白」才是有像素的起点。
    assert.ok(Math.abs(layout.offsetX + ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH) < 1e-9);
    assert.ok(Math.abs(layout.offsetY) < 1e-9, '朝 +x 铺时不应有 y 向偏移');
    //  内容末端 = 段起点 + step ⇒ 首尾相接地咬住，不留缝也不越过。
    const contentEnd = layout.offsetX + ZC_CHAIN_SEGMENT_LEADING_GAP_WORLD_LENGTH
        + ZC_CHAIN_SEGMENT_COVER_WORLD_LENGTH * layout.stretch;
    assert.ok(Math.abs(contentEnd - ZC_CHAIN_SEGMENT_WORLD_LENGTH) < 1e-9,
        `内容末端 ${contentEnd.toFixed(3)} 要正好落在段末 ${ZC_CHAIN_SEGMENT_WORLD_LENGTH.toFixed(3)}`);
});

test('逐跳降透明度：首跳 1.0、之后每跳 −0.12、封底 0.4', () => {
    assert.equal(zcChainEffectAlpha(0), 1);
    assert.ok(Math.abs(zcChainEffectAlpha(1) - 0.88) < 1e-9);
    assert.ok(Math.abs(zcChainEffectAlpha(5) - 0.4) < 1e-9);
    assert.equal(zcChainEffectAlpha(20), ZC_CHAIN_FADE_FLOOR, '再往后不许继续掉到看不见');
});

// ────────────────────────────────────────────── 四、触发车道

test('冷却制：开局首次只挂 CD，12 秒后才放；且复用不了 boltReadyAt', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const enemy = makeUnit(2, ZCOwner.Enemy, 20);
    const units = [caster, enemy];
    const state = makeState(units);
    const runtime = {
        skillChainId: CHAIN, behaviorKey: ZC_CHAIN_BEHAVIOR_KEY,
        trigger: 'none', stateMode: 'none', parameters: { ...TIER_PARAMS[0] },
    } as unknown as ZCSkillRuntimeDefinition;
    let casts = 0;
    const params = {
        statusSystem: { statModsOf: () => ({}), hasDef: () => false, apply: () => ({ applied: false }), exportSnapshot: () => ({ nextUid: 1, units: [] }) },
        runtimeOf: (unit: ZCUnitState) => (unit.owner === ZCOwner.Player ? runtime : undefined),
        castChainLightning: () => { casts += 1; return true; },
        inAttackRange: () => true,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, '首次只挂 CD，开局不立刻放');
    assert.equal(caster.chainReadyAt, 12);
    assert.equal(caster.boltReadyAt, undefined, '不许占用五雷轰顶那格 CD');

    state.elapsedSeconds = 11.9;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 0, 'CD 没到不放');

    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(casts, 1, 'CD 到点放一次');
    assert.equal(caster.chainReadyAt, 24, 'CD 推到 now + 12');
});

test('参数不全被拒时不吃 CD（下帧重试）', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const units = [caster];
    const state = makeState(units);
    const runtime = {
        skillChainId: CHAIN, behaviorKey: ZC_CHAIN_BEHAVIOR_KEY,
        trigger: 'none', stateMode: 'none', parameters: { ...TIER_PARAMS[0] },
    } as unknown as ZCSkillRuntimeDefinition;
    const params = {
        statusSystem: { statModsOf: () => ({}), hasDef: () => false, apply: () => ({ applied: false }), exportSnapshot: () => ({ nextUid: 1, units: [] }) },
        runtimeOf: () => runtime,
        castChainLightning: () => false,
        inAttackRange: () => true,
        healUnit: () => undefined,
        statPatchOf: () => ({}),
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    state.elapsedSeconds = 0;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    state.elapsedSeconds = 12;
    ZCSkillTriggerSystem.tick(state, 0.05, params);
    assert.equal(caster.chainReadyAt, 12, '被拒之后 CD 原地不动');
    assert.equal(caster.castActionUntil, undefined, '没放出去就不该播施法动作');
});

// ────────────────────────────────────────────── 五、接线与白名单

test('车道注册三处齐全：运行时 / 行为键白名单 / 触发系统', () => {
    const runtime = readFileSync('assets/script/app/zcds/model/ZCSkillRuntime.ts', 'utf8');
    assert.match(runtime, /register\('chain_damage'/, '参数永远进不了运行时');
    const schema = readFileSync('assets/script/app/zcds/model/ZCStatSchema.ts', 'utf8');
    assert.match(schema, /'chain_damage'/, 'behaviorKey 不在白名单 ⇒ 计划行会被判非法');
    const trigger = readFileSync('assets/script/app/zcds/model/systems/ZCSkillTriggerSystem.ts', 'utf8');
    //  第五个参数 2026-11-20 起是「闸门访问器」而不是算好的 `release`：闪电链与飓风共用一个
    //  `getRelease`，只在自己那一拍真要放的时候才去扫目标（见 `ZCSkillTriggerSystem.tick`）。
    //  这条守卫只认「真的被调用 + 带着闸门」，不再钉死形参名。
    assert.match(trigger, /applyChainLightning\(unit, params, now, context, \w+\)/, 'tick 里要真的被调用');
});

test('chainReadyAt 进了快照白名单（不还原会读档白送一次）', () => {
    const types = readFileSync('assets/script/app/zcds/model/ZCGameTypes.ts', 'utf8');
    assert.match(types, /chainReadyAt\?: number;/);
    const codec = readFileSync('assets/script/app/zcds/model/ZCSnapshotCodec.ts', 'utf8');
    assert.match(codec, /'chainReadyAt'/);
});

test('电弧预制必须进加载清单，否则「照常掉血、屏幕上一道电弧都没有」', () => {
    assert.deepEqual(zcChainLightningEffectPaths(ZC_CHAIN_BEHAVIOR_KEY), [ZC_CHAIN_EFFECT_PREFAB_PATH]);
    assert.deepEqual(zcChainLightningEffectPaths('bolt_strike'), [], '五雷轰顶走自己那一份');

    const unit = (unitId: string) => ({
        unitId,
        attackProfile: { effectPrefabPath: null, impactEffectPrefabPath: null },
    });
    const plan = (unitId: string, behaviorKey: string) => ({ enabled: true, unitId, behaviorKey });
    const withChain = buildZCVisualResourcePlan(
        [unit(UNIT_ID)],
        { skillPlans: [plan(UNIT_ID, ZC_CHAIN_BEHAVIOR_KEY)], textOverrides: new Map() },
    );
    assert.ok(withChain.effectPaths.includes(ZC_CHAIN_EFFECT_PREFAB_PATH));
    //  2026-11-19 起闪电链有**专属**预制（不再和五雷轰顶共用劈雷）⇒ 反向断言可以落在清单上：
    //  别的车道不许凭空把这条电弧一起收进来。
    const unrelated = buildZCVisualResourcePlan(
        [unit(UNIT_ID)],
        { skillPlans: [plan(UNIT_ID, 'fan_slow')], textOverrides: new Map() },
    );
    assert.equal(unrelated.effectPaths.includes(ZC_CHAIN_EFFECT_PREFAB_PATH), false,
        '别的车道不该凭空多一条电弧');
});

// ────────────────────────────────────────────── 六、配表真值

test('102203 三档：chain 前缀 + 4/6/8 个 + 90/100/120% + 递减 + 终跳必暴', () => {
    for (const rows of [readRows('pvpSkillPlan'), readClient('pvpSkillPlan')]) {
        const plan = rows.filter((row) => Number(row.skillChainId) === CHAIN)
            .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(plan.length, 3, '三档都要在');
        plan.forEach((row, index) => {
            const want = TIER_PARAMS[index];
            const bag = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
            assert.deepEqual(Object.keys(bag).filter((key) => !key.startsWith('chain')), [],
                '参数全带 chain 前缀，否则会串到 102201 / 102202 / 102204');
            assert.equal(row.behaviorKey, ZC_CHAIN_BEHAVIOR_KEY);
            assert.equal(row.skillKind, 'active_cd');
            assert.equal(row.stateMode, 'none');
            assert.equal(Number(row.unitId), Number(UNIT_ID));
            assert.equal(Number(row.pvpSkillId), SKILL_ID);
            assert.equal(Number(row.unlockHeroLevel), [9, 18, 27][index]);
            assert.equal(bag.chainCooldown, 12, '设计 J 列');
            assert.equal(bag.chainTargetCount, want.chainTargetCount);
            assert.equal(bag.chainDamageRate, want.chainDamageRate);
            assert.equal(bag.chainFalloff, want.chainFalloff, 'I 级必须显式 0（省了会被下一个人补成 0.1）');
            assert.equal(bag.chainJumpRadius, 150);
            if (index === 2) {
                assert.equal(bag.chainFinalCritMultiplier, 1.5, 'III 级终跳必暴');
            } else {
                assert.equal(bag.chainFinalCritMultiplier, undefined, 'I/II 级不许出现这条键');
            }
        });
    }
});

test('卡面描述（K 表 / armySkillLevelUp）与计划行逐字一致，修改器已接上', () => {
    const plans = readRows('pvpSkillPlan')
        .filter((row) => Number(row.skillChainId) === CHAIN)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const cards of [readRows('armySkillLevelUp'), readClient('armySkillLevelUp')]) {
        const rows = cards.filter((row) => Number(row.id) === CHAIN)
            .sort((a, b) => Number(a.skilllevel) - Number(b.skilllevel));
        assert.equal(rows.length, 3);
        rows.forEach((row, index) => {
            assert.equal(row.name, '闪电链');
            assert.equal(row.desc, plans[index].desc);
            assert.equal(Number(row.unlockarmylevel), [9, 18, 27][index]);
            assert.deepEqual(row.modfiy, [94022031 + index]);
        });
    }
});
