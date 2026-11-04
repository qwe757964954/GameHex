import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { VIEW_LIFECYCLE } from '../assets/script/framework/ui/ViewLifecycle';
import { MainTabEvent } from '../assets/script/app/main/MainTabEvents';
import { MainTabController } from '../assets/script/app/main/MainTabController';
import { MainTab } from '../assets/script/app/main/MainTabModel';
import { createControllerContext } from './helpers/controller-context';
import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

interface IEntryOptions {
    parent?: unknown;
    bottomInset?: number;
    navigation?: unknown;
    onClose?: () => void;
}

interface IMainTabHostHarness {
    configs: object | null;
    currentTab: number;
    currentPage: object;
    content: object;
    navBar: object;
    openBigMap(): void;
    closeBigMap(): void;
    switchTab(index: number): Promise<void>;
    renderNav(index: number): void;
}

async function makeHost(currentTab = 3) {
    const context = createControllerContext();
    const calls: { configs: object; options: IEntryOptions }[] = [];
    const nav: number[] = [];
    const entry = { isOpen: false, closeCalls: 0, close() { this.closeCalls += 1; },
        open: async (configs: object, options: IEntryOptions) => { calls.push({ configs, options }); } };
    const source = readFileSync('assets/script/app/bootstrap/main/MainTabsComposition.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports, console,
        require: (name: string) => {
            if (name.endsWith('/ControllerBase')) return { ControllerBase };
            if (name.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE };
            if (name.endsWith('/MainTabEvents')) return { MainTabEvent };
            if (name.endsWith('/MainTabHost')) return { MainTab };
            if (name.endsWith('/MainPageComposition')) return { MainPageComposition: class { territory = null; dispose() {} } };
            if (name.endsWith('/ComponentController')) return componentControllerModule(context);
            if (name.endsWith('/MainTabController')) return { MainTabController };
            if (name.endsWith('/MainTabModel')) return { MainTab };
            if (name.endsWith('/FormationService')) return { fetchFormations: async () => {} };
            if (name === 'cc') return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Component: class { isValid = true; }, Node: class {}, Prefab: class {}, UITransform: class {}, CCInteger: 0,
                instantiate: () => ({ getComponent() { return null; }, getComponentInChildren() { return null; }, setParent() {}, setPosition() {}, destroy() {} }), Vec3: { ZERO: {} },
            };
            if (name.endsWith('/BigMapEntry')) return { BigMapEntry: { shared: () => entry } };
            if (name === './MainTabItems') return { mainTabItem: () => undefined };
            return {};
        },
    });
    const host = {
        content: { name: 'Content' }, navBar: { getComponent: () => ({ height: 150 }) },
        currentPage: null as object | null,
        mountPage(node: object) { this.currentPage = node; },
        renderNav(index: number) { nav.push(index); },
        get currentTab() { return composition.tabs.snapshot.currentTab; },
        switchTab(index: number) { return composition.tabs.switchTab(index); },
    };
    const Composition = moduleExports.MainTabsComposition as new (context: unknown, host: unknown) => { tabs: MainTabController<unknown> };
    const composition = new Composition(context, host);
    await host.switchTab(currentTab); nav.length = 0; entry.closeCalls = 0;
    return { host, calls, nav, entry, context };
}

test('主界面世界按钮走 Canvas 全屏入口，不再传主城父节点和底栏留白', async () => {
    const { host, calls, nav, context } = await makeHost();
    await host.switchTab(6);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].configs, context.configs);
    assert.equal(calls[0].options.parent, undefined);
    assert.equal(calls[0].options.bottomInset, undefined);
    assert.equal(calls[0].options.navigation, host.navBar);
    assert.deepEqual(nav, [6]);
    calls[0].options.onClose?.();
    assert.deepEqual(nav, [6, 3]);
});

test('大地图已打开时重复入口不创建第二层页面', async () => {
    const { host, calls, entry } = await makeHost();
    entry.isOpen = true;
    await host.switchTab(6);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0);
});

test('切换主导航也会取消尚未创建根节点的世界入口', async () => {
    const { host, entry } = await makeHost();
    await host.switchTab(3);
    assert.equal(entry.closeCalls, 1);
});

// 2026-11-04 角色(2) / 联盟(5) 进未开放名单 ⇒ 只剩 0 商店 / 1 英雄 / 3 领地 三个可切底页。
for (const currentTab of [0, 1, 3]) {
    test(`从第 ${currentTab} 页打开世界不切换底页，关闭后保留原页`, async () => {
        const { host, calls, nav } = await makeHost(currentTab);
        const originalPage = host.currentPage;
        const switches: number[] = [];
        await host.switchTab(6);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(switches, []);
        assert.equal(host.currentTab, currentTab);
        assert.equal(host.currentPage, originalPage);
        assert.equal(calls.length, 1);
        assert.deepEqual(nav, [6]);
        calls[0].options.onClose?.();
        assert.deepEqual(nav, [6, currentTab]);
    });
}
