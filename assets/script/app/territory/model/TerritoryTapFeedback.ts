/**
 * 地块 / 站点**点击反馈**的时间轴（纯函数、零 `cc`）。
 *
 * ## 口径来源
 *
 * `docs/章节地图动画实现规格.md` §1「点击地块获得资源」+ §0.1：
 *
 * | 元素 | 规格 |
 * | --- | --- |
 * | 地块按压 | `PressBounce`：scale `1 → 0.94 → 1.02 → 1`，0.18s |
 * | 绿色光圈 | 以点击点为圆心的径向光圈，0.3s 淡出 |
 * | 蓝色圆环 | `scale 0.4 → 1.4`、`alpha 1 → 0`，0.3s |
 *
 * 这三条是「手指按下 0.1s 内必须看到反馈」的全部内容 —— 规格 §5 验收口径第一条。
 *
 * ## 为什么单独一个文件
 *
 * 之前点击反馈只有 `cc.Button` 的 `SCALE` 过渡（引擎内置，`duration 0.1` + `zoomScale 1.2`
 * 是**放大**），既不符合 PressBounce（先压后弹），也没法做到"按下瞬间"——
 * Button 的过渡在**抬起**时才回，手感是"按下去没反应、松手跳一下"。
 *
 * 所以把曲线提出来单独测，视图只负责把数写进节点。
 */

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

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeOutCubic(p: number): number {
    const x = clamp01(p);
    return 1 - (1 - x) * (1 - x) * (1 - x);
}

/**
 * 按压缩放倍率；`elapsed` 超出时长返回 `null`（= 已播完，调用方把缩放复位成 1）。
 *
 * 三段：`0 → 0.35` 压到 0.94（`EaseOutCubic`）→ `0.35 → 0.7` 弹到 1.02 → `0.7 → 1` 落回 1。
 * 用**分段线性 + 缓动**而不是正弦：三个关键点的值必须精确等于 0.94 / 1.02 / 1
 * （正弦拟合做不到，且单测没法钉）。
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
 * 绿色径向光圈：中心亮、边缘透明（规格 §1「被点地块叠加绿色径向光圈」）。
 *
 * 半径 `10 → 62`（`EaseOutCubic`），不透明度 `1 → 0`（前 40% 几乎不淡，最后才消失）。
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
 * 蓝色小圆环：`scale 0.4 → 1.4`、`alpha 1 → 0`，0.3s（规格 §1）。
 *
 * 与绿光圈**同时开始**但读起来是两层：绿的是"地被压亮了一下"，蓝的是"点击点炸开一圈"。
 */
export function territoryTapRingFx(elapsed: number): ITerritoryTapRingFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_TAP_RING_SECONDS) return null;
    const p = elapsed / TERRITORY_TAP_RING_SECONDS;
    return {
        scale: TERRITORY_TAP_RING_FROM + (TERRITORY_TAP_RING_TO - TERRITORY_TAP_RING_FROM) * easeOutCubic(p),
        alpha: 1 - p,
    };
}
