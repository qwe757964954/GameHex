import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as feedbackReal from '../assets/script/app/main/MainResBarFeedback';

class Vec { constructor(public x = 0, public y = 0, public z = 0) {} }
class MockNode {
    name = '';
    layer = 0;
    active = true;
    parent: MockNode | null = null;
    children: MockNode[] = [];
    components = new Map<unknown, any>();
    position = new Vec();
    scale = new Vec(1, 1, 1);
    constructor(name = '') { this.name = name; }
    addComponent(Ctor: any) { const c = new Ctor(); c.node = this; this.components.set(Ctor, c); return c; }
    getComponent(Ctor: any) { return this.components.get(Ctor); }
    setParent(parent: MockNode) { this.parent = parent; parent.children.push(this); }
    getChildByName(name: string) { return this.children.find((child) => child.name === name) ?? null; }
    setPosition(x: number, y: number, z = 0) { this.position = new Vec(x, y, z); }
    setScale(x: number, y: number, z = 1) { this.scale = new Vec(x, y, z); }
}
class Transform {
    node!: MockNode;
    width = 0;
    height = 0;
    anchorX = 0.5;
    anchorY = 0.5;
    setAnchorPoint(x: number, y: number) { this.anchorX = x; this.anchorY = y; }
    setContentSize(w: number, h: number) { this.width = w; this.height = h; }
}
class MockLabel {
    static Overflow = { NONE: 0 };
    static HorizontalAlign = { CENTER: 1 };
    static VerticalAlign = { CENTER: 1 };
    node!: MockNode;
    string = '';
    color = { r: 238, g: 235, b: 214, a: 255 };
    fontSize = 22;
    lineHeight = 29;
    useSystemFont = true;
    fontFamily = 'Arial';
    font: unknown = null;
    isBold = false;
    isItalic = false;
    horizontalAlign = 1;
    verticalAlign = 1;
    enableWrapText = false;
    overflow = 0;
    enableOutline = false;
    outlineColor = { r: 0, g: 0, b: 0, a: 255 };
    outlineWidth = 0;
}
class MockColor {
    constructor(public r = 255, public g = 255, public b = 255, public a = 255) {}
}

function loadFeedback(): any {
    const exports: any = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapResourceFeedback.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require: (id: string) => {
        if (id === 'cc') return { Color: MockColor, Label: MockLabel, Node: MockNode, UITransform: Transform };
        if (id.endsWith('/MainResBarFeedback')) return feedbackReal;
        return {};
    } });
    return exports;
}

const { BigMapResourceFeedback } = loadFeedback();

function makeFeedback() {
    const host = new MockNode('ResourceItem');
    const valueNode = new MockNode('Value');
    valueNode.setParent(host);
    valueNode.addComponent(Transform).setContentSize(71, 30);
    const label = valueNode.addComponent(MockLabel);
    // prefab 预置的飘字节点：挂在 Value 下，默认隐藏，带 UITransform + Label。
    const floatNode = new MockNode('SpendFloat');
    floatNode.active = false;
    floatNode.setParent(valueNode);
    floatNode.addComponent(Transform);
    floatNode.addComponent(MockLabel);
    const feedback = new BigMapResourceFeedback(label);
    return { host, valueNode, label, floatNode, feedback };
}

const resourceView = (over: Record<string, unknown> = {}) => ({
    type: 'grain', name: '粮食', amount: 1000, cap: 0, pending: 0, amountKnown: true, ...over,
});

test('首帧只建立基线，不触发反馈、不改 Label', () => {
    const { feedback, label } = makeFeedback();
    assert.equal(feedback.sync(resourceView()), false);
    assert.equal(feedback.isPlaying, false);
    assert.equal(label.string, '');
});

test('扣 300 立即把数字钉回旧值并白闪，随后滚动到新值，结束复原', () => {
    const { feedback, valueNode, label } = makeFeedback();
    feedback.sync(resourceView({ amount: 1000 }));
    assert.equal(feedback.sync(resourceView({ amount: 700 })), true);
    // 起播瞬间 countRatio=0：钉回旧值 1000（按 K 规则显示 1.0K）。
    assert.equal(label.string, '1.0K');
    // 白闪在 0.05s 后到峰值：字色混向纯白，玩家立刻看到反馈。
    feedback.step(0.1);
    assert.equal(label.string, '1.0K', '前 0.34s 数字钉住不动（先跳再扣）');
    assert.ok(label.color.r > 238, '白闪窗口内字色应变白，实际 r=' + label.color.r);
    // 0.34s 之后数字才开始向新值滚动。
    feedback.step(0.6);
    const mid = parseInt(label.string, 10);
    assert.ok(mid > 700 && mid < 1000, '中段应在旧值与新值之间滚动，实际 ' + label.string);
    feedback.step(1);
    assert.equal(feedback.isPlaying, false);
    assert.equal(label.string, '700');
    assert.equal(valueNode.scale.x, 1);
    assert.deepEqual([label.color.r, label.color.g, label.color.b], [238, 235, 214]);
});

test('扣除时启用 prefab 预置的上方飘字显示 -N，反馈结束后隐藏', () => {
    const { feedback, floatNode } = makeFeedback();
    feedback.sync(resourceView({ amount: 1000 }));
    feedback.sync(resourceView({ amount: 700 }));
    assert.ok(floatNode, '应存在预置飘字节点');
    assert.equal(floatNode.active, true);
    const floatLabel = floatNode.getComponent(MockLabel);
    assert.equal(floatLabel.string, '-300');
    assert.equal(floatLabel.enableOutline, true);
    feedback.step(1);
    assert.equal(floatNode.active, false);
});

test('增加走命中反馈：钉回旧值后滚动到新值', () => {
    const { feedback, label } = makeFeedback();
    feedback.sync(resourceView({ amount: 1000 }));
    assert.equal(feedback.sync(resourceView({ amount: 1300 })), true);
    assert.equal(label.string, '1.0K');
    feedback.step(0.2);
    assert.notEqual(label.string, '1.0K');
    assert.notEqual(label.string, '1.3K');
    feedback.step(1);
    assert.equal(feedback.isPlaying, false);
    assert.equal(label.string, '1.3K');
});

test('体力扣除保留 /上限 后缀，K 值滚动正确', () => {
    const { feedback, label } = makeFeedback();
    const stamina = (amount: number) => resourceView({ type: 'stamina', amount, cap: 100 });
    feedback.sync(stamina(1200));
    feedback.sync(stamina(1000));
    assert.equal(label.string, '1.2K/100');
    feedback.step(1);
    assert.equal(label.string, '1.0K/100');
});

test('余额未知不起播，恢复已知后重新建立基线', () => {
    const { feedback, label } = makeFeedback();
    feedback.sync(resourceView({ amount: 1000 }));
    assert.equal(feedback.sync(resourceView({ amountKnown: false, amount: 0 })), false);
    assert.equal(feedback.isPlaying, false);
    assert.equal(feedback.sync(resourceView({ amount: 900 })), false, '未知后首帧只建基线，不补演');
    assert.equal(label.string, '');
});

test('cancel 立刻中止反馈并复原缩放', () => {
    const { feedback, valueNode } = makeFeedback();
    feedback.sync(resourceView({ amount: 1000 }));
    feedback.sync(resourceView({ amount: 700 }));
    assert.equal(feedback.isPlaying, true);
    feedback.cancel();
    assert.equal(feedback.isPlaying, false);
    assert.equal(valueNode.scale.x, 1);
});
