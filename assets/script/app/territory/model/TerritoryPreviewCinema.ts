/**
 * 预告首领关的镜头与披露时间轴（纯函数，零 cc）。
 *
 * 第 1 关地块动画结束后推镜到首领建筑，居中后放开被压住的格，
 * 让云散、地块生成、虚影与锁同时开演，停留 1s 再归位。
 * 本模块只控制放开时机与镜头位置，具体动画仍由原有系统执行。
 */

export const TERRITORY_PREVIEW_CINEMA = {
    /** 推镜时长。 */
    panSeconds: 0.55,
    /** 放开后的动画窗口。 */
    revealSeconds: 0.6,
    /** 动画结束停留时长。 */
    holdSeconds: 1.0,
    /** 镜头归位时长。 */
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
