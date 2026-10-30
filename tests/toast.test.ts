import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
/**
 * Toast（吐司）单测
 * ------------------------------------------------------------------
 * 验证三件事：
 *   1. 排队语义：多条消息只开一个实例、按 duration 依次播放、放空后自行关闭、再来消息能重开；
 *   2. 入参守卫：空串 / 非字符串被忽略（FW.G_W 目前返回 undefined，不能弹出空气泡）；
 *   3. 被外部强制关闭（切流程 closeAll）时丢弃剩余队列，而不是留到下次 show 时一起倒出来。
 *
 * 另外用源码断言锁住「FW.showTip 由组合根接到 Toast.show」这条接线 ——
 * framework 不能 import app，接错方向或漏接都不会报错，只能靠这条断言兜住。
 *
 * mock 约定沿用 tests/popup-lifecycle.test.ts：ts.transpileModule + runInNewContext，
 * 用假 cc 顶替引擎。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as PopupDef from '../assets/script/framework/ui/PopupDef';
import { assetPath } from './helpers/asset-paths';

/**
 * 依赖表以「工程根相对路径」为 key（裸模块名如 'cc' 原样保留）。
 *
 * require 必须**按调用方所在目录解析**后再查表，不能拿 import 字符串直接匹配：
 * 上一版就是这么写的，于是把源码里多写一级的 `../../../framework/ui/PopupBase`
 * 原样抄进了依赖表，测试跟着错误路径一起通过，真机上才炸「找不到模块」。
 */
function resolveSpecifier(fromFile: string, specifier: string): string {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
    const resolved = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
}

function loadModule(path: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        require: (name: string) => {
            if (name.endsWith('/ResourceScope')) return { ResourceScope };
            if (name.endsWith('/AssetService')) return { scopeAssetService };
            if (name.endsWith('/ProcedureManager')) return { ProcedureManager: { instance: null } };
            const key = resolveSpecifier(path, name);
            assert.ok(key in dependencies, `${path} 引用了未提供的依赖：${name}（解析为 ${key}）`);
            return dependencies[key];
        },
    };
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(output, context);
    return context.exports;
}

const classDecorator = () => (value: unknown) => value;
const propertyDecorator = () => () => {};

