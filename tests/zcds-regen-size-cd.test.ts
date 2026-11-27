/**
 * 第 8 批：新车道被动（100601 孢子回流 / 101602 巨囊弹体）。
 *
 * 两条都是设计案 P 列标了「🔴 新字段」的，本批才真正有 statId 与消费点：
 *   · `hpRegenPct`      —— 每秒回复最大生命的百分比（`ZCSkillTriggerSystem.applyHpRegen`）
 *   · `bulletSizeScale` —— 普攻弹体体积倍率（`collisionRadius` 与视图 `sizeScale` 两处）
 *
 * ⚠️ 本批原有第三条 `102401 裂变共鸣`（`cdReduceOnHit`：命中回退其他主动 CD），
 * 已于第 10 批按用户口径**整条下线**（换成「子弹穿过己方单位回血」，见
 * `tests/zcds-ally-pierce-heal.test.ts`）。字段与车道一并从代码里拆掉，
 * 所以这里不再有对应用例 —— 别再按旧笔记把它加回来。
 *
 * 🔴 最容易踩的两件事，下面各有一条用例钉住：
 *   ① 两个字段都**没有基础值**，只能 `add`；写 `addRate` 会乘 baseValue(0) 恒为 0；
 *   ② 回血必须在**整秒边界**结算一次，逐帧按比例切碎会被 `healUnit` 的取整抹掉。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type {
    ZCCombatTarget, ZCProjectileState, ZCSnapshot, ZCUnitState,
} from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import type { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { applyZCTypedUnitModifiers } from '../assets/script/app/zcds/model/ZCStatSchema';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';
import {
    ZCAttackResolutionSystem, zcBulletSizeScale, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

const REMOTE = 'assets/remoteRef';
const CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client';

function remoteRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`${REMOTE}/${name}.json`, 'utf8')) as { k: string[]; v: unknown[][] };
    return source.v.map((row) => Object.fromEntries(source.k.map((key, index) => [key, row[index]])));
}

function clientRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`${CLIENT}/${name}.json`, 'utf8')) as Array<Record<string, unknown>>;
}

function paramsOf(row: Record<string, unknown>): Record<string, number> {
    return JSON.parse(String(row.skillParamJson ?? '{}')) as Record<string, number>;
}

/** 本批 2 条：链 → (卡, 名称, 解锁档, 主链 statId, 三档值)。 */
const SKILLS: Array<{
    chain: number; card: string; name: string; levels: [number, number, number];
    statId: string; values: [number, number, number];
}> = [
    { chain: 100601, card: '68006', name: '孢子回流', levels: [2, 10, 22], statId: 'hpRegenPct', values: [1.5, 1.8, 2.1] },
    { chain: 101602, card: '68016', name: '巨囊弹体', levels: [3, 16, 26], statId: 'bulletSizeScale', values: [1.6, 1.75, 1.9] },
];

// ── 一、配表 ──────────────────────────────────────────────────────────────────

test('3 条新车道：主链 statId 走 add、三档数值与解锁等级对齐设计案', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        for (const spec of SKILLS) {
            const tiers = rows.filter((row) => Number(row.skillChainId) === spec.chain)
                .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
            assert.equal(tiers.length, 3, `${spec.chain} 必须三档齐备`);
            for (const [index, row] of tiers.entries()) {
                assert.equal(String(row.unitId), spec.card, `${spec.chain} L${index + 1} 挂错卡`);
                assert.equal(row.statId, spec.statId, `${spec.chain} L${index + 1} 的 statId`);
                //  三个字段都没有基础值 ⇒ 只能是 `add`。写 `addRate` 会乘 baseValue(0) 恒为 0。
                assert.equal(row.operation, 'add', `${spec.chain} L${index + 1} 必须是 add`);
                assert.equal(Number(row.value), spec.values[index], `${spec.chain} L${index + 1} 数值`);
                assert.equal(Number(row.unlockHeroLevel), spec.levels[index], `${spec.chain} L${index + 1} 解锁等级`);
            }
        }
    }
});

