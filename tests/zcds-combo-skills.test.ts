/**
 * 第 6 批：连击（`蔓生连打` / `蔓生三连`）。落地时 6 条，第 7 批把 **68009 的 100901 整条换成
 * 「破阵投枪」**（见 `zcds-lance-skills.test.ts`），这里剩 5 条。
 *
 * 覆盖两类东西：
 *   ① **配表**：段数、递减系数、尾巴落位、101401 的补行、K 表 `modfiy` 与行是否对得上；
 *   ② **结算**：额外段真的按 `comboDamage` / `comboFalloff` 递减，而且**只补伤害** ——
 *      命中类状态、处决、吸血都只算「一次出手」那一段。
 *
 * 🔴 这条链路此前只对**弹道**生效（`resolveProjectileHit` 里才读 `multiHitFlat`），
 *   而本批连击技能全是**近战** ⇒ 配了段数却一段都不多打。本批把近战/区域路径也接上，
 *   所以下面既钉近战、也钉弹道（两条路必须同一套口径）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ZCAttackProfile, ZCDeckBonuses, ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCProjectileState, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
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

/** 本批 5 条：链 → (卡, 名称, 额外段数, 是否有第 3 段)。
 *  68009 的 100901 已换成「破阵投枪」（第 7 批），不再在这里。 */
const SKILLS: Array<{ chain: number; card: string; name: string; hits: number }> = [
    { chain: 100501, card: '68005', name: '蔓生连打', hits: 1 },
    { chain: 100702, card: '68007', name: '蔓生三连', hits: 2 },
    { chain: 101401, card: '68014', name: '蔓生连打', hits: 1 },
    { chain: 101801, card: '68018', name: '蔓生三连', hits: 2 },
    { chain: 102501, card: '68025', name: '蔓生三连', hits: 2 },
];

const COMBO_DAMAGE = [60, 65, 70];
const COMBO_FALLOFF = 0.4;

// ── 一、配表 ──────────────────────────────────────────────────────────────────

test('5 条连击：段数走 attackCount、递减走 comboDamage / comboFalloff，两份产物逐格一致', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        for (const spec of SKILLS) {
            const tiers = rows.filter((row) => Number(row.skillChainId) === spec.chain)
                .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
            assert.equal(tiers.length, 3, `${spec.chain} 必须三档齐备`);
            for (const [index, row] of tiers.entries()) {
                assert.equal(String(row.unitId), spec.card);
                assert.equal(row.skillName, spec.name);
                assert.equal(row.statId, 'attackCount', '段数只能走 attackCount ⇒ multiHitFlat');
                assert.equal(row.operation, 'add');
                assert.equal(Number(row.value), spec.hits, `${spec.chain} 的额外段数`);
                assert.equal(Number(row.unlockHeroLevel), [3, 10, 22][index], '这 5 条都在第 1 格 ⇒ 3/10/22');
                const params = JSON.parse(String(row.skillParamJson)) as Record<string, number>;
                assert.equal(params.comboDamage, COMBO_DAMAGE[index], '第 2 段占首段的百分比');
                assert.equal(params.comboFalloff, COMBO_FALLOFF, '再往后每段 ×0.6');
            }
        }
    }
});

test('名称规则：1 段叫「蔓生连打」、2 段叫「蔓生三连」（段数不同 ⇒ 机制不同 ⇒ 不同名）', () => {
    for (const spec of SKILLS) {
        const expected = spec.hits === 1 ? '蔓生连打' : '蔓生三连';
        assert.equal(spec.name, expected, `${spec.chain} 段数 ${spec.hits} 与名称不符`);
        const kRows = remoteRows('armySkillLevelUp').filter((row) => Number(row.id) === spec.chain);
        assert.equal(kRows.length, 3, `${spec.chain} 的 K 表必须三档齐备`);
        for (const row of kRows) assert.equal(row.name, expected);
    }
});

