import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { withTimeout, toCount } from '../assets/script/app/net/RequestGuard';
import * as BattleStartModel from '../assets/script/app/battle/BattleStartModel';

function slgFixture() {
    const sent: Array<{ cmdReqMsg: { startBattleInfo: { battleType: number; battleParams: string[] } };
        allowRetry?: boolean; canSend?: () => boolean; reply: (response: unknown) => void }> = [];
    let finishSend: (ok: boolean) => void = () => {};
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
            if (name === '../net/GameNet') return { GameNet: { instance: { isConnected: true,
                send: () => new Promise<boolean>(resolve => { finishSend = resolve; }),
            } } };
            if (name === '../net/RequestGuard') return { withTimeout, toCount };
            if (name === './BattleStartModel') return { ...BattleStartModel, normalizeBattleStart: (rsp: unknown) => rsp };
            throw new Error(`Unstubbed import: ${name}`);
        },
    });
    return { sent, complete: () => finishSend(true),
        start: exports.startBattle as (type: number, params: string[], caller?: unknown, isCurrent?: () => boolean) => Promise<unknown>,
        last: exports.getLastBattleStart as () => unknown,
    };
}

test('SLG 开战按字符串业务参数编码，禁止重发，关页迟到回包不缓存、不导航', async () => {
    for (const [type, id] of [[1003, 8001], [1004, 205]]) {
        const f = slgFixture();
        let current = true;
        const pending = f.start(type, [String(id)], undefined, () => current);
        assert.equal(f.sent[0].allowRetry, false);
        assert.equal(f.sent[0].cmdReqMsg.startBattleInfo.battleType, type);
        assert.equal(f.sent[0].cmdReqMsg.startBattleInfo.battleParams[0], String(id));
        assert.equal(f.sent[0].canSend?.(), true);
        current = false;
        assert.equal(f.sent[0].canSend?.(), false);
        f.sent[0].reply({ battleId: 'late', startBattleInfo: { battleType: type, battleParams: [String(id)] } });
        f.complete();
        assert.equal(await pending, null);
        assert.equal(f.last(), null);
    }
});

test('SLG 成功回包只交给当前调用者；类型或参数不匹配拒绝进入战斗', async () => {
    for (const [responseType, responseId, expected] of [[1004, '205', true], [1003, '205', false], [1004, '50027', false]] as const) {
        const f = slgFixture();
        const pending = f.start(1004, ['205'], undefined, () => true);
        f.sent[0].reply({ battleId: 'slg-1', startBattleInfo: { battleType: responseType, battleParams: [responseId] } });
        f.complete();
        assert.equal(!!await pending, expected);
        assert.equal(f.last(), null, 'SLG 结果直接通过 entry params 交接，不污染匹配缓存');
    }
});

test('SLG 超时后的旧回包与新页面不能共享同一在途请求', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const f = slgFixture();
    const pending = f.start(1004, ['205'], undefined, () => true);
    assert.equal(await f.start(1004, ['205'], undefined, () => true), null);
    context.mock.timers.tick(10000);
    assert.equal(await pending, null);
    assert.equal(f.sent[0].canSend?.(), false);
    f.sent[0].reply({ battleId: 'expired', startBattleInfo: { battleType: 1004, battleParams: ['205'] } });
    f.complete();
    await Promise.resolve();
    assert.equal(f.last(), null);
});

test('different battle requests cannot share one in-flight server response', async () => {
    const sent: Array<{ reply: (response: unknown) => void }> = [];
    let finishSend: ((ok: boolean) => void) | null = null;
    class RequestStartBattle {
        constructor(_request: unknown, _caller: unknown, reply: (response: unknown) => void) {
            sent.push({ reply });
        }
    }
    const source = readFileSync('assets/script/app/battle/BattleStartService.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        console,
        require: (name: string) => {
            if (name === '../generated/requestMsg/RequestBattleMsg') return { RequestStartBattle };
            if (name === '../net/GameNet') return { GameNet: { instance: {
                isConnected: true,
                send: () => new Promise<boolean>(resolve => { finishSend = resolve; }),
            } } };
            if (name === '../net/RequestGuard') return { withTimeout: (value: unknown) => value, toCount: Number };
            if (name === './BattleStartModel') return {
                ZC_BATTLE_TYPE_PVP: 1001,
                normalizeBattleStart: (response: unknown) => response,
            };
            throw new Error(`Unstubbed import: ${name}`);
        },
    });
    const startBattle = moduleExports.startBattle as (type: number, params: string[]) => Promise<unknown>;
    const first = startBattle(1001, []);
    assert.equal(startBattle(1001, []), first);
    const second = await startBattle(1002, ['1', '1', '2']);
    assert.equal(second, null);
    assert.equal(sent.length, 1);
    const reply = sent[0].reply;
    reply({ battleId: 'pvp-1' });
    assert.ok(finishSend);
    finishSend(true);
    assert.equal((await first as { battleId: string }).battleId, 'pvp-1');
});
