import assert from 'node:assert/strict';
import test from 'node:test';
import { LineupDraftStore } from '../assets/script/app/card/LineupDraftStore';

//  注：原先这里还有两条「Presenter 丢弃旧结果 / 升级阶段序列」的用例。
//  2026-10-27 取消 Presenter 层（取数、轮次校验、phase 都并进页面组件），
//  那两条要跑就得加载 `cc`，Node 单测里做不到，故删除 —— 状态机正确性改为靠端到端验证。

const card = (id: string) => ({ id, name: id, rarity: '绿' }) as any;

const status = (cardId: string, level: number) => ({
    cardId,
    configured: true,
    level,
    targetLevel: level + 1,
    maxLevel: 10,
    maxed: false,
    armyExpItemId: '16003',
    generalExpItemId: '16000',
    armyExpOwned: 99,
    generalExpOwned: 99,
    requirements: [],
    canUpgrade: true,
    blockedReason: '',
});

test('LineupDraftStore 按方案隔离草稿，保存值不再从节点名反查', () => {
    const first = card('1');
    const second = card('2');
    const store = new LineupDraftStore([first, second, first], 8, 2, 0);

    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['1', '2']);
    assert.equal(store.snapshot().dirty, false);
    store.reset();
    assert.deepEqual(store.snapshot().cards, []);
    assert.equal(store.snapshot().dirty, true);

    store.selectPreset(1);
    assert.deepEqual(store.snapshot().cards.map((entry) => entry.id), ['1', '2']);
    store.put(card('3'), 1);
    assert.deepEqual(store.commit(), ['1', '3', '2']);
    assert.equal(store.snapshot().dirty, false);
});

