import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BIGMAP_TOP_HUD_HEIGHT,
    BIGMAP_TOP_RES_TYPES,
    buildBigMapQueueText,
    buildBigMapTopHudView,
    formatBigMapResourceAmount,
    formatBigMapTopResourceText,
} from '../assets/script/app/bigmap/view/BigMapTopHudTypes';

test('顶部资源固定为 5 格：粮/木/铁/金币/行动力，金币不再缺席', () => {
    assert.deepEqual([...BIGMAP_TOP_RES_TYPES], ['grain', 'wood', 'iron', 'coin', 'stamina']);
    assert.equal(BIGMAP_TOP_HUD_HEIGHT, 340, '地图顶边要按玩家卡 + 三行资源的高度留白');
});

test('金额格式化：千位以上一位小数 K，未知/非法值不产生 NaN 文本', () => {
    assert.equal(formatBigMapResourceAmount(999), '999');
    assert.equal(formatBigMapResourceAmount(1000), '1.0K');
    assert.equal(formatBigMapResourceAmount(1200), '1.2K');
    assert.equal(formatBigMapResourceAmount(15300), '15.3K');
    assert.equal(formatBigMapResourceAmount(Number.NaN), '0');
});

test('单格文本：行动力带上限，未知余额显示恢复倒计时，其余未知显示占位', () => {
    assert.equal(formatBigMapTopResourceText({ type: 'grain', amount: 1200, cap: 2000 }, null), '1.2K');
    assert.equal(formatBigMapTopResourceText({ type: 'stamina', amount: 50, cap: 100 }, null), '50/100');
    assert.equal(formatBigMapTopResourceText({ type: 'stamina', amount: 0, cap: 100, amountKnown: false }, 12), '12s');
    assert.equal(formatBigMapTopResourceText({ type: 'stamina', amount: 0, cap: 100, amountKnown: false }, null), '—');
    assert.equal(formatBigMapTopResourceText({ type: 'grain', amount: 0, cap: 0, amountKnown: false }, 12), '—');
});

test('一次产出全量视图：缺项补占位，队列摘要与金币同口径', () => {
    const view = buildBigMapTopHudView([
        { type: 'grain', amount: 1200, cap: 2000 },
        { type: 'wood', amount: 300, cap: 500 },
        { type: 'iron', amount: 0, cap: 0 },
        { type: 'coin', amount: 350, cap: 0 },
        { type: 'stamina', amount: 0, cap: 100, amountKnown: false },
    ], [{ busy: true, locked: false }, { busy: false, locked: false }, { busy: false, locked: true }], 12);
    assert.deepEqual(view.slots.map((slot) => slot.text), ['1.2K', '300', '0', '350', '12s']);
    assert.deepEqual(view.slots.map((slot) => slot.type), ['grain', 'wood', 'iron', 'coin', 'stamina']);
    assert.equal(view.buildQueueText, '1/2');
    assert.equal(view.researchQueueText, '—');

    const missing = buildBigMapTopHudView([], [], null);
    assert.deepEqual(missing.slots.map((slot) => slot.text), ['—', '—', '—', '—', '—']);
    assert.equal(missing.buildQueueText, '0/0');
    assert.equal(buildBigMapQueueText([]), '0/0');
});
