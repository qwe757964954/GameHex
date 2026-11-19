/**
 * UIMotionPlayer — 把 `UIMotion` 的曲线逐帧写进节点
 * ------------------------------------------------------------------
 * 职责分工（与 `docs/章节地图动画与点击反馈实现说明.md` 一致）：
 *
 *   · 曲线（起点 / 终点 / 缓动 / 时长）在 `UIMotion.ts`，纯函数、可单测；
 *   · 本文件只做三件事：**判定档位 → 按 `startedAt` 逐帧采样 → 写节点**。
 *
 * 为什么不用 `tween`：本工程的节点会进对象池（弹窗实例池 / 领地地块池），
 * tween 在节点回收后仍会跑完，回调里访问到的已是别人的节点。这里一律
 * `schedule(step, 0)`，静止时**完全不进函数**，并且在 `onDisable` / `onDestroy`
 * 里收干净。
 *
 * 档位判定（`uiMotionKindOf`）：
 *   根节点自身、或它的任一**直接子节点**铺满设计分辨率 90% ⇒ 整屏界面（`screen`）；
 *   否则按紧凑面板（`panel`）弹出来。
 *
 *   为什么不看「根节点尺寸」一项：本工程不少大页 prefab 的根节点是随手给的
 *   100×100，整屏尺寸由子节点上的 `Widget` 撑开（联盟系列 14 个弹窗里 13 个如此）。
 *   只看根节点会把整屏大页判成小面板 ⇒ 整页被缩到 0.92，边缘露底。
 *
 *   为什么不看「有没有全屏底图」：`Chat` 这类对话框同样有一张 720×1280 的
 *   `Mask`，它与整屏页在结构上分不开。所以判据只保留一条档位分界（整屏 / 非整屏），
 *   两种档位都只是「淡入 + 缩放」，观感差异很小，判错也不会穿帮。
 */

import { _decorator, Component, Node, UIOpacity, UITransform, Vec3, view } from 'cc';
import {
    uiMotionProgress,
    uiMotionSample,
    uiMotionSpec,
    type IUIMotionSample,
    type IUIMotionSpec,
    type UIMotionKind,
    type UIMotionPhase,
} from './UIMotion';

const { ccclass } = _decorator;

/** 判定「铺满屏幕」的比例阈值（与 `PopupBase.BLANK_BACKDROP_RATIO` 同口径）。 */
const MOTION_SCREEN_RATIO = 0.9;

/** 当前时刻（秒）。与 `ChestBar` / `MainPage` 的逐帧动画同一口径。 */
function nowSeconds(): number {
    return Date.now() / 1000;
}

/** 节点是否铺满设计分辨率（没有 `UITransform` 一律按「不是」处理）。 */
function coversScreen(node: Node, designWidth: number, designHeight: number): boolean {
    const transform = node.getComponent(UITransform);
    if (!transform) return false;
    return transform.width >= designWidth * MOTION_SCREEN_RATIO
        && transform.height >= designHeight * MOTION_SCREEN_RATIO;
}

/**
 * 判定该用哪一档过渡。
 *
 * 设计分辨率拿不到（用例里的假 `cc`）时返回 `screen`：整屏档的缩放收敛，
 * 判错也只是「少弹一点」，不会把内容缩出屏幕。
 */
export function uiMotionKindOf(root: Node): UIMotionKind {
    if (!root || !root.isValid) return 'screen';
    const size = typeof view?.getDesignResolutionSize === 'function' ? view.getDesignResolutionSize() : null;
    const designWidth = size ? size.width : 0;
    const designHeight = size ? size.height : 0;
    if (!(designWidth > 0) || !(designHeight > 0)) return 'screen';
    if (coversScreen(root, designWidth, designHeight)) return 'screen';
    const children = root.children;
    for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child && child.isValid && coversScreen(child, designWidth, designHeight)) return 'screen';
    }
    return 'panel';
}

/**
 * 界面 / 弹窗的统一过渡播放器。
 *
 * 用法：`UIMotionPlayer.playEnter(node)` / `UIMotionPlayer.playExit(node, () => node.destroy())`。
 * 两个静态入口都会**兜住一切异常**并返回是否真的播上了：过渡是纯表现，
 * 任何环节出问题都只能退化成「直接出现 / 直接消失」，不许把打开或关闭链路带崩。
 */
@ccclass('UIMotionPlayer')
export class UIMotionPlayer extends Component {
    private phase: UIMotionPhase = 'enter';
    private spec: IUIMotionSpec | null = null;
    private startedAt = 0;
    private running = false;
    private settled = true;
    private onFinished: (() => void) | null = null;

    private opacity: UIOpacity | null = null;
    private hasBase = false;
    private readonly basePosition = new Vec3();
    private readonly baseScale = new Vec3(1, 1, 1);

    // ============================================================
    // 静态入口（业务只调这两个）
    // ============================================================

    /** 播进场过渡；返回是否真的播上（没播上就当节点已经就位）。 */
    static playEnter(node: Node | null): boolean {
        const player = UIMotionPlayer.prepare(node);
        if (!player) return false;
        return player.begin('enter', null);
    }

    /**
     * 播离场过渡，`onFinished` 在**最后一帧写完之后**调用（关闭方在这里回收 / 销毁节点）。
     * 返回 `false` 表示没播上，调用方应当立刻自己收尾。
     */
    static playExit(node: Node | null, onFinished?: () => void): boolean {
        const player = UIMotionPlayer.prepare(node);
        if (!player) return false;
        return player.begin('exit', onFinished ?? null);
    }

