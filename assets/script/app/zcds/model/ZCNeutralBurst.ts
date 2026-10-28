/**
 * 对局棋盘「中立资源奖励」的**格心喷发**曲线（纯函数、零 `cc`）。
 *
 * 需求（2026-10-26 截图）：「点击地块后，资源奖励**粒子喷发**的动画丢失了，重新找回实现，
 * 喷射对应的粒子资源的动画」—— 点开出金币堆 / 宝箱那一格，**从格心喷出一束金币**，
 * 「+N」读数在这一束的**上方 40px**。
 *
 * ## 与领地喷发为什么是两套文件但同一套口径
 *
 * 隔壁 `app/territory/model/TerritoryResourceGain.ts` 已经有一整套验收过的手感
 * （12 颗 / 错峰 0.025s / 出射 ±26° 倒锥 / 初速 650±12% / 重力 1500 / 抛物线 /
 *  icon 自身上下翻面 / 落回台面 0.12s 淡出不穿模），这条和它对局**共用同一套蜂窝几何**
 * （`core/hex/HexGridLayout`：格面 123×90、`HEX_GRID_CONTENT_LIFT = 12.5`），
 * 所以物理量直接**对齐取值**，玩家在两张图上看到的是同一种喷法。
 *
 * ⚠️ 不复用的那个文件本身：`app/zcds` 不许 import `app/territory`（跨 feature 依赖）。
 *    同一个 jetzt 曲线抄一份是**有意的重复**，别去合并。
 *
 * ## 本文件负责哪半句
 *
 *  · 「喷发多个图标」「倒圆锥」「喷发坐标点」「翻面」「落地淡出」 → `zcNeutralBurstLaunch`
 *    / `zcNeutralBurstParticle`（**相对喷发原点的偏移**，不碰任何世界坐标）；
 *  · 「图标和数字 ui …上方间隔 40px」                          → `zcNeutralBurstLabelFrame`
 *    （另一条时间线；`ZC_NEUTRAL_BURST_LABEL_LIFT_PX = 40` 由 view 加在原点上）。
 *
 * ⚠️ 轨迹一律用**解析式** `y = vy·t − ½·g·t²`，不要写成逐帧累加：两者数学上等价，
 *    但累加的落点会随帧率变（30fps 两帧 ≠ 60fps 四帧），违反 AGENTS.md
 *    「动画一律记录 startedAt + 纯函数算进度」这条全局约束。
 *
 * ⚠️ 抖动**不用 `Math.random()`**：同一 `(seed, index)` 必须恒等，否则倒锥判据没法验、
 *    池化复用的问题也没法复现。「每次领取不一样」由调用方每发一次奖换一个 seed 提供
 *    （`ZCNeutralRewardFx` 用事件 id）。
 */

/** 一次喷发吐出多少枚金币（截图口径：一束十来枚；与领地满喷同数）。 */
export const ZC_NEUTRAL_BURST_COUNT = 12;

/**
 * 倒锥的**半顶角**（度）：出射方向与屏幕竖直轴的夹角上限。
 *
 *  ⚠️ 改这个值会同步改变 `|vx| / vy ≤ tan(半顶角)` 与水平包络 `2·tan·apex` 两条判据 ——
 *  单测读的就是这个常量算 tan，别在测试里另抄一个角度。
 */
export const ZC_NEUTRAL_BURST_HALF_ANGLE_DEG = 26;

/** 初速度（px/s）。 */
export const ZC_NEUTRAL_BURST_SPEED = 650;

/** 初速度的随机幅度（±12%）—— 不加抖动的话 12 条轨迹会叠成一束。 */
export const ZC_NEUTRAL_BURST_SPEED_JITTER = 0.12;

/** 重力加速度（px/s²）：抛物线靠它把粒子拉回来。 */
export const ZC_NEUTRAL_BURST_GRAVITY = 1500;

/**
 * 相邻两枚粒子的出发间隔（秒）。
 *
 *  12 枚 × 0.025s = 0.275s 铺开 ⇒ **绝不会同一帧全部生成**（一帧才 16ms）。
 */
export const ZC_NEUTRAL_BURST_STAGGER_SECONDS = 0.025;

/** 单枚粒子的存活时长基准（秒）。 */
export const ZC_NEUTRAL_BURST_LIFE_SECONDS = 1.1;

/** 存活时长的随机幅度（±15%）。 */
export const ZC_NEUTRAL_BURST_LIFE_JITTER = 0.15;

