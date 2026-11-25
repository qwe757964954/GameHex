import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function makeScroll() {
    const events: string[] = [];
    const exports: Record<string, any> = {};
    class Vec2 {}
    runInNewContext(ts.transpileModule(readFileSync('assets/script/vscrollview/VScrollView.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require: name => name === 'cc' ? {
        _decorator: { ccclass: () => value => value, property: () => () => {}, menu: () => value => value },
        Component: class {}, Enum: value => value, Vec2,
        Node: { EventType: { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } },
        Input: { EventType: { TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } },
        input: { on: event => events.push(event) },
        math: { clamp: (n, min, max) => Math.min(max, Math.max(min, n)) },
    } : {} });
    const scroll = new exports.VirtualScrollView();
    scroll.node = { on: event => events.push(event) };
    const position = { x: 0, y: 0, z: 0 };
    scroll.content = { position, setPosition(x, y, z) { Object.assign(position, { x, y, z }); } };
    return { scroll, position, events };
}

test('原生驱动模式只刷新可见槽位，惯性与回弹位置不被虚拟列表改写', () => {
    const { scroll, position } = makeScroll();
    scroll.nativeScrollView = {};
    scroll._isStarted = true;
    scroll.totalCount = 100;
    scroll._slots = 3;
    scroll.itemMainSize = 100;
    scroll._contentSize = 10000;
    const slots = [{ index: -1 }, { index: -1 }, { index: -1 }];
    scroll._slotNodes = slots;
    scroll._layoutSingleSlot = (node, index) => { node.index = index; };
    position.y = 1200;
    scroll.update(1 / 60);
    assert.deepEqual(slots.map(n => n.index), [12, 13, 14]);
    assert.equal(position.y, 1200);
    position.y = 0;
    scroll.update(1 / 60);
    assert.deepEqual(slots.map(n => n.index), [0, 1, 2]);
    position.y = -80;
    scroll._velocity = 500;
    scroll.update(1 / 60);
    assert.equal(position.y, -80, '越界回弹交给原生 ScrollView');
    assert.equal(scroll._velocity, 500);
    assert.equal(scroll._slotNodes.length, 3, '百条数据仍复用可见槽位');
});

test('原生驱动不绑定第二套触摸，也不动态挂条目手势组件', () => {
    const { scroll, events } = makeScroll();
    scroll.nativeScrollView = {};
    scroll._bindTouch();
    scroll._bindGlobalTouch();
    scroll._updateItemClickHandler({}, 0);
    assert.deepEqual(events, []);
    scroll.nativeScrollView = null;
    scroll._bindTouch();
    assert.deepEqual(events, ['start', 'move', 'end', 'cancel'], '未接入原生的现有列表保持原事件链');
});

test('未配置原生 ScrollView 时仍执行原来的惯性衰减', () => {
    const { scroll, position } = makeScroll();
    scroll._boundsMax = 1000;
    scroll._velocity = 200;
    scroll.useIOSDecelerationCurve = false;
    scroll._updateVisible = () => {};
    scroll.update(0.1);
    assert.ok(position.y > 0);
    assert.ok(scroll._velocity < 200);
});

