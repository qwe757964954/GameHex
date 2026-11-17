import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs, parseZCModifierCatalogs, selectZCSkillPlans } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { assetPath } from './helpers/asset-paths';
import { withoutLineupCrit } from './helpers/lineup-crit';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

function prepare() {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/normal.json'), 'utf8')));
    return captureZCMatchConfig();
}

test('英雄等级自动选择 accumulate/replace 技能升级档并编译被动属性', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const selected = withoutLineupCrit(selectZCSkillPlans('68001', 30, catalogs));
    //  100101「超视孢子」自 2026-11-16 起改成 `replace` 三档递进 14/18/24%：
    //  只取命中的最高档（91001013）。此前是 accumulate 三档同值 10%，会一次性选中三行。
    //  解锁等级自 2026-11-17 统一为「技能1 3/10/22、技能2 6/16/26、技能3 9/18/27、
    //  技能4 12/24/36」⇒ 要三条成长技能全到 III 档需 ≥27 级（100104 的 III 要 36，
    //  所以它停在 II）。这里取 30 级，正是「四格同时接近满档」的典型档位。
    assert.deepEqual(selected.map((row) => row.modifierId), [
        91001013,
        91001023,
        91001033,
        91001042,
    ]);
    const currentSkillId = config.units.find((item) => item.unitId === '68001')?.attackProfile?.skillId;
    assert.ok(currentSkillId);
    assert.ok(selected.every((row) => row.pvpSkillId === currentSkillId));

    const loadouts = compileZCCombatBuild({
        unitId: '68001', heroLevel: 30, generalStar: { generalId: 68001, star: 1 },
    }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    assert.equal(plan.typedModifiers.filter((item) => item.statId === 'attackRange').length, 1);
    //  100103 自 2026-11-17 起是「异种猎杀协议」（对蘑菇阵营增伤 + 暴击率 6%），不再加攻击，
    //  也不再挂 `hunger_slow_*` 减速状态 ⇒ 攻击只剩 100102 的那一条。
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'attack').map((item) => item.value),
        [0.12],
    );
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'counterCamp2').map((item) => item.value),
        [13],
        '对蘑菇阵营（ZC_CAMP_TRAITS 第 2 位）+13%',
    );
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'critRate').map((item) => item.value),
        [6],
    );
    //  换机制时旧状态必须一起摘掉：100103 以前挂 `hunger_slow_l3`（命中减速 2 秒），
    //  现在是纯数值被动，行上不该再有 statusId。`pvpStatus` 表里那条定义还在（别硬删），
    //  所以这里断言的是「计划行不再引用它」，不是「表里没有它」。
    assert.equal(selected.find((row) => row.skillChainId === 100103)?.statusId, undefined);
});

test('未达到解锁等级时不提前下发技能计划', () => {
    prepare();
    //  68001 的技能链首档要 3 级；「全队暴击伤害增幅」（109001）从 1 级起就按级累加，
    //  不属这条用例的语义，先剔掉。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68001', 2)), []);
});

test('首档要解锁等级，未到等级不下发；到档才逐格推进', () => {
    prepare();
    const catalogs = getZCModifierCatalogs();
    // 解锁等级自 2026-11-17 统一后，101301（槽 1）首档要 3 级、101302（槽 2）首档要 6 级，
    // 全表已经没有 unlock=0 的技能档 ⇒ 1 级一个技能都拿不到。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 1, catalogs)).map((row) => row.modifierId), []);
    // 14 级：101301 够 II 档（10），101302 还停在 L1（它的 II 档要 16）。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 14, catalogs)).map((row) => row.modifierId), [
        94013012, 94013021,
    ]);
    // 16 级：101302 也进 II 档。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 16, catalogs)).map((row) => row.modifierId), [
        94013012, 94013022,
    ]);
});


test('skillParamJson 的 mix.<statId> 编译成第二条单位属性（同条混搭）', () => {
    const config = prepare();
    const catalogs = parseZCModifierCatalogs([], [], {
        pvpSkillPlan: [{
            enabled: 1, modifierId: 99000001, unitId: '68001', skillChainId: 100101, skillLevel: 1,
            unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30701,
            statId: 'attack', operation: 'addRate', value: 0.14,
            skillParamJson: '{"mix.critRate.add":4,"mix.maxHp.addRate":0.06}',
        }],
    });
    const loadouts = compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    const mixed = new Map(plan.typedModifiers
        .filter((item) => item.sourceId === 99000001)
        .map((item) => [item.statId, item]));
    assert.equal(mixed.get('attack')?.value, 0.14, '主属性仍走 statId 那一格');
    assert.equal(mixed.get('critRate')?.operation, 'add', 'mix.<statId> 缺省 add');
    assert.equal(mixed.get('critRate')?.value, 4);
    assert.equal(mixed.get('maxHp')?.operation, 'addRate');
    assert.equal(mixed.get('maxHp')?.value, 0.06);
});

test('mix 键写错 statId 时直接抛错，不静默忽略', () => {
    const config = prepare();
    assert.throws(() => {
        const catalogs = parseZCModifierCatalogs([], [], {
            pvpSkillPlan: [{
                enabled: 1, modifierId: 99000002, unitId: '68001', skillChainId: 100101, skillLevel: 1,
                unlockHeroLevel: 1, progressionMode: 'replace', pvpSkillId: 30701,
                skillParamJson: '{"mix.attackPct":10}',
            }],
        });
        compileZCCombatBuild({ unitId: '68001', heroLevel: 1 }, config.units, catalogs);
    }, /混搭/);
});
