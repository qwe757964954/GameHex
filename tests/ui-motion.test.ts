/**
 * 统一界面 / 弹窗过渡（`UIMotion` + `UIMotionPlayer`）单测
 * ------------------------------------------------------------------
 * 需求（2026-11-18）①②：2/3 级界面打开要有切换动效、所有弹窗要有统一的打开关闭过渡。
 *
 * 钉住四件事：
 *   1. **曲线本身**：进场从透明 0 起、关闭一律更短更急，两档的差别只在幅度；
 *   2. **播放器行为**：起播立即写起始帧（不能先原样渲染一帧）、按 `startedAt` 推进、
 *      收尾精确复位（含 `out-back` 的过冲不能把透明度写成 285）；
 *   3. **档位判定**：整屏大页（根节点 100×100、子节点铺满的那种）必须判成 `screen`，
 *      否则整页会被缩到 0.92、边缘露底；
 *   4. **接线**：`PopupManager` 打开即起播、关闭先播离场再销毁；提示类弹窗显式关掉。
 *
 * mock 约定沿用 `tests/popup-lifecycle.test.ts` / `tests/toast.test.ts`：
 * `ts.transpileModule` + `runInNewContext` + 假 `cc`。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as PopupDef from '../assets/script/framework/ui/PopupDef';
import { PopupCompositionHost } from '../assets/script/framework/ui/PopupCompositionHost';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as UIMotion from '../assets/script/framework/ui/UIMotion';

// ---------------------------------------------------------------- 模块加载

function resolveSpecifier(fromFile: string, specifier: string): string {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
    const resolved = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
}

function loadModule(path: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        // 时钟由用例推进：过渡按 `Date.now()` 算进度，不推进就永远是第一帧。
        Date: { now: () => clockMs },
        require: (name: string) => {
            if (name.endsWith('/UIMotion')) return UIMotion;
            if (name.endsWith('/PopupCompositionHost')) return { PopupCompositionHost };
            if (name.endsWith('/ResourceScope')) return { ResourceScope };
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

/** 可控时钟：`Date.now()` 由用例推进。 */
let clockMs = 0;

class Vec3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z = 0): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }
}

class FakeNode {
    isValid = true;
    active = true;
    activeInHierarchy = true;
    layer = 1;
    name = '';
    children: FakeNode[] = [];
    parent: FakeNode | null = null;
    position = new Vec3();
    scale = new Vec3(1, 1, 1);
    private components: any[] = [];

    constructor(name = '') {
        this.name = name;
    }

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

    getChildByName(target: string): FakeNode | null {
        return this.children.find((child) => child.name === target) ?? null;
    }

    addChild(child: FakeNode): void {
        child.parent = this;
        this.children.push(child);
    }

    /** 与引擎一致：既接受 `(x, y, z)`，也接受一个 `Vec3`。 */
    setScale(x: number | Vec3, y?: number, z = 1): void {
        if (x instanceof Vec3) {
            this.scale.set(x.x, x.y, x.z);
            return;
        }
        this.scale.set(x, y ?? x, z);
    }

    setPosition(x: number | Vec3, y = 0, z = 0): void {
        if (x instanceof Vec3) {
            this.position.set(x.x, x.y, x.z);
            return;
        }
        this.position.set(x, y, z);
    }

    setSiblingIndex(): void {}
    removeFromParent(): void {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = null;
    }

    setParent(parent: FakeNode): void {
        this.removeFromParent();
        this.parent = parent;
        parent.children.push(this);
    }

    destroy(): void {
        this.isValid = false;
        this.removeFromParent();
    }
}

class FakeUITransform {
    width = 0;
    height = 0;
    setContentSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }
}

class FakeUIOpacity {
    isValid = true;
    opacity = 255;
    node: FakeNode | null = null;
}

/** 组件基类：只实现本用例要用的调度，`runScheduled` 由用例手动推帧。 */
class FakeComponent {
    node!: FakeNode;
    isValid = true;
    private readonly scheduled = new Set<() => void>();

    schedule(callback: () => void): void {
        this.scheduled.add(callback);
    }

    unschedule(callback: () => void): void {
        this.scheduled.delete(callback);
    }

    runScheduled(): void {
        for (const callback of Array.from(this.scheduled)) callback();
    }

    get scheduledCount(): number {
        return this.scheduled.size;
    }
}

