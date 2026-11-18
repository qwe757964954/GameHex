/**
 * 引导对话条的「孔外点击区」守卫。
 *
 * 需求（2026-11-16）：对话框一出现就屏蔽主界面点击，**孔外点哪都等于点对话条**（推进台词），
 * 只有焦点孔内留给原控件（地块 / 弹窗按钮）。
 *
 * 这条链路有两个不报错的失败点，所以用守卫盯着：
 * ① `FocusMaskTop/Left/Bottom/Right` 四块如果丢了 `cc.Button`（重导 prefab 最容易），
 *    代码里的 `on(CLICK)` 绑不上，孔外点击会**直接漏给底栏**——玩家能切页，引导卡死；
 * ② `layoutBlocker` 若退回「按 maskType 判」，焦点未就绪的 hole 步会把整屏点击漏下去；
 * ③ 反过来，点击区连**对话条自己**都不盖的时候（没有孔、又不是「点对话条推进」的步），
 *    对话条就是死区：点不点都没反应、8s 超时也收不掉（2026-11-17 第 19 条，6-2 卡牌页）。
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

// 执行真实 layoutBlocker，隔离引擎；判据只有一条 —— 该铺满就铺满，其余只守对话条。
const source = ts.createSourceFile('GuideDialogView.ts', readFileSync(VIEW, 'utf8'), ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const methodText = (name: string): string => {
    const found = view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
    assert.ok(found, `GuideDialogView 缺少 ${name}`);
    return found.getText(source);
};
const exports: { Cls?: new () => { layoutBlocker(): void } } = {};
// `layoutBlocker` 现在先问同类的 `needsFullScreenBlock()`（整屏拦截的唯一判据），两个一起搬；
// 因为要互相调用，`this` 必须是**真原型链上的实例**（`Object.create(Cls.prototype)`），不能直接拿桩当 this。
runInNewContext(ts.transpileModule(
    `exports.Cls = class { ${methodText('needsFullScreenBlock')} ${methodText('layoutBlocker')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, { exports });

function fixture(hasHole: boolean) {
    const host = {
        focusRing: { active: hasHole },
        // `layoutBlocker` 现在会问 `needsFullScreenBlock()`：要靠这些字段判「这一刻铺不铺满屏」。
        canAdvance: false, dialogClosed: false, queue: [] as readonly object[], focusKey: '',
        blockerNode: {
            position: { x: 0, y: 0 },
            setPosition(x: number | { x: number; y: number }, y?: number) {
                this.position = typeof x === 'object' ? { x: x.x, y: x.y } : { x, y: y ?? 0 };
            },
        },
        blockerTransform: { width: 0, height: 0, setContentSize(width: number, height: number) { Object.assign(this, { width, height }); } },
        dialogWidget: { updateAlignment() {} },
        dialogTransform: { width: 640, height: 180 },
        dialogBox: { active: false, position: { x: 0, y: -380 } },
        hostTransform: { width: 720, height: 1560 },
    };
    return {
        host,
        layout: () => {
            const instance = Object.assign(Object.create(exports.Cls!.prototype), host) as { layoutBlocker(): void };
            instance.layoutBlocker();
        },
    };
}

test('没有焦点孔时点击区铺满全屏：hole 步焦点没就绪也不会把点击漏给主界面', () => {
    const f = fixture(false);
    f.layout();
    assert.equal(f.host.blockerTransform.width, 720);
    assert.equal(f.host.blockerTransform.height, 1560);
    assert.deepEqual(f.host.blockerNode.position, { x: 0, y: 0 });
});

/**
 * 第 19 条现场：6-2 卡牌页的 `CardList/Card_68001` 没解析出来 ⇒ 没有孔、`fullBlock` 也 false，
 * 于是点击区整条关掉，对话条成了死区：点它没反应，8s 超时推到末句照样收不掉。
 * 规则改成「有对话条就至少盖住对话条自己」—— 但**绝不许铺满屏**（那一步要等玩家点卡牌）。
 */
test('焦点没就绪但有对话条：点击区收缩到对话条，绝不铺满屏', () => {
    const f = fixture(false);
    f.host.dialogBox.active = true;
    f.layout();
    assert.equal(f.host.blockerTransform.width, 640, '只盖对话条：世界该能点的照旧能点');
    assert.equal(f.host.blockerTransform.height, 180);
    assert.deepEqual(f.host.blockerNode.position, { x: 0, y: -380 });
});

