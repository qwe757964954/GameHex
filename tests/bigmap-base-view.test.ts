import { bigMapViewStateFixture } from './helpers/bigmap-view-state-fixture';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { bigMapPrefabFixture } from './helpers/bigmap-prefab-fixture';
import * as geometry from '../assets/script/app/bigmap/view/BigMapBasePresentation';
import * as presentationText from '../assets/script/app/bigmap/view/BigMapPresentationText';

class Vec { constructor(public x = 0, public y = 0, public z = 0) {} }
class MockNode {
    static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel', MOUSE_WHEEL: 'wheel' };
    active = true;
    position = new Vec();
    scale = new Vec(1, 1, 1);
    children: MockNode[] = [];
    parent: MockNode | null = null;
    components = new Map<unknown, object>();
    constructor(public name = '') {}
    addComponent<T extends { node: MockNode }>(Ctor: new () => T): T { const c = new Ctor(); c.node = this; this.components.set(Ctor, c); return c; }
    getComponent<T>(Ctor: new () => T): T | null { return this.components.get(Ctor) as T ?? null; }
    setParent(parent: MockNode) { this.parent = parent; parent.children.push(this); }
    destroy() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
    setPosition(x: number, y: number, z = 0) { this.position = new Vec(x, y, z); }
    setScale(x: number, y: number, z = 1) { this.scale = new Vec(x, y, z); }
    setSiblingIndex(_index: number) {}
    destroyAllChildren() { this.children = []; }
    on() { this.onCount += 1; }
    onCount = 0;
    targetOff() { this.targetOffCount += 1; }
    targetOffCount = 0;
}
class Transform {
    node!: MockNode;
    width = 0; height = 0;
    anchorX = 0.5; anchorY = 0.5;
    setContentSize(w: number, h: number) { this.width = w; this.height = h; }
    convertToNodeSpaceAR(p: Vec): Vec {
        const local = this.node.parent?.getComponent(Transform)?.convertToNodeSpaceAR(p) ?? p;
        return new Vec((local.x - this.node.position.x) / this.node.scale.x, (local.y - this.node.position.y) / this.node.scale.y);
    }
}
class Sprite { static SizeMode = { RAW: 1, CUSTOM: 0 }; static Type = { SLICED: 1 }; node!: MockNode; spriteFrame: unknown = null; }
class Graphics { node!: MockNode; strokes = 0; clear() { this.strokes = 0; } fill() {} stroke() { this.strokes++; } rect() {} ellipse() {} moveTo() {} lineTo() {} close() {} }
class Label { static HorizontalAlign = { CENTER: 0 }; static Overflow = { SHRINK: 0 }; node!: MockNode; }
class Mask { static Type = { GRAPHICS_RECT: 0 }; node!: MockNode; }
class Color { static WHITE = {}; constructor(..._args: number[]) {} }
const createNode = (name: string, parent: MockNode, w = 0, h = 0) => {
    const n = new MockNode(name); n.parent = parent; parent.children.push(n); n.addComponent(Transform).setContentSize(w, h); return n;
};
interface IView {
    node: MockNode;
    content: MockNode;
    slots: Map<number, { root: MockNode; icon: Sprite; resource: Sprite; selection: Graphics; name: Label }>;
    layout: geometry.IBigMapBaseLayout;
    camera: geometry.IBigMapBaseCamera;
    onTap: (id: number) => void;
    onHarvest: (id: number) => void;
    build(p: unknown, w: number, h: number): void;
    setArt(art: unknown): void;
    zoomBy(factor: number): void;
    focusOn(id: number): void;
    refresh(): void;
    setPendingBuilding(id: number): void;
    setMoving(moving: boolean): void;
    onTouchStart(e: unknown): void; onTouchMove(e: unknown): void; onTouchEnd(e: unknown): void; onTouchCancel(): void;
    onLoad(): void;
    onDisable(): void;
}
function harness(options: {
    buildingConfigs?: ReadonlyMap<number, { canMove: boolean }>;
    moveableHexIds?: readonly number[];
} = {}) {
    class Plot {}
    let instantiate: (template: object) => object;
    const exports: { BigMapBaseView?: new () => IView } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapBaseView.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (id: string) => {
        if (id.endsWith('/EventMgr')) return { EventMgr };
        if (id.endsWith('/BigMapEvents')) return mvcEvents;
        if (id === 'cc') return { _decorator: { ccclass: () => (c: unknown) => c, property: () => () => {} }, instantiate: (template: object) => instantiate(template), Color, Component: class {}, EventTouch: class {}, EventMouse: class {},
            Graphics, Label, Mask, Node: MockNode, Sprite, UITransform: Transform, Vec2: Vec, Vec3: Vec };
        if (id.endsWith('/BigMapBasePlot')) return { BigMapBasePlot: Plot };
        if (id.endsWith('/BigMapBasePresentation')) return geometry;
        if (id.endsWith('/BigMapSkin')) return {
            // 选中双环 / 底光 / 进度环用到的色值都要给，否则 `strokeColor` 被赋成 undefined，
            // 断言虽然只看 strokes 次数，但假绿会掩盖"忘了补色"的真实问题。
            BIGMAP_SKIN_COLORS: {
                text: {}, muted: {}, gold: {}, dark: {}, cyan: {},
                selectOuter: {}, selectInner: {}, placeOk: {}, placeBad: {},
                glowFill: {}, ringUnder: {}, ringDone: {}, ringUrgent: {},
            },
            requireBigMapTransform: (n: MockNode) => n.getComponent(Transform),
            createBigMapSprite: (name: string, parent: MockNode) => createNode(name, parent, 80, 80).addComponent(Sprite),
            fitBigMapSprite: (s: Sprite, frame: unknown, width: number, x: number, y: number) => {
                s.spriteFrame = frame; s.node.active = !!frame; s.node.setPosition(x, y);
                s.node.getComponent(Transform)!.setContentSize(width, width);
            },
        };
        if (id.endsWith('/BigMapTheme')) return { BIGMAP_COLORS: {}, createUiNode: createNode,
            createLabel: (p: MockNode) => createNode('Label', p).addComponent(Label) };
        if (id.endsWith('/BigMapPresentationText')) return {
            // 用真实纯函数：`bigMapHexCorners` / `buildBigMapProgressPolyline` / `formatBigMapDuration`
            // 都是零引擎依赖的几何与格式化，直接引用比在 mock 里再抄一份可靠
            // （抄一份的话，改了真实实现测试仍然绿）。
            ...presentationText,
            BIGMAP_PRESENTATION_TEXT: { ...presentationText.BIGMAP_PRESENTATION_TEXT, emptyPlot: '空地' },
        };
        return {};
    } });
    const view = new exports.BigMapBaseView!();
    const fixture = bigMapPrefabFixture({ 'cc.Node': MockNode, 'cc.UITransform': Transform,
        'cc.Sprite': Sprite, 'cc.Graphics': Graphics, 'cc.Label': Label, BigMapBasePlot: Plot });
    instantiate = fixture.instantiate;
    view.node = fixture.findNode('BaseView');
    view.node.setPosition(0, 0);
    const serialized = [...view.node.components.values()].find((item) => 'plotTemplate' in item)!;
    Object.assign(view, serialized);
    view.onLoad();
    const cells = Array.from({ length: 400 }, (_, hexId) => ({ hexId, row: Math.floor(hexId / 20), column: hexId % 20,
        slot: hexId === 210 ? 'building' : 'empty', buildingId: hexId === 210 ? 1 : 0, instanceId: 7, level: 1,
        name: '主城', stored: hexId === 210 ? 12 : 0, resType: 'coin', remainSeconds: 0 }));
    view.build(bigMapViewStateFixture({ plots: cells, mainBuildingId: 1,
        buildingConfigs: options.buildingConfigs ?? new Map(),
        moveableHexIds: options.moveableHexIds ?? [] }), 720, 900);
    const frame = { rect: { width: 100, height: 100 }, originalSize: { width: 2048, height: 2048 }, offset: { x: 0, y: 0 } };
    view.setArt({ baseBackground: frame, buildings: new Map([[1, frame]]), resources: new Map([['coin', frame]]), ui: new Map([['badge', frame]]) });
    const taps: number[] = []; const harvests: number[] = []; const moveBegins: number[] = [];
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => {
        if (event.intent.kind === 'plotTap') taps.push(event.intent.hexId);
        if (event.intent.kind === 'harvest') harvests.push(event.intent.instanceId);
        if (event.intent.kind === 'moveBegin') moveBegins.push(event.intent.instanceId);
    }, view);
    return { view, cells, taps, harvests, moveBegins };
}
const touch = (x: number, y: number, count = 1) => ({ getUILocation: () => new Vec(x, y),
    getAllTouches: () => Array.from({ length: count }, (_, i) => ({ getUILocation: () => new Vec(x + i * 100, y) })) });

