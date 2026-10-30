import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
/**
 * 「点击空白关闭」的回归网（`framework/ui/PopupBase.ts`）。
 *
 * 这段逻辑的失效方式很隐蔽：**不报错、不抛异常，只是点了没反应**。
 * 所以这里不测「代码长什么样」，而是把 `cc` 打桩成一套最小可用的节点系统，
 * 真的把 `PopupBase` 跑起来，钉住三件事：
 *
 *   A. **空白接收层**：只挂在弹窗根节点上是不够的 —— 根节点 `UITransform` 只有 100×100 时，
 *      空白处的触摸根本命中不到它（本工程 14 个联盟弹窗里 13 个就是这种情况）。
 *      必须由运行时补出的全屏 `__BlankClose` 来收事件，且它在**最底层**（按钮优先）。
 *   B. **全屏装饰底图**要从内容区里排掉**​**，否则整屏都算「点在内容上」，空白点击永不生效。
 *      阈值必须按**设计分辨率**算：长屏适配时 `view.getVisibleSize()` 会被拉高
 *      （实测预览 720×1485 vs 设计 720×1280），按可见区算 `Bg` 只有 0.86、过不了线。
 *   C. **关掉「点空白关闭」的弹窗**（Toast / LoadingPopup）不能铺这层 ——
 *      接收层是全屏的，铺上去等于替下层吃掉所有点击。
 *
 * 坐标口径（实测，别改）：Canvas 位于世界 `(360,742.5)`，
 * 即 UI 世界空间原点是**屏幕左下角** ⇒ `getUILocation()` 可以和 `getBoundingBoxToWorld()` 直接比。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// ============================================================
// 最小 cc 桩：够 PopupBase 跑起来
// ============================================================

const DESIGN = { width: 720, height: 1280 };
/** ⚠️ 刻意与设计分辨率不同：长屏适配下的真实可见高度（就是让 `Bg` 过不了线的那条） */
const VISIBLE = { width: 720, height: 1485 };
/** 弹窗层节点在世界空间的位置（实测值）。 */
const LAYER_WORLD = { x: 360, y: 742.5 };

class StubVec2 {
    x = 0;
    y = 0;
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x: number, y: number): this { this.x = x; this.y = y; return this; }
}
class StubVec3 extends StubVec2 {
    z = 0;
    constructor(x = 0, y = 0, z = 0) { super(x, y); this.z = z; }
    set(x: number, y: number, z = 0): this { super.set(x, y); this.z = z; return this; }
}

type StubNodeAny = any;

class StubUITransform {
    width = 0;
    height = 0;
    anchorPoint = { x: 0.5, y: 0.5 };
    node: StubNodeAny = null;
    get contentSize(): { width: number; height: number } { return { width: this.width, height: this.height }; }
    setContentSize(w: number, h: number): void { this.width = w; this.height = h; }
    /** UI 世界空间原点在屏幕左下角（实测），所以世界坐标 = 各层 position 累加。 */
    getBoundingBoxToWorld(): { x: number; y: number; width: number; height: number } {
        const p = this.node.worldPosition();
        return { x: p.x - this.width / 2, y: p.y - this.height / 2, width: this.width, height: this.height };
    }
    hitTest(pt: { x: number; y: number }): boolean {
        const b = this.getBoundingBoxToWorld();
        return pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
    }
    convertToWorldSpaceAR(v: { x: number; y: number }): StubVec3 {
        const p = this.node.worldPosition();
        return new StubVec3(p.x + v.x, p.y + v.y, 0);
    }
    convertToNodeSpaceAR(v: { x: number; y: number }): StubVec3 {
        const p = this.node.worldPosition();
        return new StubVec3(v.x - p.x, v.y - p.y, 0);
    }
}

class StubNode {
    static EventType = {
        TOUCH_START: 'touch-start',
        TOUCH_MOVE: 'touch-move',
        TOUCH_END: 'touch-end',
        TOUCH_CANCEL: 'touch-cancel',
    };
    name: string;
    layer = 1 << 25;
    active = true;
    parent: StubNodeAny = null;
    children: StubNodeAny[] = [];
    components: any[] = [];
    isValid = true;
    position: { x: number; y: number } = { x: 0, y: 0 };
    /** 事件监听表：与引擎的 `_callbackTable` 同构（事件类型 → 回调数组）。 */
    listeners: Record<string, { cb: (...args: any[]) => void; target: unknown }[]> = {};

    constructor(name = '') { this.name = name; }

