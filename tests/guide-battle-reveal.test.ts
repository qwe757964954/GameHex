import test from 'node:test';
import assert from 'node:assert/strict';
import { loadViews } from './helpers/zcds-view-fixtures';

test('只有实际展示过的玩家卡牌退出展示队列时报告一次完成，敌方与未开始卡不推进引导', () => {
    const { load } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const { EventMgr } = load('../../../framework/event/EventMgr');
    const { GuideEvent } = load('../../guide/application/GuideEvents');
    const events: string[] = [];
    const owner = {};
    EventMgr.instance.on(GuideEvent.Complete, (payload: { cond: string }) => events.push(payload.cond), owner);
    const removed: number[] = [];
    const world = {
        options: { cardRevealPrefab: {} },
        cardRevealIds: new Set<number>(),
        cardRevealEntityBySource: new Map([[1, 101], [2, 102], [3, 103]]),
        cardRevealViews: new Map([101, 102, 103].map(id => [id, { render() {} }])),
        shownPlayerCardReveals: new Set<number>(),
        visualTime: () => 1,
        removeEntity: (id: number) => removed.push(id),
    };
    const render = (cardReveals: object[]) => ZCGameRenderWorld.prototype.renderCardReveals.call(world, { cardReveals });
    try {
        render([
            { id: 1, owner: 'player', startedAt: 0 },
            { id: 2, owner: 'enemy', startedAt: 0 },
            { id: 3, owner: 'player', startedAt: 10 },
        ]);
        assert.deepEqual(events, []);
        render([]);
        assert.deepEqual(removed, [101, 102, 103]);
        assert.deepEqual(events, ['cardRevealFinished']);
        render([]);
        assert.deepEqual(events, ['cardRevealFinished']);
    } finally { EventMgr.instance.offTarget(owner); }
});
