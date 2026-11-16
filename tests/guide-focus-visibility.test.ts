import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { guideDialogBottom } from '../assets/script/app/guide/model/GuidePresentation';

// 执行真实定位方法，隔离引擎渲染；覆盖贴边按钮与滚动视口的裁剪判断。
const source = ts.createSourceFile('GuideDialogView.ts', readFileSync(
    'assets/script/app/guide/ui/GuideDialogView.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const method = view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'placeFocusRing')!;
const exports: { place?: (this: object) => void } = {};
runInNewContext(ts.transpileModule(`exports.place = class { ${method.getText(source)} }.prototype.placeFocusRing;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, guideDialogBottom, HEX_GRID_CONTENT_LIFT: 0 });

function fixture(x: number, y: number) {
    const point = () => ({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } });
    const node = () => ({ active: false, setPosition() {}, setScale() {} });
    const transform = { width: 100, height: 152, anchorX: 0.5, anchorY: 0.5,
        convertToWorldSpaceAR: (p: { x: number; y: number }, out: object) => Object.assign(out, { x: p.x + x, y: p.y + y }) };
    const host = {
        focusTarget: { shape: 'rect', node: { isValid: true, activeInHierarchy: true } }, focusTransform: transform,
        hostTransform: { width: 720, height: 1560, convertToNodeSpaceAR: (p: object, out: object) => Object.assign(out, p) },
        focusWidth: 108, focusHeight: 160, focusClips: [] as object[], focusKey: 'Main/CardEntry',
        focusCorner: point(), focusWorld: point(), focusLocal: point(), focusEdgeWorld: point(), clipCenter: point(), clipCorner: point(),
        focusRing: node(), focusHand: node(), mapHint: node(), dimNode: node(), dialogBox: node(), blockerNode: node(),
        focusMasks: [node(), node(), node(), node()], hintTransform: { width: 250 }, dialogTransform: { height: 154 },
        defaultDialogBottom: 115, dialogWidget: { bottom: 115 }, queue: [{}], currentMaskType: 'full',
        layoutFocusMasks() {}, layoutBlocker() {},
    };
    return { host, place: () => exports.place!.call(host) };
}

test('底栏卡牌入口贴屏幕底边时，装饰留白不得隐藏高亮和手指', () => {
    const f = fixture(-200, -704);
    f.place();
    assert.equal(f.host.focusRing.active, true);
    assert.equal(f.host.focusHand.active, true);
    assert.equal(f.host.dimNode.active, false);
    assert.ok(f.host.focusMasks.every(node => node.active));
    assert.ok(f.host.dialogWidget.bottom > 152);
});

test('横向贴边也可高亮，真实控件离屏或失活仍隐藏', () => {
    const f = fixture(310, 0);
    f.place();
    assert.equal(f.host.focusRing.active, true);
    f.host.focusTransform.width = 102;
    f.place();
    assert.equal(f.host.focusRing.active, false);
    f.host.focusTransform.width = 100;
    f.host.focusTarget.node.activeInHierarchy = false;
    f.place();
    assert.equal(f.host.focusHand.active, false);
});

test('卡牌贴滚动视口边缘时忽略装饰留白，真实内容被裁剪时仍隐藏', () => {
    const f = fixture(0, -124);
    f.host.focusClips.push({ width: 300, height: 400, anchorX: 0.5, anchorY: 0.5,
        convertToNodeSpaceAR: (p: object, out: object) => Object.assign(out, p) });
    f.place();
    assert.equal(f.host.focusRing.active, true);
    f.host.focusTransform.height = 154;
    f.place();
    assert.equal(f.host.focusRing.active, false);
});
