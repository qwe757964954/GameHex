import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * `BigMapTargetPanel`（世界页的「三行文字」目标弹窗）组件行为判据。
 *
 * ⚠️ 它挂的两份 prefab（`BigMapLevelInfoPanel` / `BigMapPlayerLevelPanel`）2026-10-27 都
 * 搬去领地页并换成了专用组件（关卡界面 / 玩家关卡），所以**prefab 结构断言已删除** ——
 * 这个类现在只剩「复用同一实例时全量覆盖状态」这条行为契约还要守。
 */

test('同一弹窗复用时全量覆盖状态、费用和内容，禁用操作不触发开战，定位与关闭各走对应入口', () => {
    const exports: Record<string, new () => Record<string, any>> = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/bigmap/view/BigMapTargetPanel.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    class Component {}
    class Button { static EventType = { CLICK: 'click' }; }
    class Node { static EventType = { TOUCH_END: 'end' }; }
    runInNewContext(code, { exports, require: () => ({ Component, Button, Node, Color: class { static WHITE = {}; },
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined } }) });
    const panel = new exports.BigMapTargetPanel();
    const listeners = new Map<string, () => void>();
    const node = (name: string) => ({ active: true, children: [], parent: null,
        setPosition() {}, setScale() {}, setSiblingIndex() {}, getComponent: () => ({}),
        on: (event: string, fn: () => void, target: unknown) => listeners.set(`${name}:${event}`, fn.bind(target)) });
    const label = () => ({ string: '', node: node('label') });
    panel.node = node('root');
    panel.rootTransform = { setContentSize() {} };
    panel.panelTransform = { node: node('panel'), width: 655, height: 906 };
    panel.dimTransform = { node: node('dim'), setContentSize() {} };
    for (const key of ['title', 'tip', 'primaryLabel', 'secondaryLabel', 'cost']) panel[key] = label();
    panel.headings = [label(), label(), label()]; panel.sections = [label(), label(), label()];
    panel.costBackground = node('cost'); panel.costIcon = { node: node('icon'), spriteFrame: null };
    panel.primaryBackground = { color: null };
    for (const key of ['primary', 'secondary', 'close']) panel[key] = { node: node(key), interactable: true };
    const calls = { primary: 0, locate: 0, close: 0 };
    panel.initialize(720, 1280, () => calls.primary++, () => calls.locate++, () => calls.close++);
    const content = { title: '雾隐堡', headings: ['状态', '消耗', '说明'], sections: ['可攻打', '行动力 20', '据点'],
        tip: '服务端结算', primaryCaption: '攻打', primaryEnabled: true, staminaCost: 20, staminaIcon: {} };
    panel.render(content);
    listeners.get('primary:click')?.();
    assert.equal(calls.primary, 1);
    panel.render({ ...content, title: '边境基地', headings: ['基地'], sections: ['未开放'], tip: '',
        primaryCaption: '暂不可攻打', primaryEnabled: false, staminaCost: 0, staminaIcon: null });
    assert.equal(panel.title.string, '边境基地');
    assert.equal(panel.sections[1].string, '');
    assert.equal(panel.sections[2].string, '');
    assert.equal(panel.tip.string, '');
    assert.equal(panel.cost.node.active, false);
    assert.equal(panel.costIcon.node.active, false);
    assert.equal(panel.costBackground.active, false);
    listeners.get('primary:click')?.();
    listeners.get('secondary:click')?.();
    listeners.get('close:click')?.();
    assert.deepEqual(calls, { primary: 1, locate: 1, close: 1 });
    panel.hide();
    assert.equal(panel.node.active, false);
});
