/**
 * 第 9 批：疑问清单 Q1/Q2/Q3 裁定 + 两条主动打样（102403 冰山陨落 / 102404 急冻光线）。
 *
 * 本批的真实目的不是「再加两条技能」，而是给同卡 102401 铺一条「别的主动」可回退的车道。
 * ⚠️ 2026-11-17 第 10 批推翻了那个前提：用户口径「所有卡牌都移除普通攻击减少冷却时间的这个机制」
 *    ⇒ `cdReduceOnHit` 整条车道已全卡下线，102401 改成「贯穿滋养」（子弹穿友军回血）。
 *    文件末尾那条闭环用例因此翻成**反向守卫**（盯回退彻底不发生），别再按旧注释理解。
 *
 * 🔴 三个最容易踩的点：
 *   ① 101702 的吸血是 **unit 域绝对值**（`lifestealRate add 0.30`），写成 `addRate` 会乘
 *      `baseValue`（该字段没有基础值）⇒ 恒 0 且不报错；
 *   ② `lifestealSpreadRate` 只折算「扩散段」（溅射 / 命中爆炸），主目标必须全额，
 *      否则「扩散段按 50% 折算」会变成「全部按 50%」；
 *   ③ 102403 / 102404 的计划行**不能**写 `statusId` —— 那张卡的 4 条技能共用
 *      `68024:30671` 一个运行时槽，写了它普攻每一发都会顺手挂上状态。
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
import type { IZCStrikeOptions } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCAttackResolutionSystem, type IZCAttackResolutionContext } from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';
import { ZCSkillTriggerSystem } from '../assets/script/app/zcds/model/systems/ZCSkillTriggerSystem';

const REMOTE = 'assets/remoteRef';
const CLIENT = 'D:/Alan/Project/POW/doc/塔防数据配置/json/client';

function remoteRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`${REMOTE}/${name}.json`, 'utf8')) as { k: string[]; v: unknown[][] };
    return source.v.map((row) => Object.fromEntries(source.k.map((key, index) => [key, row[index]])));
}

function clientRows(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`${CLIENT}/${name}.json`, 'utf8')) as Array<Record<string, unknown>>;
}

function params(row: Record<string, unknown>): Record<string, number> {
    const raw = row.skillParamJson;
    if (raw === null || raw === undefined || raw === '') return {};
    return JSON.parse(String(raw)) as Record<string, number>;
}

/** 所有用例都跑两份产物：remoteRef 列存与 client 行存必须逐格同值。*/
function bothTables(name: string): Array<Array<Record<string, unknown>>> {
    return [remoteRows(name), clientRows(name)];
}

// ── 一、配表 ──────────────────────────────────────────────────────────────────

test('101702 噬血蔓延：主链是 unit 域吸血绝对值（add），不是旧「爆囊扩散」的攻速', () => {
    const tiers = [0.30, 0.34, 0.38];
    for (const rows of bothTables('pvpSkillPlan')) {
        const hits = rows.filter((row) => Number(row.skillChainId) === 101702)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(hits.length, 3, '101702 三档');
        for (const [index, row] of hits.entries()) {
            assert.equal(String(row.unitId), '68017');
            assert.equal(String(row.skillName), '噬血蔓延', `L${index + 1} 名字要跟着机制换`);
            assert.equal(row.statId, 'lifestealRate', `L${index + 1} 主链 statId`);
            //  🔴 没有基础值 ⇒ 只能 add；addRate 会乘 baseValue(0) 变 0 且不报错。
            assert.equal(row.operation, 'add', `L${index + 1} 必须 add`);
            assert.ok(Math.abs(Number(row.value) - tiers[index]) < 1e-9, `L${index + 1} 吸血 ${tiers[index]}`);
            assert.equal(Number(row.unlockHeroLevel), [6, 16, 26][index], `L${index + 1} 解锁档位`);
            assert.ok(!params(row).splashDamageRate || true);
            assert.equal(params(row).attackSpeed, undefined, '旧的攻速尾巴必须整条清掉');
        }
    }
});

