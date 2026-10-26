import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

const MAIN_ROOT_URL = 'ui/main/MainRoot';

function loadProcedure(overrides: { noCover?: boolean } = {}) {
    const loads: Array<{ path: string; type: string }> = [];
    const injections: string[] = [];
    const parents: unknown[] = [];
    let siblingIndex = -1;
    let coverReleased = false;
    let mainDestroyed = false;
    const hostNode = { name: 'host' };
    const hostChildren: unknown[] = [{}, {}];

    class Prefab {
        constructor(public readonly tag: string) {}
    }

    let readyResolve!: () => void;
    const whenReady = new Promise<void>((resolve) => { readyResolve = resolve; });

    class MockTabHost {
        defaultTab = 3;
        setAssetService(): void { injections.push('assets'); }
        setConfigService(): void { injections.push('configs'); }
        setSessionAssetService(): void { injections.push('session'); }
        get whenFirstScreenReady(): Promise<void> { return whenReady; }
    }

    const mainNode = {
        getComponent: () => new MockTabHost(),
        setParent(parent: unknown): void { parents.push(parent); },
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
            return Promise.resolve(new Prefab(path));
        },
    };

    const context = {
        exports: {} as { ProcedureMain: new () => any },
        console: { warn() {}, log() {}, error() {} },
        require(name: string) {
            if (name === 'cc') {
                return {
                    Prefab,
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
        loads,
        injections,
        parents,
        hostNode,
        get siblingIndex() { return siblingIndex; },
        get coverReleased() { return coverReleased; },
        get mainDestroyed() { return mainDestroyed; },
    };
}

test('onPreload 加载 MainRoot prefab（Prefab，英文路径）', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.deepEqual(h.loads, [{ path: MAIN_ROOT_URL, type: 'Prefab' }]);
});

test('onPreload 实例化 MainRoot、注入依赖并挂到 host，登录图置顶盖住', async () => {
    const h = loadProcedure();
    const preload = h.procedure.onPreload({}, { resources: new ResourceScope('test'), cancelled: false });
    h.readyResolve();
    await preload;
    assert.deepEqual(h.injections, ['assets', 'configs', 'session']);
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
    h.procedure.onEnter();
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
