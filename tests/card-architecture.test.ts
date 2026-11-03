import assert from 'node:assert/strict';
import test from 'node:test';
import { LineupDraftStore } from '../assets/script/app/card/LineupDraftStore';

// 控制器异步行为见 card-popup-controllers.test.ts；这里验证复用的纯草稿模型。

const card = (id: string) => ({ id, name: id, rarity: '绿' }) as any;

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
    assert.equal(store.snapshot().dirty, true, '保存方案 2 不得把方案 1 的未保存修改一起清掉');
    store.selectPreset(0);
    store.commit();
    assert.equal(store.snapshot().dirty, false);
});

