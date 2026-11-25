import assert from 'node:assert/strict';
import test from 'node:test';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { LeagueRewardController } from '../assets/script/app/league/LeagueRewardController';
import { LeagueRewardEvent, type LeagueRewardAction, type ILeagueRewardCompletion } from '../assets/script/app/league/LeagueRewardEvents';
import type { ILeagueRepository, ILeagueRewardResult } from '../assets/script/app/league/LeagueRepository';
import { createControllerContext } from './helpers/controller-context';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as guards from '../assets/script/app/net/RequestGuard';
import * as leagueTable from '../assets/script/app/league/LeagueTable';
import { sendGameRequest } from '../assets/script/app/net/RequestGuard';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
    const owner = {};
    const calls: { method: string; args: unknown[]; resolve: (result: ILeagueRewardResult) => void; reject: (error: Error) => void }[] = [];
    const shown: CmdGoods[][] = [];
    const cancelled: object[] = [];
    const completions: ILeagueRewardCompletion[] = [];
    const repository = Object.fromEntries(['buyStoreGoods', 'requestBargain', 'requestTaskReward', 'requestTaskProgressReward', 'requestSweep']
        .map(method => [method, (...args: unknown[]) => new Promise<ILeagueRewardResult>((resolve, reject) => calls.push({ method, args, resolve, reject }))])) as unknown as ILeagueRepository;
    const controller = new LeagueRewardController(createControllerContext(), {
        owner, repository, feedback: { reward: goods => shown.push(goods) },
        requests: { removeCaller: caller => cancelled.push(caller) },
    });
    const observer = {};
    EventMgr.instance.on(LeagueRewardEvent.Completed, (event: ILeagueRewardCompletion) => completions.push({ ...event }), observer);
    controller.start();
    return { owner, controller, calls, shown, cancelled, completions,
        emit: (action: LeagueRewardAction) => EventMgr.instance.emit(LeagueRewardEvent.Intent, { action }),
        dispose: () => { controller.dispose(); EventMgr.instance.offTarget(observer); },
    };
}

test('奖励意图按会话发包，保留每种请求参数，非空成功奖励只展示一次', async () => {
    const h = fixture();
    try {
        const actions: LeagueRewardAction[] = [
            { kind: 'store', id: 12 }, { kind: 'bargain', buy: false }, { kind: 'bargain', buy: true },
            { kind: 'task', resId: 31 }, { kind: 'progress', subType: 2 }, { kind: 'sweep' },
        ];
        const methods = ['buyStoreGoods', 'requestBargain', 'requestBargain', 'requestTaskReward', 'requestTaskProgressReward', 'requestSweep'];
        for (const [index, action] of actions.entries()) {
            h.emit(action);
            h.emit(action);
            assert.equal(h.calls.length, index + 1, '在飞时不重复发包');
            const call = h.calls[index];
            assert.equal(call.method, methods[index]);
            assert.equal(call.args.at(-1), h.controller, '真实请求宿主是控制器');
            if (action.kind !== 'sweep') assert.equal(call.args[0], Object.values(action)[1]);
            const rewards = index === 1 ? [] : [{ resId: 11, number: '5' }] as unknown as CmdGoods[];
            call.resolve({ status: 'ok', rewards });
            await flush();
            assert.equal(h.completions.length, index + 1);
            assert.equal(h.completions[index].status, 'ok');
        }
        assert.equal(h.shown.length, 5, '砍价空奖励不弹窗');
    } finally { h.dispose(); }
});

test('失败或异常不展示奖励，释放写锁并发布失败结果', async () => {
    const h = fixture();
    try {
        for (const status of ['offline', 'failed'] as const) {
            h.emit({ kind: 'sweep' });
            h.calls.at(-1)!.resolve({ status, rewards: [] });
            await flush();
            assert.equal(h.completions.at(-1)!.status, status);
        }
        h.emit({ kind: 'sweep' });
        h.calls.at(-1)!.reject(new Error('network'));
        await flush();
        assert.equal(h.completions.at(-1)!.status, 'failed');
        assert.deepEqual(h.shown, []);
    } finally { h.dispose(); }
});

