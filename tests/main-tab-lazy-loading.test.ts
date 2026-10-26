import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

function harness() {
    const scheduled: (() => void)[] = [];
    let worldOpened = false, warmups = 0, firstRechargeChecks = 0;
    const buttons: { tabType: number; select?: () => void; setEnabled(): void; bindSelect(callback: () => void): void; bindRedDotExpr(): void; node: { position: { x: number } } }[] = [6].map(tabType => ({ tabType, node: { position: { x: 0 } }, setEnabled() {}, bindSelect(callback) { this.select = callback; }, bindRedDotExpr() {} }));
    const requests: { path: string; bundle: string | undefined; scope: ResourceScope; resolve(value: object): void; reject(error: Error): void }[] = [];
    const pages: { name: string; destroyed: boolean }[] = [];
    const createdNodes: { name: string; isValid: boolean }[] = [];
    let embeddedMap: { onFirstReady(callback: () => void): void } | null = null;
    const selected: number[] = [];
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, console: { warn() {} }, require(name: string) {
        if (name === 'cc') {
            class MockNode {
                public name: string;
                public isValid = true;
                public layer = 0;
                private readonly comps: unknown[] = [];
                constructor(nodeName = '') { this.name = nodeName; createdNodes.push(this); }
                addComponent<T>(component: new () => T): T {
                    const instance = new component();
                    this.comps.push(instance);
                    return instance;
                }
                getComponentByName<T>(name: string): T | null {
                    return (this.comps.find((entry) => entry.constructor.name === name) as T) ?? null;
                }
                componentNames(): string[] {
                    return this.comps.map((entry) => entry.constructor.name);
                }
                setParent(): void {}
                destroy(): void { this.isValid = false; }
            }
            return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
                Component: class {
                    isValid = true;
                    scheduleOnce(callback: () => void): void { scheduled.push(callback); }
                    schedule(callback: () => void): void { scheduled.push(callback); }
                    unschedule(callback: () => void): void {
                        const index = scheduled.indexOf(callback);
                        if (index >= 0) scheduled.splice(index, 1);
                    }
                },
                Vec3: { ZERO: {} }, Prefab: class {}, Node: MockNode,
                Color: class { constructor(public r = 0, public g = 0, public b = 0, public a = 255) {} },
                UITransform: class { setContentSize(): void {} },
                Widget: class {
                    static AlignMode = { ON_WINDOW_RESIZE: 2, ALWAYS: 1, ONCE: 0 };
                    isAlignTop = false; isAlignBottom = false; isAlignLeft = false; isAlignRight = false;
                    isAlignHorizontalCenter = false; isAlignVerticalCenter = false;
                    top = 0; bottom = 0; left = 0; right = 0;
                },
                Graphics: class { fillColor: unknown; clear(): void {} rect(): void {} fill(): void {} },
                BlockInputEvents: class {},
                Layers: { Enum: { UI_2D: 33554432 } },
                Sprite: class {
                    static SizeMode = { RAW: 0, CUSTOM: 1, TRIMMED: 2 };
                    public sizeMode = 0;
                    private frame: unknown = null;
                    get spriteFrame(): unknown { return this.frame; }
                    set spriteFrame(value: unknown) { this.frame = value; }
                },
                SpriteFrame: class {},
                UIOpacity: class { opacity = 255; },
                view: { getVisibleSize: () => ({ width: 480, height: 800 }) },
                tween: () => {
                    const chain: { to(): typeof chain; call(fn: () => void): typeof chain; start(): void; fn: (() => void) | null } = {
                        to() { return chain; },
                        call(fn) { chain.fn = fn; return chain; },
                        start() { if (chain.fn) chain.fn(); },
                        fn: null,
                    };
                    return chain;
                },
                instantiate: (prefab: { name: string }) => {
                    const node = { name: prefab.name, destroyed: false, getComponent: () => null, getComponentInChildren: () => embeddedMap,
                        setParent() {}, setPosition() {}, destroy() { this.destroyed = true; } };
                    pages.push(node);return node;
                } };
        }
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { MAIN_PAGES_BUNDLE: 'main-pages' };
        if (name.endsWith('/BigMapEntry')) return { BigMapEntry: { shared: () => ({ get isOpen() { return worldOpened; }, open: async () => { worldOpened = true; }, close() { worldOpened = false; } }) } };
        if (name.endsWith('/MainTabItems')) return { mainTabItem: () => ({}) };
        if (name.endsWith('/FirstRechargeAutoOpen')) return { checkFirstRechargeOnEnterMain: async () => { firstRechargeChecks++; } };
        return {};
    } });
    const Host = exports.MainTabHost as new () => {
        onLoad(): void; navBar: unknown; defaultTab: number; setConfigService(configs: object): void; setSessionAssetService(service: object): void;
        setAssetService(assets: object): void;
        switchTab(index: number): Promise<void>; onDestroy(): void;
        renderNav(index: number): void; currentTab: number; currentPage: unknown;
        whenFirstScreenReady: Promise<void>;
    };
    const host = new Host();host.renderNav = (index) => { selected.push(index); };
    host.setAssetService({ load: (path: string, _type: unknown, options: { scope: ResourceScope; bundle?: string }) => new Promise((resolve,reject) => {
        requests.push({path,bundle:options.bundle,scope:options.scope,resolve,reject});
    }) });
    host.navBar = { getComponentsInChildren: () => buttons };
    host.setConfigService({});
    host.setSessionAssetService({ pauseWarmup() {}, warmup: async () => { warmups++; } });
    const attachMap = () => {
        let ready: (() => void) | null = null;
        embeddedMap = {
            setSessionAssetService() {},
            initialize() {},
            onFirstReady(callback) { ready = callback; },
        };
        return { fireReady() { if (ready) ready(); } };
    };
    return { host, requests, pages, selected, buttons, scheduled, createdNodes, attachMap, get warmups() { return warmups; }, get firstRechargeChecks() { return firstRechargeChecks; }, get worldOpened() { return worldOpened; } };
}