test('文案：第 2 段逐档 60/65/70%，有第 3 段的卡再写 36/39/42%', () => {
    for (const spec of SKILLS) {
        const tiers = remoteRows('armySkillLevelUp')
            .filter((row) => Number(row.id) === spec.chain)
            .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
        for (const [index, row] of tiers.entries()) {
            const text = String(row.desc);
            assert.ok(text.includes(`第2段伤害${COMBO_DAMAGE[index]}%`), `${spec.chain} L${index + 1}：${text}`);
            if (spec.hits === 2) {
                const third = Math.round(COMBO_DAMAGE[index] * (1 - COMBO_FALLOFF));
                assert.ok(text.includes(`第3段伤害${third}%`), `${spec.chain} L${index + 1} 缺第 3 段：${text}`);
            } else {
                assert.ok(!text.includes('第3段'), `${spec.chain} 只有 1 段额外，文案不许提第 3 段：${text}`);
            }
        }
    }
});

test('尾巴落位：有子链走子链槽位，没子链走 mix；子链与主链同档解锁', () => {
    const rows = remoteRows('pvpSkillPlan');
    const expectSlot = (chainId: number, statId: string, value: number) => {
        const tiers = rows.filter((row) => Number(row.skillChainId) === chainId)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.equal(tiers.length, 3, `${chainId} 三档齐备`);
        for (const [index, row] of tiers.entries()) {
            assert.equal(row.statId, statId, `${chainId} 承载的属性`);
            assert.equal(row.operation, 'addRate');
            assert.equal(Number(row.value), value);
            assert.equal(Number(row.unlockHeroLevel), [3, 10, 22][index], '子链必须与主链同档解锁');
            //  子链不能再带 combo 参数：它按 `unitId:pvpSkillId` 覆盖合并，写重了谁赢看行序。
            assert.equal(row.skillParamJson, null, `${chainId} 不该带参数袋`);
        }
    };
    expectSlot(280702, 'attack', 0.18);
    expectSlot(190702, 'attackSpeed', 0.18);
    expectSlot(280901, 'attack', 0.26);
    expectSlot(190901, 'attackSpeed', 0.28);

    const mixOf = (chain: number, tier: number) => JSON.parse(String(
        rows.find((row) => Number(row.skillChainId) === chain && Number(row.skillLevel) === tier)!.skillParamJson,
    )) as Record<string, number>;
    assert.equal(mixOf(100702, 1)['mix.damageRate.addRate'], 0.15, '68007 的伤害尾巴没有子链可挂');
    for (const chain of [101801, 102501]) {
        for (const tier of [1, 2, 3]) {
            const params = mixOf(chain, tier);
            assert.equal(params['mix.attack.addRate'], 0.26, `${chain} 攻击尾巴`);
            assert.equal(params['mix.attackSpeed.addRate'], 0.28, `${chain} 攻速尾巴`);
        }
    }
});

test('101401 原本在 pvpSkillPlan 一行都没有，本批补了 94014011~13', () => {
    for (const rows of [remoteRows('pvpSkillPlan'), clientRows('pvpSkillPlan')]) {
        const tiers = rows.filter((row) => Number(row.skillChainId) === 101401)
            .sort((left, right) => Number(left.skillLevel) - Number(right.skillLevel));
        assert.deepEqual(tiers.map((row) => Number(row.modifierId)), [94014011, 94014012, 94014013]);
        //  参数袋要挂在普攻行上：`mergeSkillPlanIntoRuntime` 的键是 `${unitId}:${pvpSkillId}`，
        //  指错 id 就整条链路读不到 comboDamage（表现为「段数生效、递减不生效」）。
        for (const row of tiers) assert.equal(Number(row.pvpSkillId), 30216, '68014 的 unitSkillId');
    }
});

test('K 表 modfiy 只指到真实存在的修改器（顺带清掉 94925011 / 95825011 这类空引用）', () => {
    const plan = remoteRows('pvpSkillPlan');
    const known = new Set(plan.map((row) => Number(row.modifierId)));
    const kRows = remoteRows('armySkillLevelUp');
    for (const spec of SKILLS) {
        const tiers = kRows.filter((row) => Number(row.id) === spec.chain)
            .sort((left, right) => Number(left.skilllevel) - Number(right.skilllevel));
        for (const row of tiers) {
            const ids = row.modfiy as number[];
            assert.ok(Array.isArray(ids) && ids.length > 0, `${spec.chain} L${row.skilllevel} 的 modfiy 为空`);
            for (const id of ids) {
                assert.ok(known.has(Number(id)), `${spec.chain} L${row.skilllevel} 指向了不存在的 ${id}`);
            }
        }
    }
});

