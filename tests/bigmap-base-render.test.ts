import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
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
        destroyAllChildren() { this.children = []; }
        on() {}
    }
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
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value },
            Component, Color, Graphics, Sprite, Label, Mask, Node: FakeNode, UITransform: Transform };
        if (name === './BigMapBasePresentation') return baseGeometry;
        if (name === './BigMapWorldLayout') return worldGeometry;
        if (name === './BigMapSkin') return skin;
        if (name === './BigMapTheme') return { BIGMAP_COLORS: { text: Color.WHITE }, createUiNode: createNode,
            createLabel: (parent: FakeNode) => createNode('Label', parent).addComponent(Label) };
        return { BIGMAP_PRESENTATION_TEXT: { emptyPlot: '空地' } };
    } });
    interface ISprite { node: FakeNode; spriteFrame: object | null; color: Color; sizeMode: number; trim: boolean }
    interface ISlot { root: FakeNode; pad: ISprite; selection: Graphics }
    const View = exports.BigMapBaseView as new () => {
        build(presenter: object, width: number, height: number): void;
        resize(width: number, height: number): void;
        setArt(art: object): void; select(hexId: number): void;
        layout: baseGeometry.IBigMapBaseLayout; slots: Map<number, ISlot>;
    };
    const cells = Array.from({ length: 9 }, (_, hexId) => ({
        hexId, row: Math.floor(hexId / 3), column: hexId % 3,
        buildingId: hexId === 4 ? 71001 : 0, slot: hexId === 4 ? 'building' : 'empty',
        level: 1, stored: 0, remainSeconds: 0,
    }));
    const view = new View();
    view.build({ plotCells: () => cells, world: { seed: 2718 }, mainBuildingId: 71001 }, 720, 900);
    const ground = { rect: { width: 147, height: 96 }, offset: { x: 0, y: 0 } };
    const art = { ground, groundVariants: [ground], baseBackground: null,
        buildings: new Map(), resources: new Map(), ui: new Map([['plot', { rect: { width: 397, height: 301 } }]]) };
    return { view, art, ground, Transform };
}

test('基地所有地块用大地图平面贴图按完整格尺寸铺合，建筑和选中不改变地面透明度', () => {
    const h = buildBase();
    h.view.setArt(h.art);
    h.view.select(4);
    for (const [width, height] of [[720, 900], [390, 600], [720, 900]]) {
        h.view.resize(width, height);
        for (const [hexId, slot] of h.view.slots) {
            assert.equal(slot.pad.spriteFrame, h.ground, `地块 ${hexId} 不使用立体底座`);
            const transform = slot.pad.node.getComponent(h.Transform) as InstanceType<typeof h.Transform>;
            assert.equal(transform.width, h.view.layout.tileWidth);
            assert.equal(transform.height, h.view.layout.tileHeight);
            assert.equal(slot.pad.sizeMode, 0);
            assert.equal(slot.pad.trim, false);
            assert.equal(slot.pad.color.a, 255);
            assert.equal(slot.pad.node.position.x, h.view.layout.points.get(hexId)?.x);
            assert.equal(slot.pad.node.position.y, h.view.layout.points.get(hexId)?.y);
        }
    }
});

test('基地地面统一绘制在建筑之前，邻格地面不会盖住已绘制的建筑', () => {
    const h = buildBase();
    const slots = [...h.view.slots.values()];
    const parent = slots[0].root.parent;
    assert.ok(parent);
    for (const slot of slots) assert.ok(slot.pad.node.parent === parent, '地面和建筑共用定位容器');
    for (const [width, height] of [[720, 900], [390, 600], [720, 900]]) {
        h.view.resize(width, height);
        const padIndices = slots.map((slot) => parent.children.indexOf(slot.pad.node));
        const buildingIndices = slots.map((slot) => parent.children.indexOf(slot.root));
        assert.ok(Math.max(...padIndices) < Math.min(...buildingIndices));
    }
});
