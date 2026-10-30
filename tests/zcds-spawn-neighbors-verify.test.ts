import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { resolveZCSpawnMatchConfig } from '../assets/script/app/zcds/model/ZCSpawnSelection';
import { assetPath } from './helpers/asset-paths';

// 复用与 zcds-state-consistency 相同的卡表（assets/remoteRef）。
const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

const layout = JSON.parse(readFileSync(assetPath('config/maps/select_river.json'), 'utf8')) as ZCMapLayout;
configureZCMap(layout);
const base = captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });

test('select map: 主城与邻格归属各方，开局不立即结束', () => {
    const homes = { player: base.map.homes![0], enemy: base.map.homes![1] };
    const resolved = resolveZCSpawnMatchConfig(base, { homes: homes as never, resolvedResources: [] as never });
    const model = new ZCGameModel(null, Math.random, resolved);
    const state = (model as unknown as { state: { hexes: { owner: string; building: string }[]; status: string; resultReason: string } }).state;

    const playerHexes = state.hexes.filter((h) => h.owner === 'player');
    const enemyHexes = state.hexes.filter((h) => h.owner === 'enemy');

    assert.ok(playerHexes.length >= 2, 'player should own home + neighbors');
    assert.ok(enemyHexes.length >= 2, 'enemy should own home + neighbors');
    assert.equal(playerHexes.filter((h) => h.building === 'hq').length, 1);
    assert.equal(enemyHexes.filter((h) => h.building === 'hq').length, 1);

    assert.equal(state.status, 'playing');
    assert.equal(state.resultReason, '');
});
