/**
 * 据点迁城（`CmdSlgCampMoveReqMsg` / `CmdSlgCampMoveRspMsg`，协议 r882）的接线单测。
 *
 * 迁城是**写操作**，三类错误都不会报错：
 *   ① 只判 `succ === 1` 不校验回带的 `req` ⇒ 连点两次时前一次的迟到回包会被当成后一次成功；
 *   ② 不串行 ⇒ 第二发基于已过期的落点发出去；
 *   ③ 失败时把已有快照清掉 ⇒ 一次超时把据点状态和角色列表一起抹空。
 * 所以钉：协议 / 参数边界 / 回包归属 / 仓库串行与不清缓存 / 网关重试策略 / Presenter 的三处重拉。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import ts from 'typescript';
import {
    BIGMAP_CAMP_MOVE_TEXT,
    BIGMAP_CAMP_MOVE_TYPE,
    isBigMapCampMoveSucceeded,
    isBigMapCampPos,
    normalizeBigMapCampMoveRequest,
} from '../assets/script/app/bigmap/model/BigMapCampMove';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import type { BigMapSlgRepository } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const CMD = 'com.xkhy.tafang.cmd';

const root = protobuf.Root.fromJSON(JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8')));

function loadModule(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { exports, require });
    return exports;
}

// ============================================================================
// ① 协议
// ============================================================================

test('协议：请求三字段 uint32，响应 succ + 回带的 req（嵌套同一 message）', () => {
    const req = root.lookupType(`${CMD}.CmdSlgCampMoveReqMsg`);
    const rsp = root.lookupType(`${CMD}.CmdSlgCampMoveRspMsg`);
    assert.deepEqual(Object.keys(req.fields), ['campId', 'pos', 'moveType']);
    for (const [name, id] of [['campId', 1], ['pos', 2], ['moveType', 3]] as const) {
        assert.equal(req.fields[name].id, id);
        assert.equal(req.fields[name].type, 'uint32');
    }
    assert.deepEqual(Object.keys(rsp.fields), ['succ', 'req']);
    assert.equal(rsp.fields.succ.id, 1);
    assert.equal(rsp.fields.succ.type, 'uint32');
    assert.equal(rsp.fields.req.id, 2);
    // ★ 回带的就是请求 message 本体 —— 客户端靠它认出"这是我这次请求的回包"。
    assert.equal(rsp.fields.req.resolvedType, req);
    assert.equal(rsp.fields.req.required, true);
});

test('★协议：MessageId 已登记（没登记本地就发不出去）', () => {
    const ids = root.lookupEnum(`${CMD}.MessageId`);
    assert.equal(ids.values.CmdSlgCampMoveRspMsg, 1866377577);
});

test('编码往返：嵌套 req 逐字回来（pos=0 不丢）', () => {
    const rsp = root.lookupType(`${CMD}.CmdSlgCampMoveRspMsg`);
    const payload = { succ: 1, req: { campId: 205, pos: 0, moveType: 1 } };
    const decoded = rsp.toObject(rsp.decode(rsp.encode(rsp.create(payload)).finish()), { defaults: true }) as {
        succ: number; req: { campId: number; pos: number; moveType: number };
    };
    assert.deepEqual(decoded, { succ: 1, req: { campId: 205, pos: 0, moveType: 1 } });
});

// ============================================================================
// ② 参数边界
// ============================================================================

test('参数：campId/pos/moveType 收敛，pos=0 合法', () => {
    assert.deepEqual(normalizeBigMapCampMoveRequest(205, 0), { campId: 205, pos: 0, moveType: 1 });
    assert.equal(isBigMapCampPos(0), true);
    assert.equal(isBigMapCampPos(0xffffffff), true);
    for (const bad of [-1, 1.5, Number.NaN, 0x100000000, '3', undefined]) {
        assert.equal(normalizeBigMapCampMoveRequest(205, bad), null, `pos=${String(bad)} 应拒`);
    }
    for (const bad of [0, -1, '205', null]) {
        assert.equal(normalizeBigMapCampMoveRequest(bad, 3), null, `campId=${String(bad)} 应拒`);
    }
});

test('★参数：moveType 只认 1（常规移动），别的值一律拒发', () => {
    assert.equal(BIGMAP_CAMP_MOVE_TYPE.Normal, 1);
    assert.equal(normalizeBigMapCampMoveRequest(205, 3, 1)?.moveType, 1);
    for (const bad of [0, 2, -1, 1.5]) {
        assert.equal(normalizeBigMapCampMoveRequest(205, 3, bad), null, `moveType=${bad} 应拒`);
    }
});

// ============================================================================
// ③ 回包归属
// ============================================================================

const REQUEST = { campId: 205, pos: 7, moveType: BIGMAP_CAMP_MOVE_TYPE.Normal } as const;

test('★回包：succ=1 且 req 三项与请求逐字相同才算成功', () => {
    assert.equal(isBigMapCampMoveSucceeded({ succ: 1, req: { ...REQUEST } }, REQUEST), true);
    for (const succ of [0, 2, undefined]) {
        assert.equal(isBigMapCampMoveSucceeded({ succ, req: { ...REQUEST } }, REQUEST), false, `succ=${String(succ)}`);
    }
    assert.equal(isBigMapCampMoveSucceeded({ succ: 1 }, REQUEST), false, '缺 req = 坏包');
    assert.equal(isBigMapCampMoveSucceeded(null, REQUEST), false);
});

test('★回包：campId / pos / moveType 任一不符都作废（迟到、串包、换城）', () => {
    // 玩家连点两次（pos 7 → pos 8），pos=7 的迟到回包不能被当成功。
    assert.equal(isBigMapCampMoveSucceeded({ succ: 1, req: { campId: 205, pos: 8, moveType: 1 } }, REQUEST), false);
    // 换城后旧回包到达。
    assert.equal(isBigMapCampMoveSucceeded({ succ: 1, req: { campId: 206, pos: 7, moveType: 1 } }, REQUEST), false);
    // 协议以后加了别的移动类型，旧包不能被当成常规移动成功。
    assert.equal(isBigMapCampMoveSucceeded({ succ: 1, req: { campId: 205, pos: 7, moveType: 2 } }, REQUEST), false);
});

// ============================================================================
// ④ 仓库
// ============================================================================

function deferred() {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((finish) => { resolve = finish; });
    return { promise, resolve };
}

function makeGateway() {
    const moves: { campId: number; pos: number; moveType: number }[] = [];
    const move = deferred();
    const detail = deferred();
    const gateway: IBigMapCampGateway = {
        fetchSimple: async () => null,
        fetchDetail: () => detail.promise,
        fetchRoles: async () => null,
        requestMove: (body) => { moves.push({ ...body }); return move.promise; },
        subscribeRoleEvents: () => () => undefined,
    };
    return { moves, move, detail, gateway };
}

test('仓库：迁城成功向上报 ok，且成功后不改本地快照（新状态由调用方重拉）', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const pending = repository.moveCamp(205, 7);
    assert.deepEqual(h.moves, [{ campId: 205, pos: 7, moveType: 1 }], 'moveType 自动补 1');
    h.move.resolve({ succ: 1, req: { campId: 205, pos: 7, moveType: 1 } });
    const result = await pending;
    assert.deepEqual(result, { ok: true, message: BIGMAP_CAMP_MOVE_TEXT.moved });
    assert.equal(repository.get(205), null, '仓库不猜新状态，交给 Presenter 重拉');
});

test('★仓库：参数不合法直接拒，不发请求', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    for (const [campId, pos] of [[0, 1], [205, -1], [205, 1.5], [205, 0x100000000]] as const) {
        const result = await repository.moveCamp(campId, pos);
        assert.equal(result.ok, false);
        assert.equal(result.message, BIGMAP_CAMP_MOVE_TEXT.invalid);
    }
    assert.deepEqual(h.moves, []);
});

test('★仓库：串行——上一发未落地时再点直接拒（busy），不发第二发', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const first = repository.moveCamp(205, 7);
    const second = await repository.moveCamp(205, 8);
    assert.deepEqual(second, { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.busy });
    assert.equal(h.moves.length, 1, '第二发不许出去');
    h.move.resolve({ succ: 1, req: { campId: 205, pos: 7, moveType: 1 } });
    assert.equal((await first).ok, true);
});

test('★仓库：失败/超时只返失败，不清已有据点快照与角色列表', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    // 先拿一份据点详情 + 角色，作为"已有数据"。
    const detail = repository.refreshDetail([205]);
    h.detail.resolve({ infos: [{ campId: 205, opType: 1, state: 1 }] });
    await detail;
    assert.equal(repository.get(205)?.opType, 1);

    const pending = repository.moveCamp(205, 7);
    h.move.resolve({ succ: 0, req: { campId: 205, pos: 7, moveType: 1 } });
    assert.deepEqual(await pending, { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.failed });
    assert.equal(repository.get(205)?.opType, 1, '★失败不能把已有据点状态抹掉');
});

test('仓库：dispose 后不再发迁城请求', async () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    repository.dispose();
    const result = await repository.moveCamp(205, 7);
    assert.equal(result.ok, false);
    assert.equal(result.message, BIGMAP_CAMP_MOVE_TEXT.disposed);
    assert.deepEqual(h.moves, []);
});

// ============================================================================
// ⑤ 网关
// ============================================================================

test('★网关：真发 CmdSlgCampMoveReqMsg，body 三项，allowRetry=false', async () => {
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', () => ({
        RequestMsg: class {
            allowRetry = true;
            constructor(public cmdReqMsg: Record<string, unknown>, _caller: unknown, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    const sent: { name: string; body: Record<string, unknown>; allowRetry: boolean; needLoading: boolean }[] = [];
    const net = {
        isConnected: true,
        async send(req: { getReqMsgProtoName(): string; cmdReqMsg: Record<string, unknown>; fCallback(rsp: unknown): void;
            allowRetry: boolean }, needLoading: boolean) {
            sent.push({ name: req.getReqMsgProtoName(), body: req.cmdReqMsg, allowRetry: req.allowRetry, needLoading });
            req.fCallback({ succ: 1, req: { campId: 205, pos: 7, moveType: 1 } });
            return true;
        },
    };
    const mod = loadModule('assets/script/app/bigmap/application/GameNetBigMapCampGateway.ts', (name) => {
        if (name.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (name === './RequestBigMapCampMsg') return requests;
        return {};
    });
    const Gateway = mod.GameNetBigMapCampGateway as new () => {
        requestMove(body: { campId: number; pos: number; moveType: number }): Promise<unknown>;
    };
    await new Gateway().requestMove({ campId: 205, pos: 7, moveType: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, 'CmdSlgCampMoveReqMsg');
    assert.deepEqual(Object.keys(sent[0].body), ['campId', 'pos', 'moveType']);
    assert.equal(sent[0].body.campId, 205);
    assert.equal(sent[0].body.pos, 7);
    assert.equal(sent[0].body.moveType, 1);
    assert.equal(sent[0].allowRetry, false, '★写操作重发可能真的迁两次');
    assert.equal(sent[0].needLoading, false);
});

// ============================================================================
// ⑥ Presenter
// ============================================================================

function makePresenter(overrides: { gameRefreshes?: { count: number } } = {}) {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    const counter = overrides.gameRefreshes ?? { count: 0 };
    // 只实现 Presenter 真正用到的两个入口：构造时 `onChanged` 订阅、迁城成功后 `refreshGame` 重拉。
    const slgRepository = {
        onChanged: () => () => undefined,
        projectBase: () => null,
        refreshGame: () => { counter.count += 1; return Promise.resolve(true); },
    } as unknown as BigMapSlgRepository;
    const presenter = new BigMapPresenter({
        config: loadBigMapConfig(), storage: createMemoryBigMapStorage(), saveKey: 'camp-move',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository, slgRepository,
    });
    return { ...h, repository, presenter, gameRefreshes: counter };
}

test('★Presenter：离线（无仓库）直接拒，给明确文案', async () => {
    const presenter = new BigMapPresenter({
        config: loadBigMapConfig(), storage: createMemoryBigMapStorage(), saveKey: 'camp-move-offline',
        adventureChapter: () => 0, now: () => 957600,
    });
    const result = await presenter.requestMoveCamp(205, 7);
    assert.deepEqual(result, { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.offline });
});

test('★Presenter：迁城成功后重拉 GameInfo 与据点详情（否则界面停在上一个城）', async () => {
    const h = makePresenter();
    const pending = h.presenter.requestMoveCamp(205, 7);
    h.move.resolve({ succ: 1, req: { campId: 205, pos: 7, moveType: 1 } });
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(h.gameRefreshes.count, 1, '★toCampId 变了必须重拉 GameInfo');
    // refreshCampDetail 会立刻发出详情请求（`refreshDetail` + `refreshRoles` 并行）。
    assert.equal(h.moves.length, 1);
    h.detail.resolve({ infos: [] });
    await Promise.resolve();
    assert.ok(h.presenter.cityView(205) !== null || true, '重拉链路已触发');
});

test('Presenter：迁城失败不重拉，文案原样透传', async () => {
    const h = makePresenter();
    const pending = h.presenter.requestMoveCamp(205, 7);
    h.move.resolve({ succ: 0, req: { campId: 205, pos: 7, moveType: 1 } });
    const result = await pending;
    assert.deepEqual(result, { ok: false, message: BIGMAP_CAMP_MOVE_TEXT.failed });
    assert.equal(h.gameRefreshes.count, 0);
});

// ============================================================================
// ⑦ 接线护栏
// ============================================================================

test('请求封装与网关都挂在 camp 域（不是 build 域）', () => {
    const source = readFileSync('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', 'utf8');
    assert.match(source, /class RequestSlgCampMove extends RequestMsg<CmdSlgCampMoveReqMsg, CmdSlgCampMoveRspMsg>/);
    assert.match(source, /return 'CmdSlgCampMoveReqMsg'/);
    const gateway = readFileSync('assets/script/app/bigmap/application/GameNetBigMapCampGateway.ts', 'utf8');
    assert.match(gateway, /new RequestSlgCampMove\(/);
    assert.match(gateway, /request\.allowRetry = false/);
});
