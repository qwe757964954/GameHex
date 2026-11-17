/**
 * 第 7 批：破阵投枪 5 条（100701 / 100901 / 101802 / 102702 / 103302）。
 *
 * 机制口径（设计案 P 列原文）：
 *   「触发时把本次普攻**整份换成弹道** —— 只换 mode / 弹速 / 弹体特效，**不改 attackRange**」。
 * 所以这一批既不是「加一发」，也不是「普攻带穿透」，而是**那一拍根本不是近战**。
 *
 * 🔴 三个最容易踩的点，下面每条都单独钉住：
 *   ① `lancePierceCount` 是**目标总数（含首目标）**，剩余穿透 = N − 1，别与 `pierceCount`
 *      （额外穿透次数）混用；
 *   ② 首目标 70% 走 `lanceDamageRate`，而**弹道是另一条乘法链**（`unitDamageBase`），
 *      只乘进 `prepareAttack` 的 `damage` 会「事件上写 70%、真打出去还是 100%」；
 *   ③ 投枪与「强化那一击」互斥，撞拍时强化优先、投枪让位（节拍不顺延）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCSkillRuntimeDefinition } from '../assets/script/app/zcds/model/ZCSkillRuntime';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import {
    ZCAttackResolutionSystem, type IZCAttackResolutionContext,
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

/** 本批 5 条：链 → (卡, 解锁档位, 子链尾巴 [(链, statId, 值)])。 */
const SKILLS: Array<{
    chain: number; card: string; levels: [number, number, number];
    slots: Array<[number, string, number]>;
}> = [
    {
        chain: 100701, card: '68007', levels: [3, 10, 22],
        slots: [[190701, 'attack', 0.24]],
    },
    {
        chain: 100901, card: '68009', levels: [3, 10, 22],
        slots: [[280901, 'attack', 0.26], [190901, 'attackSpeed', 0.28]],
    },
    {
        chain: 101802, card: '68018', levels: [6, 16, 26],
        slots: [[281802, 'attack', 0.16], [191802, 'attackSpeed', 0.17]],
    },
    {
        chain: 102702, card: '68027', levels: [6, 16, 26],
        slots: [[192702, 'attackSpeed', 0.11]],
    },
    {
        chain: 103302, card: '68033', levels: [6, 16, 26],
        slots: [[283302, 'attack', 0.16], [193302, 'attackSpeed', 0.17]],
    },
];

const LANCE_EVERY = [4, 3, 2];
const LANCE_TARGETS = 3;
const LANCE_FALLOFF = 0.35;
const LANCE_DAMAGE_RATE = 0.7;

// ── 一、配表 ──────────────────────────────────────────────────────────────────

test('5 条投枪：四个 lance 键走参数袋、主链三空，两份产物逐格一致', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        for (const spec of SKILLS) {
            const tiers = rows.filter((row) => Number(row.skillChainId) === spec.chain)
                .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
            assert.equal(tiers.length, 3, `${spec.chain} 必须三档齐备`);
            for (const [index, row] of tiers.entries()) {
                assert.equal(String(row.unitId), spec.card, `${spec.chain} L${index + 1} 挂错卡`);
                //  主链只剩参数袋：statId/operation/value 全空，否则会被 fold 成一条数值修改器。
                assert.equal(row.statId, null, `${spec.chain} L${index + 1} 的主链不该带 statId`);
                assert.equal(row.operation, null, `${spec.chain} L${index + 1} 的主链不该带 operation`);
                assert.equal(row.value, null, `${spec.chain} L${index + 1} 的主链不该带 value`);
                const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
                assert.equal(params.lanceEvery, LANCE_EVERY[index], `${spec.chain} L${index + 1} 节拍`);
                assert.equal(params.lancePierceCount, LANCE_TARGETS, `${spec.chain} 穿透目标总数`);
                assert.equal(params.lancePierceFalloff, LANCE_FALLOFF, `${spec.chain} 穿透衰减`);
                assert.equal(params.lanceDamageRate, LANCE_DAMAGE_RATE, `${spec.chain} 首目标折算`);
            }
        }
    }
});

