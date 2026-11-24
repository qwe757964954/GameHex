import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { sendGameRequest, sendGameRequestResult, withTimeout } from '../assets/script/app/net/RequestGuard';
import type { GameRequestStatus, IGameRequestOptions } from '../assets/script/app/net/RequestGuard';
import { TMap } from '../assets/script/framework/collection/TMap';

function load(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    } }).outputText, { exports, require, window: {}, console: { log() {}, error() {} }, Date });
    return exports;
}

interface IRequest {
    data: Uint8Array | null;
    allowRetry: boolean;
    canSend: (() => boolean) | null;
    promise: Promise<boolean>;
    cancel(): void;
    resolve(response: unknown): void;
    packageRequest(index: number, data: Uint8Array, msg: object, loading: boolean): void;
}

test('唯一结果订阅者解绑后，旧请求不会把结果派发给下一位订阅者', async () => {
    const Proxy = load('assets/script/framework/event/EventProxy.ts', name => {
        if (name.endsWith('/TMap')) return { TMap };
        return { ScriptObject: class { destroyed = false; assert(value: unknown) { assert.ok(value); } } };
    }).EventProxy as typeof import('../assets/script/framework/event/EventProxy').EventProxy;
    const events = new Proxy<string>();
    const GameNet = load('assets/script/app/net/GameNet.ts', name => {
        if (name.endsWith('/NetSocket')) return { NetSocket: { msgEventProxy: events } };
        if (name.endsWith('/RequestGuard')) return { sendGameRequestResult };
        return { ScriptObject: class {} };
    }).GameNet as typeof import('../assets/script/app/net/GameNet').GameNet;

    let finish!: (ok: boolean) => void;
    let cancelCount = 0;
    Object.assign(GameNet.instance, {
        _netSocket: { isSocketConnected: true },
        send: () => Object.assign(new Promise<boolean>(resolve => { finish = resolve; }), {
            cancel() { cancelCount++; },
        }),
    });
    const received: Array<string | null> = [];
    const screen = {};
    const nextScreen = {};
    GameNet.instance.addEvent('response', screen, (data: string | null) => received.push(data));
    let respond!: (data: string) => void;
    const pending = GameNet.requestResult<string, string>(receive => {
        respond = receive;
        return {};
    }, { event: 'response', decode: data => data });
    GameNet.instance.removeCaller(screen);
    GameNet.instance.addEvent('response', nextScreen, (data: string | null) => received.push(data));
    respond('旧回包');
    finish(true);
    assert.equal(await pending, null);
    assert.equal(cancelCount, 1);
    assert.deepEqual(received, []);
});
interface IState {
    socket: object;
    addNetworkRequest(request: IRequest): boolean;
    update(delta: number): void;
    DoReconnectNet(): void;
    onReceiveMessage(data: Uint8Array): void;
}
interface ISocket {
    state: IState | null;
    isSending: boolean;
    tlRequest: IRequest[];
    addNetworkRequest(request: IRequest): void;
    sendData(): Promise<boolean>;
    ReconnectNetStateToRestoreRequest(request: IRequest): void;
}