    get activeInHierarchy(): boolean { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    worldPosition(): { x: number; y: number } {
        const p = this.parent && this.parent.isValid ? this.parent.worldPosition() : LAYER_WORLD;
        return { x: p.x + this.position.x, y: p.y + this.position.y };
    }
    addComponent<T>(Type: new () => T): T {
        const c = new Type();
        (c as any).node = this;
        this.components.push(c);
        return c;
    }
    getComponent(Type: any): any {
        const key = typeof Type === 'string' ? Type.replace(/^cc\./, '') : Type?.name;
        return this.components.find((c) => c.constructor.name === key || (Type && c instanceof Type)) ?? null;
    }
    insertChild(child: StubNodeAny, index: number): void {
        child.parent = this;
        this.children.splice(index, 0, child);
    }
    addChild(child: StubNodeAny): void { this.insertChild(child, this.children.length); }
    setPosition(x: number, y: number): void { this.position = { x, y }; }
    removeFromParent(): void { this.parent = null; }
    destroy(): void { this.isValid = false; }
    getChildByName(name: string): StubNodeAny {
        return this.children.find((c) => c.name === name) ?? null;
    }
    on(type: string, cb: (...args: any[]) => void, target?: unknown): void {
        (this.listeners[type] ??= []).push({ cb, target });
    }
    off(type: string, cb: (...args: any[]) => void): void {
        this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l.cb !== cb);
    }
}

class StubComponent {
    node: StubNodeAny = null;
}
class StubSprite {}
class StubButton {}
class StubEditBox {}
class StubMask {}
class StubScrollView {}
class StubPageView {}

const ccStub = {
    _decorator: {
        ccclass: () => (cls: unknown) => cls,
        property: () => () => {},
    },
    Button: StubButton,
    EditBox: StubEditBox,
    Mask: StubMask,
    ScrollView: StubScrollView,
    PageView: StubPageView,
    Sprite: StubSprite,
    UITransform: StubUITransform,
    Node: StubNode,
    Component: StubComponent,
    Vec2: StubVec2,
    Vec3: StubVec3,
    EventTouch: class {},
    Director: { EVENT_AFTER_UPDATE: 'after-update' },
    director: { once: () => {}, off: () => {} },
    view: {
        getVisibleSize: () => ({ ...VISIBLE }),
        getDesignResolutionSize: () => ({ ...DESIGN }),
    },
};

/** 事件节点名常量（与 PopupBase 导出一致）。 */
const TOUCH_EVENTS = ['touch-start', 'touch-move', 'touch-end', 'touch-cancel'];

type PopupBaseCtor = (new () => any) & {
    /** 静态判据：该节点是不是「全屏装饰底图」。 */
    isBlankBackdrop: (node: unknown) => boolean;
};

function loadPopupBase(): PopupBaseCtor {
    const context: {
        exports: { PopupBase?: PopupBaseCtor };
        console: Console;
        require: (name: string) => unknown;
    } = {
        exports: {},
        console,
        require: (name: string) => {
            if (name.endsWith('/ResourceScope')) return { ResourceScope };
            if (name.endsWith('/AssetService')) return { scopeAssetService };
            if (name.endsWith('/ProcedureManager')) return { ProcedureManager: { instance: null } };
            if (name === 'cc') return ccStub;
            if (name === './PopupDef') return require('../assets/script/framework/ui/PopupDef');
            if (name === './PopupManager') return { PopupManager: { inst: null, owns: () => false } };
            throw new Error(`未打桩的依赖: ${name}`);
        },
    };
    runInNewContext(
        ts.transpileModule(readFileSync('assets/script/framework/ui/PopupBase.ts', 'utf8'), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                experimentalDecorators: true,
            },
        }).outputText,
        context,
    );
    return context.exports.PopupBase as PopupBaseCtor;
}

const PopupBase = loadPopupBase();
/** 与 PopupBase 内部常量保持一致。 */
const CATCHER = '__BlankClose';

// ============================================================
// 搭一个「弹窗」：根节点 100×100（就是本工程联盟弹窗的真实尺寸）+ 弹窗层父节点
// ============================================================

function buildPopup() {
    const layer = new StubNode('Popup');
    const detector = new StubUITransform();
    detector.node = layer;
    detector.setContentSize(VISIBLE.width, VISIBLE.height);
    layer.components.push(detector);

    const root = new StubNode('LeagueXxx');
    const rootUi = new StubUITransform();
    rootUi.node = root;
    rootUi.setContentSize(100, 100); // ⚠️ 真实尺寸：根节点不覆盖整屏
    root.components.push(rootUi);
    layer.addChild(root);

    const popup = new PopupBase();
    popup.node = root;
    return { layer, root, popup };
}

