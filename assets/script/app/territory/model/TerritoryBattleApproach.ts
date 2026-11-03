/**
 * 「首次解锁关卡 ⇒ 自动进战斗」的**镜头推进**过场（零 cc 纯函数）。
 *
 * 需求（2026-11-02 用户）：「首次解锁关卡自动进入战斗时，镜头推进（类似宝箱第二档奖励的效果），
 * 同时弹出提示条，文案【遭遇敌人，即将开始战斗】」。
 *
 * ## 为什么复用宝箱那套「倍率 + 对焦」
 *
 *  宝箱的镜头是 `TerritoryChestAnimation.territoryChestCameraFx` —— 输出 `{ scale, focus }`，
 *  由 `TerritoryMapView.applyChestCamera(scale, focus, origin)` 落到地图节点上。
 *  这里**同一套语义**：`scale` 是地图放大倍率，`focus` 是「目标格往屏幕中心挪多少」（0→原位，1→正中）。
 *  所以视图那边一行新公式都不用写，只是换一条时间曲线喂同样的两个数。
 *
 * ## 为什么倍率取 1.35
 *
 *  宝箱按奖励总量分三档推镜：`≤50 → 1.08`、`51~500 → 1.35`、`>500 → 2.3`
 *  （{@link TERRITORY_CHEST_CAMERA_ZOOM_MEDIUM} 等）。用户说「类似宝箱第二档」，
 *  那就**取第二档的 1.35**：够看出"镜头凑近这一格"，又不至于把周边全挤出去、
 *  让玩家认不出自己点的是哪块地。
 *
 * ## 时间线（总 1.2s，与页面延迟跳转的那个常量同源）
 *
 *  ```
 *   0 ──0.6s──▶ 1.35 ──保持──▶ 1.0s ──0.2s──▶ 1.0（复位）
 *       easeOutCubic               easeInQuad
 *  ```
 *  · **推入**用 `easeOutCubic`（前快后慢）：与宝箱的推进手感一致，不是匀速推镜；
 *  · **收尾回 1**：过场结束就跳战斗页，但地图节点被放大/平移过，必须在移交前还原 ——
 *    否则页面若晚一帧销毁，会看到画面"啪"地缩回去；也防止带着放大的 content 去算滚动边界
 *    （见 `TerritoryMapView.restoreChestCamera` 的注释）。
 *  · ⚠️ 起点恒为 1（`t = 0` 时 scale = 1 / focus = 0）：点下去那一帧的画面必须与静止时逐像素同大，
 *    不能"点一下突然弹大一圈"（宝箱那边 2026-10-22 修过同一个坑）。
 */

/** 过场总时长（秒）。页面延迟跳战斗用的就是它 —— 两处必须同一个常量。 */
export const TERRITORY_BATTLE_APPROACH_SECONDS = 1.2;
/** 推到位用多久（秒）。 */
export const TERRITORY_BATTLE_APPROACH_IN_SECONDS = 0.6;
/** 推到位后保持到的时刻（秒）；之后开始收。 */
export const TERRITORY_BATTLE_APPROACH_HOLD_UNTIL = 1.0;
/** 收回去用多久（秒）= 总时长 − 保持点。 */
export const TERRITORY_BATTLE_APPROACH_OUT_SECONDS =
    TERRITORY_BATTLE_APPROACH_SECONDS - TERRITORY_BATTLE_APPROACH_HOLD_UNTIL;
/** 推到的倍率 —— 与宝箱**第二档**（中宝箱）同一个值。 */
export const TERRITORY_BATTLE_APPROACH_ZOOM = 1.35;

/** 一帧的镜头状态。`scale` / `focus` 直接喂 `applyChestCamera`。 */
export interface ITerritoryBattleApproachFx {
    readonly scale: number;
    /** 目标格往屏幕中心挪多少：0 = 原位，1 = 正中。 */
    readonly focus: number;
    /** 过场是否已经播完（调用方据此收尾 / 放手跳转）。 */
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
 * 非法入参（`NaN` / 负数）按 `t = 0`（原样、不动镜头）—— 与宝箱那边同一条兜底：
 * 宁可这一帧没推，也不能把 `NaN` 写进节点缩放（那是整张地图消失，且零报错）。
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
    // 对焦 = 推镜进度的归一化（分母是**本次**倍率，与宝箱同一口径）：
    // 推到头 ⇒ focus 1（目标格摆到屏幕正中）；回到底 ⇒ 0（画面回到原位）。
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
 * @param elapsed      进入前奏后过了多久（秒）
 * @param spawnRemaining 视图报的"这一批生成还要多久"（`0` = 没有在播）
 * @param seenSpawn    宽限期内是否**见过**生成在播（见过就必须等它播完）
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