function harness(delay: () => Promise<void> = async () => {}) {
    let sent = 0;
    let cacheUpdates = 0;
    const tips: string[] = [];
    /** `ConnectedNetState.log` 实际打出的每一行（`recived` 的回包耗时就在里面）。 */
    const logs: string[] = [];
    const fw = { FW: { ignoreShowloadingNet: [], Task: { delay }, showTip: (tip: string) => tips.push(tip),
        CacheMgr: { handleCmdCache: () => { cacheUpdates++; } } } };
    const Request = load('assets/script/framework/net/NetworkRequest.ts', (name) =>
        name.endsWith('/FW') ? fw : { ScriptObject: class {} }).NetworkRequest as new () => IRequest;
    const Connected = load('assets/script/framework/net/state/ConnectedNetState.ts', (name) => {
        if (name.endsWith('/BaseNetState')) return { BaseNetState: class {
            isSwitchFinish = true; error() {} warn() {}
            log(...args: unknown[]) { logs.push(args.join(' ')); }
        } };
        if (name.endsWith('/TDic')) return { TDic: class extends Map { remove(key: unknown) { this.delete(key); } } };
        if (name.endsWith('/NetSocket')) return { NetSocket: { heartbeatMsgName: 'heartbeat', msgEventProxy: { execute() {} } } };
        if (name.endsWith('/FW')) return fw;
        return {};
    }).ConnectedNetState as new () => IState;
    const Socket = load('assets/script/framework/net/NetSocket.ts', (name) => {
        if (name.endsWith('/ConnectedNetState')) return { ConnectedNetState: Connected };
        if (name.endsWith('/NetSocketBase')) return { NetSocketBase: class {
            tmState = new Map(); state: IState | null = null;
            getState() { return this.state; }
            sendMessage() { sent += 1; return true; }
            error() {}
        } };
        if (name.endsWith('/EventProxy')) return { EventProxy: class { addListener() {} } };
        if (name.endsWith('/TaskQueue')) return { TaskQueue: class {} };
        if (name.endsWith('/FW')) return fw;
        return {};
    }).NetSocket as new (name: string, container: object) => ISocket;
    const socket = new Socket('test', {});
    const state = new Connected();
    socket.state = state;
    state.socket = socket;
    let requestIndex = 0;
    const makeRequest = (retry = true, canSend: (() => boolean) | null = null) => {
        const request = new Request();
        request.packageRequest(++requestIndex, new Uint8Array([1]), { getReqMsgProtoName: () => 'TestReqMsg', allowRetry: retry, canSend }, false);
        return request;
    };
    return { socket, state, makeRequest, Request, sent: () => sent, cacheUpdates: () => cacheUpdates, logs, tips };
}

test('只有巡逻宝箱升级把服务端的金币不足显示为银币不足', async () => {
    const requestMsg = load('assets/script/framework/net/RequestMsg.ts', () => ({ ScriptObject: class {} }));
    const territoryTexts = await import('../assets/script/app/territory/application/TerritoryTexts');
    const { RequestTerritoryUpMonsterBoxLv } = load(
        'assets/script/app/territory/application/RequestTerritoryCellInfoMsg.ts',
        name => name.endsWith('/TerritoryTexts') ? territoryTexts : requestMsg,
    ) as { RequestTerritoryUpMonsterBoxLv: new (data: object) => object };
    const h = harness();
    const cases = [
        { msg: new RequestTerritoryUpMonsterBoxLv({ levelChapter: 1, cellId: 346 }), tip: '金币不足' },
        { msg: new RequestTerritoryUpMonsterBoxLv({ levelChapter: 1, cellId: 346 }), tip: '已达失败上限' },
        { msg: { getReqMsgProtoName: () => 'OtherReqMsg' }, tip: '金币不足' },
    ];
    for (const [index, { msg, tip }] of cases.entries()) {
        const request = new h.Request();
        request.packageRequest(index + 1, new Uint8Array([1]), msg, false);
        const pending = request.promise;
        h.state.addNetworkRequest(request);
        Object.assign(h.socket, {
            receiveMsgAfterSend() {},
            protoMgr: {
                decode: () => ({ clientIndex: index + 1, result: false, messageIds: [], data: new Uint8Array() }),
                decodeDataByName: () => ({ content: tip }),
            },
        });
        h.state.onReceiveMessage(new Uint8Array());
        assert.equal(await pending, false);
    }
    assert.deepEqual(h.tips, ['银币不足', '已达失败上限', '金币不足']);
});

test('取消排队请求立即结束等待，不发送；同队列下一条仍能发出', async () => {
    const h = harness();
    const cancelled = h.makeRequest();
    const pending = cancelled.promise;
    const next = h.makeRequest();
    h.socket.isSending = true;
    h.socket.addNetworkRequest(cancelled);
    h.socket.addNetworkRequest(next);
    cancelled.cancel();
    assert.equal(await pending, false);
    h.socket.isSending = false;
    await h.socket.sendData();
    assert.equal(h.sent(), 1);
    assert.equal(h.socket.tlRequest.length, 0);
});

