import { createControllerContext } from './helpers/controller-context';
import { loadTsModule } from './helpers/cc-sandbox';
import type { TerritoryModel } from '../assets/script/app/territory/application/TerritoryModel';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { MainTerritoryMap } from '../assets/script/app/main/MainTerritoryMap';
import type { TerritoryCellRepository } from '../assets/script/app/territory/application/TerritoryCellRepository';
import * as bitSet from '../assets/script/app/territory/model/TerritoryCellBitSet';
import * as requestStatus from '../assets/script/app/territory/model/TerritoryRequestStatus';
import * as grantedReward from '../assets/script/app/territory/model/TerritoryGrantedReward';
import * as monsterBox from '../assets/script/app/territory/model/TerritoryMonsterBox';
import * as territoryProgress from '../assets/script/app/territory/model/TerritoryProgress';
import * as events from '../assets/script/app/territory/view/TerritoryEvents';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { reportGuideComplete } from '../assets/script/app/guide/application/GuideEvents';
import { buildTerritoryViewState, isTerritoryChestActionable } from '../assets/script/app/territory/application/TerritoryViewState';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';
import { isTerritoryBattleSite } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TerritoryUiEvent, TerritoryViewEvent } from '../assets/script/app/territory/application/TerritoryEvents';
import { sendGameRequest } from '../assets/script/app/net/RequestGuard';

type TerritoryControllerCtor = typeof import('../assets/script/app/territory/application/TerritoryController')['TerritoryController'];

interface IControllerNetPort {
    addEvent(name: string, caller: object, handler: (message: unknown) => void): void;
    removeCaller(caller: object): void;
}
/** Controller 直连 `GameNet.instance`；沙箱把单例桥接到当前 harness 的网络桩。 */
let activeNet: IControllerNetPort = { addEvent() {}, removeCaller() {} };
const { exports: controllerExports, unresolved: controllerUnresolved } = loadTsModule<{ TerritoryController: TerritoryControllerCtor }>(
    'assets/script/app/territory/application/TerritoryController.ts', { modules: {
        '/ControllerBase': { ControllerBase },
        '/GuideEvents': { reportGuideComplete },
        '/GameNet': { GameNet: { sendRequest: function (make, options) { return sendGameRequest(this.instance, make, options); }, instance: {
            addEvent: (name: string, caller: object, handler: (message: unknown) => void) => activeNet.addEvent(name, caller, handler),
            removeCaller: (caller: object) => activeNet.removeCaller(caller),
        } } },
        '/EventMgr': { EventMgr },
        '/TerritoryEvents': { TerritoryUiEvent, TerritoryViewEvent },
        '/TerritoryViewState': { buildTerritoryViewState, isTerritoryChestActionable },
        '/TerritoryTexts': { TERRITORY_TEXTS },
        '/TerritoryMapConfig': { isTerritoryBattleSite },
    } });
assert.deepEqual(controllerUnresolved, []);
const TerritoryController = controllerExports.TerritoryController;

function loadClass<T>(path: string, name: string, imports: Record<string, unknown>): new () => T {
    const exported: Record<string, new () => T> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    runInNewContext(code, {
        exports: exported, console: { info() {}, log() {}, warn() {}, error() {} },
        require: (id: string) => imports[id] ?? {},
    });
    return exported[name];
}

function createHarness() {
    const listeners: Array<{ name: string; caller: unknown; handler: (msg: unknown) => void }> = [];
    const requests: Array<{ callback: (msg: unknown) => void; resolve: (ok: boolean) => void }> = [];
    class Request {
        constructor(_args: unknown, _caller: unknown, readonly callback: (msg: unknown) => void) {}
    }
    const net = {
        isConnected: true,
        addEvent(name: string, caller: unknown, handler: (msg: unknown) => void) {
            listeners.push({ name, caller, handler });
        },
        removeCaller(caller: unknown) {
            for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].caller === caller) listeners.splice(i, 1);
        },
        send(request: Request) {
            return new Promise<boolean>((resolve) => requests.push({ callback: request.callback, resolve }));
        },
    };
    const Repository = loadClass<TerritoryCellRepository>(
        'assets/script/app/territory/application/TerritoryCellRepository.ts', 'TerritoryCellRepository', {
            '../../net/GameNet': { GameNet: { sendRequest: function (make, options) { return sendGameRequest(this.instance, make, options); }, instance: net } },
            // 仓储发请求走的是 `sendGameRequest`（离线早退 + 超时兜底 + ok/failed），
            // 只桩 `withTimeout` 会让它整个是 `undefined` ⇒ 请求根本没发出去，
            // 用例接着读 `requests[0].callback` 就崩在「undefined 上取属性」。
            '../../net/RequestGuard': {
                withTimeout: (promise: Promise<boolean>) => promise,
                sendGameRequest: async (port: typeof net | null | undefined, make: () => unknown) => {
                    if (!port?.isConnected) return 'offline';
                    const sent = await port.send(make() as never, false);
                    return sent === true ? 'ok' : 'failed';
                },
            },
            './RequestTerritoryCellInfoMsg': { RequestTerritoryCellInfo: Request },
            '../model/TerritoryCellBitSet': bitSet,
            '../model/TerritoryMonsterBox': monsterBox,
            '../model/TerritoryRequestStatus': requestStatus,
            '../model/TerritoryGrantedReward': grantedReward,
            // `normalizeTerritoryChapter` 走的是 chapter 归一（0/负数/NaN → 1），不桩就是
            // `undefined()` ⇒ 四条用例全崩在建仓储的那一步。
            '../model/TerritoryProgress': territoryProgress,
        },
    );
    const repository = new Repository();
    const passed: Array<[number, readonly number[]]> = [];
    const snapshots: bitSet.ITerritoryCellState[] = [];
    const presenter = {
        state: { ready: false, map: { rows: 3, columns: 3 } },
        applyPassCellsBro(chapter: number, cells: readonly number[]) { passed.push([chapter, cells]); },
        applyCellInfoState(state: bitSet.ITerritoryCellState) { snapshots.push(state); },
        dispose() {}, start() {}, onOutput() { return () => {}; },
    };
    activeNet = net;
    const controller = new TerritoryController(() => presenter as unknown as TerritoryModel, { context: createControllerContext(),
        cells: repository,
        roleCache: { subscribe: () => () => {} }, schedule: () => () => {},
    });
    const page = { onLoad: () => controller.start(), onDestroy: () => controller.dispose() };
    return {
        page, repository, listeners, requests, passed, snapshots, presenter,
        emit(name: string, msg: unknown) {
            for (const entry of [...listeners]) if (entry.name === name) entry.handler.call(entry.caller, msg);
        },
    };
}

