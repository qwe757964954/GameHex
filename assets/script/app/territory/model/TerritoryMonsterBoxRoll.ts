/**
 * 巡逻宝箱「升级摇奖」的曲线（纯函数、零 `cc`、可在 Node 下单测）。
 *
 * ## 表现口径（用户 2026-11-22 需求）
 *
 * 点「升级宝箱」后，`LevelStars` 的等级星让位给一条进度条：**绿色占比 = 成功率**，
 * 其余是灰底；一根**黄色竖条**在条上来回滑动，最后**停在绿区 = 升级成功、停在灰区 = 升级失败**。
 * 整条动画 **2.2s**（结果由服务端回包决定，见 `ITerritoryMonsterBoxAttempt`）。
 *
 * ## 为什么曲线单独一层
 *
 * 与 `CardUpgradedTimeline` 同一分工：视图只负责把 {@link monsterBoxRollPose} 的输出
 * 写进 `fillRange` / 节点坐标，**一个判据都不在视图里**。这样：
 *
 * - 「停在哪算成功」可以被用例钉住（`target` 必须落在绿区/灰区里）；
 * - 总时长写成三个常量之和，改节奏不用碰视图代码；
 * - 回包迟到时不用改视图逻辑 —— 见下面的「迟到」一条。
 *
 * ## 时间轴
 *
 * ```
 * 0            1.5s         2.0s   2.2s
 * ├─ 来回滚动 ──┼─ 滑向落点 ─┼─ 定格 ─┤
 * ```
 *
 * 滚动段固定 1.5s（`cycleSeconds = 0.75` ⇒ 正好 2 个来回，收在左端），
 * 于是「成功 / 失败」只影响**落点**，不影响时长 —— 玩家无法靠「演得久」猜结果。
 *
 * ## 回包迟到
 *
 * 动画从**点击**开始（玩家立刻看到黄条在动），落点要等回包才知道：
 * `resultAt` 是结果到达的时刻（相对点击）。
 *
 * - 回包在 1.5s 内到（常态）⇒ 总时长恒为 2.2s；
 * - 回包更晚 ⇒ 黄条继续按同一周期来回滚（不跳帧、不停住），到达后再滑 0.5s ⇒ 总时长顺延。
 *
 * 这条兜底是必要的：网络慢时若让黄条停在原地等，画面会「卡住」；若先演结果再改，
 * 会演出一次和真值相反的结论。
 */

/** 摇奖节奏（秒）。三个段之和必须等于 {@link TERRITORY_MONSTER_BOX_ROLL.durationSeconds}。 */
export const TERRITORY_MONSTER_BOX_ROLL = {
    /** 整条动画总时长：**2.2s**（需求口径）。 */
    durationSeconds: 2.2,
    /** 来回滚动的基准时长；回包更晚时按同一周期继续滚。 */
    rollSeconds: 1.5,
    /** 从滚动末位滑到落点。 */
    settleSeconds: 0.5,
    /** 落定后的定格（此段内点阵仍让位，让玩家看清停在哪）。 */
    holdSeconds: 0.2,
    /** 一个来回（左 → 右 → 左）的周期：1.5s / 0.75s = 2 个来回，正好收在左端。 */
    cycleSeconds: 0.75,
    /**
     * 成功落点：绿区（`0 ~ rate`）内 55% 处。
     *
     * 不收在 `rate` 上 —— 贴着绿灰交界停会被看成「差一点失败」，也不收在 0 上
     * （滚动段末尾本来就在左端，看不出「滑过去」的动作）。
     */
    successTargetFactor: 0.55,
} as const;

/** 摇奖阶段。`rolling` 还在来回滚；`settling` 已出结果正在滑向落点；`done` 定格完毕。 */
export type TerritoryMonsterBoxRollPhase = 'rolling' | 'settling' | 'done';

/** 一帧的姿态。 */
export interface ITerritoryMonsterBoxRollPose {
    /** 黄条位置 0~1（0 = 条最左，1 = 条最右）。 */
    readonly marker: number;
    /** 绿色填充比例 = 成功率（0~1）。整段动画里不变 —— 它代表的是概率，不是进度。 */
    readonly fill: number;
    readonly phase: TerritoryMonsterBoxRollPhase;
    /** 是否已经演完（视图据此收尾：点阵回来、按钮解禁）。 */
    readonly finished: boolean;
}

