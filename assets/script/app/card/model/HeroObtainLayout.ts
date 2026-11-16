/**
 * 「获得英雄」全屏展示页的**纯口径**（零 `cc`）：进度语义、缓动与四段时间轴。
 *
 * 节点的尺寸、位置、字体、默认缩放全部由 `HeroObtain.prefab` 配置；
 * 本文件只保留页面实际引用的动画计算，不再维护第二份设计稿几何。
 *
 * ## 坐标口径
 *
 * 动画节点不挂 `cc.Widget`，位移只相对 prefab 中的最终位置做临时偏移；
 * `Stage` 由 Widget 上下左右居中，短屏上下对称溢出，不缩放子节点。
 *
 * ## 四段动画（设计稿只有静止态，时间轴是自拟的）
 *
 * 1. 入场：底图淡入 → 放射光放大淡入 → 标题从上方落下回弹；
 * 2. 卡片展示：英雄从下方浮起 + 淡入 → 影子 → 名牌弹入 → 职业徽标/名字淡入；
 * 3. 光效与进度：进度条底淡入 → 填充从左长满 + 数字同步滚动；
 * 4. 收尾：「点击屏幕继续」淡入（终态与设计稿逐像素一致，不留任何常驻呼吸动画）。
 */

// ============================================================
// 进度语义
// ============================================================

/** 碎片进度 0..1（`current / max`，非法值兜 0）。 */
export function heroObtainFillRatioOf(current: number, max: number): number {
    if (!(max > 0)) return 0;
    const ratio = current / max;
    if (!(ratio > 0)) return 0;
    return ratio > 1 ? 1 : ratio;
}

/** 进度文案 `current/max`（取整、夹住；设计稿是 `53/53`）。 */
export function heroObtainCountTextOf(current: number, max: number): string {
    const upper = Math.max(0, Math.floor(max));
    const value = Math.min(upper, Math.max(0, Math.floor(current)));
    return `${value}/${upper}`;
}

// ============================================================
// 缓动
// ============================================================

function heroObtainClamp01(value: number): number {
    return value <= 0 ? 0 : (value >= 1 ? 1 : value);
}

/** 标准 backOut（末段回弹，t=0 恰为 0、t=1 恰为 1）。 */
function heroObtainEaseOutBack(t: number): number {
    const c1 = 1.70158;
    const p = t - 1;
    return 1 + (c1 + 1) * p * p * p + c1 * p * p;
}

/** 二次缓出。 */
function heroObtainEaseOutQuad(t: number): number {
    const p = 1 - t;
    return 1 - p * p;
}
// ============================================================
// 时间轴
// ============================================================

export const HERO_OBTAIN_TIMELINE = {
    /** 全屏底图淡入。 */
    bg: 0.20,
    /** 放射光放大淡入。 */
    rays: 0.45,
    raysDelay: 0.02,
    /** 标题落下（backOut 回弹）。 */
    title: 0.36,
    titleDelay: 0.08,
    /** 英雄从下方浮起。 */
    hero: 0.50,
    heroDelay: 0.26,
    /** 英雄影子。 */
    shadow: 0.30,
    shadowDelay: 0.52,
    /** 名牌底弹入。 */
    plate: 0.30,
    plateDelay: 0.60,
    /** 职业徽标与名字。 */
    name: 0.22,
    nameDelay: 0.72,
    /** 进度条底。 */
    bar: 0.22,
    barDelay: 0.84,
    /** 进度填充与数字滚动。 */
    fill: 0.55,
    fillDelay: 0.90,
    count: 0.20,
    countDelay: 0.90,
    /** 收尾提示。 */
    hint: 0.24,
    hintDelay: 1.48,
    /** 整段结束（= 落到设计稿静止态）。 */
    total: 1.72,
} as const;

export function heroObtainTotalSeconds(): number {
    return HERO_OBTAIN_TIMELINE.total;
}

function progressOf(elapsed: number, delay: number, duration: number): number {
    return heroObtainClamp01((elapsed - delay) / duration);
}

export function heroObtainBgAlphaOf(elapsed: number): number {
    return progressOf(elapsed, 0, HERO_OBTAIN_TIMELINE.bg);
}

/** 放射光的起始缩放与角度（终态 angle = 0，和设计稿一致）。 */
const HERO_OBTAIN_RAYS_FROM_SCALE = 0.62;
const HERO_OBTAIN_RAYS_FROM_ANGLE = -16;

export interface IHeroObtainRaysVisual {
    readonly alpha: number;
    readonly scale: number;
    readonly angle: number;
}

export function heroObtainRaysVisualOf(elapsed: number): IHeroObtainRaysVisual {
    const progress = progressOf(elapsed, HERO_OBTAIN_TIMELINE.raysDelay, HERO_OBTAIN_TIMELINE.rays);
    if (progress <= 0) return { alpha: 0, scale: HERO_OBTAIN_RAYS_FROM_SCALE, angle: HERO_OBTAIN_RAYS_FROM_ANGLE };
    if (progress >= 1) return { alpha: 1, scale: 1, angle: 0 };
    const eased = heroObtainEaseOutBack(progress);
    return {
        alpha: heroObtainClamp01(progress * 1.4),
        scale: HERO_OBTAIN_RAYS_FROM_SCALE + (1 - HERO_OBTAIN_RAYS_FROM_SCALE) * eased,
        angle: HERO_OBTAIN_RAYS_FROM_ANGLE * (1 - heroObtainEaseOutQuad(progress)),
    };
}

