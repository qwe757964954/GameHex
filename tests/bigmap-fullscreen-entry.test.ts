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

function makeHost() {
    const calls: { configs: object; options: IEntryOptions }[] = [];
    const nav: number[] = [];
    const entry = { isOpen: false, closeCalls: 0, close() { this.closeCalls += 1; },
        open: async (configs: object, options: IEntryOptions) => { calls.push({ configs, options }); } };
    const source = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports, console,
        require: (name: string) => {
            if (name === 'cc') return {
                _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined },
                Component: class {}, Node: class {}, Prefab: class {}, UITransform: class {}, CCInteger: 0,
            };
            if (name.endsWith('/BigMapEntry')) return { BigMapEntry: { shared: () => entry } };
            if (name === './MainTabItems') return { mainTabItem: () => undefined };
            return {};
        },
    });
    const Host = moduleExports.MainTabHost as new () => IMainTabHostHarness;
    const host = new Host();
    host.configs = {};
    host.currentTab = 3;
    host.currentPage = { name: 'ArenaRoot' };
    host.content = { name: 'Content' };
    host.navBar = { getComponent: () => ({ height: 150 }) };
    host.switchTab = async (index) => { host.currentTab = index; };
    host.renderNav = (index) => { nav.push(index); };
    return { host, calls, nav, entry };
}

test('主界面世界按钮走 Canvas 全屏入口，不再传主城父节点和底栏留白', async () => {
    const { host, calls, nav } = makeHost();
    host.openBigMap();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].configs, host.configs);
    assert.equal(calls[0].options.parent, undefined);
    assert.equal(calls[0].options.bottomInset, undefined);
    assert.equal(calls[0].options.navigation, host.navBar);
    assert.deepEqual(nav, [6]);
    calls[0].options.onClose?.();
    assert.deepEqual(nav, [6, 3]);
});

test('大地图已打开时重复入口不创建第二层页面', async () => {
    const { host, calls, entry } = makeHost();
    entry.isOpen = true;
    host.openBigMap();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0);
});

test('切换主导航也会取消尚未创建根节点的世界入口', () => {
    const { host, entry } = makeHost();
    host.closeBigMap();
    assert.equal(entry.closeCalls, 1);
});

for (const currentTab of [0, 1, 2, 3, 5]) {
    test(`从第 ${currentTab} 页打开世界不切换底页，关闭后保留原页`, async () => {
        const { host, calls, nav } = makeHost();
        host.currentTab = currentTab;
        const originalPage = host.currentPage;
        const switches: number[] = [];
        host.switchTab = async (index) => {
            switches.push(index);
            host.currentTab = index;
            host.currentPage = { name: 'ReplacementPage' };
        };
        host.openBigMap();
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
