import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as idleRewards from '../assets/script/app/territory/model/TerritoryIdleReward';
import * as battleStatus from '../assets/script/app/territory/model/TerritoryBattleStatus';
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
        if (name === './TerritoryBattleStatus') return battleStatus;
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

// ============================================================
// 账号级「已通关的领地关卡」（战斗宝箱入口的开启条件靠它活过切章）
// ============================================================

test('已通关关卡记在账号上，不跟章节走 —— 切到第 2 章照样读得到 20001', () => {
    const h = harness();
    const store = h.create('passed-a');
    assert.deepEqual([...store.loadPassedLevels()], [], '新号没有任何通关记录');

    assert.deepEqual([...store.markLevelsPassed([20001])], [20001], '首次记录要回「新增的」');
    assert.deepEqual([...store.markLevelsPassed([20001])], [], '重复记录没有新增 ⇒ 不返回，也不该写盘');
    assert.deepEqual([...store.markLevelsPassed([20001, 20002])], [20002]);

    // 切章：第 2 章的章节存档怎么建都不该影响这份成就
    store.load(2, { silver: 0, stamina: 0 });
    store.saveProgress(2, { ownedCells: [3] }, store.load(2));
    assert.deepEqual([...h.create('passed-a').loadPassedLevels()].sort(), [20001, 20002]);
    // 只有**一个** key，且不带 chapterId（带了就等于切章失忆）
    const keys = [...h.memory.keys()].filter((key) => key.startsWith(texts.TERRITORY_PASSED_LEVELS_KEY));
    assert.equal(keys.length, 1, `已通关关卡只能有一份存档，实际 ${keys.length} 份：${keys.join(' / ')}`);
    assert.equal(keys[0], `${texts.TERRITORY_PASSED_LEVELS_KEY}.server:1:role:passed-a:`,
        'key 必须是「账号作用域」，不能拼 chapterId');
});

test('已通关关卡按角色/区服隔离，脏数据不炸也不放行', () => {
    const h = harness();
    h.create('passed-b').markLevelsPassed([20001]);

    assert.deepEqual([...h.create('passed-b', '2').loadPassedLevels()], [], '换区服就是另一份成就');
    assert.deepEqual([...h.create('passed-c').loadPassedLevels()], [], '换角色就是另一份成就');

    // 脏数据必须用**新开的 harness**（新的一份 storage + 空的进程内兜底）：同一个 harness 里
    // 读盘会先命中上一次写进去的内存兜底，改 storage 根本看不见（这是既有的读盘口径）。
    const key = `${texts.TERRITORY_PASSED_LEVELS_KEY}.server:1:role:passed-b:`;
    const broken = harness();
    broken.memory.set(key, 'not json');
    assert.deepEqual([...broken.create('passed-b').loadPassedLevels()], [],
        '存档损坏按「没有记录」处理，不能抛');

    const dirty = harness();
    dirty.memory.set(key, JSON.stringify([20001, -1, 2.5, '20002', 0]));
    assert.deepEqual([...dirty.create('passed-b').loadPassedLevels()], [20001],
        '只认正整数关卡号，别让字符串/小数混进条件判定');
});

test('localStorage 不可用时，本次会话内照样记得住（内存兜底）', () => {
    const h = harness(true);
    const store = h.create('passed-offline');
    store.markLevelsPassed([20001]);
    assert.deepEqual([...store.loadPassedLevels()], [20001]);
    assert.deepEqual([...store.markLevelsPassed([20001])], [], '内存兜底下同样要幂等');
});