/** 位移量（正 = 起点在最终位置的**下方**，视图写 `y = baseY − rise`）。 */
export interface IHeroObtainRiseVisual {
    readonly alpha: number;
    readonly scale: number;
    readonly rise: number;
}

const HERO_OBTAIN_TITLE_FROM_RISE = -26;
const HERO_OBTAIN_TITLE_FROM_SCALE = 0.88;
const HERO_OBTAIN_HERO_FROM_RISE = 34;
const HERO_OBTAIN_HERO_FROM_SCALE = 0.88;
const HERO_OBTAIN_PLATE_FROM_SCALE = 0.72;

export function heroObtainTitleVisualOf(elapsed: number): IHeroObtainRiseVisual {
    const progress = progressOf(elapsed, HERO_OBTAIN_TIMELINE.titleDelay, HERO_OBTAIN_TIMELINE.title);
    if (progress <= 0) return { alpha: 0, scale: HERO_OBTAIN_TITLE_FROM_SCALE, rise: HERO_OBTAIN_TITLE_FROM_RISE };
    if (progress >= 1) return { alpha: 1, scale: 1, rise: 0 };
    const eased = heroObtainEaseOutBack(progress);
    return {
        alpha: heroObtainClamp01(progress * 2),
        scale: HERO_OBTAIN_TITLE_FROM_SCALE + (1 - HERO_OBTAIN_TITLE_FROM_SCALE) * eased,
        rise: HERO_OBTAIN_TITLE_FROM_RISE * (1 - heroObtainEaseOutQuad(progress)),
    };
}

export function heroObtainHeroVisualOf(elapsed: number): IHeroObtainRiseVisual {
    const progress = progressOf(elapsed, HERO_OBTAIN_TIMELINE.heroDelay, HERO_OBTAIN_TIMELINE.hero);
    if (progress <= 0) return { alpha: 0, scale: HERO_OBTAIN_HERO_FROM_SCALE, rise: HERO_OBTAIN_HERO_FROM_RISE };
    if (progress >= 1) return { alpha: 1, scale: 1, rise: 0 };
    const eased = heroObtainEaseOutBack(progress);
    return {
        alpha: heroObtainClamp01(progress * 2.2),
        scale: HERO_OBTAIN_HERO_FROM_SCALE + (1 - HERO_OBTAIN_HERO_FROM_SCALE) * eased,
        rise: HERO_OBTAIN_HERO_FROM_RISE * (1 - heroObtainEaseOutQuad(progress)),
    };
}

export function heroObtainShadowAlphaOf(elapsed: number): number {
    return progressOf(elapsed, HERO_OBTAIN_TIMELINE.shadowDelay, HERO_OBTAIN_TIMELINE.shadow);
}

export interface IHeroObtainPlateVisual {
    readonly alpha: number;
    readonly scale: number;
}

export function heroObtainPlateVisualOf(elapsed: number): IHeroObtainPlateVisual {
    const progress = progressOf(elapsed, HERO_OBTAIN_TIMELINE.plateDelay, HERO_OBTAIN_TIMELINE.plate);
    if (progress <= 0) return { alpha: 0, scale: HERO_OBTAIN_PLATE_FROM_SCALE };
    if (progress >= 1) return { alpha: 1, scale: 1 };
    return {
        alpha: heroObtainClamp01(progress * 2),
        scale: HERO_OBTAIN_PLATE_FROM_SCALE + (1 - HERO_OBTAIN_PLATE_FROM_SCALE) * heroObtainEaseOutBack(progress),
    };
}

export function heroObtainNameAlphaOf(elapsed: number): number {
    return progressOf(elapsed, HERO_OBTAIN_TIMELINE.nameDelay, HERO_OBTAIN_TIMELINE.name);
}

export interface IHeroObtainBarVisual {
    readonly bgAlpha: number;
    readonly fillRange: number;
    readonly countAlpha: number;
}

/** 进度填充的 0..1 进度（数字滚动与它同步）。 */
function heroObtainFillProgressOf(elapsed: number): number {
    return progressOf(elapsed, HERO_OBTAIN_TIMELINE.fillDelay, HERO_OBTAIN_TIMELINE.fill);
}

export function heroObtainBarVisualOf(elapsed: number): IHeroObtainBarVisual {
    return {
        bgAlpha: progressOf(elapsed, HERO_OBTAIN_TIMELINE.barDelay, HERO_OBTAIN_TIMELINE.bar),
        fillRange: heroObtainFillProgressOf(elapsed),
        countAlpha: progressOf(elapsed, HERO_OBTAIN_TIMELINE.countDelay, HERO_OBTAIN_TIMELINE.count),
    };
}

/**
 * 数字滚动文案：跟随填充进度（二次缓出）从 0 滚到目标值。
 *
 * 设计稿静止态是 `53/53`；`elapsed >= total` 直接返回目标文本，避免浮点尾差把
 * `53` 算成 `52`。
 */
export function heroObtainCountUpOf(elapsed: number, current: number, max: number): string {
    const upper = Math.max(0, Math.floor(max));
    const target = Math.min(upper, Math.max(0, Math.floor(current)));
    const progress = heroObtainFillProgressOf(elapsed);
    if (progress <= 0) return heroObtainCountTextOf(0, max);
    if (progress >= 1) return heroObtainCountTextOf(target, max);
    const eased = heroObtainEaseOutQuad(progress);
    return heroObtainCountTextOf(Math.round(target * eased), max);
}

export function heroObtainHintAlphaOf(elapsed: number): number {
    return progressOf(elapsed, HERO_OBTAIN_TIMELINE.hintDelay, HERO_OBTAIN_TIMELINE.hint);
}
