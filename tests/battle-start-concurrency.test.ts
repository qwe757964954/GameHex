import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';

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
