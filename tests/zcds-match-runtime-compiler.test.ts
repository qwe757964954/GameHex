import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPvpTables, type ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { captureZCMatchConfig } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import * as matchRuntime from '../assets/script/app/zcds/model/ZCMatchRuntimeCompiler';
import { assetPath } from './helpers/asset-paths';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('本局预计算按 owner 隔离卡组和有效单位定义，不修改冻结配置', () => {
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, rows(name)])) as ZCPvpTables);
    configureZCMap(JSON.parse(readFileSync(assetPath('config/maps/standard.json'), 'utf8')));
    const base = captureZCMatchConfig();
    const config = captureZCMatchConfig({
        ...base,
        ownerDecks: {
            player: base.playerDeck.slice(0, 1),
            enemy: base.enemyDeck.slice(1, 2),
        },
    });
    assert.equal(typeof matchRuntime.compileZCMatchRuntime, 'function');
    const before = JSON.stringify(config);
    const compiled = matchRuntime.compileZCMatchRuntime(config);
    const playerCard = config.ownerDecks?.player?.[0];
    const enemyCard = config.ownerDecks?.enemy?.[0];
    assert.ok(playerCard);
    assert.ok(enemyCard);
    assert.equal(compiled.definitions.size, config.units.length);
    assert.equal(compiled.cards.get(playerCard.id)?.id, playerCard.id);
    assert.equal(compiled.cards.get(enemyCard.id)?.id, enemyCard.id);
    assert.equal(compiled.effectiveDefinitions.player.size, config.units.length);
    assert.equal(compiled.effectiveDefinitions.enemy3.size, config.units.length);
    assert.ok(compiled.deckBonuses.player);
    assert.equal(JSON.stringify(config), before);
});
