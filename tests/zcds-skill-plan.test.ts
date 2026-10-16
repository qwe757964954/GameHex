import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { compileZCCombatBuild, getZCModifierCatalogs, selectZCSkillPlans } from '../assets/script/app/zcds/model/ZCModifierRuntime';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';

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
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus', 'pvpSkillPlan',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8')));
    return captureZCMatchConfig();
}

test('英雄等级自动选择 accumulate/replace 技能升级档并编译被动属性', () => {
    const config = prepare();
    const catalogs = getZCModifierCatalogs();
    const selected = selectZCSkillPlans('68001', 24, catalogs);
    assert.deepEqual(selected.map((row) => row.modifierId), [
        91001011, 91001012, 91001013,
        91001023,
        91001033,
    ]);
    const currentSkillId = config.units.find((item) => item.unitId === '68001')?.attackProfile?.skillId;
    assert.ok(currentSkillId);
    assert.ok(selected.every((row) => row.pvpSkillId === currentSkillId));

    const loadouts = compileZCCombatBuild({
        unitId: '68001', heroLevel: 24, generalStar: { generalId: 68001, star: 1 },
    }, config.units, catalogs);
    const plan = loadouts.find((loadout) => loadout.sourceKey.startsWith('skillPlan:'));
    assert.ok(plan);
    assert.equal(plan.typedModifiers.filter((item) => item.statId === 'attackRange').length, 3);
    assert.deepEqual(
        plan.typedModifiers.filter((item) => item.statId === 'attack').map((item) => item.value),
        [0.12, 0.3],
    );
    assert.equal(catalogs.adapters.statuses.some((status) => status.statusId === 'hunger_slow_l3'), true);
});

test('未达到解锁等级时不提前下发技能计划', () => {
    prepare();
    assert.deepEqual(selectZCSkillPlans('68001', 2), []);
});
