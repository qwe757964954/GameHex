import assert from 'node:assert/strict';
import test from 'node:test';
import { MatchingController } from '../assets/script/app/matching/MatchingController';
import { MatchingModel } from '../assets/script/app/matching/MatchingModel';
import { normalizeBattleStart } from '../assets/script/app/battle/BattleStartModel';
import { LOCAL_PLAYER } from '../assets/script/app/matching/MatchPool';
import { createControllerContext } from './helpers/controller-context';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred<T>() { let resolve: (v: T) => void = () => {}; let reject: (e: Error) => void = () => {}; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const battle = () => normalizeBattleStart({ code: 1, battleId: '11', seed: '12', unitInfos: [{ campId: 1, showInfo: { roleId: '1', name: 'me' } }, { campId: 2, showInfo: { roleId: '2', name: 'enemy' } }] });
function fixture() {
    const request = deferred<ReturnType<typeof battle>>(), states: any[] = [], routes: any[] = [], timers = new Map<number, () => void>();
    let releases = 0, removed = 0;
    const preload = { ready: Promise.resolve(), releaseFromMatching() { releases++; } };
    const controller = new MatchingController(createControllerContext(), {
        model: new MatchingModel(LOCAL_PLAYER, '1', null),
        requestBattle: () => request.promise, createPreload: () => preload, fetchPvp: async () => null,
        render: value => states.push(value), navigate: (route, params) => routes.push({ route, params }),
        schedule: (fn, seconds) => { timers.set(seconds, fn); return () => { timers.delete(seconds); }; },
        removeCaller: () => { removed++; }, failed: () => {},
    });
    return { controller, request, states, routes, timers, preload, get releases() { return releases; }, get removed() { return removed; } };
}
test('match waits for server and minimum search, then holds result before navigating with the same battle', async () => {
    for (const serverFirst of [true, false]) {
        const h = fixture(); h.controller.start(); h.controller.start();
        const data = battle(); assert.ok(data);
        if (serverFirst) { h.request.resolve(data); await tick(); }
        h.timers.get(3)(); assert.equal(h.routes.length, 0);
        if (!serverFirst) { h.request.resolve(data); await tick(); }
        assert.equal(h.states[h.states.length - 1].phase, 'matched');
        h.timers.get(1.4)(); assert.equal(h.routes.length, 1);
        assert.equal(h.routes[0].params.battle, data); assert.equal(h.routes[0].params.preload, h.preload);
        h.controller.dispose(); assert.equal(h.releases, 1); assert.equal(h.removed, 1);
    }
});
test('failed or empty server result returns main once and cannot create a fake battle', async () => {
    for (const mode of ['null', 'reject', 'empty']) {
        const h = fixture(); h.controller.start();
        if (mode === 'reject') h.request.reject(new Error('offline'));
        else h.request.resolve(mode === 'empty' ? { battleId: '1', seed: '1', version: '', units: [] } : null);
        await tick(); assert.equal(h.routes.length, 1); assert.equal(h.timers.has(1.4), false);
        h.controller.dispose();
    }
});
test('leaving during request or hold cancels output, timers, caller and preload exactly once', async () => {
    for (const step of ['request', 'hold']) {
        const h = fixture(); h.controller.start();
        if (step === 'hold') { h.request.resolve(battle()); await tick(); h.timers.get(3)(); }
        const count = h.states.length;
        h.controller.dispose(); h.controller.dispose(); h.request.resolve(battle()); await tick();
        assert.equal(h.states.length, count); assert.equal(h.routes.length, 0); assert.equal(h.timers.size, 0);
        assert.equal(h.releases, 1); assert.equal(h.removed, 1);
    }
});
