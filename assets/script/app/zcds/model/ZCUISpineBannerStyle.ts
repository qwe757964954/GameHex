import type { sp } from 'cc';

/**
 * 全屏 UI spine 横幅（填满 720 屏宽）的通用换算（零 `cc` 运行时依赖，只有类型 import）。
 *
 * 两处在用，口径必须同一份：
 * - 结算胜负 UI 特效（`ZCSettlementOutcomeStyle` / `ZCGame.playOutcomeEffect`）；
 * - 对局开始「开局对战」特效（`ZCBattleStartStyle` / `ZCGameHUDView.playMapIntro`）。
 *
 * 共同点：都是**横条**（画布本身接近正方形，可见横幅宽度 ≈ 画布宽）、都要铺满 720、
 * 都挂在 HUD 根节点上并置顶。差异只在"播哪一段"和"播多久"，那两条留在各自的
 * `ZC*Style` 里。
 */

/** 设计分辨率宽（720×1280）。横幅按它铺满屏宽。 */
export const ZC_UI_BANNER_WIDTH = 720;

/**
 * 骨架的运行时数据（画布宽 + 动画表）。
 *
 * 与 `ZCSkillAnnounceStyle` / `ZCTestKapaiStage` 同一条路：`sp.SkeletonData` 的
 * `width` / `animations` 不在 3.8.8 的公开字段上（`.skel` 导入后 `_skeletonJson` 也恒为
 * `null`），只有 `getRuntimeData(true)` 给得出，且它**会抛**（重建 / 释放过的数据），
 * 所以每处调用都夹 try。
 */
function bannerRuntimeOf(data: sp.SkeletonData | null | undefined): {
    width?: number;
    animations?: readonly { name?: string; duration?: number }[];
} | null {
    if (!data) return null;
    try {
        return data.getRuntimeData(true) as {
            width?: number;
            animations?: readonly { name?: string; duration?: number }[];
        } | null;
    } catch {
        return null;
    }
}

/** 骨架画布宽；取不到返回 0（调用方按「不知道」处理，别当 0 尺寸用）。 */
export function zcUiBannerCanvasWidthOf(data: sp.SkeletonData | null | undefined): number {
    const width = bannerRuntimeOf(data)?.width;
    return typeof width === 'number' && Number.isFinite(width) ? width : 0;
}

/** 指定动画的时长（秒）；没这段 / 取不到返回 0。 */
export function zcUiBannerClipSecondsOf(data: sp.SkeletonData | null | undefined, name: string): number {
    const animations = bannerRuntimeOf(data)?.animations;
    if (!animations || !name) return 0;
    const clip = animations.find((item) => item?.name === name);
    const duration = clip?.duration;
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * 把骨架**画布宽**折算成 720 屏宽所需的节点缩放。
 *
 * 按宽而不是按高：需求是「填充整个宽度」，而这些横幅本身就是横条
 * （结算 744×744 画布 / 可见 726×257，开局 560×560 画布 / 可见 558×109）——
 * 按高归一会让 720 宽的横幅只剩一半，两边各空一大块。
 * 画布宽拿不到时返回 1：宁可尺寸不准，也不能是 0（0 缩放 = 屏上没有）。
 */
export function zcUiBannerScale(canvasWidth: number | null | undefined): number {
    if (typeof canvasWidth !== 'number' || !Number.isFinite(canvasWidth) || canvasWidth <= 0) return 1;
    return ZC_UI_BANNER_WIDTH / canvasWidth;
}

/**
 * 让动画正好铺满 `durationSeconds` 的播放倍速（`duration / clip`）。
 *
 * 只有结算那条用（要和地块翻转同起同落）；开局那条传 0 = 原速播一次。
 * 片段时长取不到时返回 1。
 */
export function zcUiBannerTimeScale(clipSeconds: number | null | undefined, durationSeconds: number): number {
    if (typeof clipSeconds !== 'number' || !Number.isFinite(clipSeconds) || clipSeconds <= 0) return 1;
    if (!(durationSeconds > 0)) return 1;
    return durationSeconds / clipSeconds;
}

/**
 * 横幅节点在父级里的居中坐标（父级锚点不一定是 0.5）。
 *
 * 直接写 `setPosition(0, 0)` 只在「父级锚点 = 居中」时才是屏幕中心；页面根节点换过锚点
 * 就会整体偏出去，而且不报错。这里按 `(0.5 − anchor) × size` 反算内容矩形中心。
 */
export function zcUiBannerCenterOf(size: number, anchor: number): number {
    const safeSize = Number.isFinite(size) ? size : 0;
    const safeAnchor = Number.isFinite(anchor) ? anchor : 0.5;
    return (0.5 - safeAnchor) * safeSize;
}
