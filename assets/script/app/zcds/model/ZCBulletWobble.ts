/**
 * 弹体「飞行途中的抖动」（纯逻辑，不 import 任何 `cc`）。
 *
 * 用户口径（2026-11-26 第 57 批）：
 *   · 毒箭菇蘑菇爆炸：「行径路上播放移动动画：做 scale 的 **Y 轴**缩放模仿抖动 1-1.05-0.95-1」
 *   · 大嘴花破阵术：「…做 scale 的 **X 轴**缩放模仿抖动 1-1.05-0.95-1」
 *
 * 为什么放在模型层做纯函数、而不是在 prefab 里挂 Animation：
 *   ① 抖动是「沿飞行时间」的，不是「节点自己的时钟」—— 池化复用的特效节点寿命比事件长，
 *      用节点的 Animation 会让第二颗子弹一上来就接着上一颗的相位（看着像没抖）；
 *   ② 工程约定「动画用 `startedAt` + 纯函数计算进度，视图不零散建 tween 或累加 dt」；
 *   ③ 纯函数可以直接单测四个关键帧，不需要引擎。
 *
 * 口径：`1 → 1+amount → 1-amount → 1` 四个关键帧**等分一个周期**，段内线性插值。
 * 这不是正弦 —— 用户给的四个数是等间隔的，用正弦在 0.5 处永远回到 1、给不出 0.95。
 */

/** 抖动作用在哪个轴上（只影响一个轴，另一个轴保持 1）。*/
export type ZCBulletWobbleAxis = 'x' | 'y';

/** 一条弹体的抖动配置；不登记 = 不抖（绝大多数弹体）。*/
export interface IZCBulletWobble {
    readonly axis: ZCBulletWobbleAxis;
    /** 幅度：`1 ± amount`。用户写的 1.05 / 0.95 ⇒ 0.05。*/
    readonly amount: number;
    /** 一个完整循环的秒数；越小抖得越急。*/
    readonly periodSeconds: number;
}

/**
 * 一个周期里的四个关键帧（相对倍率），顺序即播放顺序：
 * `1 → 1+amount → 1-amount → 1`。
 *
 * 段数 = `length - 1` = 3，所以「0 / 1/3 / 2/3 / 1」正好对应用户说的四个数。
 */
export const ZC_BULLET_WOBBLE_FRAME_COUNT = 4;

/**
 * 第 `elapsedSeconds` 秒的缩放倍率（恒为正、恒有限）。
 *
 * 三个兜底，都为「不抖」：
 *   · `amount` 非正 / 非数字 ⇒ 1（免得写错一个 0 让子弹凭空消失）；
 *   · `periodSeconds` 非正 / 非数字 ⇒ 1（除以 0 会得到 `Infinity`，视图写进
 *     `setScale` 就是 `NaN` 矩阵，整颗子弹从屏幕上消失且不报错）；
 *   · `elapsedSeconds` 非数字 ⇒ 按 0 取，也就是周期起点（倍率正好 1）。
 */
export function zcBulletWobbleScale(
    wobble: IZCBulletWobble | null | undefined,
    elapsedSeconds: number,
): number {
    if (!wobble) return 1;
    const amount = wobble.amount;
    const period = wobble.periodSeconds;
    if (!Number.isFinite(amount) || amount <= 0) return 1;
    if (!Number.isFinite(period) || period <= 0) return 1;
    const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    //  `%` 对负数返回负值 ⇒ 先归一化再取模，事件时间倒流（快照还原）也不会炸。
    const phase = ((elapsed % period) + period) % period / period;
    const segments = ZC_BULLET_WOBBLE_FRAME_COUNT - 1;
    const scaled = phase * segments;
    const index = Math.min(segments - 1, Math.floor(scaled));
    const fraction = scaled - index;
    const from = wobbleFrameValue(amount, index);
    const to = wobbleFrameValue(amount, index + 1);
    return from + (to - from) * fraction;
}

/** 第 `index` 个关键帧的倍率（`index` 超出 0~3 按端点取，调用方已钳位，这里只做兜底）。*/
function wobbleFrameValue(amount: number, index: number): number {
    switch (index) {
        case 1: return 1 + amount;
        case 2: return 1 - amount;
        default: return 1;
    }
}

/**
 * 一条弹体的抖动**逐轴倍率**；不抖时返回 `[1, 1]`。
 *
 * 视图直接拿它去乘 `body` 节点的基准缩放，所以调用方不需要知道「哪个轴」——
 * 少一处 `axis === 'y' ? ... : ...` 的分支就少一处写反的机会。
 */
export function zcBulletWobbleScaleXY(
    wobble: IZCBulletWobble | null | undefined,
    elapsedSeconds: number,
): readonly [number, number] {
    const scale = zcBulletWobbleScale(wobble, elapsedSeconds);
    if (scale === 1) return [1, 1];
    return wobble?.axis === 'x' ? [scale, 1] : [1, scale];
}
