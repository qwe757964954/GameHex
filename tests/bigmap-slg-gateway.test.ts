import * as requestGuard from '../assets/script/app/net/RequestGuard';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as serverState from '../assets/script/app/bigmap/model/BigMapServerState';
import type { IBigMapSlgGateway } from '../assets/script/app/bigmap/application/BigMapSlgRepository';
import { sendGameRequest } from '../assets/script/app/net/RequestGuard';

function loadModule(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { exports, require });
    return exports;
}

/** 夹具里的请求对象；`fErrorCallback` 由网关在构造之后挂上。 */
type FakeRequest = {
    getReqMsgProtoName(): string; cmdReqMsg: Record<string, unknown>; caller: object;
    fCallback(rsp: unknown): void; fErrorCallback?: (reason: string | null) => void;
    allowRetry?: boolean; canSend?: () => boolean;
};

function harness() {
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapSlgMsg.ts', () => ({
        RequestMsg: class {
            constructor(public cmdReqMsg: object, public caller: object, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    let current = true;
    /** `undefined` = 正常回包；其余值模拟传输层 `onReject(reason)`：先回调 `fErrorCallback`，再以 `false` 落定。 */
    let rejectReason: string | null | undefined = undefined;
    const calls: { name: string; body: Record<string, unknown>; caller: object; allowRetry?: boolean; canSend?: () => boolean }[] = [];
    const removed: object[] = [];
    const events = new Map<string, () => void>();
    let onSend: (() => Promise<void>) | null = null;
    const net = {
        isConnected: true,
        async send(req: FakeRequest) {
            calls.push({ name: req.getReqMsgProtoName(), body: req.cmdReqMsg, caller: req.caller, allowRetry: req.allowRetry, canSend: req.canSend });
            if (onSend) await onSend();
            if (rejectReason !== undefined) {
                req.fErrorCallback?.(rejectReason);
                return false;
            }
            req.fCallback({ received: true });
            return true;
        },
        addEvent(name: string, _caller: unknown, listener: () => void) { events.set(name, listener); },
        removeCallerEvent() { events.clear(); },
        removeCaller(owner: object) { removed.push(owner); events.clear(); },
    };
    const exports = loadModule('assets/script/app/bigmap/application/GameNetBigMapSlgGateway.ts', (name) => {
        if (name.endsWith('/RequestGuard')) return requestGuard;
        if (name.endsWith('/GameNet')) return { GameNet: { sendRequest: function (make, options) { return sendGameRequest(this.instance, make, options); }, instance: net } };
        if (name === './RequestBigMapSlgMsg') return requests;
        if (name.endsWith('/BigMapServerState')) return serverState;
        return {};
    });
    const Gateway = exports.GameNetBigMapSlgGateway as new (isCurrent: () => boolean) => IBigMapSlgGateway;
    return { gateway: new Gateway(() => current), calls, events, net, removed, switchOwner: () => { current = false; },
        setSend: (handler: () => Promise<void>) => { onSend = handler; },
        rejectNext: (reason: string | null) => { rejectReason = reason; } };
}

test('页面退出统一解除真实网关宿主，禁止旧请求再次发送', async () => {
    const h = harness();
    assert.equal((await h.gateway.request('CmdSlgBuildInfoReqMsg', {})).status, 'ok');
    assert.equal(h.calls[0].caller, h.gateway);
    h.gateway.dispose?.();
    h.gateway.dispose?.();
    assert.deepEqual(h.removed, [h.gateway]);
    assert.equal(h.calls[0].canSend?.(), false);
    assert.equal((await h.gateway.request('CmdSlgBuildInfoReqMsg', {})).status, 'offline');
    assert.equal(h.calls.length, 1);
});

test('GameNet适配器将九组请求送入既有队列，原样发送uint32实例且保留0号位置', async () => {
    const h = harness();
    for (const name of ['CmdSlgActionUpdateReqMsg', 'CmdSlgGameInfoReqMsg', 'CmdSlgBuildInfoReqMsg'] as const) {
        const outcome = await h.gateway.request(name, {});
        //结论对象产自 vm 沙箱（原型不同），不能整包 deepEqual，按字段断言。
        assert.equal(outcome.status, 'ok');
        assert.deepEqual(outcome.status === 'ok' ? outcome.response : null, { received: true });
        assert.equal(h.calls.at(-1)?.name, name);
        assert.equal(h.calls.at(-1)?.allowRetry, true);
    }
    await h.gateway.request('CmdSlgBuildReqMsg', { buildingId: 71002, position: 0, instant: 0 });
    assert.equal(h.calls.at(-1)?.body.position, 0);
    assert.equal(h.calls.at(-1)?.allowRetry, false);
    assert.equal(h.calls.at(-1)?.canSend?.(), true);
    await h.gateway.request('CmdSlgBuildUpgradeReqMsg', { buildInstId: 0xffffffff, instant: 1 });
    assert.equal(h.calls.at(-1)?.name, 'CmdSlgBuildUpgradeReqMsg');
    assert.equal(h.calls.at(-1)?.body.buildInstId, 0xffffffff);
    for (const name of ['CmdSlgBuildCancelReqMsg', 'CmdSlgBuildMoveReqMsg'] as const) {
        await h.gateway.request(name, { buildInstId: 0xffffffff, position: 0 });
        assert.equal(h.calls.at(-1)?.name, name);
        assert.equal(h.calls.at(-1)?.body.buildInstId, 0xffffffff);
    }
    await h.gateway.request('CmdSlgBuildCollectReqMsg', { buildInstIds: [0xffffffff, 2] });
    assert.equal(h.calls.at(-1)?.name, 'CmdSlgBuildCollectReqMsg');
    assert.deepEqual(h.calls.at(-1)?.body.buildInstIds, [0xffffffff, 2]);
    await h.gateway.request('CmdSlgBuildUnlockQueueReqMsg', { queueId: 2 });
    assert.equal(h.calls.at(-1)?.body.queueId, 2);
});

test('所有建筑写请求拒绝超出uint32范围或非数字的实例ID，不编码截断', async () => {
    const h = harness();
    for (const id of [0, -1, 0x100000000, 1.5, NaN, '1', { low: 1, high: 0 }]) {
        for (const name of ['CmdSlgBuildUpgradeReqMsg', 'CmdSlgBuildCancelReqMsg', 'CmdSlgBuildMoveReqMsg'] as const) {
            await assert.rejects(h.gateway.request(name, { buildInstId: id as unknown as number, position: 0, instant: 0 }), /实例/);
        }
        await assert.rejects(h.gateway.request('CmdSlgBuildCollectReqMsg', { buildInstIds: [id] }), /实例/);
    }
    await assert.rejects(h.gateway.request('CmdSlgBuildCollectReqMsg', { buildInstIds: [] }), /实例/);
    assert.equal(h.calls.length, 0);
});

test('网关仅处理请求，切号后旧响应失效且不自行注册网络广播', async () => {
    const h = harness();
    assert.equal(h.events.size, 0);
    h.setSend(async () => { h.switchOwner(); });
    //回包到了，但宿主已不是当前存档：不交付，也不能当成「服务端拒绝」。
    assert.equal((await h.gateway.request('CmdSlgBuildInfoReqMsg', {})).status, 'unconfirmed');
    assert.equal(h.calls.at(-1)?.canSend?.(), false);
    const count = h.calls.length;
    assert.equal((await h.gateway.request('CmdSlgGameInfoReqMsg', {})).status, 'offline');
    assert.equal(h.calls.length, count);
    h.gateway.dispose();
    assert.equal(h.events.size, 0);
});

test('网络未连接不发送SLG写请求', async () => {
    const h = harness();
    h.net.isConnected = false;
    assert.equal((await h.gateway.request('CmdSlgBuildReqMsg', { buildingId: 71002, position: 0, instant: 0 })).status, 'offline');
    assert.equal(h.calls.length, 0);
});

test('服务端 CmdTips 拒绝（server_error）如实上报 rejected，不吞成「没回包」', async () => {
    const h = harness();
    const body = { buildingId: 71002, position: 0, instant: 0 };
    h.rejectNext('server_error');
    assert.equal((await h.gateway.request('CmdSlgBuildReqMsg', body)).status, 'rejected');
    assert.equal(h.calls.at(-1)?.allowRetry, false, '被拒绝的写请求照旧不重发');
    //其余失败原因各归其位：出队前取消 / socket 没收下 = 没发出去；协议超时 / 断线 = 发了没回音。
    const expected = [['cancelled', 'offline'], ['send fail', 'offline'], ['timeout', 'unconfirmed'], [null, 'unconfirmed']] as const;
    for (const [reason, status] of expected) {
        h.rejectNext(reason);
        assert.equal((await h.gateway.request('CmdSlgBuildReqMsg', body)).status, status, String(reason));
    }
});

test('切号后迟到的 server_error 不得按当前号服务端拒绝处理', async () => {
    const h = harness();
    h.rejectNext('server_error');
    h.setSend(async () => {
        h.switchOwner();
    });
    assert.equal((await h.gateway.request('CmdSlgBuildReqMsg', { buildingId: 71002, position: 0, instant: 0 })).status, 'unconfirmed');
});
