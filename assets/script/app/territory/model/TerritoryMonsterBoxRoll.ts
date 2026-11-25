/**
 * 巡逻宝箱「升级摇奖」的曲线（纯函数、零 `cc`、可在 Node 下单测）。
 *
 * ## 表现口径（用户 2026-11-24 需求，替代 11-22 的进度条方案）
 *
 * 点「升级宝箱」后不再有进度条，改为**在等级星的空槽里演**：
 *
 * 1. 下一个空星槽里出现**星星虚影**，放大缩小 + 明暗呼吸，**一次呼吸从 0.4s 逐渐拉长到 0.83s**
 *    （越接近出结果越慢；11-24 晚用户要求「闪烁频率再快 3 倍」⇒ 原 1.2/2.5 整体 ÷3）；
 * 2. 同时**宝箱原地快速颤动**（±4 逻辑 px 水平 + ±2 垂直跳动 + `1±0.08` 缩放，7Hz），
 *    并**逐渐叠上一层纯白**（越来越白）；
 * 3. 升级成功 ⇒ 换成下一等级的宝箱图，白色**逐渐褪回**；失败 ⇒ 白色褪回、图不变。
 *
 * 两条时间轴各管一件事：**星星呼吸**（0.4~0.83s，越来越慢）与**宝箱颤动**（恒定 7Hz）。
 * 早先让振动挂在呼吸相位上（同频 / 倍频），结果「像慢慢歪」；用户要的是原地急抖 ⇒ 解耦。
 *
 * ## 为什么曲线单独一层
 *
 * 与 `CardUpgradedTimeline` 同一分工：视图只负责把 {@link monsterBoxRollPose} 的输出
 * 写进节点缩放 / 坐标 / 透明度，**一个判据都不在视图里**。这样：
 *
 * - 「呼吸周期到底有没有变慢」「白到什么程度」可以被用例钉住；
 * - 节奏改常量即可，不用碰视图代码；
 * - 回包迟到时不用改视图逻辑 —— 见下面的「迟到」一条。
 *
 * ## 时间轴
 *
 * ```
 * 0 ─────────── settleStart ────── +fade ── +hold
 * ├─ 呼吸 / 颤动 / 变白 0→1 ─┤─ 换图 + 褪白 1→0 ─┼─ 定格 ─┤
 * ```
 *
 * `settleStart = max(minSeconds, resultAt)`：动画**从点击起演**（玩家立刻看到反馈），
 * 落点等回包。回包再快也演满 {@link TERRITORY_MONSTER_BOX_ROLL.minSeconds}（否则一闪而过），
 * 回包迟到就继续呼吸、落点顺延 —— 不停住（观感是卡死）、也不先演结果再改（会演出相反结论）。
 *
 * ## 呼吸周期为什么用「对数积分」而不是 `t / period(t)`
 *
 * 周期在变长，相位必须是 `∫dt/period(t)` 才连续；直接用 `t / period(t)` 会在周期拐点处
 * 让星星「跳一下」。这里让周期从 {@link TERRITORY_MONSTER_BOX_ROLL.pulseFastSeconds} 线性涨到
 * {@link TERRITORY_MONSTER_BOX_ROLL.pulseSlowSeconds}，积分有闭式解 ⇒ 相位单调、连续、可单测。
 */

