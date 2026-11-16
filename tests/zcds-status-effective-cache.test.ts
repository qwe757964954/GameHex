import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { assetPath } from './helpers/asset-paths';

const PVP_TABLES = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(
        source.k.map((key, index) => [key, values[index]]),
    ));
}

function prepareModel(): ZCGameModel {
    loadPvpTables(Object.fromEntries(PVP_TABLES.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/standard_4.json'), 'utf8')));
    return new ZCGameModel(null, () => 0.1, captureZCMatchConfig());
}

test('statModsOf 在版本内复用，叠层/移除后失效', () => {
    const statusSystem = new ZCStatusSystem();
    statusSystem.register({
        id: 'attack-up', name: 'attack-up', durationSeconds: 5, maxStacks: 2,
        statMods: { attackPct: 10 },
    });

    const empty = statusSystem.statModsOf('7');
    assert.equal(empty, statusSystem.statModsOf('7'));
    assert.equal(statusSystem.revisionOf('7'), 0);

    statusSystem.apply('7', 'attack-up');
    const one = statusSystem.statModsOf('7');
    assert.notEqual(one, empty);
    assert.equal(one.attackPct, 10);
    assert.equal(statusSystem.revisionOf('7'), 1);

    statusSystem.apply('7', 'attack-up', { maxStacks: 1 });
    assert.equal(statusSystem.revisionOf('7'), 1, '刷新时长不改变属性版本');

    statusSystem.apply('7', 'attack-up');
    const two = statusSystem.statModsOf('7');
    assert.notEqual(two, one);
    assert.equal(two.attackPct, 20);

    statusSystem.remove('7', 'attack-up');
    const after = statusSystem.statModsOf('7');
    assert.equal(after.attackPct, undefined);
});

test('effectiveUnitDefinition 在版本内复用，状态与门尺寸变化后失效', () => {
    const model = prepareModel();
    const unitId = ((model as unknown as {
        effectiveDefinitions: Record<string, ReadonlyMap<string, ZCUnitDefinition>>;
    }).effectiveDefinitions.player.keys().next().value as string);
    const unit = {
        id: 1, unitId, owner: 'player', inheritedStats: undefined,
    } as unknown as ZCUnitState;
    const statusSystem = (model as unknown as { statusSystem: ZCStatusSystem }).statusSystem;
    statusSystem.register({
        id: 'attack-up', name: 'attack-up', durationSeconds: 5, maxStacks: 2,
        statMods: { attackPct: 10 },
    });
    statusSystem.apply(String(unit.id), 'attack-up');

    const first = (model as unknown as {
        effectiveUnitDefinition: (unit: typeof unit) => ZCUnitDefinition;
    }).effectiveUnitDefinition(unit);
    const second = (model as unknown as {
        effectiveUnitDefinition: (unit: typeof unit) => ZCUnitDefinition;
    }).effectiveUnitDefinition(unit);
    assert.equal(first, second, '版本未变时应复用同一有效定义对象');

    statusSystem.apply(String(unit.id), 'attack-up');
    const stacked = (model as unknown as {
        effectiveUnitDefinition: (unit: typeof unit) => ZCUnitDefinition;
    }).effectiveUnitDefinition(unit);
    assert.notEqual(stacked, first);
    assert.ok(stacked.attack > first.attack);

    statusSystem.removeAll(String(unit.id));
    unit.gateSize = 'enlarge';
    unit.gateScale = 2;
    const gated = (model as unknown as {
        effectiveUnitDefinition: (unit: typeof unit) => ZCUnitDefinition;
    }).effectiveUnitDefinition(unit);
    assert.notEqual(gated, stacked);
});