test('全表守卫：同一个 unitId 里段数只能由一条链写', () => {
    //  🔴 `attackCount` 是 flat 加法：同卡两条链都写就叠段数，卡面上看不见、伤害直接翻倍。
    //  Q14 曾在这里留过一个白名单：68009 的 100901「蔓生三连」与 100903「迅击」都写 `attackCount`
    //  ⇒ 27 级后一次挥击打 5 段。第 7 批把 100901 整条换成「破阵投枪」后它不再写段数，
    //  68009 只剩 100903 一条链 ⇒ **Q14 自动消解**，白名单随之删除，守卫恢复成无例外。
    const hits = new Map<string, Set<number>>();
    for (const row of remoteRows('pvpSkillPlan')) {
        if (row.statId !== 'attackCount') continue;
        const unitId = String(row.unitId);
        const chains = hits.get(unitId) ?? new Set<number>();
        chains.add(Number(row.skillChainId));
        hits.set(unitId, chains);
    }
    for (const [unitId, chains] of hits) {
        const actual = [...chains].sort((left, right) => left - right);
        assert.equal(actual.length, 1, `${unitId} 有 ${actual.length} 条链在写 attackCount：${actual}`);
    }
});

// ── 二、结算（近战 / 区域路径） ───────────────────────────────────────────────

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
    /** `attackCount` 段数；缺省 0（不连击）。 */
    hits?: number;
    /** 额外段的递减参数；缺省 = 不写参数（旧口径：满伤害）。 */
    combo?: { comboDamage: number; comboFalloff: number };
    /** 普攻档案的模式：近战（默认）或区域。 */
    mode?: ZCCombatEventType;
}

function makeHarness(options: IHarnessOptions = {}) {
    const source = makeUnit(1, ZCOwner.Player, 0);
    const target = makeUnit(2, ZCOwner.Enemy, 60);
    const damages: number[] = [];
    const statuses: string[] = [];
    const executes: number[] = [];
    const heals: number[] = [];

    const profile: ZCAttackProfile = {
        skillId: 30858, name: '大威天芦普攻', mode: options.mode ?? ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: options.mode === ZCCombatEventType.Area ? 40 : 0,
        damageRate: 1, empoweredEvery: 0, empoweredSkillId: 0, durationSeconds: 0, waves: 1,
        legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68025', name: '大威天芦', maxHp: 100000, attack: 100,
        moveSpeed: 0, attackRange: 70, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1, attackProfile: profile,
    } as ZCUnitDefinition;

    const runtime: ZCSkillRuntimeDefinition = {
        unitId: '68025', skillId: 30858, behaviorKey: 'skill_params',
        trigger: 'none', stateMode: 'none',
        parameters: options.combo
            ? { comboDamage: options.combo.comboDamage, comboFalloff: options.combo.comboFalloff }
            : {},
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

    const patch: ZCUnitStatPatch = options.hits ? { multiHitFlat: options.hits } : {};
    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        //  伤害一律记账：额外段是**独立一次** `damageUnit`，所以数组里能看出打了几段。
        damageUnit: (_unit, damage) => {
            damages.push(damage);
            return { value: damage, kind: 'damage', x: 0, y: 0 } as never;
        },
        healUnit: (_unit, amount) => { heals.push(amount); },
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
        tryExecuteUnit: (_unit, _chance, _owner, sourceId) => { executes.push(sourceId); },
        applyHitStatus: (_unit, statusId) => { statuses.push(statusId ?? ''); },
        applyLegacyBuffs: () => undefined,
        damageWall: () => undefined,
        damageBuilding: () => undefined,
        unitsInRadius: () => [],
    };

    return {
        source, target, state, context, damages, statuses, executes, heals,
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
    };
}