test('start() 前调用 refreshList/setTotalCount 与 scrollToTop 会排队并在 start() 对齐后一次性渲染', async () => {
    const events: string[] = [];
    const exports: Record<string, any> = {};
    class Vec2 {}
    class Widget {
        enabled = true;
        aligned = false;
        updateAlignment() {
            this.aligned = true;
            events.push('widget-align');
        }
    }
    class UITransform {
        width = 300;
        height = 200;
        setContentSize(w: number, h: number) { this.width = w; this.height = h; }
    }
    class FakeNode {
        name: string;
        active = false;
        isValid = true;
        parent: FakeNode | null = null;
        children: FakeNode[] = [];
        position = { x: 0, y: 0, z: 0 };
        private readonly comps: any[] = [];
        constructor(name = '') { this.name = name; }
        addComponent(cls: any) { const c = new cls(); c.node = this; this.comps.push(c); return c; }
        getComponent(cls: any) { return typeof cls === 'function' ? (this.comps.find(c => c instanceof cls) ?? null) : null; }
        getChildByName(name: string) { return this.children.find(c => c.name === name) ?? null; }
        removeAllChildren() { this.children.forEach(c => { c.parent = null; }); this.children.length = 0; }
        removeFromParent() {
            if (!this.parent) return;
            const i = this.parent.children.indexOf(this);
            if (i >= 0) this.parent.children.splice(i, 1);
            this.parent = null;
        }
        setPosition(x: number, y: number, z = 0) { Object.assign(this.position, { x, y, z }); }
        on(event: string) { events.push(`on:${event}`); }
    }
    const cloneNode = (src: FakeNode): FakeNode => {
        const n = new FakeNode(`${src.name}_clone`);
        n.addComponent(UITransform);
        const srcUt = src.getComponent(UITransform);
        if (srcUt) n.getComponent(UITransform).setContentSize(srcUt.width, srcUt.height);
        Object.defineProperty(n, 'parent', {
            configurable: true,
            get() { return this._p ?? null; },
            set(p: FakeNode | null) {
                this._p = p;
                if (p && !p.children.includes(n)) p.children.push(n);
            },
        });
        return n;
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/vscrollview/VScrollView.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, {
        exports,
        console,
        require: (name: string) => {
            if (name.endsWith('/VScrollViewItem')) return { VScrollViewItem: class { dataIndex = -1; } };
            if (name === 'cc') {
                return {
                    _decorator: { ccclass: () => (v: unknown) => v, property: () => () => {}, menu: () => (v: unknown) => v },
                    Component: class { isValid = true; unschedule() {} scheduleOnce() {} },
                    Enum: (v: unknown) => v,
                    Mask: class {},
                    Node: Object.assign(FakeNode, { EventType: { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel', MOUSE_WHEEL: 'wheel' } }),
                    Prefab: class {},
                    ScrollView: class {},
                    UITransform,
                    Vec2,
                    Vec3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
                    Widget,
                    Input: { EventType: { TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' } },
                    input: { on() {}, off() {} },
                    instantiate: (src: FakeNode) => cloneNode(src),
                    math: { clamp: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)) },
                };
            }
            return {};
        },
    });

    const parentNode = new FakeNode('Parent');
    const parentWidget = parentNode.addComponent(Widget);
    const listNode = new FakeNode('List');
    listNode.parent = parentNode;
    const listUt = listNode.addComponent(UITransform);
    listUt.setContentSize(300, 200);
    const listWidget = listNode.addComponent(Widget);
    listWidget.updateAlignment = () => {
        assert.equal(parentWidget.aligned, true, '父节点 Widget 应先于子节点对齐');
        listUt.setContentSize(300, 240);
        listWidget.aligned = true;
        events.push('list-widget-align');
    };
    const contentNode = new FakeNode('content');
    contentNode.parent = listNode;
    contentNode.addComponent(UITransform).setContentSize(300, 0);
    const tpl = new FakeNode('Template');
    tpl.addComponent(UITransform).setContentSize(300, 80);

    const scroll = new exports.VirtualScrollView();
    scroll.node = listNode;
    scroll.content = contentNode;
    scroll.itemCreationMode = 0; // NODE
    scroll.itemNode = tpl;
    scroll.interactive = false;
    scroll.buffer = 0;

    const rendered: number[] = [];
    scroll.renderItemFn = (_node: any, idx: number) => rendered.push(idx);

    // 模拟在 onOpen（start 之前）连续两次设条数并调用 scrollToTop
    scroll.refreshList([1, 2]);
    assert.equal(scroll.totalCount, 2, 'start 前读取 totalCount 也立即可见最新值');
    scroll.refreshList(5);
    scroll.scrollToTop(false);
    assert.deepEqual(rendered, [], 'start() 尚未运行前不提前以 0 视口误渲染');

    await scroll.start();
    assert.equal(listWidget.aligned, true);
    assert.equal(scroll._viewportSize, 240, 'start() 应在对齐后的真实视口尺寸上建槽');
    assert.equal(scroll._contentSize, 5 * 80);
    // 240 / 80 = 3 行可见，buffer=0 → _slots = 3+2 = 5；start() 首轮渲染 0..4 各 1 次，flushPendingStartOperations 执行 scrollToTop 再刷新 1 次
    assert.ok(rendered.includes(0) && rendered.includes(1) && rendered.includes(2), 'start() 完成后必须把可视项全部铺出');
});
