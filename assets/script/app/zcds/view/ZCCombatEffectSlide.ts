/**
 * 定点表现的「平滑移过去」求值（2026-11-26 第 58 批）。
 *
 * 用户口径：「光圈（白色指示圈）切换到下个目标是快速移动（150px 速度），不要直接瞬移」。
 *
 * 为什么单独一个文件、而不是塞回 `ZCCombatEffectView`：
 * 它是纯几何（无 `cc` 依赖），可以直接被用例覆盖 —— 插值写错的表现是「圈飞过头 / 圈瞬移」，
 * 光看代码很难发现，必须能单独算一遍。
 *
 * ## 与 `flyFromX` / `flyInSeconds` 的区别（🔴 别合并）
 *
 * | | 子弹的飞入段 | 这里的滑动 |
 * | :-- | :-- | :-- |
 * | 字段 | `flyFrom*` + `flyInSeconds` | `slideFrom*` + `slideSeconds` |
 * | 到点之后 | 整颗消失（§56「命中即摘」） | 停在新位置，继续活满技能窗口 |
 *
 * 混用会让范围圈在第一次换目标之后直接消失。
 */

/** 参与滑动求值的最小字段集（`ZCCombatEvent` 结构上兼容）。*/
export interface IZCombatEffectSlideInput {
    readonly toX: number;
    readonly toY: number;
    readonly slideFromX?: number;
    readonly slideFromY?: number;
    readonly slideStartAt?: number;
    readonly slideSeconds?: number;
    readonly startedAt: number;
}

/**
 * 这一帧应该画在哪（世界坐标）。
 *
 * 没有登记滑动（或时长非法 / 已走完）⇒ 直接返回 `to`，调用方拿到的就是「瞬移后的终点」，
 * 存量事件逐字不变。
 *
 * @param now 当前时刻（秒，与 `startedAt` 同一时钟）
 */
export function zcCombatEffectSlidePoint(
    event: Readonly<IZCombatEffectSlideInput>,
    now: number,
): { x: number; y: number } {
    const seconds = event.slideSeconds ?? 0;
    const fromX = event.slideFromX;
    const fromY = event.slideFromY;
    if (!(seconds > 0) || fromX === undefined || fromY === undefined) {
        return { x: event.toX, y: event.toY };
    }
    const startAt = event.slideStartAt ?? event.startedAt;
    const elapsed = now - startAt;
    //  负时间（时钟回拨 / 快照重算）按起点处理，别让插值系数变成负数把圈甩到反方向。
    const ratio = elapsed <= 0 ? 0 : elapsed >= seconds ? 1 : elapsed / seconds;
    return {
        x: fromX + (event.toX - fromX) * ratio,
        y: fromY + (event.toY - fromY) * ratio,
    };
}