test('5 条投枪：同名「破阵投枪」，解锁等级跟技能格走（3/10/22 与 6/16/26）', () => {
    const expected = new Map(SKILLS.map((spec) => [spec.chain, spec.levels]));
    for (const rows of [remoteRows('armySkillLevelUp'), clientRows('armySkillLevelUp')]) {
        for (const spec of SKILLS) {
            const tiers = rows.filter((row) => Number(row.id) === spec.chain)
                .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
            assert.equal(tiers.length, 3, `${spec.chain} 在 armySkillLevelUp 里必须三档`);
            const levels = expected.get(spec.chain)!;
            for (const [index, row] of tiers.entries()) {
                assert.equal(String(row.name), '破阵投枪', `${spec.chain} L${index + 1} 名字`);
                assert.equal(Number(row.unlockarmylevel), levels[index], `${spec.chain} L${index + 1} 解锁等级`);
                assert.match(String(row.desc), /穿透3个目标/, `${spec.chain} L${index + 1} 文案要写穿透数`);
                assert.match(String(row.desc), /70%\/45%\/30%/, `${spec.chain} L${index + 1} 文案要写衰减链`);
            }
        }
    }
});

test('5 条投枪：数值尾落在子链槽位（不是主链），且子链与主链同档解锁', () => {
    const rows = clientRows('pvpSkillPlan');
    for (const spec of SKILLS) {
        const mainLevels = rows.filter((row) => Number(row.skillChainId) === spec.chain)
            .map((row) => Number(row.unlockHeroLevel));
        for (const [chain, statId, value] of spec.slots) {
            const slots = rows.filter((row) => Number(row.skillChainId) === chain)
                .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
            assert.equal(slots.length, 3, `${chain} 子链必须三档`);
            for (const [index, row] of slots.entries()) {
                assert.equal(row.statId, statId, `${chain} L${index + 1} 承载的 statId`);
                assert.equal(row.operation, 'addRate', `${chain} L${index + 1} 必须是 addRate`);
                assert.equal(Number(row.value), value, `${chain} L${index + 1} 数值`);
                assert.equal(Number(row.unlockHeroLevel), mainLevels[index],
                    `${chain} L${index + 1} 要与主链 ${spec.chain} 同档（否则尾巴会晚一格生效）`);
            }
        }
    }
});

test('全表守卫：同一个 unitId 里投枪节拍只能由一条链写', () => {
    //  🔴 `lanceEvery` 是「替换本次普攻」的整份换档，同卡两条链都写就会连着两拍都投枪。
    const beats = new Map<string, Set<number>>();
    for (const row of remoteRows('pvpSkillPlan')) {
        const raw = row.skillParamJson;
        if (raw === null || raw === undefined) continue;
        if (!String(raw).includes('lanceEvery')) continue;
        const unitId = String(row.unitId);
        const chains = beats.get(unitId) ?? new Set<number>();
        chains.add(Number(row.skillChainId));
        beats.set(unitId, chains);
    }
    assert.equal(beats.size, SKILLS.length, `写 lanceEvery 的卡应有 ${SKILLS.length} 张`);
    for (const [unitId, chains] of beats) {
        assert.equal(chains.size, 1, `${unitId} 有 ${chains.size} 条链在写 lanceEvery：${[...chains]}`);
    }
});

// ── 二、结算 ──────────────────────────────────────────────────────────────────

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68025', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 100000, maxHp: 100000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IHarnessOptions {
    /** 写进参数袋的投枪键；`undefined` = 这一条不写（存量单位）。 */
    lance?: { every?: number; pierceCount?: number; falloff?: number; damageRate?: number };
    /** 普攻档案的模式：近战（默认）或区域。 */
    mode?: ZCCombatEventType;
    /** 区域半径（只在 `mode = Area` 时有意义）；用来验证「投枪把区域清掉」。 */
    areaRadius?: number;
    /** 强化节拍（每 N 次普攻）；用来验证「撞拍时强化优先」。 */
    empoweredEvery?: number;
    /** `bulletNum` 增量（普攻多打 N 发）；用来验证「投枪是一枚枪」。 */
    bulletNum?: number;
}

