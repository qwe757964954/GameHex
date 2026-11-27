/**
 * UIMotion — 界面 / 弹窗统一过渡曲线（纯函数，零引擎依赖）
 * ------------------------------------------------------------------
 * 需求（2026-11-18）：
 *   ① 所有 2 级 / 3 级界面打开时要有界面切换动效；
 *   ② 所有弹窗要有**统一**的打开 / 关闭过渡动画。
 *
 * 本工程的口径是「不建 tween」——池化节点上的 tween 会在回收后继续跑
 * （见 `docs/章节地图动画与点击反馈实现说明.md` 开篇、`ChestBar.setOpen`）。
 * 所以过渡同样拆成两层：
 *
 *   · **本文件**：只描述曲线（档位 → 起止值 + 缓动 + 时长），纯函数、零 `cc`；
 *   · `UIMotionPlayer.ts`：按 `startedAt` + 逐帧 `step()` 把采样值写进节点。
 *
 * 两档的取舍（为什么不是「一种参数打天下」）：
 *
 *   panel  —— 紧凑面板（弹窗根节点本身不是整屏）。从 0.92 倍、上浮 18px 弹回原位，
 *             带一点 `out-back` 的过冲，手感是「弹出来」。
 *   screen —— 整屏界面（根节点或子节点铺满屏幕，2/3 级大页基本都是）。只做淡入 +
 *             0.96 → 1 的微推。**整页缩放必须收敛**：0.92 那种幅度会把页面边缘
 *             缩进屏幕、露出底下的页面，看起来像「页面没铺满」而不是「在切换」。
 *
 * 关闭一律 0.16s、`in-quad`（加速离场）：玩家已经决定了，动画只负责收尾，
 * 不能让人等。它比进场短，且比进场「急」，方向感才清楚。
 */

/** 过渡的播放方向。 */
export type UIMotionPhase = 'enter' | 'exit';

/** 过渡档位，由 `UIMotionPlayer` 按「根节点是否铺满屏幕」自动判定。 */
export type UIMotionKind = 'panel' | 'screen';

/** 缓动曲线标识（不直接存函数：曲线要能被序列化、被用例逐个枚举）。 */
export type UIMotionEasing = 'out-cubic' | 'out-back' | 'in-quad';

/** 一条过渡曲线的完整参数。 */
export interface IUIMotionSpec {
    /** 总时长（秒）。 */
    readonly seconds: number;
    /** 缓动曲线。 */
    readonly easing: UIMotionEasing;
    /** 根节点透明度起点（0~1）。 */
    readonly opacityFrom: number;
    /** 根节点透明度终点（0~1）。 */
    readonly opacityTo: number;
    /** 根节点缩放起点（相对原尺寸的倍数）。 */
    readonly scaleFrom: number;
    /** 根节点缩放终点。 */
    readonly scaleTo: number;
    /** 纵向位移起点（逻辑 px，正值向上）。 */
    readonly offsetYFrom: number;
    /** 纵向位移终点。 */
    readonly offsetYTo: number;
}

/** 某一时刻的采样结果（视图只认这一份，不再自己算曲线）。 */
export interface IUIMotionSample {
    /** 0~255 的整数，直接写 `UIOpacity.opacity`。 */
    readonly opacity: number;
    /** 相对原尺寸的倍数。 */
    readonly scale: number;
    /** 相对原始位置的纵向偏移（逻辑 px，正值向上）。 */
    readonly offsetY: number;
    /** 0~1 的进度（已 clamp）。 */
    readonly progress: number;
    /** `true` = 本条过渡已走完，视图可以收工。 */
    readonly done: boolean;
}

/** 紧凑面板的进场起始缩放。 */
export const UI_MOTION_PANEL_SCALE_FROM = 0.92;

/** 紧凑面板的进场起始纵向偏移（逻辑 px）：从下方 18px 浮上来。 */
const UI_MOTION_PANEL_OFFSET_Y = -18;

/** 整屏界面的进场起始缩放：只做微推，避免边缘露底。 */
export const UI_MOTION_SCREEN_SCALE_FROM = 0.96;

/** 整屏界面的进场时长（秒）。 */
const UI_MOTION_SCREEN_ENTER_SECONDS = 0.24;

