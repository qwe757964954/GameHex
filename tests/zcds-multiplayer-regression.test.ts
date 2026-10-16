import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildZCClientCombatConfig } from '../assets/script/app/zcds/application/ZCClientCombatConfig';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { configureZCMap, ownersForPlayerCount } from '../assets/script/app/zcds/model/ZCMapConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    'skillAttrModifier', 'generalStar', 'pvpAttrMap', 'pvpModifierOverride',
    'pvpUnitGrowth', 'pvpSkillBinding', 'pvpStatus',
];
loadPvpTables(Object.fromEntries(tableNames.map((name) => [name, rows(name)])) as unknown as ZCPvpTables);

test('local 2/3/4-player battles initialize every owner and preserve deterministic snapshots', () => {
    const baseline = JSON.parse(readFileSync('assets/resources/config/maps/standard.json', 'utf8'));
    try {
        for (const playerCount of [2, 3, 4] as const) {
            const mapName = playerCount === 2 ? 'standard' : `standard_${playerCount}`;
            configureZCMap(JSON.parse(readFileSync(`assets/resources/config/maps/${mapName}.json`, 'utf8')));
            const built = buildZCClientCombatConfig(captureZCMatchConfig(), null);
            const owners = ownersForPlayerCount(playerCount);
            assert.deepEqual(Object.keys(built.config.modifiers ?? {}), owners, mapName);
            assert.deepEqual(built.skipped, [], mapName);

            const largeStep = new ZCGameModel(null, () => .1, built.config);
            const smallSteps = new ZCGameModel(null, () => .1, built.config);
            assert.equal(largeStep.snapshot.hexes.filter((hex) => hex.building === 'hq').length, playerCount, mapName);
            assert.deepEqual(Object.keys(largeStep.snapshot.goldByOwner ?? {}), owners, mapName);

            const beforeDevelopment = Object.fromEntries(owners.slice(1).map((owner) => [
                owner,
                largeStep.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length,
            ]));
            const duration = built.config.rules.enemyAiIntervalSeconds + .1;
            largeStep.tick(duration);
            for (let elapsed = 0; elapsed < duration - 1e-9; elapsed += .05) smallSteps.tick(Math.min(.05, duration - elapsed));
            assert.deepEqual(smallSteps.exportSnapshot(), largeStep.exportSnapshot(), `${mapName}: frame partition`);

            for (const owner of owners.slice(1)) {
                const developed = largeStep.snapshot.hexes.filter((hex) => hex.owner === owner && hex.developmentResolved).length;
                assert.ok(developed > beforeDevelopment[owner], `${mapName}:${owner}`);
            }

            const restored = new ZCGameModel(largeStep.exportSnapshot(), () => .1, built.config);
            largeStep.tick(.5);
            restored.tick(.5);
            assert.deepEqual(restored.exportSnapshot(), largeStep.exportSnapshot(), `${mapName}: snapshot restore`);
        }
    } finally {
        configureZCMap(baseline);
    }
});