test('发送间隙断线保留待发请求，重连后按原顺序发送并结束等待', async () => {
    let resume: () => void = () => {};
    const gap = new Promise<void>(resolve => { resume = resolve; });
    let firstDelay = true;
    const h = harness(() => {
        if (!firstDelay) return Promise.resolve();
        firstDelay = false;
        return gap;
    });
    const requests = [h.makeRequest(), h.makeRequest(), h.makeRequest()];
    const pending = requests.map(request => request.promise);
    h.socket.isSending = true;
    for (const request of requests) h.socket.addNetworkRequest(request);
    h.socket.isSending = false;
    const draining = h.socket.sendData();
    assert.equal(h.sent(), 1);
    h.socket.state = null;
    resume();
    await draining;
    assert.equal(h.socket.tlRequest.length, 2);
    assert.equal(h.socket.tlRequest[0], requests[1]);
    assert.equal(h.socket.tlRequest[1], requests[2]);
    assert.equal(h.socket.isSending, false);
    h.socket.state = h.state;
    await h.socket.sendData();
    assert.equal(h.sent(), 3);
    assert.equal(h.socket.tlRequest.length, 0);
    for (const request of requests) request.resolve({});
    assert.deepEqual(await Promise.all(pending), [true, true, true]);
});

test('已发送请求取消后迟到回包仍更新公共缓存，等待保持取消结果', async () => {
    const h = harness();
    const request = h.makeRequest();
    const pending = request.promise;
    h.state.addNetworkRequest(request);
    await withTimeout(pending, 0, () => false);
    assert.equal(await pending, false);
    Object.assign(h.socket, { protoMgr: {
        decode: () => ({ clientIndex: 1, result: true, cmdCaches: [{}], messageIds: [1], splits: [0], data: new Uint8Array() }),
        getRspMsg: () => 'TestRspMsg', decodeDataById: () => ({}), isBro: () => false, isCacheApp: () => false,
    } });
    h.state.onReceiveMessage(new Uint8Array());
    assert.equal(h.cacheUpdates(), 1);
    assert.equal(await pending, false);
    assert.equal(h.sent(), 1);
});

test('GameNet request 统一连接判定与超时取消，send 和 sendNow 保留真实请求取消能力', async () => {
    const Request = load('assets/script/framework/net/NetworkRequest.ts', (name) =>
        name.endsWith('/ScriptObject') ? { ScriptObject: class {} } : {}).NetworkRequest;
    const Proxy = { addCallerCleanup: () => () => {} };
    interface IGameNet {
        request(msg: object, options?: IGameRequestOptions): Promise<GameRequestStatus>;
        send(msg: object): Promise<boolean> & { cancel?: () => void };
        sendNow(msg: object): Promise<boolean> & { cancel?: () => void };
    }
    const GameNet = load('assets/script/app/net/GameNet.ts', (name) => {
        if (name.endsWith('/NetworkRequest')) return { NetworkRequest: Request };
        if (name.endsWith('/NetSocket')) return { NetSocket: { msgEventProxy: Proxy } };
        if (name.endsWith('/ScriptObject')) return { ScriptObject: class { log() {} error() {} } };
        if (name.endsWith('/FW')) return { FW: { ignoreShowloadingNet: [] } };
        if (name.endsWith('/RequestGuard')) return { sendGameRequest };
        return {};
    }).GameNet as new () => IGameNet;
    const net = new GameNet();
    let queued: IRequest | null = null;
    const socket = { isSocketConnected: false, addNetworkRequest: (request: IRequest) => {
        queued = request;
        return true;
    } };
    Object.assign(net, { _netSocket: socket,
        _protoMgr: { getMessageId: () => 1, encode: () => new Uint8Array() } });
    const message = { getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true };
    assert.equal(await net.request(message), 'offline');
    assert.equal(queued, null);
    socket.isSocketConnected = true;
    const completed = net.request(message);
    queued!.resolve({});
    assert.equal(await completed, 'ok');
    assert.equal(await net.request(message, { timeoutMs: 0 }), 'failed');
    assert.equal(queued!.allowRetry, false);
    socket.isSocketConnected = false;
    queued = null;
    assert.equal(await net.request(message), 'offline');
    assert.equal(queued, null);
    for (const method of ['send', 'sendNow'] as const) {
        const pending = net[method]({ getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true });
        assert.equal(typeof pending.cancel, 'function');
        assert.equal(await withTimeout(pending, 0, () => false), false);
        assert.equal(queued!.allowRetry, false);
        assert.equal(await pending, false);
    }
    Object.assign(net, { _netSocket: { addNetworkRequest: (request: IRequest) => { queued = request; return false; } } });
    const retryable = net.sendNow({ getReqMsgProtoName: () => 'TestReqMsg', allowRetry: true });
    assert.equal(queued!.allowRetry, true, '暂时发送失败时保留传输层默认重试，直到到达请求期限');
    assert.equal(await withTimeout(retryable, 0, () => false), false);
    assert.equal(queued!.allowRetry, false);
    Object.assign(net, { _protoMgr: { getMessageId: () => 0 } });
    await assert.rejects(net.send({ getReqMsgProtoName: () => 'UnknownReqMsg' }), /协议编码失败/);
    Object.assign(net, { _netSocket: socket });
    socket.isSocketConnected = true;
    assert.equal(await net.request(message), 'failed');
});