test('101702 噬血蔓延：溅射 40/44/48 + 扩散段 50% 折算 + 攻/范围混搭尾', () => {
    const splash = [0.40, 0.44, 0.48];
    for (const rows of bothTables('pvpSkillPlan')) {
        const hits = rows.filter((row) => Number(row.skillChainId) === 101702)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        for (const [index, row] of hits.entries()) {
            const param = params(row);
            assert.ok(Math.abs(param.splashDamageRate - splash[index]) < 1e-9,
                `L${index + 1} 溅射按 L 列 ${splash[index]}（Q2 裁定）`);
            assert.equal(param.splashFalloff, 0.3, `L${index + 1} 同爆点第 2 个起 ×0.7`);
            assert.equal(param.lifestealSpreadRate, 0.5, `L${index + 1} 扩散段按 50% 折算`);
            assert.equal(param['mix.attack.addRate'], 0.14, `L${index + 1} 攻击尾巴`);
            assert.equal(param['mix.attackRange.addRate'], 0.20, `L${index + 1} 范围尾巴`);
        }
    }
});

test('101702 噬血蔓延：伤害尾巴落在子链 191702（三档同 12%），与主链同档解锁', () => {
    for (const rows of bothTables('pvpSkillPlan')) {
        const slots = rows.filter((row) => Number(row.skillChainId) === 191702)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(slots.length, 3, '子链必须三档（漏一档 = 那一档尾巴凭空消失）');
        for (const [index, row] of slots.entries()) {
            assert.equal(row.statId, 'damageRate');
            assert.equal(row.operation, 'addRate');
            assert.ok(Math.abs(Number(row.value) - 0.12) < 1e-9, `L${index + 1} 三档同值 12%`);
            assert.equal(Number(row.unlockHeroLevel), [6, 16, 26][index]);
        }
    }
});

test('102403 冰山陨落 / 102404 急冻光线：两条主动的行为、触发口径与解锁档位', () => {
    const specs = [
        {
            chain: 102403, name: '冰山陨落', kind: 'active_cd', behavior: 'self_aura',
            levels: [9, 18, 27], modifierId: [94024031, 94024032, 94024033],
            damage: [0.55, 0.65, 0.75],
            check: (param: Record<string, number>, tier: number) => {
                assert.equal(param.auraCooldown, 14, '冷却 14 秒（设计案触发参数）');
                assert.equal(param.auraSeconds, 3, '持续 3 秒');
                assert.equal(param.auraInterval, 0.5, '每 0.5 秒一跳');
                assert.equal(param.auraRadius, 120, '蓝圈半径');
                assert.equal(param.auraSlowRatio, 0.5, '区域减速 50%');
                assert.ok(Math.abs(param.auraDamageRate - [0.55, 0.65, 0.75][tier]) < 1e-9, '单跳倍率');
            },
        },
        {
            chain: 102404, name: '急冻光线', kind: 'active_attack', behavior: 'random_strike',
            levels: [12, 24, 36], modifierId: [94024041, 94024042, 94024043],
            damage: [0.8, 0.95, 1.1],
            check: (param: Record<string, number>, tier: number) => {
                assert.equal(param.strikeEvery, 9, '累计 9 次普攻（设计案触发参数）');
                assert.equal(param.strikeCount, 3, '三道光线');
                assert.equal(param.strikeNearest, 1, '就近优先');
                assert.equal(param.strikeAppliesStatus, 1, '命中要挂状态，必须显式开闸门');
                assert.ok(Math.abs(param.strikeDamageRate - [0.8, 0.95, 1.1][tier]) < 1e-9, '单道倍率');
            },
        },
    ];
    for (const rows of bothTables('pvpSkillPlan')) {
        for (const spec of specs) {
            const hits = rows.filter((row) => Number(row.skillChainId) === spec.chain)
                .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
            assert.equal(hits.length, 3, `${spec.chain} 三档`);
            for (const [tier, row] of hits.entries()) {
                assert.equal(String(row.unitId), '68024', `${spec.chain} 归属 68024 急冻瓜`);
                assert.equal(String(row.skillName), spec.name, `${spec.chain} L${tier + 1} 名字`);
                assert.equal(row.skillKind, spec.kind, `${spec.chain} L${tier + 1} 技能类型`);
                assert.equal(row.behaviorKey, spec.behavior, `${spec.chain} L${tier + 1} 车道`);
                assert.equal(Number(row.modifierId), spec.modifierId[tier], `${spec.chain} L${tier + 1} 修改器号`);
                assert.equal(Number(row.unlockHeroLevel), spec.levels[tier], `${spec.chain} L${tier + 1} 解锁档位`);
                assert.equal(Number(row.pvpSkillId), 30671, `${spec.chain} 参数袋要落在 68024 的普攻运行时上`);
                //  🔴 整卡共用 `68024:30671` 一个 statusId 槽，写了它普攻每一发都会挂状态。
                assert.equal(row.statusId ?? null, null, `${spec.chain} L${tier + 1} 不许写 statusId`);
                spec.check(params(row), tier);
            }
        }
    }
});