test('主城页走首包、功能页走 main-pages bundle', async () => {
    const h = harness();
    const arena = h.host.switchTab(3);
    assert.deepEqual(h.requests.map(r=>[r.path,r.bundle]), [['ui/main/ArenaRoot', undefined]]);
    h.requests[0].resolve({name:'arena'}); await arena;
    const shop = h.host.switchTab(0);
    assert.deepEqual(h.requests.map(r=>[r.path,r.bundle]).slice(1), [['ui/Store/Store', 'main-pages']]);
    h.requests[1].resolve({name:'store'}); await shop;
    assert.equal(h.host.currentTab, 0);
    h.host.onDestroy();
});

test('MainRoot 不再强引用五个功能页，首屏只请求主城页', async () => {
    const prefab = readFileSync('assets/resources/ui/main/MainRoot.prefab','utf8');
    for (const field of ['arenaPage','rolePage','roleMainPage','alliancePage','shopPage']) {
        assert.ok(!prefab.includes(`"${field}"`), `${field} 会把未打开页面带进首屏依赖`);
    }
    const h=harness();const task=h.host.switchTab(3);
    assert.deepEqual(h.requests.map(r=>r.path),['ui/main/ArenaRoot']);
    h.requests[0].resolve({name:'arena'});await task;
    assert.equal(h.host.currentTab,3);h.host.onDestroy();
});

test('快速切页和重复点击只显示最后目标，过期资源释放', async () => {
    const h=harness();const first=h.host.switchTab(0),duplicate=h.host.switchTab(0),last=h.host.switchTab(2);
    assert.equal(h.requests.length,2);
    assert.equal(h.requests[0].scope.disposed,true);
    h.requests[1].resolve({name:'role'});await last;
    h.requests[0].resolve({name:'shop'});await Promise.all([first,duplicate]);
    assert.deepEqual(h.pages.map(p=>p.name),['role']);assert.deepEqual(h.selected,[2]);
    h.host.onDestroy();assert.equal(h.requests[1].scope.disposed,true);
});

test('新页失败保留当前页，销毁宿主后迟到完成不能创建页面', async () => {
    const h=harness();const first=h.host.switchTab(3);h.requests[0].resolve({name:'arena'});await first;
    const failed=h.host.switchTab(0);h.requests[1].reject(new Error('offline'));await failed;
    assert.equal(h.pages[0].destroyed,false);assert.equal(h.host.currentTab,3);
    const late=h.host.switchTab(2);h.host.onDestroy();h.requests[2].resolve({name:'role'});await late;
    assert.equal(h.pages.length,1);assert.equal(h.requests[2].scope.disposed,true);
});


test('真实世界按钮取消未完成切页，迟到页不能覆盖世界高亮', async () => {
    const h = harness(); h.host.defaultTab = 3; h.host.onLoad();
    await h.buttons[0].select!();
    assert.equal(h.requests[0].scope.disposed, true);
    h.requests[0].resolve({ name: 'late-arena' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.pages, []);
    assert.deepEqual(h.selected, [6]);
    assert.equal(h.worldOpened, true);
    h.host.onDestroy();
});

test('首屏失败或被另一前台切页取消后不弹首充、不重新派发预热', async () => {
    for (const cancelled of [false, true]) {
        const h = harness(); h.host.defaultTab = 3; h.host.onLoad();
        const other = cancelled ? h.host.switchTab(2) : null;
        if (cancelled) h.requests[0].resolve({ name: 'late-arena' });
        else h.requests[0].reject(new Error('offline'));
        await new Promise(resolve => setImmediate(resolve));
        for (const callback of h.scheduled) callback();
        assert.equal(h.firstRechargeChecks, 0);
        assert.equal(h.warmups, 0);
        if (other) { h.requests[1].resolve({ name: 'role' }); await other; }
        h.host.onDestroy();
    }
});

test('首屏 ready Promise 在默认页首次 ready 并渲染一帧后 resolve', async () => {
    const h = harness();
    const map = h.attachMap();
    h.host.defaultTab = 3;
    let resolved = false;
    void h.host.whenFirstScreenReady.then(() => { resolved = true; });
    h.host.onLoad();
    const task = h.host.switchTab(3);
    h.requests[0].resolve({ name: 'arena' });
    await task;
    assert.equal(resolved, false, '页面 ready 前首屏 Promise 不应 resolve');
    map.fireReady();
    assert.equal(resolved, false, '当帧只登记下一帧回调，尚未 resolve');
    for (const callback of h.scheduled) callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, true, '引擎渲染一帧后首屏 Promise resolve');
    h.host.onDestroy();
});

test('首屏 ready 信号丢失时兜底回调强制 resolve，避免永久卡死', async () => {
    const h = harness();
    h.attachMap();
    h.host.defaultTab = 3;
    let resolved = false;
    void h.host.whenFirstScreenReady.then(() => { resolved = true; });
    h.host.onLoad();
    h.scheduled[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolved, true, '兜底回调应强制结束首屏等待');
    h.host.onDestroy();
});
