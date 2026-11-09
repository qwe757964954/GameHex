import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans,
} from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCProjectileState, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCProjectileSystem } from '../assets/script/app/zcds/model/systems/ZCProjectileSystem';
import { assetPath } from './helpers/asset-paths';

/**
 * 玉林好汉（68004）2026-10-30 全套：配表真值 + 三条新能力的运行期落点。
 *
 * 设计案（`技能设计案2.xlsx` 第 17~21 行）到代码之间有三处「照字面写会静默失效」：
 *
 *  1. **计划行的 `skillParamJson` 只有在 `pvpSkillBinding` 已有同键时才被合并**
 *     （`ZCMatchRuntimeCompiler.mergeSkillPlanIntoRuntime` 返回 null 就丢弃）。
 *     玉林好汉没有 30716 的 binding 行，所以走的是「新建 runtime」那条分支 ——
 *     那条分支原本不合并 `skillParams`，表现为「表里填了 pierceCount、运行时读不到」。
 *  2. **`pierceFalloff` 是新增参数**：穿透弹道本来只扣人数、不扣伤害。
 *  3. **`damageRate` 在 unit 域原本是空转**：`ZCStatSchema` 认得这个 statId，
 *     但 `ZCUnitStatPatch` 没有对应字段、`typedToLegacyPatch` 也没有 case，
 *     所以 `pvpSkillPlan.statId = damageRate` 会被 `default: break` 静默吃掉。
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

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('玉林好汉：普攻换成 30716（自己的飞镖），强化那一击指向 30821', () => {
    prepare();
    const skills = new Map(readRows('pvpSkill').map((row) => [Number(row.skillId), row]));
    const cards = readRows('pvpCard');

    const card = cards.find((row) => Number(row.id) === 68004);
    assert.ok(card, '68004 必须在 pvpCard 里');
    assert.equal(Number(card!.unitSkillId), 30716, '玉林好汉必须换到自己的普攻行（原 30715 是玉米射手的）');

    const dart = skills.get(30716);
    assert.ok(dart, '30716 必须存在');
    assert.equal(dart!.mode, 'projectile');
    // 设计案 200401：「弹速 500，命中结算 1 次伤害」
    assert.equal(Number(dart!.projectileSpeed), 500);
    // 设计案 100404：「主动-冷却 10 秒」⇒ 走时间触发
    assert.equal(dart!.trigger, 'every_seconds');
    assert.equal(Number(dart!.cooldown), 10);
    assert.equal(Number(dart!.empoweredSkillId), 30821);
    assert.equal(dart!.effectPrefabPath, 'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻');

    const ultimate = skills.get(30821);
    assert.ok(ultimate, '30821 必须存在');
    assert.equal(ultimate!.mode, 'projectile', '精英猎手仍是弹道，只是穿透');
    // 「子弹大小 ×3」不写参数，而是换一张 `_lscale` 更大的同源 prefab（§1.10 尺寸真源唯一）
    assert.equal(ultimate!.effectPrefabPath,
        'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化');

    // 30715 必须原样留给玉米射手，不能被这次改动带走。
    const corn = skills.get(30715);
    assert.ok(corn, '30715（玉米射手普攻）必须保留');
    assert.equal(corn!.effectPrefabPath, 'units/projectiles/玉米射手_普攻/玉米射手_普攻');
});

test('玉林好汉：12 行技能计划齐备，且 100404 三档的穿透/衰减/倍率逐档递增', () => {
    prepare();
    const plans = readRows('pvpSkillPlan').filter((row) => String(row.unitId) === '68004');
    assert.equal(plans.length, 12, '4 条技能 × 3 档');

    const byChain = (chainId: number): Array<Record<string, unknown>> => plans
        .filter((row) => Number(row.skillChainId) === chainId)
        .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
    for (const chainId of [100401, 100402, 100403, 100404]) {
        const tiers = byChain(chainId);
        assert.equal(tiers.length, 3, `${chainId} 必须三档齐备`);
        // 设计案写「兵种 0 级」，但 `ZCStatSchema` 硬校验 unlockHeroLevel >= 1，所以落成 1。
        for (const tier of tiers) assert.ok(Number(tier.unlockHeroLevel) >= 1);
        // 全部挂在普攻行 30716 上：`sendAttack` 取运行时用的键是 `${unitId}:${profile.skillId}`。
        for (const tier of tiers) assert.equal(Number(tier.pvpSkillId), 30716);
    }

    // 100401 攻速 +10% / 100403 移速 +15%：三级同值、replace。
    for (const [chainId, statId, value] of [[100401, 'attackSpeed', 0.1], [100403, 'moveSpeed', 0.15]] as const) {
        for (const tier of byChain(chainId)) {
            assert.equal(tier.statId, statId);
            assert.equal(tier.operation, 'addRate');
            assert.equal(Number(tier.value), value);
            assert.equal(tier.progressionMode, 'replace');
        }
    }
    // 100402 铁质飞镖：伤害倍率，不是攻击力（设计案 N 列「不抬高面板」）。
    for (const tier of byChain(100402)) {
        assert.equal(tier.statId, 'damageRate');
        assert.equal(tier.operation, 'addRate');
        assert.equal(Number(tier.value), 0.1);
    }

    // 100404 精英猎手：60/70/80%，穿透 3/6/8 人，每穿一人 -20%。
    const ultimate = byChain(100404).map((row) => JSON.parse(String(row.skillParamJson)) as Record<string, number>);
    assert.deepEqual(ultimate.map((params) => params.damageRate), [0.6, 0.7, 0.8]);
    assert.deepEqual(ultimate.map((params) => params.pierceCount), [3, 6, 8]);
    assert.deepEqual(ultimate.map((params) => params.pierceFalloff), [0.2, 0.2, 0.2]);
});

// ── 二、计划行参数必须真的进运行时（无 binding 的分支） ────────────────────────

test('100404 没有 pvpSkillBinding 行时，skillParamJson 仍进得到 skillRuntime.parameters', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    // 玉林好汉没有任何 30716 的 binding 行 —— 这条断言把「没有 binding 也必须能读到参数」钉住。
    const bindings = readRows('pvpSkillBinding');
    assert.equal(bindings.some((row) => Number(row.pvpSkillId) === 30716), false,
        '前提变了：30716 现在有 binding 行，这条用例应改成走 merge 分支');

    const selected = selectZCSkillPlans('68004', 25, catalogs);
    // 四条链都是 `replace`（设计案「三级同值，不叠加」）⇒ 25 级每条链只留最高档，共 4 行。
    assert.equal(selected.length, 4, 'replace 语义下每条链只保留一档');
    assert.deepEqual(selected.map((row) => row.modifierId).sort(),
        [91004013, 91004023, 91004033, 91004043], '25 级应全部落到 III 级档');
    const loadout = compileZCCombatBuild({
        unitId: '68004', heroLevel: 25, generalStar: { generalId: 68004, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');

    const runtime = compileZCMatchRuntime({
        ...config,
        ownerDecks: { [ZCOwner.Player]: [], [ZCOwner.Enemy]: [] },
        modifiers: { [ZCOwner.Player]: [loadout], [ZCOwner.Enemy]: [] },
    } as never);
    const skill = runtime.skillRuntime[ZCOwner.Player].get('68004:30716');
    assert.ok(skill, '68004:30716 必须建出运行时（否则 sendAttack 读不到任何参数）');
    // L3 档：80% 倍率、穿透 8 人、每次 -20%。
    assert.equal(skill!.parameters.damageRate, 0.8);
    assert.equal(skill!.parameters.pierceCount, 8);
    assert.equal(skill!.parameters.pierceFalloff, 0.2);
});

test('100402 铁质飞镖的 damageRate 落进 unit 域 statPatch（不再被 default 吞掉）', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const loadout = compileZCCombatBuild({
        unitId: '68004', heroLevel: 25, generalStar: { generalId: 68004, star: 1 },
    }, config.units, catalogs).find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    // 三档同值 10%，replace ⇒ 最终只留一条，值 10（百分数整数）。
    assert.equal(loadout!.statPatch.damageRatePct, 10, 'damageRate 必须折成 damageRatePct');
    // 100401 / 100403 的老属性不受影响。
    assert.equal(loadout!.statPatch.attackSpeedPct, 10);
    assert.equal(loadout!.statPatch.moveSpeedPct, 15);
});

// ── 三、穿透衰减（新增 pierceFalloff） ────────────────────────────────────────

function makeProjectile(overrides: Partial<ZCProjectileState> = {}): ZCProjectileState {
    return {
        id: 1, type: 'projectile', owner: ZCOwner.Player,
        sourceUnitId: 1, sourceCardId: '68004',
        targetKind: 'unit', targetId: 99, targetUnitId: 99,
        skillId: 30821, skillName: '精英猎手',
        effectKey: null, projectileKey: null, effectPrefabPath: null,
        fromX: 0, fromY: 0, toX: 400, toY: 0,
        x: 0, y: 0, previousX: 0, previousY: 0,
        velocityX: 500, velocityY: 0,
        baseDamage: 100, damage: 100, radius: 0,
        collisionRadius: 3, canHitAir: true,
        empowered: true, criticalHit: false,
        startedAt: 0, durationSeconds: 1,
        remainingPierces: 3, hitUnitIds: [],
        executeChance: 0, onHitStatusId: undefined, legacyBuffs: [],
        ...overrides,
    } as ZCProjectileState;
}

function makeEnemy(id: number, x: number): ZCUnitState {
    return {
        id, owner: ZCOwner.Enemy, unitId: '68001', cardId: '68001', tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    } as ZCUnitState;
}

function runPierce(falloff: number | undefined) {
    const system = new ZCProjectileSystem();
    const enemies = [makeEnemy(10, 60), makeEnemy(11, 120), makeEnemy(12, 180), makeEnemy(13, 240)];
    const projectile = makeProjectile(falloff === undefined ? {} : { pierceFalloff: falloff });
    const projectiles: ZCProjectileState[] = [projectile];
    const hits: Array<{ id: number; damage: number }> = [];
    system.beginStep(enemies);
    for (let step = 0; step < 60; step += 1) {
        const now = 0.05 * (step + 1);
        system.update(projectiles, 0.05, {
            now,
            units: enemies,
            distanceScale: 0.3,
            structureTargets: () => {},
            hit: (shot, target) => { hits.push({ id: target.id, damage: Math.round(shot.baseDamage) }); },
            effectiveDefinition: () => ({ bodyRadius: 6, flying: false }) as never,
        });
        if (!projectiles.length) break;
    }
    return hits;
}

test('pierceFalloff = 0.2：每穿一人伤害降 20%，一共穿 3 人', () => {
    const hits = runPierce(0.2);
    assert.equal(hits.length, 4, `1 次初始命中 + 3 次穿透，实际 ${JSON.stringify(hits)}`);
    assert.deepEqual(hits.map((hit) => hit.damage), [100, 80, 64, 51],
        'baseDamage 就地乘 0.8：100 → 80 → 64 → 51（round 后）');
});

test('不配 pierceFalloff 时伤害不衰减（既有穿透弹道行为逐字不变）', () => {
    const hits = runPierce(undefined);
    assert.equal(hits.length, 4);
    assert.deepEqual(hits.map((hit) => hit.damage), [100, 100, 100, 100]);
});
