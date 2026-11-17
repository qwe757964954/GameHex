import test from 'node:test';
import assert from 'node:assert/strict';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import * as table from '../assets/script/app/showReward/ShowRewardTable';
import * as rewardEntries from '../assets/script/app/common/RewardEntries';

test('奖励窗从打开前即通知暂停，空奖励立即关闭或加载期间退出都能配对恢复', async () => {
    class PopupBase {
        alive = true;
        close() { this.alive = false; (this as unknown as { onClose(): void }).onClose(); }
        unscheduleAllCallbacks() {}
    }
    const { exports, unresolved } = loadTsModule<{ ShowRewardPage: new () => any }>(
        'assets/script/app/showReward/ShowRewardPage.ts', { modules: {
            cc: ccStub(), '/PopupBase': { PopupBase }, '/PopupDef': { PopupCloseReason: { Manual: 0 } },
            '/EventMgr': { EventMgr }, '/ViewLifecycle': { VIEW_LIFECYCLE }, '/FW': { FW: {} },
            '/ItemDetailPage': {}, '/ItemDetailTable': {}, '/VScrollView': {}, '/ShowRewardItem': {},
            '/ShowRewardTexts': {}, '/RewardFrames': {}, '/ShowRewardTable': table,
            '/RewardEntries': rewardEntries,
        } });
    assert.deepEqual(unresolved, []);
    const events: Array<{ owner: object; phase: string }> = [];
    const listener = {};
    EventMgr.instance.on(VIEW_LIFECYCLE, payload => events.push(payload), listener);
    try {
        const empty = new exports.ShowRewardPage();
        empty.prepareEnterAnimation = () => {};
        await empty.onOpen({ goods: [] });
        assert.deepEqual(events.map(e => e.phase), ['enabled', 'disabled']);
        assert.ok(events.every(e => e.owner === empty));

        const pending = new exports.ShowRewardPage();
        pending.prepareEnterAnimation = () => {};
        let resolve!: (value: unknown[]) => void;
        pending.resolveEntries = () => new Promise(done => { resolve = done; });
        const opening = pending.onOpen({ goods: [{ resId: 7, number: 10 }] });
        assert.equal(events.at(-1)?.phase, 'enabled');
        pending.close();
        resolve([]);
        await opening;
        assert.deepEqual(events.slice(2).map(e => e.phase), ['enabled', 'disabled']);
        assert.ok(events.slice(2).every(e => e.owner === pending));
    } finally { EventMgr.instance.offTarget(listener); }
});