/** 摇奖节奏（秒）。`minSeconds` 是「最短演满」，`fadeSeconds + holdSeconds` 是落定后的收尾。 */
export const TERRITORY_MONSTER_BOX_ROLL = {
    /** 最短演满：回包秒回也不会一闪而过（需求给的是「闪烁持续 1.2~2.5s」的下界）。 */
    minSeconds: 1.2,
    /**
     * 起手一次呼吸（放大缩小一个来回）的周期。
     *
     * 11-24 晚用户二次改口「星星闪烁频率再快 3 倍」⇒ 原 1.2 / 2.5 整体 ÷3（0.4 / 0.833）。
     * 递增关系不变（越接近出结果越慢），只是整体快了三倍。
     */
    pulseFastSeconds: 0.4,
    /** 到落点前最慢的一次呼吸周期（= 2.5 / 3）。 */
    pulseSlowSeconds: 2.5 / 3,
    /** 周期从「快」线性拉到「慢」所用的时长（同样 ÷3，形状与原来一致）。 */
    pulseRampSeconds: 0.6,
    /** 变白爬满所需时间（与 `minSeconds` 同行：落定那一刻正好最白）。 */
    whitenSeconds: 1.2,
    /**
     * 成功后「顿」住的时长：宝箱已到最白、姿势定住、**还没换图**，顿完才开始变化。
     *
     * 用户口径（11-24 夜）：「升级成功则是纯白色的时候顿 3 帧（可以按照你的判断延长或缩短）
     * 然后，再变化」。3 帧 @60fps 只有 50ms，几乎读不出「停一下」⇒ 取 5 帧（0.08s），
     * 既能让「白到顶」这一拍被看见，又不至于把整段拖慢。**只改这一个常量就能调顿感**。
     */
    successFreezeSeconds: 0.08,
    /** 落定后：成功换图 / 失败的褪白时长。 */
    fadeSeconds: 0.45,
    /**
     * 失败时的收尾时长（比成功的 `fadeSeconds` 更长）。
     *
     * 用户口径：「升级失败节奏逐渐变缓」—— 失败不是「啪」地停，而是相位越走越慢、幅度一起衰减，
     * 像陀螺泄劲。时长太短（0.45s）看不出「变缓」，给 0.65s 才有减速的余地。
     */
    failFadeSeconds: 0.65,
    /** 收尾定格（让玩家看清新宝箱 / 空槽）。 */
    holdSeconds: 0.15,
    /**
     * 宝箱原地颤动的频率（Hz）。
     *
     * 用户口径（11-24 晚）：「原地的抖动，不是明显的左右挪，快速的原地抖动」。
     * 7Hz ⇒ 0.143s 一个来回，60fps 下每周期约 8.6 帧 —— 看得出在「抖」但不糊。
     * **与呼吸解耦**（呼吸 0.4~0.833s）：星星慢闪 + 宝箱急抖是用户要的对比，
     * 但也不能高到 12Hz 以上，否则缩放通道会频闪。
     */
    shakeHz: 7,
    /** 水平抖动幅度（逻辑 px）：4 逻辑 px ≈ 3 屏上 px（×0.76875）——「轻微左右」。 */
    shakeAmplitudeX: 4,
    /** 垂直跳动幅度（逻辑 px）：2 逻辑 ≈ 1.5 屏上 px ——「轻微的跳动/震动」。 */
    shakeAmplitudeY: 2,
    /** 缩放抖动幅度：`1 ± 0.08`（±8%，宝箱约 90px 宽 ⇒ 边缘 ±7px）——「明显的缩放」。 */
    shakeScaleAmplitude: 0.08,
    /**
     * 虚影最小 / 最大缩放：摆幅仍是 ±30%，整体再 ×1.15（用户「大小略大 15%」）。
     * `0.70 × 1.15 = 0.805`、`1.30 × 1.15 = 1.495`。
     */
    ghostMinScale: 0.805,
    ghostMaxScale: 1.495,
    /** 虚影最暗 / 最亮不透明度（0~255）：压在空槽的暗星上，要「虚」才不像已经点亮。 */
    ghostMinOpacity: 35,
    ghostMaxOpacity: 170,
} as const;

/**
 * 摇奖阶段。
 *
 * - `pulsing` 还在呼吸等结果；
 * - `pausing` **只有成功才有**：已经最白，姿势定住的那几帧（还没换图）；
 * - `revealing` 已出结果正在褪白（成功在这一段换图）；
 * - `done` 收尾完毕。
 */
export type TerritoryMonsterBoxRollPhase = 'pulsing' | 'pausing' | 'revealing' | 'done';

/** 一帧的姿态。视图每帧只读它，不自己算时间。 */
export interface ITerritoryMonsterBoxRollPose {
    /** 呼吸 0~1（0 = 虚影最小最暗，1 = 最大最亮）。视图用它驱动虚影的 scale 与 opacity。 */
    readonly pulse: number;
    /** 宝箱水平偏移（逻辑 px）；`0` = 居中。「轻微左右」只有 ±4 逻辑 px。 */
    readonly shakeX: number;
    /** 宝箱垂直偏移（逻辑 px，正 = 上）：轻微跳动，±2 逻辑 px。 */
    readonly shakeY: number;
    /** 宝箱缩放倍率：`1 ± 0.08`，这是「原地抖动」里最显眼的那一路。 */
    readonly shakeScale: number;
    /** 白色叠层不透明度 0~1：爬升 = 越来越白，落定后回落到 0。 */
    readonly whiten: number;
    /** 是否该换成新等级的宝箱图了（成功且已到落点）；视图要保证只切一次。 */
    readonly revealing: boolean;
    readonly phase: TerritoryMonsterBoxRollPhase;
    /** 是否已经演完（视图据此收尾：虚影收起、按钮解禁）。 */
    readonly finished: boolean;
}

