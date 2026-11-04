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
    const session = { ready: Promise.resolve() };
    const controller = new MatchingController(createControllerContext(), {
        model: new MatchingModel(LOCAL_PLAYER, '1', null),
        failed: () => {},
        battle: {
            requestBattle: () => request.promise,
            createSession: (_task, owner) => { owner.defer(() => releases++); return session; },
            fetchPvp: async () => null,
            removeCaller: () => { removed++; }
        },
        view: {
            render: value => states.push(value)
        },
        navigation: {
            navigate: (route, params) => routes.push({ route, params })
        },
        clock: {
            schedule: (fn, seconds) => { timers.set(seconds, fn); return () => { timers.delete(seconds); }; }
        },
    });
    return { controller, request, states, routes, timers, session, get releases() { return releases; }, get removed() { return removed; } };
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
        assert.equal(h.routes[0].params.battle, data); assert.equal(h.routes[0].params.session, h.session);
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

/**
 * 领地普通关的交接：匹配成功后**不是**直接切战场，而是
 * 「关界面（瞬间）→ 露云 → 等战场资源 → **先切战场** → 战场挂上后散云」。
 *
 * ⚠️ 顺序在 2026-11-02 被用户改过一次：原来是"散云 → 散到 60% 才切"，实机看到的是
 * 「云散开 → 一片黑 → 战场」（匹配页 UI 关了、战场还没挂上）。现在必须先切场再散云。
 *
 * 这一组钉的是**顺序**：
 *  · 关界面必须在 1.4s 那一刻就发生（晚了玩家会看见"匹配成功了但界面还挂着"）；
 *  · 云**必须等资源**再散；资源到了也不许先散 —— 得先切战场；
 *  · 全程只切一次场景、只散一次云。
 */
function handoffFixture(ready: Promise<unknown>) {
    const routes: any[] = [];
    const timers = new Map<number, () => void>();
    const calls: string[] = [];
    const controller = new MatchingController(createControllerContext(), {
        model: new MatchingModel(LOCAL_PLAYER, '1', null),
        failed: () => calls.push('failed'),
        handoff: {
            closeInstantly: () => calls.push('close'),
            releaseCover: () => calls.push('release'),
            readyTimeout: 12,
        },
        battle: {
            requestBattle: async () => battle(),
            createSession: () => ({ ready }),
            fetchPvp: async () => null,
            removeCaller: () => {}
        },
        view: {
            render: () => {}
        },
        navigation: {
            navigate: (route, params) => { calls.push(`go:${route}`); routes.push({ route, params }); }
        },
        clock: {
            schedule: (fn, seconds) => { timers.set(seconds, fn); return () => { timers.delete(seconds); }; }
        },
    });
    return { controller, routes, timers, calls };
}

test('★交接：匹配成功先瞬间关界面；资源没到之前既不散云也不切场', async () => {
    let resolveReady: (value?: unknown) => void = () => {};
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const h = handoffFixture(ready);
    h.controller.start();
    await tick();
    h.timers.get(3)();
    h.timers.get(1.4)();
    // ① 界面立刻关掉、云还没散、也还没切场
    assert.deepEqual(h.calls, ['close']);
    assert.equal(h.routes.length, 0);
    // ② 资源到了：**先**切战场（战场挂到云下面），**再**散云
    resolveReady();
    await tick();
    assert.deepEqual(h.calls, ['close', 'go:battle', 'release'],
        '顺序必须是 关界面 → 切战场 → 散云（先散云就会露黑底）');
    assert.equal(h.routes.length, 1);
    assert.equal(h.routes[0].route, 'battle');
    h.controller.dispose();
});

test('★交接：资源一直不来也要切场 + 散云（超时不是失败），且只走一次', async () => {
    const never = new Promise<unknown>(() => {});
    const h = handoffFixture(never);
    h.controller.start();
    await tick();
    h.timers.get(3)();
    h.timers.get(1.4)();
    assert.deepEqual(h.calls, ['close']);
    // 上限到了：照样切场 + 散云，不报失败（让战场页自己显示加载态）
    h.timers.get(12)();
    assert.deepEqual(h.calls, ['close', 'go:battle', 'release']);
    assert.equal(h.routes.length, 1);
    // 迟到的那条（ready）不许再触发一次散场 / 切场
    h.timers.get(12)();
    assert.equal(h.routes.length, 1);
    assert.deepEqual(h.calls, ['close', 'go:battle', 'release']);
    h.controller.dispose();
});

test('★交接：战场资源准备失败 ⇒ 不回滚成"半关界面 + 一屏云"，回主界面并照样散云', async () => {
    // 用"晚一点才失败"的 promise：一上来就 reject 的话，`start()` 里那条已有的
    // `preload.ready.catch` 会先报一次（那时的语义是"提前知道要打不成了"），
    // 这段要验的是**交接途中**失败怎么收场。
    let failPreload: (error: Error) => void = () => {};
    const ready = new Promise<unknown>((_, reject) => { failPreload = reject; });
    const h = handoffFixture(ready);
    h.controller.start();
    await tick();
    h.timers.get(3)();
    h.timers.get(1.4)();
    assert.deepEqual(h.calls, ['close']);
    failPreload(new Error('offline'));
    await tick();
    // 云已经交接出去了（不在匹配页里），回主界面之后必须照样散 —— 否则一屏云会一直盖着
    assert.deepEqual(h.calls, ['close', 'failed', 'go:main', 'release']);
    assert.equal(h.routes.length, 1);
    assert.equal(h.routes[0].route, 'main');
    h.controller.dispose();
});
