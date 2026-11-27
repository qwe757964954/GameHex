import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as presentationText from '../assets/script/app/bigmap/view/BigMapPresentationText';
import * as infoLayout from '../assets/script/app/bigmap/model/BigMapInfoLayout';
import * as compactNumber from '../assets/script/core/math/CompactNumber';
import * as feedbackReal from '../assets/script/app/main/MainResBarFeedback';
// `BigMapTopHudTypes` 的 `formatBigMapResourceAmount` 落在 `core/math/CompactNumber`（纯 TS、无 cc），
// 桩成 `{}` 会在资源格刷数字时炸 `… is not a function`（2026-11-25 补）。
import * as compactNumber from '../assets/script/core/math/CompactNumber';
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
    events = new Map<string, (...args: any[]) => void>();
    position = { x: 0, y: 0 }; scale = { x: 1, y: 1 };
    constructor(name = '') { this.name = name; }
    addComponent(Type: new () => any) { const item = new Type(); item.node = this; this.components.set(Type, item); return item; }
    getChildByName(name: string) { return this.children.find(child => child.name === name); }
    getComponent(Type: unknown) { return this.components.get(Type); }
    setPosition(x: number | { x: number; y: number }, y = 0) { this.position = typeof x === 'number' ? { x, y } : x; }
    setScale(x: number, y: number) { this.scale = { x, y }; }
    setParent(parent: Node) { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = parent; parent.children.push(this); }
    setSiblingIndex(index: number) { const siblings = this.parent!.children; siblings.splice(siblings.indexOf(this), 1); siblings.splice(index, 0, this); }
    getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }
    on(event: string, callback: (...args: any[]) => void, caller: object) { this.events.set(event, callback.bind(caller)); }
}
class Button { static EventType = { CLICK: 'click' }; interactable = true; }
class Label { static Overflow = { NONE: 0 }; string = ''; lineHeight = 21; color = { r: 238, g: 235, b: 214, a: 255 }; }
class Sprite { static SizeMode = { CUSTOM: 0 }; }
class Widget { bottom = 0; alignmentUpdates = 0; updateAlignment() { this.alignmentUpdates++; } }
class Graphics { clear() {} roundRect() {} fill() {} stroke() {} }
class BaseView { node!: Node; build() {} render() {} setArt() {} setMapOffset() {} }
class Color { static WHITE = new Color(); }
const modules = new Map<string, any>();
let instantiate: (template: object) => object;
const feedbackCache = new Map<string, any>();
// 反馈类依赖 cc（节点/标签），但曲线全是零依赖纯函数：在 vm 内加载真实反馈类，
// 注入 cc 桩与真实 MainResBarFeedback，避免在桩里再抄一份曲线。
function loadFeedback(): any {
    if (feedbackCache.has('BigMapResourceFeedback')) return feedbackCache.get('BigMapResourceFeedback');
    const fbExports: any = {};
    const fbCode = ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapResourceFeedback.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(fbCode, { exports: fbExports, require: (id: string) => {
        if (id === 'cc') return { Color, Label, Node, UITransform: Transform };
        if (id.endsWith('/MainResBarFeedback')) return feedbackReal;
        // `BigMapResourceFeedback` 从 `./BigMapTopHudTypes` 取 `formatBigMapResourceAmount`；
        // 桩成 `{}` 会在资源格刷数字时炸 `… is not a function`（2026-11-25 补）。
        if (id.endsWith('/BigMapTopHudTypes')) return load('BigMapTopHudTypes');
        return {};
    } });
    feedbackCache.set('BigMapResourceFeedback', fbExports);
    return fbExports;
}
let toastMessage = '';
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
        if (id.endsWith('/Toast')) return { Toast: { show: (msg: string) => { toastMessage = msg; } } };
        if (id === 'cc') return { _decorator: { ccclass: () => (c: unknown) => c, property: (_type: unknown, key?: string) => key ? undefined : () => undefined, executeInEditMode: (c: unknown) => c },
            Component: class {}, Node, UITransform: Transform, Widget, Button, Label, Sprite, Graphics, Color, BlockInputEvents: class {},
            Vec3: class { constructor(public x = 0, public y = 0) {} }, instantiate: (template: object) => instantiate(template),
            view: { getVisibleSize: () => ({ width: 720, height: 1280 }) } };
        if (id.endsWith('/ResourceScope')) return { ResourceScope };
        if (id === './BigMapBaseView') return { BigMapBaseView: BaseView };
        if (id.endsWith('/BigMapResourceFeedback')) return loadFeedback();
        if (id.endsWith('/CompactNumber')) return compactNumber;
        if (id.endsWith('/MainResBar')) return { MainResBar: class {} };
        if (id.endsWith('/BigMapInfoLayout')) return infoLayout;
        if (id.endsWith('/CompactNumber')) return compactNumber;
        if (id === './BigMapPresentationText') return presentationText;
        const dependency = id.split('/').pop()!;
        if (['BigMapPageLayout', 'BigMapButton', 'BigMapBuildRow', 'BigMapSkin', 'BigMapTheme', 'BigMapTopHud', 'BigMapTopHudTypes'].includes(dependency)) return load(dependency);
        return {};
    } });
    return exports;
}