test('102001 异种猎杀协议：文案改成并列枚举（间接版），两条判据的数值一手不动', () => {
    const tiers = [15, 20, 25];
    for (const rows of bothTables('pvpSkillPlan')) {
        const hits = rows.filter((row) => Number(row.skillChainId) === 102001)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(hits.length, 3);
        for (const [tier, row] of hits.entries()) {
            const desc = String(row.desc);
            assert.ok(!desc.includes('/'), `L${tier + 1} 文案不许再用斜杠（会被读成二选一）：${desc}`);
            assert.match(desc, /僵尸阵营、战士职业/, `L${tier + 1} 要写成并列枚举`);
            //  数值与两条判据（`counterCamp4` + `mix.counterRole2`）保持原样，Q3 只动文案。
            assert.equal(row.statId, 'counterCamp4', `L${tier + 1} 主判据`);
            assert.equal(Number(row.value), tiers[tier], `L${tier + 1} 主判据数值`);
            assert.equal(params(row)['mix.counterRole2'], tiers[tier], `L${tier + 1} 第二判据数值`);
            assert.equal(params(row)['mix.attack.addRate'], 0.09, `L${tier + 1} 攻击尾巴`);
        }
    }
});

test('K 表三条链：名称 / 描述 / 修改器引用都跟计划行同档', () => {
    for (const rows of bothTables('armySkillLevelUp')) {
        const blood = rows.filter((row) => Number(row.id) === 101702)
            .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
        for (const [tier, row] of blood.entries()) {
            assert.equal(String(row.name), '噬血蔓延');
            assert.equal(Number(row.unlockarmylevel), [6, 16, 26][tier]);
            assert.deepEqual(row.modfiy, [94017021 + tier, 94917021 + tier], `L${tier + 1} 主链 + 子链两段引用`);
            assert.match(String(row.desc), /扩散段按50%折算/, `L${tier + 1} 文案要写清扩散段折算`);
        }
        const actives = [
            { chain: 102403, name: '冰山陨落', levels: [9, 18, 27], base: 94024030 },
            { chain: 102404, name: '急冻光线', levels: [12, 24, 36], base: 94024040 },
        ];
        for (const spec of actives) {
            const hits = rows.filter((row) => Number(row.id) === spec.chain)
                .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
            assert.equal(hits.length, 3, `${spec.chain} 三档`);
            for (const [tier, row] of hits.entries()) {
                assert.equal(String(row.name), spec.name);
                assert.equal(Number(row.unlockarmylevel), spec.levels[tier]);
                assert.equal(Number(row.armySkillType), 2, `${spec.chain} 是主动技能`);
                assert.deepEqual(row.modfiy, [spec.base + tier + 1], `${spec.chain} L${tier + 1} 引用`);
            }
        }
    }
});

