/**
 * CardUpgradedTimeline — 升级成功弹窗的表现时序（纯函数，零引擎依赖）
 * ------------------------------------------------------------------
 * 需求（2026-11-20）：「增加升级详情界面的 UI 表现动画」，五条按顺序串成一条时间轴：
 *
 *   ① 入场 —— 各块**同时**起播，各自从屏幕的不同方向滑到自己的坐标；
 *   ② 角色升级特效 —— 15 帧序列帧，在立绘落位后播 1 次；
 *   ③ 等级数字 —— 跳一下放大，在放大峰值切成新数字，再回弹；
 *   ④ 进度条刷光 —— 刷光扫过，再从「满格」退到下一级的比例；
 *   ⑤ 属性数值刷光 —— 刷光结束，数值直接切换。
 *
 * **「所有的刷光动画同步」** 是这条需求里唯一的硬约束，所以本文件里
 * **只有一个 `shineProgressAt`**：进度条与左右属性框三条光带共用同一个扫过进度，
 * 视图侧只是把同一个 0→1 映射到各自框内的行程。谁也别再单独算一份。
 *
 * 曲线在这里、写节点在 `CardUpgradedPage`（同 `UIMotion` / `UIMotionPlayer` 的分工）。
 * 不建 `cc.tween`：弹窗节点会进对象池，tween 在回收后还会跑完并写到别人的节点上。
 */

/** 入场：单块从屏外滑到位的时长（全部同时起播，所以只有这一个时长）。 */
export const ENTRANCE_DURATION = 0.55;

/**
 * 入场：所有块统一的滑入**行程**（逻辑 px）。
 *
 * 统一行程才能统一速度（每块起止时刻都相同）；1500 远大于屏宽/屏高的一半 + 块自身尺寸
 * ⇒ 第 0 帧时每一块都完整落在屏幕外，不会有哪块「先露一角」。
 */
export const ENTRANCE_TRAVEL = 1500;

/** 一个入场方向（单位向量，指「初始偏移的方向」；动画过程朝原点收）。 */
export interface IEntranceDirection {
    readonly x: number;
    readonly y: number;
}

/**
 * 入场方向表，下标 = 块序号。
 *
 * 2026-11-20 二改：原来是「从上到下逐块错峰 0.1s」，现在改成**同时入场 + 各自从不同方向进来**
 * （对着设计稿的四条红箭头）：上部整体自上而下、左右属性框各自从左右两侧、增益条自下而上。
 */
export const ENTRANCE_DIRECTIONS: readonly IEntranceDirection[] = [
    { x: 0, y: 1 }, // 0 Header（品质徽章 / 卡名 / 职业）：从屏幕上方
    { x: 0, y: 1 }, // 1 立绘 + 脚下影子：从屏幕上方，与 Header 同拍同向
    { x: 0, y: 1 }, // 2 等级 + 进度条：从屏幕上方
    { x: -1, y: 0 }, // 3 属性左框（生命值一整组）：从屏幕左侧
    { x: 1, y: 0 }, // 4 属性右框（攻击力一整组）：从屏幕右侧
    { x: 0, y: -1 }, // 5 战斗力增益条：从屏幕下方
];

/** 入场块数 = 方向表长度（两者必须一一对应，视图按 index 取方向）。 */
export const ENTRANCE_BLOCK_COUNT = ENTRANCE_DIRECTIONS.length;

/** 立绘所在块的序号：升级特效跟着它落位起播。 */
export const HERO_BLOCK_INDEX = 1;

/** 序列帧：`007-2-run_loop_05..19` 共 15 帧，采样 12fps（与 `.anim` 一致）。 */
export const FX_FRAME_COUNT = 15;
export const FX_SAMPLE = 12;
export const FX_DURATION = FX_FRAME_COUNT / FX_SAMPLE;

/** 立绘落位到特响起播的间隔（给落位留一拍，别在滑行途中炸开）。 */
export const FX_DELAY = 0;

/** 特响起播到等级数字起跳的间隔。 */
export const LEVEL_POP_DELAY = 0.35;
/** 数字放大段（到峰值 = 换数字那一刻）。 */
export const LEVEL_POP_UP = 0.14;
/** 数字回弹段。 */
export const LEVEL_POP_SETTLE = 0.22;
/** 放大峰值倍数。 */
export const LEVEL_POP_SCALE = 1.32;

/** 数字回弹到下一次刷光之间的间隔。 */
export const SHINE_DELAY = 0.14;
/** 一次刷光扫过的时长（两条光带共用）。 */
export const SHINE_DURATION = 0.42;

/**
 * 退格前先在满格上顿一拍。
 *
 * 2026-11-20 加（用户：「满格→退回，加强消耗感」）：换完数值立刻掉下去等于**硬切**，
 * 看不出「这一格刚刚被吃掉」。顿一拍再掉，读作「碎片被抽走」的起手。
 */
export const PROGRESS_HOLD = 0.12;

/**
 * 满格 → 下一级比例的退格时长。
 *
 * 2026-11-20 从 `0.32` 放到 `0.5`：0.32s 太快，退格几乎看不出方向，
 * 观感上像进度条自己在动而不是「被扣掉」。
 */