/** 生命末段淡出时长（秒）——**没落回地面**的那几枚走这条。 */
export const ZC_NEUTRAL_BURST_FADE_SECONDS = 0.25;

/** 落回地块表面后的快速淡出时长（秒）：从这一刻起 `offsetY` 冻在 0，不穿模。 */
export const ZC_NEUTRAL_BURST_SURFACE_FADE_SECONDS = 0.12;

/** 基础缩放的基准值（`1` = icon 的设计边长）与随机幅度 ⇒ 实际 0.8 ~ 1.2。 */
export const ZC_NEUTRAL_BURST_BASE_SCALE = 1;
export const ZC_NEUTRAL_BURST_SCALE_JITTER = 0.2;

/** 翻面频率区间（次/秒）：每枚落在这个区间里的随机值，12 枚不会同步翻。 */
export const ZC_NEUTRAL_BURST_FLIP_MIN_HZ = 2;
export const ZC_NEUTRAL_BURST_FLIP_MAX_HZ = 4;

/**
 * 整次喷发的**上限**时长（秒）= 最后一枚的出发时刻 + 它可能达到的最长生命。
 *
 *  只是给视图 / 队列兜底用的硬上限（防止脏数据让某枚永不消失）；实际收尾更早 ——
 *  绝大多数粒子在 ~0.8s 就落回台面淡掉了。
 */
export const ZC_NEUTRAL_BURST_TOTAL_SECONDS = (ZC_NEUTRAL_BURST_COUNT - 1) * ZC_NEUTRAL_BURST_STAGGER_SECONDS
    + ZC_NEUTRAL_BURST_LIFE_SECONDS * (1 + ZC_NEUTRAL_BURST_LIFE_JITTER);

/** 「+N」读数起点相对**喷发原点**的抬升（像素）—— 需求原话「上方间隔 40px」。 */
export const ZC_NEUTRAL_BURST_LABEL_LIFT_PX = 40;

/** 「+N」在这 40px 之上再往上飘的距离（像素，与领地读数同值）。 */
export const ZC_NEUTRAL_BURST_LABEL_RISE_PX = 96;

/** 「+N」读数的总时长（秒）。 */
export const ZC_NEUTRAL_BURST_LABEL_SECONDS = 1.15;

/** 入场段占读数的比例：这段里 `0.6 → 1.18` 弹出，之后回落并淡出。 */
export const ZC_NEUTRAL_BURST_LABEL_ENTRANCE_RATIO = 0.32;
export const ZC_NEUTRAL_BURST_LABEL_POP_SCALE = 1.18;
export const ZC_NEUTRAL_BURST_LABEL_FROM_SCALE = 0.6;

/** 按**本次粒子数**算整喷上限（粒子少 ⇒ 错峰铺开的尾巴也短）。 */
export function zcNeutralBurstTotalSeconds(count: number = ZC_NEUTRAL_BURST_COUNT): number {
    const safe = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : ZC_NEUTRAL_BURST_COUNT;
    return (safe - 1) * ZC_NEUTRAL_BURST_STAGGER_SECONDS
        + ZC_NEUTRAL_BURST_LIFE_SECONDS * (1 + ZC_NEUTRAL_BURST_LIFE_JITTER);
}

/**
 * 确定性哈希 → `[0, 1)`：给「同一 index 每次喷发长得不一样」的抖动取值用。
 *
 *  为什么不用 `Math.random()`：同一 `(seed, index)` 必须给出**同一个**偏移，
 *  否则单测无法验证倒锥判据，池化复用也无法复现问题。视觉上的「随机」由调用方
 *  **每次喷发换一个 seed** 提供。
 */
function burstNoise(seed: number, index: number, salt: number): number {
    let h = Math.imul(seed | 0, 0x27d4eb2d)
        ^ Math.imul(index + 1, 0x9e3779b1)
        ^ Math.imul(salt + 1, 0x85ebca6b);
    h = (h ^ (h >>> 15)) | 0;
    h = Math.imul(h, 0x2545f491);
    h = (h ^ (h >>> 13)) | 0;
    return (h >>> 0) / 4294967296;
}

function easeOutCubic(t: number): number {
    const p = Math.min(1, Math.max(0, t));
    return 1 - (1 - p) * (1 - p) * (1 - p);
}

