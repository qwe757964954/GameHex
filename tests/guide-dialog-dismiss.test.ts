/**
 * 「台词播完 → 收起对话条 → 只剩光圈 / 手指的强制引导」这条链路的判据。
 *
 * 需求（2026-11-17）：对话结束后关掉对话框，强制引导阶段只剩光圈 / 手指 / 气泡。
 * 两个不报错的失败点：
 * ① 非 `click` 步（翻地块 / 抽卡 / 确认按钮）最后一句点了没反应 ⇒ 对话条常驻屏幕底部，
 *    玩家以为还要继续点，实际该点光圈里的目标；
 * ② 反过来，焦点解析不出来（光圈没显示）时**也必须能收起**：那一步世界本来就没被挡，
 *    收起只会让玩家更自由；旧判据「没有孔就不许收」让 6-2 那种步永远收不掉（第 19 条）。
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
        // 第 19 条起 `dismissDialog` 会在同一帧撤掉点击区（`blockerNode.active = false`）。
        blockerNode: { active: true },
        played: 0, portraits: 0, layouts: 0, flushes: 0,
        unschedule(this: { idleArmed: boolean }) { this.idleArmed = false; },
        playLine(this: { index: number; played: number }, next: number) { this.index = next; this.played += 1; },
        hidePortrait(this: { portraits: number }) { this.portraits += 1; },
        layoutBlocker(this: { layouts: number }) { this.layouts += 1; },
        // 第 20 条：收起台词的那一帧要把「被挡住的换步」补上。
        flushPendingState(this: { flushes: number }) { this.flushes += 1; },
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
    assert.equal(view.flushes, 1, '收起这一帧就要把「被台词挡住的换步」补上（第 20 条）');
    assert.deepEqual(signals, [], '不是 click 步，不该往 Controller 报推进');
});

test('光圈还没显示（焦点未就绪）时也能收起：那一步的世界本来就没被挡（第 19 条）', () => {
    const view = fixture(2, false);
    view.index = 1;
    view.onTap();
    // 旧行为是「不收」：6-2 的 `CardList/Card_68001` 解析不出来时，对话条就此钉在屏幕底部 ——
    // 玩家点不掉、8s 超时那条也点不掉。
    assert.equal(view.dialogBox.active, false, '焦点没就绪也必须收得掉');
    assert.equal(view.portraits, 1, '立绘跟着收');
    assert.equal(view.blockerNode.active, false, '同一帧撤掉点击区，别白吃一次点击');
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
    // 第 24 条在这条判断里加了一个 `awaitingNarration`（等关卡光圈），dialogClosed 仍然必须在。
    assert.match(viewSource,
        /this\.dialogBox\.active = !waitingForBattleFocus && !awaitingNarration\s*\n?\s*&& !this\.dialogClosed && this\.queue\.length > 0/,
        'placeFocusRing 每帧重设 active，漏掉 dialogClosed 就会把对话条立刻打开');
});

// 第 20 条：换步不能把还没说完的台词一起拆掉（战斗抽卡那张牌只活 1.156s）。
const holdExports: { View?: new () => object } = {};
runInNewContext(ts.transpileModule(
    `exports.View = class { stepId = ''; queue = []; dialogClosed = false; focusKey = ''; ${methodText('shouldHoldForDialog')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, { exports: holdExports });

interface IHoldView {
    stepId: string;
    queue: readonly object[];
    dialogClosed: boolean;
    focusKey: string;
    shouldHoldForDialog(state: { stepId: string; dialogId: string }): boolean;
}

function holdFixture(): IHoldView {
    return Object.assign(new holdExports.View!(), {
        stepId: '5-3', queue: [{}, {}, {}], dialogClosed: false, focusKey: 'Battle/DrawnCard',
    }) as IHoldView;
}

test('战斗抽卡：卡牌 1.156s 就没了，切 5-4 时台词必须留在屏幕上（第 20 条）', () => {
    const view = holdFixture();
    // `5-3` 的 D06 有 3 句、`5-4` 没有台词 ⇒ 挡住，等台词按 8s/句播完（或点掉）再切画面。
    assert.equal(view.shouldHoldForDialog({ stepId: '5-4', dialogId: '' }), true);
    // 上一步的台词已经收起 ⇒ 立刻切。
    view.dialogClosed = true;
    assert.equal(view.shouldHoldForDialog({ stepId: '5-4', dialogId: '' }), false);
});

test('新的一步自己有台词时不挡：否则下一步的推进点击会被吞掉（`cardLevelUp` 落在旧步上）', () => {
    const view = holdFixture();
    assert.equal(view.shouldHoldForDialog({ stepId: '6-3', dialogId: 'D09' }), false);
    // 同一步重刷（弹窗开关 / 事件回流）绝不挡。
    assert.equal(view.shouldHoldForDialog({ stepId: '5-3', dialogId: '' }), false);
});

test('玩家自己点出来的换步不挡（5-1 点关卡 → 5-2）：只拦战斗内的完成判定', () => {
    const view = holdFixture();
    view.stepId = '5-1';
    view.focusKey = 'Map/Level_10001';
    assert.equal(view.shouldHoldForDialog({ stepId: '5-2', dialogId: '' }), false);
});

test('`render` 先判「要不要等台词」，`hide` 丢掉暂存状态', () => {
    assert.match(viewSource, /if \(this\.shouldHoldForDialog\(state\)\) \{\n            this\.pendingState = state;/,
        'render 开头就要拦，不能先改 stepId 再判');
    assert.match(methodText('dismissDialog'), /this\.flushPendingState\(\);/, '收起台词的那一帧补上换步');
    assert.match(methodText('hide'), /this\.pendingState = null;/, '整层收起时别留着旧状态');
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