async function flushMicrotasks(): Promise<void> {
    for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

/** 一次性的测试夹具：假 cc + 真 PopupBase + 假 PopupManager + 真 Toast。 */
function buildFixture() {
    class Vec2 {
        x = 0;
        y = 0;
        set(x: number, y: number): this { this.x = x; this.y = y; return this; }
    }
    class Vec3 extends Vec2 {
        z = 0;
        set(x: number, y: number, z = 0): this { super.set(x, y); this.z = z; return this; }
    }
    class Color {
        constructor(public r = 255, public g = 255, public b = 255, public a = 255) {}
    }
    class Graphics {
        calls: string[] = [];
        fillColor: Color | null = null;
        clear(): void { this.calls.push('clear'); }
        roundRect(x: number, y: number, w: number, h: number, r: number): void {
            this.calls.push(`roundRect(${x},${y},${w},${h},${r})`);
        }
        fill(): void { this.calls.push('fill'); }
    }
    class Label {
        /** 与 cc.Label.Overflow 对齐的取值。 */
        static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
        string = '';
        /** 引擎默认 NONE：会把文本实测尺寸回写进 UITransform。 */
        overflow = Label.Overflow.NONE;
        enableWrapText = true;
        // 样式字段：`_applyTextStyle` 会往里写，用例拿它们和聊天条对值。
        fontSize = 40;
        lineHeight = 40;
        color: { r: number; g: number; b: number; a: number } | null = null;
        isBold = false;
        spacingX = 0;
        fontFamily = 'Arial';
        node: any = null;
    }
    class UITransform {
        contentSize = { width: 0, height: 0 };
        setContentSize(width: number, height: number): void { this.contentSize = { width, height }; }
    }
    class Node {
        static EventType = {
            TOUCH_START: 'touch-start',
            TOUCH_MOVE: 'touch-move',
            TOUCH_END: 'touch-end',
            TOUCH_CANCEL: 'touch-cancel',
        };
        isValid = true;
        active = true;
        activeInHierarchy = true;
        layer = 1;
        parent: Node | null = null;
        children: Node[] = [];
        private components: any[] = [];

        constructor(readonly name = '') {}

        attach(component: any): void {
            component.node = this;
            this.components.push(component);
        }

        getComponent<T>(cls: new (...args: any[]) => T): T | null {
            return this.components.find((component) => component instanceof cls) ?? null;
        }

        addComponent<T>(cls: new () => T): T {
            const component = new cls();
            this.attach(component);
            return component;
        }

        on(): void {}
        off(): void {}
        setParent(): void {}
        removeFromParent(): void {}
        setPosition(): void {}
        destroy(): void { this.isValid = false; }
    }
    class Component {
        node!: Node;
    }

    const cc = {
        _decorator: { ccclass: classDecorator, property: propertyDecorator },
        Color,
        Component,
        director: {
            getScene: () => ({ name: 'Root' }),
            once: () => {},
            off: () => {},
        },
        Director: { EVENT_AFTER_UPDATE: 'after-update' },
        EventTouch: class {},
        Graphics,
        Label,
        Node,
        UITransform,
        Vec2,
        Vec3,
    };

    // 假 PopupManager：只实现 PopupBase 用到的那几个成员。
    const state: { live: any; created: number; serial: number } = { live: null, created: 0, serial: 0 };
    const manager = {
        get inst() { return manager; },
        owns: (popup: any) => state.live === popup,
        openAsync: async (cls: any, params: any) => {
            if (state.live && state.live.isPopupOpen) return state.live; // 同类单实例
            const toast = new cls();
            toast.node = new Node('Toast');
            toast.panel = barNode;
            toast.panelGraphics = graphics;
            toast.label = label;
            state.created += 1;
            state.live = toast;
            await toast._internalOpen(++state.serial, params ?? {}, toast.popupLayer);
            if (!toast.isPopupOpen) {
                state.live = null;
                return null;
            }
            return toast;
        },
        close: (target: any) => {
            target._internalClose(PopupDef.PopupCloseReason.Manual);
            if (state.live === target) state.live = null;
        },
    };

    // 底条 / 文字节点的组件：onInit 里的 _applyLayout 依赖它们
    const barNode = new Node('Bar');
    const barTransform = new UITransform();
    barNode.attach(barTransform);
    const graphics = new Graphics();
    barNode.attach(graphics);
    // 记录「文字框被设尺寸」时 Label 的 overflow —— 用来锁住「先切 SHRINK 再设 contentSize」
    // 这条项目铁律（顺序反了的话 `setContentSize` 会被文本实测尺寸覆盖，看着设了其实没生效）。
    const probe: { overflowWhenLabelResized: number | null; wrapWhenLabelResized: boolean | null } = {
        overflowWhenLabelResized: null,
        wrapWhenLabelResized: null,
    };
    const label = new Label();
    const labelNode = new Node('Label');
    const labelTransform = new UITransform();
    const rawSetContentSize = labelTransform.setContentSize.bind(labelTransform);
    labelTransform.setContentSize = (width: number, height: number) => {
        probe.overflowWhenLabelResized = label.overflow;
        probe.wrapWhenLabelResized = label.enableWrapText;
        rawSetContentSize(width, height);
    };
    labelNode.attach(labelTransform);
    label.node = labelNode;

    const { PopupBase } = loadModule('assets/script/framework/ui/PopupBase.ts', {
        cc,
        'assets/script/framework/ui/PopupDef.ts': PopupDef,
        'assets/script/framework/ui/PopupManager.ts': { PopupManager: manager },
    });
    const { Toast } = loadModule('assets/script/app/common/Toast.ts', {
        cc,
        'assets/script/framework/ui/PopupBase.ts': { PopupBase },
        'assets/script/framework/ui/PopupDef.ts': PopupDef,
    });

    return { Toast, manager, state, graphics, barTransform, label, labelNode, Label, probe, UITransform };
}

test('Toast 按队列依次播放，放空后自行关闭，再来消息能重新打开', async () => {
    const { Toast, state, graphics, barTransform, label, labelNode, Label, probe, UITransform } = buildFixture();

    Toast.show('第一条');
    await flushMicrotasks();

    const first = state.live;
    assert.ok(first, 'show 之后应当有一个实例在播');
    assert.equal(state.created, 1);
    assert.equal(first.currentText, '第一条');
    assert.equal(Toast.pendingCount, 0);
    assert.equal(first.isPopupOpen, true);
    // 吐司不抢输入：不接受点空白关闭
    assert.equal(first.closeOnBlank, false);
    // onInit 已按 @property 摆好底条与文字框（430×56 / 430−2×48）
    assert.deepEqual(barTransform.contentSize, { width: 430, height: 56 });
    assert.deepEqual(
        labelNode.getComponent(UITransform)!.contentSize,
        { width: 334, height: 56 },
        '文字可用宽度 = 底条宽 − 2×内边距',
    );
    // 铁律：先切 SHRINK + 关折行，再设 contentSize；顺序反了尺寸会被文本实测值覆盖
    assert.equal(probe.overflowWhenLabelResized, Label.Overflow.SHRINK);
    assert.equal(probe.wrapWhenLabelResized, false, '吐司不折行，只缩字');
    assert.equal(label.overflow, Label.Overflow.SHRINK);
    // 底条 = 聊天条同款「60% 黑」：`rgba(0,0,0,153)`（hud_chat_bar.png 实测像素）
    assert.deepEqual(
        { r: graphics.fillColor!.r, g: graphics.fillColor!.g, b: graphics.fillColor!.b, a: graphics.fillColor!.a },
        { r: 0, g: 0, b: 0, a: 153 },
        '底条应为 60% 黑的半透明底框（对齐聊天条）',
    );
    // 圆角底条按参数画了一次
    assert.equal(graphics.calls[0], 'clear');
    assert.ok(graphics.calls.includes('roundRect(-215,-28,430,56,12)'), graphics.calls.join(' | '));
    assert.equal(graphics.calls[graphics.calls.length - 1], 'fill');

    // 连着来两条：不该开第二个实例，而是排队
    Toast.show('第二条');
    Toast.show('第三条');
    await flushMicrotasks();
    assert.equal(state.created, 1, '队列里的消息不应触发新的打开');
    assert.equal(Toast.pendingCount, 2);
    assert.equal(first.currentText, '第一条');

    // 每条停留 duration（默认 2s）后切下一条
    first.update(2);
    assert.equal(first.currentText, '第二条');
    assert.equal(Toast.pendingCount, 1);

    first.update(2);
    assert.equal(first.currentText, '第三条');
    assert.equal(Toast.pendingCount, 0);

    // 最后一条播完 → 队列放空 → 自行关闭
    first.update(2);
    assert.equal(first.isPopupOpen, false, '队列放空后应当自行关闭');
    assert.equal(state.live, null);

    // 关闭后再来消息，应当重新打开一个新实例
    Toast.show('第四条');
    await flushMicrotasks();
    assert.equal(state.created, 2);
    assert.notEqual(state.live, first);
    assert.equal(state.live.currentText, '第四条');
});

test('样式口径：吐司与主界面聊天条（BottomHud/ChatBar/ChatMsg）是同一套字 + 同一块黑底', async () => {
    const { Toast, state, label } = buildFixture();
    Toast.show('对齐聊天条');
    await flushMicrotasks();
    const toast = state.live;
    assert.ok(toast, '实例没起来');

    // 聊天条上的消息正文：ArenaRoot/BottomHud/ChatMsg（HUD 上唯一的"黑底说明文字"）
    const arena = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as any[];
    const chat = arena.find((item) => item.__type__ === 'cc.Label'
        && typeof item._string === 'string' && item._string.indexOf('空空如也') >= 0);
    assert.ok(chat, '聊天条消息 Label 改文案了？找不到 "空空如也消息~"');

    const toastText = {
        r: toast.fontColor.r,
        g: toast.fontColor.g,
        b: toast.fontColor.b,
        a: toast.fontColor.a,
    };
    const chatText = { r: chat._color.r, g: chat._color.g, b: chat._color.b, a: chat._color.a };
    assert.equal(toast.fontSize, chat._fontSize, '字号要和聊天条一致');
    assert.equal(toast.lineHeight, chat._lineHeight, '行高要和聊天条一致');
    assert.equal(toast.letterSpacing, chat._spacingX, '字距要和聊天条一致');
    assert.equal(toast.fontFamily, chat._fontFamily, '字体族要和聊天条一致');
    assert.deepEqual(toastText, chatText, '字色（含 alpha 145 ≈ 57% 白）要和聊天条一致');
    assert.equal(chat._isBold, true, '聊天条正文是加粗的；下面那条断言就是在核这个前提');

    // 真正生效的是运行时写进 Label 的那份（prefab 里的值会被 `_applyTextStyle` 覆盖）
    assert.equal(label.fontSize, chat._fontSize);
    assert.equal(label.lineHeight, chat._lineHeight);
    assert.equal(label.spacingX, chat._spacingX);
    assert.equal(label.fontFamily, chat._fontFamily);
    assert.equal(label.isBold, true, '吐司文字跟着聊天条加粗');
    assert.deepEqual(
        { r: label.color!.r, g: label.color!.g, b: label.color!.b, a: label.color!.a },
        chatText,
    );

    // 底条 60% 黑：取自聊天条底图 `image/main/hud/hud_chat_bar.png` 的实测像素 rgba(0,0,0,153)
    assert.deepEqual(
        { r: toast.barColor.r, g: toast.barColor.g, b: toast.barColor.b, a: toast.barColor.a },
        { r: 0, g: 0, b: 0, a: 153 },
        '底条必须是聊天条同款 60% 黑',
    );
});

test('Toast.prefab 里序列化的样式与脚本 @property 默认值一致（编辑器预览 = 运行时）', () => {
    const prefab = JSON.parse(readFileSync(assetPath('ui/common/Toast.prefab'), 'utf8')) as any[];
    // 自定义组件的 __type__ 是脚本 uuid 的压缩串，不是 cc.* —— 全文件只有这一个。
    const comp = prefab.find((item) => typeof item.__type__ === 'string' && !item.__type__.startsWith('cc.'));
    assert.ok(comp, 'Toast.prefab 里找不到 Toast 组件');
    const label = prefab.find((item) => item.__type__ === 'cc.Label');
    assert.ok(label, 'Toast.prefab 里找不到 Label');

    assert.equal(comp.barWidth, 430);
    assert.equal(comp.barHeight, 56, 'prefab 的底条高度要和脚本默认值一致');
    assert.deepEqual(
        { r: comp.barColor.r, g: comp.barColor.g, b: comp.barColor.b, a: comp.barColor.a },
        { r: 0, g: 0, b: 0, a: 153 },
        'prefab 里的底条色不能还是老的 #1D313F 不透明',
    );
    assert.equal(comp.fontSize, label._fontSize, 'prefab 的 fontSize 与 Label 对不上');
    assert.equal(comp.lineHeight, label._lineHeight, 'prefab 的 lineHeight 与 Label 对不上');
    assert.equal(label._color.a, comp.fontColor.a, 'prefab 的 Label 字色 alpha 与 @property 对不上');
    assert.equal(label._spacingX, comp.letterSpacing);
    assert.equal(label._fontFamily, comp.fontFamily);
});

test('Toast 忽略非字符串与空白串（FW.G_W 未落地时会传进 undefined）', async () => {
    const { Toast, state } = buildFixture();

    Toast.show(undefined as unknown as string);
    Toast.show(null as unknown as string);
    Toast.show('');
    Toast.show('   ');
    Toast.show(42 as unknown as string);
    await flushMicrotasks();

    assert.equal(Toast.pendingCount, 0, '非法入参不应进队列');
    assert.equal(state.created, 0, '非法入参不应触发打开');
});

test('Toast 被外部强制关闭（切流程 closeAll）时丢弃剩余队列', async () => {
    const { Toast, state } = buildFixture();

    Toast.show('甲');
    Toast.show('乙');
    Toast.show('丙');
    await flushMicrotasks();
    assert.equal(Toast.pendingCount, 2);

    const instance = state.live;
    // 模拟 PopupManager.closeAll()：直接走内部关闭，不经过 Toast 自己的自关闭路径
    instance._internalClose(PopupDef.PopupCloseReason.Force);
    state.live = null;

    assert.equal(Toast.pendingCount, 0, '强制关闭后剩余队列应当被丢弃');

    Toast.show('丁');
    await flushMicrotasks();
    assert.equal(state.live.currentText, '丁', '丢弃旧队列后新消息仍能正常播放');
    assert.equal(Toast.pendingCount, 0);
});

test('Toast.clear 只清未播放的文案，不影响正在播放的那条', async () => {
    const { Toast, state } = buildFixture();

    Toast.show('在播');
    Toast.show('排队一');
    Toast.show('排队二');
    await flushMicrotasks();

    const instance = state.live;
    Toast.clear();
    assert.equal(Toast.pendingCount, 0);
    assert.equal(instance.currentText, '在播');

    instance.update(2);
    assert.equal(instance.isPopupOpen, false, '队列被清空后播完当前这条即关闭');
    assert.equal(state.live, null);
});

test('Toast.ts 的相对 import 都能在磁盘上解析到（防止多写/少写一层 ../）', () => {
    const path = 'assets/script/app/common/Toast.ts';
    const source = readFileSync(path, 'utf8');
    const relatives = [...source.matchAll(/from\s+'([^']+)'/g)]
        .map((match) => match[1])
        .filter((specifier) => specifier.startsWith('.'));

    assert.deepEqual(
        relatives,
        ['../../framework/ui/PopupBase', '../../framework/ui/PopupDef'],
        '相对引用应为两级 ../（app/common → app → script），多写一级会解析到 assets/ 外面',
    );
    for (const specifier of relatives) {
        const resolved = resolveSpecifier(path, specifier);
        assert.ok(existsSync(resolved), `${specifier} 解析为 ${resolved}，磁盘上不存在`);
    }
});

test('FW.showTip 由组合根按「framework 不反向依赖 app」的方式接到 Toast.show', () => {
    const fw = readFileSync('assets/script/framework/FW.ts', 'utf8');
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    const toast = readFileSync('assets/script/app/common/Toast.ts', 'utf8');

    assert.match(fw, /static showTip: \(tip: string\) => void = /, 'FW.showTip 应当是可注入的空实现');
    assert.doesNotMatch(fw, /from ['"].*app\/common\/Toast['"]/, 'FW.ts 不能 import app 层');
    assert.match(
        bootstrap,
        /FW\.showTip = \(tip: string\) => \{ Toast\.show\(tip\); \}/,
        '组合根应当把 FW.showTip 接到 Toast.show',
    );
    assert.match(bootstrap, /import \{ Toast \} from '\.\.\/common\/Toast'/);
    assert.match(toast, /static prefabPath = 'ui\/common\/Toast'/);
    assert.match(toast, /this\.closeOnBlank = false/, '吐司必须关掉「点击空白关闭」');
});