test('关闭会话取消真实宿主，迟到成功不展示、不发布完成事件；新会话正常工作', async () => {
    const h = fixture();
    h.emit({ kind: 'task', resId: 1 });
    h.controller.dispose();
    h.calls[0].resolve({ status: 'ok', rewards: [{}] as CmdGoods[] });
    await flush();
    assert.deepEqual(h.cancelled, [h.controller]);
    assert.deepEqual(h.shown, []);
    assert.deepEqual(h.completions, []);
    h.dispose();
    const fresh = fixture();
    try {
        fresh.emit({ kind: 'sweep' });
        fresh.calls[0].resolve({ status: 'ok', rewards: [] });
        await flush();
        assert.equal(fresh.completions.length, 1);
    } finally { fresh.dispose(); }
});

test('真实仓库只返回响应数据：无 ret 的商店、ret 失败、离线、非法参数和配置捐献奖励', async () => {
    const exports: Record<string, unknown> = {};
    let response: object = {};
    let sends = 0;
    class Message {
        constructor(readonly body: object, readonly caller: object, readonly onRsp: (rsp: object) => void) {}
    }
    const net = { isConnected: true, send: (msg: Message) => {
        sends++;
        msg.onRsp(response);
        return Promise.resolve(true);
    } };
    const requests = Object.fromEntries(['RequestShopBuy', 'RequestUnionDonate', 'RequestUnionBargain',
        'RequestTaskUnionGetReward', 'RequestTaskUnionGetProgressReward', 'RequestUnionActSweep'].map(name => [name, Message]));
    const source = readFileSync('assets/script/app/league/LeagueRepository.ts', 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, {
        exports, console,
        require: (id: string) => {
            if (id.endsWith('/FW')) throw new Error('Repository 不得访问展示端口');
            if (id.endsWith('/GameNet')) return { GameNet: { sendRequest: function (make, options) { return sendGameRequest(this.instance, make, options); }, instance: net } };
            if (id.endsWith('/RequestGuard')) return guards;
            if (id.endsWith('/RequestLeagueMsg')) return { ...requests, LeagueACT_TYPE: { NORTHERN_EXPEDITION: 3 }, LEAGUE_SHOP_TYPE_UNION: 8 };
            if (id.endsWith('/LeagueTable')) return leagueTable;
            return {};
        },
    });
    const Repository = exports.RuntimeLeagueRepository as new () => ILeagueRepository;
    const repository = new Repository();
    const rewards = [{ resId: 11, number: '5' }] as unknown as CmdGoods[];
    response = { tlCmdGoods: rewards };
    const shop = await repository.buyStoreGoods(1, {});
    assert.equal(shop.status, 'ok');
    assert.equal(shop.rewards, rewards, '商店协议没有 ret，不丢失实际奖励');
    for (const request of [() => repository.requestBargain(true), () => repository.requestTaskReward(1),
        () => repository.requestTaskProgressReward(2), () => repository.requestSweep()]) {
        response = { ret: true, tlCmdGoods: rewards };
        assert.equal((await request()).rewards, rewards);
        response = { ret: false, tlCmdGoods: rewards };
        const failed = await request();
        assert.equal(failed.status, 'failed');
        assert.equal(failed.rewards.length, 0);
    }
    Object.assign(repository, { donateGain: { coin: 300, exp: 10 } });
    response = { ret: true };
    for (const adv of [true, false]) {
        const donated = await repository.requestDonate(adv);
        assert.equal(donated.status, 'ok');
        assert.deepEqual(Array.from(donated.rewards, row => [row.resId, row.number]), [[11, '300'], [13, '10']]);
    }
    const previousSends = sends;
    net.isConnected = false;
    assert.equal((await repository.requestSweep()).status, 'offline');
    assert.equal((await repository.buyStoreGoods(0)).status, 'failed');
    assert.equal(sends, previousSends);
});