/** 紧凑面板的进场时长（秒）；略长是因为它带过冲，短了会显得「弹太快」。 */
export const UI_MOTION_PANEL_ENTER_SECONDS = 0.28;

/** 关闭时长（秒），两档同值：离场要快、要统一。 */
export const UI_MOTION_EXIT_SECONDS = 0.16;

/** 关闭时缩到的倍数（两档同值；只做「往里收一点」，不做整页缩小）。 */
const UI_MOTION_EXIT_SCALE = 0.94;

/** 关闭时的纵向偏移（逻辑 px）：向下 10px 沉下去。 */
const UI_MOTION_EXIT_OFFSET_Y = -10;

/**
 * 取一条过渡曲线。
 * @param phase 进场 / 离场
 * @param kind  面板 / 整屏
 */
export function uiMotionSpec(phase: UIMotionPhase, kind: UIMotionKind): IUIMotionSpec {
    if (phase === 'enter') {
        if (kind === 'screen') {
            return {
                seconds: UI_MOTION_SCREEN_ENTER_SECONDS,
                easing: 'out-cubic',
                opacityFrom: 0,
                opacityTo: 1,
                scaleFrom: UI_MOTION_SCREEN_SCALE_FROM,
                scaleTo: 1,
                offsetYFrom: 0,
                offsetYTo: 0,
            };
        }
        return {
            seconds: UI_MOTION_PANEL_ENTER_SECONDS,
            easing: 'out-back',
            opacityFrom: 0,
            opacityTo: 1,
            scaleFrom: UI_MOTION_PANEL_SCALE_FROM,
            scaleTo: 1,
            offsetYFrom: UI_MOTION_PANEL_OFFSET_Y,
            offsetYTo: 0,
        };
    }
    return {
        seconds: UI_MOTION_EXIT_SECONDS,
        easing: 'in-quad',
        opacityFrom: 1,
        opacityTo: 0,
        scaleFrom: 1,
        scaleTo: UI_MOTION_EXIT_SCALE,
        offsetYFrom: 0,
        offsetYTo: UI_MOTION_EXIT_OFFSET_Y,
    };
}

/** 缓动求解。入参先 clamp 到 0~1，越界不抛（脏 dt 最多让动画停在终点）。 */
export function uiMotionEase(easing: UIMotionEasing, progress: number): number {
    const t = clamp01(progress);
    if (easing === 'in-quad') return t * t;
    if (easing === 'out-back') {
        // 标准 back-out：c1 决定过冲幅度，1.70158 对应峰值约 +10%。
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const shifted = t - 1;
        return 1 + c3 * shifted * shifted * shifted + c1 * shifted * shifted;
    }
    const inverse = 1 - t;
    return 1 - inverse * inverse * inverse;
}

/**
 * 由「起播时刻 + 当前时刻」算进度。
 * 时长非正 ⇒ 直接 1（当作「没有动画」），避免除零。
 */
export function uiMotionProgress(startedAt: number, now: number, seconds: number): number {
    if (!(seconds > 0)) return 1;
    if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 1;
    return clamp01((now - startedAt) / seconds);
}

/** 采样：进度 → 可写进节点的三个值。 */
export function uiMotionSample(spec: IUIMotionSpec, progress: number): IUIMotionSample {
    const clamped = clamp01(progress);
    const eased = uiMotionEase(spec.easing, clamped);
    const opacity = spec.opacityFrom + (spec.opacityTo - spec.opacityFrom) * eased;
    const scale = spec.scaleFrom + (spec.scaleTo - spec.scaleFrom) * eased;
    const offsetY = spec.offsetYFrom + (spec.offsetYTo - spec.offsetYFrom) * eased;
    return {
        // out-back 会把 eased 顶过 1，透明度必须单独 clamp（否则 255 会被写成 285）。
        opacity: Math.round(clamp01(opacity) * 255),
        // 缩放留一个正数下限：0 倍会让节点「消失」，是脏数据时的兜底而不是可调项。
        scale: Math.max(0.05, scale),
        offsetY,
        progress: clamped,
        done: clamped >= 1,
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 1;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}