/** 造一个子节点（带 UITransform，可选 Sprite / Button）。 */
function child(root: StubNode, name: string, w: number, h: number, opts: { sprite?: boolean; button?: boolean; y?: number } = {}) {
    const n = new StubNode(name);
    n.position = { x: 0, y: opts.y ?? 0 };
    const ui = new StubUITransform();
    ui.node = n;
    ui.setContentSize(w, h);
    n.components.push(ui);
    if (opts.sprite) { const s = new StubSprite(); (s as any).node = n; n.components.push(s as any); }
    if (opts.button) { const b = new StubButton(); (b as any).node = n; n.components.push(b as any); }
    root.addChild(n);
    return n;
}

/** 合成触摸事件：`getUILocation` 给 UI 世界坐标，`getLocation` 给屏幕坐标（桩里同一套）。 */
function touchAt(x: number, y: number) {
    return {
        getLocation: (o: any) => { o.x = x; o.y = y; return o; },
        getUILocation: (o: any) => { o.x = x; o.y = y; return o; },
    };
}

// ============================================================
// A. 空白接收层
// ============================================================

test('A1 空白接收层建在全屏尺寸、插在最底层、且无任何渲染组件', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706);
    child(root, 'CloseBtn', 54, 51, { button: true });

    popup._bindBlankClose();

    const catcher = root.getChildByName(CATCHER);
    assert.ok(catcher, '必须补出 __BlankClose —— 根节点只有 100×100，空白处根本命中不到它');
    assert.equal(root.children.indexOf(catcher), 0, '接收层必须在 index 0：引擎取最上层命中的节点，这样按钮才永远优先');
    const ui = catcher.getComponent(StubUITransform);
    assert.ok(ui.width >= VISIBLE.width && ui.height >= VISIBLE.height, `接收层要覆盖整屏，实际 ${ui.width}x${ui.height}`);
    assert.equal(catcher.getComponent(StubSprite), null, '接收层不能有渲染组件，否则会挡住界面');
    assert.equal(catcher.getComponent(StubButton), null);
});

test('A2 四个触摸事件都注册在接收层上（注册了才参与命中检测）', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706);

    popup._bindBlankClose();

    const catcher = root.getChildByName(CATCHER);
    for (const ev of TOUCH_EVENTS) {
        assert.equal(catcher.listeners[ev]?.length ?? 0, 1, `接收层应注册 ${ev}`);
        // 事件不能挂在根节点上：根节点尺寸不足，挂了也收不到
        assert.equal(root.listeners[ev]?.length ?? 0, 0, `根节点不该注册 ${ev}`);
    }
});

test('A3 接收层位置对齐「所在层」而不是根节点自身（根节点被挪过也能盖住整屏）', () => {
    const { root, popup } = buildPopup();
    root.position = { x: 40, y: -30 }; // 根节点偏移
    child(root, 'PopupBg', 640, 706);

    popup._bindBlankClose();

    const catcher = root.getChildByName(CATCHER);
    // 层原点在世界 (360,742.5)；根节点在 (400,712.5) ⇒ 接收层局部坐标应是 (-40,+30)
    assert.equal(catcher.position.x, -40);
    assert.equal(catcher.position.y, 30);
});

test('A4 closeOnBlank=false 的弹窗不铺接收层（Toast / LoadingPopup 不能被它吃掉点击）', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706);

    popup.closeOnBlank = false;
    popup._bindBlankClose();

    assert.equal(root.getChildByName(CATCHER), null, '关掉空白关闭的弹窗铺全屏接收层会替下层吃掉全部点击');
    for (const ev of TOUCH_EVENTS) assert.equal(root.listeners[ev]?.length ?? 0, 0);
});

test('A5 重复绑定不会叠加监听（弹窗进出回收池会复用同一个节点）', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706);

    popup._bindBlankClose();
    popup._bindBlankClose();
    popup._unbindBlankClose();
    popup._bindBlankClose();

    const catcher = root.getChildByName(CATCHER);
    for (const ev of TOUCH_EVENTS) assert.equal(catcher.listeners[ev]?.length ?? 0, 1, `${ev} 应恰好一个监听`);
});

// ============================================================
// B. 内容区判定：排掉接收层与全屏装饰底图
// ============================================================

