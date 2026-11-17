import * as requestGuard from '../assets/script/app/net/RequestGuard';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/cc-sandbox';
import type { RequestMsg } from '../assets/script/framework/net/RequestMsg';
import type { GameNetGuideGateway } from '../assets/script/app/guide/application/GuideGateway';
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';

type IRequest = RequestMsg<unknown, unknown>;

test('已发布的静态 protobuf 编解码支持完整查询/更新载荷及响应编号', () => {
    const cmd = protobufRoot.com.xkhy.tafang.cmd;
    const info = { funcId: 1, step1: 2, step2: 1 };
    for (const [name, payload] of [
        ['CmdFunctionGuideInfoReqMsg', { funcId: 1 }],
        ['CmdFunctionGuideInfoRspMsg', { infos: info }],
        ['CmdFunctionGuideUpdateReqMsg', { info }],
        ['CmdFunctionGuideUpdateRspMsg', { succ: 1 }],
    ] as const) {
        const codec = cmd[name];
        assert.equal(JSON.stringify(codec.decode(codec.encode(payload).finish())), JSON.stringify(payload));
    }
    assert.equal(cmd.MessageId.CmdFunctionGuideInfoRspMsg, 1416382725);
    assert.equal(cmd.MessageId.CmdFunctionGuideUpdateRspMsg, 799066198);
});

function harness(send: (request: IRequest) => Promise<boolean>) {
    const requestModule = loadTsModule<{ RequestMsg: new (...args: unknown[]) => IRequest }>(
        'assets/script/framework/net/RequestMsg.ts', { modules: { '/ScriptObject': { ScriptObject: class {} } } },
    );
    assert.deepEqual(requestModule.unresolved, []);
    const cancelled: object[] = [];
    const logs: unknown[][] = [];
    const net = { isConnected: true, send, removeCaller: (owner: object) => cancelled.push(owner) };
    const result = loadTsModule<{ GameNetGuideGateway: new () => GameNetGuideGateway }>(
        'assets/script/app/guide/application/GuideGateway.ts', {
            modules: { '/RequestGuard': requestGuard, '/RequestMsg': requestModule.exports, '/GameNet': { GameNet: { instance: net } } },
            globals: { console: { info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args) } },
        },
    );
    assert.deepEqual(result.unresolved, []);
    return { gateway: new result.exports.GameNetGuideGateway(), net, cancelled, logs };
}

test('查询与更新使用真实协议名、嵌套字段及请求归属，并输出原始回包', async () => {
    const sent: IRequest[] = [];
    const h = harness(async request => {
        sent.push(request);
        request.fCallback(request.getReqMsgProtoName().includes('Update') ? { succ: 1 } : { infos: { funcId: 1, step1: 2, step2: 1 } });
        return true;
    });
    assert.equal(JSON.stringify(await h.gateway.load()), JSON.stringify({ funcId: 1, step1: 2, step2: 1 }));
    assert.equal(await h.gateway.update('2-2'), 'ok');
    assert.deepEqual(sent.map(r => r.getReqMsgProtoName()), ['CmdFunctionGuideInfoReqMsg', 'CmdFunctionGuideUpdateReqMsg']);
    assert.equal(JSON.stringify(sent[0].cmdReqMsg), '{"funcId":1}');
    assert.equal(JSON.stringify(sent[1].cmdReqMsg), '{"info":{"funcId":1,"step1":2,"step2":2}}');
    assert.ok(sent.every(r => r.caller === h.gateway));
    assert.equal(sent[1].allowRetry, false);
    assert.ok(h.logs.some(row => String(row[0]).includes('查询原始回包')));
    assert.ok(h.logs.some(row => String(row[0]).includes('更新原始回包')));
    h.gateway.dispose();
    assert.deepEqual(h.cancelled, [h.gateway]);
});

test('快速推进等待查询结束，再按序更新，退出后取消在途与排队请求', async () => {
    const sent: IRequest[] = [];
    let finish: (ok: boolean) => void = () => {};
    const h = harness(request => {
        sent.push(request);
        return new Promise<boolean>(resolve => { finish = resolve; });
    });
    const load = h.gateway.load();
    const first = h.gateway.update('1-1');
    const second = h.gateway.update('1-2');
    assert.equal(sent.length, 1);
    sent[0].fCallback({ infos: { funcId: 1, step1: 0, step2: 0 } });
    finish(true);
    await load;
    await Promise.resolve();
    assert.equal(sent.length, 2);
    h.gateway.dispose();
    assert.equal(sent[1].canSend?.(), false);
    sent[1].fCallback({ succ: 1 });
    finish(false);
    assert.equal(await first, 'retry');
    assert.equal(await second, 'retry');
    assert.equal(sent.length, 2);
});

test('查询：0/0 视为从未开始，不返回可校正的游标', async () => {
    const h = harness(async r => { r.fCallback({ infos: { funcId: 1, step1: 0, step2: 0 } }); return true; });
    assert.equal(await h.gateway.load(), null);
    h.gateway.dispose();
});

test('查询校验 funcId/uint32；succ 非 1、断线和异常均返回可重试', async () => {
    for (const infos of [null, { funcId: 2, step1: 0, step2: 0 }, { funcId: 1, step1: -1, step2: 0 }, { funcId: 1, step1: 1.5, step2: 1 }]) {
        const h = harness(async r => { r.fCallback({ infos }); return true; });
        assert.equal(await h.gateway.load(), null);
        h.gateway.dispose();
    }
    const h = harness(async r => { r.fCallback({ succ: 0 }); return true; });
    assert.equal(await h.gateway.update('2-1'), 'retry');
    for (const id of ['skip', '', '0-0', '-1-1', '4294967296-1']) assert.equal(await h.gateway.update(id), 'invalid');
    h.net.isConnected = false;
    assert.equal(await h.gateway.load(), null);
    assert.equal(await h.gateway.update('2-1'), 'retry');
    const failing = harness(async () => { throw new Error('offline'); });
    assert.equal(await failing.gateway.load(), null);
    assert.equal(await failing.gateway.update('2-1'), 'retry');
    h.gateway.dispose();
    failing.gateway.dispose();
});