function buildCc(): Record<string, unknown> {
    return {
        _decorator: { ccclass: classDecorator, property: propertyDecorator },
        Component: FakeComponent,
        Node: FakeNode,
        UITransform: FakeUITransform,
        UIOpacity: FakeUIOpacity,
        Vec3,
        Layers: { Enum: { DEFAULT: 0, UI_2D: 1 } },
        Canvas: class {},
        Prefab: class {},
        instantiate: (prefab: any) => prefab.factory(),
        director: { getScene: () => null },
        view: { getDesignResolutionSize: () => ({ width: 720, height: 1280 }) },
    };
}

function loadPlayer(): any {
    return loadModule('assets/script/framework/ui/UIMotionPlayer.ts', { cc: buildCc() });
}

/** 造一个带 `UITransform` 的节点。 */
function nodeOf(name: string, width: number, height: number): FakeNode {
    const node = new FakeNode(name);
    node.addComponent(FakeUITransform).setContentSize(width, height);
    return node;
}

// ---------------------------------------------------------------- 1. 曲线

test('统一过渡：进场从全透明起，关闭一律比进场更短更急', () => {
    for (const kind of ['panel', 'screen'] as const) {
        const enter = UIMotion.uiMotionSpec('enter', kind);
        const exit = UIMotion.uiMotionSpec('exit', kind);
        assert.equal(enter.opacityFrom, 0, `${kind} 进场必须从透明起，否则会先闪一下`);
        assert.equal(enter.opacityTo, 1, `${kind} 进场透明度的终点是不透明`);
        assert.equal(enter.offsetYTo, 0, `${kind} 进场必须落回原位`);
        assert.equal(enter.scaleTo, 1, `${kind} 进场缩放的终点是原始尺寸`);
        assert.equal(exit.opacityTo, 0, `${kind} 关闭终点是全透明`);
        assert.ok(exit.seconds < enter.seconds, `${kind} 关闭必须比进场短`);
        assert.equal(exit.easing, 'in-quad', `${kind} 关闭用加速离场，方向感才清楚`);
        assert.ok(exit.scaleTo < 1, `${kind} 关闭往里收一点`);
    }
});

test('统一过渡：两档只差幅度，整屏档的缩放必须收敛', () => {
    const panel = UIMotion.uiMotionSpec('enter', 'panel');
    const screen = UIMotion.uiMotionSpec('enter', 'screen');
    assert.equal(panel.scaleFrom, UIMotion.UI_MOTION_PANEL_SCALE_FROM);
    assert.equal(screen.scaleFrom, UIMotion.UI_MOTION_SCREEN_SCALE_FROM);
    assert.ok(panel.scaleFrom < screen.scaleFrom, '整页缩放要比面板收敛，否则边缘露底');
    assert.ok(panel.offsetYFrom < 0, '面板从下方浮起');
    assert.equal(screen.offsetYFrom, 0, '整页不做位移：整页平移会露出底下的页面');
    assert.equal(panel.easing, 'out-back', '面板带一点过冲，手感才是「弹出来」');
    assert.equal(screen.easing, 'out-cubic', '整页不许过冲');
});

test('统一过渡：缓动单调、过冲只作用在缩放上', () => {
    for (const easing of ['out-cubic', 'in-quad'] as const) {
        let previous = -1;
        for (let step = 0; step <= 20; step += 1) {
            const value = UIMotion.uiMotionEase(easing, step / 20);
            assert.ok(value >= previous, `${easing} 必须单调递增`);
            previous = value;
        }
        assert.equal(UIMotion.uiMotionEase(easing, 0), 0);
        assert.equal(UIMotion.uiMotionEase(easing, 1), 1);
    }
    assert.ok(UIMotion.uiMotionEase('out-back', 0.7) > 1, 'out-back 在尾段应当过冲');

    const overshoot = UIMotion.uiMotionSample(UIMotion.uiMotionSpec('enter', 'panel'), 0.7);
    assert.ok(overshoot.scale > 1, '过冲应当体现在缩放上');
    assert.equal(overshoot.opacity, 255, '透明度必须 clamp 到 255，不能被过冲写成 285');
});

