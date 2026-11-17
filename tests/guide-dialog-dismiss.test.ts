/**
 * 「台词播完 → 收起对话条 → 只剩光圈 / 手指的强制引导」这条链路的判据。
 *
 * 需求（2026-11-17）：对话结束后关掉对话框，强制引导阶段只剩光圈 / 手指 / 气泡。
 * 两个不报错的失败点：
 * ① 非 `click` 步（翻地块 / 抽卡 / 确认按钮）最后一句点了没反应 ⇒ 对话条常驻屏幕底部，
 *    玩家以为还要继续点，实际该点光圈里的目标；
 * ② 焦点还没解析出来（光圈没显示）就收起 ⇒ 玩家既没字看也没地方点，只能等超时兜底。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { GuideEvent } from '../assets/script/app/guide/application/GuideEvents';

const PATH = 'assets/script/app/guide/ui/GuideDialogView.ts';
const viewSource = readFileSync(PATH, 'utf8');
const source = ts.createSourceFile('GuideDialogView.ts', viewSource, ts.ScriptTarget.Latest, true);
const viewClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;

function methodText(name: string): string {
    const found = viewClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
    assert.ok(found, `GuideDialogView 缺少 ${name}`);
    return found.getText(source);
}

interface ISignal {
    readonly name: string;
    readonly payload: { readonly owner: object; readonly stepId: string };
}

const signals: ISignal[] = [];

const exports: { View?: new () => object } = {};
runInNewContext(ts.transpileModule(
    `exports.View = class { dialogClosed = false; ${methodText('onTap')} ${methodText('dismissDialog')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, {
    exports,
    console,
    EventMgr: { instance: { emit: (name: string, payload: ISignal['payload']) => { signals.push({ name, payload }); } } },
    GuideEvent,
});

function fixture(lines: number, ringVisible = true) {
    signals.length = 0;
    const stub = {
        index: 0, queue: new Array(lines).fill({}) as readonly object[], canAdvance: false, idleArmed: true,
        stepId: '2-1', dialogBox: { active: true }, focusRing: { active: ringVisible },
        played: 0, portraits: 0, layouts: 0,
        unschedule(this: { idleArmed: boolean }) { this.idleArmed = false; },
        playLine(this: { index: number; played: number }, next: number) { this.index = next; this.played += 1; },
        hidePortrait(this: { portraits: number }) { this.portraits += 1; },
        layoutBlocker(this: { layouts: number }) { this.layouts += 1; },
    };
    return Object.assign(new exports.View!(), stub) as typeof stub & { onTap(): void };
}

test('中间句只推进下一步，不碰对话条也不发推进信号', () => {
    const view = fixture(3);
    view.onTap();
    assert.equal(view.index, 1);
    assert.equal(view.played, 1);
    assert.equal(view.dialogBox.active, true);
    assert.deepEqual(signals, []);
});

test('click 步最后一句只报告推进意图，对话条交给下一步重开', () => {
    const view = fixture(2);
    view.index = 1;
    view.canAdvance = true;
    view.onTap();
    assert.deepEqual(signals.map(item => item.name), [GuideEvent.Advance]);
    assert.equal(view.dialogBox.active, true, 'click 步不在这里收对话条');
});

test('非 click 步最后一句收起对话条：连立绘一起收，点击区按剩余画面重排', () => {
    const view = fixture(2);
    view.index = 1;
    view.onTap();
    assert.equal(view.dialogBox.active, false, '对话结束就该关掉对话框');
    assert.equal(view.portraits, 1, '立绘跟着对话条一起收');
    assert.equal(view.layouts, 1, '点击区要按新尺寸重排');
    assert.deepEqual(signals, [], '不是 click 步，不该往 Controller 报推进');
});

test('光圈还没显示（焦点未就绪）时不收对话条，避免两头都点不到', () => {
    const view = fixture(2, false);
    view.index = 1;
    view.onTap();
    assert.equal(view.dialogBox.active, true);
    assert.equal(view.portraits, 0);
    // 焦点随后就绪，再点一次正常收起。
    view.focusRing.active = true;
    view.onTap();
    assert.equal(view.dialogBox.active, false);
});

test('重复点击已收起的对话条不会重复收立绘/重排', () => {
    const view = fixture(2);
    view.index = 1;
    view.onTap();
    view.onTap();
    view.onTap();
    assert.equal(view.portraits, 1);
    assert.equal(view.layouts, 1);
});

test('每帧对齐不得把收起的对话条又打开（placeFocusRing 必须判 dialogClosed）', () => {
    assert.match(viewSource,
        /this\.dialogBox\.active = !waitingForBattleFocus && !this\.dialogClosed && this\.queue\.length > 0/,
        'placeFocusRing 每帧重设 active，漏掉 dialogClosed 就会把对话条立刻打开');
});

/**
 * 需求（2026-11-17）的静态口径：对话框贴屏幕底部留 10px、立绘按绿框 233 高、立绘在对话条下层。
 * 这三条都在 prefab 里，代码改坏了样式也看不出来，所以钉在资源上。
 */
test('预制体：对话条贴底 10px、立绘盒 233、立绘排在对话条之前（渲染在下层）', () => {
    const prefab = JSON.parse(readFileSync('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab', 'utf8')) as {
        __type__?: string; _name?: string; _parent?: { __id__?: number }; _children?: { __id__?: number }[];
        _components?: { __id__?: number }[]; portraitNode?: unknown; dialogBox?: unknown; portraitHeight?: number;
        [key: string]: unknown;
    }[];
    const node = (name: string) => prefab.find(item => item.__type__ === 'cc.Node' && item._name === name)!;
    const components = (owner: { _components?: { __id__?: number }[] }) =>
        (owner._components ?? []).map(ref => prefab[ref.__id__ ?? -1]);

    const box = node('DialogBox');
    const widget = components(box).find(item => item.__type__ === 'cc.Widget')!;
    assert.equal(widget._bottom, 10, '对话框要贴屏幕底部留 10px');

    const view = prefab.find(item => item.portraitNode && item.dialogBox)!;
    assert.equal(view.portraitHeight, 233, '立绘盒高度取绿框口径 233');

    // 渲染顺序 = 同级顺序：立绘必须排在 DialogBox 之前，才会被不透明的 Bg 挡住下半截。
    const siblings = (node('GuideDialog')._children ?? []).map(ref => prefab[ref.__id__ ?? -1]._name);
    assert.ok(siblings.indexOf('Portrait') >= 0 && siblings.indexOf('DialogBox') >= 0, '立绘与对话条都还在');
    assert.ok(siblings.indexOf('Portrait') < siblings.indexOf('DialogBox'), '立绘要置于对话框的下层');
});