test('Controller 订阅两类格子消息并在销毁时解绑，Repository 不持有订阅入口', () => {
    const h = createHarness();
    assert.equal('listenPassCellsBro' in h.repository, false);
    assert.equal('listenCellInfo' in h.repository, false);
    h.page.onLoad();
    assert.deepEqual(h.listeners.map(({ name }) => name).sort(), [
        'CmdCityChapterCellInfoRspMsg', 'CmdCityChapterPassCellBroMsg',
    ]);
    h.emit('CmdCityChapterPassCellBroMsg', { levelChapter: 0, cellId: [1, '4', -1, 1.5, 'bad'] });
    assert.equal(h.passed.length, 1);
    assert.equal(h.passed[0][0], 1);
    assert.deepEqual(Array.from(h.passed[0][1]), [1, 4]);
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: [2], passCells: [16] });
    assert.equal(h.snapshots.length, 1);
    h.page.onDestroy();
    h.emit('CmdCityChapterPassCellBroMsg', { levelChapter: 1, cellId: [7] });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: [4], passCells: [32] });
    assert.equal(h.listeners.length, 0);
    assert.equal(h.passed.length, 1);
    assert.equal(h.snapshots.length, 1, '销毁后两类消息都必须在订阅层停止，不能再调用 Presenter');
});

test('Controller 将完整快照交给 Presenter 并拒绝损坏报文', () => {
    const h = createHarness();
    h.page.onLoad();
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 0, unlockCells: [18], passCells: [272] });
    assert.equal(h.snapshots.length, 1);
    assert.deepEqual({ ...h.snapshots[0] }, {
        levelChapter: 1, rewardState: 0, unlockCells: [1, 4], passCells: [4, 8], monsterBoxes: [],
    });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: ['bad'], passCells: [16] });
    assert.equal(h.snapshots.length, 1);
    h.page.onDestroy();
});

test('地图未就绪时 Controller仍转交快照，切章期间不按旧地图裁剪', () => {
    const h = createHarness();
    h.page.onLoad();
    Object.assign(h.presenter.state, { map: null });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: [1024], passCells: [16] });
    assert.equal(h.snapshots.length, 1);
    assert.deepEqual(Array.from(h.snapshots[0].unlockCells), [10]);
    Object.assign(h.presenter.state, { map: { rows: 1, columns: 1 } });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 2, unlockCells: [1024], passCells: [16] });
    assert.equal(h.snapshots.length, 2);
    assert.deepEqual(Array.from(h.snapshots[1].unlockCells), [10]);
    h.page.onDestroy();
});

test('请求响应在途时不作为推送重复合并，后续主动推送仍然可用', async () => {
    const h = createHarness();
    h.page.onLoad();
    const pending = h.repository.fetchChapterCells(1, 9);
    const rsp = { levelChapter: 1, unlockCells: [18], passCells: [16] };
    h.requests[0].callback(rsp);
    h.emit('CmdCityChapterCellInfoRspMsg', rsp);
    assert.equal(h.snapshots.length, 0);
    h.requests[0].resolve(true);
    assert.equal((await pending).ok, true);
    h.emit('CmdCityChapterCellInfoRspMsg', rsp);
    assert.equal(h.snapshots.length, 1);
    h.page.onDestroy();
});

test('旧章请求在途不吞掉新章快照，独立推送也不因同章请求在途而丢失', async () => {
    const h = createHarness();
    h.page.onLoad();
    const pending = h.repository.fetchChapterCells(1, 9);
    h.repository.clear();
    Object.assign(h.presenter.state, { map: null });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 2, unlockCells: [1024], passCells: [16] });
    assert.equal(h.snapshots.length, 1, '新章推送必须进入 Presenter 的加载暂存入口');
    assert.equal(h.snapshots[0].levelChapter, 2);
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: [4], passCells: [16] });
    assert.equal(h.snapshots.length, 2, '独立推送不能按请求是否在途粗暴丢弃');
    const rsp = { levelChapter: 1, unlockCells: [18], passCells: [16] };
    h.requests[0].callback(rsp);
    h.emit('CmdCityChapterCellInfoRspMsg', rsp);
    assert.equal(h.snapshots.length, 2, '实际请求响应仍只合并一次');
    h.requests[0].resolve(true);
    await pending;
    h.page.onDestroy();
});
