import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getAllUnitDefinitions } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { parseZCModifierAdapterCatalogs } from '../assets/script/app/zcds/model/ZCStatSchema';
import { ZCStatusSystem } from '../assets/script/app/zcds/model/ZCStatusEffect';
import { assetPath } from './helpers/asset-paths';

function readRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(
        source.k.map((key, index) => [key, values[index]]),
    ));
}

function loadActualPvpTables(): void {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
        'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
        'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, readRows(name)])) as unknown as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(
        assetPath('config/maps/normal.json'), 'utf8',
    )));
}

test('客户端状态表保留周期参数与硬控列', () => {
    const rows = readRows('pvpStatus');
    const catalogs = parseZCModifierAdapterCatalogs({ pvpStatus: rows });
    assert.equal(catalogs.statuses.length, rows.length);
    assert.deepEqual(
        catalogs.statuses.filter((status) => status.enabled).map((status) => status.statusId).sort(),
        rows.filter((row) => row.enabled === 1).map((row) => String(row.statusId)).sort(),
    );

    const frostbite = catalogs.statuses.find((status) => status.statusId === 'frostbite');
    assert.deepEqual({
        handlerKey: frostbite?.handlerKey,
        amountPct: frostbite?.periodicAmountPct,
        basis: frostbite?.periodicBasis,
        cap: frostbite?.periodicCapMultiplier,
    }, {
        handlerKey: 'periodic_damage', amountPct: 1, basis: 'targetMaxHp', cap: 2,
    });

    assert.deepEqual(
        Object.fromEntries(catalogs.statuses
            .filter((status) => status.control)
            .map((status) => [status.statusId, status.control])),
        { stun: 'stun', stun_2: 'stun', freeze: 'freeze', paralysis: 'paralysis', blind: 'blind' },
    );
});

test('客户端技能命中状态与本局状态定义形成闭环', () => {
    loadActualPvpTables();
    const definitions = getAllUnitDefinitions();
    const configuredOnHit = new Map(readRows('pvpSkill').map((row) => [
        Number(row.skillId), row.onHitStatusId || undefined,
    ]));
    const profiles = definitions.flatMap((definition) => [
        definition.attackProfile,
        ...(definition.empoweredProfile ? [definition.empoweredProfile] : []),
    ]);
    for (const profile of profiles) {
        assert.equal(profile.onHitStatusId, configuredOnHit.get(profile.skillId));
    }

    const match = captureZCMatchConfig();
    const enabledStatusIds = readRows('pvpStatus')
        .filter((row) => row.enabled === 1)
        .map((row) => String(row.statusId))
        .sort();
    assert.deepEqual(
        match.statusDefinitions?.map((definition) => definition.id).sort(),
        enabledStatusIds,
    );
    for (const profile of profiles) {
        if (profile.onHitStatusId) {
            assert.ok(enabledStatusIds.includes(profile.onHitStatusId), `命中状态未启用：${profile.onHitStatusId}`);
        }
    }
    const frostbite = match.statusDefinitions?.find((definition) => definition.id === 'frostbite');
    assert.deepEqual(frostbite?.behavior, {
        kind: 'periodic', intervalSeconds: 1, effect: 'damage', amountPct: 1,
        basis: 'targetMaxHp', capAttackMultiplier: 2,
    });
});

test('多个硬控按剩余时间聚合并在到期后解除', () => {
    loadActualPvpTables();
    const system = new ZCStatusSystem();
    for (const definition of captureZCMatchConfig().statusDefinitions ?? []) system.register(definition);

    assert.equal(system.apply('unit', 'freeze', { at: 0 }).applied, true);
    system.tick(['unit'], 1);
    assert.equal(system.controlOf('unit')?.kind, 'freeze');
    assert.equal(system.apply('unit', 'paralysis', { at: 1 }).applied, true);
    assert.equal(system.controlOf('unit')?.kind, 'paralysis');
    system.tick(['unit'], 2.1);
    assert.equal(system.controlOf('unit')?.kind, 'paralysis');
    system.tick(['unit'], 1);
    assert.equal(system.controlOf('unit'), null);
});
