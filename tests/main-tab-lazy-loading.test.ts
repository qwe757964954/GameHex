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
    const selected: number[] = [];
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, console: { warn() {} }, require(name: string) {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            Component: class { isValid = true; scheduleOnce(callback: () => void) { scheduled.push(callback); } }, Vec3: { ZERO: {} }, Prefab: class {},
            instantiate: (prefab: { name: string }) => {
                const node = { name: prefab.name, destroyed: false, getComponent: () => null, getComponentInChildren: () => null,
                    setParent() {}, setPosition() {}, destroy() { this.destroyed = true; } };
                pages.push(node);return node;
            } };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { MAIN_PAGES_BUNDLE: 'main-pages' };
        if (name.endsWith('/BigMapEntry')) return { BigMapEntry: { shared: () => ({ get isOpen() { return worldOpened; }, open: async () => { worldOpened = true; }, close() { worldOpened = false; } }) } };
        if (name.endsWith('/MainTabItems')) return { mainTabItem: () => ({}) };
        if (name.endsWith('/FirstRechargeAutoOpen')) return { checkFirstRechargeOnEnterMain: async () => { firstRechargeChecks++; } };
        return {};
    } });
    const Host = exports.MainTabHost as new () => {
        onLoad(): void; navBar: unknown; defaultTab: number; setConfigService(configs: object): void; setSessionAssetService(service: object): void;
        setAssetService(assets: object): void; switchTab(index: number): Promise<void>; onDestroy(): void;
        renderNav(index: number): void; currentTab: number;
    };
    const host = new Host();host.renderNav = (index) => { selected.push(index); };
    host.setAssetService({ load: (path: string, _type: unknown, options: { scope: ResourceScope; bundle?: string }) => new Promise((resolve,reject) => {
        requests.push({path,bundle:options.bundle,scope:options.scope,resolve,reject});
    }) });
    host.navBar = { getComponentsInChildren: () => buttons };
    host.setConfigService({});
    host.setSessionAssetService({ pauseWarmup() {}, warmup: async () => { warmups++; } });
    return { host, requests, pages, selected, buttons, scheduled, get warmups() { return warmups; }, get firstRechargeChecks() { return firstRechargeChecks; }, get worldOpened() { return worldOpened; } };
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
