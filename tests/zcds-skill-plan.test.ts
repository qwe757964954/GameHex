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
    const selected = withoutLineupCrit(selectZCSkillPlans('68001', 24, catalogs));
    //  100101「超视孢子」自 2026-11-16 起改成 `replace` 三档递进 14/18/24%：
    //  24 级只取 III 档（91001013）。此前是 accumulate 三档同值 10%，会一次性选中三行。
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
        unitId: '68001', heroLevel: 24, generalStar: { generalId: 68001, star: 1 },
    }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    assert.equal(plan.typedModifiers.filter((item) => item.statId === 'attackRange').length, 1);
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'attack').map((item) => item.value),
        [0.12, 0.3],
    );
    assert.equal(catalogs.adapters.statuses.some((status) => status.statusId === 'hunger_slow_l3'), true);
});

test('未达到解锁等级时不提前下发技能计划', () => {
    prepare();
    //  68001 的技能链首档要 3 级；「全队暴击伤害增幅」（109001）从 1 级起就按级累加，
    //  不属这条用例的语义，先剔掉。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68001', 2)), []);
});

test('unlockHeroLevel=0 的首档一级就生效，高解锁档不提前下发', () => {
    prepare();
    const catalogs = getZCModifierCatalogs();
    // 68013 两条链首档 unlock=0（94013011/94013021），1 级即选中；14/16/22/23 档全部过滤。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 1, catalogs)).map((row) => row.modifierId), [
        94013011, 94013021,
    ]);
    // 14 级时 101301 进到 II 档（unlock=14），101302 仍停在首档（II 档要 16 级）。
    assert.deepEqual(withoutLineupCrit(selectZCSkillPlans('68013', 14, catalogs)).map((row) => row.modifierId), [
        94013012, 94013021,
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
