/**
 * 引导对话条的「孔外点击区」守卫。
 *
 * 需求（2026-11-16）：对话框一出现就屏蔽主界面点击，**孔外点哪都等于点对话条**（推进台词），
 * 只有焦点孔内留给原控件（地块 / 弹窗按钮）。
 *
 * 这条链路有两个不报错的失败点，所以用守卫盯着：
 * ① `FocusMaskTop/Left/Bottom/Right` 四块如果丢了 `cc.Button`（重导 prefab 最容易），
 *    代码里的 `on(CLICK)` 绑不上，孔外点击会**直接漏给底栏**——玩家能切页，引导卡死；
 * ② `layoutBlocker` 若退回「按 maskType 判」，焦点未就绪的 hole 步会把整屏点击漏下去。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const PREFAB = 'assets/bundles/main-pages/ui/Guide/GuideDialog.prefab';
const VIEW = 'assets/script/app/guide/ui/GuideDialogView.ts';
const MASKS = ['FocusMaskTop', 'FocusMaskLeft', 'FocusMaskBottom', 'FocusMaskRight'];

interface IPrefabObject {
    readonly __type__?: string;
    readonly __id__?: number;
    readonly _name?: string;
    readonly _components?: readonly { readonly __id__?: number }[];
    readonly [key: string]: unknown;
}

const prefab = JSON.parse(readFileSync(PREFAB, 'utf8')) as IPrefabObject[];

/** 节点 → 它挂的组件对象。 */
function componentsOf(node: IPrefabObject): IPrefabObject[] {
    return (node._components ?? []).map(ref => prefab[ref.__id__ ?? -1]).filter(Boolean) as IPrefabObject[];
}

test('四块焦点遮罩都挂着可点的 Button（丢了就绑不上 CLICK，孔外点击会漏给底栏）', () => {
    for (const name of MASKS) {
        const node = prefab.find(item => item.__type__ === 'cc.Node' && item._name === name);
        assert.ok(node, `${name} 节点不存在`);
        const button = componentsOf(node).find(item => item.__type__ === 'cc.Button');
        assert.ok(button, `${name} 缺少 cc.Button：孔外点击会穿透到主界面`);
        // transition=NONE：点一下不能让遮罩变色（它同时是半透明 Dim）。
        assert.equal(button._transition, 0, `${name} 的 Button 应为 NONE transition`);
        assert.notEqual(button._interactable, false, `${name} 的 Button 必须可交互`);
    }
});

test('遮罩的 CLICK 绑到推进对话的同一个 handler 上，不是自己另写一套', () => {
    const lines = readFileSync(VIEW, 'utf8').split('\n');
    const bound = lines.filter(line => line.includes('focusMasks'));
    assert.ok(bound.some(line => line.includes('Button.EventType.CLICK') && line.includes('this.onTap')),
        'focusMasks 没有绑 CLICK → onTap：孔外点击不会推进对话');
});

// 执行真实 layoutBlocker，隔离引擎；判据只有一条 —— 有孔守对话条，没孔铺满。
const source = ts.createSourceFile('GuideDialogView.ts', readFileSync(VIEW, 'utf8'), ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const method = view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'layoutBlocker')!;
const exports: { layout?: (this: object) => void } = {};
runInNewContext(ts.transpileModule(`exports.layout = class { ${method.getText(source)} }.prototype.layoutBlocker;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports });

function fixture(hasHole: boolean) {
    const host = {
        focusRing: { active: hasHole },
        blockerNode: {
            position: { x: 0, y: 0 },
            setPosition(x: number | { x: number; y: number }, y?: number) {
                this.position = typeof x === 'object' ? { x: x.x, y: x.y } : { x, y: y ?? 0 };
            },
        },
        blockerTransform: { width: 0, height: 0, setContentSize(width: number, height: number) { Object.assign(this, { width, height }); } },
        dialogWidget: { updateAlignment() {} },
        dialogTransform: { width: 640, height: 180 },
        dialogBox: { position: { x: 0, y: -380 } },
        hostTransform: { width: 720, height: 1560 },
    };
    return { host, layout: () => exports.layout!.call(host) };
}

test('没有焦点孔时点击区铺满全屏：hole 步焦点没就绪也不会把点击漏给主界面', () => {
    const f = fixture(false);
    f.layout();
    assert.equal(f.host.blockerTransform.width, 720);
    assert.equal(f.host.blockerTransform.height, 1560);
    assert.deepEqual(f.host.blockerNode.position, { x: 0, y: 0 });
});

test('有焦点孔时点击区只守对话条，孔内外分工交给四块遮罩与原控件', () => {
    const f = fixture(true);
    f.layout();
    assert.equal(f.host.blockerTransform.width, 640);
    assert.equal(f.host.blockerTransform.height, 180);
    assert.deepEqual(f.host.blockerNode.position, { x: 0, y: -380 });
});

/**
 * 弱引导（`maskType: none`，用户 2026-11-17 第 12 条）：两个翻地块步骤
 * **不压暗、不挡点击、不弹气泡文案，只留光圈 + 手指**。
 *
 * 这几条只能靠源码守卫：《GuideDialogView` 是 cc.Component，整类跑起来要 prefab
 * 和引擎节点；而这里错的后果是「屏幕上多一层灰」或「手指没了」，都不是报错型失败。
 */
test('弱引导：dim / 遮罩 / 点击区 / 气泡全关，光圈与手指照留', () => {
    const text = readFileSync(VIEW, 'utf8');
    assert.match(text, /const noMask = this\.currentMaskType === 'none';/, '要先判出弱引导形态');
    assert.match(text, /this\.dimNode\.active = !noMask && fullBlock;/, '弱引导不许压暗');
    assert.match(text, /this\.blockerNode\.active = !noMask && \(visible \|\| fullBlock\);/, '弱引导不许挡点击');
    assert.match(text, /mask\.active = !noMask && visible;/, '四块焦点遮罩也要关');
    assert.match(text, /this\.mapHint\.active = visible && !noMask;/, '气泡提示文案要关（手指已经说明点哪）');
    // 光圈与手指**不受影响**：弱引导靠它们表达「点这里」。
    assert.match(text, /this\.focusRing\.active = visible;/);
    assert.match(text, /this\.focusHand\.active = visible;/);
    // alpha 也归零：只关节点的话，显隐时序差一帧就会闪一层灰。
    assert.match(text, /maskType === 'none' \? 0/, '弱引导的遮罩 alpha 必须归零');
});
