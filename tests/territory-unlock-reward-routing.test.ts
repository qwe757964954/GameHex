import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Probe the real methods without initializing unrelated engine and network services.
const source = ts.createSourceFile('model.ts', readFileSync(
    'assets/script/app/territory/application/TerritoryModel.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const model = source.statements.find(ts.isClassDeclaration)!;
const names = ['unlockThenStartBattle', 'handleUnlockThenBattle', 'handleUnlockOnly', 'reportPendingPasses', 'startBattle'];
const methods = names.map(name => {
    const method = model.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(source) === name);
    assert.ok(method, name);
    return method.getText(source);
}).join('\n');
const Probe = runInNewContext(ts.transpileModule(`class Probe { ${methods} }\nglobalThis.Probe=Probe;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nProbe;', {
    TERRITORY_TEXTS: {}, ZC_BATTLE_TYPE_CHAPTER: 1002,
    territoryRevealedCells: () => [2], TERRITORY_REQUEST_STATUS: { rejected: 'rejected' },
});

test('各解锁入口将本次回包奖励传给展示出口，失败和过期回包不展示', async () => {
    const rewards = [{ resId: 9, amount: 5 }];
    for (const name of ['handleUnlockThenBattle', 'handleUnlockOnly', 'reportPendingPasses', 'startBattle']) {
        for (const ok of [true, false]) {
            const shown: unknown[] = [];
            const probe = Object.assign(new Probe(), {
                map: { chapterId: 1 }, loadId: 1, interactionId: 0,
                progress: { isOwned: () => false, isCellUnlocked: () => false,
                    markCellsUnlocked() {}, pendingPassCells: [2], serverStateKnown: false },
                ports: { gateway: { unlockCell: async () => ({ ok, rewards }), startBattle: async () => null } },
                pendingFixedResourceCells: new Set(), previewCellsNow: () => [], canAffordUnlock: () => true,
                runCellWrite: async (_id: unknown, _pending: unknown, _text: unknown,
                    request: () => Promise<unknown>, apply: (result: unknown) => void) => apply(await request()),
                showRewards: (value: unknown) => shown.push(value), showTip() {}, persistProgress() {},
                refreshWalletFromServer() {}, applyBattleStart() {}, beginBattle() {}, emitStateChange() {},
                enterBusy: () => () => {}, nextInteraction() { return ++this.interactionId; },
                battleParamsFor: () => [],
            });
            await probe[name]({ cellId: 2 }, { mode: 'match' });
            assert.deepEqual(shown, ok ? [rewards] : [], name + ': ' + ok);
            if (name === 'reportPendingPasses' || name === 'startBattle') {
                shown.length = 0;
                probe.ports.gateway.unlockCell = async () => { probe.loadId++; return { ok: true, rewards }; };
                await probe[name]({ cellId: 2 }, { mode: 'match' });
                assert.deepEqual(shown, [], name + ': stale response');
            }
        }
    }
});