/** 单枚粒子的**出射参数**（一次喷发内恒定，逐帧只需要时间）。 */
export interface IZCNeutralBurstLaunch {
    /** 出射方向相对屏幕竖直轴的偏角（弧度，右正左负），`|phi| ≤ 半顶角`。 */
    readonly phi: number;
    /** 初速度（px/s，含 ±12% 抖动）。 */
    readonly speed: number;
    /** 初速度的横向分量（px/s）。 */
    readonly vx: number;
    /** 初速度的纵向分量（px/s，向上为正）。 */
    readonly vy: number;
    /** 基础缩放（`1` = icon 设计边长）；翻面只在这上面给 `y` 乘余弦。 */
    readonly baseScale: number;
    /** 翻面频率（次/秒，2~4）。 */
    readonly flipHz: number;
    /** 翻面初始相位（弧度，0~2π）—— 每枚不同，避免 12 枚同步翻面。 */
    readonly phase: number;
    /** 这一枚的存活时长（秒，1.1 ±15%）。 */
    readonly life: number;
}

/**
 * 第 `index` 枚粒子的出射参数（确定性：同一 `(seed, index)` 恒等）。
 *
 *  `index` 越界 / 非整数 ⇒ `null`（视图按满喷预建节点，多出来的槽位就该「不存在」）。
 */
export function zcNeutralBurstLaunch(
    seed: number,
    index: number,
    count: number = ZC_NEUTRAL_BURST_COUNT,
): IZCNeutralBurstLaunch | null {
    if (!Number.isInteger(index) || index < 0 || index >= count) return null;
    const halfAngle = (ZC_NEUTRAL_BURST_HALF_ANGLE_DEG * Math.PI) / 180;
    // 需求原式：`phi = random(-1, 1) * coneHalfAngle`
    const phi = (burstNoise(seed, index, 0) * 2 - 1) * halfAngle;
    const speed = ZC_NEUTRAL_BURST_SPEED
        * (1 + (burstNoise(seed, index, 1) * 2 - 1) * ZC_NEUTRAL_BURST_SPEED_JITTER);
    return {
        phi,
        speed,
        vx: speed * Math.sin(phi),
        vy: speed * Math.cos(phi),
        baseScale: ZC_NEUTRAL_BURST_BASE_SCALE
            * (1 + (burstNoise(seed, index, 2) * 2 - 1) * ZC_NEUTRAL_BURST_SCALE_JITTER),
        flipHz: ZC_NEUTRAL_BURST_FLIP_MIN_HZ
            + burstNoise(seed, index, 3) * (ZC_NEUTRAL_BURST_FLIP_MAX_HZ - ZC_NEUTRAL_BURST_FLIP_MIN_HZ),
        phase: burstNoise(seed, index, 4) * Math.PI * 2,
        life: ZC_NEUTRAL_BURST_LIFE_SECONDS
            * (1 + (burstNoise(seed, index, 5) * 2 - 1) * ZC_NEUTRAL_BURST_LIFE_JITTER),
    };
}

/** 单枚粒子在某一时刻的表现参数（全部**相对喷发原点**）。 */
export interface IZCNeutralBurstParticle {
    /** 相对喷发原点的横向偏移（像素）。 */
    readonly offsetX: number;
    /** 相对喷发原点的纵向偏移（像素，向上为正；落回台面后恒 0）。 */
    readonly offsetY: number;
    /** 横向缩放（**恒**等于基础缩放 —— 翻面不许影响宽度）。 */
    readonly scaleX: number;
    /** 纵向缩放 = `基础缩放 · cos(ωt + 相位)`；过零即「侧立最窄」，负值即「翻到背面」。 */
    readonly scaleY: number;
    /** 0 → 1（每枚各自淡出）。 */
    readonly opacity: number;
}

/**
 * 第 `index` 枚粒子喷发到第 `elapsed` 秒时的表现参数；`null` = 这一帧它不该出现
 * （**还没出发**、或**已经消失**）。
 *
 *  ## 轨迹
 *
 *  从喷发原点按 `(vx, vy)` 抛出，只受重力 ⇒ `x = vx·t`、`y = vy·t − ½·g·t²`。
 *  顶点在 `t = vy / g`，落回原高度在 `t = 2·vy / g`。
 *
 *  ## 什么时候收
 *
 *  两条终止条件取**先到的那条**：
 *   · 落回台面（`t ≥ 2·vy / g` 且比 `life` 早）⇒ 从落点起 `SURFACE_FADE_SECONDS(0.12)` 淡出，
 *     期间位置**冻在落点**（既不会穿进地块，也不会读成「贴地滑一段」）；
 *   · 生命到期（更早的那少数）⇒ 最后 `FADE_SECONDS(0.25)` 淡出。
 *
 *  ## 边界
 *
 *  `index` 不是 `[0, count)` 里的整数、`elapsed` 非有限或为负 ⇒ `null`。
 */
