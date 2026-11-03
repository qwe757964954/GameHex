import assert from 'node:assert/strict';
import test from 'node:test';
import { PostLoginController } from '../assets/script/app/loading/PostLoginController';
import { resolvePostLoginIdentity, postLoginProgress } from '../assets/script/app/loading/PostLoginContract';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { MAIN_LOADING_EVENTS } from '../assets/script/app/main/MainLoadingEvents';
import { createControllerContext } from './helpers/controller-context';

function fixture(startRatio = 0.6) {
    const ratios: number[] = [], statuses: string[] = [], routes: string[] = [], calls: unknown[] = [];
    let report = (_progress: { ratio: number }) => {};
    let resolve = () => {}, reject = (_error: Error) => {};
    const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const controller = new PostLoginController(createControllerContext(), {
        startRatio, prepare: callback => { calls.push('prepare'); report = callback; return pending; },
        bootstrapIdentity: data => calls.push(data), initAudio: () => calls.push('audio'),
        setProgress: ratio => ratios.push(ratio), setStatus: message => statuses.push(message),
        navigate: route => routes.push(route), failed: error => calls.push(error),
    });
    return { controller, ratios, statuses, routes, calls, resolve, reject, report: (ratio: number) => report({ ratio }) };
}
test('post-login progresses from actual update value through session then Main; starts once', async () => {
    const h = fixture();
    try {
        const params = { session: { roleId: 1, selectServerId: 2 } };
        const ready = h.controller.start(params); void h.controller.start(params);
        assert.deepEqual(h.calls, [params, 'audio', 'prepare']);
        h.report(1); h.resolve(); await ready;
        assert.deepEqual(h.routes, ['main']);
        for (const ratio of [0, 0.3, 1]) EventMgr.instance.emit(MAIN_LOADING_EVENTS.PROGRESS, { ratio, message: 'unused' });
        const expected = [0.6, 0.88, 0.88, 0.916, 1];
        h.ratios.forEach((ratio, index) => assert.ok(Math.abs(ratio - expected[index]) < 1e-10));
        assert.equal(h.ratios.length, expected.length); assert.equal(h.controller.mainReady, true);
    } finally { h.controller.dispose(); }
});
test('post-login ignores prepare callbacks, completion/rejection and Main notifications after disposal', async () => {
    for (const fails of [false, true]) {
        const h = fixture(0), ready = h.controller.start(); h.controller.dispose(); h.controller.dispose();
        const counts = [h.ratios.length, h.statuses.length, h.calls.length];
        h.report(1); if (fails) h.reject(new Error('late')); else h.resolve(); await ready;
        EventMgr.instance.emit(MAIN_LOADING_EVENTS.PROGRESS, { ratio: 1 });
        EventMgr.instance.emit(MAIN_LOADING_EVENTS.FAILED, 'late');
        assert.deepEqual([h.ratios.length, h.statuses.length, h.calls.length], counts);
        assert.deepEqual(h.routes, []);
    }
});
test('post-login prepare failure and Main failure retain error presentation without false handoff', async () => {
    for (const stage of ['session', 'main']) {
        const h = fixture();
        try {
            const ready = h.controller.start();
            if (stage === 'session') h.reject(new Error('failed')); else h.resolve();
            await ready;
            if (stage === 'main') EventMgr.instance.emit(MAIN_LOADING_EVENTS.FAILED, 'failed');
            assert.equal(h.statuses.at(-1), '加载失败，请重新进入游戏');
            assert.equal(h.controller.mainReady, false);
            assert.equal(h.routes.length, stage === 'main' ? 1 : 0);
        } finally { h.controller.dispose(); }
    }
});
test('identity uses complete valid entry first, then saved session; rejects malformed or mixed identity', () => {
    const saved = JSON.stringify({ roleId: '9007199254740993', selectServerId: 2 });
    assert.deepEqual(resolvePostLoginIdentity({ session: { roleId: 3, selectServerId: 4 } }, saved), { roleId: '3', serverId: '4' });
    assert.deepEqual(resolvePostLoginIdentity({ session: { roleId: 3 } }, saved), { roleId: '9007199254740993', serverId: '2' });
    for (const data of [null, [], 'bad', {}, { roleId: {}, selectServerId: 2 }, { roleId: -1, selectServerId: 2 }, { roleId: 1.5, selectServerId: 2 }]) {
        assert.equal(resolvePostLoginIdentity({ session: data }, 'null'), null);
    }
    assert.equal(resolvePostLoginIdentity(null, '{bad'), null);
});
test('progress boundary clamps malformed ratios and preserves skipped-update start', () => {
    assert.equal(postLoginProgress(0, 'session', 1), 0.7);
    assert.equal(postLoginProgress(0, 'main', 1), 1);
    assert.ok(Math.abs(postLoginProgress(0.6, 'session', 100) - 0.88) < 1e-10);
    assert.equal(postLoginProgress(Number.NaN, 'session', Number.NaN), 0);
});
