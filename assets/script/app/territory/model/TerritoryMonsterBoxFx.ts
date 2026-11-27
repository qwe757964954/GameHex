/**
 * 「巡逻宝箱」面板的两条数字反馈时间轴 —— 成功率滚动、奖励数字刷光。
 *
 * ## 为什么单独一条文件
 *
 * 面板的 `update()` 每帧都在写节点（摇奖姿态 / 成功率 / 光带），曲线如果散在视图里，
 * 「变快了」「变慢了」就变成改魔数。这里与 `TerritoryMonsterBoxRoll` 同一套约定：
 * **零 `cc` 依赖的纯函数 + 有用例**，视图只负责把返回值写进 `Label.string` / 节点坐标。
 *
 * ## 两条时间轴各自的节奏
 *
 * 1. **成功率滚动**（{@link monsterBoxRateRollAt}）：`90 → 60` 不是直接跳数，而是从旧值
 *    滚到新值；曲线 `outCubic`（先快后慢）—— 起手要立刻看出「在动」，收尾要稳得住，
 *    否则最后几帧的数字变化太小，读作「卡了一下才停」。同时给 Label 一点点弹
 *    （{@link monsterBoxRatePunchAt}），否则纯数字滚动在小字号上几乎看不出来。
 *
 * 2. **奖励数字刷光**（{@link monsterBoxShineProgressAt} 一族）：一条白色光带扫过数字框。
 *    位移用**缓进快出**（{@link monsterBoxShineSweepAt}，`>1` 的幂）—— 先在框口慢慢拱进来、
 *    后段猛地甩出去；亮度包络（{@link monsterBoxShineAlphaAt}）**不吃**这条曲线，按线性时间
 *    两端各淡 22%，否则「快出」会把淡出压成几十毫秒，看着像被硬切断。
 *    这一对函数的形状与卡牌升级页（`card/CardUpgradedTimeline.ts`）同源，刻意复制而不是 import：
 *    territory 不该为了一个包络把整个 card 模块拖进依赖。
 *
 * ## 尺寸口径（用户 11-25 原话：「刷光特效的大小要匹配数字UI大小」）
 *
 * 光带的宽高**全部由目标 Label 的 `UITransform` 反算**（{@link monsterBoxShineBandOf}），
 * 不是写死像素：商店卡上的数字框和奖励格上的数字框一样大，写死一个值必然有一边过大。
 * 行程（{@link monsterBoxShineXAt}）也按同一个宽度算，带子才能「从框外扫到框外」。
 */

/** 面板数字反馈的全部可调常量（改观感只动这里，别在视图里写魔数）。 */
export const TERRITORY_MONSTER_BOX_FX = {
    /** 成功率从旧值滚到新值的时长（秒）。 */
    rateRollSeconds: 0.36,
    /** 滚动期间 Label 的最大放大倍数（1 = 不弹）。 */
    ratePunchPeak: 1.12,
    /** 这一弹的时长（秒）；超过就恒为 1。 */
    ratePunchSeconds: 0.34,

    /** 一条光带从框外扫到框外用的时间（秒）。 */
    shineSeconds: 0.46,
    /** 亮度包络进出各占的比例（占整段扫过的比例）。 */
    shineFade: 0.22,
    /** 位移的节奏指数：`>1` ⇒ 缓进快出。 */
    shineSweepEase: 1.7,
    /** 光带宽度 = 数字框宽 × 这个比例（太宽就不像「一条带子」，像整块闪一下）。 */
    shineBandWidthRatio: 0.34,
    /** 光带高度 = 数字框高 × 这个比例（贴图竖向没渐变，撑太高会露出矩形的硬边）。 */
    shineBandHeightRatio: 1.35,
    /** 光带倾斜角（度）：斜着扫比竖直一道更像反光。 */
    shineAngleDeg: 18,
    /** 光带峰值不透明度（0..1）；满 1 会把数字糊掉。 */
    shinePeakAlpha: 0.85,
    /** 行程在数字框两端各多伸出去多少（逻辑 px），保证「从框外进来、出到框外」。 */
    shineBleedPx: 18,
    /** 光带最小宽度：数字框很窄（一个 `3`）时别细成一条线。 */
    shineMinBandWidthPx: 18,

    /**
     * 「升级成功」字特效（spine `shengji`）的时长（秒）。
     *
     * 素材实测 1.07s（`shengduan.skel` 三条动画都是 1.07s），末尾留 0.05s 让最后一帧
     * 落地再收节点。这个值只用来「到点把字收起来」——起播不靠它，靠 `setAnimation(..., false)`。
     */
    upgradeFxSeconds: 1.12,
} as const;

