import { CHEST_EVENTS } from '../assets/script/app/main/ChestEvents';
import { componentControllerModule } from './helpers/controller-context';
import { createControllerContext } from './helpers/controller-context';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/territory/application/TerritoryEvents';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { MainPage } from '../assets/script/app/main/MainPage';
import type { MainTerritoryMap } from '../assets/script/app/main/MainTerritoryMap';
import * as chestTypes from '../assets/script/app/main/ChestTypes';
import * as battleStart from '../assets/script/app/battle/BattleStartModel';
import {
    buildTerritoryMapLayout,
    territoryMapContentPaddingBottom,
    territoryMapContentPaddingTop,
    territoryMapOffsetForCell,
} from '../assets/script/app/territory/model/TerritoryMapLayout';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';

function loadComponent<T>(name: string, imports: Record<string, unknown>): new () => T {
    const exports: Record<string, new () => T> = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/main/${name}.ts`, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, { exports, require: (id: string) => id.endsWith('/ComponentController') ? componentControllerModule() : imports[id] ?? {} });
    assert.ok(exports[name]);
    return exports[name];
}

const cc = {
    _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
    Component: class {},
    Button: { EventType: { CLICK: 'click' } },
    UITransform: class { setContentSize(): void {} },
    Vec2: class { constructor(readonly x: number, readonly y: number) {} },
    Color: class { constructor(public r = 0, public g = 0, public b = 0, public a = 255) {} },
    Node: class {
        public isValid = true;
        public layer = 0;
        private readonly comps: unknown[] = [];
        constructor(public name = '') {}
        addComponent<T>(component: new () => T): T {
            const instance = new component();
            this.comps.push(instance);
            return instance;
        }
        setParent(): void {}
        destroy(): void { this.isValid = false; }
    },
    Widget: class {
        isAlignTop = false; isAlignBottom = false; isAlignLeft = false; isAlignRight = false;
        top = 0; bottom = 0; left = 0; right = 0;
    },
    Graphics: class { fillColor: unknown; clear(): void {} rect(): void {} fill(): void {} },
    BlockInputEvents: class {},
    Layers: { Enum: { UI_2D: 33554432 } },
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
};

test('quick-find button invokes the injected map action without navigating to matching', () => {
    const routes: unknown[] = [];
    let findCount = 0;
    let click: (() => void) | undefined;
    const Page = loadComponent<MainPage>('MainPage', {
        cc,
        '../../core/asset/ResourceScope': { ResourceScope },
        './ChestTypes': chestTypes,
        './ChestEvents': { CHEST_EVENTS },
        '../territory/application/TerritoryEvents': mvcEvents,
        '../../framework/event/EventMgr': { EventMgr },
        '../battle/BattleStartModel': battleStart,
        './NewTreasureRepository': { NewTreasureRepository: class {} },
        '../../framework/procedure/ProcedureManager': { ProcedureManager: {
            navigate: (...args: unknown[]) => routes.push(args),
        } },
    });
    const page = new Page();
    Object.assign(page, {
        startButton: { on: (_event: string, handler: () => void, caller: unknown) => { click = handler.bind(caller); } },
        chestToggle: { on() {} },
        previousChapterButton: { active: false, on() {} },
        nextChapterButton: { active: false, on() {} },
        chestBar: { bindCollapse() {} },
    });
    page.bindFindCurrentBoss(() => { findCount++; });
    page.onLoad();
    assert.ok(click);
    click();
    assert.equal(findCount, 1);
    assert.deepEqual(routes, []);
    EventMgr.instance.offTarget(page);
});

test('chapter arrows follow territory readiness and dispatch chapter intents', () => {
    const Page = loadComponent<MainPage>('MainPage', {
        cc,
        './ChestTypes': chestTypes,
        './ChestEvents': { CHEST_EVENTS },
        '../../framework/event/EventMgr': { EventMgr },
        '../territory/application/TerritoryEvents': mvcEvents,
        './NewTreasureRepository': { NewTreasureRepository: class {} },
    });
    const clicks: Array<() => void> = [];
    const arrow = () => ({ active: true, on: (_event: string, handler: () => void, caller: object) => {
        clicks.push(handler.bind(caller));
    } });
    const previous = arrow();
    const next = arrow();
    const page = new Page();
    Object.assign(page, { startButton: { on() {} }, chestToggle: { on() {} },
        previousChapterButton: previous, nextChapterButton: next });
    const owner = {};
    const intents: unknown[] = [];
    EventMgr.instance.on(mvcEvents.TerritoryUiEvent.Intent, (event: unknown) => intents.push(event), owner);
    page.onLoad();
    assert.deepEqual([previous.active, next.active], [false, false]);
    const render = (ready: boolean, previousEnabled: boolean, nextEnabled: boolean) => {
        EventMgr.instance.emit(mvcEvents.TerritoryViewEvent.Render,
            { state: { ready, hud: ready ? { previousEnabled, nextEnabled } : null } });
    };
    render(true, false, false);
    assert.deepEqual([previous.active, next.active], [false, false]);
    render(true, false, true);
    assert.deepEqual([previous.active, next.active], [false, true]);
    render(true, true, false);
    assert.deepEqual([previous.active, next.active], [true, false]);
    clicks[0]();
    clicks[1]();
    assert.deepEqual(JSON.parse(JSON.stringify(intents)), [
        { intent: { kind: 'chapter', offset: -1 } },
        { intent: { kind: 'chapter', offset: 1 } },
    ]);
    render(false, true, true);
    assert.deepEqual([previous.active, next.active], [false, false]);
    EventMgr.instance.offTarget(page);
    EventMgr.instance.offTarget(owner);
    render(true, true, true);
    assert.deepEqual([previous.active, next.active], [false, false]);
});

test('ArenaRoot binds opposite hud arrows beneath BeginGame so chest expansion hides them together', () => {
    const prefab = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8'));
    const page = prefab.find((entry: Record<string, unknown>) => 'previousChapterButton' in entry);
    assert.ok(page, 'MainPage must bind both chapter arrows');
    const begin = prefab[page.startButton.__id__];
    assert.equal(begin._name, 'BeginGame');
    const frameMeta = JSON.parse(readFileSync('assets/resources/image/main/hud/hud_arrow.png.meta', 'utf8'));
    for (const [field, sign] of [['previousChapterButton', -1], ['nextChapterButton', 1]] as const) {
        const reference = page[field];
        const node = prefab[reference.__id__];
        assert.equal(node._parent.__id__, page.startButton.__id__);
        assert.ok(begin._children.some((child: { __id__: number }) => child.__id__ === reference.__id__));
        assert.equal(node._active, false, 'arrows stay hidden until chapter state arrives');
        assert.equal(node._layer, 33554432);
        assert.equal(Math.sign(node._lpos.x), sign);
        assert.equal(node._lscale.x, sign);
        const components = node._components.map((ref: { __id__: number }) => prefab[ref.__id__]);
        assert.ok(components.some((entry: { __type__: string }) => entry.__type__ === 'cc.Button'));
        assert.ok(components.some((entry: { __type__: string }) => entry.__type__ === 'cc.UITransform'));
        const sprite = components.find((entry: { __type__: string }) => entry.__type__ === 'cc.Sprite');
        assert.equal(sprite._spriteFrame.__uuid__, frameMeta.subMetas.f9941.uuid);
        assert.equal(sprite._sizeMode, 0);
        assert.equal(sprite._isTrimmedMode, false);
    }
});

test('Boss focus stops map inertia and scrolls to the selected cell; missing target leaves scroll alone', () => {
    const MapView = loadComponent<MainTerritoryMap>('MainTerritoryMap', {
        cc,
        '../../core/asset/ResourceScope': { ResourceScope },
        '../territory/model/TerritoryMapLayout': {
            territoryMapContentPaddingBottom, territoryMapContentPaddingTop, territoryMapOffsetForCell,
        },
        '../territory/application/TerritoryTexts': { TERRITORY_TEXTS },
        '../../framework/event/EventMgr': { EventMgr },
        '../territory/application/TerritoryEvents': mvcEvents,
    });
    const mapView = new MapView();
    const map = configureTerritoryMap({
        version: 1, mapKind: 'territoryChapter', id: 'quick-find', name: '第一章',
        chapterId: 1, rows: 20, columns: 12, startCellId: 0, sites: [],
    });
    const layout = buildTerritoryMapLayout(map);
    const viewport = { width: 600, height: 500 };
    let cellId: number | null = 135;
    const calls: unknown[][] = [];
    Object.assign(mapView, {
        state: { ready: true, layout },
        mapScrollView: {
            node: { getComponent: () => ({ contentSize: viewport }) },
            stopAutoScroll: () => calls.push(['stop']),
            scrollToOffset: (point: { x: number; y: number }, duration: number) => calls.push([point.x, point.y, duration]),
        },
    });
    const owner = {};
    EventMgr.instance.on(mvcEvents.TerritoryUiEvent.Intent, (event: mvcEvents.ITerritoryIntentEvent) => {
        assert.equal(event.intent.kind, 'focusBoss');
        if (cellId !== null) (mapView as unknown as { onCommand(event: mvcEvents.ITerritoryCommandEvent): void }).onCommand({
            command: { kind: 'focusCell', cellId },
        });
    }, owner);
    mapView.focusCurrentBoss();
    const expected = territoryMapOffsetForCell(layout, 135, viewport);
    assert.deepEqual(calls, [['stop'], [expected.x, expected.y, 0]]);
    cellId = null;
    mapView.focusCurrentBoss();
    assert.equal(calls.length, 2);
    EventMgr.instance.offTarget(owner);
});

test('main tab host binds quick find to the embedded map before the page becomes active', () => {
    let bound: (() => void) | undefined;
    let focusCount = 0;
    class MapStub {

        initialize() {}
        onFirstReady() {}
        focusCurrentBoss() { focusCount++; }
    }
    class PageStub {
        bindFindCurrentBoss(handler: () => void) { bound = handler; }
    }
    const map = new MapStub();
    const mainPage = new PageStub();
    const page = {
        getComponentInChildren: () => map,
        getComponent: (type: unknown) => type === PageStub ? mainPage : null,
        setParent: () => assert.equal(typeof bound, 'function', 'binding must precede onLoad'),
        setPosition() {},
    };
    const Host = loadComponent<{ showPage(prefab: unknown): void }>('MainTabHost', {
        cc: { ...cc, instantiate: () => page, Vec3: { ZERO: {} } },
        './MainTerritoryMap': { MainTerritoryMap: MapStub },
        './MainPage': { MainPage: PageStub },
    });
    const host = new Host();
    Object.assign(host, { content: {} });
    host.showPage({});
    assert.ok(bound);
    bound();
    assert.equal(focusCount, 1);
});

test('battle return focus survives loading, is consumed once, and ignores another chapter', () => {
    const MapPage = loadComponent<{
        setFocusCell(chapterId: number, cellId: number): void;
        onRender(event: unknown): void;
    }>('MainTerritoryMap', {
        cc,
        '../territory/model/TerritoryMapLayout': { territoryMapOffsetForCell },
    });
    const page = new MapPage();
    assert.equal(typeof page.setFocusCell, 'function', 'host return path requires this method');
    const calls: string[] = [];
    Object.assign(page, {
        mapView: { renderMap: () => calls.push('map') },
        renderDetail() {},
        scrollToCell: (cellId: number) => calls.push(`focus:${cellId}`),
    });
    const render = (chapterId: number, ready = true) => page.onRender({ state: {
        ready, chapterId, map: { startCellId: 0 }, progress: {}, layout: {}, detail: {},
    } });
    page.setFocusCell(1, 327);
    render(1, false);
    assert.deepEqual(calls, []);
    render(1);
    assert.deepEqual(calls, ['map', 'focus:327']);
    render(1);
    assert.deepEqual(calls, ['map', 'focus:327', 'map']);
    render(2);
    assert.equal(calls.at(-1), 'focus:0');
    page.setFocusCell(9, 999);
    render(3);
    assert.equal(calls.at(-1), 'focus:0');
    render(9);
    assert.equal(calls.at(-1), 'focus:0', 'mismatched focus must not survive a later chapter switch');
});

test('return focus retries an unlaid-out viewport at most three times and drops stale layouts', () => {
    const MapPage = loadComponent<{ scrollToCell(cellId: number, layout: unknown): void }>('MainTerritoryMap', {
        cc,
        '../territory/model/TerritoryMapLayout': { territoryMapOffsetForCell },
    });
    const page = new MapPage();
    const map = configureTerritoryMap({
        version: 1, mapKind: 'territoryChapter', id: 'return-focus', name: '第一章',
        chapterId: 1, rows: 20, columns: 12, startCellId: 0, sites: [],
    });
    const layout = buildTerritoryMapLayout(map);
    const pending: Array<() => void> = [];
    const state = { layout };
    let scrolls = 0;
    Object.assign(page, { state,
        scheduleOnce: (callback: () => void) => pending.push(callback),
        mapScrollView: {
            node: { getComponent: () => ({ contentSize: { width: 0, height: 0 } }) },
            stopAutoScroll() {}, scrollToOffset: () => { scrolls++; },
        },
    });
    page.scrollToCell(135, layout);
    assert.equal(scrolls, 1, 'scroll before retrying');
    for (let i = 0; i < 3; i++) pending.shift()();
    assert.equal(scrolls, 4);
    assert.equal(pending.length, 0, 'no unbounded scheduling on a broken layout');
    page.scrollToCell(135, layout);
    state.layout = buildTerritoryMapLayout(map);
    pending.shift()();
    assert.equal(scrolls, 5, 'old chapter retries cannot move the new map');
});
