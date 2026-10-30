import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { EventMgr } from '../assets/script/framework/event/EventMgr';

const MAIN_ROOT_URL = 'ui/main/MainRoot';

function loadProcedure(overrides: { noCover?: boolean; loadError?: Error } = {}) {
    const events: Array<{ event: string; payload: unknown }> = [];
    const bus = new EventMgr();
    const emit = bus.emit.bind(bus);
    bus.emit = (event, payload) => { events.push({ event, payload }); emit(event, payload); };
    const loads: Array<{ path: string; type: string }> = [];
    const injections: string[] = [];
    const parents: unknown[] = [];
    let siblingIndex = -1;
    let coverReleased = false;
    let warmupActivated = 0;
    let mainDestroyed = false;
    let opacityAtMount = -1;
    const hostNode = { name: 'host' };
    const hostChildren: unknown[] = [{}, {}];

    class Prefab {
        constructor(public readonly tag: string) {}
    }

    class UIOpacity { opacity = 255; }
    let mainOpacity: UIOpacity | null = null;

    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const whenReady = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

    class MockTabHost {
        activateBackgroundWarmup(): void { assert.ok(overrides.noCover || coverReleased, '先移除登录图'); warmupActivated++; }
        defaultTab = 3;



        get whenFirstScreenReady(): Promise<void> { return whenReady; }
    }

    const mainNode = {
        getComponent: (type: unknown) => type === UIOpacity ? mainOpacity : new MockTabHost(),
        addComponent: (type: new () => UIOpacity) => (mainOpacity = new type()),
        setParent(parent: unknown): void { opacityAtMount = mainOpacity?.opacity ?? 255; parents.push(parent); },
        setPosition(): void {},
        destroy(): void { mainDestroyed = true; },
    };
    const cover = {
        node: { setSiblingIndex(index: number): void { siblingIndex = index; } },
        release(): void { coverReleased = true; },
    };

    const assets = {
        load: (path: string, type: unknown) => {
            loads.push({ path, type: (type as { name?: string }).name ?? '' });
            if (overrides.loadError) return Promise.reject(overrides.loadError);
            return Promise.resolve(new Prefab(path));
        },
    };

    const context = {
        exports: {} as { ProcedureMain: new () => any },
        console: { warn() {}, log() {}, error() {} },
        Error,
        require(name: string) {
            if (name.endsWith('/EventMgr')) return { EventMgr: { instance: bus } };
            if (name.endsWith('/MainLoadingEvents')) return require('../assets/script/app/main/MainLoadingEvents');
            if (name === 'cc') {
                return {
                    Prefab,
                    UIOpacity,
                    Node: class {},
                    Vec3: { ZERO: { x: 0, y: 0, z: 0 } },
                    instantiate: (prefab: Prefab) => {
                        assert.equal(prefab.tag, MAIN_ROOT_URL);
                        return mainNode;
                    },
                };
            }
            if (name.endsWith('/ProcedureBase')) {
                return {
                    ProcedureBase: class {
                        protected get assets(): unknown { return assets; }
                        protected get configs(): unknown { return {}; }
                        protected get sessionAssets(): unknown { return {}; }
                        protected get host(): unknown { return hostNode; }
                        protected releaseResourceScope(): void {}
                        log(): void {}
                        error(): void {}
                    },
                };
            }
            if (name.endsWith('/LaunchProgressUI')) {
                return { LaunchProgressUI: { ensure: () => (overrides.noCover ? null : cover) } };
            }
            if (name.endsWith('/MainTabHost')) {
                return { MainTab: { Territory: 3, World: 6 }, MainTabHost: MockTabHost };
            }
            throw new Error(`unexpected dependency: ${name}`);
        },
    };

    // host.children 用于置顶计算；通过 Object.defineProperty 模拟。
    Object.defineProperty(hostNode, 'children', { get: () => hostChildren });

    const code = ts.transpileModule(readFileSync('assets/script/app/procedure/ProcedureMain.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, context);

    const procedure = new context.exports.ProcedureMain();
    return {
        procedure,
        readyResolve,
        readyReject,
        events,
        loads,
        injections,
        parents,
        hostNode,
        get siblingIndex() { return siblingIndex; },
        get warmupActivated() { return warmupActivated; },
        get coverReleased() { return coverReleased; },
        get mainDestroyed() { return mainDestroyed; },
        get mainOpacity() { return mainOpacity?.opacity ?? 255; },
        get opacityAtMount() { return opacityAtMount; },
    };
}

test('onPreload 加载 MainRoot prefab（Prefab，英文路径）', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.deepEqual(h.loads, [{ path: MAIN_ROOT_URL, type: 'Prefab' }]);
});

test('Main 路由参数只包含数据，不接收加载通知回调', () => {
    const source = readFileSync('assets/script/app/procedure/ProcedureMain.ts', 'utf8');
    assert.doesNotMatch(source, /readonly\s+on(?:Progress|Error)\??\s*:/);
    assert.doesNotMatch(source, /params\?\.on(?:Progress|Error)/);
});

test('预加载通过事件报告进度，路由无需提供回调', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.deepEqual(h.events.map(({ event, payload }) => [event, (payload as { ratio: number }).ratio]), [
        ['main-loading:progress', 0], ['main-loading:progress', 0.3], ['main-loading:progress', 1],
    ]);
});

