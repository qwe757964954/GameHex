import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type {
    ZCAttackProfile, ZCDeckBonuses, ZCDeckCard, ZCCardTraits, ZCCounterRule, ZCUnitDefinition,
} from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { ZCCombatEventType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCCombatTarget, ZCProjectileState, ZCSnapshot, ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { ZCOwner } from '../assets/script/app/zcds/model/ZCMapConfig';
import type { ZCUnitStatPatch } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { ZC_COUNTER_STAT_IDS } from '../assets/script/app/zcds/model/ZCStatSchema';
import {
    ZCAttackResolutionSystem, zcSkillCounterMultiplier, type IZCAttackResolutionContext,
} from '../assets/script/app/zcds/model/systems/ZCAttackResolutionSystem';

/**
 * 克制条 20 条（2026-11-17）。
 *
 * 机制口径：判据编进 statId —— `counterCamp2` = 对「蘑菇」阵营（`ZC_CAMP_TRAITS` 第 2 位）增伤，
 * `counteredRole3` = 受到「法师」职业（`ZC_ATTACK_TRAITS` 第 3 位）伤害降低。
 *
 * 为什么不用参数袋（`skillParamJson` 里的 `counter: {camp: '蘑菇'}`）：参数袋按
 * `unitId:pvpSkillId` 合并，同一张卡两条克制条（68020 / 68021）会互相覆盖；
 * 而结算点 `ZCAttackResolutionSystem` 只拿得到双方的 `statPatch`，读不到「本行是哪条技能」。
 *
 * 本文件分两段：一、配表真值；二、结算路径（近战 `unitDamage` / 弹道 `resolveProjectileHit`）。
 */

const OWNERS = Object.values(ZCOwner) as ZCOwner[];

function perOwner<T>(factory: () => T): Record<ZCOwner, T> {
    return Object.fromEntries(OWNERS.map((owner) => [owner, factory()])) as Record<ZCOwner, T>;
}

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function params(row: Record<string, unknown>): Record<string, number> {
    const raw = row.skillParamJson;
    return raw == null || raw === '' ? {} : JSON.parse(String(raw)) as Record<string, number>;
}

/** 设计案逐条口径：链 → [三档数值, 暴击率三档 | null]。 */
const DESIGN: Record<number, [readonly [number, number, number], readonly [number, number, number] | null]> = {
    100103: [[9, 11, 13], [4, 5, 6]],
    100203: [[9, 11, 13], [4, 5, 6]],
    100303: [[24, 27, 30], [6, 8, 10]],
    100401: [[24, 27, 30], [6, 8, 10]],
    100503: [[45, 50, 55], [8, 10, 12]],
    101103: [[9, 11, 13], [4, 5, 6]],
    101203: [[9, 11, 13], [4, 5, 6]],
    101302: [[45, 50, 55], [8, 10, 12]],
    101402: [[45, 50, 55], [8, 10, 12]],
    101903: [[9, 11, 13], [4, 5, 6]],
    102001: [[15, 20, 25], null],
    102002: [[24, 27, 30], [6, 8, 10]],
    102101: [[24, 27, 30], [6, 8, 10]],
    102102: [[25, 28, 32], null],
    102202: [[45, 50, 55], [8, 10, 12]],
    102302: [[45, 50, 55], [8, 10, 12]],
    102803: [[9, 11, 13], [4, 5, 6]],
    102904: [[24, 27, 30], [6, 8, 10]],
    103003: [[24, 27, 30], [6, 8, 10]],
    103102: [[45, 50, 55], [8, 10, 12]],
};

// ── 一、配表真值 ───────────────────────────────────────────────────────────────

test('克制条：20 条链 × 3 档全部落表，statId 都在白名单里', () => {
    const rows = readRows('pvpSkillPlan')
        .filter((row) => String(row.statId ?? '').startsWith('counter'));
    assert.equal(rows.length, 60, '20 条链 × 3 档');
    const whitelist = new Set<string>(ZC_COUNTER_STAT_IDS);
    for (const row of rows) {
        assert.ok(whitelist.has(String(row.statId)), `${row.modifierId} 的 ${row.statId} 不在白名单`);
        assert.equal(row.operation, 'add', '值走 add + 百分点（45 = +45%），不是 addRate');
        assert.equal(row.progressionMode, 'replace', '三档递进只取最高档');
        assert.equal(row.skillKind, 'passive_stat');
    }
    const chains = new Set(rows.map((row) => Number(row.skillChainId)));
    assert.deepEqual([...chains].sort((a, b) => a - b), Object.keys(DESIGN).map(Number).sort((a, b) => a - b));
});

test('克制条：三档数值与暴击率逐档对齐设计案，暴击率不超 15%', () => {
    for (const rows of [readRows('pvpSkillPlan')]) {
        for (const [chain, [tiers, crit]] of Object.entries(DESIGN)) {
            const own = rows.filter((row) => Number(row.skillChainId) === Number(chain))
                .sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
            assert.equal(own.length, 3, `${chain} 必须三档齐备`);
            for (const [index, row] of own.entries()) {
                assert.equal(Number(row.value), tiers[index], `${chain} L${index + 1} 的增伤/减伤`);
                const rate = params(row)['mix.critRate'];
                if (crit) {
                    assert.equal(rate, crit[index], `${chain} L${index + 1} 的暴击率`);
                    assert.ok(rate <= 15, `${chain} 的暴击率超上限 15%`);
                } else {
                    assert.equal(rate, undefined, `${chain} 设计案没给暴击率`);
                }
            }
        }
    }
});

test('克制条：判据的序号必须与 ZC_CAMP_TRAITS / ZC_ATTACK_TRAITS 同序', () => {
    //  抽 6 条对拍（含两条反向：受到某阵营 / 受到某职业）。
    const expectations: Array<[number, string]> = [
        [100103, 'counterCamp2'],    // 对蘑菇（花果 1 / 蘑菇 2 / 盆栽 3 / 僵尸 4）
        [100203, 'counteredCamp4'],  // 受到僵尸
        [100303, 'counterRole4'],    // 对坦克（射手 1 / 战士 2 / 法师 3 / 坦克 4）
        [101903, 'counterRole3'],    // 对法师
        [102803, 'counterCamp1'],    // 对花果
        [102302, 'counteredRole3'],  // 受到法师
    ];
    const rows = readRows('pvpSkillPlan');
    for (const [chain, statId] of expectations) {
        const row = rows.find((item) => Number(item.skillChainId) === chain && Number(item.skillLevel) === 1);
        assert.ok(row, `${chain} 缺 L1`);
        assert.equal(row!.statId, statId, `${chain} 的判据 statId`);
    }
});

test('克制条：同一张卡同一档最多一条带暴击率（暴击率不单占一条被动、也不叠两条）', () => {
    const seen = new Map<string, string>();
    for (const row of readRows('pvpSkillPlan')) {
        if (params(row)['mix.critRate'] == null) continue;
        //  109001 那 50 行是暴击**伤害**，不在这条不变量里（它没有 mix.critRate）。
        const key = `${row.unitId}#L${row.skillLevel}`;
        assert.equal(seen.get(key), undefined,
            `${key} 的暴击率同时出现在 ${seen.get(key)} 与 ${row.skillChainId}`);
        seen.set(key, String(row.skillChainId));
    }
});

// ── 二、结算路径 ───────────────────────────────────────────────────────────────

function makeUnit(id: number, owner: ZCOwner, unitId: string, x: number): ZCUnitState {
    return {
        id, owner, unitId, cardId: unitId, tier: 1,
        sourceHexId: 0, targetHexId: null, progress: 0,
        hp: 1000, maxHp: 1000, battleState: 'idle', stateTime: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null,
        nextAttackAt: 0, waitUntil: 0, attackHitDone: false,
        hatredUnitId: null, hatredUntil: 0, facingRadians: 0, deathRemoveAt: 0,
        marchAngle: null, freeX: x, freeY: 0, completedAttackCount: 0,
    };
}

interface IHarnessOptions {
    attackerPatch?: ZCUnitStatPatch;
    defenderPatch?: ZCUnitStatPatch;
    attackerTraits?: ZCCardTraits;
    defenderTraits?: ZCCardTraits;
    /** 不给 = 射手已阵亡（`unitById` 里查不到攻方实例）。 */
    keepShooter?: boolean;
    /** 全局克制规则（`pvpCounter`）；不给 = 空，只测技能级克制条。 */
    counters?: readonly ZCCounterRule[];
}

/** `pvpCounter` 的 dimension 是中文；与 `ZCPvpTableParser.parseCounterRules` 同一张映射。 */
const COUNTER_TRAITS: Record<string, keyof ZCCardTraits> = { 攻击: 'attack', 阵营: 'camp' };

function counterRulesOf(): ZCCounterRule[] {
    return readRows('pvpCounter').map((row) => ({
        trait: COUNTER_TRAITS[String(row.dimension ?? '')],
        attacker: String(row.attacker ?? ''),
        defender: String(row.defender ?? ''),
        damageMultiplier: Number(row.damageMultiplier),
    }));
}

/**
 * 最小桩件：只驱动 `ZCAttackResolutionSystem`，不加载地图 / 卡表。
 * 攻方 100 攻、守方 1000 血，`combatDamageMultiplier` 1 ⇒ 伤害就是 `100 × 克制乘数`。
 */
function makeHarness(options: IHarnessOptions = {}) {
    const keepShooter = options.keepShooter !== false;
    const source = makeUnit(1, ZCOwner.Player, '68005', 0);
    const target = makeUnit(2, ZCOwner.Enemy, '68028', 60);
    const dealt: number[] = [];

    const profile: ZCAttackProfile = {
        skillId: 30707, name: '椰蛋战士普攻', mode: ZCCombatEventType.Melee,
        projectileSpeed: 0, areaRadius: 0, damageRate: 1,
        empoweredEvery: 0, empoweredSkillId: 0,
        durationSeconds: 0, waves: 1,
        legacyEffectKeys: [],
    };
    const definition = {
        unitId: '68005', name: '椰蛋战士', maxHp: 1000, attack: 100,
        moveSpeed: 0, attackRange: 30, attackInterval: 1, attackDuration: 0.32,
        attackHitTime: 0, bodyRadius: 6, spawnSeconds: 0,
        flying: false, canAttackAir: false, hero: false,
        prefabPath: '', prefabSize: 1,
        attackProfile: profile,
    } as unknown as ZCUnitDefinition;

    const state = {
        version: 4, elapsedSeconds: 0, durationSeconds: 300,
        playerGold: 0, enemyGold: 0, artifactReadyUses: 0, artifactCharge: 0,
        artifactCooldown: 0, enemyFrozenSeconds: 0, status: 'running', resultReason: '',
        hexes: [], units: [source, target], nextUnitId: 3,
        incomeClock: 0, aiClock: 0, towerClock: 0, spawnClocks: {},
        drawCursor: perOwner(() => 0),
        allRandomNonGoldDraws: perOwner(() => 0),
        builtTypeCounts: perOwner(() => ({})),
        combatEvents: [], projectiles: [], nextCombatEventId: 1,
        groundZones: [],
    } as unknown as ZCSnapshot;

    const targetRef: ZCCombatTarget = {
        kind: 'unit', id: target.id, x: target.freeX, y: target.freeY,
        bodyRadius: 6, cardId: target.cardId,
    };

    const cards = perOwner(() => new Map<string, ZCDeckCard>());
    //  `ZCDeckCard` 只要 id / traits 两样，其余字段与结算无关。
    const card = (id: string, traits?: ZCCardTraits) => ({ id, traits } as unknown as ZCDeckCard);
    cards[ZCOwner.Player].set('68005', card('68005', options.attackerTraits));
    cards[ZCOwner.Enemy].set('68028', card('68028', options.defenderTraits));

    const statPatches = perOwner(() => new Map<string, ZCUnitStatPatch>());
    if (options.attackerPatch) statPatches[ZCOwner.Player].set('68005', options.attackerPatch);
    if (options.defenderPatch) statPatches[ZCOwner.Enemy].set('68028', options.defenderPatch);

    const unitById = new Map<number, ZCUnitState>([[target.id, target]]);
    if (keepShooter) unitById.set(source.id, source);

    const context: IZCAttackResolutionContext = {
        rules: {
            combatDistanceScale: 0.3, combatDamageMultiplier: 1, unitAttackPerTier: 0,
        } as IZCAttackResolutionContext['rules'],
        statusSystem: { statModsOf: () => ({}) } as unknown as IZCAttackResolutionContext['statusSystem'],
        geometry: { hexIdAt: () => null } as unknown as IZCAttackResolutionContext['geometry'],
        random: () => 0.99,
        effectiveDefinition: () => definition,
        unitPosition: (unit) => ({ x: unit.freeX, y: unit.freeY }),
        damageUnit: (_unit, damage) => { dealt.push(damage); return null; },
        counters: options.counters ?? [],
        cards,
        skillRuntime: perOwner(() => new Map()),
        statPatches,
        deckBonuses: perOwner<ZCDeckBonuses>(() => ({
            activeBonds: [], unitHpMultiplier: 1, unitAttackMultiplier: 1,
            moveSpeedMultiplier: 1, towerAttackMultiplier: 1, incomeBonus: 0,
            spawnIntervalMultiplier: 1,
        })),
        unitById,
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
        source, target, state, context, dealt,
        attack: () => ZCAttackResolutionSystem.sendAttack(state, source, context),
        projectile: (baseDamage = 100) => ZCAttackResolutionSystem.resolveProjectileHit(
            state,
            {
                id: 1, type: ZCCombatEventType.Projectile, owner: ZCOwner.Player,
                sourceUnitId: source.id, sourceCardId: source.cardId,
                baseDamage, criticalHit: false, executeChance: 0,
                legacyBuffs: [], hitUnitIds: [],
            } as unknown as ZCProjectileState,
            targetRef,
            context,
        ),
    };
}

test('克制乘数：缺省（没有卡特征 / 没配克制条）恒为 1', () => {
    assert.equal(zcSkillCounterMultiplier({}, {}, undefined, undefined), 1, '两边都没有特征 ⇒ 无从判断');
    const traits: ZCCardTraits = { attack: '战士', camp: '僵尸' };
    assert.equal(zcSkillCounterMultiplier({}, {}, traits, traits), 1, '两边都没配 ⇒ 恒等');
});

test('克制乘数：攻方增伤看目标、守方减伤看打手，各乘一层', () => {
    const zombieWarrior: ZCCardTraits = { attack: '战士', camp: '僵尸' };
    const mageFlora: ZCCardTraits = { attack: '法师', camp: '花果' };
    //  攻方「对僵尸阵营 +45%」：判据是**被打的人**的阵营
    assert.equal(zcSkillCounterMultiplier({ counterCamp4Pct: 45 }, {}, mageFlora, zombieWarrior), 1.45);
    //  打别的阵营不生效
    assert.equal(
        zcSkillCounterMultiplier({ counterCamp4Pct: 45 }, {}, mageFlora, { attack: '战士', camp: '蘑菇' }), 1);
    //  守方「受到法师职业 -45%」：判据是**打我的人**的职业（攻方是法师才命中）
    assert.equal(zcSkillCounterMultiplier({}, { counteredRole3Pct: 45 }, mageFlora, zombieWarrior), 0.55);
    assert.equal(
        zcSkillCounterMultiplier({}, { counteredRole3Pct: 45 }, { attack: '射手', camp: '僵尸' }, zombieWarrior), 1);
    //  两层同时命中 ⇒ 相乘，不是相加
    assert.equal(
        zcSkillCounterMultiplier({ counterCamp4Pct: 20 }, { counteredCamp4Pct: 50 }, zombieWarrior, zombieWarrior),
        1.2 * 0.5,
    );
});

test('近乎战普攻：攻方「对僵尸阵营 +45%」真的抬高结算伤害（100 → 145）', () => {
    const baseline = makeHarness({ attackerTraits: { attack: '法师', camp: '花果' }, defenderTraits: { attack: '战士', camp: '僵尸' } });
    baseline.attack();
    assert.deepEqual(baseline.dealt, [100], '没配克制条时就是面板攻击');

    const countered = makeHarness({
        attackerTraits: { attack: '法师', camp: '花果' },
        defenderTraits: { attack: '战士', camp: '僵尸' },
        attackerPatch: { counterCamp4Pct: 45 },
    });
    countered.attack();
    assert.deepEqual(countered.dealt, [145]);
});

test('近乎战普攻：守方「受到法师伤害 -45%」压低结算伤害（100 → 55）', () => {
    const harness = makeHarness({
        attackerTraits: { attack: '法师', camp: '花果' },
        defenderTraits: { attack: '战士', camp: '僵尸' },
        defenderPatch: { counteredRole3Pct: 45 },
    });
    harness.attack();
    assert.deepEqual(harness.dealt, [55]);
});

test('近乎战普攻：目标不是该阵营/职业时克制条不生效', () => {
    const harness = makeHarness({
        attackerTraits: { attack: '法师', camp: '花果' },
        //  守方是「蘑菇·战士」：阵营不符（克制条指向僵尸），职业相符（战士）—— 两条都要对。
        defenderTraits: { attack: '战士', camp: '蘑菇' },
        attackerPatch: { counterCamp4Pct: 45, counterRole2Pct: 30 },
    });
    harness.attack();
    assert.deepEqual(harness.dealt, [130], '只有职业那条命中：100 × 1.3');
});

test('弹道命中：克制条由 `projectile.sourceUnitId` 反查攻方实例后生效', () => {
    const harness = makeHarness({
        attackerTraits: { attack: '法师', camp: '花果' },
        defenderTraits: { attack: '战士', camp: '僵尸' },
        attackerPatch: { counterCamp4Pct: 45 },
    });
    harness.projectile(100);
    assert.deepEqual(harness.dealt, [145]);
});

test('弹道命中：射手已阵亡时退回全局克制（技能级克制条随之失效）', () => {
    const harness = makeHarness({
        attackerTraits: { attack: '法师', camp: '花果' },
        defenderTraits: { attack: '战士', camp: '僵尸' },
        attackerPatch: { counterCamp4Pct: 45 },
        keepShooter: false,
    });
    harness.projectile(100);
    assert.deepEqual(harness.dealt, [100], '实例查不到 ⇒ 只剩全局克制，且这里没有 pvpCounter 规则');
});

// ── 三、全局克制链（`pvpCounter`）与设计案同源 ────────────────────────────────

test('pvpCounter：8 条 = 设计案「克制谱系」，职业链 坦克→射手→战士→法师→坦克', () => {
    //  设计案原文（`技能设计案2 / 技能设计案 (2)` 102001 机制列）：
    //  「克制谱系（花果→蘑菇→盆栽→僵尸→花果；法师→坦克→射手→战士→法师）」，A→B 读作「A 克 B」。
    //
    //  🔴 「→」的方向不是猜的，用设计案 Q/R 两列钉死：
    //  表头 Q = 「克制（出手 ×1.3）」/ `counter`，R = 「被克制」/ `counteredBy`。
    //  四张**同阵营**（花果）的卡，排除阵营干扰后只剩职业向：
    //      68001 射手  Q=战士  R=坦克
    //      68002 坦克  Q=射手  R=法师
    //      68003 法师  Q=坦克  R=战士
    //      68005 战士  Q=法师  R=射手
    //  ⇒ 克制边 = 坦克→射手→战士→法师→坦克；且每条 R 正好是别人的 Q（反方向自洽）。
    //  所以「法师→坦克→射手→战士→法师」= 法师克坦克、坦克克射手、射手克战士、战士克法师。
    //
    //  ⚠️ 用户口述的「射手--坦克--法师--战士--射手」与本表**互为逆环**（那不是方向，是节点罗列）；
    //  以设计案 + Q/R 列为准。
    const expected: Array<[string, string, string]> = [
        ['attack', '坦克', '射手'],
        ['attack', '射手', '战士'],
        ['attack', '战士', '法师'],
        ['attack', '法师', '坦克'],
        ['camp', '花果', '蘑菇'],
        ['camp', '蘑菇', '盆栽'],
        ['camp', '盆栽', '僵尸'],
        ['camp', '僵尸', '花果'],
    ];
    const rules = counterRulesOf();
    //  配表行序不是契约（表里职业块是「坦克/战士/射手/法师」的录入顺序），
    //  所以两边都按 `[维度, 攻方]` 排序后再比，只锁「谁克谁」。
    const sortKey = (tuple: Array<string>) => `${tuple[0]}|${tuple[1]}`;
    const actual = rules
        .map((rule) => [rule.trait, rule.attacker, rule.defender])
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'zh-Hans-CN'));
    const wanted = [...expected].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'zh-Hans-CN'));
    assert.deepEqual(actual, wanted, '职业 4 条 + 阵营 4 条都要与设计案链条逐条一致');
    for (const rule of rules) {
        assert.equal(rule.damageMultiplier, 1.3, `${rule.attacker}→${rule.defender} 的倍率`);
    }
});

