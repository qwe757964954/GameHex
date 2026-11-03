import assert from 'node:assert/strict';
import test from 'node:test';
import { ZCBattleSettlementController } from '../assets/script/app/zcds/application/ZCBattleSettlementController';
import { createControllerContext } from './helpers/controller-context';
import { runtimeFixture, flush, deferred } from './helpers/battle-runtime';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import type { IZCChapterBattleOutcome } from '../assets/script/app/battle/BattleResultService';
import type { IZCBattlePopup } from '../assets/script/app/zcds/application/ZCBattleSettlementController';

test('settlement waits before report, closes before navigation and restores on cancelled switch', async t => {
    const calls: string[] = [], pages: object[] = [];
    let settled = (_entered: boolean) => {};
    const owner = {}, target = {};
    EventMgr.instance.on(ZC_BATTLE_EVENTS.PVE_RESULT, event => { if (event.owner === owner) calls.push('record'); }, target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, event => { if (event.owner === owner) calls.push('navigate'); }, target);
    t.after(() => EventMgr.instance.offTarget(target));
    const controller = new ZCBattleSettlementController(createControllerContext(), {
        waitResult: () => { calls.push('wait'); return Promise.resolve({ code: 2, goods: [] }); },
        finish: async () => { calls.push('finish'); },
        loadRewards: async () => [],
        open: async options => { pages.push(options); calls.push('open'); return { close: reason => { calls.push('close'); calls.push(`reason:${reason}`); } }; },
        watchSwitch: callback => { settled = callback; return () => calls.push('unwatch'); },
        cancelRequests: () => calls.push('cancel'), failed: () => {},
    }, { owner, hasPveContext: true });
    controller.start({ localVictory: true, elapsedSeconds: 1, commands: [], statistics: [], battleType: 1002 });
    controller.start({ localVictory: true, elapsedSeconds: 1, commands: [], statistics: [], battleType: 1002 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.slice(0, 3), ['wait', 'finish', 'record']);
    assert.equal((pages[0] as { victory: boolean }).victory, false);
    controller.confirm(); settled(false); await new Promise(resolve => setImmediate(resolve));
    assert.ok(calls.indexOf('close') < calls.indexOf('navigate'));
    assert.ok(calls.includes('reason:manual'));
    assert.equal(pages[0], pages[1]);
    assert.equal(calls.filter(call => call === 'finish').length, 1);
    controller.dispose();
});

test('runtime consumes only its own frame, drains events once and keeps static cadence', () => {
    const h = runtimeFixture();
    try {
        assert.equal(h.session.currentPhase, 'playing');
        let ticks = 0, drained = 0;
        const model = h.runtime.currentModel;
        model.tick = () => ticks++;
        const drain = model.drainPresentationEvents.bind(model);
        model.drainPresentationEvents = () => { drained++; return drain(); };
        h.calls.length = 0;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: {}, dt: 1 });
        for (let i = 0; i < 10; i++) EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.05 });
        assert.equal(ticks, 10); assert.equal(drained, 10);
        assert.equal(h.calls.filter(call => call === 'dynamic').length, 10);
        assert.equal(h.calls.filter(call => call === 'static').length, 3);
        h.dispose();
        assert.equal(h.session.currentPhase, 'leaving');
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 1 });
        assert.equal(ticks, 10);
    } finally { h.dispose(); }
});
test('terminal tick waits for presentation before settlement; retreat reports once and stops model input', async () => {
    for (const retreat of [false, true]) {
        const h = runtimeFixture();
        try {
            let ticks = 0, artifacts = 0;
            h.runtime.currentModel.tick = () => ticks++;
            h.runtime.currentModel.useArtifact = () => { artifacts++; return { ok: true, message: 'ok' }; };
            if (!retreat) {
                h.forceStatus('victory'); h.holdSweep(true);
                EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
                assert.equal(h.requests.length, 0); assert.equal(ticks, 1);
                assert.equal(h.session.currentPhase, 'settlement-presentation');
                h.holdSweep(false);
                EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 0.1 });
            } else EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            assert.equal(h.session.currentPhase, 'settlement');
            const frozenTicks = ticks;
            EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 1 });
            await flush();
            assert.equal(h.requests.length, 1); assert.equal(h.requests[0].localVictory, !retreat);
            assert.equal(artifacts, 0); assert.equal(ticks, frozenTicks);
            assert.deepEqual(h.requests[0].statistics.map(row => row.unitId), [81, 82, 83]);
        } finally { h.dispose(); }
    }
});
test('settlement commands identify player and each AI by server unitId', () => {
    const h = runtimeFixture();
    try {
        const model = h.runtime.currentModel;
        const hex = model.snapshot.hexes.find(cell => model.canPlayerDevelop(cell.id));
        assert.ok(hex);
        assert.equal(model.developHex(hex.id).ok, true);
        for (let i = 0; i < 100; i++) model.tick(0.1);
        EventMgr.instance.emit(ZCGameUiEvent.Retreat);
        assert.equal(h.requests.length, 1);
        const commands = h.requests[0].commands;
        assert.deepEqual(commands[0], { frameId: 0, unitId: 81, op: 1, params: [hex.id] });
        assert.ok(commands.some(event => event.unitId === 82 && event.op === 1));
        assert.ok(commands.some(event => event.unitId === 83 && event.op === 1));
        assert.ok(commands.every(event => [81, 82, 83].includes(event.unitId)));
    } finally { h.dispose(); }
});