test('近战 2 段：首击 + 额外段 = round(首击 × (0.6 + 0.36))', () => {
    const harness = makeHarness({ hits: 2, combo: { comboDamage: 60, comboFalloff: 0.4 } });
    harness.attack();
    assert.equal(harness.damages.length, 2, '首击 1 笔 + 额外段 1 笔（额外段是合并后的一次结算）');
    const [first, extra] = harness.damages;
    assert.equal(extra, Math.round(first * (0.6 + 0.36)), `额外段应为 ${Math.round(first * 0.96)}，实得 ${extra}`);
});

test('近战 1 段：额外段 = round(首击 × 0.6)', () => {
    const harness = makeHarness({ hits: 1, combo: { comboDamage: 60, comboFalloff: 0.4 } });
    harness.attack();
    assert.equal(harness.damages.length, 2);
    assert.equal(harness.damages[1], Math.round(harness.damages[0] * 0.6));
});

test('不写 combo 参数时额外段仍是满伤害（存量连击行逐字不变）', () => {
    const harness = makeHarness({ hits: 2 });
    harness.attack();
    assert.equal(harness.damages.length, 2);
    assert.equal(harness.damages[1], harness.damages[0] * 2, '旧口径就是 damage × extraHits');
});

test('没有 multiHitFlat 时一笔伤害都不多打', () => {
    const harness = makeHarness({ combo: { comboDamage: 60, comboFalloff: 0.4 } });
    harness.attack();
    assert.equal(harness.damages.length, 1, '段数来自 statPatch，没配就不补段');
});

test('额外段只补伤害：命中状态 / 处决 / 吸血都只算「一次出手」那一段', () => {
    const harness = makeHarness({ hits: 2, combo: { comboDamage: 60, comboFalloff: 0.4 } });
    //  吸血要开比例才会走到 `healUnit`：参数袋里加一条（与本批无关，只为观测）。
    const runtime = harness.context.skillRuntime[ZCOwner.Player].get('68025:30858')!;
    (runtime.parameters as Record<string, number>).lifestealRate = 0.1;
    harness.attack();
    assert.equal(harness.damages.length, 2, '伤害是两笔');
    assert.equal(harness.statuses.length, 1, '连击段不重复挂状态（设计案明确禁止叠两层点燃/减速）');
    assert.equal(harness.executes.length, 1, '处决按「一次出手」算');
    assert.equal(harness.heals.length, 1, '吸血只按首击那一段回，额外段不回');
});

test('区域普攻（area）也吃连击：额外段落点仍是主目标', () => {
    const harness = makeHarness({ hits: 1, combo: { comboDamage: 60, comboFalloff: 0.4 }, mode: ZCCombatEventType.Area });
    harness.attack();
    assert.equal(harness.damages.length, 2, '主目标首击 + 额外段（旁溅目标这里是空的）');
    assert.equal(harness.damages[1], Math.round(harness.damages[0] * 0.6));
});

// ── 三、结算（弹道路径，口径必须与近战一致） ──────────────────────────────────

test('弹道命中：同一套 comboDamage / comboFalloff 递减', () => {
    const harness = makeHarness({ hits: 1, combo: { comboDamage: 60, comboFalloff: 0.4 } });
    const projectile = {
        type: 'projectile', owner: ZCOwner.Player, sourceUnitId: harness.source.id,
        skillId: 30858, baseDamage: 100, x: 60, y: 0, previousX: 60, previousY: 0,
        velocityX: 0, velocityY: 0, collisionRadius: 4, canHitAir: false,
        targetKind: 'unit', targetId: harness.target.id, sourceCardId: '2',
    } as unknown as ZCProjectileState;
    const target = {
        kind: 'unit', id: harness.target.id, x: harness.target.freeX, y: harness.target.freeY,
        bodyRadius: 6, cardId: null,
    } as ZCCombatTarget;
    ZCAttackResolutionSystem.resolveProjectileHit(
        harness.state, projectile, target, harness.context);
    assert.equal(harness.damages.length, 2, '弹道命中也是「首击 + 额外段」两笔');
    assert.equal(harness.damages[0], 100);
    assert.equal(harness.damages[1], 60, '100 × 0.6');
});