test('400格基地使用同一背景内容层，空格平时隐藏，屏外建筑裁剪', () => {
    const { view } = harness();
    assert.ok(view.content.children.some((n) => n.name === 'BaseGround'));
    const hasFoundation = (n: MockNode): boolean => n.name === 'Foundation' || n.children.some(hasFoundation);
    assert.equal(hasFoundation(view.node), false);
    assert.equal(view.slots.get(210)!.root.active, true);
    assert.equal(view.slots.get(0)!.root.active, false);
    assert.equal(view.slots.get(209)!.name.node.active, false);
});

test('建造或搬移时才提示空格，退出模式后恢复干净场景', () => {
    const { view } = harness();
    const empty = view.slots.get(209)!;
    assert.equal(empty.selection.strokes, 0);
    view.setPendingBuilding(2);
    assert.equal(empty.selection.strokes, 1);
    assert.equal(empty.name.node.active, true);
    view.setPendingBuilding(0);
    assert.equal(empty.selection.strokes, 0);
    view.setMoving(true);
    assert.equal(empty.selection.strokes, 1);
    view.setMoving(false);
    assert.equal(empty.selection.strokes, 0);
    assert.equal(empty.name.node.active, false);
});

test('缩放后点击资源图标仍能收取，拖动到图标松手不误收取', () => {
    const { view, harvests, taps } = harness();
    view.zoomBy(1.2);
    view.focusOn(210);
    const icon = view.slots.get(210)!.resource.node;
    const point = view.layout.points.get(210)!;
    const x = (point.x + icon.position.x) * view.camera.zoom + view.camera.x;
    const y = (point.y + icon.position.y) * view.camera.zoom + view.camera.y;
    view.onTouchStart(touch(x, y)); view.onTouchEnd(touch(x, y));
    assert.deepEqual(harvests, [7]);
    assert.equal(taps.length, 0);
    view.onTouchStart(touch(x - 30, y)); view.onTouchMove(touch(x, y)); view.onTouchEnd(touch(x, y));
    assert.deepEqual(harvests, [7]);
});

