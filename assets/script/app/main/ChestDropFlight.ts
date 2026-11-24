/**
 * 异步 PVP 战斗结束「掉落宝箱获得」动画的**纯函数时间轴**（零 `cc`，可直接单测）。
 *
 * 需求（2026-11-22）：*「异步pvp战斗结束 增加1个战斗掉落宝箱获得动画：对应的宝箱 icon
 * 带着三角形拖尾飞到宝箱 icon 的位置，弧线的飞行轨迹；宝箱飞入后，icon 抖动（类似卡牌 icon），
 * 激活底部的绿点」*。
 *
 * ## 为什么曲线另立真源
 * `TerritoryHeroReward.territoryHeroFlightFx` 是「一束 8 枚奖励图标错峰飞进英雄按钮」，
 * 有 `stagger` / `count` / 多枚同时在场；这里只有**一枚**宝箱，且要多带一条三角形拖尾、
 * 落地前要收小。借它的壳会把「一束错峰」的语义一起带进来。
 *
 * 但**贝塞尔公式与它同款**（`controlX = startX + dx * 0.3`、
 * `controlY = startY + |dy| * arcRatio`、二次插值），玩家看到的是同一种「奖励被收进按钮」的语言。
 * 时间曲线改成 smoothstep（起落都缓、中段快），比 `easeOutQuad` 更像一次抛投。
 *
 * ## 拖尾
 * 沿**飞行切线反方向**从宝箱后缘伸出一条由宽到尖的三角带，按段线性收宽 + 线性渐隐
 * （与 `ZCMissileTrail.zcMissileTrailQuads` 同一套几何口径），最后一段 `halfWidth1 = 0`
 * 自然收成尖角。方向取贝塞尔在 `k` 处的一阶导数，不用「起点→当前点」连线 ——
 * 弧线飞行时那根弦会把拖尾画歪。
 *
 * 所有几何都在**宿主局部坐标**里算（起点 / 终点已由视图换算到同一宿主）。
 */

import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../../core/hex/ShakePresentation';

export interface IChestDropPoint {
    readonly x: number;
    readonly y: number;
}

/** 某一帧的飞行姿态。`dirX/dirY` 是单位切向量，给拖尾定向用。 */
export interface IChestDropFrame {
    readonly x: number;
    readonly y: number;
    /** 0~1 的曲线参数（已缓动）。 */
    readonly progress: number;
    readonly scale: number;
    readonly opacity: number;
    readonly dirX: number;
    readonly dirY: number;
}

/** 一段梯形（最后一段收成三角尖）；四点按顺时针给，`Graphics` 直接 fill。 */
export interface IChestDropTrailQuad {
    readonly ax: number;
    readonly ay: number;
    readonly bx: number;
    readonly by: number;
    readonly cx: number;
    readonly cy: number;
    readonly dx: number;
    readonly dy: number;
    readonly alpha: number;
}

/** 单枚宝箱的飞行时长（秒）；也是落地时刻。跨屏弧线比英雄飞行 0.62s 稍长。 */
export const CHEST_DROP_FLIGHT_SECONDS = 0.9;

/** 二次贝塞尔拱高系数：`controlY = startY + |dy| * ratio`（与既有 0.42~0.55 同量级）。 */
export const CHEST_DROP_ARC_RATIO = 0.55;

/** 控制点横向占比（`controlX = startX + dx * ratio`），与 `TerritoryHeroFlight` 同款。 */
export const CHEST_DROP_CONTROL_X_RATIO = 0.3;

/** 飞行宝箱图标边长（逻辑 px）。比 HUD 上那颗 100×83 略小，避免压住目标。 */
export const CHEST_DROP_ICON_SIZE = 64;

/** 拖尾分段数：段数越多渐隐越顺，6 段足够且每帧只画 6 个多边形。 */
export const CHEST_DROP_TRAIL_SEGMENTS = 6;

/** 拖尾总长（逻辑 px）。 */
export const CHEST_DROP_TRAIL_LENGTH = 78;

/** 拖尾根部离宝箱中心的距离，留出图标自己的半宽。 */
export const CHEST_DROP_TRAIL_GAP = 12;

/** 拖尾根部半宽（逻辑 px）；尖端固定 0 ⇒ 整体是三角形。 */
export const CHEST_DROP_TRAIL_ROOT_HALF_WIDTH = 17;

/** 拖尾根部不透明度；按段线性衰减到 0。 */
export const CHEST_DROP_TRAIL_ALPHA = 0.8;

/** 落地抖动时长：直接复用 `TabButton.playHitFeedback` 的「先 Y 后 X」两段脉冲。 */
export const CHEST_DROP_HIT_SECONDS = SPAWN_SHAKE_TOTAL_SECONDS;

/** 起飞后多少秒长到正常大小。 */
const CHEST_DROP_GROW_PORTION = 0.18;
/** 最后这段开始「飞入」：收小 + 淡出。 */
const CHEST_DROP_ENTER_PORTION = 0.85;
/** 飞入末端的收小幅度（到落点剩 28%）。 */
const CHEST_DROP_ENTER_SHRINK = 0.72;

