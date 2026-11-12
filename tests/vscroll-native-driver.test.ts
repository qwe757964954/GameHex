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