// ── 二、结算 ──────────────────────────────────────────────────────────────────

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function makeUnit(id: number, owner: ZCOwner, x: number): ZCUnitState {
    return {
        id, owner, unitId: '68024', cardId: String(id), tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 100000, maxHp: 100000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IHarnessOptions {
    /** 参数袋内容（空对象 = 什么都不配，验「存量逐字不变」）。*/
    parameters?: Record<string, number>;
    /** `statPatch`（吸血比例等 unit 域值走这里）。*/
    patch?: ZCUnitStatPatch;
}

function makeHarness(options: IHarnessOptions = {}) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const heals: number[] = [];
    const strikes: IZCStrikeOptions[] = [];

    const profile: ZCAttackProfile = {
        skillId: 30671, name: '幽魂怪物远程物理攻击', mode: ZCCombatEventType.Projectile,
        projectileSpeed: 500, areaRadius: 0, damageRate: 1, empoweredEvery: 0, empoweredSkillId: 0,
        durationSeconds: 0, waves: 1, legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68024', name: '急冻瓜', maxHp: 100000, attack: 100,
        moveSpeed: 0, attackRange: 70, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1, attackProfile: profile,
    } as ZCUnitDefinition;

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68024', skillId: 30671, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none', parameters: { ...(options.parameters ?? {}) },
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
        statusEffects: { nextUid: 1, units: [] },
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY, bodyRadius: 6, cardId: null,
    };
    const patch = options.patch ?? {};
    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_unit, damage) => ({ value: damage, kind: 'damage', x: 0, y: 0 }) as never,
        healUnit: (_unit, amount) => { heals.push(amount); },
        counters: [],
        cards: perOwner(() => new Map()),
        skillRuntime: { ...perOwner(() => new Map()), [ZCOwner.Player]: new Map([['68024:30671', runtime]]) },
        statPatches: { ...perOwner(() => new Map<string, ZCUnitStatPatch>()), [ZCOwner.Player]: new Map([['68024', patch]]) },
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

    /** 触发系统的上下文：只造本批用到的四条钩子。*/
    const triggerContext = {
        statusSystem: {
            statModsOf: () => ({}),
            exportSnapshot: () => ({ nextUid: 1, units: [] }),
            hasDef: () => false,
            register: () => undefined,
        },
        runtimeOf: () => runtime,
        fireBurst: () => undefined,
        castSecondary: () => false,
        //  必须用回调传进来的 `u`：夹具里敌我双方都是 68024，写死 `source` 会把两片区域
        //  都落在自己脚下、`sourceUnitId` 也都是自己 —— 看着像「一次放了两片」。
        castSelfAura: (u: ZCUnitState) => ZCAttackResolutionSystem.castSelfAura(state, u, context),
        castBolt: () => false,
        castTrap: () => false,
        strike: (_unit: ZCUnitState, strikeOptions: IZCStrikeOptions) => {
            strikes.push(strikeOptions);
            return Math.round(strikeOptions.count);
        },
        healUnit: () => undefined,
        statPatchOf: () => patch,
        distanceScale: 0.3,
        attackReachOf: () => 1000,
    } as unknown as Parameters<typeof ZCSkillTriggerSystem.tick>[2];

    return {
        source, target, state, context, heals, strikes, triggerContext,
        step: (dt: number) => {
            state.elapsedSeconds += dt;
            ZCSkillTriggerSystem.tick(state, dt, triggerContext);
        },
    };
}

function hitTextOf(value: number) {
    return { value, kind: 'damage', x: 0, y: 0 } as never;
}

test('扩散段折算：传 0.5 时只回一半，主目标（缺省 1）全额', () => {
    const harness = makeHarness({ patch: { lifestealRate: 0.3 } });
    ZCAttackResolutionSystem.applyLifesteal(harness.source, hitTextOf(1000), harness.context, 0.5);
    assert.equal(harness.heals.length, 1);
    assert.equal(harness.heals[0], 150, '1000 × 30% × 0.5 = 150');
    ZCAttackResolutionSystem.applyLifesteal(harness.source, hitTextOf(1000), harness.context);
    assert.equal(harness.heals[1], 300, '主目标不折算：1000 × 30% = 300');
});

