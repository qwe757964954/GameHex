import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createControllerContext } from './helpers/controller-context';
import { loadBattlePreparation } from './helpers/battle-composition';
import { TerritoryController } from '../assets/script/app/territory/application/TerritoryController';
import { TerritoryUiEvent, TerritoryViewEvent, type ITerritoryCommandEvent } from '../assets/script/app/territory/application/TerritoryEvents';
import type { ITerritoryNavigateBattlePayload, TerritoryModelOutput } from '../assets/script/app/territory/application/TerritoryModel';
import type { ZCGameEntryParams } from '../assets/script/app/zcds/application/ZCGameEntry';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as requestGuard from '../assets/script/app/net/RequestGuard';
import * as territoryTexts from '../assets/script/app/territory/application/TerritoryTexts';

function fixture(failure = false) {
    const context = createControllerContext();
    const routes: ZCGameEntryParams[] = [], commands: ITerritoryCommandEvent['command'][] = [];
    let output: (value: TerritoryModelOutput) => void = () => {};
    let release = 0;
    const preparation = loadBattlePreparation({
        '../ZCGame': { MAP_DIRECTORY: 'config/maps' },
        './ZCBattleEntryBuilder': { buildZCBattleEntry() {}, resolveZCBattlePlayerCount: () => 2 },
        '../../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore() {} },
        './ZCGameLoader': { ZCGameLoader: class {
            async prepare(scope: ResourceScope) {
                scope.defer(() => release++);
                if (failure) throw new Error('battle art failed');
                return {};
            }
        } },
    });
    const modules: Record<string, unknown> = {
        '../../zcds/application/ZCBattlePreparation': preparation,
        '../../../framework/procedure/ProcedureManager': { ProcedureManager: { navigate: (_route: string, params: ZCGameEntryParams) => routes.push(params) } },
        '../../../core/runtime/GameRoute': { GameRoute: { Battle: 'battle' } },
        '../../main/MainRoleRow': { readRoleRow: () => ({ id: 'captured-role', selectServerId: '17' }) },
        '../../net/CacheMgr': { CacheMgr: { instance: { setEventUpdate() {}, removeEventUpdate() {} } } },
        '../../net/GameNet': { GameNet: { instance: { addEvent() {}, removeCaller() {} } } },
        '../../net/RequestGuard': requestGuard,
        './TerritoryModel': { TerritoryModel: class {
            onOutput(callback: typeof output) { output = callback; return () => { output = () => {}; }; }
            start() {} dispose() {}
        } },
        './TerritoryController': { TerritoryController },
        './TerritoryChapterLoader': { TerritoryChapterLoader: class {} },
        './TerritoryCellRepository': { TerritoryCellRepository: class {} },
        './TerritoryChapterInfoRepository': { TerritoryChapterInfoRepository: { instance: { availableChapters: [1] } } },
        './TerritorySaveStoreAdapter': { TerritorySaveStoreAdapter: class {} },
        './TerritoryTexts': territoryTexts,
    };
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/territory/application/TerritoryEntry.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (!(name in modules)) throw new Error(`Unexpected entry dependency ${name}`);
        return modules[name];
    } });
    const entry = new exports.TerritoryEntry(context, () => () => {});
    const observer = {};
    EventMgr.instance.on(TerritoryViewEvent.Command, (event: ITerritoryCommandEvent) => commands.push(event.command), observer);
    entry.start();
    const payload: ITerritoryNavigateBattlePayload = {
        pve: { levelId: 9, chapterId: 1, stage: 5, territoryCellId: 213, mode: 'defence', enemyName: 'boss',
            enemyCardIds: [], enemyTeamCardIds: [], playerCount: 2, hpRate: 1, attackRate: 1, waves: [] },
        battle: { battleId: 'territory-battle', seed: '123', version: '1', units: [] },
    };
    return { entry, payload, routes, commands, publish: () => output({ kind: 'navigate', payload }),
        enter: () => EventMgr.instance.emit(TerritoryUiEvent.Intent, { intent: { kind: 'enterBattle', payload } }),
        get released() { return release; },
        dispose() { entry.dispose(); EventMgr.instance.offTarget(observer); } };
}

test('territory composition prepares before presentation and transfers the same session with captured account', async () => {
    const h = fixture();
    const destination = new ResourceScope('battle');
    try {
        h.publish();
        const command = h.commands[0];
        assert.equal(command.kind, 'navigate');
        if (command.kind !== 'navigate') throw new Error('missing navigation');
        await command.ready;
        assert.equal(h.routes.length, 0, 'presentation has not finished');
        h.enter(); h.enter();
        assert.equal(h.routes.length, 1);
        const params = h.routes[0], session = params.session;
        assert.ok(session);
        assert.equal(params.battle, h.payload.battle);
        assert.equal(params.selfRoleId, 'captured-role');
        assert.equal(params.pve.territorySaveOwner.serverId, '17');
        await session.adopt(params, { resources: destination, cancelled: false });
        h.entry.dispose();
        assert.equal(session.scope.disposed, false);
        assert.equal(h.released, 0);
        destination.dispose();
        assert.equal(h.released, 1);
    } finally { destination.dispose(); h.dispose(); }
});

test('failed territory preparation releases resources and preserves direct-load fallback', async () => {
    const h = fixture(true);
    try {
        h.publish();
        const command = h.commands[0];
        if (command.kind !== 'navigate') throw new Error('missing navigation');
        await assert.rejects(command.ready, /battle art failed/);
        assert.equal(h.released, 1);
        h.enter();
        assert.equal(h.routes[0].session, undefined);
        assert.equal(h.routes[0].battle, h.payload.battle);
    } finally { h.dispose(); }
});

test('territory exit releases an unclaimed session and disconnects delayed presentation intent', async () => {
    const h = fixture();
    try {
        h.publish();
        const command = h.commands[0];
        if (command.kind !== 'navigate') throw new Error('missing navigation');
        await command.ready;
        h.entry.dispose();
        h.enter();
        assert.equal(h.released, 1);
        assert.equal(h.routes.length, 0);
    } finally { h.dispose(); }
});