test('统一过渡：进度与采样在边界上不抛、不留半格', () => {
    assert.equal(UIMotion.uiMotionProgress(10, 5, 0.2), 0, '起播前按 0 算');
    assert.equal(UIMotion.uiMotionProgress(10, 20, 0.2), 1, '超时按 1 算');
    assert.equal(UIMotion.uiMotionProgress(10, 10.1, 0), 1, '时长为 0 视为没有动画');
    assert.equal(UIMotion.uiMotionProgress(Number.NaN, 10, 0.2), 1, '脏 startedAt 直接落终点');

    const spec = UIMotion.uiMotionSpec('enter', 'screen');
    const start = UIMotion.uiMotionSample(spec, 0);
    assert.deepEqual(
        { opacity: start.opacity, scale: start.scale, offsetY: start.offsetY, done: start.done },
        { opacity: 0, scale: spec.scaleFrom, offsetY: 0, done: false },
    );
    const end = UIMotion.uiMotionSample(spec, 5);
    assert.deepEqual(
        { opacity: end.opacity, scale: end.scale, done: end.done, progress: end.progress },
        { opacity: 255, scale: 1, done: true, progress: 1 },
    );
    assert.ok(UIMotion.uiMotionSample(spec, 0.5).opacity > 0, '中段必须已经可见');
});

// ---------------------------------------------------------------- 2. 播放器

test('播放器：起播立即写起始帧，走完精确复位并停止调度', () => {
    const { UIMotionPlayer } = loadPlayer();
    const root = nodeOf('Popup', 300, 200);
    root.setPosition(12, 34, 0);
    clockMs = 1_000;

    assert.equal(UIMotionPlayer.playEnter(root), true);
    const opacity = root.getComponent(FakeUIOpacity)!;
    assert.equal(opacity.opacity, 0, '起播当帧就要透明，不能先原样渲染一帧');
    assert.ok(root.scale.x < 1, '起播当帧应当在缩小态');
    assert.ok(root.position.y < 34, '起播当帧应当在下方偏移处');

    const player = root.getComponent(UIMotionPlayer)!;
    clockMs += UIMotion.UI_MOTION_PANEL_ENTER_SECONDS * 1000;
    player.runScheduled();
    assert.equal(opacity.opacity, 255, '走完必须完全不透明');
    assert.equal(root.scale.x, 1, '走完必须回到原始缩放');
    assert.equal(root.position.y, 34, '走完必须回到原始位置');
    assert.equal(player.scheduledCount, 0, '落位即停调度，不留空转');
});

test('播放器：关闭收尾回调只调一次，节点失活时不播', () => {
    const { UIMotionPlayer } = loadPlayer();
    const root = nodeOf('Popup', 300, 200);
    clockMs = 5_000;

    let finished = 0;
    assert.equal(UIMotionPlayer.playExit(root, () => { finished += 1; }), true);
    const player = root.getComponent(UIMotionPlayer)!;
    player.runScheduled();
    assert.equal(finished, 0, '时间没到不能提前交还节点');

    clockMs += UIMotion.UI_MOTION_EXIT_SECONDS * 1000;
    player.runScheduled();
    assert.equal(finished, 1, '走完调用一次收尾');
    assert.equal(root.getComponent(FakeUIOpacity)!.opacity, 0, '关闭终点是全透明');
    player.runScheduled();
    assert.equal(finished, 1, '重复推帧不得重复收尾');

    root.activeInHierarchy = false;
    assert.equal(UIMotionPlayer.playExit(root, () => {}), false, '已经失活的节点不播，调用方自行收尾');
});

test('播放器：离场途中被停用也会补上收尾回调', () => {
    const { UIMotionPlayer } = loadPlayer();
    const root = nodeOf('Popup', 300, 200);
    clockMs = 9_000;
    let finished = 0;
    UIMotionPlayer.playExit(root, () => { finished += 1; });
    const player = root.getComponent(UIMotionPlayer)!;
    player.onDisable();
    assert.equal(finished, 1, '停用即视为播完：否则关闭方的回收永远等不到');
    assert.equal(player.scheduledCount, 0);
});

// ---------------------------------------------------------------- 3. 档位

test('档位判定：子节点铺满整屏就算整屏大页', () => {
    const { uiMotionKindOf } = loadPlayer();
    assert.equal(uiMotionKindOf(nodeOf('Full', 720, 1280)), 'screen');
    assert.equal(uiMotionKindOf(nodeOf('Tiny', 300, 200)), 'panel');

    // 联盟系列的真实形态：根节点 100×100，整屏尺寸由子节点撑开。
    const page = nodeOf('LeagueHall', 100, 100);
    page.addChild(nodeOf('Bg', 720, 1280));
    assert.equal(uiMotionKindOf(page), 'screen', '根节点小、子节点铺满也必须判整屏');

    const dialog = nodeOf('Tip', 300, 200);
    dialog.addChild(nodeOf('Bg', 240, 120));
    assert.equal(uiMotionKindOf(dialog), 'panel');
});

// ---------------------------------------------------------------- 4. 接线

