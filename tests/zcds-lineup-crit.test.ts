import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { compileZCMatchRuntime } from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import type { ZCTypedModifier } from '../assets/script/app/zcds/model/ZCStatSchema';
import { assetPath } from './helpers/asset-paths';
import { LINEUP_CRIT_CHAIN_ID } from './helpers/lineup-crit';

/**
 * 「全队暴击伤害增幅」（2026-11-10）：每张可上场卡按卡牌等级逐级给全队加暴击伤害。
 *
 * 配表形态：`pvpSkillPlan` 里每卡 50 行（`skillChainId = 109001`、
 * `skillLevel = unlockHeroLevel = 1..50`、`progressionMode = accumulate`、
 * `statId = critDamage` / `operation = add`），每行 `value` 是**该级增量**。
 * 之所以逐级铺行而不是一行：`pvpSkillPlan` 没有「按等级缩放」的字段，而「每级数值独立配置、
 * 后期改成梯度」要求每一级在表里各自成行 —— 改某几级只影响那几级。
 *
 * 数值口径按品质定额：绿 0.5% / 蓝 1% / 紫 2% / 金 3%（百分数，20 = +20%）。
 * 消费点在 `ZCAttackResolutionSystem.criticalMultiplier: 1 + critDamagePct / 100`。
 */

const TABLE_NAMES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
];