/** 摇奖输入。 */
export interface ITerritoryMonsterBoxRollInput {
    /** 从点击到现在的秒数。 */
    readonly elapsed: number;
    /** 成功率 0~1（面板给的是百分数，调用方自己除 100）。 */
    readonly rate: number;
    /** 回包结果；`null` = 还没回来（继续滚）。 */
    readonly success: boolean | null;
    /** 结果到达的时刻（秒，相对点击）；`null` = 还没回来。 */
    readonly resultAt: number | null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return value >= 1 ? 1 : value;
}

/**
 * 黄条在 `t` 秒时「纯滚动」应在的位置：`0 → 1 → 0` 的正弦往返。
 *
 * 用余弦而不是三角波：两端自然减速，看着像「甩到边上被弹回来」而不是撞墙折返。
 */
export function monsterBoxRollMarkerAt(t: number): number {
    const cycle = TERRITORY_MONSTER_BOX_ROLL.cycleSeconds;
    if (!Number.isFinite(t) || t <= 0) return 0;
    return 0.5 - 0.5 * Math.cos((Math.PI * 2 * t) / cycle);
}

/**
 * 落点：成功必须落在绿区里、失败必须落在灰区里。
 *
 * 成功率取极值时（`0%` / `100%`）另一侧没有宽度，此时退回中线 —— 概率是 0 还报成功
 * 属于服务端与配置不一致，**宁可停在中间让玩家看出「不对劲」，也不能停到不可能的区域去假装合理**。
 */
export function monsterBoxRollTarget(rate: number, success: boolean): number {
    const green = clamp01(rate);
    if (success) return green > 0 ? green * TERRITORY_MONSTER_BOX_ROLL.successTargetFactor : 0.5;
    const gray = 1 - green;
    return gray > 0 ? green + gray * 0.5 : 0.5;
}

/** 结果到达后真正开始滑落的时刻（`max(滚动段, 回包时刻)`）。 */
export function monsterBoxRollSettleStart(resultAt: number | null): number {
    const roll = TERRITORY_MONSTER_BOX_ROLL.rollSeconds;
    if (resultAt === null || !Number.isFinite(resultAt)) return Number.POSITIVE_INFINITY;
    return Math.max(roll, Math.max(0, resultAt));
}

function easeOutCubic(u: number): number {
    const p = clamp01(u);
    return 1 - (1 - p) ** 3;
}

/** 算一帧姿态。视图每帧调一次，只读输入、不改输入。 */
export function monsterBoxRollPose(input: ITerritoryMonsterBoxRollInput): ITerritoryMonsterBoxRollPose {
    const fill = clamp01(input.rate);
    const elapsed = Number.isFinite(input.elapsed) ? Math.max(0, input.elapsed) : 0;
    const { settleSeconds, holdSeconds } = TERRITORY_MONSTER_BOX_ROLL;

    // 回包没到 ⇒ 一直滚（不跳帧、不停住），任何时刻都还是 `rolling`
    if (input.success === null || input.resultAt === null) {
        return { marker: monsterBoxRollMarkerAt(elapsed), fill, phase: 'rolling', finished: false };
    }

    const settleStart = monsterBoxRollSettleStart(input.resultAt);
    if (elapsed < settleStart) {
        return { marker: monsterBoxRollMarkerAt(elapsed), fill, phase: 'rolling', finished: false };
    }

    const target = monsterBoxRollTarget(fill, input.success);
    const settleEnd = settleStart + settleSeconds;
    if (elapsed < settleEnd) {
        const from = monsterBoxRollMarkerAt(settleStart);
        const u = easeOutCubic((elapsed - settleStart) / settleSeconds);
        return { marker: from + (target - from) * u, fill, phase: 'settling', finished: false };
    }

    return {
        marker: target,
        fill,
        phase: elapsed >= settleEnd + holdSeconds ? 'done' : 'settling',
        finished: elapsed >= settleEnd + holdSeconds,
    };
}