test('recived 日志带「发出 → 回包」的耗时，没有对应请求的推送包标 push', () => {
    const h = harness();
    const request = h.makeRequest();
    h.state.addNetworkRequest(request);
    Object.assign(h.socket, { protoMgr: {
        decode: () => ({ clientIndex: 1, result: true, cmdCaches: [], messageIds: [1], splits: [0], data: new Uint8Array() }),
        getRspMsg: () => 'TestRspMsg', decodeDataById: () => ({}), isBro: () => false, isCacheApp: () => false,
    } });

    h.state.onReceiveMessage(new Uint8Array());
    assert.match(h.logs[h.logs.length - 1] ?? '', /recived TestRspMsg 1 .* cost \d+ms$/,
        '回包必须带上 sentAt → now 的真实差值');

    // 同一个 clientIndex 已经 requestMap.delete，这条当推送处理：不能拿累计时钟凑一个假耗时。
    h.state.onReceiveMessage(new Uint8Array());
    assert.match(h.logs[h.logs.length - 1] ?? '', /push$/, '广播 / 缓存推送没有对应请求，应标 push');
});

test('禁止重试的请求经过真实NetworkRequest与Connected状态，超时只失败不再次发送', async () => {
    const h = harness();
    const request = h.makeRequest(false);
    const pending = request.promise;
    h.state.addNetworkRequest(request);
    h.state.update(3001);
    assert.equal(h.sent(), 1);
    assert.equal(await pending, false);
});

test('禁止重试的已发送请求不会在重连时回到发送队列，默认请求仍恢复', async () => {
    const h = harness();
    const request = h.makeRequest(false);
    const pending = request.promise;
    h.state.addNetworkRequest(request);
    h.state.DoReconnectNet();
    assert.equal(h.socket.tlRequest.length, 0);
    assert.equal(await pending, false);
    const normal = h.makeRequest();
    h.state.addNetworkRequest(normal);
    h.state.DoReconnectNet();
    assert.equal(h.socket.tlRequest.length, 1);
});

test('请求排队后身份过期，实际发送前拒绝，Socket不向服务端发包', async () => {
    const h = harness();
    let current = true;
    const request = h.makeRequest(false, () => current);
    const pending = request.promise;
    h.socket.isSending = true;
    h.socket.addNetworkRequest(request);
    current = false;
    h.socket.isSending = false;
    await h.socket.sendData();
    assert.equal(h.sent(), 0);
    assert.equal(await pending, false);
});

test('默认可重试请求沿用旧的超时重发行为', () => {
    const h = harness();
    const request = h.makeRequest();
    h.state.addNetworkRequest(request);
    h.state.update(3001);
    assert.equal(h.sent(), 2);
});


