import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as guards from '../assets/script/app/net/RequestGuard';
import { CmdRankType } from '../assets/script/app/generated/netProto/CmdInterface';

function load(path: string, require: (id: string) => unknown) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, require, Date });
    return exports;
}

function harness(timeout = 50) {
    const pending: { request: any; finish(ok: boolean, rsp?: object): void }[] = [];
    let current = true;
    const net = {
        isConnected: true,
        removeCaller(caller: object) {
            for (const row of [...pending]) if (row.request.caller === caller) row.finish(false);
        },
        send(request: any) {
            return new Promise<boolean>((resolve) => {
                const row = { request, finish(ok: boolean, rsp?: object) {
                    const index = pending.indexOf(row);
                    if (index < 0) return;
                    pending.splice(index, 1);
                    if (rsp) request.fCallback(rsp);
                    request.fCallback = null;
                    resolve(ok);
                } };
                pending.push(row);
            });
        },
    };
    const requests = load('assets/script/app/generated/requestMsg/RequestRankMsg.ts', () => ({
        RequestMsg: class {
            constructor(public cmdReqMsg: object, public caller: object, public fCallback: Function) {}
        },
    }));
    const module = load('assets/script/app/bigmap/application/RemoteBigMapRankProvider.ts', (id) => {
        if (id.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (id.endsWith('/RequestGuard')) return guards;
        if (id.endsWith('/RequestRankMsg')) return requests;
        if (id.endsWith('/CmdInterface')) return { CmdRankType };
        return {};
    });
    return { net, pending, provider: new module.RemoteBigMapRankProvider('9007199254740993', () => current, timeout),
        switchOwner: () => { current = false; } };
}

test('真实排行请求使用53/type城池/50条，解析昵称、头像、Long积分与榜外个人名次', async () => {
    const h = harness();
    const task = h.provider.fetchCityRank(71001);
    const req = h.pending[0].request;
    assert.equal(req.getReqMsgProtoName(), 'CmdGetRankReqMsg');
    assert.deepEqual({ ...req.cmdReqMsg }, { rankType: 53, showNum: 50, type: 71001 });
    assert.equal(req.caller, h.provider);
    assert.equal(req.canSend(), true);
    h.pending[0].finish(true, { rankInfo: {
        rankList: [{ rank: 1, roleId: '9007199254740992', roleName: '第一名', roleImg: '1001', value: { low: 1234, high: 0 } }],
        myRank: { rank: 51, roleId: '9007199254740993', roleName: '我', value: '200' },
    } });
    const board = await task;
    assert.equal(board.entries[0].name, '第一名');
    assert.equal(board.entries[0].avatarId, '1001');
    assert.equal(board.entries[0].isPlayer, false, '相邻大整数角色ID不可用number比较');
    assert.equal(board.topWarScore, 1234);
    assert.equal(board.playerRank, 51);
    assert.equal(board.playerWarScore, 200);
});

test('空榜和未上榜保留服务器事实，不编造第一名', async () => {
    const h = harness();
    const task = h.provider.fetchCityRank(101);
    h.pending[0].finish(true, { rankInfo: { rankList: [], myRank: { rank: -1, roleId: '9007199254740993', value: 0 } } });
    const board = await task;
    assert.equal(board.entries.length, 0);
    assert.equal(board.playerRank, 0);
    assert.equal(board.playerWarScore, 0);
});

test('同城去重，换城取消旧请求，关页释放回调并使等待落定', async () => {
    const h = harness();
    const old = h.provider.fetchCityRank(101);
    assert.equal(h.provider.fetchCityRank(101), old);
    const next = h.provider.fetchCityRank(102);
    assert.equal(await old, null);
    assert.equal(h.pending.length, 1);
    h.provider.dispose();
    assert.equal(await next, null);
    assert.equal(h.pending.length, 0);
    assert.equal(await h.provider.fetchCityRank(102), null);
});

test('超时释放底层请求；断线、换号、失败和缺少rankInfo返回空结果', async () => {
    const h = harness(5);
    assert.equal(await h.provider.fetchCityRank(101), null);
    assert.equal(h.pending.length, 0);
    let task = h.provider.fetchCityRank(101);
    h.pending[0].finish(true, {});
    assert.equal(await task, null);
    task = h.provider.fetchCityRank(101);
    h.pending[0].finish(false);
    assert.equal(await task, null);
    task = h.provider.fetchCityRank(101);
    h.switchOwner();
    h.pending[0].finish(true, { rankInfo: { rankList: [] } });
    assert.equal(await task, null);
    assert.equal(await h.provider.fetchCityRank(101), null);
    h.net.isConnected = false;
    assert.equal(await h.provider.fetchCityRank(101), null);
});
