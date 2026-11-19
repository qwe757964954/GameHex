/**
 * 雷蕉（68022）「闪电链」102203（2026-11-18，第 17 批）—— 纯新增 `chain_damage` 车道。
 *
 * 设计案 K/L/M 三档（J 列冷却 12 秒）：
 *   L1 兵种 9 级：命中 3 个敌人，每个 90%；
 *   L2 兵种 18 级：命中 4 个，每个 100%，每跳损耗 10%；
 *   L3 兵种 27 级：命中 6 个，每个 120%，最后一跳必定暴击 150%。
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
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCFloatText, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import { buildZCVisualResourcePlan } from '../assets/script/app/zcds/model/ZCVisualResourcePlan';
import {
    ZC_CHAIN_BEHAVIOR_KEY, ZC_CHAIN_EFFECT_PREFAB_PATH, ZC_CHAIN_EFFECT_SECONDS,
    ZC_CHAIN_FADE_FLOOR, ZC_CHAIN_STEP_SECONDS, zcChainEffectAlpha, zcChainLightningEffectPaths,
} from '../assets/script/app/zcds/model/ZCChainLightningFx';
import { assetPath } from './helpers/asset-paths';

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
    { chainCooldown: 12, chainTargetCount: 3, chainDamageRate: 0.9, chainFalloff: 0, chainJumpRadius: 150 },
    { chainCooldown: 12, chainTargetCount: 4, chainDamageRate: 1, chainFalloff: 0.1, chainJumpRadius: 150 },
    {
        chainCooldown: 12, chainTargetCount: 6, chainDamageRate: 1.2,
        chainFalloff: 0.1, chainJumpRadius: 150, chainFinalCritMultiplier: 1.5,
    },
];

// ────────────────────────────────────────────── 一、跳数与递减

test('L1：3 个敌人各挨 90%，第 4 个不在链上', () => {
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

test('每跳一条 area 事件：摆在这一跳的落点、角度朝上一跳 → 这一跳', () => {
    prepare();
    const caster = makeUnit(1, ZCOwner.Player, 0);
    const line = [20, 40, 80].map((x, index) => makeUnit(index + 2, ZCOwner.Enemy, x));
    const units = [caster, ...line];
    const state = makeState(units);
    const { context } = chainContext(units, TIER_PARAMS[0], 2);

    assert.equal(ZCAttackResolutionSystem.castChainLightning(state, caster, context), true);
    const effects = state.combatEvents.filter((event) => event.type === ZCCombatEventType.Area);
    assert.equal(effects.length, 3, '三跳三条表现');
    effects.forEach((event, index) => {
        assert.equal(event.effectPrefabPath, ZC_CHAIN_EFFECT_PREFAB_PATH);
        //  一对多的事件视图只认 `to` + `angleDegrees`（从不按 radius 缩放）⇒ 起终点必须都是落点。
        assert.equal(event.fromX, event.toX, '起终点写在同一个落点上');
        assert.equal(event.fromY, event.toY);
        assert.equal(event.toX, line[index].freeX, '落点 = 这一跳打的人');
        assert.equal(event.damage, 0, '纯表现事件，伤害已经由 damageUnit 结算');
        assert.ok(Math.abs(event.durationSeconds - ZC_CHAIN_EFFECT_SECONDS) < 1e-9, '活够整段序列帧');
        assert.ok(Math.abs(event.startedAt - index * ZC_CHAIN_STEP_SECONDS) < 1e-9, '逐跳错开');
    });
    assert.ok(Math.abs(effects[0].angleDegrees! - 0) < 1e-6, '首跳朝 +x（朝向首个目标）');
    assert.ok(Math.abs(effects[2].angleDegrees! - 0) < 1e-6, '第三跳仍在同一水平线上');
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
    assert.match(trigger, /applyChainLightning\(unit, params, now, context, release\)/, 'tick 里要真的被调用');
});

test('chainReadyAt 进了快照白名单（不还原会读档白送一次）', () => {
    const types = readFileSync('assets/script/app/zcds/model/ZCGameTypes.ts', 'utf8');
    assert.match(types, /chainReadyAt\?: number;/);
    const codec = readFileSync('assets/script/app/zcds/model/ZCSnapshotCodec.ts', 'utf8');
    assert.match(codec, /'chainReadyAt'/);
});

test('每跳那记雷必须进加载清单，否则「照常掉血、屏幕上一道电弧都没有」', () => {
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
    //  ⚠ 不能拿 `bolt_strike` 做反向断言：两条车道用的是**同一个** prefab
    //  （磁电菇_劈雷技能），清单里出现这条路径无法区分是谁收进来的。
    //  所以反向证据只能落在「判据本身」上 —— 上面那两条 `zcChainLightningEffectPaths` 断言。
    const unrelated = buildZCVisualResourcePlan(
        [unit(UNIT_ID)],
        { skillPlans: [plan(UNIT_ID, 'fan_slow')], textOverrides: new Map() },
    );
    assert.equal(unrelated.effectPaths.includes(ZC_CHAIN_EFFECT_PREFAB_PATH), false,
        'other lane 之外的卡不该凭空多一条劈雷');
});

// ────────────────────────────────────────────── 六、配表真值

test('102203 三档：chain 前缀 + 3/4/6 跳 + 90/100/120% + 递减 + 终跳必暴', () => {
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
