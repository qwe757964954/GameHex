import type { ZCGamePreparedResources } from '../assets/script/app/zcds/application/ZCGameLoader';
import type { IZCGameEntry } from '../assets/script/app/zcds/application/ZCGameEntry';
import type { ZCGameEntryParams } from '../assets/script/app/zcds/application/ZCGameEntry';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IZCBattleRuntimeOptions } from '../assets/script/app/zcds/application/ZCBattleController';
import { ZCBattleController } from '../assets/script/app/zcds/application/ZCBattleController';
import { ZC_BATTLE_EVENTS } from '../assets/script/app/zcds/application/ZCBattleEvents';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { createControllerContext } from './helpers/controller-context';

function fixture(fail = false, input: { owner?: ResourceScope; battle?: Promise<null>; params?: ZCGameEntryParams } = {}) {
    const calls: string[] = [];
    let resolve: (value: unknown) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const pending = new Promise<ZCGamePreparedResources>((yes, no) => { resolve = value => yes(value as ZCGamePreparedResources); reject = no; });
    const runtime = {
        initialize() { calls.push('initialize'); if (fail) throw new Error('mount failed'); },
        shutdown() { calls.push('shutdown'); }, destroy() { calls.push('destroy'); },
    };
    let loads = 0;
    let loadedParams: ZCGameEntryParams | undefined;
    const controller = new ZCBattleController(createControllerContext(), {
        prepareDirect: (_scope, params) => { loads++; loadedParams = params; return pending; },
        buildEntry: prepared => ({ resources: prepared } as IZCGameEntry),
        resolvePveResult: () => calls.push('result'),
    }, { owner: input.owner ?? new ResourceScope('source'), battle: input.battle, params: input.params });
    const runtimeOptions: IZCBattleRuntimeOptions<typeof runtime> = {
        createRuntime: () => runtime,
        createRuntimeController: instance => ({
            start: () => instance.initialize(), dispose: () => { calls.push('controllerDispose'); },
        }),
    };
    controller.scope.defer(() => calls.push('release'));
    const context = { resources: new ResourceScope('test-battle'), cancelled: false };
    return { controller, runtimeOptions, runtime, calls, context, resolve, reject, get loads() { return loads; }, get loadedParams() { return loadedParams; } };
}

test('battle cancels pending preparation without mounting a late runtime', async () => {
    const h = fixture(), pending = h.controller.adopt(undefined, h.context);
    h.controller.dispose(); h.resolve({}); await assert.rejects(pending, /取消/);
    assert.throws(() => h.controller.mount(h.runtimeOptions));
    assert.deepEqual(h.calls, ['release']);
});
test('battle shuts down view before releasing presentation resources; exit is idempotent', async () => {
    const h = fixture(), pending = h.controller.adopt(undefined, h.context);
    h.resolve({}); await pending; h.controller.mount(h.runtimeOptions); h.controller.mount(h.runtimeOptions);
    assert.equal(h.controller.current, h.runtime);
    h.controller.dispose(); h.controller.dispose();
    assert.equal(h.controller.current, null);
    assert.deepEqual(h.calls, ['initialize', 'controllerDispose', 'shutdown', 'destroy', 'release']);
});
test('battle initialization failure releases runtime and resources', async () => {
    const h = fixture(true), pending = h.controller.adopt(undefined, h.context);
    h.resolve({}); await pending;
    assert.throws(() => h.controller.mount(h.runtimeOptions), /mount failed/);
    assert.deepEqual(h.calls, ['initialize', 'controllerDispose', 'shutdown', 'destroy', 'release']);
});
test('battle result is scoped to runtime, persisted once, and disconnected after exit', async () => {
    const h = fixture(), pending = h.controller.adopt({ pve: { chapterId: 1 } } as ZCGameEntryParams, h.context);
    h.resolve({}); await pending; h.controller.mount(h.runtimeOptions);
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: {}, victory: true });
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: h.runtime, victory: true });
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: h.runtime, victory: false });
    h.controller.dispose();
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.PVE_RESULT, { owner: h.runtime, victory: false });
    assert.equal(h.calls.filter(call => call === 'result').length, 1);
});

test('raw runtime destruction ends the session and releases preloaded resources', async () => {
    const h = fixture(), pending = h.controller.adopt(undefined, h.context);
    h.resolve({}); await pending; h.controller.mount(h.runtimeOptions);
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.RUNTIME_DESTROYED, { owner: {} });
    assert.equal(h.controller.current, h.runtime);
    EventMgr.instance.emit(ZC_BATTLE_EVENTS.RUNTIME_DESTROYED, { owner: h.runtime });
    assert.equal(h.controller.current, null);
    assert.deepEqual(h.calls, ['initialize', 'controllerDispose', 'shutdown', 'destroy', 'release']);
    h.context.resources.dispose();
    assert.equal(h.calls.filter(call => call === 'release').length, 1);
});
test('preload rejection closes the session without creating a runtime', async () => {
    const h = fixture(), pending = h.controller.adopt(undefined, h.context);
    h.reject(new Error('load failed'));
    await assert.rejects(pending, /load failed/);
    assert.deepEqual(h.calls, ['release']);
    assert.throws(() => h.controller.mount(h.runtimeOptions));
});

