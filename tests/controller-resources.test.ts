import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

class Controller extends ControllerBase {
    constructor(context: ReturnType<typeof createControllerContext>) { super(context, 'test-controller'); }
    register(stop: () => void): void { this.own(stop); }
    subscribe(event: string, handler: () => void): void { this.listen(event, handler); }
}

test('controller detaches all event inputs before cleanup can emit or subscribe again', () => {
    const controller = new Controller(createControllerContext());
    const calls: string[] = [];
    const event = 'controller-cleanup-test';
    controller.subscribe(event, () => calls.push('input'));
    EventMgr.instance.on(event, () => calls.push('owned-input'), controller);
    controller.register(() => {
        calls.push('cleanup');
        EventMgr.instance.emit(event);
        controller.subscribe(event, () => calls.push('late-input'));
    });
    try {
        controller.dispose();
        controller.dispose();
        EventMgr.instance.emit(event);
        assert.deepEqual(calls, ['cleanup']);
    } finally {
        EventMgr.instance.offTarget(controller);
    }
});

test('controller detaches inputs before releasing resources and accepts late cleanup exactly once', () => {
    const controller = new Controller(createControllerContext());
    const calls: string[] = [];
    controller.scope.defer(() => { EventMgr.instance.emit('controller-test'); calls.push('asset'); });
    controller.subscribe('controller-test', () => calls.push('input'));
    controller.register(() => calls.push('timer'));
    EventMgr.instance.emit('controller-test');
    controller.dispose(); controller.dispose();
    controller.register(() => calls.push('late'));
    EventMgr.instance.emit('controller-test');
    assert.deepEqual(calls, ['input', 'timer', 'asset', 'late']);
    assert.equal(controller.isDisposed, true);
});

test('controller resources always exist and default loads belong to the controller', async () => {
    const context = createControllerContext();
    const scopes: ResourceScope[] = [];
    context.assets.load = async (_path, Type, options) => {
        scopes.push(options!.scope!);
        return new Type();
    };
    const controller = new Controller(context);
    await controller.resources.assets.load('frame', class {});
    assert.equal(scopes[0], controller.resources.scope);
    assert.equal(controller.resources.configs, context.configs);
    controller.dispose(); controller.dispose();
    assert.equal(scopes[0].disposed, true);
    await assert.rejects(controller.resources.assets.load('late', class {}), /取消|释放/);
    assert.equal(scopes.length, 1);
});

test('battle resources survive controller disposal when explicitly transferred', async () => {
    const context = createControllerContext();
    const battle = new ResourceScope('battle');
    let released = 0;
    context.assets.load = async (_path, Type, options) => {
        options!.scope!.defer(() => { released++; });
        return new Type();
    };
    const controller = new Controller(context);
    await controller.resources.assets.load('battle', class {}, { scope: battle });
    controller.dispose();
    assert.equal(released, 0);
    battle.dispose();
    assert.equal(released, 1);
});

test('late loads release their references and never reach a disposed controller', async () => {
    const context = createControllerContext();
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let references = 0;
    context.assets.load = async (_path, Type, options) => {
        await pending;
        references++;
        options!.scope!.defer(() => { references--; });
        return new Type();
    };
    const controller = new Controller(context);
    const loading = controller.resources.assets.load('late', class {});
    controller.dispose();
    finish();
    await assert.rejects(loading, /取消|释放/);
    assert.equal(references, 0);
});

test('component controller can be constructed before runtime setup and disposed without resolving services', () => {
    let resolutions = 0;
    class LazyController extends ControllerBase {
        constructor() { super(() => { resolutions++; return createControllerContext(); }, 'lazy'); }
    }
    const unused = new LazyController();
    assert.equal(resolutions, 0);
    unused.dispose();
    assert.equal(resolutions, 0);
    const active = new LazyController();
    assert.ok(active.resources.assets);
    assert.equal(active.resources, active.resources);
    assert.equal(resolutions, 1);
    active.dispose();
});