test('100601 孢子回流：旧「黏液阻滞」移速整条清掉，暴击率混搭不超过 15%', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        for (const row of rows.filter((item) => Number(item.skillChainId) === 100601)) {
            assert.notEqual(row.statId, 'moveSpeed', '移速是老机制，必须清空');
            //  暴击率混搭：`mix.critRate` 是**百分点**（8 = +8%），与 statId 那一列的口径一致。
            assert.ok(paramsOf(row)['mix.critRate'] <= 15, `L${row.skillLevel} 暴击率越过 15% 上限`);
            assert.equal(paramsOf(row)['mix.attack.addRate'], 0.13);
            assert.equal(paramsOf(row)['mix.maxHp.addRate'], 0.13);
        }
    }
});

test('101602 巨囊弹体：体积倍率 + 溅射 30/34/38，旧的攻速尾巴整条清掉', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        const tiers = rows.filter((item) => Number(item.skillChainId) === 101602)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        for (const [index, row] of tiers.entries()) {
            assert.notEqual(row.statId, 'attackSpeed', '攻速是「爆囊扩散」的旧尾巴，必须清掉');
            const params = paramsOf(row);
            assert.equal(params.splashDamageRate, [0.30, 0.34, 0.38][index], `L${index + 1} 溅射倍率`);
            assert.equal(params.splashFalloff, 0.3, '同一爆点第 2 个目标起 ×0.7');
            assert.ok(params.splashRadius > 0, '溅射半径不能为 0（否则整段不执行）');
            assert.equal(params['mix.attack.addRate'], 0.10);
            assert.equal(params['mix.attackRange.addRate'], 0.14);
        }
        //  数值尾走子链槽位（一条行只能挂一个 statId）。
        const slot = rows.filter((item) => Number(item.skillChainId) === 191602);
        assert.equal(slot.length, 3);
        for (const row of slot) {
            assert.equal(row.statId, 'damageRate');
            assert.equal(row.operation, 'addRate');
            assert.equal(Number(row.value), 0.08, '伤害尾巴三档不变 = 8%');
        }
    }
});

test('102401（现「贯穿滋养」）：旧的 critRate 20/28/36（越过上限）清掉，攻速走子链槽位', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        for (const row of rows.filter((item) => Number(item.skillChainId) === 102401)) {
            assert.notEqual(row.statId, 'critRate',
                '「枯萎收割」的暴击率 20/28/36 越过 15% 上限，本批整条换掉');
            assert.equal(paramsOf(row)['mix.attack.addRate'], 0.35);
            assert.equal(paramsOf(row)['mix.attackRange.addRate'], 0.35);
        }
        const slot = rows.filter((item) => Number(item.skillChainId) === 192401)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.deepEqual(slot.map((row) => row.statId), ['attackSpeed', 'attackSpeed', 'attackSpeed']);
        assert.deepEqual(slot.map((row) => Number(row.value)), [0.20, 0.22, 0.24]);
        assert.deepEqual(slot.map((row) => Number(row.unlockHeroLevel)), [2, 10, 22],
            '子链要与主链同档，否则尾巴会晚一格生效');
    }
});

/**
 * 这条钉的是「登记到底做全了没有」：新增一个 statId 要在四个地方登记
 * （`ZCStatId` 联合 / `STAT_IDS` / `UNIT_STAT_IDS` / `STAT_TO_PATCH` + patch 字段）。
 * 少登记 `UNIT_STAT_IDS` ⇒ 根本不会折叠；少登记 `STAT_TO_PATCH` ⇒ 折叠了也写不进 patch。
 * 两种都是**不报错、静默失效**，只有从这里折一次才看得出来。
 */