    /** 取消正在跑的过渡并复位到「静止状态」（关闭方兜底用）。 */
    static stop(node: Node | null): void {
        if (!node || !node.isValid) return;
        try {
            node.getComponent(UIMotionPlayer)?.cancel();
        } catch (error) {
            console.warn('[UIMotionPlayer] 取播放器失败', error);
        }
    }

    /** 取（必要时挂上）播放器；任何异常都视为「播不了」。 */
    private static prepare(node: Node | null): UIMotionPlayer | null {
        if (!node || !node.isValid || !node.activeInHierarchy) return null;
        if (typeof UIOpacity !== 'function') return null;
        try {
            return node.getComponent(UIMotionPlayer) ?? node.addComponent(UIMotionPlayer);
        } catch (error) {
            console.warn('[UIMotionPlayer] 挂载播放器失败，跳过过渡', error);
            return null;
        }
    }

    // ============================================================
    // 生命周期
    // ============================================================

    /**
     * 被停用（节点 `active=false`，典型是关闭后进缓存）：把状态收干净。
     *
     * 离场途中被停用也要把收尾回调补上 —— 否则关闭方的回收逻辑永远等不到，
     * 缓存池 / 销毁都会漏掉一次。回调自身是幂等的（关闭方有 `settled` 门闩），
     * 补调不会重复销毁。
     */
    onDisable(): void {
        this.cancel();
    }

    onDestroy(): void {
        this.cancel();
    }

    // ============================================================
    // 播放
    // ============================================================

    private begin(phase: UIMotionPhase, onFinished: (() => void) | null): boolean {
        // 上一次还没收尾（同节点重播 / 进缓存后又被拿回来）：先了结它。
        // 离场的回调必须补上，否则关闭方的回收会漏掉一次。
        if (!this.settled) this.cancel();
        if (!this.node || !this.node.isValid) return false;
        try {
            this.captureBase();
            this.phase = phase;
            this.spec = uiMotionSpec(phase, uiMotionKindOf(this.node));
            this.onFinished = onFinished;
            this.startedAt = nowSeconds();
            this.running = true;
            this.settled = false;
            // 先把起始帧写死：等第一帧 `step` 再写的话，会先按原样渲染一帧（闪一下）。
            this.applyValue(uiMotionSample(this.spec, 0));
            this.unschedule(this.step);
            this.schedule(this.step, 0);
            return true;
        } catch (error) {
            console.warn('[UIMotionPlayer] 启动过渡失败，按无过渡处理', error);
            this.cancel();
            return false;
        }
    }

    /** 过渡的一帧（只在播放期间被调度）。 */
    private readonly step = (): void => {
        const spec = this.spec;
        if (!this.running || !spec) {
            this.unschedule(this.step);
            return;
        }
        const sample = uiMotionSample(spec, uiMotionProgress(this.startedAt, nowSeconds(), spec.seconds));
        this.applyValue(sample);
        if (!sample.done) return;
        this.settle(sample);
    };

    /** 收尾：写终点帧 → 停调度 → 通知关闭方。 */
    private settle(final: IUIMotionSample): void {
        if (this.settled) return;
        this.settled = true;
        this.running = false;
        this.unschedule(this.step);
        const callback = this.onFinished;
        this.onFinished = null;
        if (this.phase === 'enter') {
            // 进场结束时必须回写基准值：`out-back` 的终点是 1，但位置/缩放要精确复位，
            // 否则 Widget 重排、或下次播放都从「差一点」的状态起步。
            this.restoreBase();
        } else {
            this.applyValue(final);
        }
        try {
            callback?.();
        } catch (error) {
            console.error('[UIMotionPlayer] 过渡收尾回调抛错', error);
        }
    }

    /**
     * 立刻中止：离场视为「已播完」（补调回调），进场则复位。
     * 节点被销毁 / 进缓存 / 重新播放都会走到这里。
     */
    private cancel(): void {
        const wasExiting = this.running && this.phase === 'exit';
        this.running = false;
        try {
            this.unschedule(this.step);
        } catch (error) {
            console.warn('[UIMotionPlayer] 取消失败', error);
        }
        if (wasExiting) {
            this.settle(uiMotionSample(uiMotionSpec('exit', 'panel'), 1));
            return;
        }
        this.settled = true;
        this.onFinished = null;
        this.restoreBase();
    }

    // ============================================================
    // 写节点
    // ============================================================

    /**
     * 记录「静止状态」的基准位姿。
     *
     * ⚠️ 每次起播**重新抓一次**，不能只抓第一次：根节点带 `Widget` 时会被布局挪动
     * （改分辨率、切 tab 重排都会），沿用旧基准会让收尾把节点拽回老位置。
     */
    private captureBase(): void {
        const position = this.node.position;
        this.basePosition.set(position.x, position.y, position.z);
        const scale = this.node.scale;
        this.baseScale.set(scale.x, scale.y, scale.z);
        this.hasBase = true;
    }

    private applyValue(sample: IUIMotionSample): void {
        if (!this.node || !this.node.isValid) return;
        const opacity = this.ensureOpacity();
        if (opacity) opacity.opacity = sample.opacity;
        const scale = sample.scale;
        this.node.setScale(this.baseScale.x * scale, this.baseScale.y * scale, this.baseScale.z);
        this.node.setPosition(
            this.basePosition.x,
            this.basePosition.y + sample.offsetY,
            this.basePosition.z,
        );
    }

    private restoreBase(): void {
        if (!this.hasBase || !this.node || !this.node.isValid) return;
        this.node.setScale(this.baseScale);
        this.node.setPosition(this.basePosition);
    }

    private ensureOpacity(): UIOpacity | null {
        if (this.opacity && this.opacity.isValid) return this.opacity;
        try {
            this.opacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        } catch (error) {
            this.opacity = null;
        }
        return this.opacity;
    }
}
