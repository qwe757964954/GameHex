import { bigMapViewStateFixture } from './helpers/bigmap-view-state-fixture';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { bigMapPrefabFixture } from './helpers/bigmap-prefab-fixture';
import * as baseGeometry from '../assets/script/app/bigmap/view/BigMapBasePresentation';
import * as worldGeometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';

function buildBase() {
    class Color {
        static WHITE = new Color(255, 255, 255, 255);
        constructor(public r = 255, public g = 255, public b = 255, public a = 255) {}
    }
    class Transform {
        width = 0; height = 0;
        setContentSize(width: number, height: number) { this.width = width; this.height = height; }
    }
    class Graphics {
        fillCount = 0;
        clear() { this.fillCount = 0; } rect() {} fill() { this.fillCount++; }
        moveTo() {} lineTo() {} close() {} stroke() {}
    }
    class Sprite { static SizeMode = { RAW: 2, CUSTOM: 0 }; static Type = { SLICED: 1 }; }
    class Label { static HorizontalAlign = { CENTER: 1 }; static Overflow = { SHRINK: 2 }; }
    class Mask { static Type = { GRAPHICS_RECT: 0 }; }
    class FakeNode {
        static EventType = { TOUCH_END: 'touch-end' };
        parent: FakeNode | null = null;
        children: FakeNode[] = [];
        active = true;
        position = { x: 0, y: 0 };
        scale = { x: 1, y: 1 };
        components = new Map<unknown, object>();
        constructor(public name = '') { this.addComponent(Transform); }
        addComponent<T extends object>(Type: new () => T): T {
            const component = Object.assign(new Type(), { node: this });
            this.components.set(Type, component);
            return component;
        }
        getComponent(type: unknown) { return this.components.get(type); }
        setParent(parent: FakeNode) { this.parent = parent; parent.children.push(this); }
        setPosition(x: number, y: number) { this.position = { x, y }; }
        setScale(x: number, y: number) { this.scale = { x, y }; }
        setSiblingIndex(index: number) {
            const children = this.parent?.children;
            if (!children) return;
            children.splice(children.indexOf(this), 1); children.splice(index, 0, this);
        }
        targetOff() {}
        destroy() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
        destroyAllChildren() { this.children = []; }
        on() {}
    }
    class Plot {}
    let instantiate: (template: object) => object;
    class Component { node = new FakeNode('Base'); }
    const createNode = (name: string, parent: FakeNode) => {
        const node = new FakeNode(name); node.setParent(parent); return node;
    };
    const skin = {
        BIGMAP_SKIN_COLORS: { cyan: Color.WHITE, text: Color.WHITE, gold: Color.WHITE, dark: Color.WHITE },
        requireBigMapTransform: (node: FakeNode) => node.getComponent(Transform),
        createBigMapSprite: (name: string, parent: FakeNode) => createNode(name, parent).addComponent(Sprite),
        fitBigMapSprite(sprite: { spriteFrame: object | null; node: FakeNode }, frame: object | null) {
            sprite.spriteFrame = frame; sprite.node.active = !!frame;
        },
    };
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapBaseView.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/BigMapEvents')) return mvcEvents;
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} }, instantiate: (template: object) => instantiate(template),
            Component, Color, Graphics, Sprite, Label, Mask, Node: FakeNode, UITransform: Transform };
        if (name === './BigMapBasePlot') return { BigMapBasePlot: Plot };
        if (name === './BigMapBasePresentation') return baseGeometry;
        if (name === './BigMapWorldLayout') return worldGeometry;
        if (name === './BigMapSkin') return skin;
        if (name === './BigMapTheme') return { BIGMAP_COLORS: { text: Color.WHITE }, createUiNode: createNode,
            createLabel: (parent: FakeNode) => createNode('Label', parent).addComponent(Label) };
        return { BIGMAP_PRESENTATION_TEXT: { emptyPlot: '空地' } };
    } });
    interface ISprite { node: FakeNode; spriteFrame: object | null; color: Color; sizeMode: number; trim: boolean }
    interface ISlot { root: FakeNode; selection: Graphics }
    const View = exports.BigMapBaseView as new () => {
        node: FakeNode;
        build(data: object, width: number, height: number): void;
        resize(width: number, height: number): void;
        setArt(art: object): void; select(hexId: number): void;
        layout: baseGeometry.IBigMapBaseLayout; slots: Map<number, ISlot>; content: FakeNode; background: ISprite;
    };
    const cells = Array.from({ length: 9 }, (_, hexId) => ({
        hexId, row: Math.floor(hexId / 3), column: hexId % 3,
        buildingId: hexId === 4 ? 71001 : 0, slot: hexId === 4 ? 'building' : 'empty',
        level: 1, stored: 0, remainSeconds: 0,
    }));
    const view = new View();
    const fixture = bigMapPrefabFixture({ 'cc.Node': FakeNode, 'cc.UITransform': Transform,
        'cc.Sprite': Sprite, 'cc.Graphics': Graphics, 'cc.Label': Label, BigMapBasePlot: Plot });
    instantiate = fixture.instantiate;
    view.node = fixture.findNode('BaseView');
    Object.assign(view, [...view.node.components.values()].find((item: object) => 'plotTemplate' in item));
    view.build(bigMapViewStateFixture({ plots: cells, world: { seed: 2718 }, mainBuildingId: 71001 }), 720, 900);
    const ground = { rect: { width: 147, height: 96 }, offset: { x: 0, y: 0 } };
    const art = { ground, groundVariants: [ground], baseBackground: null,
        buildings: new Map(), resources: new Map(), ui: new Map([['plot', { rect: { width: 397, height: 301 } }]]) };
    return { view, art, ground, Transform };
}

test('基地使用一张连续背景，选择和调整窗口不恢复旧地面贴片', () => {
    const h = buildBase();
    const background = { rect: { width: 2048, height: 2048 }, originalSize: { width: 2048, height: 2048 } };
    h.view.setArt({ ...h.art, baseBackground: background });
    h.view.select(4);
    for (const [width, height] of [[720, 900], [390, 600], [720, 900]]) {
        h.view.resize(width, height);
        assert.equal(h.view.background.spriteFrame, background);
        assert.equal(h.view.background.sizeMode, 0);
        assert.equal(h.view.background.trim, false);
        const transform = h.view.background.node.getComponent(h.Transform) as InstanceType<typeof h.Transform>;
        assert.equal(transform.width, h.view.layout.mapSize);
        assert.equal(transform.height, h.view.layout.mapSize);
        for (const slot of h.view.slots.values()) {
            assert.equal(slot.root.children.some((node) => node.name === 'Foundation'), false);
        }
    }
});

test('连续背景始终画在建筑层下方，建筑按纵向位置排序', () => {
    const h = buildBase();
    const slots = [...h.view.slots.values()];
    const parent = slots[0].root.parent;
    assert.ok(parent);
    assert.equal(parent.parent, h.view.content);
    assert.ok(h.view.content.children.indexOf(h.view.background.node) < h.view.content.children.indexOf(parent));
    for (const [width, height] of [[720, 900], [390, 600], [720, 900]]) {
        h.view.resize(width, height);
        assert.deepEqual(parent.children.map((node) => Number(node.name.slice(5))), h.view.layout.paintOrder);
    }
});