test('B1 全屏装饰底图（Bg）不算内容区，全屏但无渲染的容器（TabDetail）仍算内容', () => {
    const { root, popup } = buildPopup();
    const bg = child(root, 'Bg', 720, 1280, { sprite: true });          // 装饰底图
    const tab = child(root, 'TabDetail', 720, 1280);                    // 内容承载容器（无渲染）
    const panel = child(root, 'PopupBg', 640, 706, { sprite: true });
    child(root, 'CloseBtn', 54, 51, { button: true });

    popup._bindBlankClose();
    const names = popup._collectContentNodes().map((n: StubNode) => n.name);

    assert.equal(names.includes('Bg'), false, '全屏底图算进内容区 ⇒ 整屏都是「内容」⇒ 点空白永不关闭');
    assert.ok(names.includes('TabDetail'), '全屏但什么都不画的容器是内容承载层，不能当底图排掉');
    assert.ok(names.includes('PopupBg'));
    assert.ok(!names.includes(CATCHER), '接收层自己是全屏的，算进内容区就永远关不掉');
    assert.ok(bg && tab && panel);
});

test('B2 全屏底图的阈值按「设计分辨率」算，不受长屏适配拉高的可见区影响', () => {
    const { root } = buildPopup();
    const bg = child(root, 'Bg', 720, 1280, { sprite: true });

    // 可见区 1485 > 设计 1280：按可见区算只有 0.86，会被漏排（这正是修掉的那个 bug）
    assert.equal(PopupBase.isBlankBackdrop(bg), true, '长屏适配下 720×1280 的底图仍必须被判为底图');
});

test('B3 挂了交互组件的全屏节点不是底图（全屏按钮 / 输入区 / 滚动区）', () => {
    const { root } = buildPopup();
    assert.equal(PopupBase.isBlankBackdrop(child(root, 'FullBtn', 720, 1280, { sprite: true, button: true })), false);
    assert.equal(PopupBase.isBlankBackdrop(child(root, 'NoSprite', 720, 1280)), false, '没有渲染组件的全屏容器不算底图');
    assert.equal(PopupBase.isBlankBackdrop(child(root, 'Small', 640, 706, { sprite: true })), false, '没铺满整屏的不算底图');
});

// ============================================================
// C. 决策：点空白关 / 点内容不关
// ============================================================

function spyClose(popup: any) {
    const calls: number[] = [];
    popup.close = (reason: number) => calls.push(reason);
    popup._opened = true;
    popup.closeOnBlank = true;
    return calls;
}

const BLANK = 1; // PopupCloseReason.Blank

test('C1 点是空白 → 关闭；点在内容板上 → 不关', () => {
    const { root, popup } = buildPopup();
    const panel = child(root, 'PopupBg', 640, 706, { sprite: true }); // 居中，世界中心 (360,742.5)
    const bg = child(root, 'Bg', 720, 1742, { sprite: true });
    popup._bindBlankClose();
    const calls = spyClose(popup);

    // 屏幕左下角：在 Bg 之外（Bg 只有 720×1742、y 范围 [742.5-871, 742.5+871]）
    popup._onTouchEnd(touchAt(10, 5));
    assert.deepEqual(calls, [BLANK], '点空白必须关闭');

    // 内容板中心（世界坐标 360,742.5）
    calls.length = 0;
    popup._onTouchEnd(touchAt(360, 742.5));
    assert.deepEqual(calls, [], '点在内容板上不能关');

    assert.ok(panel && bg);
});

test('C2 拖拽（按下后位移超过容差）不触发关闭 —— 滑列表不会把弹窗关掉', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706, { sprite: true });
    popup._bindBlankClose();
    const calls = spyClose(popup);

    popup._onTouchStart(touchAt(10, 5));
    popup._onTouchMove(touchAt(10, 300)); // 纵向滑了一大段
    popup._onTouchEnd(touchAt(10, 300));
    assert.deepEqual(calls, [], '超过容差视为拖拽，抬起时不该判定为点空白');
});

test('C3 closeOnBlank=false 时点空白不关（接收层都没建，事件也不该被处理）', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706, { sprite: true });
    popup.closeOnBlank = false;
    popup._bindBlankClose();
    const calls = spyClose(popup);
    popup.closeOnBlank = false;

    popup._onTouchEnd(touchAt(10, 5));
    assert.deepEqual(calls, []);
});

test('C4 未打开的弹窗不响应（关闭后残留的触摸不能把它再关一次）', () => {
    const { root, popup } = buildPopup();
    child(root, 'PopupBg', 640, 706, { sprite: true });
    popup._bindBlankClose();
    const calls = spyClose(popup);
    popup._opened = false;

    popup._onTouchEnd(touchAt(10, 5));
    assert.deepEqual(calls, []);
});