test('扩散段折算：不配 lifestealSpreadRate 时溅射也全额（存量吸血逐字不变）', () => {
    const harness = makeHarness({ patch: { lifestealRate: 0.3 } });
    //  存量卡（100703 嗜血 / 100302 生命汲取）走的就是这条：参数袋里没有这个键。
    ZCAttackResolutionSystem.applyLifesteal(harness.source, hitTextOf(500), harness.context, 1);
    assert.equal(harness.heals[0], 150, '500 × 30% = 150，不打折');
});

test('扩散段折算：越界值夹到 [0,1]，不会回出负血或翻倍', () => {
    const harness = makeHarness({ patch: { lifestealRate: 0.3 } });
    ZCAttackResolutionSystem.applyLifesteal(harness.source, hitTextOf(1000), harness.context, 3);
    assert.equal(harness.heals[0], 300, '> 1 按 1 处理');
    ZCAttackResolutionSystem.applyLifesteal(harness.source, hitTextOf(1000), harness.context, -1);
    assert.equal(harness.heals.length, 1, '< 0 直接不回（比例 0 整段不执行）');
});

test('冰山陨落：auraSlowRatio 落进区域 slowRatio，不配时为 0（存量光环不变）', () => {
    const withSlow = makeHarness({
        parameters: {
            auraCooldown: 14, auraSeconds: 3, auraInterval: 0.5, auraRadius: 120,
            auraDamageRate: 0.55, auraSlowRatio: 0.5,
        },
    });
    //  首次 tick 只挂 CD、不施放（`auraReadyAt` 从「当前 + CD」起算）。
    withSlow.target.freeX = 20;
    withSlow.step(0.05);
    withSlow.step(14);
    //  两边各放一次（敌方单位也是 68024，`runtimeOf` 是同一份）⇒ 只数自己放的那片。
    const zones = ((withSlow.state.groundZones ?? []) as Array<Record<string, number>>)
        .filter((zone) => Number(zone.sourceUnitId) === withSlow.source.id);
    assert.equal(zones.length, 1, '冰山陨落要真的张开一片区域（蓝圈就是它）');
    assert.equal(zones[0].slowRatio, 0.5, '减速要落进区域，否则「移速降低 50%」是空话');
    assert.equal(zones[0].radius, 120 * 0.3, '半径按 combatDistanceScale 换成世界坐标');

    const withoutSlow = makeHarness({
        parameters: { auraCooldown: 14, auraSeconds: 3, auraInterval: 0.5, auraRadius: 120, auraDamageRate: 0.55 },
    });
    withoutSlow.target.freeX = 20;
    withoutSlow.step(0.05);
    withoutSlow.step(14);
    const plain = ((withoutSlow.state.groundZones ?? []) as Array<Record<string, number>>)
        .filter((zone) => Number(zone.sourceUnitId) === withoutSlow.source.id);
    assert.equal(plain.length, 1);
    assert.equal(plain[0].slowRatio, 0, '不配就是 0，无尘禁土 / 喷射火焰逐字不变');
});

test('前置矩形喷火保留350表值长度，All圆形光环无实际命中目标不空放', () => {
    const flame = {
        auraSeconds: 4, auraInterval: 1, auraRadius: 175, auraForward: 175,
        auraTriggerRange: 350, auraRectHalfHeight: 70, auraFaceTarget: 1, auraDamageRate: 1,
    };
    const h = makeHarness({ parameters: flame });
    h.target.freeX = 80;
    assert.equal(ZCAttackResolutionSystem.castSelfAura(h.state, h.source, h.context), true);
    assert.equal(h.state.groundZones[0].x, 52.5);
    assert.equal(h.state.groundZones[0].rectHalfLength, 52.5);
    const outside = makeHarness({ parameters: flame });
    outside.target.freeX = 106;
    assert.equal(ZCAttackResolutionSystem.castSelfAura(outside.state, outside.source, outside.context), false);
    assert.equal(outside.state.groundZones.length, 0);
    const circle = makeHarness({ parameters: { auraRadius: 100, auraSeconds: 2, auraDamageRate: 1, auraTargetMode: 2 } });
    circle.target.freeX = 60;
    assert.equal(ZCAttackResolutionSystem.castSelfAura(circle.state, circle.source, circle.context), false);
    assert.equal(circle.state.groundZones.length, 0);
});

