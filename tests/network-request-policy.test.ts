import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

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
    packageRequest(index: number, data: Uint8Array, msg: object, loading: boolean): void;
}
interface IState {
    socket: object;
    addNetworkRequest(request: IRequest): boolean;
    update(delta: number): void;
    DoReconnectNet(): void;
    onReceiveMessage(data: Uint8Array): void;
}
interface ISocket {
    state: IState;
    isSending: boolean;
    tlRequest: IRequest[];
    addNetworkRequest(request: IRequest): void;
    sendData(): Promise<boolean>;
    ReconnectNetStateToRestoreRequest(request: IRequest): void;
}

function harness() {
    let sent = 0;
    let cacheUpdates = 0;
    const fw = { FW: { ignoreShowloadingNet: [], Task: { delay: async () => {} },
        CacheMgr: { handleCmdCache: () => { cacheUpdates++; } } } };
    const Request = load('assets/script/framework/net/NetworkRequest.ts', (name) =>
        name.endsWith('/FW') ? fw : { ScriptObject: class {} }).NetworkRequest as new () => IRequest;
    const Connected = load('assets/script/framework/net/state/ConnectedNetState.ts', (name) => {
        if (name.endsWith('/BaseNetState')) return { BaseNetState: class { isSwitchFinish = true; error() {} log() {} } };
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
    const makeRequest = (retry = true, canSend: (() => boolean) | null = null) => {
        const request = new Request();
        request.packageRequest(1, new Uint8Array([1]), { getReqMsgProtoName: () => 'TestReqMsg', allowRetry: retry, canSend }, false);
        return request;
    };
    return { socket, state, makeRequest, sent: () => sent, cacheUpdates: () => cacheUpdates };
}

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

test('已发送请求取消后迟到回包仍更新公共缓存，等待保持取消结果', async () => {
    const h = harness();
    const request = h.makeRequest();
    const pending = request.promise;
    h.state.addNetworkRequest(request);
    request.cancel();
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