const MAX_LEVEL = 50;
const STEP_BY_RARITY: Record<number, number> = { 1: 0.5, 2: 1, 3: 2, 4: 3 };

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare() {
    loadPvpTables(Object.fromEntries(TABLE_NAMES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

function critDamagePctOf(unitId: string, level: number): number | null {
    const config = captureZCMatchConfig();
    const loadout = compileZCCombatBuild({ unitId, heroLevel: level }, config.units, getZCModifierCatalogs())
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    return loadout?.statPatch.critDamagePct ?? null;
}

test('全队暴击伤害增幅：每张可上场卡 50 行，1 级起逐级解锁，每级增量按品质定额', () => {
    prepare();
    const plans = readRows('pvpSkillPlan').filter((row) => Number(row.skillChainId) === LINEUP_CRIT_CHAIN_ID);
    const cards = readRows('pvpCard').filter((row) => row.unitId != null && Number(row.enabled) === 1);

    assert.equal(cards.length, 35, '可上场卡应是 35 张');
    assert.equal(plans.length, cards.length * MAX_LEVEL, `35 张卡 × ${MAX_LEVEL} 级 = ${cards.length * MAX_LEVEL} 行`);

    const byUnit = new Map<string, Array<Record<string, unknown>>>();
    for (const plan of plans) {
        const unitId = String(plan.unitId);
        byUnit.set(unitId, [...(byUnit.get(unitId) ?? []), plan]);
    }
    assert.equal(byUnit.size, cards.length, '每张可上场卡都要有这条链');

    for (const card of cards) {
        const unitId = String(card.unitId);
        const step = STEP_BY_RARITY[Number(card.rarity)];
        assert.ok(step, `${unitId} 品质 ${card.rarity} 应有定额`);
        const rows = byUnit.get(unitId)!.sort((a, b) => Number(a.skillLevel) - Number(b.skillLevel));
        assert.equal(rows.length, MAX_LEVEL, `${unitId} 应恰好 ${MAX_LEVEL} 行`);
        rows.forEach((row, index) => {
            const level = index + 1;
            assert.equal(Number(row.skillLevel), level, `${unitId} 第 ${level} 行 skillLevel`);
            //  unlockHeroLevel 必须等于 skillLevel：低于该等级的行不下发，等于「升到几级就加到几级」。
            assert.equal(Number(row.unlockHeroLevel), level, `${unitId} 第 ${level} 行 unlockHeroLevel`);
            assert.equal(Number(row.value), step, `${unitId} 第 ${level} 行每级增量应是 ${step}`);
            assert.equal(row.statId, 'critDamage');
            assert.equal(row.operation, 'add');
            assert.equal(row.progressionMode, 'accumulate', '逐级累加，不能是 replace（那会取单档）');
            assert.equal(row.enabled, 1);
        });
    }
});

test('全队暴击伤害增幅的 modifierId 全局唯一，且不与既有技能链的 ID 相撞', () => {
    prepare();
    const plans = readRows('pvpSkillPlan');
    const ids = plans.map((row) => Number(row.modifierId));
    assert.equal(new Set(ids).size, ids.length, 'modifierId 必须全局唯一（它是报表与运行时快照的行键）');
    const lineup = plans.filter((row) => Number(row.skillChainId) === LINEUP_CRIT_CHAIN_ID);
    assert.equal(lineup.length, 35 * MAX_LEVEL, '109001 链每卡 50 行');
    assert.ok(lineup.every((row) => {
        const id = Number(row.modifierId);
        return id >= 96800000 && id < 96900000;
    }), '109001 链的 modifierId 必须严格落在 968 段，不能与 970 段（372 链）混算');
});

test('全队暴击伤害增幅：等级 L 的累计量 = Σ(1..L) 的每级增量', () => {
    prepare();
    //  绿卡 68001（每级 0.5）与金卡 68007（每级 3）。
    const expected: Array<[string, number, number]> = [
        ['68001', 1, 0.5],
        ['68001', 25, 12.5],
        ['68001', 50, 25],
        ['68007', 1, 3],
        ['68007', 25, 75],
        ['68007', 50, 150],
    ];
    for (const [unitId, level, want] of expected) {
        assert.ok(Math.abs(Number(critDamagePctOf(unitId, level)) - want) < 1e-9,
            `${unitId} 在 ${level} 级应累计 +${want}%，实得 ${critDamagePctOf(unitId, level)}`);
    }
});

test('全队暴击伤害增幅：等级越高行数越多（accumulate 真的在累加，不是取最高档）', () => {
    prepare();
    const catalogs = getZCModifierCatalogs();
    const at = (level: number) => selectZCSkillPlans('68007', level, catalogs)
        .filter((row) => row.skillChainId === LINEUP_CRIT_CHAIN_ID).length;
    assert.equal(at(1), 1);
    assert.equal(at(2), 2);
    assert.equal(at(49), 49);
    assert.equal(at(50), 50);
    //  1 级以下不下发（`selectZCSkillPlans` 对 heroLevel < 1 直接返回空）。
    assert.equal(at(0), 0);
});

/**
 * 语义分界（2026-11-10 用户口径）：
 * - **暴击率**（`critRatePct`）是逐单位属性，各卡各算；
 * - **全队暴击伤害**（`critDamagePct`）是 **owner 级唯一值** —— 阵容里所有卡加的暴击伤害
 *   汇成一个池子，再写回该 owner 的每一个单位；任何一张卡打出暴击，用的都是这个池子值。
 *
 * 实现点：`compileZCMatchRuntime` 在 `unitStatPatches[owner]` 建好之后立刻调
 * `shareLineupCritDamage`（`ZCModifierRuntime.ts`）汇总并写回。
 */
test('全队暴击伤害是 owner 级唯一值：汇总后写回全队，暴击率仍逐单位各算', () => {
    prepare();
    const base = captureZCMatchConfig();
    const catalogs = getZCModifierCatalogs();
    const loadoutsOf = (unitId: string, level: number) =>
        compileZCCombatBuild({ unitId, heroLevel: level }, base.units, catalogs);

    const green = loadoutsOf('68001', 1);   // 绿卡，每级 0.5
    const gold = loadoutsOf('68007', 1);    // 金卡，每级 3
    //  只在 68001 身上补一条**逐单位**属性（暴击率），用来证明它不会被汇总到全队。
    const critRate: ZCTypedModifier = {
        sourceId: 'test-crit-rate', sourceKind: 'skill', targetUnitId: '68001',
        domain: 'unit', statId: 'critRate', operation: 'add', value: 15, priority: 0,
    };
    const withRate = green.map((item) => (item.sourceKey.startsWith('skillPlan:')
        ? { ...item, typedModifiers: [...item.typedModifiers, critRate] }
        : item));

    const runtime = compileZCMatchRuntime({
        ...base,
        modifiers: { player: [...withRate, ...gold], enemy: [] },
    } as never);
    const patches = runtime.unitStatPatches.player;
    const shared = patches.get('68001')?.critDamagePct;
    assert.equal(shared, 3.5, '全队暴击伤害 = 0.5（绿卡 1 级）+ 3（金卡 1 级），两张卡加进同一个池子');
    for (const unit of base.units) {
        assert.equal(patches.get(unit.unitId)?.critDamagePct, shared,
            `${unit.unitId} 自己没配暴击伤害，也必须拿到同一个全队值（这才是「全队共享」）`);
    }
    //  暴击率不共享：只有 68001 有，68007 不会因为「同队」而拿到。
    assert.equal(patches.get('68001')?.critRatePct, 15);
    assert.equal(patches.get('68007')?.critRatePct ?? 0, 0, '暴击率必须逐单位各算，不能被汇总');
});

test('裂变暴击不再给暴击伤害：68025 的 critDamage 只剩 109001，暴击率仍是 38%', () => {
    prepare();
    const catalogs = getZCModifierCatalogs();
    const at25 = selectZCSkillPlans('68025', 25, catalogs);
    const loadout = compileZCCombatBuild({ unitId: '68025', heroLevel: 25 }, captureZCMatchConfig().units, catalogs)
        .find((item) => item.sourceKey.startsWith('skillPlan:'));
    assert.ok(loadout, '必须编译出技能计划 loadout');
    //  单卡技能只提暴击率（裂变暴击 III = +38%，原设计值保留），暴击伤害一个点都不给。
    //  2026-11-10 之前是 90/120/150 的暴伤，用户口径：卡牌自身技能不许带暴击伤害加成。
    assert.equal(loadout!.statPatch.critRatePct, 38, '裂变暴击 III = +38% 暴击率（原设计值）');
    assert.equal(loadout!.statPatch.critDamagePct, 75, '只剩 25×3（109001 本链），裂变暴击的 150 已删除');
    assert.equal(at25.filter((row) => row.skillChainId === LINEUP_CRIT_CHAIN_ID).length, 25);
});

test('全表守卫：`critDamage` 只允许来自 109001，单卡技能不得再产暴击伤害', () => {
    prepare();
    const stray = readRows('pvpSkillPlan').filter((row) => row.statId === 'critDamage'
        && Number(row.skillChainId) !== LINEUP_CRIT_CHAIN_ID);
    assert.deepEqual(stray.map((row) => `${row.unitId}:${row.skillChainId}:${row.value}`), [],
        '除 109001 外不应再有 critDamage 行 —— 暴击伤害是全队属性，单卡技能只许提暴击率');
    //  反方向：`critRate` 仍在，且是原设计值 22/30/38（不是上一轮压过的 3/4/5）。
    //  只钉这 4 张暴击卡 —— 别的卡本来就有自己的暴击率技能（如 68035 的 20%），不归本条管。
    const RATE_CARDS = ['68016', '68025', '68033', '68034'];
    const rates = readRows('pvpSkillPlan')
        .filter((row) => row.statId === 'critRate' && RATE_CARDS.includes(String(row.unitId)))
        .map((row) => Number(row.value))
        .sort((a, b) => a - b);
    assert.deepEqual(rates, [22, 22, 22, 22, 30, 30, 30, 30, 38, 38, 38, 38],
        '裂变暴击 4 卡 × 3 档 = 22 / 30 / 38%（原设计值）');
    //  desc 里不许再出现「暴击伤害」——删了数值还留着文案就是骗玩家。
    for (const row of readRows('pvpSkillPlan').filter((item) => RATE_CARDS.includes(String(item.unitId))
        && item.statId === 'critRate')) {
        assert.ok(!String(row.desc).includes('暴击伤害'), `${row.unitId} 的 desc 还写着暴击伤害：${row.desc}`);
    }
});
