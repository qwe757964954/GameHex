import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchingModel, type IMatchingViewState } from '../assets/script/app/matching/MatchingModel';
import { MATCHING_EVENTS, type IMatchingLeave } from '../assets/script/app/matching/MatchTypes';
import { BATTLE_START_SETTLED, normalizeBattleStart } from '../assets/script/app/battle/BattleStartModel';
import { LOCAL_PLAYER } from '../assets/script/app/matching/MatchPool';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import type { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { createControllerContext } from './helpers/controller-context';
import { loadMatchingController } from './helpers/matching-controller';

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const battle = () => normalizeBattleStart({ code: 1, battleId: '11', seed: '12', unitInfos: [
    { campId: 1, showInfo: { roleId: '1', name: 'me' } },
    { campId: 2, showInfo: { roleId: '2', name: 'enemy' } },
] });

function fixture(t: { after(callback: () => void): void }, ready?: Promise<unknown>) {
    const request = deferred<ReturnType<typeof battle>>();
    const states: IMatchingViewState[] = [];
    const leaves: IMatchingLeave[] = [];
    const calls: string[] = [];
    const callers: object[] = [];
    const removed: object[] = [];
    let releases = 0;
    let cancelled = false;
    let cancelBattleRequest: (() => void) | undefined;
    const session = { ready: ready ?? Promise.resolve() };
    const MatchingController = loadMatchingController({
        '../battle/BattleStartService': { requestBattleStart() {
            const publish = (battle: Awaited<typeof request.promise>) => {
                if (!cancelled) EventMgr.instance.emit(BATTLE_START_SETTLED, battle);
                return battle;
            };
            const result = Object.assign(request.promise.then(publish, () => publish(null)), {
                cancel() { cancelled = true; },
            });
            cancelBattleRequest = result.cancel;
            return result;
        } },
        '../battle/PvpInfoService': { fetchPvpInfo: async (caller: object) => { callers.push(caller); return null; } },
        '../net/GameNet': { GameNet: { instance: {
            addEvent(event: string, caller: object, handler: (battle: Awaited<typeof request.promise>) => void) {
                EventMgr.instance.on(event, handler, caller);
            },
            removeCaller(caller: object) {
                EventMgr.instance.offTarget(caller);
                cancelBattleRequest?.();
                removed.push(caller);
            },
        } } },
        '../zcds/application/ZCBattlePreparation': { createZCBattleSession(_context, { owner }: { owner: ResourceScope }) {
            owner.defer(() => releases++);
            return session;
        } },
    });
    const controller = new MatchingController(createControllerContext(), {
        model: new MatchingModel(LOCAL_PLAYER, '1', null),
        handoffReadyTimeout: ready ? 12 : undefined,
    });
    const subscriber = {};
    const bus = EventMgr.instance;
    bus.on(MATCHING_EVENTS.STATE, (state: IMatchingViewState) => states.push(state), subscriber);
    bus.on(MATCHING_EVENTS.HANDOFF, payload => {
        assert.equal(payload, undefined);
        calls.push('handoff');
    }, subscriber);
    bus.on(MATCHING_EVENTS.LEAVE, (event: IMatchingLeave) => {
        calls.push(event.destination);
        leaves.push(event);
    }, subscriber);
    t.after(() => {
        bus.offTarget(subscriber);
        controller.dispose();
    });
    return { controller, request, states, leaves, calls, session, callers, removed,
        get releases() { return releases; }, get cancelled() { return cancelled; } };
}

test('收到服务端确认并满足最低搜索时间后，发布匹配结果并交接同一个会话', async t => {
    for (const serverFirst of [true, false]) {
        const h = fixture(t);
        h.controller.start();
        assert.equal(h.states[0].phase, 'searching');
        assert.deepEqual(h.callers, [h.controller]);
        const data = battle();
        assert.ok(data);
        if (serverFirst) { h.request.resolve(data); await tick(); }
        for (let frame = 0; frame < 179; frame++) h.controller.advanceTime(1 / 60);
        assert.equal(h.states.at(-1).phase, 'searching');
        h.controller.advanceTime(1 / 60);
        assert.equal(h.leaves.length, 0);
        if (!serverFirst) { h.request.resolve(data); await tick(); }
        assert.equal(h.states.at(-1).phase, 'matched');
        for (let frame = 0; frame < 83; frame++) h.controller.advanceTime(1 / 60);
        assert.equal(h.leaves.length, 0);
        h.controller.advanceTime(1 / 60);
        assert.equal(h.leaves.length, 1);
        const leave = h.leaves[0];
        assert.equal(leave.destination, 'battle');
        if (leave.destination !== 'battle') throw new Error('缺少战场入口');
        assert.equal(leave.entry.battle, data);
        assert.equal(leave.entry.session, h.session);
        h.controller.dispose();
        assert.equal(h.releases, 1);
        assert.deepEqual(h.removed, [h.controller]);
    }
});

test('开战被拒绝、异常或缺失对手时只发布一次回主界面命令', async t => {
    for (const mode of ['null', 'reject', 'empty']) {
        const h = fixture(t);
        h.controller.start();
        if (mode === 'reject') h.request.reject(new Error('offline'));
        else h.request.resolve(mode === 'empty' ? { battleId: '1', seed: '1', version: '', units: [] } : null);
        await tick();
        h.controller.advanceTime(20);
        assert.deepEqual(h.calls, ['main']);
    }
});

test('请求或结果停留期间退出，释放请求并停止推进匹配', async t => {
    for (const step of ['request', 'hold']) {
        const h = fixture(t);
        h.controller.start();
        assert.equal(h.cancelled, false);
        if (step === 'hold') { h.request.resolve(battle()); await tick(); h.controller.advanceTime(3); }
        const count = h.states.length;
        h.controller.dispose();
        h.controller.dispose();
        h.request.resolve(battle());
        await tick();
        h.controller.advanceTime(20);
        assert.equal(h.cancelled, true);
        assert.equal(h.states.length, count);
        assert.equal(h.leaves.length, 0);
        assert.equal(h.releases, step === 'hold' ? 1 : 0);
        assert.deepEqual(h.removed, [h.controller]);
    }
});

test('领地匹配先交接云层，再等战场资源就绪或超时后进入战场', async t => {
    for (const timeout of [false, true]) {
        const ready = deferred<unknown>();
        const h = fixture(t, ready.promise);
        h.controller.start();
        h.request.resolve(battle());
        await tick();
        h.controller.advanceTime(3);
        h.controller.advanceTime(1.4);
        assert.deepEqual(h.calls, ['handoff']);
        h.controller.advanceTime(11.9);
        assert.deepEqual(h.calls, ['handoff']);
        if (timeout) h.controller.advanceTime(0.1);
        ready.resolve(undefined);
        await tick();
        h.controller.advanceTime(12);
        assert.deepEqual(h.calls, ['handoff', 'battle']);
    }
});

test('领地匹配交接期间准备资源失败，发出带原始错误的回主界面命令', async t => {
    const ready = deferred<unknown>();
    const h = fixture(t, ready.promise);
    h.controller.start();
    h.request.resolve(battle());
    await tick();
    h.controller.advanceTime(3);
    h.controller.advanceTime(1.4);
    const error = new Error('offline');
    ready.reject(error);
    await tick();
    h.controller.advanceTime(12);
    assert.deepEqual(h.calls, ['handoff', 'main']);
    const leave = h.leaves[0];
    assert.equal(leave.destination === 'main' && leave.error, error);
});

test('领地交接期间退出，迟到的资源就绪和后续帧都不能切战场', async t => {
    const ready = deferred<unknown>();
    const h = fixture(t, ready.promise);
    h.controller.start();
    h.request.resolve(battle());
    await tick();
    h.controller.advanceTime(3);
    h.controller.advanceTime(1.4);
    h.controller.dispose();
    ready.resolve(undefined);
    await tick();
    h.controller.advanceTime(12);
    assert.deepEqual(h.calls, ['handoff']);
});