/** 假 PopupManager 夹具：真 PopupManager + 假 cc + 假弹窗类。 */
function buildManagerFixture() {
    // 播放器模块要与管理器**共用同一份**，否则 `instanceof` / 组件查找对不上。
    const playerModule = loadPlayer();
    const { PopupManager } = loadModule('assets/script/framework/ui/PopupManager.ts', {
        cc: buildCc(),
        'assets/script/framework/ui/PopupDef.ts': PopupDef,
        'assets/script/framework/ui/UIMotionPlayer.ts': playerModule,
    });

    class MotionPopup {
        static prefabPath = 'ui/test/MotionPopup';
        popupLayer = PopupDef.PopupLayer.NORMAL;
        motionEnabled = true;
        className = 'MotionPopup';
        node!: FakeNode;

        _internalOpen(): Promise<void> {
            return Promise.resolve();
        }

        _internalClose(): void {}
        _internalReleaseResources(): void {}
        _bindCallbackOwners(): void {}
        _internalDepthChanged(): void {}
        _internalCover(): void {}
        _internalReveal(): void {}
    }

    const prefab = { factory: () => {
        const node = new FakeNode('MotionPopup');
        node.attach(new MotionPopup());
        return node;
    } };
    const manager = new PopupManager();
    manager.node = new FakeNode('Popup');
    manager.initialize({ load: async () => prefab }, { removeCallerListener() {} });
    return { manager, MotionPopup, UIMotionPlayer: playerModule.UIMotionPlayer };
}

test('接线：弹窗打开即起播，关闭先播离场再销毁', async () => {
    const { manager, MotionPopup, UIMotionPlayer } = buildManagerFixture();
    clockMs = 20_000;
    const popup = await manager.openAsync(MotionPopup);
    assert.ok(popup);
    const node = popup!.node;
    assert.ok(node.getComponent(UIMotionPlayer), '打开时必须挂上过渡播放器');
    assert.equal(node.getComponent(FakeUIOpacity)!.opacity, 0, '进场从透明起');

    manager.close(popup!);
    assert.equal(manager.count, 0, '业务侧已经关闭');
    assert.equal(node.isValid, true, '离场期间节点还在淡出，不能立刻销毁');
    assert.equal(node.active, true);

    clockMs += UIMotion.UI_MOTION_EXIT_SECONDS * 1000;
    node.getComponent(UIMotionPlayer)!.runScheduled();
    assert.equal(node.isValid, false, '离场走完才销毁');
    manager.onDestroy();
});

test('接线：关掉过渡的弹窗关闭即销毁，不拖尾巴', async () => {
    const { manager, MotionPopup } = buildManagerFixture();
    const popup = await manager.openAsync(MotionPopup);
    popup!.motionEnabled = false;
    const node = popup!.node;
    manager.close(popup!);
    assert.equal(node.isValid, false, '没有过渡就必须同步销毁');
    manager.onDestroy();
});

test('接线：统一过渡是默认值，提示类与大页显式关掉', () => {
    const base = readFileSync('assets/script/framework/ui/PopupBase.ts', 'utf8');
    assert.match(base, /motionEnabled: boolean = true/, '默认开：新弹窗什么都不配就生效');

    for (const path of [
        'assets/script/app/common/Toast.ts',
        'assets/script/app/common/LoadingPopup.ts',
        'assets/script/app/common/CommonTips.ts',
        'assets/script/app/zcds/ui/ZCGuidePanel.ts',
        'assets/script/app/card/view/HeroObtainPage.ts',
        // 自带整套编排、且自己 load 大量帧的两页：离场淡出期间 `_internalClose` 已同步
        // dispose 资源作用域，节点会挂着已释放的 SpriteFrame 继续提交渲染（每帧崩
        // `frame should not be invalid` / `getGFXTexture` 空指针）。
        'assets/script/app/zcds/ui/ZCSettlementPage.ts',
        'assets/script/app/zcds/ui/GameRunAway.ts',
    ]) {
        assert.match(readFileSync(path, 'utf8'), /motionEnabled = false/, `${path} 应当显式关掉统一过渡`);
    }

    const manager = readFileSync('assets/script/framework/ui/PopupManager.ts', 'utf8');
    assert.match(manager, /UIMotionPlayer\.playEnter\(node\)/, '打开链路必须起播进场');
    assert.match(manager, /UIMotionPlayer\.playExit\(node/, '关闭链路必须先播离场');
    assert.match(manager, /this\._stack\.length - this\._exiting/, '离场节点要让出兄弟位，否则会被下层弹窗当场盖掉');
});