test('两个 statId 能从修改器折进 statPatch（登记链路完整）', () => {
    const definition = {
        unitId: '68006', name: '波利奥', maxHp: 1000, attack: 10, moveSpeed: 40,
        attackRange: 70, attackInterval: 1, attackDuration: 0.3, attackHitTime: 0,
        bodyRadius: 6, spawnSeconds: 0, flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1,
    } as unknown as ZCUnitDefinition;
    const typed = (['hpRegenPct', 'bulletSizeScale'] as const).map((statId, index) => ({
        sourceId: 94006011 + index, sourceKind: 'skill' as never, targetUnitId: '68006',
        domain: 'unit' as never, statId, operation: 'add' as never,
        value: [1.5, 1.6][index], priority: 1,
    }));
    const patch = applyZCTypedUnitModifiers(definition, typed).statPatch;
    assert.equal(patch.hpRegenPct, 1.5, 'hpRegenPct 没折进 statPatch ⇒ 每秒回复永远不生效');
    assert.equal(patch.bulletSizeScale, 1.6, 'bulletSizeScale 没折进 statPatch ⇒ 弹体不会变大');
});

// ── 二、结算：每秒回复 ────────────────────────────────────────────────────────

function regenUnit(maxHp: number): ZCUnitState {
    return {
        id: 1, unitId: '68006', owner: ZCOwner.Player, cardId: '68006', tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: maxHp, maxHp, battleState: 'idle', stateTime: 0,
        freeX: 0, freeY: 0,
    } as unknown as ZCUnitState;
}

/** 只造 `applyHpRegen` 真正读到的字段：一份 patch + 一个 healUnit 记账。 */
function regenHarness(patch: ZCUnitStatPatch, unit: ZCUnitState) {
    const heals: number[] = [];
    const state = {
        units: [unit], elapsedSeconds: 0, statusEffects: { nextUid: 1, units: [] },
        combatEvents: [], nextCombatEventId: 1,
    } as unknown as ZCSnapshot;
    const context = {
        statusSystem: { statModsOf: () => ({}), exportSnapshot: () => ({ nextUid: 1, units: [] }) } as unknown as ZCStatusSystem,
        runtimeOf: () => undefined,
        fireBurst: () => undefined,
        castSecondary: () => false,
        healUnit: (_unit: ZCUnitState, amount: number) => { heals.push(amount); },
        statPatchOf: () => patch,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];
    return {
        state, heals, context,
        /** 推进 `dt` 秒并跑一拍 tick（`elapsedSeconds` 由调用方先推进，与模型一致）。 */
        step: (dt: number) => {
            state.elapsedSeconds += dt;
            ZCSkillTriggerSystem.tick(state, dt, context);
        },
    };
}

test('每秒回复：跨过整秒才算一拍，未跨秒一滴都不回', () => {
    const unit = regenUnit(1000);
    const harness = regenHarness({ hpRegenPct: 1.5 }, unit);
    //  0 → 0.9 秒：跨不过整秒，一次都不回。
    for (let index = 0; index < 18; index += 1) harness.step(0.05);
    assert.deepEqual(harness.heals, [], '没跨过整秒不该回血');
    //  0.9 → 1.0：跨过 1 秒那一帧补一拍，= 1000 × 1.5% = 15。
    harness.step(0.1);
    assert.equal(harness.heals.length, 1);
    assert.equal(harness.heals[0], 15, '1000 × 1.5% = 15');
    //  1.0 → 1.95：没有整秒边界，仍是一拍。
    for (let index = 0; index < 19; index += 1) harness.step(0.05);
    assert.equal(harness.heals.length, 1);
    harness.step(0.05);
    assert.equal(harness.heals.length, 2, '跨过 2 秒再补一拍');
});

test('每秒回复：掉帧跨过 2 秒时补 2 拍，不吞不超', () => {
    const unit = regenUnit(1000);
    const harness = regenHarness({ hpRegenPct: 2.1 }, unit);
    harness.step(1.05);
    assert.equal(harness.heals.length, 1, '第一拍');
    harness.step(2.1);
    assert.deepEqual(harness.heals.map((value) => Math.round(value)), [21, 42],
        '跨 2 秒补 2 拍（21 × 2）');
});

