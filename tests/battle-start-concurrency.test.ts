import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { sendGameRequestResult, withTimeout, toCount, type CancellableRequest, type IGameRequestResultOptions } from '../assets/script/app/net/RequestGuard';
import * as BattleStartModel from '../assets/script/app/battle/BattleStartModel';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

function slgFixture() {
    const sent: Array<{ cmdReqMsg: { startBattleInfo: { battleType: number; battleParams: string[] } };
        allowRetry?: boolean; reply: (response: unknown) => void }> = [];
    let finishSend: (ok: boolean) => void = () => {};
    let cancellations = 0;
    class RequestStartBattle {
        constructor(public cmdReqMsg: typeof sent[number]['cmdReqMsg'], _caller: unknown, public reply: (rsp: unknown) => void) {
            sent.push(this);
        }
    }
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/battle/BattleStartService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
        exports, console,
        require: (name: string) => {
            if (name === '../generated/requestMsg/RequestBattleMsg') return { RequestStartBattle };
            if (name === '../net/GameNet') {
                const instance = { isConnected: true,
                    send: () => Object.assign(new Promise<boolean>(resolve => { finishSend = resolve; }), {
                        cancel: () => { cancellations++; },
                    }) };
                return { GameNet: { requestResult: (
                    make: ((receive: (response: unknown) => void) => unknown) | null,
                    options: IGameRequestResultOptions<unknown, unknown>,
                ) => sendGameRequestResult(instance, make, options,
                    (event, battle) => EventMgr.instance.emit(event, battle)) } };
            }
            if (name === '../net/RequestGuard') return { withTimeout, toCount };
            if (name === './BattleStartModel') return { ...BattleStartModel, normalizeBattleStart: (rsp: unknown) => rsp };
            throw new Error(`Unstubbed import: ${name}`);
        },
    });
    return { sent, complete: (ok = true) => finishSend(ok),
        request: exports.requestBattleStart as (type: number, params: string[]) => CancellableRequest<unknown>,
        last: exports.getLastBattleStart as () => unknown,
        get cancellations() { return cancellations; },
    };
}

test('网络只发布战斗结果，取消旧请求后可以立即开始新一轮', async t => {
    const listener = {};
    const events: unknown[] = [];
    EventMgr.instance.on(BattleStartModel.BATTLE_START_SETTLED, battle => events.push(battle), listener);
    t.after(() => EventMgr.instance.offTarget(listener));
    const f = slgFixture();
    const old = f.request(1001, []);
    old.cancel();
    const next = f.request(1001, []);
    assert.notEqual(old, next);
    f.sent[0].reply({ battleId: 'late' });
    assert.equal(await old, null);
    assert.equal(f.cancellations, 1);
    assert.deepEqual(events, []);

    const battle = { battleId: 'confirmed' };
    f.sent[1].reply(battle);
    f.complete();
    assert.equal(await next, battle);
    assert.deepEqual(events, [battle]);

    const rejected = f.request(1002, ['2']);
    f.complete(false);
    assert.equal(await rejected, null);
    assert.deepEqual(events, [battle, null]);
    assert.equal(f.last(), battle);
});

test('SLG 开战使用字符串业务参数且不重发，取消后不消费回包', async () => {
    for (const [type, id] of [[1003, 8001], [1004, 205]]) {
        const f = slgFixture();
        const pending = f.request(type, [String(id)]);
        assert.equal(f.sent[0].allowRetry, false);
        assert.equal(f.sent[0].cmdReqMsg.startBattleInfo.battleType, type);
        assert.equal(f.sent[0].cmdReqMsg.startBattleInfo.battleParams[0], String(id));
        pending.cancel();
        f.sent[0].reply({ battleId: 'late', startBattleInfo: { battleType: type, battleParams: [String(id)] } });
        f.complete();
        assert.equal(await pending, null);
        assert.equal(f.last(), null);
    }
});

test('SLG 回包类型或参数不匹配时拒绝进入战斗', async () => {
    for (const [responseType, responseId, expected] of [[1004, '205', true], [1003, '205', false], [1004, '50027', false]] as const) {
        const f = slgFixture();
        const pending = f.request(1004, ['205']);
        f.sent[0].reply({ battleId: 'slg-1', startBattleInfo: { battleType: responseType, battleParams: [responseId] } });
        f.complete();
        assert.equal(!!await pending, expected);
        assert.equal(f.last(), null);
    }
});

test('开战超时只发布一次空结果并取消网络请求', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const f = slgFixture();
    const listener = {};
    const events: unknown[] = [];
    EventMgr.instance.on(BattleStartModel.BATTLE_START_SETTLED, battle => events.push(battle), listener);
    context.after(() => EventMgr.instance.offTarget(listener));
    const pending = f.request(1004, ['205']);
    assert.equal(f.request(1004, ['205']), pending);
    context.mock.timers.tick(10000);
    assert.equal(await pending, null);
    assert.equal(f.cancellations, 1);
    f.sent[0].reply({ battleId: 'expired', startBattleInfo: { battleType: 1004, battleParams: ['205'] } });
    f.complete();
    await Promise.resolve();
    assert.equal(f.last(), null);
    assert.deepEqual(events, [null]);
});

test('同参数的开战共用请求，不同参数拒绝并发开战', async () => {
    const f = slgFixture();
    const first = f.request(1001, []);
    assert.equal(f.request(1001, []), first);
    assert.equal(await f.request(1002, ['1', '1', '2']), null);
    assert.equal(f.sent.length, 1);
    const battle = { battleId: 'pvp-1' };
    f.sent[0].reply(battle);
    f.complete();
    assert.equal(await first, battle);
});
