/**
 * 银币宝箱的独立打开动画时间轴（纯函数，零 cc）。
 *
 * 银币宝箱（rewardId 1023，蓝银箱 `coinBox`）只有闭合态素材，无法复用黄铜箱的
 * 开盖补帧序列，因此采用图标放大后缩小的消失动画。节点为池化复用，
 * 视图按 `elapsed` 取当前倍率，不用 tween。
 */

/** 一次 pop 的总时长（秒）。 */
export const TERRITORY_SILVER_CHEST_POP_SECONDS = 0.4;

/** 放大段的峰值倍率。 */
export const TERRITORY_SILVER_CHEST_POP_PEAK = 1.3;

/** 放大段占总时长的比例，剩余时间缩到 0。 */
const GROW_PORTION = 0.3;

/**
 * 取 `elapsed` 秒时银币宝箱 icon 的缩放系数。
 *
 * 前 30% 放大到峰值，后 70% 缩到 0；缩到 0 即消失，不再叠加透明度。
 * 未起播返回 1，播完返回 0，非法入参按 1 处理。
 */
export function territorySilverChestIconPop(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 1;
    if (elapsed >= TERRITORY_SILVER_CHEST_POP_SECONDS) return 0;
    const t = elapsed / TERRITORY_SILVER_CHEST_POP_SECONDS;
    if (t <= GROW_PORTION) {
        const k = t / GROW_PORTION;
        const eased = 1 - (1 - k) ** 3;
        return 1 + (TERRITORY_SILVER_CHEST_POP_PEAK - 1) * eased;
    }
    const k = (t - GROW_PORTION) / (1 - GROW_PORTION);
    return TERRITORY_SILVER_CHEST_POP_PEAK * (1 - k) ** 2;
}
