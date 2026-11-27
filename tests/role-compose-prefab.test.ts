import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PREFAB = 'assets/bundles/main-pages/ui/Role/RoleComposePopup.prefab';
const UI_2D = 33554432;

interface IObj {
    __type__: string;
    _name?: string;
    _parent?: { __id__: number } | null;
    _children?: Array<{ __id__: number }>;
    _components?: Array<{ __id__: number }>;
    _layer?: number;
    _lpos?: { x: number; y: number };
    _lrot?: { z: number; w: number };
    node?: { __id__: number };
    chipTemplate?: { __id__: number };
    _contentSize?: { width: number; height: number };
    _anchorPoint?: { x: number; y: number };
    _type?: number;
    _sizeMode?: number;
    _isTrimmedMode?: boolean;
    _transition?: number;
    _target?: unknown;
    _overflow?: number;
}

const objects: IObj[] = JSON.parse(readFileSync(PREFAB, 'utf8'));
const nodes = objects
    .map((obj, index) => ({ obj, index }))
    .filter(({ obj }) => obj.__type__ === 'cc.Node');
const byName = new Map(nodes.map(({ obj, index }) => [obj._name ?? '', { obj, index }]));

function nodeOf(name: string) {
    const found = byName.get(name);
    assert.ok(found, `prefab 缺少节点 ${name}`);
    return found;
}

function hasComponent(nodeIndex: number, type: string): boolean {
    return (objects[nodeIndex]._components ?? []).some(ref => objects[ref.__id__].__type__ === type);
}

function component<T extends IObj>(nodeIndex: number, type: string): T {
    for (const ref of objects[nodeIndex]._components ?? []) {
        const comp = objects[ref.__id__];
        if (comp.__type__ === type) return comp as T;
    }
    assert.fail(`节点 ${objects[nodeIndex]._name} 缺少 ${type}`);
}

function fit(nodeIndex: number) {
    const ui = component<IObj & { _contentSize: { width: number; height: number } }>(nodeIndex, 'cc.UITransform');
    return [ui._contentSize.width, ui._contentSize.height] as const;
}

test('every node carries a UITransform and sits on the UI_2D layer', () => {
    for (const { obj, index } of nodes) {
        assert.ok(obj._layer === UI_2D, `${obj._name} 的 _layer 不是 UI_2D`);
        assert.ok(hasComponent(index, 'cc.UITransform'), `${obj._name} 缺少 cc.UITransform`);
        assert.ok(!hasComponent(index, 'cc.Graphics'), `${obj._name} 不应挂 Graphics`);
    }
});

test('the shell is 660x680 with the title overhanging 38 and the close 8 above', () => {
    const panel = nodeOf('Panel');
    assert.deepEqual(fit(panel.index), [660, 680]);
    const title = nodeOf('Title');
    assert.equal(title.obj._lpos?.x, -210);
    assert.equal(title.obj._lpos?.y, 378);
    const close = nodeOf('Close');
    assert.deepEqual([close.obj._lpos?.x, close.obj._lpos?.y], [254, 348]);
});

test('two 612x122 boards stack with an arrow and section headers between them', () => {
    const cost = nodeOf('CostCard');
    assert.deepEqual(fit(cost.index), [612, 122]);
    assert.deepEqual([cost.obj._lpos?.x, cost.obj._lpos?.y], [-306, 204]);
    const out = nodeOf('OutCard');
    assert.deepEqual(fit(out.index), [612, 122]);
    assert.deepEqual([out.obj._lpos?.x, out.obj._lpos?.y], [-306, -6]);
    const arrow = nodeOf('Arrow');
    assert.equal(arrow.obj._lrot?.z, -0.7071068);
    assert.equal(arrow.obj._lrot?.w, 0.7071068);
    for (const name of ['CostHeader', 'OutHeader']) {
        const header = nodeOf(name);
        const children = (header.obj._children ?? []).map(ref => objects[ref.__id__]._name);
        assert.deepEqual(children, ['LineL', 'CapL', 'Label', 'LineR', 'CapR'], `${name} 的装饰结构不对`);
    }
});