test('真实页面模板绑定全部控件、重复行、地图层级和按钮禁用状态', () => {
    const { BigMapPage } = load('BigMapPage');
    const { BigMapPageLayout } = load('BigMapPageLayout');
    const { BigMapTopHud } = load('BigMapTopHud');
    const { BigMapButton } = load('BigMapButton');
    const { BigMapBuildRow } = load('BigMapBuildRow');
    class MainResBarStub {
        node: Node | null = null;
        setPortraitFrame(): void {}
    }
    const fixture = bigMapPrefabFixture({ 'cc.Node': Node, 'cc.UITransform': Transform, 'cc.Label': Label,
        'cc.Button': Button, 'cc.Sprite': Sprite, 'cc.Graphics': Graphics, 'cc.Widget': Widget, BigMapPageLayout, BigMapButton, BigMapBuildRow, BigMapTopHud, MainResBar: MainResBarStub, BigMapBaseView: BaseView });
    instantiate = fixture.instantiate;
    const page = new BigMapPage();
    page.node = new Node('Host');
    page.node.addComponent(Transform);
    page.layout = fixture.root.getComponent(BigMapPageLayout);
    const world = new Node('World');
    page.worldView = { node: world, build() {} };
    page.data = bigMapViewStateFixture({ canHarvest: true,
        resources: [{ type: 'grain', name: '粮食', amount: 1200, cap: 2000, pending: 0 }],
        queueUnlock: { canUnlock: true, current: 1, max: 3, cost: 100 },
        buildMenu: [
            { buildingId: 71002, kind: 1, name: '粮田', unlocked: true, count: 0, maxOwnNum: 5, buildTime: 65 },
            { buildingId: 71007, kind: 2, name: '木场', unlocked: true, count: 0, maxOwnNum: 5, buildTime: 70 },
            { buildingId: 0, kind: 3, name: '铁矿', unlocked: false, reason: '未解锁', count: 0, maxOwnNum: 5 }
        ] });
    const layout = page.layout;
    layout.onLoad();
    layout.topHud.onLoad();
    const earlyIntents: unknown[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: unknown) => earlyIntents.push(event), layout);
    try {
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        assert.equal(earlyIntents.length, 0, 'onLoad 后、initialize 前的输入不得派发');
    } finally { EventMgr.instance.offTarget(layout); }
    page.ready = true;
    page.buildUi(page.data);
    assert.equal(fixture.root.children[0], world, '世界地图插入为底层渲染面');
    assert.equal(fixture.root.children.some((c: any) => c.name === 'Backdrop'), false, 'Backdrop 节点已移除');
    // 建造目录与升级统一收归底栏 DesignDock，Layout 不再持有 buildRows，页面不再打开独立弹窗。
    assert.equal((layout as unknown as { buildRows?: unknown }).buildRows, undefined,
        'Layout 不该再持有 buildRows');
    assert.equal((page as unknown as { refreshBuildMenu?: unknown }).refreshBuildMenu, undefined,
        'Page 不该再持有 refreshBuildMenu —— 建造收归底栏 DesignDock');
    const intents: mvcEvents.BigMapIntent[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => intents.push(event.intent), page);
    try {
        layout.buildMenuButton.node.events.get('click')();
        layout.harvestButton.node.events.get('click')();
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        assert.deepEqual(JSON.parse(JSON.stringify(intents)), [
            { kind: 'toggleBuildMenu' }, { kind: 'harvestAll' },
            { kind: 'searchMonster' }, { kind: 'mode', mode: 'base' } ]);
        const base = { ...page.data, ui: { ...page.data.ui, mode: 'base', buildMenuVisible: true } };
        layout.render(base);
        // 2026-11-11 用户口径：「基地界面隐藏 搜索icon，搜索icon 只在大地图显示」。
        assert.equal(layout.exploreButton.node.active, false, '基地界面没有搜索按钮');
        // 按钮文案写的是「点下去会去哪」：基地模式 ⇒ 大地图。
        assert.equal(layout.modeLabel.string, '大地图');
        assert.equal(layout.modeLabel.node.active, true, '基地模式下文案节点同样必须是开的');
        assert.equal(layout.harvestButton.interactable, true);
        assert.equal(layout.topHud.queueCard.active, true, '基地模式显示建造队列整卡');
        assert.equal(layout.buildEntryButton.node.active, true, '基地模式显示左侧建造入口');
        assert.equal(layout.topHud.coinNodes.every((node) => !node.active), true, '基地按设计稿只保留 4 格资源');
        assert.equal(layout.topHud.plusNodes.every((node) => node.active), true, '基地资源格显示绿色加号');
        assert.equal(layout.topHud.resourceValues[0].string, '1.2K');
        layout.setArt({ resources: new Map(), hud: new Map(), buildings: new Map() });
        layout.render(base);
        assert.equal(layout.topHud.resourceValues[0].string, '1.2K');
        const recovering = { ...base, actionRecoverSeconds: 12,
            resources: [{ type: 'stamina', amount: 0, amountKnown: false, cap: 100, pending: 0 }] };
        layout.render(recovering);
        assert.equal(layout.topHud.resourceValues[4].string, '12s');
        layout.render({ ...recovering, actionRecoverSeconds: null });
        assert.equal(layout.topHud.resourceValues[4].string, '—');
        layout.render(base);
        assert.equal(layout.modeNode.active, false);
        assert.equal(layout.baseBackButton.node.active, true);
        assert.equal(layout.designCardLockReason.string, '未解锁');
        assert.equal(layout.designCardNames[1].string, '粮田');
        assert.equal(layout.designCardTimers[0].string, '00:01:05');
        for (const button of layout.designCardButtons) button.node.events.get('click')(button);
        layout.upgradeTab.node.events.get('click')();
        layout.render({ ...base, plotDetails: new Map([[17, {
            name: '主城', buildingId: 71001, level: 2, buildTime: 300, queueSlotIndex: -1,
        }]]) });
        assert.equal(layout.designCardActions[0].string, '升级');
        const upgrade = layout.designCardButtons[0];
        upgrade.node.events.get('click')(upgrade);
        layout.baseBackButton.node.events.get('click')();
        assert.deepEqual(JSON.parse(JSON.stringify(intents.splice(4))), [
            { kind: 'build', buildingKind: 1 }, { kind: 'build', buildingKind: 2 },
            { kind: 'clear' }, { kind: 'plotTap', hexId: 17 }, { kind: 'mode', mode: 'world' },
        ]);
        assert.equal(layout.topHud.researchQueueValue.string, '—');
        assert.equal(layout.topHud.buildQueueValue.string, '0/0');

        // 验证点击图2（QueueCard）打开和收起图1（DesignDock）
        const normalBase = { ...page.data, ui: { ...page.data.ui, mode: 'base', buildMenuVisible: false } };
        layout.render(normalBase);
        assert.equal(layout.designDock.active, false, '未点击图2时，底栏建造面板默认收起');
        assert.equal(layout.modeNode.active, true, '底栏收起时，模式切换按钮保持可见');
        assert.equal(layout.buildEntryButton.node.active, true, '基地左侧显示建造锤子入口');
        layout.buildEntryButton.node.events.get('click')();
        assert.equal(layout.designDock.active, true, '点击左侧建造锤子，图1建造面板打开');
        assert.equal(layout.modeNode.active, false, '左侧建造入口打开图1后，模式切换按钮隐藏');
        layout.topHud.queueCardButton.node.events.get('click')();
        assert.equal(layout.designDock.active, false, '顶部队列卡的点击仍保留，可收起图1');
        layout.topHud.queueCardButton.node.events.get('click')();
        assert.equal(layout.designDock.active, true, '再次点击图2建造队列，图1建造面板打开');
        assert.equal(layout.dockBlankCatcher.node.active, true, '建造面板打开时，空白点击接收层激活');
        // 点击空白处隐藏
        layout.dockBlankCatcher.node.events.get('click')();
        assert.equal(layout.designDock.active, false, '点击空白处后，图1建造面板收起隐藏');
        assert.equal(layout.dockBlankCatcher.node.active, false, '建造面板收起后，空白接收层恢复隐藏');
        assert.equal(layout.modeNode.active, true, '图1收起后，模式切换按钮重新可见');

        // 点击赛季与战争未开放页签，统一弹出「功能暂未开放」Toast 提示
        toastMessage = '';
        layout.seasonButton.node.events.get('click')();
        assert.equal(toastMessage, '功能暂未开放', '点击赛季按钮弹出功能暂未开放');
        toastMessage = '';
        layout.warButton.node.events.get('click')();
        assert.equal(toastMessage, '功能暂未开放', '点击战争按钮弹出功能暂未开放');

        layout.render({ ...base, canHarvest: false, ui: { ...base.ui, enteringBattle: true, buildMenuVisible: false } });
        assert.equal(layout.harvestButton.interactable, false);
        layout.exploreButton.node.events.get('click')();
        layout.modeNode.events.get('click')();
        layout.buildEntryButton.node.events.get('click')();
        assert.equal(intents.length, 4, '入战锁同时约束所有 Layout 输入');
        layout.render(page.data);
        assert.equal(layout.baseView.node.active, false);
        assert.equal(layout.designDock.active, false);
        assert.equal(layout.topHud.queueCard.active, false, '世界模式必须连图标/标题/数值一起收起');
        assert.equal(layout.buildEntryButton.node.active, false, '世界模式收起基地建造入口');
        assert.equal(layout.topHud.coinNodes.every((node) => node.active), true, '世界模式展开金币格');
        assert.equal(layout.topHud.plusNodes.every((node) => !node.active), true, '世界顶栏不带基地加号');
        assert.equal(layout.exploreButton.node.active, true, '回到大地图，搜索按钮要回来');
        assert.equal(layout.modeLabel.string, '基地');
        // 2026-11-25 事故：prefab 里 `ModeLabel` 是 `_active:false`，代码只写 string 不开节点
        // ⇒ 模式按钮只剩图标，「基地 / 大地图」四个字整条消失。文案显隐必须由 Layout 自己管。
        assert.equal(layout.modeLabel.node.active, true, '模式按钮的文案节点必须被代码打开');
        layout.exploreButton.node.events.get('click')();
        assert.equal(intents.length, 5, '取消入战后恢复输入');
    } finally { EventMgr.instance.offTarget(page); }
    page.layout.applyNavigationHeight(88);
    for (const name of ['InfoPanel', 'InfoDim', 'Toast', 'EnteringBattleMask']) assert.equal(fixture.findNode(name), undefined);
    for (const [width, height, navigation] of [[720, 1280, 150], [720, 1600, 150], [390, 900, 88]]) {
        let worldSize: number[] = [];
        let baseSize: number[] = [];
        let worldInsets: { top: number; bottom: number } | undefined;
        let baseOffsetY = 0;
        page.worldView.build = (_data: object, w: number, h: number, insets: { top: number; bottom: number }) => {
            worldSize = [w, h];
            worldInsets = insets;
        };
        layout.baseView.build = (_data: object, w: number, h: number) => { baseSize = [w, h]; };
        layout.baseView.setMapOffset = (_x: number, y: number) => { baseOffsetY = y; };
        page.node.getComponent(Transform).setContentSize(width, height);
        page.navigationHeight = navigation;
        page.buildUi(page.data);
        assert.deepEqual(worldSize, [width, height]);
        assert.deepEqual(baseSize, [width, height]);
        for (const map of [page.worldView, layout.baseView]) {
            assert.deepEqual(map.node.position, { x: 0, y: 0 });
        }
        assert.deepEqual({ ...worldInsets }, { top: 340, bottom: navigation });
        assert.equal(baseOffsetY, 68 + (navigation - 340) / 2);
        const explore = page.layout.exploreButton.node;
        const widget = explore.getComponent(Widget);
        assert.equal(widget.bottom, navigation + 128);
        assert.ok(widget.alignmentUpdates > 0);
        const buildWidget = page.layout.buildEntryButton.node.getComponent(Widget);
        assert.equal(buildWidget.bottom, navigation + 128, '锤子入口底边必须跟随 navigationHeight，不能写死');
        assert.ok(buildWidget.alignmentUpdates > 0);
        const modeWidget = page.layout.modeNode.getComponent(Widget);
        assert.equal(modeWidget.bottom, navigation + 20);
        const modeHeight = page.layout.modeNode.getComponent(Transform).height;
        assert.ok(buildWidget.bottom >= modeWidget.bottom + modeHeight + 20,
            `navigationHeight=${navigation} 时锤子入口与模式按钮不得重叠`);
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

test('左侧建造入口按蓝湖切图落位：锤子压在深色底板上，点击与顶部队列卡共用开关', () => {
    const objects = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    const node = (name: string) => objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === name);
    const children = (owner: any) => owner._children.map((ref: any) => objects[ref.__id__]);
    const component = (owner: any, typeName: string) => owner._components
        .map((ref: any) => objects[ref.__id__]).find((item: any) => item.__type__ === typeName);

    const entry = node('BuildEntryButton');
    assert.ok(entry, '页面必须有左侧建造入口 BuildEntryButton');
    assert.equal(entry._parent.__id__, 1, '建造入口挂在页面根，与顶部队列卡同级');
    const entryTransform = component(entry, 'cc.UITransform');
    assert.deepEqual([entryTransform._contentSize.width, entryTransform._contentSize.height], [111, 95],
        '按钮包围盒按设计稿 111×95');
    const entryWidget = component(entry, 'cc.Widget');
    assert.ok(entryWidget, '建造入口必须挂 cc.Widget 贴左');
    assert.equal(entryWidget._alignFlags, 12);
    assert.equal(entryWidget._left, 17, '左边缘与基地模式按钮对齐');
    assert.equal(entryWidget._bottom, 216, '贴底位置与探索按钮同槽位');
    const entryButton = component(entry, 'cc.Button');
    assert.ok(entryButton, '建造入口必须挂 cc.Button');
    assert.equal(entryButton._transition, 0, '按钮 transition 必须是 NONE(0)');
    assert.equal(entryButton._target, null, '按钮 target 必须是 null');

    const plate = children(entry).find((child: any) => child._name === 'Plate');
    assert.ok(plate, '底板必须是建造入口子节点');
    const plateTransform = component(plate, 'cc.UITransform');
    assert.deepEqual([plateTransform._contentSize.width, plateTransform._contentSize.height], [111, 79],
        '底板按设计稿 111×79，不能随包围盒拉伸');
    assert.deepEqual([plate._lpos.x, plate._lpos.y], [0, -8], '底板下移 8px 对齐设计稿');
    assert.equal(component(plate, 'cc.Sprite')._spriteFrame.__uuid__,
        '6d900bf7-7853-4917-8756-fea31dfe1d56@f9941', '底板直接使用蓝湖深色 task tab 切图');

    const hammer = children(entry).find((child: any) => child._name === 'Hammer');
    assert.ok(hammer, '锤子必须是建造入口子节点');
    const hammerTransform = component(hammer, 'cc.UITransform');
    assert.deepEqual([hammerTransform._contentSize.width, hammerTransform._contentSize.height], [68, 68],
        '锤子按设计稿 68×68，允许压出底板上沿');
    assert.deepEqual([hammer._lpos.x, hammer._lpos.y], [-3.5, 13.5], '锤子略偏左、上压 13.5px');
    const hammerSprite = component(hammer, 'cc.Sprite');
    assert.equal(hammerSprite._spriteFrame.__uuid__, '6be37852-b869-4ce5-895c-4d5dbda16428@f9941',
        '锤子直接使用蓝湖 icon_jz 切图');
    assert.equal(hammerSprite._isTrimmedMode, false, '锤子按原始方形画布缩放，不被裁剪成 52×49');

    const label = children(entry).find((child: any) => child._name === 'Label');
    assert.ok(label, '文字必须是建造入口子节点');
    const labelData = component(label, 'cc.Label');
    assert.equal(labelData._string, '建造');
    assert.equal(labelData._fontSize, 22, '设计稿 22px 白字');
    assert.equal(labelData._enableOutline, true, '文字必须有黑色描边');
    assert.equal(labelData._outlineWidth, 2);
    assert.deepEqual([label._lpos.x, label._lpos.y], [1.5, -22.5], '文字落在底板下部');

    const layout = objects.find((item: any) => 'buildEntryButton' in item && 'exploreButton' in item);
    assert.ok(layout, 'BigMapPageLayout 必须持有 buildEntryButton');
    const boundButton = objects[layout.buildEntryButton.__id__];
    assert.equal(boundButton.__type__, 'cc.Button', 'buildEntryButton 必须引用 Button 组件');
    assert.equal(objects[boundButton.node.__id__]._name, 'BuildEntryButton',
        'buildEntryButton 必须解析到左侧锤子入口');
});

test('Layout控件引用私有，宿主只调用展示接口，不持有控件或渲染其内容', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(source, /this\.(?:resLabels|resourceIcons|buildRows|buildPanel|harvestButton|buildMenuButton|queueLabel|queuePanel|modeButton|baseView)\b/);
    assert.doesNotMatch(source, /(?:ui|this\.layout)\.(?:resourceLabels|resourceIcons|baseView|harvestButton|buildMenuButton|modeNode|modeLabel|modeIcon|modeFrame|modeFallback|buildPanel|buildRowTemplate|exploreButton|queuePanel|queueLabel)\b/);
    const layout = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    const lines = layout.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        if (!lines[index].includes('@property(')) continue;
        assert.ok(/\)\s+private\s/.test(lines[index]) || /^\s*private\s/.test(lines[index + 1] ?? ''),
            lines[index]);
    }
});

test('同步渲染显式接收必填快照，不用 nullable data 静默跳过初始化错误', () => {
    const layout = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    assert.doesNotMatch(layout, /this\.data|private data:/);
    assert.ok(layout.includes('refreshQueue(data: IBigMapViewState)'));
    const topHud = readFileSync('assets/script/app/bigmap/view/BigMapTopHud.ts', 'utf8');
    assert.ok(topHud.includes('render(data: IBigMapViewState)'));
    const page = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(page, /if \(!data\)|if \(!this\.data\)|this\.data\?\./);
    for (const name of ['refreshAll', 'refreshInfo', 'refreshInfoContent', 'buildInfoPopupContent']) {
        assert.ok(page.includes(name + '(data: IBigMapViewState)'));
    }
});