test('pvpCounter：四职业各自只克一个、且没有一条「克自己」', () => {
    const roles = counterRulesOf().filter((rule) => rule.trait === 'attack');
    const attackers = roles.map((rule) => rule.attacker).sort();
    assert.deepEqual(attackers, ['坦克', '射手', '战士', '法师'].sort(), '四个职业各一条，不重复不遗漏');
    for (const rule of roles) assert.notEqual(rule.attacker, rule.defender, '不能克自己');
    //  形成单环：从任一点出发跟 4 步回到自己。
    let current = '坦克';
    const path: string[] = [current];
    for (let step = 0; step < 4; step += 1) {
        current = roles.find((rule) => rule.attacker === current)!.defender;
        path.push(current);
    }
    assert.equal(current, '坦克', `应当是一个 4 环，实际路径 ${path.join('→')}`);
    assert.equal(new Set(path).size, 4, '四步必须正好走遍四个职业');
});

test('全局克制 × 技能级克制条：两套同源后相乘（射手打战士 1.3 × 1.24）', () => {
    //  68001 豌豆游侠是「花果·射手」，克制条 100103 是「对蘑菇阵营 +9%」（阵营向）；
    //  这里把职业向的 `counterRole2`（对战士）也挂上，模拟「职业猎杀协议」那批卡。
    const harness = makeHarness({
        attackerTraits: { attack: '射手', camp: '花果' },
        defenderTraits: { attack: '战士', camp: '僵尸' },
        attackerPatch: { counterRole2Pct: 24 },
        counters: counterRulesOf(),
    });
    harness.attack();
    //  100 × 1.3（射手克战士）× 1.24（技能级克制条）= 161.2 → 161
    assert.deepEqual(harness.dealt, [161]);
});

test('全局克制 × 技能级克制条：链条以外不生效（射手打法师不再是克制）', () => {
    const harness = makeHarness({
        attackerTraits: { attack: '射手', camp: '花果' },
        defenderTraits: { attack: '法师', camp: '花果' },
        counters: counterRulesOf(),
    });
    harness.attack();
    assert.deepEqual(harness.dealt, [100], '设计案里射手的克制目标是战士，不是法师');
});
