import { runtimeFixture } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import * as MapConfig from '../assets/script/app/zcds/model/ZCMapConfig';
import * as MatchConfig from '../assets/script/app/zcds/model/ZCMatchConfig';
import * as SpawnSelection from '../assets/script/app/zcds/model/ZCSpawnSelection';
import { loadPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import type { ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
loadPvpTables(Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables);

function makeConfig(): MatchConfig.ZCMatchConfig {
    MapConfig.configureZCMap({
        id: 'spawn-frame-report', version: 3, rows: 8, columns: 8,
        playerCount: 2, cityMode: 'select',
        ascii: [
            '22222222', '22222222', '22222222', '22222222',
            '11111111', '11111111', '11111111', '11111111',
        ],
        homes: [{ row: 5, column: 4 }, { row: 2, column: 3 }],
        spacing: { homeMinDistance: 2, resourceMinDistance: 3 },
    });
    return MatchConfig.captureZCMatchConfig(undefined, { allowUnresolvedSelect: true });
}

for (const mode of ['manual', 'timeout'] as const) {
    test(`自选主城 ${mode}：最终出生格以 op=4 随完成战斗 commands 上报一次`, () => {
        const h = runtimeFixture({}, true);
        try {
            if (mode === 'manual') EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
            h.finishShowcase();
            const model = h.runtime.currentModel;
            assert.ok(model);
            const commands = model.frameEvents.filter(event => event.op === 4);
            assert.equal(commands.length, 2);
            assert.deepEqual(commands.map(event => event.owner), ['player', 'enemy']);
            model.recordSpawnSelection();
            EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm); h.finishShowcase();
            EventMgr.instance.emit(ZCGameUiEvent.Retreat); EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            assert.equal(h.requests.length, 1);
            const reported = h.requests[0].commands.filter(event => event.op === 4);
            assert.deepEqual(reported.map(event => event.unitId), [81, 82]);
            assert.deepEqual(reported.map(event => event.params), commands.map(event => event.params));
            assert.ok(reported.every(event => event.frameId === 0));
        } finally { h.dispose(); }
    });
}

test('固定主城开局不生成自选出生点指令', () => {
    const base = makeConfig();
    const fixed = SpawnSelection.resolveZCSpawnMatchConfig(base, {
        homes: { player: 44, enemy: 19, enemy2: -1, enemy3: -1 }, resolvedResources: [],
    });
    const model = new ZCGameModel(null, () => 0.1, fixed);
    assert.deepEqual(model.frameEvents, []);
});
