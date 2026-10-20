import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCBattlePresentationQueue } from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

test('瞬时表现按时间过期、按格读取最新事件，重开清空并重置编号', () => {
    const queue = new ZCBattlePresentationQueue();
    const first = queue.pushFloatText({ now: 1, kind: 'damage', owner: 'player', value: 2.6, x: 4, y: 5, durationSeconds: 0.5 });
    assert.equal(first?.value, 3);
    assert.equal(queue.pushFloatText({ now: 1, kind: 'damage', owner: 'player', value: 0, x: 4, y: 5, durationSeconds: 0.5 }), null);
    queue.pushCardReveal({ now: 1, owner: 'player', hexId: 7, cardId: 'card', building: 'tower', tier: 4, cardName: '塔', unitId: null, luckText: '', x: 4, y: 5 });
    queue.pushHexActivation(1, 7, true);
    queue.pushHexActivation(1.1, 7, false);
    assert.equal(queue.activationOf(7)?.id, 2);
    // `hasCardReveal` 要原样透传：视图靠它决定「翻面段之后」是整格隐藏（有卡牌接棒）
    // 还是原地翻回来（抽空 —— 隐藏段会露出棋盘底）。
    assert.equal(queue.activationOf(7)?.hasCardReveal, false);
    queue.pushHexActivation(1.2, 9, true, 4);
    assert.equal(queue.activationOf(9)?.cardRarity, 4, '激活事件需把抽到卡牌的品阶传到渲染层');
    queue.prune(1.6);
    assert.equal(queue.floatTexts.length, 0);
    assert.equal(queue.cardReveals.length, 1);
    queue.reset();
    assert.equal(queue.activationOf(7), null);
    assert.equal(queue.pushFloatText({ now: 2, kind: 'miss', owner: 'player', value: 0, x: 0, y: 0, durationSeconds: 1 })?.id, 1);
});

test('处决合并飘字可取回前一段已显示伤害', () => {
    const queue = new ZCBattlePresentationQueue();
    const text = queue.pushFloatText({ now: 0, kind: 'damage', owner: 'player', value: 12, x: 0, y: 0, durationSeconds: 1 });
    assert.ok(text);
    assert.equal(queue.removeFloatText(text.id), 12);
    assert.equal(queue.removeFloatText(text.id), 0);
    assert.equal(queue.floatTexts.length, 0);
});

/**
 * 建筑摧毁通知（2026-10-19）：与抖动同型的「一次性、取走即空」通道。
 *
 * 为什么必须是取走而不是读快照：建筑一被打掉地块就转 `ruins`，快照里再也看不出
 * 「刚被拆」——这条通知是白烟雾爆炸的**唯一**触发源，读两次就是同一格炸两团。
 */
test('建筑摧毁通知取走即空，重启清空并重置编号', () => {
    const queue = new ZCBattlePresentationQueue();
    queue.pushBuildingDestruction(7);
    queue.pushBuildingDestruction(9);
    const first = queue.drainBuildingDestructions();
    assert.deepEqual(first.map((e) => e.hexId), [7, 9]);
    assert.equal(first[0].id, 1, '编号从 1 起');
    assert.equal(queue.drainBuildingDestructions().length, 0, '取走后必须为空，否则同一格炸两团烟');
    // 非法 hexId 直接丢（与 pushBuildingShake 同口径）。
    queue.pushBuildingDestruction(Number.NaN);
    assert.equal(queue.drainBuildingDestructions().length, 0);
    queue.reset();
    queue.pushBuildingDestruction(7);
    assert.equal(queue.drainBuildingDestructions()[0].id, 1, 'reset 后编号重置');
});