function clamp01Finite(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

/**
 * 弧线本身：二次贝塞尔。抽出来是为了让「位置」和「切线」共用同一个控制点，
 * 拖尾才不会与飞行轨迹错位。
 */
function chestDropBezier(
    origin: IChestDropPoint,
    target: IChestDropPoint,
    k: number,
): { x: number; y: number; controlX: number; controlY: number } {
    const controlX = origin.x + (target.x - origin.x) * CHEST_DROP_CONTROL_X_RATIO;
    const controlY = origin.y + Math.abs(target.y - origin.y) * CHEST_DROP_ARC_RATIO;
    const inv = 1 - k;
    return {
        x: inv * inv * origin.x + 2 * inv * k * controlX + k * k * target.x,
        y: inv * inv * origin.y + 2 * inv * k * controlY + k * k * target.y,
        controlX,
        controlY,
    };
}

/**
 * `elapsed` 秒时的飞行姿态；`< 0` / 非数 / `>= 时长` 一律 `null`（视图据此收工）。
 *
 * 落点前 15% 同时收小与淡出，才有「飞进 icon 里」的感觉；落地回调按**显式到达时刻**
 * 触发，不靠 `null` 的隐式窗口（掉帧会漏）。
 */
export function chestDropFlightFrame(
    elapsed: number,
    origin: IChestDropPoint,
    target: IChestDropPoint,
): IChestDropFrame | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= CHEST_DROP_FLIGHT_SECONDS) return null;
    if (!origin || !target || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)
        || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;

    const k = clamp01Finite(elapsed / CHEST_DROP_FLIGHT_SECONDS);
    const progress = k * k * (3 - 2 * k);
    const bezier = chestDropBezier(origin, target, progress);
    const inv = 1 - progress;
    // B'(k) = 2(1-k)(C-P0) + 2k(P1-C)
    const vx = 2 * inv * (bezier.controlX - origin.x) + 2 * progress * (target.x - bezier.controlX);
    const vy = 2 * inv * (bezier.controlY - origin.y) + 2 * progress * (target.y - bezier.controlY);
    const length = Math.hypot(vx, vy);

    const enter = k > CHEST_DROP_ENTER_PORTION
        ? clamp01Finite((k - CHEST_DROP_ENTER_PORTION) / (1 - CHEST_DROP_ENTER_PORTION)) : 0;
    const scale = (0.62 + 0.53 * clamp01Finite(k / CHEST_DROP_GROW_PORTION))
        * (1 - CHEST_DROP_ENTER_SHRINK * enter);
    const opacity = 1 - enter;

    return {
        x: bezier.x,
        y: bezier.y,
        progress,
        scale,
        opacity,
        // 切线退化（起点与终点重合 / 拱高为 0）时给一个稳定的默认朝向，不产生 NaN。
        dirX: length > 1e-6 ? vx / length : 1,
        dirY: length > 1e-6 ? vy / length : 0,
    };
}

/**
 * 三角形拖尾：沿 `-dir` 从宝箱后缘向后铺 `CHEST_DROP_TRAIL_SEGMENTS` 段梯形，
 * 宽度线性收到 0、alpha 线性淡到 0，并整条乘上飞行物的 `opacity`（飞入时一起消失）。
 */
export function chestDropTrailQuads(frame: IChestDropFrame): IChestDropTrailQuad[] {
    const quads: IChestDropTrailQuad[] = [];
    if (!frame || frame.opacity <= 0) return quads;
    const normalX = -frame.dirY;
    const normalY = frame.dirX;
    const rootX = frame.x - frame.dirX * CHEST_DROP_TRAIL_GAP;
    const rootY = frame.y - frame.dirY * CHEST_DROP_TRAIL_GAP;

    for (let index = 0; index < CHEST_DROP_TRAIL_SEGMENTS; index += 1) {
        const t0 = index / CHEST_DROP_TRAIL_SEGMENTS;
        const t1 = (index + 1) / CHEST_DROP_TRAIL_SEGMENTS;
        const x0 = rootX - frame.dirX * CHEST_DROP_TRAIL_LENGTH * t0;
        const y0 = rootY - frame.dirY * CHEST_DROP_TRAIL_LENGTH * t0;
        const x1 = rootX - frame.dirX * CHEST_DROP_TRAIL_LENGTH * t1;
        const y1 = rootY - frame.dirY * CHEST_DROP_TRAIL_LENGTH * t1;
        const w0 = CHEST_DROP_TRAIL_ROOT_HALF_WIDTH * (1 - t0);
        const w1 = CHEST_DROP_TRAIL_ROOT_HALF_WIDTH * (1 - t1);
        quads.push({
            ax: x0 + normalX * w0,
            ay: y0 + normalY * w0,
            bx: x1 + normalX * w1,
            by: y1 + normalY * w1,
            cx: x1 - normalX * w1,
            cy: y1 - normalY * w1,
            dx: x0 - normalX * w0,
            dy: y0 - normalY * w0,
            alpha: CHEST_DROP_TRAIL_ALPHA * (1 - (t0 + t1) / 2) * frame.opacity,
        });
    }
    return quads;
}

/**
 * 落地抖动（`ChestEntry` 没有 `TabButton` 组件，视图按这个逐帧写缩放）。
 *
 * 与 `TabButton.playHitFeedback()` **同一条曲线**、同一档 120% 拉伸，保证「类似卡牌 icon」。
 * `>= CHEST_DROP_HIT_SECONDS` 返回 `null` ⇒ 调用方复位到基准缩放。
 */
export function chestDropHitScale(elapsed: number): { x: number; y: number } | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= CHEST_DROP_HIT_SECONDS) return null;
    return {
        x: spawnShakeScaleX(elapsed, BUILDING_SHAKE_STRETCH),
        y: spawnShakeScaleY(elapsed, BUILDING_SHAKE_STRETCH),
    };
}