test('每秒回复：不配 hpRegenPct 时整段不执行（存量单位逐字不变）', () => {
    const unit = regenUnit(1000);
    const harness = regenHarness({}, unit);
    for (let index = 0; index < 60; index += 1) harness.step(0.05);
    assert.deepEqual(harness.heals, []);
});

// ── 三、结算：弹体体积倍率 ────────────────────────────────────────────────────

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68016', cardId: '68016', tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 100000, maxHp: 100000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

/** 普攻/命中夹具：弹道模式，patch 可控。 */
function attackHarness(patch: ZCUnitStatPatch) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const damages: number[] = [];
    const profile: ZCAttackProfile = {
        skillId: 30231, name: '磁电菇普攻', mode: ZCCombatEventType.Projectile,
        projectileSpeed: 500, areaRadius: 0,
        damageRate: 1, empoweredEvery: 0, empoweredSkillId: 0, durationSeconds: 0, waves: 1,
        legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68016', name: '磁电菇', maxHp: 100000, attack: 100,
        moveSpeed: 0, attackRange: 70, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1, attackProfile: profile,
    } as ZCUnitDefinition;
    const state = {
        version: 4, elapsedSeconds: 2, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units: [source, target], nextUnitId: 3,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: { player: 0, enemy: 0 },
        allRandomNonGoldDraws: { player: 0, enemy: 0 },
        builtTypeCounts: { player: {}, enemy: {} },
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
    } as unknown as ZCSnapshot;
    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null,
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
        damageUnit: (_unit, damage) => {
            damages.push(damage);
            return { value: damage, kind: 'damage', x: 0, y: 0 } as never;
        },
        healUnit: () => undefined,
        counters: [],
        cards: { player: new Map(), enemy: new Map() } as unknown as IZCAttackResolutionContext['cards'],
        skillRuntime: {
            player: new Map(), enemy: new Map(),
        } as unknown as IZCAttackResolutionContext['skillRuntime'],
        statPatches: {
            player: new Map([['68016', patch]]), enemy: new Map(),
        } as unknown as IZCAttackResolutionContext['statPatches'],
        deckBonuses: {
            player: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
            enemy: {
                activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
                moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
                spawnIntervalMultiplier: 1,
            },
        } as unknown as Record<ZCOwner, ZCDeckBonuses>,
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
        source, target, state, context, damages,
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
        hit: (projectile: ZCProjectileState) => ZCAttackResolutionSystem.resolveProjectileHit(
            state, projectile,
            { kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null } as ZCCombatTarget,
            context),
    };
}

test('弹体体积：判定半径与 sizeScale 用同一个倍率放大（缺省 1 时不变）', () => {
    const plain = attackHarness({});
    plain.attack();
    const base = plain.state.projectiles[0];
    assert.ok(Math.abs(base.collisionRadius - 0.9) < 1e-9, '3 × combatDistanceScale 0.3');
    assert.equal(base.sizeScale, 1, '没配就是 1');

    const big = attackHarness({ bulletSizeScale: 1.6 });
    big.attack();
    const enlarged = big.state.projectiles[0];
    assert.ok(Math.abs(enlarged.collisionRadius - 0.9 * 1.6) < 1e-9, '判定半径同比放大');
    assert.equal(enlarged.sizeScale, 1.6, '视图拿同一个倍率');
});

test('弹体体积：非法值（0 / 负数）一律按 1 处理，不会把弹体缩没', () => {
    assert.equal(zcBulletSizeScale(undefined), 1);
    assert.equal(zcBulletSizeScale(0), 1);
    assert.equal(zcBulletSizeScale(-2), 1);
    assert.equal(zcBulletSizeScale(Number.NaN), 1);
    assert.equal(zcBulletSizeScale(1.9), 1.9);
});