function makeHarness(options: IHarnessOptions = {}) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const damages: number[] = [];

    const profile: ZCAttackProfile = {
        skillId: 30858, name: '大威天芦普攻', mode: options.mode ?? ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: options.areaRadius ?? 0,
        damageRate: 1, empoweredEvery: options.empoweredEvery ?? 0, empoweredSkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68025', name: '大威天芦', maxHp: 100000, attack: 100,
        moveSpeed: 0, attackRange: 70, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1, attackProfile: profile,
    } as ZCUnitDefinition;

    const parameters: Record<string, number> = {};
    if (options.lance) {
        if (options.lance.every !== undefined) parameters.lanceEvery = options.lance.every;
        if (options.lance.pierceCount !== undefined) parameters.lancePierceCount = options.lance.pierceCount;
        if (options.lance.falloff !== undefined) parameters.lancePierceFalloff = options.lance.falloff;
        if (options.lance.damageRate !== undefined) parameters.lanceDamageRate = options.lance.damageRate;
    }
    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68025', skillId: 30858, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none', parameters,
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
        combatEvents: [], projectiles: [], nextCombatEventId: 1, groundZones: [],
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null,
    };

    const patch: ZCUnitStatPatch = options.bulletNum ? { bulletNumFlat: options.bulletNum } : {};
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
        cards: perOwner(() => new Map()),
        skillRuntime: { ...perOwner(() => new Map()), [ZCOwner.Player]: new Map([['68025:30858', runtime]]) },
        statPatches: { ...perOwner(() => new Map<string, ZCUnitStatPatch>()), [ZCOwner.Player]: new Map([['68025', patch]]) },
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
        source, target, state, context, damages,
        /** 打一次普攻；`completedAttackCount` 由 `consumeEmpoweredAttack` 在内部自增。 */
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
    };
}

/** 连打 `times` 次，返回每一次的弹道数（`> 0` 就是那一拍换了弹道）。 */
function shotsOf(harness: ReturnType<typeof makeHarness>, times: number): number[] {
    const shots: number[] = [];
    for (let index = 0; index < times; index += 1) {
        const before = harness.state.projectiles.length;
        harness.attack();
        shots.push(harness.state.projectiles.length - before);
    }
    return shots;
}

test('L1 每 4 次：前 3 拍仍是近战，第 4 拍换成弹道且事件名带「·投枪」', () => {
    const harness = makeHarness({ lance: { every: 4 } });
    const shots = shotsOf(harness, 4);
    assert.deepEqual(shots, [0, 0, 0, 1], `实际每拍弹道数 ${shots}`);
    //  前 3 拍真的是近战（立即结算、不走弹道）。
    assert.equal(harness.damages.length, 3, '前 3 拍应各结算 1 笔近战伤害');
    const lanceEvent = harness.state.projectiles[0];
    assert.equal(lanceEvent.type, 'projectile', '投枪必须是弹道事件');
    assert.equal(lanceEvent.skillName, '大威天芦普攻·投枪');
});

test('L2 / L3 档：节拍缩短到 3 / 2 次', () => {
    for (const every of [3, 2]) {
        const harness = makeHarness({ lance: { every } });
        const shots = shotsOf(harness, every * 2);
        const expected = Array.from({ length: every * 2 }, (_, index) => ((index + 1) % every === 0 ? 1 : 0));
        assert.deepEqual(shots, expected, `every=${every} 实际 ${shots}`);
    }
});

test('不写 lanceEvery 时这条链路整段不执行（存量单位逐字不变）', () => {
    const harness = makeHarness();
    const shots = shotsOf(harness, 8);
    assert.deepEqual(new Set(shots), new Set([0]), `实际每拍弹道数 ${shots}`);
    assert.equal(harness.damages.length, 8, '8 拍全部走近战');
});

