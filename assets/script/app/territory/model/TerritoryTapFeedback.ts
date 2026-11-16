/**
 * 地块 / 站点点击反馈的时间轴（纯函数，零 cc）。
 *
 * 规格来自 `docs/章节地图动画实现规格.md` §1：地块按压 0.18s 回弹，
 * 绿色光圈与蓝色圆环各 0.3s。曲线独立成纯函数，视图只负责写入节点。
 */

import { easeOutCubic } from '../../../core/math/Easing';
import { clamp01Finite as clamp01 } from '../../../core/math/Scalar';

/** 按压回弹总时长（秒，规格 0.18）。 */
export const TERRITORY_TAP_PRESS_SECONDS = 0.18;
/** 按压回弹的三个关键倍率：先压到 94%，再弹到 102%，最后落回 100%。 */
export const TERRITORY_TAP_PRESS_DOWN = 0.94;
export const TERRITORY_TAP_PRESS_UP = 1.02;

/** 光圈 / 圆环的时长（秒，规格 0.3）。 */
export const TERRITORY_TAP_RING_SECONDS = 0.3;

/** 绿色光圈的最大半径（像素）与起始半径。 */
export const TERRITORY_TAP_GLOW_FROM = 10;
export const TERRITORY_TAP_GLOW_TO = 62;

/** 蓝色小圆环的起始 / 结束倍率（规格 `0.4 → 1.4`）。 */
export const TERRITORY_TAP_RING_FROM = 0.4;
export const TERRITORY_TAP_RING_TO = 1.4;
/** 蓝色圆环的基准半径（像素）。 */
export const TERRITORY_TAP_RING_RADIUS = 26;

/**
 * 按压缩放倍率；`elapsed` 超出时长返回 `null`（调用方复位成 1）。
 *
 * 三段线性加缓动：压到 0.94、弹到 1.02、落回 1，三个关键值可精确断言。
 */
export function territoryTapPressScale(elapsed: number): number | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_TAP_PRESS_SECONDS) return null;
    const p = elapsed / TERRITORY_TAP_PRESS_SECONDS;
    if (p < 0.35) return 1 + (TERRITORY_TAP_PRESS_DOWN - 1) * easeOutCubic(p / 0.35);
    if (p < 0.7) {
        return TERRITORY_TAP_PRESS_DOWN
            + (TERRITORY_TAP_PRESS_UP - TERRITORY_TAP_PRESS_DOWN) * easeOutCubic((p - 0.35) / 0.35);
    }
    return TERRITORY_TAP_PRESS_UP + (1 - TERRITORY_TAP_PRESS_UP) * easeOutCubic((p - 0.7) / 0.3);
}

/** 绿色光圈的半径与不透明度；`null` = 这一帧不画。 */
export interface ITerritoryTapGlowFx {
    readonly radius: number;
    readonly alpha: number;
}

/**
 * 绿色径向光圈：半径 10 → 62 缓出，不透明度 1 → 0。
 */
export function territoryTapGlowFx(elapsed: number): ITerritoryTapGlowFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_TAP_RING_SECONDS) return null;
    const p = elapsed / TERRITORY_TAP_RING_SECONDS;
    const eased = easeOutCubic(p);
    return {
        radius: TERRITORY_TAP_GLOW_FROM + (TERRITORY_TAP_GLOW_TO - TERRITORY_TAP_GLOW_FROM) * eased,
        alpha: 1 - p * p,
    };
}

/** 蓝色小圆环的倍率与不透明度；`null` = 这一帧不画。 */
export interface ITerritoryTapRingFx {
    readonly scale: number;
    readonly alpha: number;
}

/**
 * 蓝色小圆环：`scale 0.4 → 1.4`、`alpha 1 → 0`，0.3s。
 */
export function territoryTapRingFx(elapsed: number): ITerritoryTapRingFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_TAP_RING_SECONDS) return null;
    const p = elapsed / TERRITORY_TAP_RING_SECONDS;
    return {
        scale: TERRITORY_TAP_RING_FROM + (TERRITORY_TAP_RING_TO - TERRITORY_TAP_RING_FROM) * easeOutCubic(p),
        alpha: 1 - p,
    };
}
