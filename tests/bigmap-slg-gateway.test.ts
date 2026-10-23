import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as serverState from '../assets/script/app/bigmap/model/BigMapServerState';
import type { IBigMapSlgGateway } from '../assets/script/app/bigmap/application/BigMapSlgRepository';

function loadModule(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { exports, require });
    return exports;
}

function harness() {
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapSlgMsg.ts', () => ({
        RequestMsg: class {
            constructor(public cmdReqMsg: object, _caller: unknown, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    let current = true;
    const calls: { name: string; body: Record<string, unknown>; allowRetry?: boolean; canSend?: () => boolean }[] = [];
    const events = new Map<string, () => void>();
    let onSend: (() => Promise<void>) | null = null;
    const net = {
        isConnected: true,
        async send(req: { getReqMsgProtoName(): string; cmdReqMsg: Record<string, unknown>; fCallback(rsp: unknown): void;
            allowRetry?: boolean; canSend?: () => boolean }) {
            calls.push({ name: req.getReqMsgProtoName(), body: req.cmdReqMsg, allowRetry: req.allowRetry, canSend: req.canSend });
            if (onSend) await onSend();
            req.fCallback({ received: true });
            return true;
        },
        addEvent(name: string, _caller: unknown, listener: () => void) { events.set(name, listener); },
        removeCallerEvent() { events.clear(); },
    };
    const exports = loadModule('assets/script/app/bigmap/application/GameNetBigMapSlgGateway.ts', (name) => {
        if (name.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (name === './RequestBigMapSlgMsg') return requests;
        if (name.endsWith('/BigMapServerState')) return serverState;
        return {};
    });
    const Gateway = exports.GameNetBigMapSlgGateway as new (isCurrent: () => boolean) => IBigMapSlgGateway;
    return { gateway: new Gateway(() => current), calls, events, net, switchOwner: () => { current = false; },
        setSend: (handler: () => Promise<void>) => { onSend = handler; } };
}

test('GameNet适配器将九组请求送入既有队列，原样发送uint32实例且保留0号位置', async () => {
    const h = harness();
    for (const name of ['CmdSlgActionUpdateReqMsg', 'CmdSlgGameInfoReqMsg', 'CmdSlgBuildInfoReqMsg'] as const) {
        assert.ok(await h.gateway.request(name, {}));
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

test('切号后旧响应和广播无效，关闭解除两个广播及重连监听', async () => {
    const h = harness();
    const notifications: string[] = [];
    const unsubscribe = h.gateway.subscribe((kind) => notifications.push(kind));
    assert.equal(h.events.size, 3);
    h.events.get('CmdSlgGameInfoBroMsg')?.();
    h.events.get('CmdSlgBuildInfoBroMsg')?.();
    assert.deepEqual(notifications, ['game', 'build']);
    h.setSend(async () => { h.switchOwner(); });
    assert.equal(await h.gateway.request('CmdSlgBuildInfoReqMsg', {}), null);
    assert.equal(h.calls.at(-1)?.canSend?.(), false);
    h.events.get('CmdSlgBuildInfoBroMsg')?.();
    assert.equal(notifications.length, 2);
    const count = h.calls.length;
    assert.equal(await h.gateway.request('CmdSlgGameInfoReqMsg', {}), null);
    assert.equal(h.calls.length, count);
    unsubscribe();
    assert.equal(h.events.size, 0);
});

test('网络未连接不发送SLG写请求', async () => {
    const h = harness();
    h.net.isConnected = false;
    assert.equal(await h.gateway.request('CmdSlgBuildReqMsg', { buildingId: 71002, position: 0, instant: 0 }), null);
    assert.equal(h.calls.length, 0);
});
