import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { createControllerContext } from './helpers/controller-context';

class Controller extends ControllerBase {
    constructor(context: ReturnType<typeof createControllerContext>) { super(context, 'test-controller'); }
}

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
