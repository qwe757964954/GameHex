/**
 * 「未解锁 → 可激活」的过渡动画曲线（纯函数，零引擎依赖）。
 *
 * 锁放大 1.2 后缩小消失，价格 UI 同期从 0 生成到 1，两段各 1s、同时起手。
 * 使用缩放而非透明度，保留按文本宽度算好的排版，也不与建筑的生成透明度语义冲突。
 */

import { easeOutCubic } from '../../../core/math/Easing';
import { clamp01Finite as clamp01 } from '../../../core/math/Scalar';

/** 两段动画总时长（秒）。 */
export const TERRITORY_UNLOCK_TRANSITION_SECONDS = 1;

/** 锁的峰值缩放。 */
export const TERRITORY_UNLOCK_LOCK_PEAK = 1.2;

/** 价格生成的过冲峰值。 */
export const TERRITORY_UNLOCK_PRICE_PEAK = 1.15;

/** 锁：前 35% 长到峰值，后 65% 缩到 0。 */
const LOCK_GROW_PORTION = 0.35;

/** 价格：前 55% 长到峰值，后 45% 落回 1。 */
const PRICE_RISE_PORTION = 0.55;

/**
 * 锁在 `elapsedSeconds` 时的缩放。
 *
 * 未起播返回 1，播完返回 0；中间先放大再缩到 0。
 */
export function territoryUnlockLockScale(elapsedSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 1;
    if (elapsedSeconds >= TERRITORY_UNLOCK_TRANSITION_SECONDS) return 0;
    const t = elapsedSeconds / TERRITORY_UNLOCK_TRANSITION_SECONDS;
    if (t < LOCK_GROW_PORTION) {
        return 1 + (TERRITORY_UNLOCK_LOCK_PEAK - 1) * easeOutCubic(t / LOCK_GROW_PORTION);
    }
    const k = (t - LOCK_GROW_PORTION) / (1 - LOCK_GROW_PORTION);
    return TERRITORY_UNLOCK_LOCK_PEAK * (1 - easeInCubic(k));
}

/**
 * 价格在 `elapsedSeconds` 时的缩放系数。
 *
 * 未起播返回 0，播完返回 1；中间先过冲到峰值再回落。
 */
export function territoryUnlockPriceScale(elapsedSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    if (elapsedSeconds >= TERRITORY_UNLOCK_TRANSITION_SECONDS) return 1;
    const t = elapsedSeconds / TERRITORY_UNLOCK_TRANSITION_SECONDS;
    if (t < PRICE_RISE_PORTION) {
        return TERRITORY_UNLOCK_PRICE_PEAK * easeOutCubic(t / PRICE_RISE_PORTION);
    }
    const k = (t - PRICE_RISE_PORTION) / (1 - PRICE_RISE_PORTION);
    return TERRITORY_UNLOCK_PRICE_PEAK + (1 - TERRITORY_UNLOCK_PRICE_PEAK) * easeOutCubic(k);
}

function easeInCubic(p: number): number {
    const x = clamp01(p);
    return x * x * x;
}
