import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeFixture, deferred, flush } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import type { ZCGuidePreparedContent } from '../assets/script/app/zcds/application/ZCGuideLoader';
import type { IZCBattlePopup } from '../assets/script/app/zcds/application/ZCBattleSettlementController';

const content: ZCGuidePreparedContent = { entries: [], params: {}, iconFrames: new Map() };
test('指南内容加载期间离场或换局，不创建迟到弹窗', async () => {
    for (const replace of [false, true]) {
        const pending = deferred<ZCGuidePreparedContent>(); let opens = 0;
        const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
        Object.assign(h.entry.resources, { loadGuide: () => pending.promise });
        EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); h.dispose();
        const next = replace ? runtimeFixture() : null;
        pending.resolve(content); await flush();
        assert.equal(opens, 0); next?.dispose();
    }
});
test('指南弹窗加载期间离场，迟到弹窗立即关闭', async () => {
    const pending = deferred<IZCBattlePopup | null>(); let closed = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); await flush(); h.dispose();
    pending.resolve({ close: () => closed++ }); await flush();
    assert.equal(closed, 1);
});
test('视图退出后指南迟到完成不再读取组件字段', async () => {
    const pending = deferred<ZCGuidePreparedContent>(); let opens = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
    Object.assign(h.entry.resources, { loadGuide: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); h.dispose(); Object.freeze(h.view);
    pending.resolve(content); await flush(); assert.equal(opens, 0);
});