export function zcNeutralBurstParticle(
    seed: number,
    index: number,
    elapsed: number,
    count: number = ZC_NEUTRAL_BURST_COUNT,
): IZCNeutralBurstParticle | null {
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;
    const launch = zcNeutralBurstLaunch(seed, index, count);
    if (!launch) return null;

    const local = elapsed - index * ZC_NEUTRAL_BURST_STAGGER_SECONDS;
    if (local < 0) return null;

    const gravity = ZC_NEUTRAL_BURST_GRAVITY;
    const surfaceTime = (2 * launch.vy) / gravity;
    const reachesSurface = surfaceTime < launch.life;
    const fadeStart = reachesSurface ? surfaceTime : launch.life - ZC_NEUTRAL_BURST_FADE_SECONDS;
    const endTime = reachesSurface ? surfaceTime + ZC_NEUTRAL_BURST_SURFACE_FADE_SECONDS : launch.life;
    if (local >= endTime) return null;

    // 落地之后**位置冻住**（`flightTime` 夹到落点那一刻）：只淡出、不再横滑。
    const flightTime = Math.min(local, surfaceTime);
    const rawY = launch.vy * flightTime - 0.5 * gravity * flightTime * flightTime;
    const span = Math.max(1e-6, endTime - fadeStart);
    const opacity = local <= fadeStart ? 1 : 1 - (local - fadeStart) / span;
    // 翻面：`scaleY = baseScale · cos(ωt + phase)`，`scaleX` 始终 `baseScale`。
    const flip = launch.flipHz * Math.PI * 2 * local + launch.phase;
    return {
        offsetX: launch.vx * flightTime,
        offsetY: Math.max(0, rawY),
        scaleX: launch.baseScale,
        scaleY: launch.baseScale * Math.cos(flip),
        opacity: Math.max(0, Math.min(1, opacity)),
    };
}

/** 「+N」读数在某一时刻的表现参数（相对「原点上方 40px」那个起点）。 */
export interface IZCNeutralBurstLabel {
    /** 相对读数起点的纵向位移（像素，向上为正）。 */
    readonly offsetY: number;
    readonly scale: number;
    /** 0 → 1（淡出用）。 */
    readonly opacity: number;
}

/**
 * 「+N」读数播到第 `elapsed` 秒时的表现参数；`null` = 已播完（该收了）。
 *
 *  位移用**整条**的 easeOutCubic（快起慢收，收尾几乎悬停，数字看得清）；
 *  入场段 `0.6 → 1.18` 弹出，之后回落到 1 并淡出。
 *
 *  ⚠️ 这条时间线与喷发**同时开始**（不是等最后一枚落地才开始）—— 需求原话是
 *    「图标和数字 ui 增加上移的动画」，两者是同一次反馈的两个部分。
 */
export function zcNeutralBurstLabelFrame(elapsed: number): IZCNeutralBurstLabel | null {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= ZC_NEUTRAL_BURST_LABEL_SECONDS) return null;
    const progress = elapsed / ZC_NEUTRAL_BURST_LABEL_SECONDS;
    const offsetY = ZC_NEUTRAL_BURST_LABEL_RISE_PX * easeOutCubic(progress);
    if (progress < ZC_NEUTRAL_BURST_LABEL_ENTRANCE_RATIO) {
        const entrance = easeOutCubic(progress / ZC_NEUTRAL_BURST_LABEL_ENTRANCE_RATIO);
        const scale = ZC_NEUTRAL_BURST_LABEL_FROM_SCALE
            + (ZC_NEUTRAL_BURST_LABEL_POP_SCALE - ZC_NEUTRAL_BURST_LABEL_FROM_SCALE) * entrance;
        return { offsetY, scale, opacity: 1 };
    }
    const fade = (progress - ZC_NEUTRAL_BURST_LABEL_ENTRANCE_RATIO) / (1 - ZC_NEUTRAL_BURST_LABEL_ENTRANCE_RATIO);
    const scale = ZC_NEUTRAL_BURST_LABEL_POP_SCALE
        + (1 - ZC_NEUTRAL_BURST_LABEL_POP_SCALE) * easeOutCubic(fade);
    return { offsetY, scale, opacity: 1 - fade * fade };
}