/** 摇奖输入。 */
export interface ITerritoryMonsterBoxRollInput {
    /** 从点击到现在的秒数。 */
    readonly elapsed: number;
    /** 回包结果；`null` = 还没回来（继续呼吸）。 */
    readonly success: boolean | null;
    /** 结果到达的时刻（秒，相对点击）；`null` = 还没回来。 */
    readonly resultAt: number | null;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    return value >= 1 ? 1 : value;
}

/** 平滑进出（`0→1` 两端导数为 0，收尾不会「啪」地断开）。 */
function smoothstep(u: number): number {
    const k = clamp01(u);
    return k * k * (3 - 2 * k);
}

/**
 * 累积呼吸相位（单位 = 一个来回）。
 *
 * 前 `pulseRampSeconds` 里周期从 `pulseFast` 线性涨到 `pulseSlow`，之后固定 `pulseSlow`：
 *
 * ```
 * period(t) = p0 + (p1 - p0) * min(t, ramp) / ramp
 * phase(t)  = ∫₀ᵗ dt / period(t)
 * ```
 *
 * 前段积分有闭式解 `ln(1 + k·t/p0) / k`（`k = (p1 - p0) / ramp`）⇒ 相位连续且单调。
 */
export function monsterBoxPulsePhaseAt(t: number): number {
    if (!Number.isFinite(t) || t <= 0) return 0;
    const { pulseFastSeconds: p0, pulseSlowSeconds: p1, pulseRampSeconds: ramp } = TERRITORY_MONSTER_BOX_ROLL;
    const k = (p1 - p0) / ramp;
    const head = Math.min(t, ramp);
    const cycles = Math.log(1 + (k * head) / p0) / k;
    return cycles + Math.max(0, t - ramp) / p1;
}

/** 呼吸值 0~1：`0.5 - 0.5cos` ⇒ 起手最小，一个来回回到最小。 */
export function monsterBoxPulseAt(t: number): number {
    return 0.5 - 0.5 * Math.cos(Math.PI * 2 * monsterBoxPulsePhaseAt(t));
}

/**
 * 宝箱颤动相位（弧度）：`2π · shakeHz · t`。
 *
 * **与呼吸解耦**（不再由 `monsterBoxPulsePhaseAt` 推）：用户 11-24 晚要求「原地快速抖动」，
 * 呼吸已快 3 倍但仍是 0.4~0.83s 一个来回（1.2~2.5Hz），抖动要 7Hz 才有「震」的观感。
 * 两条时间轴各管一件事：星星慢闪、宝箱急抖。
 *
 * 脏输入（NaN / 负数）按 0 处理 ⇒ 起手必然在「归零」姿态，点下去不会跳。
 */
function flutterPhase(t: number): number {
    const safe = Number.isFinite(t) && t > 0 ? t : 0;
    return Math.PI * 2 * TERRITORY_MONSTER_BOX_ROLL.shakeHz * safe;
}

/** 水平抖动（逻辑 px）：±`shakeAmplitudeX`，起手为 0。 */
export function monsterBoxShakeXAt(t: number): number {
    return TERRITORY_MONSTER_BOX_ROLL.shakeAmplitudeX * Math.sin(flutterPhase(t));
}

/** 垂直跳动（逻辑 px，正 = 上）：倍频于水平抖动 ⇒ 走「8」字轨迹，像震不是在平移。 */
export function monsterBoxShakeYAt(t: number): number {
    return TERRITORY_MONSTER_BOX_ROLL.shakeAmplitudeY * Math.sin(2 * flutterPhase(t));
}

/** 缩放倍率：`1 ± shakeScaleAmplitude`，与水平抖动同相、起手恰为 1。 */
export function monsterBoxShakeScaleAt(t: number): number {
    return 1 + TERRITORY_MONSTER_BOX_ROLL.shakeScaleAmplitude * Math.sin(flutterPhase(t));
}

/** 结果到达后真正开始褪白的时刻（`max(最短演满, 回包时刻)`）。 */
export function monsterBoxRollSettleStart(resultAt: number | null): number {
    if (resultAt === null || !Number.isFinite(resultAt)) return Number.POSITIVE_INFINITY;
    return Math.max(TERRITORY_MONSTER_BOX_ROLL.minSeconds, Math.max(0, resultAt));
}