test('首目标 70%：投枪弹的 baseDamage 是面板伤害 × lanceDamageRate', () => {
    const harness = makeHarness({ lance: { every: 1 } });
    shotsOf(harness, 1);
    const projectile = harness.state.projectiles[0];
    //  面板 = attack 100 × 1 × 1 × 1 × 1（tier 1、无牌组加成）⇒ 100；投枪首目标 70%。
    assert.equal(projectile.baseDamage, Math.round(100 * LANCE_DAMAGE_RATE));
});

test('穿透：lancePierceCount 是目标总数（含首目标）⇒ 剩余穿透 2 次，每次 ×(1−0.35)', () => {
    const harness = makeHarness({ lance: { every: 1, pierceCount: 3, falloff: 0.35 } });
    shotsOf(harness, 1);
    const projectile = harness.state.projectiles[0];
    assert.equal(projectile.remainingPierces, 2, '3 个目标 ⇒ 命中首目标后还能穿 2 个');
    assert.equal(projectile.pierceFalloff, 0.35);
    //  衰减链：70 / 45.5 / 29.575 ≈ 70% / 45% / 30%，与设计案文案对得上。
    const second = projectile.baseDamage * (1 - 0.35);
    const third = second * (1 - 0.35);
    assert.equal(Math.round(second), 46, '第 2 个目标 ≈ 45%');
    assert.equal(Math.round(third), 30, '第 3 个目标 ≈ 30%');
});

test('整份换档：区域普攻改走弹道、区域半径清 0、不再建地面区域；弹速取 lanceSpeed 缺省 700', () => {
    const harness = makeHarness({
        lance: { every: 1 }, mode: ZCCombatEventType.Area, areaRadius: 40,
    });
    shotsOf(harness, 1);
    assert.equal(harness.state.projectiles.length, 1, '投枪这一拍必须是弹道，不是区域');
    assert.equal(harness.state.groundZones.length, 0, '区域半径必须被清掉，不要再建地面区域');
    const projectile = harness.state.projectiles[0];
    assert.equal(projectile.radius, 0, '事件半径（= 区域半径）必须归零');
    assert.equal(
        Math.round(Math.hypot(projectile.velocityX, projectile.velocityY)), 700,
        '投枪弹速缺省 700（设计案：飞行距离不变、只换弹速与弹体）');
});

test('撞拍时强化优先：同一拍只兑现一个，投枪让位且节拍不顺延', () => {
    const harness = makeHarness({ lance: { every: 2 }, empoweredEvery: 2 });
    shotsOf(harness, 4);
    //  第 2、4 拍都是「强化 + 投枪」撞拍 ⇒ 全是强化，一条弹道都不该有。
    assert.equal(harness.state.projectiles.length, 0, '撞拍不该出投枪弹');
    const names = harness.state.combatEvents.map((event) => String(event.skillName));
    assert.equal(names.length, 4);
    assert.equal(names[1], '大威天芦普攻·强化');
    assert.equal(names[3], '大威天芦普攻·强化');
    assert.ok(names.every((name) => !name.includes('投枪')), `不该出现投枪：${names}`);
});

test('投枪是一枚枪：不吃 bulletNum 多发（其余拍照旧多发）', () => {
    const harness = makeHarness({ lance: { every: 2 }, mode: ZCCombatEventType.Projectile, bulletNum: 2 });
    const shots = shotsOf(harness, 2);
    assert.equal(shots[0], 3, '非投枪拍：本体 1 + bulletNum 2 = 3 发');
    assert.equal(shots[1], 1, '投枪拍固定 1 发');
});

test('参数缺省兜底：只写 lanceEvery 也有 0.7 / 3 目标 / 0.35 衰减', () => {
    const harness = makeHarness({ lance: { every: 1 } });
    shotsOf(harness, 1);
    const projectile = harness.state.projectiles[0];
    assert.equal(projectile.baseDamage, 70, '缺省 lanceDamageRate = 0.7');
    assert.equal(projectile.remainingPierces, 2, '缺省 lancePierceCount = 3 ⇒ 剩余 2');
    assert.equal(projectile.pierceFalloff, 0.35, '缺省 lancePierceFalloff = 0.35');
});
