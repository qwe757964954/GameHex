import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as infoLayout from '../assets/script/app/bigmap/model/BigMapInfoLayout';
import { bigMapViewStateFixture } from './helpers/bigmap-view-state-fixture';
import { bigMapPrefabFixture } from './helpers/bigmap-prefab-fixture';

class Transform {
    width = 0; height = 0;
    get contentSize() { return this; }
    setContentSize(w: number, h: number) { this.width = w; this.height = h; }
}
class Node {
    static EventType = { TOUCH_END: 'end' };
    name: string; active = true; isValid = true;
    parent: Node | null = null; children: Node[] = [];
    components = new Map<unknown, any>();
    events = new Map<string, () => void>();
    position = { x: 0, y: 0 }; scale = { x: 1, y: 1 };
    constructor(name = '') { this.name = name; }
    addComponent(Type: new () => any) { const item = new Type(); item.node = this; this.components.set(Type, item); return item; }
    getChildByName(name: string) { return this.children.find(child => child.name === name); }
    getComponent(Type: unknown) { return this.components.get(Type); }
    setPosition(x: number | { x: number; y: number }, y = 0) { this.position = typeof x === 'number' ? { x, y } : x; }
    setScale(x: number, y: number) { this.scale = { x, y }; }
    setParent(parent: Node) { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = parent; parent.children.push(this); }
    setSiblingIndex(index: number) { const siblings = this.parent!.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
    on(event: string, callback: () => void, caller: object) { this.events.set(event, callback.bind(caller)); }
}
class Button { static EventType = { CLICK: 'click' }; interactable = true; }
class Label { string = ''; lineHeight = 21; }
class Sprite {}
class Widget { bottom = 0; alignmentUpdates = 0; updateAlignment() { this.alignmentUpdates++; } }
class Graphics { clear() {} roundRect() {} fill() {} stroke() {} }
class BaseView { node!: Node; build() {} render() {} setArt() {} }
class Color { static WHITE = new Color(); }
const modules = new Map<string, any>();
let instantiate: (template: object) => object;
function load(name: string): any {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    const code = ts.transpileModule(readFileSync(`assets/script/app/bigmap/view/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (id: string) => {
        if (id.endsWith('/EventMgr')) return { EventMgr };
        if (id.endsWith('/BigMapEvents')) return mvcEvents;
        if (id === 'cc') return { _decorator: { ccclass: () => (c: unknown) => c, property: (_type: unknown, key?: string) => key ? undefined : () => undefined, executeInEditMode: (c: unknown) => c },
            Component: class {}, Node, UITransform: Transform, Widget, Button, Label, Sprite, Graphics, Color,
            Vec3: class { constructor(public x = 0, public y = 0) {} }, instantiate: (template: object) => instantiate(template),
            view: { getVisibleSize: () => ({ width: 720, height: 1280 }) } };
        if (id.endsWith('/ResourceScope')) return { ResourceScope };
        if (id === './BigMapBaseView') return { BigMapBaseView: BaseView };
        if (id.endsWith('/BigMapInfoLayout')) return infoLayout;
        if (id === './BigMapPresentationText') return { BIGMAP_PRESENTATION_TEXT: { baseToggle: '基地', worldToggle: '大地图' } };
        const dependency = id.split('/').pop()!;
        if (['BigMapPageLayout', 'BigMapButton', 'BigMapPanel', 'BigMapBuildRow', 'BigMapSkin', 'BigMapTheme'].includes(dependency)) return load(dependency);
        return {};
    } });
    return exports;
}

test('真实页面模板绑定全部控件、重复行、地图层级和按钮禁用状态', () => {
    const { BigMapPage } = load('BigMapPage');
    const { BigMapPageLayout } = load('BigMapPageLayout');
    const { BigMapButton } = load('BigMapButton');
    const { BigMapPanel } = load('BigMapPanel');
    const { BigMapBuildRow } = load('BigMapBuildRow');
    const fixture = bigMapPrefabFixture({ 'cc.Node': Node, 'cc.UITransform': Transform, 'cc.Label': Label,
        'cc.Button': Button, 'cc.Sprite': Sprite, 'cc.Graphics': Graphics, 'cc.Widget': Widget, BigMapPageLayout, BigMapButton, BigMapPanel, BigMapBuildRow, BigMapBaseView: BaseView });
    instantiate = fixture.instantiate;
    const page = new BigMapPage();
    page.node = new Node('Host');
    page.layout = fixture.root.getComponent(BigMapPageLayout);
    const world = new Node('World');
    page.worldView = { node: world, build() {} };
    page.data = bigMapViewStateFixture({ canHarvest: true,
        resources: [{ type: 'grain', name: '粮食', amount: 1200, cap: 2000, pending: 0 }],
        queueUnlock: { canUnlock: true, current: 1, max: 3, cost: 100 },
        buildMenu: [{ kind: 1, name: '粮田', unlocked: true, count: 0, maxOwnNum: 5 }, { kind: 2, name: '木场', unlocked: false, reason: '未解锁' }] });
    const layout = page.layout;
    layout.onLoad();
    const earlyIntents: unknown[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: unknown) => earlyIntents.push(event), layout);
    try {
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        assert.equal(earlyIntents.length, 0, 'onLoad 后、initialize 前的输入不得派发');
    } finally { EventMgr.instance.offTarget(layout); }
    page.ready = true;
    page.buildUi(page.data);
    assert.equal(fixture.root.children[0].name, 'Backdrop');
    assert.equal(fixture.root.children[1], world);
    assert.equal(layout.buildRows.length, 3);
    assert.deepEqual(Array.from(layout.buildRows, (row: any) => row.name.string), ['粮田', '木场', '解锁建造队列']);
    const intents: mvcEvents.BigMapIntent[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => intents.push(event.intent), page);
    try {
        layout.buildRows[2].node.events.get('click')();
        layout.buildMenuButton.node.events.get('click')();
        layout.harvestButton.node.events.get('click')();
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        assert.deepEqual(JSON.parse(JSON.stringify(intents)), [
            { kind: 'build', buildingKind: -1 }, { kind: 'toggleBuildMenu' }, { kind: 'harvestAll' },
            { kind: 'searchMonster' }, { kind: 'mode', mode: 'base' } ]);
        const base = { ...page.data, ui: { ...page.data.ui, mode: 'base', buildMenuVisible: true } };
        layout.render(base);
        assert.equal(layout.buildPanel.active, true);
        assert.equal(layout.buildRows[0].name.string, '粮田  0/5');
        assert.equal(layout.harvestButton.interactable, true);
        assert.equal(layout.resourceLabels[0].string, '粮食 1200/2000');
        layout.setArt({ resources: new Map(), hud: new Map() });
        layout.render(base);
        assert.equal(layout.resourceLabels[0].string, '1.2K');
        const recovering = { ...base, actionRecoverSeconds: 12,
            resources: [{ type: 'stamina', amount: 0, amountKnown: false, cap: 100, pending: 0 }] };
        layout.render(recovering);
        assert.equal(layout.resourceLabels[4].string, '12s');
        layout.render({ ...recovering, actionRecoverSeconds: null });
        assert.equal(layout.resourceLabels[4].string, '—');
        layout.render(base);
        assert.equal(layout.modeLabel.string, '大地图');
        assert.match(layout.queueLabel.string, /0\/0/);
        layout.render({ ...base, canHarvest: false, ui: { ...base.ui, enteringBattle: true, buildMenuVisible: false } });
        assert.equal(layout.buildPanel.active, false);
        assert.equal(layout.harvestButton.interactable, false);
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        layout.buildRows[0].node.events.get('click')();
        assert.equal(intents.length, 5, '入战锁同时约束所有 Layout 输入');
        layout.render(page.data);
        assert.equal(layout.baseView.node.active, false);
        assert.equal(layout.buildMenuButton.node.active, false);
        assert.equal(layout.queuePanel.active, false);
        assert.equal(layout.modeLabel.string, '基地');
        layout.exploreButton.node.events.get('click')();
        assert.equal(intents.length, 6, '取消入战后恢复输入');
    } finally { EventMgr.instance.offTarget(page); }
    page.layout.applyNavigationHeight(88);
    for (const name of ['InfoPanel', 'InfoDim', 'Toast', 'EnteringBattleMask']) assert.equal(fixture.findNode(name), undefined);
    for (const [width, height, navigation] of [[720, 1280, 150], [720, 1600, 150], [390, 900, 88]]) {
        let worldSize: number[] = [];
        let baseSize: number[] = [];
        page.worldView.build = (_data: object, w: number, h: number) => { worldSize = [w, h]; };
        layout.baseView.build = (_data: object, w: number, h: number) => { baseSize = [w, h]; };
        page.navigationHeight = navigation;
        page.layout.applyNavigationHeight(navigation);
        page.buildWorldArea(page.data, width, height);
        page.buildBaseArea(page.data, width, height);
        assert.deepEqual(baseSize, worldSize, '基地和世界地图必须使用相同浏览区');
        for (const map of [page.worldView, layout.baseView]) {
            assert.equal(map.node.position.y - worldSize[1] / 2, -height / 2 + navigation,
                '地图底边必须接到底部导航，不留旧详情栏空位');
            assert.equal(map.node.position.y + worldSize[1] / 2, height / 2 - 128);
        }
        const explore = page.layout.exploreButton.node;
        const widget = explore.getComponent(Widget);
        assert.equal(widget.bottom, navigation + 128);
        assert.ok(widget.alignmentUpdates > 0);
        assert.equal(page.layout.modeNode.getComponent(Widget).bottom, navigation + 20);
    }
});

test('探索按钮由Prefab Widget贴左贴底，代码不手动设置坐标', () => {
    const objects = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    const node = objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === 'ExploreButton');
    const widget = node._components.map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === 'cc.Widget');
    assert.ok(widget);
    assert.equal(widget._enabled, true);
    assert.equal(widget._alignFlags, 12);
    assert.ok(widget._left >= 0);
    assert.ok(widget._bottom >= 0);
    assert.equal(widget._alignMode, 2);
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    assert.doesNotMatch(source, /this\.exploreButton\.node\.setPosition/);
});

test('资源栏由Prefab外层Layout均分Item，每个Item由Layout排列Icon与Value', () => {
    const objects = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    const node = (name: string) => objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === name);
    const widget = (name: string) => node(name)._components.map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === 'cc.Widget');
    for (const name of ['BigMapPage', 'Backdrop']) assert.equal(widget(name)._alignFlags, 45);
    assert.equal(widget('Header')._alignFlags, 41);
    for (const name of ['Header', 'ResourceCard', 'HarvestAll']) assert.equal(widget(name)._alignMode, 1,
        name + ' 必须跟随父级挂载和尺寸变化，不能仅在窗口 resize 时对齐');
    for (const name of ['ResourceCard', 'HarvestAll']) {
        assert.equal(objects[widget(name)._target.__id__]._name, 'BigMapPage');
        assert.equal(widget(name)._top, 0);
        assert.ok(widget(name)._alignFlags & 1);
    }
    assert.equal(widget('ResourceCard')._left, 12);
    assert.equal(widget('ResourceCard')._right, 140);
    assert.equal(widget('QueueStatus')._alignFlags, 41);
    assert.equal(widget('QueueText')._alignFlags, 56);
    const layout = (name: string) => node(name)._components.map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === 'cc.Layout');
    assert.equal(layout('ResourceCard')._layoutType, 1);
    assert.equal(layout('ResourceCard')._resizeMode, 2);
    for (const kind of ['grain', 'wood', 'iron', 'coin', 'stamina']) {
        const item = node('ResourceItem_' + kind);
        assert.equal(widget(item._name), undefined, '外层 Layout 负责 Item 的宽度和位置');
        assert.equal(layout(item._name)._layoutType, 1);
        const children = item._children.map((ref: any) => objects[ref.__id__]);
        assert.deepEqual(children.map((child: any) => child._name), ['Icon', 'Value']);
        assert.equal(children[0]._components.map((ref: any) => objects[ref.__id__]).find((c: any) => c.__type__ === 'cc.Sprite')._sizeMode, 0);
        assert.equal(children[1]._components.map((ref: any) => objects[ref.__id__]).find((c: any) => c.__type__ === 'cc.Widget')._alignFlags, 42);
    }
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    const navigation = source.slice(source.indexOf('private applyNavigationHeight'), source.indexOf('private bindBuildRows'));
    assert.doesNotMatch(navigation, /setContentSize|setPosition|const size/);
});

test('Layout控件引用私有，宿主只调用展示接口，不持有控件或渲染其内容', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(source, /this\.(?:resLabels|resourceIcons|buildRows|buildPanel|harvestButton|buildMenuButton|queueLabel|queuePanel|modeButton|baseView)\b/);
    assert.doesNotMatch(source, /(?:ui|this\.layout)\.(?:resourceLabels|resourceIcons|baseView|harvestButton|buildMenuButton|modeNode|modeLabel|modeIcon|modeFrame|modeFallback|buildPanel|buildRowTemplate|exploreButton|queuePanel|queueLabel)\b/);
    const layout = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    for (const line of layout.split('\n').filter(line => line.includes('@property('))) assert.match(line, /\) private /);
});

test('同步渲染显式接收必填快照，不用 nullable data 静默跳过初始化错误', () => {
    const layout = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    assert.doesNotMatch(layout, /this\.data|private data:/);
    for (const name of ['refreshHeader', 'refreshBuildRows', 'refreshQueue']) {
        assert.ok(layout.includes(name + '(data: IBigMapViewState)'));
    }
    const page = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(page, /if \(!data\)|if \(!this\.data\)|this\.data\?\./);
    for (const name of ['refreshAll', 'refreshInfo', 'refreshInfoContent', 'buildInfoPopupContent']) {
        assert.ok(page.includes(name + '(data: IBigMapViewState)'));
    }
});
