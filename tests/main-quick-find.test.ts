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
    runInNewContext(code, { exports, require: (id: string) => imports[id] ?? {} });
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
        chestBar: { bindCollapse() {} },
    });
    page.bindFindCurrentBoss(() => { findCount++; });
    page.onLoad();
    assert.ok(click);
    click();
    assert.equal(findCount, 1);
    assert.deepEqual(routes, []);
});

test('Boss focus stops map inertia and scrolls to the selected cell; missing target leaves scroll alone', () => {
    const MapView = loadComponent<MainTerritoryMap>('MainTerritoryMap', {
        cc,
        '../../core/asset/ResourceScope': { ResourceScope },
        '../territory/model/TerritoryMapLayout': {
            territoryMapContentPaddingBottom, territoryMapContentPaddingTop, territoryMapOffsetForCell,
        },
        '../territory/application/TerritoryTexts': { TERRITORY_TEXTS },
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
        presenter: { focusCurrentBoss: () => cellId, state: { ready: true, layout } },
        mapScrollView: {
            node: { getComponent: () => ({ contentSize: viewport }) },
            stopAutoScroll: () => calls.push(['stop']),
            scrollToOffset: (point: { x: number; y: number }, duration: number) => calls.push([point.x, point.y, duration]),
        },
    });
    mapView.focusCurrentBoss();
    const expected = territoryMapOffsetForCell(layout, 135, viewport);
    assert.deepEqual(calls, [['stop'], [expected.x, expected.y, 0]]);
    cellId = null;
    mapView.focusCurrentBoss();
    assert.equal(calls.length, 2);
});

test('main tab host binds quick find to the embedded map before the page becomes active', () => {
    let bound: (() => void) | undefined;
    let focusCount = 0;
    class MapStub {
        setSessionAssetService() {}
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
    Object.assign(host, { assets: {}, content: {} });
    host.showPage({});
    assert.ok(bound);
    bound();
    assert.equal(focusCount, 1);
});