test('spawn selection has no battle model, resolves once, then renders before regular ticks', () => {
    const h = runtimeFixture({}, true);
    try {
        assert.equal(h.session.currentPhase, 'spawn-selection');
        assert.equal(h.runtime.currentModel, null);
        EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm);
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
        h.finishShowcase();
        assert.equal(h.session.currentPhase, 'playing');
        assert.ok(h.runtime.currentModel);
        assert.equal(h.calls.filter(call => call === 'startPlaying').length, 1);
        EventMgr.instance.emit(ZCGameUiEvent.SpawnConfirm); h.finishShowcase();
        assert.equal(h.calls.filter(call => call === 'startPlaying').length, 1);
    } finally { h.dispose(); }
});
test('late result after disposal does not persist, load rewards or open popup', async () => {
    const pending = deferred<IZCChapterBattleOutcome | null>();
    const calls: string[] = [];
    const h = runtimeFixture({ waitResult: () => pending.promise, loadRewards: async () => { calls.push('rewards'); return []; } }, false, 1004);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); h.dispose();
    pending.resolve({ code: 1, goods: [], treasureId: 0 }); await flush();
    assert.deepEqual(calls, []); assert.equal(h.pages.length, 0);
});
test('late popup closes immediately and cancelled return reuses the original result', async () => {
    const pending = deferred<IZCBattlePopup | null>(), calls: string[] = [];
    const h = runtimeFixture({ open: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush(); h.dispose();
    pending.resolve({ close: () => calls.push('closed') }); await flush();
    EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
    assert.deepEqual(calls, ['closed']); assert.equal(h.calls.includes('navigate'), false);
});
test('SLG awaits its own result before report and uses server defeat and war score', async () => {
    for (const type of [1003, 1004] as const) {
        const pending = deferred<IZCChapterBattleOutcome | null>();
        const h = runtimeFixture({ waitResult: battleType => { h.calls.push(`wait:${battleType}`); return pending.promise; } }, false, type);
        try {
            EventMgr.instance.emit(ZCGameUiEvent.Retreat);
            assert.ok(h.calls.indexOf(`wait:${type}`) < h.calls.indexOf('finish'));
            pending.resolve({ code: 2, goods: [], treasureId: 0, warScore: 27 }); await flush();
            assert.equal((h.pages[0] as { victory: boolean }).victory, false);
            assert.equal((h.pages[0] as { scoreText: string }).scoreText, '27');
        } finally { h.dispose(); }
    }
});

test('exiting during reward loading prevents a late settlement popup', async () => {
    const rewards = deferred<[]>();
    const h = runtimeFixture({ waitResult: async () => ({ code: 1, goods: [], treasureId: 0 }), loadRewards: () => rewards.promise }, false, 1004);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
    h.dispose(); rewards.resolve([]); await flush();
    assert.equal(h.pages.length, 0);
    assert.equal(h.calls.filter(call => call === 'cancel').length, 1);
});

test('settlement reports request and popup failures without opening twice', async () => {
    const h = runtimeFixture({
        finish: async () => { throw new Error('report failed'); },
        open: async () => { throw new Error('popup failed'); },
    });
    try {
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
        EventMgr.instance.emit(ZCGameUiEvent.Retreat); await flush();
        assert.equal(h.calls.filter(call => call === 'failed').length, 2);
    } finally { h.dispose(); }
});

test('exiting selection cancels its showcase timer and ignores a late timer callback', () => {
    let callback = () => {}, cancellations = 0;
    const h = runtimeFixture({}, true, undefined, {
        schedule: next => { callback = next; return () => { cancellations++; }; },
    });
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, { owner: h.view, dt: 20 });
    h.dispose(); callback();
    assert.equal(cancellations, 1);
    assert.equal(h.runtime.currentModel, null);
    assert.equal(h.calls.includes('startPlaying'), false);
});

test('runtime disposal closes settlement and auxiliary popups even if request cancellation throws', async () => {
    const calls: string[] = [];
    const failure = new Error('cancel failed');
    const h = runtimeFixture({
        cancelRequests: () => { calls.push('cancel'); throw failure; },
        open: async () => ({ close: () => calls.push('settlementClose') }),
    }, false, undefined, {
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
        openRank: async () => ({ close: () => calls.push('rankClose') }),
    });
    h.runtime.scope.defer(() => calls.push('runtimeRelease'));
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    EventMgr.instance.emit(ZCGameUiEvent.OpenRank);
    EventMgr.instance.emit(ZCGameUiEvent.Retreat);
    await flush();
    try {
        assert.throws(() => h.runtime.dispose(), error => error === failure);
        assert.deepEqual(calls, ['cancel', 'settlementClose', 'rankClose', 'guideClose', 'runtimeRelease']);
        assert.equal(h.runtime.currentModel, null);
        assert.equal(h.settlement.scope.disposed, true);
        h.runtime.dispose();
        assert.equal(calls.filter(call => call === 'cancel').length, 1);
    } finally { h.dispose(); }
});

test('one auxiliary popup close failure does not retain other popups or runtime resources', async () => {
    const calls: string[] = [];
    const failure = new Error('popup close failed');
    const h = runtimeFixture({}, false, undefined, {
        openRank: async () => ({ close: () => { calls.push('rankClose'); throw failure; } }),
        openGuide: async () => ({ close: () => calls.push('guideClose') }),
    });
    h.runtime.scope.defer(() => calls.push('release'));
    EventMgr.instance.emit(ZCGameUiEvent.OpenRank);
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    await flush();
    try {
        assert.throws(() => h.runtime.dispose(), error => error === failure);
        assert.deepEqual(calls, ['rankClose', 'guideClose', 'release']);
        assert.equal(h.runtime.currentModel, null);
    } finally { h.dispose(); }
});

test('runtime publishes return and tip notifications with the real view owner', async t => {
    const h = runtimeFixture();
    const notifications: unknown[] = [], target = {};
    t.after(() => { EventMgr.instance.offTarget(target); h.dispose(); });
    EventMgr.instance.on(ZC_BATTLE_EVENTS.SHOW_TIP, event => notifications.push(event), target);
    EventMgr.instance.on(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, event => notifications.push(event), target);
    h.runtime.currentModel.useArtifact = () => ({ ok: true, message: 'artifact tip' });
    EventMgr.instance.emit(ZCGameUiEvent.UseArtifact);
    EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    assert.deepEqual(notifications, [{ owner: h.view, message: 'artifact tip' }, { owner: h.view }]);
    h.dispose();
    EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    assert.equal(notifications.length, 2);
});
