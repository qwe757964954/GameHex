/**
 * 资源栏「被奖励击中」的反馈曲线 —— **纯函数，零引擎依赖**。
 *
 * ## 为什么单独一个文件
 *
 *  资源栏要的反馈有两半，都是「时间 → 数值」的映射：
 *
 *  | 反馈 | 载体 | 曲线 |
 *  |---|---|---|
 *  | 单格 | 图标放大 / 数字滚动 | {@link resBarHitFx} |
 *  | 单格 | 这一格的底色闪光 | {@link resBarFlashFx} |
 *
 *  ⚠️ 闪光的作用域是**被命中的那一格**（2026-10-26 改口径：原先闪整条，用户看不出到底哪个资源涨了）。
 *  曲线本身与作用域无关，还是那只单峰。
 *
 *  两半都必须**可单测**（时序错位在编辑器里极难看出来），而 `ResBar` / `MainResBarSlot`
 *  是 `cc.Component`、在 node 测试沙箱里跑不起来 ⇒ 把曲线抽到这里，视图只做「取 fx → 写节点」。
 *
 * ## 硬约束
 *
 *  · **不用 tween**（全工程口径）：视图记 `elapsed`，每帧向这里要一个值；
 *  · **不逐帧累加**：所有输出都只由 `elapsed` 直接算出，暂停 / 掉帧都不会漂；
 *  · 抖动一律确定性（本文件根本不需要抖动 —— 反馈是单次脉冲）。
 */

/** 单格跳动（图标弹一下 + 数字滚动）的总时长（秒）。 */
export const RES_BAR_HIT_SECONDS = 0.46;

/** 资源格闪光的总时长（秒）。作用域 = 命中的那一格（见 `ResBar.flash`）。 */
export const RES_BAR_FLASH_SECONDS = 0.58;

/** 图标峰值放大比例（`0.34` = 最大到 1.34 倍）。 */
export const RES_BAR_HIT_ICON_POP = 0.34;

/** 数字峰值放大比例（比图标克制：文字放大易糊）。 */
export const RES_BAR_HIT_LABEL_POP = 0.18;

/** 弹跳过程的收窄系数：`0.62` ⇒ 0 ~ 62% 的时间内完成「起 → 峰 → 落」。 */
const RES_BAR_HIT_POP_SPAN = 0.62;

/** 闪光最亮时的填充透明度（`0~1`，视图再乘 255）。 */
export const RES_BAR_FLASH_PEAK_ALPHA = 0.42;

/** 一帧的跳动状态。 */
export interface IResBarHitFx {
    /** 图标缩放（`1` = 原大）。 */
    readonly iconScale: number;
    /** 数字缩放（`1` = 原大）。 */
    readonly labelScale: number;
    /** 数字滚动进度 `0..1`（调用方按 `from + (to - from) × countRatio` 写文本）。 */
    readonly countRatio: number;
}

/** `0..1` 夹紧（脏 `elapsed` 不产出 NaN 几何）。 */
function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `EaseOutCubic`：起手快、收尾稳（数字滚动用它，最后几十点不会拖）。 */
function easeOutCubic(t: number): number {
    const inv = 1 - clamp01(t);
    return 1 - inv * inv * inv;
}

/**
 * 单格跳动在 `elapsed` 秒时的状态；`null` = 这一格没有反馈在播（视图据此复原）。
 *
 * 曲线：
 *  · 图标 / 数字都是**单峰弹跳**（`sin(π × p/0.62)`）—— `p=0` 与 `p≥0.62` 时恰好 `1`，
 *    所以「开始」和「结束」都不需要额外的归位帧，也不会有残留的 1.0001 倍数；
 *  · 数字滚动占满整个 `RES_BAR_HIT_SECONDS`（`EaseOutCubic`），比弹跳长一点 ——
 *    弹跳先落地、数字再收尾，读起来是「弹一下 + 数字追上」而不是两件事同时结束。
 */
export function resBarHitFx(elapsed: number): IResBarHitFx | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_HIT_SECONDS) return null;
    const progress = elapsed / RES_BAR_HIT_SECONDS;
    const pop = Math.sin(Math.PI * clamp01(progress / RES_BAR_HIT_POP_SPAN));
    return {
        iconScale: 1 + RES_BAR_HIT_ICON_POP * pop,
        labelScale: 1 + RES_BAR_HIT_LABEL_POP * pop,
        countRatio: easeOutCubic(progress),
    };
}

/**
 * 资源格闪光在 `elapsed` 秒时的**归一强度**（`0..1`，视图乘 `RES_BAR_FLASH_PEAK_ALPHA`）；
 * `null` = 没在闪。
 *
 * 对称的单峰（`sin(π × p)`）：起手即亮、峰值在中点、收尾回到 0。
 * 不用「快升慢落」的偏斜曲线 —— 闪光是个**短促的确认**，拖着半秒的余晖会盖住数字。
 */
export function resBarFlashFx(elapsed: number): number | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= RES_BAR_FLASH_SECONDS) return null;
    return Math.sin(Math.PI * (elapsed / RES_BAR_FLASH_SECONDS));
}

/** 拆开的数值文本：`12/60` → `{ value: 12, suffix: '/60' }`；`1,234` → `{ 1234, '' }`。 */
export interface IResBarCountText {
    readonly value: number;
    /** 数值后面原样保留的部分（体力的 `/上限`、单位等）。 */
    readonly suffix: string;
}

/**
 * 把资源栏上的**显示文本**拆成「数值 + 后缀」。
 *
 * 不认千分位里的逗号（先剔掉）：`CmdRole` 的数值是本端拼的 `String(number)`，
 * 但老端存档 / 手改的缓存里出现过 `1,234`，剔掉最省事。
 * 拆不出来（空串 / 纯文字）⇒ `value = 0`，调用方据此跳过滚动（只弹跳）。
 */
export function parseResBarCountText(text: string): IResBarCountText {
    const raw = typeof text === 'string' ? text.replace(/,/g, '').trim() : '';
    const matched = /^(-?\d+)(.*)$/.exec(raw);
    if (!matched) return { value: 0, suffix: '' };
    const value = Number(matched[1]);
    return {
        value: Number.isFinite(value) ? value : 0,
        suffix: matched[2] ?? '',
    };
}

/**
 * 滚动中的显示文本：数值取整后拼回后缀。
 *
 * ⚠️ 不重排千分位 —— `CmdRole` 的数字本来就没有分隔符，这里加进去会在动画收尾那一下
 *   跳成另一个排版（数字滚动最刺眼的就是**最后一个字的排版突变**）。
 */
export function formatResBarCountText(base: IResBarCountText, value: number): string {
    const target = Number.isFinite(value) ? Math.round(value) : 0;
    return `${target}${base.suffix}`;
}

/**
 * 滚动到 `ratio` 时的数值：`from → to` 之间按 `ratio` 线性插值后取整。
 *
 * `from > to`（数据先回落再涨，例如换角色）也能用 —— 不夹方向，只夹 `ratio`。
 */
export function resBarCountValue(from: number, to: number, ratio: number): number {
    const start = Number.isFinite(from) ? from : 0;
    const end = Number.isFinite(to) ? to : 0;
    return Math.round(start + (end - start) * clamp01(ratio));
}
