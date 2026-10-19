import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ZCGameModel } from '../assets/script/app/zcds/model/ZCGameModel';
import * as MapConfig from '../assets/script/app/zcds/model/ZCMapConfig';
import * as MatchConfig from '../assets/script/app/zcds/model/ZCMatchConfig';
import * as SpawnSelection from '../assets/script/app/zcds/model/ZCSpawnSelection';
import { ZCBattlePhaseController } from '../assets/script/app/zcds/application/ZCBattlePhaseController';
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

function load(file: string, dependencies: Record<string, unknown>): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, { exports, console, require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    } });
    return exports;
}

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

interface IGameHarness {
    model: ZCGameModel | null;
    spawnSelection: SpawnSelection.ZCSpawnSelection | null;
    spawnBaseConfig: MatchConfig.ZCMatchConfig;
    spawnConfigWasStaged: boolean;
    matchRandom: () => number;
    phase: ZCBattlePhaseController;
    hudView: unknown;
    renderWorld: unknown;
    node: unknown;
    finishSpawnSelection(): void;
    openSettlement(retreated: boolean): void;
    unschedule(): void;
    showSettlement(): Promise<void>;
}

function gameFixture() {
    const sent: Array<{ commands: CmdBattleFrameInfo[] }> = [];
    class RequestFinishBattle {
        constructor(readonly request: { commands: CmdBattleFrameInfo[] }, _caller: unknown,
            readonly reply: (response: { code: number }) => void) {}
    }
    const service = load('assets/script/app/battle/BattleStartService.ts', {
        '../generated/requestMsg/RequestBattleMsg': { RequestFinishBattle },
        '../net/GameNet': { GameNet: { instance: {
            isConnected: true,
            send: async (request: RequestFinishBattle) => {
                sent.push(request.request);
                request.reply({ code: 1 });
                return true;
            },
        } } },
        '../net/RequestGuard': { withTimeout: (value: unknown) => value, toCount: Number },
        './BattleStartModel': {},
    });
    const dependencies: Record<string, unknown> = {
        cc: { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} },
        './application/ZCBattlePhaseController': { ZCBattlePhaseController },
        './model/ZCGameModel': { ZCGameModel }, './model/ZCMapConfig': MapConfig,
        './model/ZCMatchConfig': MatchConfig, './model/ZCSpawnSelection': SpawnSelection,
        './view/ZCGameViewUtil': { buildPlayerHomeFocus: () => ({ x: 0, y: 0 }) },
        '../battle/BattleStartService': service,
    };
    for (const name of [
        './ZCDCLogSwitch', './ui/GameRunAway', './ui/ZCSettlementPage', './model/ZCCombatCatalog',
        './view/ZCGameHUDView', './view/ZCGameHudEvents', '../../framework/event/EventMgr',
        './ui/ZCGuidePanel', './view/ZCGameRenderWorld', './model/ZCSeededRandom',
        './model/ZCRankBoard', './view/ZCGameRankBoard', './view/ZCSpawnSelectionView',
        './view/ZCHudBossPanel', './application/ZCClientCombatConfig', '../../framework/FW',
        '../../core/runtime/GameRoute', '../../framework/procedure/ProcedureManager',
        '../../framework/ui/PopupDef', '../battle/BattleResultService',
        '../showReward/RewardFrames', '../itemdetail/ItemDetailTable', '../HeadArt',
    ]) dependencies[name] = {};
    const { ZCGame } = load('assets/script/app/zcds/ZCGame.ts', dependencies);
    const game = new (ZCGame as new () => IGameHarness)();
    game.spawnBaseConfig = makeConfig();
    game.spawnSelection = new SpawnSelection.ZCSpawnSelection(game.spawnBaseConfig.map, () => 0.9);
    game.spawnConfigWasStaged = true;
    game.matchRandom = () => 0.1;
    game.phase.startSpawnSelection();
    game.unschedule = () => {};
    game.hudView = { setMapFocus() {}, setMapZoomRange() {}, setSpawnSelectionMode() {} };
    game.renderWorld = { setSpawnConfirmButton() {}, render() {}, startTerritoryClaimWave() {} };
    game.showSettlement = async () => {};
    return { game, sent };
}

for (const mode of ['manual', 'timeout'] as const) {
    test(`自选主城 ${mode}：最终出生格以 op=4 随完成战斗 commands 上报一次`, () => {
        const { game, sent } = gameFixture();
        const selection = game.spawnSelection!;
        if (mode === 'manual') {
            assert.equal(selection.select('player', 56).ok, true);
            assert.equal(selection.confirm('player').ok, true);
            selection.tick(1);
        } else {
            selection.tick(10);
        }
        assert.ok(selection.result);
        const hexId = selection.result.homes.player;
        assert.equal(hexId, mode === 'manual' ? 56 : 44);
        game.finishSpawnSelection();
        assert.ok(game.model);
        assert.deepEqual(game.model.frameEvents, [{ frameId: 0, unitId: 0, op: 4, params: [hexId] }]);
        game.model.recordSpawnSelection();
        game.finishSpawnSelection();
        game.openSettlement(true);
        game.openSettlement(true);
        assert.equal(sent.length, 1, '重复结算不能重复发包');
        assert.equal(sent[0].commands.length, 1);
        assert.deepEqual(Array.from(sent[0].commands[0].params), [hexId]);
        assert.equal(sent[0].commands[0].op, 4);
        assert.equal(sent[0].commands[0].frameId, 0);
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
