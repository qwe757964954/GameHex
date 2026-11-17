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
}).outputText, { exports, HEX_GRID_CONTENT_LIFT: 0, guideDialogBottom });

function fixture(x: number, y: number) {
    const point = () => ({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } });
    // `placeFocusRing` 现在会先比较再写（每帧不重复标脏），所以桩节点要有 `position`。
    const node = () => ({
        active: false, position: { x: 0, y: 0, z: 0, equals: () => false },
        setPosition() {}, setScale() {},
    });
    const transform = { width: 100, height: 152, anchorX: 0.5, anchorY: 0.5,
        convertToWorldSpaceAR: (p: { x: number; y: number }, out: object) => Object.assign(out, { x: p.x + x, y: p.y + y }) };
    const host = {
        focusTarget: { shape: 'rect', node: { isValid: true, activeInHierarchy: true } }, focusTransform: transform,
        hostTransform: { width: 720, height: 1560, convertToNodeSpaceAR: (p: object, out: object) => Object.assign(out, p) },
        focusWidth: 108, focusHeight: 160, focusClips: [] as object[], focusKey: 'Main/CardEntry',
        focusCorner: point(), focusWorld: point(), focusLocal: point(), focusEdgeWorld: point(), clipCenter: point(), clipCorner: point(),
        focusRing: node(), focusHand: node(), mapHint: node(), dimNode: node(), dialogBox: node(), blockerNode: node(), portraitNode: node(),
        focusMasks: [node(), node(), node(), node()], hintTransform: { width: 250 }, dialogTransform: { width: 660, height: 184 },
        dialogWidget: { bottom: 168 }, defaultDialogBottom: 168, queue: [{}], currentMaskType: 'full',
        layoutFocusMasks() {}, layoutBlocker() {}, placePortrait() {},
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
    assert.equal(f.host.dialogWidget.bottom, 392, '底栏入口的手指与提示条上方留出对话位置');
    f.host.focusTarget.node.activeInHierarchy = false;
    f.place();
    assert.equal(f.host.dialogWidget.bottom, 168, '焦点失活后恢复预制体留白');
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

// 2026-11-16「手指呼吸卡顿」：焦点静止时每帧重设遮罩尺寸会让 Sprite 重建顶点缓冲。
// 抽出真实的 placeMask，锁住「值没变就不写」这条。
const maskMethod = view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'placeMask')!;
const maskExports: { place?: (this: object, index: number, x: number, y: number, width: number, height: number) => void } = {};
runInNewContext(ts.transpileModule(`exports.place = class { ${maskMethod.getText(source)} }.prototype.placeMask;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: maskExports });

function maskFixture() {
    let posWrites = 0, sizeWrites = 0;
    const node = {
        position: { x: 100, y: 200 },
        setPosition(x: number, y: number) { posWrites++; this.position = { x, y }; },
    };
    const size = {
        width: 300, height: 400,
        setContentSize(width: number, height: number) { sizeWrites++; this.width = width; this.height = height; },
    };
    const host = { focusMasks: [node], maskTransforms: [size] };
    return { host, place: (x: number, y: number, w: number, h: number) => maskExports.place!.call(host, 0, x, y, w, h),
        writes: () => ({ posWrites, sizeWrites }) };
}

test('焦点静止时遮罩不再逐帧重设尺寸/位置，只有真变化才写节点', () => {
    const f = maskFixture();
    f.place(100, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 0, sizeWrites: 0 }, '与当前值一致时不得写节点');
    f.place(100, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 0, sizeWrites: 0 }, '连帧重复调用同样不写');
    f.place(110, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 0 }, '只有位置变了才写位置');
    f.place(110, 200, 320, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 1 }, '只有尺寸变了才写尺寸');
    // 负尺寸夹成 0。
    f.place(110, 200, -5, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 2 });
});
