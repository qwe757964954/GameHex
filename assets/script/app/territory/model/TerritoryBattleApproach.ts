/**
 * 首次解锁关卡自动进战斗时的镜头推进过场（纯函数，零 cc）。
 *
 * 复用宝箱镜头的 `{ scale, focus }` 语义：推入 1.35 倍、目标格向屏幕中心对焦，
 * 保持后在地图移交前复位，避免带着放大的 content 计算滚动边界。
 */

/** 过场总时长（秒），页面延迟跳战斗也用它。 */
export const TERRITORY_BATTLE_APPROACH_SECONDS = 1.2;
/** 推到位用时（秒）。 */
export const TERRITORY_BATTLE_APPROACH_IN_SECONDS = 0.6;
/** 推到位后保持到的时刻（秒）。 */
export const TERRITORY_BATTLE_APPROACH_HOLD_UNTIL = 1.0;
/** 收回去用时（秒）。 */
export const TERRITORY_BATTLE_APPROACH_OUT_SECONDS =
    TERRITORY_BATTLE_APPROACH_SECONDS - TERRITORY_BATTLE_APPROACH_HOLD_UNTIL;
/** 推到的倍率，与宝箱中档一致。 */
export const TERRITORY_BATTLE_APPROACH_ZOOM = 1.35;

/** 一帧的镜头状态。 */
export interface ITerritoryBattleApproachFx {
    readonly scale: number;
    /** 目标格向屏幕中心移动的比例，0 原位、1 正中。 */
    readonly focus: number;
    /** 过场是否已播完。 */
    readonly done: boolean;
}

function easeOutCubic(p: number): number {
    const inv = 1 - p;
    return 1 - inv * inv * inv;
}

function easeInQuad(p: number): number {
    return p * p;
}

/** 把 `elapsed` 夹到 `[0, seconds]` 再取段内进度。 */
function phase(elapsed: number, start: number, seconds: number): number | null {
    if (!Number.isFinite(elapsed) || seconds <= 0 || elapsed < start) return null;
    const p = (elapsed - start) / seconds;
    return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

/**
 * `elapsed` 秒时的镜头状态。
 *
 * 非法入参按起始帧处理，不把 NaN 写入节点缩放。
 */
export function territoryBattleApproachFx(elapsed: number): ITerritoryBattleApproachFx {
    const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    const zoom = TERRITORY_BATTLE_APPROACH_ZOOM;
    const span = zoom - 1;
    let scale = 1;
    if (t < TERRITORY_BATTLE_APPROACH_HOLD_UNTIL) {
        const push = phase(t, 0, TERRITORY_BATTLE_APPROACH_IN_SECONDS);
        scale = push === null ? 1 : 1 + span * easeOutCubic(push);
    } else if (t < TERRITORY_BATTLE_APPROACH_SECONDS) {
        const back = phase(t, TERRITORY_BATTLE_APPROACH_HOLD_UNTIL, TERRITORY_BATTLE_APPROACH_OUT_SECONDS);
        scale = zoom + (1 - zoom) * easeInQuad(back ?? 0);
    }
    // 对焦比例由当前推镜进度归一化得到。
    const focus = span > 1e-6 ? Math.min(1, Math.max(0, (scale - 1) / span)) : 0;
    return { scale, focus, done: t >= TERRITORY_BATTLE_APPROACH_SECONDS };
}

// ===========================================================================
// 「首次触发战斗」的前奏：① 关卡地块生成 → ② 镜头推进 + 提示条 → ③ 云层过场
// ===========================================================================

/**
 * 前奏第一段（地块生成）最多等多久（秒）。
 *
 * 一批格子最坏 `0.3s 错峰 + 0.4s 单格` = 0.7s（见 `TerritoryHexSpawn`）。取 1.2s 是**兜底**：
 * 视图那边真出了状况（生成动画没起播 / 播到一半被销毁），也不能把玩家卡在前奏里。
 */
export const TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS = 1.2;

/**
 * 生成动画还没起播时的宽限（秒）。
 *
 * 时序上有个坑：解锁回包的 `navigate` 命令是在 `runCellWrite` 的 `handle()` 里发的，
 * 而重绘在**之后的** `finally` 里才发生 —— 页面收到命令那一刻，视图里这一批 `hexSpawn`
 * 还没起播，"剩余时长"读出来是 0。所以先宽限几帧再判："一直没起播"= 这一局没有新地块。
 */
export const TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS = 0.12;

/**
 * 推镜播完后再等多久才盖云（秒）。
 *
 * 不能让两段贴死：推镜收尾要在**自己那一帧**把镜头还原（`restoreChestCamera`），
 * 盖云要在**还原之后**量基准。留两三个渲染帧，两条时间轴才不会抢同一个 `MapLayer`。
 */
export const TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS = 0.05;

/**
 * 推镜这一段的时长（秒）= 曲线总长 + 收尾余量。页面按它排"② → ③"。
 */
export const TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS =
    TERRITORY_BATTLE_APPROACH_SECONDS + TERRITORY_BATTLE_PRELUDE_APPROACH_TAIL_SECONDS;

/**
 * 前奏第一段是否可以进第二段。
 *
 * @param elapsed 进入前奏后过了多久（秒）
 * @param spawnRemaining 视图报的"这一批生成还要多久"（`0` = 没有在播）
 * @param seenSpawn 宽限期内是否**见过**生成在播（见过就必须等它播完）
 */
export function territoryBattlePreludeSpawnSettled(
    elapsed: number,
    spawnRemaining: number,
    seenSpawn: boolean,
): boolean {
    const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    if (t >= TERRITORY_BATTLE_PRELUDE_SPAWN_MAX_SECONDS) return true;
    const remaining = Number.isFinite(spawnRemaining) && spawnRemaining > 0 ? spawnRemaining : 0;
    if (seenSpawn) return remaining <= 0;
    // 还没见过生成：宽限期一过就认"这一局没有新地块"，别白等。
    return t >= TERRITORY_BATTLE_PRELUDE_SPAWN_GRACE_SECONDS && remaining <= 0;
}

/**
 * 前奏第二段是否可以进第三段（盖云）。
 *
 * @param elapsed 进入第二段后过了多久（秒）
 * @param approachPlaying 推镜是否还在演（视图那边一帧都没跑完就还得等）
 */
export function territoryBattlePreludeApproachSettled(elapsed: number, approachPlaying: boolean): boolean {
    if (approachPlaying) return false;
    const t = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    return t >= TERRITORY_BATTLE_PRELUDE_APPROACH_SECONDS;
}
