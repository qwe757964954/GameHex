/**
 * 「预告首领关」的**镜头 + 披露**时间轴（纯函数、零 `cc`）。
 *
 * ## 需求（2026-11-09 用户第二轮）
 *
 * > 1. 通过第 1 关的**地块动画结束**后，镜头移动到 boss 位置、屏幕居中；
 * > 2. 云层消失动画、boss 关卡地块生成动画、建筑虚影和锁**同时**生成动画；
 * > 3. 动画结束**停留 1s**，镜头自动挪回初始位置。
 *
 * 拆成五段（只有 `focus` 与「放开被压住的格」两件事，别的表现全交给原有系统）：
 *
 * | 段 | 时长 | `focus` | 干什么 |
 * | :--- | :--- | :--- | :--- |
 * | `wait` | 调用方给 | 0 | 等**第 1 关那一批**胜利地块长完（`territoryHexSpawnBatchSeconds`） |
 * | `pan` | {@link TERRITORY_PREVIEW_CINEMA.panSeconds} | 0 → 1 | 镜头推到首领建筑格，居中 |
 * | `reveal` | {@link TERRITORY_PREVIEW_CINEMA.revealSeconds} | 1 | **放开被压住的格** ⇒ 云散 / 地块生成 / 虚影 + 锁同时生成 |
 * | `hold` | {@link TERRITORY_PREVIEW_CINEMA.holdSeconds} | 1 | 停 1s（需求原文） |
 * | `back` | {@link TERRITORY_PREVIEW_CINEMA.backSeconds} | 1 → 0 | 镜头自动挪回原位 |
 *
 * ## 🔴 为什么先「压住」再放开
 *
 * 披露是**模型**算的（`territoryPreviewLevels`），它一旦把首领格并进 `revealedCells`，
 * 云会在**同一帧**散掉、地块也在同一帧长出来 —— 镜头还在原位，玩家根本看不到这段动画。
 * 所以视图在这一批格子上挂一个**临时的压住集合**（`previewCinemaHold`）：
 * `wait` / `pan` 期间把这些格从 `revealedCells` / `previewCells` 里剔掉（云照旧盖着、
 * 虚影也不建），`reveal` 段一到就整批放开并重渲染一次 ⇒ 五套原有表现自己就同时开演了。
 *
 * ⇒ 本模块只管「什么时候放开」与「镜头推到哪」，**不重复实现**任何一条动画。
 */

export const TERRITORY_PREVIEW_CINEMA = {
    /** 推镜（原位 → 目标格居中）。0.55s：短到不打断节奏，长到能看出"镜头在走"。 */
    panSeconds: 0.55,
    /** 放开后的动画窗口：云散 0.5s / 地块 0.4s（胜利档 0.62s）/ 虚影 + 锁 0.2s ⇒ 取 0.6s 兜住。 */
    revealSeconds: 0.6,
    /** 需求原文「动画结束停留 1s」。 */
    holdSeconds: 1.0,
    /** 镜头归位。与推镜同长，来回对称。 */
    backSeconds: 0.55,
} as const;

export type TerritoryPreviewCinemaPhase = 'wait' | 'pan' | 'reveal' | 'hold' | 'back' | 'done';

export interface ITerritoryPreviewCinemaState {
    readonly phase: TerritoryPreviewCinemaPhase;
    /** 当前段已经走了多少秒。 */
    readonly elapsed: number;
    /** `wait` 段总时长（= 第 1 关胜利地块那一批的生成时长）。 */
    readonly waitSeconds: number;
}

export interface ITerritoryPreviewCinemaStep {
    readonly state: ITerritoryPreviewCinemaState;
    /** 0 = 镜头在原位，1 = 目标格屏幕居中。 */
    readonly focus: number;
    /** `true` = 该放开被压住的格了（`reveal` 段起为真，之后一直为真）。 */
    readonly revealed: boolean;
    /** `true` = 整条时间轴走完（调用方据此还原镜头、放开输入）。 */
    readonly done: boolean;
}

/** 段序（`wait` → … → `done`），`advance` 靠它推进。 */
const PHASE_ORDER: readonly TerritoryPreviewCinemaPhase[] = ['wait', 'pan', 'reveal', 'hold', 'back', 'done'];

/** 平滑进出（`3t² - 2t³`）：推镜起手与收尾都不生硬，也不像缓动曲线那样"顿"一下。 */
function smoothStep(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * (3 - 2 * x);
}

/** 起一条时间轴；`waitSeconds` = 等第 1 关地块动画播完的时长（≤0 表示不等）。 */
export function territoryPreviewCinema(waitSeconds = 0): ITerritoryPreviewCinemaState {
    const wait = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds : 0;
    return { phase: 'wait', elapsed: 0, waitSeconds: wait };
}

function phaseSeconds(state: ITerritoryPreviewCinemaState, phase: TerritoryPreviewCinemaPhase): number {
    switch (phase) {
        case 'wait': return state.waitSeconds;
        case 'pan': return TERRITORY_PREVIEW_CINEMA.panSeconds;
        case 'reveal': return TERRITORY_PREVIEW_CINEMA.revealSeconds;
        case 'hold': return TERRITORY_PREVIEW_CINEMA.holdSeconds;
        case 'back': return TERRITORY_PREVIEW_CINEMA.backSeconds;
        default: return 0;
    }
}

/**
 * 推进一帧。
 *
 * 用 `while` 逐段扣时间：某一帧 `dt` 特别大（切后台回来 / 低帧率）时能一次跨过好几段，
 * 不会卡在 `wait` 里等一整轮；`focus` 由**当前段 + 段内进度**算，跨段也是连续的。
 */
export function stepTerritoryPreviewCinema(
    state: ITerritoryPreviewCinemaState,
    dt: number,
): ITerritoryPreviewCinemaStep {
    let phase = state.phase;
    let elapsed = state.elapsed + (Number.isFinite(dt) && dt > 0 ? dt : 0);
    for (;;) {
        if (phase === 'done') {
            elapsed = 0;
            break;
        }
        const limit = phaseSeconds(state, phase);
        if (elapsed < limit) break;
        elapsed -= limit;
        phase = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1] ?? 'done';
    }

    let focus = 0;
    if (phase === 'pan') {
        focus = smoothStep(elapsed / TERRITORY_PREVIEW_CINEMA.panSeconds);
    } else if (phase === 'reveal' || phase === 'hold') {
        focus = 1;
    } else if (phase === 'back') {
        focus = 1 - smoothStep(elapsed / TERRITORY_PREVIEW_CINEMA.backSeconds);
    }
    return {
        state: { phase, elapsed, waitSeconds: state.waitSeconds },
        focus,
        revealed: phase !== 'wait' && phase !== 'pan',
        done: phase === 'done',
    };
}
