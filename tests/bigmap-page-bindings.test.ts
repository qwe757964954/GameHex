import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as infoLayout from '../assets/script/app/bigmap/model/BigMapInfoLayout';
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
    getComponent(Type: unknown) { return this.components.get(Type); }
    setPosition(x: number | { x: number; y: number }, y = 0) { this.position = typeof x === 'number' ? { x, y } : x; }
    setScale(x: number, y: number) { this.scale = { x, y }; }
    setParent(parent: Node) { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = parent; parent.children.push(this); }
    setSiblingIndex(index: number) { const siblings = this.parent!.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
    on(event: string, callback: () => void, caller: object) { this.events.set(event, callback.bind(caller)); }
}
class Label { string = ''; lineHeight = 21; }
class Sprite {}
class Graphics { clear() {} roundRect() {} fill() {} stroke() {} }
class BaseView { node!: Node; build() {} }
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
            Component: class {}, Node, UITransform: Transform, Label, Sprite, Graphics, Color,
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
        'cc.Sprite': Sprite, 'cc.Graphics': Graphics, BigMapPageLayout, BigMapButton, BigMapPanel, BigMapBuildRow, BigMapBaseView: BaseView });
    instantiate = fixture.instantiate;
    const page = new BigMapPage();
    page.node = new Node('Host');
    page.layout = fixture.root.getComponent(BigMapPageLayout);
    const world = new Node('World');
    page.worldView = { node: world, build() {} };
    page.data = { buildMenu: [{ kind: 1, name: '粮田' }, { kind: 2, name: '木场' }] };
    page.ready = true;
    page.buildUi();
    assert.equal(fixture.root.children[0].name, 'Backdrop');
    assert.equal(fixture.root.children[1], world);
    assert.equal(page.buildRows.length, 3);
    assert.deepEqual(Array.from(page.buildRows, (row: any) => row.name.string), ['粮田', '木场', '解锁建造队列']);
    const body = page.layout.infoBody.node.getComponent(Transform);
    assert.equal(body.width > 0 && body.height > 0, true);
    let clicks = 0;
    page.onPrimaryAction = () => { clicks++; };
    page.primaryButton.setEnabled(false);
    page.primaryButton.node.events.get('end')();
    assert.equal(clicks, 0);
    page.primaryButton.setEnabled(true);
    page.primaryButton.node.events.get('end')();
    assert.equal(clicks, 1);
    const kinds: number[] = [];
    page.onBuildRowClick = (kind: number) => kinds.push(kind);
    page.buildRows[2].node.events.get('end')();
    assert.deepEqual(kinds, [-1]);
    let rowRefreshes = 0;
    page.refreshBuildRows = () => { rowRefreshes++; };
    page.refreshInfo = () => {};
    const intents: string[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        intents.push(event.intent.kind);
    }, page);
    page.buildPanel.active = false;
    page.layout.buildMenuButton.node.events.get('end')();
    assert.deepEqual(intents, ['toggleBuildMenu']);
    page.setBuildMenuVisible(true);
    assert.equal(rowRefreshes, 1);
    page.buildPanel.active = false;
    page.onPlotTap(7);
    assert.deepEqual(intents, ['toggleBuildMenu', 'plotTap']);
    page.setBuildMenuVisible(true);
    assert.equal(page.buildPanel.active, true);
    assert.equal(rowRefreshes, 2, '点空地开菜单也须在底板 onEnable 后恢复状态');
    EventMgr.instance.offTarget(page);
    page.layout.resize(390, 900, 88);
    const loading = fixture.findNode('Loading');
    assert.equal(loading.position.y, 290, '非 1280 屏高时提示仍应距离顶边 160');
    assert.equal(loading.getComponent(Transform).width, 310);
});
