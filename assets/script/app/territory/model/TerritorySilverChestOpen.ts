/**
 * 「银币宝箱」**独立**打开动画的时间轴（纯函数、零 `cc`）。
 *
 * ## 需求与评估（2026-11-10）
 *
 * 地图上有两类固定资源宝箱，图标不同：
 *
 * | 类别 | `rewardId` | 奖励 | 地图图标 | 打开动画 |
 * | --- | --- | --- | --- | --- |
 * | 卡牌碎片宝箱 | 1016~1022 | 银币 + 卡牌碎片等 | `territory_fixed_resource_v1`（黄铜藤蔓箱，69005） | `chest_seq_0…5` 开盖补帧 + 三档全屏表演 |
 * | **银币宝箱** | **1023** | **只有银币** | `coinBox`（蓝银金属箱，69020） | **本文件**：icon 放大 → 缩小 → 消失 |
 *
 * 用户口径：「银币宝箱是独立的打开动画，不要用卡牌宝箱的打开动画，因为他们的图标不一致」。
 *
 * ### 为什么做不出「同款开盖序列帧」
 *
 * `tools/gen_chest_open_frames.py` 的补帧办法要求**同一只箱子的闭合态 + 开盖态两张整图**：
 * 箱体取开盖图、闭合盖垫在下面压扁淡出、新盖绕接缝纵向长出。黄箱子那对素材齐全
 * （`territory_fixed_resource_v1.png` + `chest_open_v1.png`），蓝箱子只有一张 `coinBox.png`
 * **闭合态** —— 没有开盖态、没有箱内衬、没有箱盖内侧、也没有分层源文件。
 * `icon_baoxiang`（58×45 白绿线条 icon）同样只有闭合态。
 * 拿黄箱子的盖子贴到蓝箱子上，正是用户说的「图标不一致」；用生成式补一张开盖态，
 * 金属铆钉 / 蓝色菱形纹 / 银色包边无法逐像素对齐，只会造出第三种图标。
 *
 * ⇒ 采用用户给的兜底：**直接播 icon 放大缩小的消失动画**。
 *
 * ## 为什么是纯函数而不是 tween
 *
 * 与 `TerritoryUnlockTransition` / `ShakePresentation` 同款：站点节点是**池化复用**的，
 * tween 挂在节点上回收后还会继续跑。视图只按 `elapsed` 取这一帧的倍率写进节点，
 * 池化复位时把 `elapsed` 置 `-1` 即可，没有要销毁的定时器。
 */

/** 一次 pop 的总时长（秒）：够读出「胀一下再缩没」，又不至于拖慢连续开箱。 */
export const TERRITORY_SILVER_CHEST_POP_SECONDS = 0.4;

/** 放大段的峰值倍率（相对站点图标的基准缩放）。 */
export const TERRITORY_SILVER_CHEST_POP_PEAK = 1.3;

/** 放大段占总时长的比例；剩下 70% 一路缩到 0。 */
const GROW_PORTION = 0.3;

/**
 * 取 `elapsed` 秒时银币宝箱 icon 的**缩放系数**（乘在站点 `Icon` 的基准缩放上）。
 *
 * ```
 * 0s        0.12s       0.4s
 *  1 ─────↗ 1.3 ─────↘ 0
 *   （easeOutCubic）  （easeInQuad，缩到 0 即消失）
 * ```
 *
 * 缩到 0 本身就是「消失」，所以**不需要**再叠一层 `UIOpacity` 淡出 —— 少写一条会与
 * `setSpawnOpacity` 抢同一颗节点的通道。
 *
 * 非法 / 还没起播（`NaN`、`±Infinity`、`≤ 0`）一律返回 `1`（原样，不要先闪一下没了）；
 * `≥ 总时长` 返回 `0`（这一帧已经消失）。与 `territoryUnlockLockScale(-1) = 1` 同口径。
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