test('加载失败发布错误事件并保留 rejection 供流程管理器处理', async () => {
    const error = new Error('asset unavailable');
    const h = loadProcedure({ loadError: error });
    await assert.rejects(h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false }), error);
    assert.deepEqual(h.events.filter(({ event }) => event === 'main-loading:failed'), [
        { event: 'main-loading:failed', payload: '主界面加载失败：asset unavailable' },
    ]);
});

test('取消后首屏 ready 不发布完成事件，迟到 rejection 不发布错误事件', async () => {
    for (const reject of [false, true]) {
        const h = loadProcedure();
        const context = { resources: new ResourceScope('test'), cancelled: false };
        const preload = h.procedure.onPreload({}, context);
        await new Promise<void>((resolve) => setImmediate(resolve));
        context.cancelled = true;
        const eventCount = h.events.length;
        if (reject) h.readyReject(new Error('late failure')); else h.readyResolve();
        if (reject) await assert.rejects(preload, /late failure/); else await preload;
        assert.equal(h.events.length, eventCount);
        assert.equal(h.mainDestroyed, true);
    }
});

test('onPreload 实例化 MainRoot、注入依赖并挂到 host，登录图置顶盖住', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.deepEqual(h.injections, []);
    assert.deepEqual(h.parents, [h.hostNode]);
    assert.equal(h.siblingIndex, 1, '登录图应置顶到 host.children 最后');
});

test('onPreload 等待首屏 ready 完成才结束', async () => {
    const h = loadProcedure();
    let done = false;
    const preload = h.procedure
        .onPreload({}, { resources: new ResourceScope('test'), cancelled: false })
        .then(() => { done = true; });
    await Promise.resolve();
    assert.equal(done, false, '首屏 ready 前 onPreload 不应结束');
    h.readyResolve();
    await preload;
    assert.equal(done, true);
});

test('onEnter 移除登录图（release），无登录图时不报错', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.equal(h.warmupActivated, 0, '预加载阶段不预热');
    h.procedure.onEnter();
    assert.equal(h.warmupActivated, 1);
    assert.equal(h.coverReleased, true, 'onEnter 应销毁登录图');

    const h2 = loadProcedure({ noCover: true });
    const preload2 = h2.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h2.readyResolve();
    await preload2;
    assert.doesNotThrow(() => h2.procedure.onEnter());
});

test('onLeave 销毁 MainRoot 节点', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    h.procedure.onLeave();
    assert.equal(h.mainDestroyed, true);
});

test('章节战斗返回：MainRoot 挂载和等待首屏期间不可见，正式进入才完整显示', async () => {
    const h = loadProcedure({ noCover: true });
    const preload = h.procedure.onPreload({ initialTab: 'territory' }, { resources: new ResourceScope('return'), cancelled: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.opacityAtMount, 0, '挂载前必须隐藏外壳，避免先闪出底栏和背景');
    assert.equal(h.mainOpacity, 0, '地图异步准备期间继续保留战斗画面');
    h.readyResolve();
    await preload;
    assert.equal(h.mainOpacity, 0, 'ready 只完成准备，不能提前盖住旧流程');
    h.procedure.onEnter();
    assert.equal(h.mainOpacity, 255, '流程切换时一次显示完整首屏');
});

test('战斗返回预加载取消或失败后，不会露出未就绪的 MainRoot', async () => {
    for (const reject of [false, true]) {
        const h = loadProcedure({ noCover: true });
        const context = { resources: new ResourceScope('return-cancel'), cancelled: false };
        const preload = h.procedure.onPreload({ initialTab: 'territory' }, context);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(h.mainOpacity, 0);
        if (reject) {
            h.readyReject(new Error('首屏失败'));
            await assert.rejects(preload, /首屏失败/);
        } else {
            context.cancelled = true;
            h.procedure.onPreloadCancelled();
            h.readyResolve();
            await preload;
        }
        assert.equal(h.mainDestroyed, true);
        assert.equal(h.mainOpacity, 0);
        assert.equal(h.warmupActivated, 0);
    }
});