test('靠点对话条推进、孔还没就绪：即使有对话条也要铺满屏（漏一条缝就点到底栏）', () => {
    const f = fixture(false);
    f.host.dialogBox.active = true;
    f.host.canAdvance = true;
    f.host.queue = [{}];
    f.layout();
    // 「铺满屏」这一条优先于「只盖对话条」：整屏都算点对话条，底栏点不到。
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
test('弱引导：dim / 遮罩 / 气泡全关，点击区只留对话条那一块，光圈与手指照留', () => {
    const text = readFileSync(VIEW, 'utf8');
    assert.match(text, /const noMask = this\.currentMaskType === 'none';/, '要先判出弱引导形态');
    assert.match(text, /this\.dimNode\.active = !noMask && fullBlock;/, '弱引导不许压暗');
    // 点击区不再跟着 `noMask` 一起关：关掉的话对话条就是死区（第 19 条）。
    // 现在的写法是「`fullBlock` 或 有对话条」，而 `layoutBlocker` 在非 `fullBlock` 时只盖对话条，
    // 所以弱引导的世界点击照样漏不下去。
    assert.match(text, /this\.blockerNode\.active = fullBlock \|\| this\.dialogBox\.active;/, '弱引导只许盖对话条，不许铺满屏');
    assert.match(text, /if \(!this\.needsFullScreenBlock\(\) && \(this\.focusRing\.active \|\| this\.dialogBox\.active\)\) \{/,
        '非 fullBlock 时点击区收缩到对话条');
    assert.match(text, /mask\.active = !noMask && visible;/, '四块焦点遮罩也要关');
    assert.match(text, /this\.mapHint\.active = visible && !noMask && !noHint;/, '气泡提示文案要关（手指已经说明点哪）');
    // 结算页那颗「确定」也不弹气泡（用户 2026-11-17 第 16 条 ①：那里连台词一起删了）。
    assert.match(text, /const noHint = HINT_HIDDEN_PREFIXES\.some\(/, '按焦点前缀统一掐气泡，别在每处各写一遍');
    assert.match(text, /const HINT_HIDDEN_PREFIXES = \['BattleResult\/'\];/, '结算步不出气泡');
    // 光圈与手指**不受影响**：弱引导靠它们表达「点这里」。
    assert.match(text, /this\.focusRing\.active = visible;/);
    assert.match(text, /this\.focusHand\.active = visible;/);
    // alpha 也归零：只关节点的话，显隐时序差一帧就会闪一层灰。
    assert.match(text, /maskType === 'none' \? 0/, '弱引导的遮罩 alpha 必须归零');
});

/**
 * 第 19 条：点对话条必须收得起来（焦点解析不出来的步最明显）。
 *
 * 两条链缺一不可：① 有对话条就得有点击区盖住它；② 收起时不能再看「有没有孔」——
 * 旧判据 `!this.focusRing.active` 让这类步永远收不掉：点不掉、8s 超时也点不掉。
 */
test('点对话条能收起：收起判据不看「有没有孔」，点击区也不要求有孔', () => {
    const text = readFileSync(VIEW, 'utf8');
    assert.doesNotMatch(text, /this\.dialogClosed \|\| !this\.focusRing\.active/,
        '没有孔时也必须能收起，否则对话条钉在屏幕底部');
    assert.match(text, /private dismissDialog\(\): void \{\n        if \(this\.dialogClosed \|\| this\.canAdvance\) return;/,
        '只拦「靠点对话条推进」的步（那一类走 Advance，不会进这里）');
    assert.match(text, /this\.blockerNode\.active = false;/,
        '收起的同一帧就撤掉点击区，别白吃一次点击（玩家的感受就是「点了没反应」）');
});

/**
 * 弱引导「点任意地方收起对话条」（用户 2026-11-18 第 27 条：7-1 解锁地块）。
 *
 * 这几步**不能**铺一块全屏点击区来接这个活儿 —— 需求同时要求「可以点其他地块」，
 * 而 Cocos 的 UI 事件命中即止，铺满屏就等于把地块吃掉。所以走全局 `input` 监听：
 * 只读不吞，地块照常收到点击。
 *
 * 下面直接跑真方法，把引擎隔在外面。
 */
const tapExports: { Cls?: new () => ITapHost } = {};
interface ITapHost {
    dismissed: boolean;
    currentMaskType: string;
    node: { activeInHierarchy: boolean };
    dialogClosed: boolean;
    onAnywhereTap(event: { getUILocation(): { x: number; y: number } }): void;
}
runInNewContext(ts.transpileModule(
    `exports.Cls = class {
        constructor() { this.dismissed = false; this.currentMaskType = 'none'; this.alive = true; this.node = { activeInHierarchy: true }; this.dialogClosed = false;
            this.dialogBox = { active: true };
            this.idleArmed = true;
            this.dialogTransform = { getBoundingBoxToWorld: () => ({ contains: (p) => p.x >= 0 && p.x <= 100 }) }; }
        unschedule() {}
        dismissDialog() { this.dismissed = true; }
        ${methodText('onAnywhereTap')}
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, { exports: tapExports });

function tapFixture(): { host: ITapHost & { dialogBox: { active: boolean } }; tap(x: number): boolean } {
    const host = new tapExports.Cls!() as ITapHost & { dialogBox: { active: boolean } };
    return { host, tap: (x: number) => { host.onAnywhereTap({ getUILocation: () => ({ x, y: 10 }) }); return host.dismissed; } };
}

test('弱引导点对话条以外的地方会收起对话条（点对话条自己仍走逐句推进）', () => {
    const outside = tapFixture();
    assert.equal(outside.tap(400), true, '点屏幕别处 → 收起');
    const inside = tapFixture();
    assert.equal(inside.tap(50), false, '点对话条自己 → 交给 onTap 逐句推进，不许一碰就关');
});

test('只有弱引导（none）吃「点哪都收」；full / hole 的收起路径是遮罩与 Blocker', () => {
    const full = tapFixture();
    full.host.currentMaskType = 'full';
    assert.equal(full.tap(400), false, 'full 步点别处会推进台词，不能顺带把对话条关掉');
    const hole = tapFixture();
    hole.host.currentMaskType = 'hole';
    assert.equal(hole.tap(400), false);
});

test('本层没显示 / 台词已收 / 对话条已关时，全局触摸什么都不做', () => {
    const hidden = tapFixture();
    hidden.host.node.activeInHierarchy = false;
    assert.equal(hidden.tap(400), false, '引导层不在显示时不许吃掉别处的点击语义');
    const closed = tapFixture();
    closed.host.dialogClosed = true;
    assert.equal(closed.tap(400), false);
    const noBox = tapFixture();
    noBox.host.dialogBox.active = false;
    assert.equal(noBox.tap(400), false);
});
