import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as idleRewards from '../assets/script/app/territory/model/TerritoryIdleReward';
import * as texts from '../assets/script/app/territory/application/TerritoryTexts';
import type { TerritorySaveStore } from '../assets/script/app/territory/model/TerritorySaveStore';

function harness(unavailable = false) {
    const memory = new Map<string, string>();
    const storage = {
        getItem(key: string): string | null {
            if (unavailable) throw new Error('storage unavailable');
            return memory.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
            if (unavailable) throw new Error('storage unavailable');
            memory.set(key, value);
        },
    };
    const exports: { TerritorySaveStore?: new (owner: { roleId: string; serverId: string } | null, storage: typeof storage) => TerritorySaveStore } = {};
    const source = readFileSync('assets/script/app/territory/model/TerritorySaveStore.ts', 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText, { exports, console: { warn() {} }, require: (name: string) => {
        if (name === 'cc') return { sys: { localStorage: storage } };
        if (name === './TerritoryIdleReward') return idleRewards;
        if (name === '../application/TerritoryTexts') return texts;
        throw new Error(name);
    } });
    const create = (roleId: string, serverId = '1') => {
        const store = new exports.TerritorySaveStore!({ roleId, serverId }, storage);
        assert.equal(typeof store.load, 'function', 'save operations must bind to a captured owner');
        return store;
    };
    return { memory, create };
}

for (const unavailable of [false, true]) {
    test(`role/server isolation includes progress, wallet and last chapter (fallback=${unavailable})`, () => {
        const h = harness(unavailable);
        const a = h.create('9007199254740993');
        const save = a.load(1, { silver: 999, stamina: 88 });
        save.progress = { ownedCells: [0, 1, 2] };
        a.save(1, save);
        a.saveLastChapter(2);
        const b = h.create('9007199254740994');
        const bSave = b.load(1, { silver: 10, stamina: 5 });
        assert.equal(bSave.wallet.silver, 10);
        assert.equal(bSave.progress.ownedCells?.length ?? 0, 0);
        assert.equal(b.loadLastChapter([1, 2]), 1);
        assert.equal(h.create('9007199254740993', '2').load(1, { silver: 20, stamina: 6 }).wallet.silver, 20);
        assert.equal(h.create('9007199254740993').load(1).wallet.silver, 999);
        assert.equal(h.create('9007199254740993').loadLastChapter([1, 2]), 2);
    });
}

test('unscoped legacy saves are preserved without being imported into an account', () => {
    const h = harness();
    const oldKey = `${texts.TERRITORY_STORAGE_PREFIX}1`;
    const old = JSON.stringify({ version: 1, progress: { ownedCells: [1] }, wallet: { silver: 999, stamina: 99 } });
    h.memory.set(oldKey, old);
    h.memory.set(texts.TERRITORY_LAST_CHAPTER_KEY, '2');
    const store = h.create('new-role');
    assert.equal(store.load(1, { silver: 10, stamina: 5 }).wallet.silver, 10);
    assert.equal(store.loadLastChapter([1, 2]), 1);
    assert.equal(h.memory.get(oldKey), old);
});

test('battle settlement writes to the captured owner after another owner opens a store', () => {
    const h = harness();
    const a = h.create('A');
    a.load(1, { silver: 100, stamina: 20 });
    a.beginBattle(1, { cellId: 1, levelId: 1001, silverCost: 10, staminaCost: 5 });
    const b = h.create('B');
    b.load(1, { silver: 200, stamina: 30 });
    a.resolveBattle(1, 1, 1001, true);
    assert.equal(h.create('A').load(1).battle?.status, 'victory');
    assert.equal(h.create('A').load(1).wallet.silver, 90);
    assert.equal(b.load(1).battle, undefined);
    assert.equal(b.load(1).wallet.silver, 200);
});

test('random resource location survives reload and remains scoped to the role', () => {
    const h = harness();
    const a = h.create('random-a');
    const save = a.load(1, { silver: 100, stamina: 10 });
    a.save(1, { ...save, randomResourceCells: [4, -1, 2.5] });
    assert.deepEqual([...h.create('random-a').load(1).randomResourceCells ?? []], [4]);
    assert.equal(h.create('random-b').load(1).randomResourceCells, undefined);
});

test('server wallet refresh persists without changing territory progress', () => {
    const h = harness();
    const store = h.create('wallet-refresh');
    const save = store.load(1, { silver: 100, stamina: 20 });
    save.progress = { ownedCells: [0, 1] };
    const updated = store.saveWallet(1, { silver: 90, stamina: 15 }, save);
    assert.deepEqual([...updated.progress.ownedCells ?? []], [0, 1]);
    assert.equal(h.create('wallet-refresh').load(1).wallet.silver, 90);
    assert.equal(h.create('wallet-refresh').load(1).wallet.stamina, 15);
});
