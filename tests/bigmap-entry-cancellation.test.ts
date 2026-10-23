import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { toIdString } from '../assets/script/app/net/RequestGuard';

test('加载配置期间切走页面，取消的世界入口不能稍后弹出覆盖新页', async () => {
    let finishConfig: (config: object) => void = () => undefined;
    const config = new Promise<object>((resolve) => { finishConfig = resolve; });
    let canvasLookups = 0;
    const source = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, console: { warn: () => undefined },
        require: (name: string) => {
            if (name === 'cc') return { director: { getScene: () => { canvasLookups += 1; return null; } } };
            if (name === './BigMapConfigLoader') return { loadBigMapConfig: () => config };
            if (name.endsWith('/MainRoleRow')) return { readRoleRow: () => null };
            return {};
        },
    });
    const Entry = exports.BigMapEntry as new () => { open(config: object): Promise<void>; close(): void };
    const entry = new Entry();
    const opening = entry.open({});
    entry.close();
    finishConfig({});
    await opening;
    assert.equal(canvasLookups, 0);
});

function createOwnerHarness(config: Promise<object> = Promise.resolve({}), layout: Promise<null> = Promise.resolve(null)) {
    let role = { id: '9007199254740993', selectServerId: '1' };
    const owners: unknown[] = [];
    const chapterOwners: unknown[] = [];
    const nodes: FakeNode[] = [];
    const presenters: FakePresenter[] = [];
    let finishPage: (() => void) | null = null;
    let pageWait: Promise<void> | null = null;
    class Transform { setContentSize(): void {} }
    class Widget {}
    class Page { async initialize() { if (pageWait) await pageWait; } }
    class FakeNode {
        isValid = true;
        active = true;
        layer = 0;
        constructor(public name: string) { nodes.push(this); }
        addComponent(type: unknown) { return type === Transform ? new Transform() : type === Widget ? new Widget() : new Page(); }
        setParent(): void {}
        destroy() { this.isValid = false; }
    }
    class FakePresenter {
        constructor(public deps: { adventureChapter(): number }) { presenters.push(this); }
        async initializeSlg(): Promise<boolean> { return true; }
        dispose(): void {}
    }
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console: { warn() {} }, require(name: string) {
        if (name === 'cc') return { Node: FakeNode, UITransform: Transform, Widget,
            Layers: { Enum: { UI_2D: 33554432 } }, view: { getVisibleSize: () => ({ width: 720, height: 1280 }) },
            director: { getScene: () => ({ getChildByName: () => ({}) }) } };
        if (name.endsWith('/MainRoleRow')) return { readRoleRow: () => role };
        if (name.endsWith('/RequestGuard')) return { toIdString };
        if (name === './BigMapConfigLoader') return { loadBigMapConfig: () => config };
        if (name === './BigMapLayoutLoader') return { loadBigMapLayout: () => layout };
        if (name === './BigMapStorage') return { createBigMapStorage: (owner: unknown) => { owners.push(owner); return {}; } };
        if (name === './BigMapPresenter') return { BigMapPresenter: FakePresenter };
        if (name.endsWith('/BigMapPage')) return { BigMapPage: Page };
        if (name === './NpcBigMapRankProvider') return { NpcBigMapRankProvider: class {} };
        if (name === './BigMapCampRepository') return { BigMapCampRepository: class {} };
        if (name === './GameNetBigMapCampGateway') return { GameNetBigMapCampGateway: class {} };
        if (name === './BigMapSlgRepository') return { BigMapSlgRepository: class {} };
        if (name === './GameNetBigMapSlgGateway') return { GameNetBigMapSlgGateway: class {} };
        if (name.endsWith('/TerritoryChapterInfoRepository')) return { TerritoryChapterInfoRepository: { instance: { availableChapters: [1] } } };
        if (name.endsWith('/TerritorySaveStoreAdapter')) return { createTerritorySaveStore: (owner: unknown) => {
            chapterOwners.push(owner); return { loadLastChapter: () => 1 };
        } };
        return {};
    } });
    const Entry = exports.BigMapEntry as new () => {
        open(configs: object): Promise<void>; close(): void; isOpen: boolean; setAssetService(assets: object): void;
    };
    const entry = new Entry();
    return { entry, owners, chapterOwners, presenters, nodes,
        switchRole(id: string, serverId = '1') { role = { id, selectServerId: serverId }; },
        waitPage() { pageWait = new Promise<void>((resolve) => { finishPage = resolve; }); },
        finishPage() { finishPage?.(); pageWait = null; },
    };
}

test('入口把精确角色与区服交给存储，冒险章节使用同一份身份快照', async () => {
    const h = createOwnerHarness();
    await h.entry.open({});
    assert.equal(JSON.stringify(h.owners[0]), JSON.stringify({ roleId: '9007199254740993', serverId: '1' }));
    h.switchRole('B', '2');
    h.presenters[0].deps.adventureChapter();
    assert.equal(JSON.stringify(h.chapterOwners[0]), JSON.stringify({ roleId: '9007199254740993', serverId: '1' }));
    await h.entry.open({});
    assert.equal(h.nodes[0].isValid, false, '换号重开时关闭旧角色页面');
    assert.equal(JSON.stringify(h.owners[1]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    h.entry.close();
});

test('配置加载期间切号，旧入口不创建页面和存档适配器', async () => {
    let finish: (value: object) => void = () => {};
    const h = createOwnerHarness(new Promise((resolve) => { finish = resolve; }));
    const opening = h.entry.open({});
    h.switchRole('B');
    finish({});
    await opening;
    assert.equal(h.nodes.length, 0);
    assert.equal(h.owners.length, 0);
});

test('页面加载期间切号，旧页面不能在加载完成后显示', async () => {
    const h = createOwnerHarness();
    h.waitPage();
    const opening = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.nodes.length, 1);
    h.switchRole('B');
    h.finishPage();
    await opening;
    assert.equal(h.nodes[0].isValid, false);
    assert.equal(h.entry.isOpen, false);
});

test('旧入口仍在加载时新角色重新打开，旧回调不会取消新入口', async () => {
    let finish: (value: object) => void = () => {};
    const h = createOwnerHarness(new Promise((resolve) => { finish = resolve; }));
    const first = h.entry.open({});
    h.switchRole('B', '2');
    const second = h.entry.open({});
    finish({});
    await Promise.all([first, second]);
    assert.equal(h.owners.length, 1);
    assert.equal(JSON.stringify(h.owners[0]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    assert.equal(h.entry.isOpen, true);
    h.entry.close();
});

test('布局加载期间换服，旧入口不创建页面和存档适配器', async () => {
    let finish: (value: null) => void = () => {};
    const h = createOwnerHarness(Promise.resolve({}), new Promise((resolve) => { finish = resolve; }));
    h.entry.setAssetService({});
    const opening = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    h.switchRole('9007199254740993', '2');
    finish(null);
    await opening;
    assert.equal(h.nodes.length, 0);
    assert.equal(h.owners.length, 0);
});

test('旧角色页面初始化期间新角色重开，旧初始化完成不关闭新页', async () => {
    const h = createOwnerHarness();
    h.waitPage();
    const first = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    h.switchRole('B', '2');
    const second = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.nodes[0].isValid, false);
    h.finishPage();
    await Promise.all([first, second]);
    assert.equal(h.nodes[1].isValid, true);
    assert.equal(h.nodes[1].active, true);
    assert.equal(h.entry.isOpen, true);
    assert.equal(JSON.stringify(h.owners[1]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    h.entry.close();
});