test('GM 请求复用共享入口：离线不发送，列表成功或失败都只通知一次', async () => {
    let sends = 0;
    const net = { isConnected: false, ok: true, async send(request: { fCallback(rsp: unknown): void }) {
        sends++;
        if (this.ok) request.fCallback({ cmd: [{ cmd: 'serverOnly', desc: '服务器指令' }] });
        return this.ok;
    } };
    class Request {
        constructor(_body: object, _owner: object, readonly fCallback: (rsp: unknown) => void) {}
    }
    const table = load('assets/script/app/gm/GMCommandTable.ts', name => {
        if (name.endsWith('/GameNet')) return { GameNet: {
            sendRequest: (make: () => unknown, options?: unknown) => sendGameRequest(net, make, options),
            instance: net,
        } };
        if (name.endsWith('/RequestGuard')) return { sendGameRequest };
        if (name.endsWith('/RequestSystemMsg')) return { RequestGmList: Request, RequestSystemGm: Request };
        return {};
    }).GMCommandTable as typeof import('../assets/script/app/gm/GMCommandTable').GMCommandTable;
    const tips: string[] = [];
    table.onTip = tip => tips.push(tip);
    assert.equal(await table.execute('serverOnly'), false);
    assert.equal(sends, 0);
    assert.match(tips[0], /未连接/);
    let calls = 0;
    const list = () => new Promise<ReturnType<typeof table.getCommandList>>(resolve => table.requestServerList(items => {
        calls++;
        resolve(items);
    }));
    assert.equal((await list()).length, 0);
    assert.equal(calls, 1);
    assert.equal(sends, 0);
    net.isConnected = true;
    assert.equal((await list())[0].gm, 'serverOnly');
    assert.equal(calls, 2);
    net.ok = false;
    assert.equal((await list())[0].gm, 'serverOnly');
    assert.equal(calls, 3);
    assert.equal(sends, 2);
});

test('发送泵在队列清空后立即复位 isSending，不产生无谓等待，后续请求立即发出', async () => {
    let delays = 0;
    const h = harness(async () => {
        delays++;
    });
    const req1 = h.makeRequest();
    // 首次入队单条请求
    h.socket.addNetworkRequest(req1);
    // sendData 是 async，等待其微任务执行完
    await Promise.resolve();
    assert.equal(h.sent(), 1, '第一条请求立即发出');
    assert.equal(h.socket.tlRequest.length, 0, '队列已清空');
    assert.equal(h.socket.isSending, false, '队列清空后 isSending 必须立即为 false');
    assert.equal(delays, 0, '单条请求发完即止，不触发任何 delay 等待');

    // 此时后续新请求到来，必须立即发出而不能被 isSending 锁住
    const req2 = h.makeRequest();
    h.socket.addNetworkRequest(req2);
    await Promise.resolve();
    assert.equal(h.sent(), 2, '后续新请求立即发出');
    assert.equal(h.socket.isSending, false, '第二条发完后 isSending 仍为 false');
    assert.equal(delays, 0, '无并发排队时不产生 delay');
});

test('发送泵批量排队时按微任务连续发空，末尾请求发完后不空等', async () => {
    let delays = 0;
    const h = harness(async () => {
        delays++;
    });
    const req1 = h.makeRequest();
    const req2 = h.makeRequest();
    const req3 = h.makeRequest();
    h.socket.isSending = true; // 暂锁，批量推入
    h.socket.addNetworkRequest(req1);
    h.socket.addNetworkRequest(req2);
    h.socket.addNetworkRequest(req3);
    h.socket.isSending = false;

    await h.socket.sendData();
    assert.equal(h.sent(), 3, '3 条请求全部发出');
    assert.equal(h.socket.tlRequest.length, 0, '队列完全排空');
    assert.equal(h.socket.isSending, false, '发完后 isSending 复位');
    assert.equal(delays, 2, '3 条请求之间仅产生 2 次间隙调度，末尾请求不产生第 3 次 delay');
});
