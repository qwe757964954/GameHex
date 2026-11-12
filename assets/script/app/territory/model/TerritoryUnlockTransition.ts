/**
 * 「未解锁 → 可激活」的过渡动画曲线 —— 纯函数，零引擎依赖，可单测。
 *
 * 需求（2026-11-09，用户截图圈着一格刚满足前置的地块）：
 *  1. 锁放大 1.2，再缩小消失，动画总时间 1s；
 *  2. 银币和数字 UI 生成动画，总时间 1s。
 *
 * ## 两段同时起手、同时收工（都是 1s）
 * 锁层压在价格层上面（`HexLockLayer` 插在 `StationBadgeLayer` 之前），所以前半段是
 * 「锁挡住价格」、后半段是「锁缩没了、价格已经长好」。**不要**把价格延后 0.5s：
 * 那样总时长就不是 1s 了（用户口径是两件各 1s，不是首尾相接的 2s）。
 *
 * ## 为什么给「缩放」而不是「透明度」
 * 价格那两颗节点（`CaptionBg` / `CaptionLabel`）的**位置**是按实测文本宽算出来的
 * （见 `TerritoryStationView.applyCaptionPlacement`），改透明度只会淡入、不会「生成」；
 * 缩放绕各自中心、不动位置，既保留排版，又不会被误当成"加载中"的半透明态
 * （那个语义已经被 `setSpawnOpacity` 用在建筑上了）。
 */

/** 两段动画的总时长（秒）。需求原文「动画总时间 1s」「总时间 1s」。 */
export const TERRITORY_UNLOCK_TRANSITION_SECONDS = 1;

/** 锁的峰值缩放（需求原文「锁放大 1.2」）。 */
export const TERRITORY_UNLOCK_LOCK_PEAK = 1.2;

/** 价格「生成」时的过冲峰值（与宝箱入口 `0 → 1.15 → 1` 同一个量级，手感一致）。 */
export const TERRITORY_UNLOCK_PRICE_PEAK = 1.15;

/** 锁：前 35% 长到 1.2，后 65% 缩到 0（放大要快、消失要拖得久一点才看得见）。 */
const LOCK_GROW_PORTION = 0.35;

/** 价格：前 55% 长到 1.15，后 45% 落回 1。 */
const PRICE_RISE_PORTION = 0.55;

/**
 * 锁在 `elapsedSeconds` 时的缩放。
 *
 *  · `< 0` / 非数 ⇒ `1`（还没起播，保持原样）；
 *  · `0 ~ 0.35s` ⇒ `1 → 1.2`（`easeOutCubic`：一下弹大）；
 *  · `0.35 ~ 1s` ⇒ `1.2 → 0`（`easeInCubic`：越缩越快，"嗖"地消失）；
 *  · `≥ 1s` ⇒ `0`（调用方该把节点关掉并复位成 1）。
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
 * 价格（银币 + 数字）在 `elapsedSeconds` 时的缩放系数。
 *
 *  · `< 0` / 非数 ⇒ `0`（还没起播 ⇒ 藏起来）；
 *  · `0 ~ 0.55s` ⇒ `0 → 1.15`（`easeOutCubic`）；
 *  · `0.55 ~ 1s` ⇒ `1.15 → 1`（回落，别停在被放大的状态）；
 *  · `≥ 1s` ⇒ `1`。
 *
 * 返回值是**系数**：与 `CONDITION_ICON_SCALE` / `CONDITION_VALUE_SCALE` 相乘后写进节点，
 * 所以 1 表示完全展开、0 表示不可见。
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

function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

function easeInCubic(p: number): number {
    const x = clamp01(p);
    return x * x * x;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}