test('拖动、缩放及取消不触发建筑选择，普通点击仍准确拾取', () => {
    const { view, taps, harvests } = harness();
    view.onTouchStart(touch(0, 0)); view.onTouchMove(touch(60, 0)); view.onTouchEnd(touch(60, 0));
    assert.equal(taps.length, 0); assert.equal(harvests.length, 0);
    view.onTouchStart(touch(0, 0)); view.onTouchMove(touch(10, 0, 2)); view.onTouchEnd(touch(10, 0));
    assert.equal(taps.length, 0);
    view.onTouchStart(touch(0, 0)); view.onTouchCancel(); view.onTouchEnd(touch(0, 0));
    assert.equal(taps.length, 0);
    view.focusOn(210);
    view.onTouchStart(touch(0, 0)); view.onTouchEnd(touch(0, 0));
    assert.deepEqual(taps, [210]);
});

test('销毁时不访问已销毁的 viewport，清空展示数据与槽位', () => {
    const { view } = harness();
    const viewport = (view as unknown as { viewport: Transform }).viewport;
    const node = viewport.node;
    // 引擎 Node._onPreDestroyBase 的顺序是「eventProcessor → 子节点 → 自身组件」，
    // 走到 onDestroy 时 viewport 已被 _destruct 清空成 { node: null }。
    viewport.node = null as unknown as MockNode;
    (viewport as unknown as { destroyed: boolean }).destroyed = true;
    assert.doesNotThrow(() => (view as unknown as { onDestroy(): void }).onDestroy());
    assert.equal(node.targetOffCount, 0);
    assert.equal(view.slots.size, 0);
    const state = view as unknown as { data: unknown; art: unknown };
    assert.equal(state.data, null);
    assert.equal(state.art, null);
});