test('the chip template is a 68px quality tile with a 56px frame, 42px icon and a count badge', () => {
    const chip = nodeOf('ChipTemplate');
    assert.equal(chip.obj._parent !== null, true);
    assert.deepEqual(fit(chip.index), [68, 68]);
    for (const [name, size] of [
        ['Frame', [56, 56]], ['Icon', [48, 48]], ['Badge', [40, 20]], ['Count', [40, 20]],
    ] as const) {
        const child = nodeOf(name);
        assert.deepEqual(fit(child.index), size, `${name} 的尺寸不对`);
    }
    const count = component<IObj & { _overflow?: number }>(nodeOf('Count').index, 'cc.Label');
    assert.equal(count._overflow, 1);
});

test('the warning row binds a red icon and an auto-width label', () => {
    const warn = nodeOf('Warn');
    assert.deepEqual(fit(warn.index), [612, 26]);
    const label = component<IObj & { _overflow?: number }>(nodeOf('WarnLabel').index, 'cc.Label');
    assert.equal(label._overflow, 0, '警示文字要按内容自适应，图标才能跟着居中');
    assert.ok(hasComponent(nodeOf('WarnIcon').index, 'cc.Sprite'));
    assert.ok(hasComponent(nodeOf('Mark').index, 'cc.Label'));
});

test('the three clickable nodes carry a NONE-transition Button without a target', () => {
    for (const name of ['Close', 'BtnCancel', 'BtnSure']) {
        const node = nodeOf(name);
        const button = component<IObj & { _transition: number; _target: unknown }>(node.index, 'cc.Button');
        assert.equal(button._transition, 0, `${name} 应为 NONE 过渡`);
        assert.equal(button._target, null, `${name} 不应设置 target`);
    }
});

test('CUSTOM sprites disable trimmed mode so design sizes survive frame swaps', () => {
    for (const obj of objects) {
        if (obj.__type__ !== 'cc.Sprite') continue;
        if (obj._sizeMode !== 0 || obj._type !== 0) continue;
        assert.equal(obj._isTrimmedMode, false, `${objects[(obj.node as { __id__: number }).__id__]._name} 的 CUSTOM Sprite 应关闭 trim`);
    }
});

test('the popup script binds every runtime node it writes', () => {
    const root = nodeOf('RoleComposePopup');
    const script = (root.obj._components ?? [])
        .map(ref => objects[ref.__id__])
        .find(obj => obj.__type__ !== 'cc.UITransform' && obj.__type__ !== 'cc.Widget');
    assert.ok(script, '根节点缺少 RoleComposePopup 组件');

    const expects: Array<[string, string]> = [
        ['panel', 'cc.Node'], ['titleLabel', 'cc.Label'], ['costLabel', 'cc.Label'],
        ['outSection', 'cc.Node'], ['outLabel', 'cc.Label'],
        ['warnIcon', 'cc.Node'], ['warnLabel', 'cc.Label'],
        ['closeBtn', 'cc.Button'], ['cancelBtn', 'cc.Button'], ['cancelLabel', 'cc.Label'],
        ['sureBtn', 'cc.Button'], ['sureLabel', 'cc.Label'],
    ];
    for (const [key, type] of expects) {
        const ref = (script as Record<string, { __id__: number }>)[key];
        assert.ok(ref, `脚本字段 ${key} 未绑定`);
        assert.equal(objects[ref.__id__].__type__, type, `脚本字段 ${key} 类型应为 ${type}`);
    }

    const fields = script as Record<string, { __id__: number }>;
    const templateIndex = nodeOf('ChipTemplate').index;
    const cost = objects[fields.costChips.__id__];
    const output = objects[fields.outChips.__id__];
    assert.equal(cost.__type__, output.__type__);
    for (const [ref, name] of [[fields.costChips, 'CostChips'], [fields.outChips, 'OutChips']] as const) {
        const list = objects[ref.__id__];
        const { obj, index } = nodeOf(name);
        assert.equal(list.node?.__id__, index);
        assert.ok(obj._components?.some(item => item.__id__ === ref.__id__));
        assert.equal(list.chipTemplate?.__id__, templateIndex);
    }
    assert.equal(script.chipTemplate, undefined);

    const content = (script as unknown as { contentNodes: Array<{ __id__: number }> }).contentNodes;
    assert.equal(objects[content[0].__id__]._name, 'Panel');
});