export const PROGRESS_SETTLE = 0.5;

/** 退格起手时数量文字的那一下弹跳（1 → 峰值 → 1）。 */
export const PROGRESS_POP_SCALE = 1.14;
export const PROGRESS_POP_UP = 0.1;
export const PROGRESS_POP_SETTLE = 0.18;

/** 一条完整时间轴的全部关键节点（单位：秒，从打开算起）。 */
export interface ICardUpgradedSchedule {
    /** 每块的起播时刻（下标 = 块序号）。同时入场 ⇒ 全是 0。 */
    readonly entrance: readonly number[];
    /** 最后一块落位时刻。 */
    readonly entranceEnd: number;
    /** 升级特效起播 / 收工。 */
    readonly fxAt: number;
    readonly fxEnd: number;
    /** 等级数字起跳 / 换字（= 放大峰值）/ 回弹结束。 */
    readonly levelPopAt: number;
    readonly levelSwitchAt: number;
    readonly levelSettleEnd: number;
    /** 刷光扫过的起止（进度条与属性区**同一份**）。 */
    readonly shineStart: number;
    readonly shineEnd: number;
    /** 数值直接切换的时刻（= 刷光结束）；进度条在这里顿一拍后再退格。 */
    readonly valueSwitchAt: number;
    /** 进度条退到下一级比例的时刻。 */
    readonly progressSettleAt: number;
    /** 整条时间轴的终点。 */
    readonly end: number;
}

/**
 * 生成时间轴。
 *
 * 无入参是刻意的：块数、帧数都是设计稿定死的常量，时间轴必须**每次打开都一样**，
 * 不随内容（有没有进度条 / 有没有增益条）伸缩 —— 否则同一次升级里两张卡
 * 的节奏会不同，调过的手感也就不作数了。
 */
export function buildCardUpgradedSchedule(): ICardUpgradedSchedule {
    // 同时入场：五条方向的块全部在第 0 帧起播，入场只剩一个统一的落位时刻。
    const entrance: number[] = [];
    for (let i = 0; i < ENTRANCE_BLOCK_COUNT; i++) entrance.push(0);

    const entranceEnd = round(ENTRANCE_DURATION);
    const fxAt = round(entrance[HERO_BLOCK_INDEX] + ENTRANCE_DURATION + FX_DELAY);
    const fxEnd = round(fxAt + FX_DURATION);
    const levelPopAt = round(fxAt + LEVEL_POP_DELAY);
    const levelSwitchAt = round(levelPopAt + LEVEL_POP_UP);
    const levelSettleEnd = round(levelSwitchAt + LEVEL_POP_SETTLE);
    const shineStart = round(levelSettleEnd + SHINE_DELAY);
    const shineEnd = round(shineStart + SHINE_DURATION);
    const progressSettleAt = round(shineEnd + PROGRESS_HOLD + PROGRESS_SETTLE);

    return {
        entrance,
        entranceEnd,
        fxAt,
        fxEnd,
        levelPopAt,
        levelSwitchAt,
        levelSettleEnd,
        shineStart,
        shineEnd,
        // ⑤ 要求「刷光动画结束，数值直接切换」，④ 的退格也从这一拍开始 —— 同一个时刻。
        valueSwitchAt: shineEnd,
        progressSettleAt,
        end: Math.max(progressSettleAt, fxEnd),
    };
}

// ============================================================
// 采样（视图每帧只读这几个纯函数）
// ============================================================

/**
 * 某一块在 `t` 时刻**还剩多少行程**（逻辑 px，标量）。
 *
 * 方向由 `entranceDirectionAt(blockIndex)` 给，视图侧乘成 (dx, dy) 再叠加到原坐标上 ——
 * 这样「同时入场、各自从不同方向来」只差一张方向表，行程曲线仍然只有一份。
 *
 * 还没到起播时刻的块也返回 `ENTRANCE_TRAVEL`（而不是 0）—— 否则它会先在终点闪一帧、
 * 再跳回屏外重新滑进来。
 */
export function entranceOffsetAt(schedule: ICardUpgradedSchedule, t: number, blockIndex: number): number {
    const start = schedule.entrance[blockIndex];
    if (start === undefined) return 0;
    const p = clamp01((t - start) / ENTRANCE_DURATION);
    return ENTRANCE_TRAVEL * (1 - outCubic(p));
}

/** 某一块的入场方向（单位向量）；序号越界时退回「从上方来」，绝不返回 undefined 让调用方崩。 */
export function entranceDirectionAt(blockIndex: number): IEntranceDirection {
    return ENTRANCE_DIRECTIONS[blockIndex] ?? ENTRANCE_DIRECTIONS[0];
}