test('重复构建与禁用再启用不重复绑定或移除 viewport 监听', () => {
    const { view, cells } = harness();
    const viewport = (view as unknown as { viewport: Transform }).viewport;
    assert.equal(viewport.node.onCount, 5);
    view.build(bigMapViewStateFixture({ plots: cells, mainBuildingId: 1 }), 720, 900);
    view.onTouchStart(touch(0, 0));
    view.onDisable();
    assert.equal(viewport.node.onCount, 5);
    assert.equal(viewport.node.targetOffCount, 0);
    assert.equal((view as unknown as { dragStart: Vec | null }).dragStart, null);
});

// 长按手势专用：取某格建筑 icon 的屏幕坐标（含相机 zoom / 偏移）。
const iconScreenOf = (view: IView, hexId: number) => {
    const iconNode = view.slots.get(hexId)!.icon.node;
    const point = view.layout.points.get(hexId)!;
    return {
        x: (point.x + iconNode.position.x) * view.camera.zoom + view.camera.x,
        y: (point.y + iconNode.position.y) * view.camera.zoom + view.camera.y,
    };
};
const stepView = (view: IView, dt: number) =>
    (view as unknown as { update(dt: number): void }).update(dt);

test('按住可移动建筑不动 0.4s 触发移建，原格松手不移动', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: true }]]) });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    assert.deepEqual(h.moveBegins, []);
    stepView(h.view, 0.2);
    assert.deepEqual(h.moveBegins, [], '不到 0.4s 不触发');
    stepView(h.view, 0.2);
    assert.deepEqual(h.moveBegins, [7]);
    const ghost = (h.view as unknown as { plotGhost: Sprite }).plotGhost;
    assert.equal(ghost.node.active, true, '触发后应显示跟手 ghost');
    h.view.onTouchEnd(touch(p.x, p.y));
    assert.deepEqual(h.taps, [], '拖回原格（不在 moveable）不发移动');
});

test('0.4s 内移动超 12px 仲裁为平移镜头，不触发移建', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: true }]]) });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    h.view.onTouchMove(touch(p.x + 60, p.y));
    stepView(h.view, 0.5);
    assert.deepEqual(h.moveBegins, []);
    h.view.onTouchEnd(touch(p.x + 60, p.y));
    assert.deepEqual(h.taps, []);
});

test('短按松手仍是普通点选，不误触发移建', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: true }]]) });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    stepView(h.view, 0.2);
    h.view.onTouchEnd(touch(p.x, p.y));
    assert.deepEqual(h.moveBegins, []);
    assert.deepEqual(h.taps, [210]);
});

test('canMove=false 的钉死建筑，长按不触发移建', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: false }]]) });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    stepView(h.view, 0.5);
    assert.deepEqual(h.moveBegins, []);
});

test('双指缩放介入立刻取消长按，不触发移建', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: true }]]) });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    h.view.onTouchMove(touch(p.x, p.y, 2));
    stepView(h.view, 0.5);
    assert.deepEqual(h.moveBegins, []);
});

test('长按触发后拖到合法落点松手，发 plotTap 走 requestMove', () => {
    const h = harness({ buildingConfigs: new Map([[1, { canMove: true }]]), moveableHexIds: [209] });
    h.view.focusOn(210);
    const p = iconScreenOf(h.view, 210);
    h.view.onTouchStart(touch(p.x, p.y));
    stepView(h.view, 0.4);
    assert.deepEqual(h.moveBegins, [7]);
    const targetPoint = h.view.layout.points.get(209)!;
    const tx = targetPoint.x * h.view.camera.zoom + h.view.camera.x;
    const ty = targetPoint.y * h.view.camera.zoom + h.view.camera.y;
    h.view.onTouchMove(touch(tx, ty));
    h.view.onTouchEnd(touch(tx, ty));
    assert.deepEqual(h.taps, [209]);
});