/** `0..1` 收敛。 */
function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 先快后慢（`outCubic`）：滚动数字的收尾靠它稳住。 */
function outCubic(t: number): number {
    const p = 1 - clamp01(t);
    return 1 - p * p * p;
}

/**
 * 成功率滚动：`elapsed` 秒后该显示哪个整数百分比。
 *
 * 起止值都按整数处理（界面永远是 `60%` 这种整数），到时长直接返回 `to`，
 * 不留「99.6 被 round 成 100 但实际是 99」这种尾巴。
 */
export function monsterBoxRateRollAt(from: number, to: number, elapsed: number): number {
    const start = Math.round(Number(from) || 0);
    const end = Math.round(Number(to) || 0);
    const { rateRollSeconds } = TERRITORY_MONSTER_BOX_FX;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return start;
    if (elapsed >= rateRollSeconds) return end;
    return Math.round(start + (end - start) * outCubic(elapsed / rateRollSeconds));
}

/**
 * 滚动期间的 Label 缩放：`1 → ratePunchPeak → 1`，到 `ratePunchSeconds` 恒为 1。
 *
 * 用 `sin(πt)` 而不是「放大再线性收回」：两端导数都是 0，收尾不会「啪」地停住。
 */
export function monsterBoxRatePunchAt(elapsed: number): number {
    const { ratePunchPeak, ratePunchSeconds } = TERRITORY_MONSTER_BOX_FX;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 1;
    if (elapsed >= ratePunchSeconds) return 1;
    return 1 + (ratePunchPeak - 1) * Math.sin(Math.PI * (elapsed / ratePunchSeconds));
}

/**
 * 刷光进度：`0..1`；返回 `-1` 表示此刻不该有光带（还没开始 / 已经扫完）。
 *
 * `-1` 就是调用方的「收工信号」——不要另设一个 `finished` 布尔，
 * 两处判断迟早会不一致（一处收工、一处还在写透明度）。
 */
export function monsterBoxShineProgressAt(elapsed: number): number {
    const { shineSeconds } = TERRITORY_MONSTER_BOX_FX;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= shineSeconds) return -1;
    return elapsed / shineSeconds;
}

/** 线性扫过进度 → 位移进度（缓进快出）。`0→0`、`1→1`，越界收敛。 */
export function monsterBoxShineSweepAt(progress: number): number {
    if (progress < 0) return 0;
    return Math.pow(clamp01(progress), TERRITORY_MONSTER_BOX_FX.shineSweepEase);
}

/** 亮度系数（0..1）：梯形包络，两端各淡 `shineFade`；`progress < 0` 恒为 0。 */
export function monsterBoxShineAlphaAt(progress: number): number {
    if (progress < 0) return 0;
    const p = clamp01(progress);
    const fade = TERRITORY_MONSTER_BOX_FX.shineFade;
    return Math.min(clamp01(p / fade), clamp01((1 - p) / fade));
}

/**
 * 光带中心相对数字框中心的 x：从框左外扫到框右外。
 *
 * 行程 = 框宽 + 带宽 + 两侧出血，所以 `progress = 0` 时整条带子还在框外，
 * `progress = 1` 时已经走干净 —— 中间任何一帧都看不到「凭空出现在框里」。
 */
export function monsterBoxShineXAt(progress: number, labelWidth: number, bandWidth: number): number {
    const width = Math.max(0, Number(labelWidth) || 0);
    const band = Math.max(0, Number(bandWidth) || 0);
    const travel = width + band + TERRITORY_MONSTER_BOX_FX.shineBleedPx * 2;
    return -travel / 2 + travel * monsterBoxShineSweepAt(progress);
}

/**
 * 光带尺寸：按目标数字框反算（宽取比例值，高取框高再放大一点）。
 *
 * 返回可 `setContentSize` 的宽高；框量不到（`0` / `NaN`）时给一个最小可见尺寸，
 * 让「尺寸读不出来」退化成「小一点的光带」而不是「没有光带」。
 */
export function monsterBoxShineBandOf(labelWidth: number, labelHeight: number): { width: number; height: number } {
    const { shineBandWidthRatio, shineBandHeightRatio, shineMinBandWidthPx } = TERRITORY_MONSTER_BOX_FX;
    const width = Number(labelWidth) > 0 ? Math.max(shineMinBandWidthPx, labelWidth * shineBandWidthRatio) : shineMinBandWidthPx;
    const height = Number(labelHeight) > 0 ? Math.max(12, labelHeight * shineBandHeightRatio) : 24;
    return { width: Math.round(width), height: Math.round(height) };
}