/** 等级数字的缩放倍数：1 → 峰值（换字）→ 回弹到 1（带一点过冲）。 */
export function levelScaleAt(schedule: ICardUpgradedSchedule, t: number): number {
    if (t < schedule.levelPopAt) return 1;
    const elapsed = t - schedule.levelPopAt;
    if (elapsed <= LEVEL_POP_UP) {
        return 1 + (LEVEL_POP_SCALE - 1) * outCubic(clamp01(elapsed / LEVEL_POP_UP));
    }
    const p = clamp01((elapsed - LEVEL_POP_UP) / LEVEL_POP_SETTLE);
    return LEVEL_POP_SCALE + (1 - LEVEL_POP_SCALE) * outBack(p);
}

/**
 * 刷光位移的节奏指数（2026-11-20 三改：**缓进快出**）。
 *
 * `>1` ⇒ 起步慢、后段加速收尾：光带先在框口慢慢拱进来，扫到一半后才猛地甩出框。
 * 只用在线性进度上做幂运算，不另起一条时间轴 —— 三条光带仍然共用一个 `0..1`。
 *
 * 亮度包络（{@link shineOpacityAt}）刻意**不**吃这条曲线：它按线性时间走，
 * 两端各留 18% 淡入淡出；否则「快出」会把淡出压到几十毫秒，看着像被硬切断。
 */
export const SHINE_SWEEP_EASE = 1.8;

/** 线性扫过进度 → 位移进度（缓进快出）。0→0、1→1，中间单调加速。 */
export function shineSweepAt(progress: number): number {
    return Math.pow(clamp01(progress), SHINE_SWEEP_EASE);
}

/**
 * 刷光扫过进度：`0..1`；返回 `-1` 表示此刻不该有刷光（还没开始 / 已经结束）。
 *
 * ⚠️ 这是**唯一**一份刷光进度 —— 进度条与左右属性框三条光带都由它驱动，
 * 从结构上保证「所有的刷光动画同步」，不靠两处各写一遍时间。
 * 它给的是**线性**进度；位移要再过一道 {@link shineSweepAt} 才是缓进快出的观感。
 */
export function shineProgressAt(schedule: ICardUpgradedSchedule, t: number): number {
    if (t < schedule.shineStart || t >= schedule.shineEnd) return -1;
    return clamp01((t - schedule.shineStart) / SHINE_DURATION);
}

/** 刷光包络的淡入淡出占比（占整段扫过的比例）。 */
export const SHINE_FADE = 0.18;

/**
 * 刷光强度（0..1）：梯形包络 —— 进出各淡一点，扫过途中恒定。
 *
 * 两端不淡会看到光带「凭空出现在边缘」，中段再淡又会让两条带子亮度对不上。
 */
export function shineOpacityAt(progress: number): number {
    if (progress < 0) return 0;
    const p = clamp01(progress);
    const fadeIn = clamp01(p / SHINE_FADE);
    const fadeOut = clamp01((1 - p) / SHINE_FADE);
    return Math.min(fadeIn, fadeOut);
}

/**
 * 进度条比例：换值那一刻起先顿 `PROGRESS_HOLD`，再用 `PROGRESS_SETTLE` 退到 `to`。
 *
 * `from` 恒为满格（见 `CardUpgradeController` 的 `progressFrom`）——
 * 这一条是「消耗感」的根：掉之前先让玩家看清「原本是满的」。
 */
export function progressRatioAt(
    schedule: ICardUpgradedSchedule,
    t: number,
    from: number,
    to: number,
): number {
    const drainStart = schedule.valueSwitchAt + PROGRESS_HOLD;
    if (t < drainStart) return from;
    const p = clamp01((t - drainStart) / PROGRESS_SETTLE);
    return from + (to - from) * outCubic(p);
}

/**
 * 退格起手时数量文字的那一下弹跳（1 → 峰值 → 1）。
 *
 * 与等级数字的跳动同一个语汇：等级字跳完刷光，刷光完换数量 ——
 * 数字动一下才能把「402 变成 294」这件事推到玩家眼前，否则只看见条在缩短。
 */
export function progressPopScaleAt(schedule: ICardUpgradedSchedule, t: number): number {
    const upEnd = schedule.valueSwitchAt + PROGRESS_POP_UP;
    if (t <= schedule.valueSwitchAt || t >= upEnd + PROGRESS_POP_SETTLE) return 1;
    if (t < upEnd) {
        const p = clamp01((t - schedule.valueSwitchAt) / PROGRESS_POP_UP);
        return 1 + (PROGRESS_POP_SCALE - 1) * outCubic(p);
    }
    const q = clamp01((t - upEnd) / PROGRESS_POP_SETTLE);
    return PROGRESS_POP_SCALE - (PROGRESS_POP_SCALE - 1) * q;
}

// ============================================================
// 缓动（与 `UIMotion` 同口径：只存标识、纯函数算）
// ============================================================

export function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value >= 1 ? 1 : value;
}

export function outCubic(p: number): number {
    const q = 1 - clamp01(p);
    return 1 - q * q * q;
}

/** 带过冲的收尾（终点 1，途中会冲过 1 再回来）。 */
export function outBack(p: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const q = clamp01(p) - 1;
    return 1 + c3 * q * q * q + c1 * q * q;
}

/** 时间轴上的数保留到毫秒，避免 0.30000000000000004 这种值进断言。 */
function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
