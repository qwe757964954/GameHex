import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

test('页面初始化的完成信号必须等待美术加载，而不是仅完成线框搭建', async () => {
    let finishArt: () => void = () => undefined;
    const artReady = new Promise<void>((resolve) => { finishArt = resolve; });
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        return {};
    } });
    const Page = exports.BigMapPage as new () => {
        buildUi(): void; refreshAll(): void; loadArt(): Promise<void>; loadWorldView(): Promise<void>; isValid: boolean;
        initialize(presenter: object, onClose: null, assets: object): Promise<void>;
    };
    const page = new Page();
    page.isValid = true;
    page.loadWorldView = async () => undefined;
    page.buildUi = () => undefined;
    page.refreshAll = () => undefined;
    page.loadArt = () => artReady;
    let finished = false;
    const initialization = Promise.resolve(page.initialize({ onChanged: () => () => undefined }, null, {}))
        .then(() => { finished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    try { assert.equal(finished, false); }
    finally { finishArt(); await initialization; }
    assert.equal(finished, true);
});

for (const fails of [false, true]) test(`地图预制体加载期间关闭页面，迟到${fails ? '失败' : '资源'}不实例化节点或搭建页面`, async () => {
    let finishPrefab: (value: object) => void = () => undefined;
    let failPrefab: (error: Error) => void = () => undefined;
    const prefabReady = new Promise<object>((resolve, reject) => { finishPrefab = resolve; failPrefab = reject; });
    let instances = 0;
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value },
            Component: class { isValid = true; }, Prefab: class {}, instantiate: () => { instances += 1; } };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        return {};
    } });
    const Page = exports.BigMapPage as new () => {
        isValid: boolean; artScope: ResourceScope; buildUi(): void;
        initialize(presenter: object, close: null, assets: object): Promise<void>;
    };
    const page = new Page();
    let built = false;
    page.buildUi = () => { built = true; };
    const paths: string[] = [];
    const opening = page.initialize({}, null, { load: (path: string) => { paths.push(path); return prefabReady; } });
    assert.deepEqual(paths, ['ui/bigmap/BigMapWorldView']);
    page.isValid = false;
    page.artScope.dispose();
    if (fails) failPrefab(new Error('load failed after close'));
    else finishPrefab({});
    await opening;
    assert.equal(instances, 0);
    assert.equal(built, false);
});

function createEntryHarness() {
    let finishArt: () => void = () => undefined;
    const artReady = new Promise<void>((resolve) => { finishArt = resolve; });
    let navigationMounts = 0;
    class UITransform {
        width = 720;
        height = 1466;
        setContentSize(width: number, height: number) { this.width = width; this.height = height; }
    }
    class Widget {}
    class Page { initialize() { return artReady; } }
    class FakeNode {
        active = true;
        isValid = true;
        parent: FakeNode | null = null;
        components = new Map<unknown, unknown>();
        children: FakeNode[] = [];
        addComponent<T>(Component: new () => T): T {
            const component = new Component();
            this.components.set(Component, component);
            return component;
        }
        getComponent(Component: unknown) { return this.components.get(Component); }
        setParent(parent: FakeNode) { this.parent = parent; parent.children.push(this); }
        destroy() { this.isValid = false; }
    }
    const canvas = new FakeNode();
    const navigation = new FakeNode();
    navigation.addComponent(UITransform).height = 150;
    navigation.setParent(canvas);
    const source = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, console,
        require: (name: string) => {
            if (name === 'cc') return { Node: FakeNode, UITransform, Widget,
                Layers: { Enum: { UI_2D: 1 } }, view: { getVisibleSize: () => ({ width: 720, height: 1466 }) },
                director: { getScene: () => ({ getChildByName: () => canvas }) } };
            if (name === './BigMapConfigLoader') return { loadBigMapConfig: async () => ({}) };
            if (name === './BigMapLayoutLoader') return { loadBigMapLayout: async () => null };
            if (name === './BigMapPresenter') return { BigMapPresenter: class { dispose() {} async initializeSlg() { return true; } } };
            if (name === './BigMapCampRepository') return { BigMapCampRepository: class {} };
            if (name === './GameNetBigMapCampGateway') return { GameNetBigMapCampGateway: class {} };
            if (name === './NpcBigMapRankProvider') return { NpcBigMapRankProvider: class {} };
            if (name === './BigMapStorage') return { createBigMapStorage: () => ({}) };
            if (name.endsWith('/MainRoleRow')) return { readRoleRow: () => null };
            if (name === '../view/BigMapPage') return { BigMapPage: Page };
            if (name === '../view/BigMapNavigation') return { mountBigMapNavigation: () => {
                navigationMounts += 1;
                return { restore: () => undefined };
            } };
            return {};
        },
    });
    const Entry = exports.BigMapEntry as new () => {
        root: FakeNode | null;
        setAssetService(assets: object): void;
        open(configs: object, options: object): Promise<void>;
        close(): void;
    };
    const entry = new Entry();
    entry.setAssetService({});
    return { entry, navigation, canvas, finishArt, mounts: () => navigationMounts };
}

test('美术准备期间隐藏线框页且不借走底栏，准备完成后一次显示成品页', async () => {
    const harness = createEntryHarness();
    const opening = harness.entry.open({}, { navigation: harness.navigation });
    await new Promise((resolve) => setImmediate(resolve));
    try {
        assert.equal(harness.entry.root?.active, false);
        assert.equal(harness.mounts(), 0);
        assert.equal(harness.navigation.parent, harness.canvas);
    } finally {
        harness.finishArt();
        await opening;
    }
    assert.equal(harness.entry.root?.active, true);
    assert.equal(harness.mounts(), 1);
});

test('美术准备期间切走，迟到的准备完成不能激活旧页或借走新页底栏', async () => {
    const harness = createEntryHarness();
    const opening = harness.entry.open({}, { navigation: harness.navigation });
    await new Promise((resolve) => setImmediate(resolve));
    const root = harness.entry.root;
    harness.entry.close();
    harness.finishArt();
    await opening;
    assert.equal(harness.entry.root, null);
    assert.equal(root?.isValid, false);
    assert.equal(harness.mounts(), 0);
    assert.equal(harness.navigation.parent, harness.canvas);
});