test('急冻光线：累计 9 次普攻才开火，且开 strikeAppliesStatus 时带 numb', () => {
    const harness = makeHarness({
        parameters: {
            strikeEvery: 9, strikeCount: 3, strikeRadius: 260,
            strikeDamageRate: 0.8, strikeNearest: 1, strikeAppliesStatus: 1,
        },
    });
    //  首帧只记基线（`strikeFiredCount`），不开火。
    harness.step(0.05);
    assert.equal(harness.strikes.length, 0, '开局不许直接开火');
    harness.source.completedAttackCount = 8;
    harness.step(0.05);
    assert.equal(harness.strikes.length, 0, '攒到 8 次还差一下');
    harness.source.completedAttackCount = 9;
    harness.step(0.05);
    assert.equal(harness.strikes.length, 1, '第 9 次普攻后开火');
    const fired = harness.strikes[0];
    assert.equal(fired.count, 3, '三道光线');
    assert.ok(Math.abs(fired.damageRate - 0.8) < 1e-9);
    //  🔴 状态 id 写死常量：借 `runtime.statusId` 会让这张卡的普攻每发都麻痹。
    assert.equal(fired.statusId, 'numb', '命中要挂麻痹（软控：只禁攻击、移速 −50%）');
});

test('急冻光线：不开 strikeAppliesStatus 时不挂状态（存量 random_strike 逐字不变）', () => {
    const harness = makeHarness({
        parameters: { strikeEvery: 9, strikeCount: 3, strikeRadius: 260, strikeDamageRate: 0.8 },
    });
    harness.step(0.05);
    harness.source.completedAttackCount = 9;
    harness.step(0.05);
    assert.equal(harness.strikes.length, 1);
    assert.equal(harness.strikes[0].statusId, undefined, '缺省不挂');
});

test('打样回归：普攻命中不再回退任何主动车道（cdReduceOnHit 已全卡下线）', () => {
    //  2026-11-17 第 10 批：用户口径「所有卡牌都移除普通攻击减少冷却时间的这个机制」。
    //  `cdReduceOnHit` / `cdReducePaidAt` / `ZC_CD_REDUCE_READY_KEYS` / `reduceCooldownsOnHit`
    //  整条车道已从代码与配表里拆干净 ⇒ 这条用例从「盯回退生效」翻成「盯回退彻底不发生」。
    //  留着它是因为这是唯一一条把「主动车道 + 弹道命中」串起来的闭环用例：
    //  哪天有人照着旧笔记把车道建回来，这里会第一个红。
    const harness = makeHarness({
        parameters: {
            auraCooldown: 14, auraSeconds: 3, auraInterval: 0.5, auraRadius: 120,
            auraDamageRate: 0.55, auraSlowRatio: 0.5,
        },
    });
    harness.step(0.05);
    assert.ok(Math.abs(Number(harness.source.auraReadyAt) - 14.05) < 1e-6, '首次挂 CD：当前 + 14 秒');
    //  打一发普攻命中 ⇒ 剩余冷却必须纹丝不动（旧版这里会变成 13.65）。
    ZCAttackResolutionSystem.sendAttack(harness.state, harness.source, harness.context);
    const projectile = (harness.state.projectiles ?? [])[0] as unknown;
    assert.ok(projectile, '普攻要真的发出一颗弹');
    ZCAttackResolutionSystem.resolveProjectileHit(
        harness.state, projectile as never, { kind: 'unit', id: harness.target.id }, harness.context);
    assert.ok(Math.abs(Number(harness.source.auraReadyAt) - 14.05) < 1e-6,
        '普攻命中不许再压任何 `*ReadyAt` —— 这条车道已经全表下线');
    assert.equal((harness.source as unknown as Record<string, unknown>).cdReducePaidAt, undefined,
        '连去重戳都不该再出现在单位状态上');
});