/** 呼吸 + 抖动三路的「常态」姿态（还没落定时每帧的取值；落定后也用它取冻结基准）。 */
function pulsingPoseAt(t: number): { pulse: number; shakeX: number; shakeY: number; shakeScale: number } {
    return {
        pulse: monsterBoxPulseAt(t),
        shakeX: monsterBoxShakeXAt(t),
        shakeY: monsterBoxShakeYAt(t),
        shakeScale: monsterBoxShakeScaleAt(t),
    };
}

/**
 * 算一帧姿态。视图每帧调一次，只读输入、不改输入。
 *
 * - 回包没到 ⇒ 一直 `pulsing`：呼吸照常、抖动照常、白度在 `whitenSeconds` 内爬到 1 后保持；
 * - **成功** ⇒ 先 `pausing`（{@link TERRITORY_MONSTER_BOX_ROLL.successFreezeSeconds} 内
 *   姿势与白度全部定住、图不换）⇒ 再 `revealing`（换图 + 白度 1→0 缓出）；
 * - **失败** ⇒ 直接 `revealing`，但相位被**时间膨胀**拖慢（越走越慢）+ 幅度衰减 ⇒ 节奏逐渐变缓；
 * - 收尾 `holdSeconds` 后 `finished`。
 *
 * 成功 / 失败的「小区分」就是这一条：**成功是顿一下再换，失败是慢慢泄劲**。
 */
export function monsterBoxRollPose(input: ITerritoryMonsterBoxRollInput): ITerritoryMonsterBoxRollPose {
    const elapsed = Number.isFinite(input.elapsed) ? Math.max(0, input.elapsed) : 0;
    const { whitenSeconds, fadeSeconds, successFreezeSeconds, failFadeSeconds, holdSeconds } = TERRITORY_MONSTER_BOX_ROLL;

    const pulsingWhiten = clamp01(elapsed / whitenSeconds);
    const settleStart = monsterBoxRollSettleStart(input.resultAt);

    // 结果没到（或比最短演满更晚）：呼吸 / 抖动不停、白度到顶后保持
    if (input.success === null || !Number.isFinite(settleStart) || elapsed < settleStart) {
        return { ...pulsingPoseAt(elapsed), whiten: pulsingWhiten, revealing: false, phase: 'pulsing', finished: false };
    }

    const success = input.success === true;
    // 成功先顿住（白到顶、图不换），顿完才开始变化；失败没有这一拍
    const freeze = success ? successFreezeSeconds : 0;
    const fade = success ? fadeSeconds : failFadeSeconds;
    const frozen = pulsingPoseAt(settleStart);
    const fadeStart = settleStart + freeze;
    const fadeEnd = fadeStart + fade;
    const endAt = fadeEnd + holdSeconds;

    // ① 成功专属：最白 + 姿势冻结，`revealing` 仍为 false（这一拍绝不换图）
    if (elapsed < fadeStart) {
        return { ...frozen, whiten: 1, revealing: false, phase: 'pausing', finished: false };
    }

    // ② 变化段
    if (elapsed < fadeEnd) {
        const k = clamp01((elapsed - fadeStart) / fade);
        // 1 → 0 的缓出：越接近结束退得越慢（白光「散开」而不是「被人关掉」）
        const release = 1 - smoothstep(k);
        if (success) {
            return {
                pulse: frozen.pulse * release,
                shakeX: frozen.shakeX * release,
                shakeY: frozen.shakeY * release,
                // 缩放要收敛到 1 而不是 0：`1 + (S - 1) · release`
                shakeScale: 1 + (frozen.shakeScale - 1) * release,
                whiten: release,
                revealing: true,
                phase: 'revealing',
                finished: false,
            };
        }
        // 失败：时间膨胀 `x → x - x²/(2·fade)`（速度 ∝ 1 - x/fade，末速为 0）⇒ 相位越走越慢，
        // 再叠上幅度衰减 ⇒ 看着像陀螺泄劲，而不是「被人一把按停」。
        const x = elapsed - settleStart;
        const slow = pulsingPoseAt(settleStart + x - (x * x) / (2 * fade));
        return {
            pulse: slow.pulse * release,
            shakeX: slow.shakeX * release,
            shakeY: slow.shakeY * release,
            shakeScale: 1 + (slow.shakeScale - 1) * release,
            whiten: release,
            revealing: false,
            phase: 'revealing',
            finished: false,
        };
    }

    // ③ 收尾：三路归零、白度到 0；成功保持「已换图」态直到演完
    return {
        pulse: 0,
        shakeX: 0,
        shakeY: 0,
        shakeScale: 1,
        whiten: 0,
        revealing: success,
        phase: elapsed >= endAt ? 'done' : 'revealing',
        finished: elapsed >= endAt,
    };
}