test('one battle session prepares once and survives source exit after destination adoption', async () => {
    const source = new ResourceScope('matching');
    const h = fixture(false, { owner: source });
    const ready = h.controller.ready;
    assert.equal(h.controller.ready, ready);
    assert.equal(h.loads, 1);
    const entering = h.controller.adopt(undefined, h.context);
    source.dispose();
    assert.equal(h.controller.isDisposed, false);
    h.resolve({});
    await ready; await entering;
    h.controller.mount(h.runtimeOptions);
    assert.equal(h.controller.current, h.runtime);
    await assert.rejects(h.controller.adopt(undefined, h.context), /重复|接管/);
    h.context.resources.dispose();
    assert.deepEqual(h.calls, ['initialize', 'controllerDispose', 'shutdown', 'destroy', 'release']);
});

test('source exit before battle response cancels the same session without loading', async () => {
    const source = new ResourceScope('map');
    let reply: (value: null) => void = () => {};
    const h = fixture(false, { owner: source, battle: new Promise(resolve => { reply = resolve; }) });
    const ready = h.controller.ready;
    source.dispose(); reply(null);
    await assert.rejects(ready, /取消/);
    assert.equal(h.controller.currentPhase, 'leaving');
    assert.equal(h.loads, 0);
    assert.deepEqual(h.calls, ['release']);
});

test('destination cancellation releases a still-loading adopted session and rejects late preparation', async () => {
    const source = new ResourceScope('matching');
    const h = fixture(false, { owner: source });
    const ready = h.controller.ready;
    const entering = h.controller.adopt(undefined, h.context);
    h.context.resources.dispose();
    h.resolve({});
    await assert.rejects(ready, /取消/);
    await entering;
    source.dispose();
    assert.deepEqual(h.calls, ['release']);
    assert.throws(() => h.controller.mount(h.runtimeOptions));
});

test('creation under an expired owner rejects readiness without loading', async () => {
    const source = new ResourceScope('expired');
    source.dispose();
    const h = fixture(false, { owner: source });
    await assert.rejects(h.controller.ready, /取消/);
    assert.equal(h.loads, 0);
    assert.equal(h.controller.isDisposed, true);
});

test('direct session starts with entry params and adoption reuses its preparation', async () => {
    const params = { selfRoleId: 'direct-role' };
    const h = fixture(false, { params });
    assert.equal(h.loadedParams, params);
    assert.equal(h.loads, 1);
    const ready = h.controller.ready;
    const entering = h.controller.adopt(params, h.context);
    h.resolve({});
    await ready; await entering;
    assert.equal(h.loads, 1);
    h.context.resources.dispose();
});

test('partial assembly failure releases the view and session without starting a controller', async () => {
    const h = fixture(); h.resolve({}); await h.controller.ready;
    const failure = new Error('assembly failed');
    assert.throws(() => h.controller.mount({ ...h.runtimeOptions,
        createRuntimeController: () => { throw failure; },
    }), error => error === failure);
    assert.deepEqual(h.calls, ['shutdown', 'destroy', 'release']);
    h.controller.dispose();
    assert.equal(h.calls.filter(call => call === 'release').length, 1);
});

test('controller disposal failure still destroys view and releases session resources', async () => {
    const h = fixture(); h.resolve({}); await h.controller.ready;
    const failure = new Error('controller cleanup failed');
    h.controller.mount({ ...h.runtimeOptions, createRuntimeController: instance => ({
        start: () => instance.initialize(),
        dispose: () => { h.calls.push('controllerDispose'); throw failure; },
    }) });
    assert.throws(() => h.controller.dispose(), error => error === failure);
    h.controller.dispose();
    assert.deepEqual(h.calls, ['initialize', 'controllerDispose', 'shutdown', 'destroy', 'release']);
});

test('initialization failure preserves its cause when controller cleanup also fails', async t => {
    const h = fixture(true); h.resolve({}); await h.controller.ready;
    const log = t.mock.method(console, 'error', () => {});
    assert.throws(() => h.controller.mount({ ...h.runtimeOptions, createRuntimeController: instance => ({
        start: () => instance.initialize(), dispose: () => { throw new Error('cleanup failed'); },
    }) }), /mount failed/);
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(h.calls, ['initialize', 'shutdown', 'destroy', 'release']);
});
