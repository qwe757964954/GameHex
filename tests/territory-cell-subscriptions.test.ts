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
import * as events from '../assets/script/app/territory/view/TerritoryEvents';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

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
            '../../net/GameNet': { GameNet: { instance: net } },
            '../../net/RequestGuard': { withTimeout: (promise: Promise<boolean>) => promise },
            './RequestTerritoryCellInfoMsg': { RequestTerritoryCellInfo: Request },
            '../model/TerritoryCellBitSet': bitSet,
            '../model/TerritoryRequestStatus': requestStatus,
            '../model/TerritoryGrantedReward': grantedReward,
        },
    );
    const repository = new Repository();
    const panel = { node: { on() {} }, initialize() {}, close() {} };
    const Page = loadClass<MainTerritoryMap>('assets/script/app/main/MainTerritoryMap.ts', 'MainTerritoryMap', {
        cc: {
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
            Component: class {}, Vec3: { ZERO: {} },
            instantiate: () => ({ setParent() {}, setPosition() {}, getComponent: () => panel }),
        },
        '../../core/asset/ResourceScope': { ResourceScope },
        '../../framework/event/EventMgr': { EventMgr: { instance: new EventMgr() } },
        '../net/CacheMgr': { CacheMgr: { instance: { setEventUpdate() {}, removeEventUpdate() {} } } },
        '../net/GameNet': { GameNet: { instance: net } },
        '../territory/view/TerritoryEvents': events,
    });
    const passed: Array<[number, readonly number[]]> = [];
    const snapshots: bitSet.ITerritoryCellState[] = [];
    const presenter = {
        state: { ready: false, map: { rows: 3, columns: 3 } },
        applyPassCellsBro(chapter: number, cells: readonly number[]) { passed.push([chapter, cells]); },
        applyCellInfoState(state: bitSet.ITerritoryCellState) { snapshots.push(state); },
        dispose() {},
    };
    const page = new Page();
    Object.assign(page, {
        cellRepository: repository, presenter, node: { getComponent: () => null },
        mapView: { initialize() {}, node: { on() {} }, stopChestPlay() {} },
    });
    return {
        page, repository, listeners, requests, passed, snapshots, presenter,
        emit(name: string, msg: unknown) {
            for (const entry of [...listeners]) if (entry.name === name) entry.handler.call(entry.caller, msg);
        },
    };
}

test('页面订阅两类格子消息并在销毁时解绑，Repository 不持有订阅入口', () => {
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
    h.page.onDestroy();
    h.emit('CmdCityChapterPassCellBroMsg', { levelChapter: 1, cellId: [7] });
    assert.equal(h.listeners.length, 0);
    assert.equal(h.passed.length, 1);
});

test('页面将完整快照交给 Presenter，按当前地图裁剪并拒绝损坏报文', () => {
    const h = createHarness();
    h.page.onLoad();
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 0, unlockCells: [18], passCells: [272] });
    assert.equal(h.snapshots.length, 1);
    assert.deepEqual({ ...h.snapshots[0] }, { levelChapter: 1, rewardState: 0, unlockCells: [1, 4], passCells: [4, 8] });
    h.emit('CmdCityChapterCellInfoRspMsg', { levelChapter: 1, unlockCells: ['bad'], passCells: [16] });
    assert.equal(h.snapshots.length, 1);
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
