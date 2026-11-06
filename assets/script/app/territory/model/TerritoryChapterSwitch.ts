/**
 * 「章节切换」转场的时间轴（**纯逻辑，零 `cc` 依赖**，供 Node 用例直接 import）。
 *
 * 需求 2026-11-04：
 *
 * > 「增加一个章节的切换动画，镜头快速上移，移动到新章节的位置，将新章节居中，
 * >   玩家只能通过章节按钮播放切换动画，回到已通过的章节」
 *
 * ## 这段演出在做什么
 *
 * 内存里同时只存在**一张**章节地图（`renderMap` 一次只画一章），所以"镜头上移"不能
 * 靠两张图真的纵向排布 —— 那样要同时持有两张图、还要重做坐标换算。这里用四段拼出来：
 *
 * 1. **`lead` 相机先行**（{@link TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS}）：整张地图先
 *    **快速往下走**一下（世界下移 = 镜头上移）—— 云还没出现，玩家先看见"画面被带着
 *    往上走"（2026-11-05 用户：「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」）；
 * 2. **`cover` 合拢**（{@link TERRITORY_CHAPTER_SWITCH_COVER_SECONDS}）：整屏云从画面外
 *    收拢盖住；相机**保持**在 `lead` 走到的位置（不再动，动了会往回弹）；
 * 3. **换图**（在云完全盖住的黑场里）：模型换章 → 新图重建 → `syncGrid` 把地图归位；
 * 4. **`reveal` 揭幕**（{@link TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS}）：新章先被抬到
 *    屏幕上方（{@link territoryChapterSwitchRise}），再**落回居中**，云同时往四周散开。
 *
 * 时长合计 {@link territoryChapterSwitchTotalSeconds}：用户要的是"快速上移"，不是一段
 * 过场剧；玩家点章节按钮只是想换一章看看。
 *
 * ## 为什么"只有玩家点按钮才播"
 * 自动推进（通关后模型自己换章）根本不发 `chapterSwitch` 命令（见 `TerritoryModel.
 * announceChapterSwitch`）⇒ 页面压根不会起这段演出。判据是**事件来源**，不是"猜这次是不是自动"。
 */

/**
 * **相机先行段**的时长（秒）：云还没出来，地图先快速走一下。
 *
 * 2026-11-05 用户口径：「相机先向上快速移动 0.1s 后，云层遮挡动画再开始播放」。
 * 0.1s 是"一瞬间被带走"的体感；再长就变成"镜头慢慢飘"、和后面的落位连成一坨。
 */
export const TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS = 0.1;

/** 云从画面外合拢到盖满的时长（秒）。 */
export const TERRITORY_CHAPTER_SWITCH_COVER_SECONDS = 0.32;

/** 新章从上方落回居中的时长（秒）。 */
export const TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS = 0.58;

/**
 * 「新章起点」的高度 = 视口高度的这个比例。
 *
 * 取 0.45 而不是 1：整屏之外起手会被云挡住、看不出"从上面下来"，只看到"突然出现"；
 * 45% 足够让玩家读出方向，又不至于让落位显得慢。
 */
export const TERRITORY_CHAPTER_SWITCH_RISE_RATIO = 0.45;

/**
 * `lead` 段地图**往下走**的距离 = rise 的这个比例（World 下移 = 镜头上移）。
 *
 * 必须远小于 1：这一段是在"旧图还在、云还没出来"的时候写，走太多会露出内容层的边缘。
 * 25% 刚好够读成"画面被带着往上走"。
 */
export const TERRITORY_CHAPTER_SWITCH_SINK_RATIO = 0.25;

/**
 * 等新章加载的上限（秒）。
 *
 * 云盖着不动的画面是安全的（与整页过场的 `hold` 同一策略），但**不能无限等**：
 * 加载失败时模型会把 `chapterId` 退回旧章，页面靠 {@link TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS}
 * 兜底收场，绝不让云永远盖着。
 */
export const TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS = 6;

/** 整段转场的总时长（秒）—— 不含等加载那一段。 */
export function territoryChapterSwitchTotalSeconds(): number {
    return TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS
        + TERRITORY_CHAPTER_SWITCH_COVER_SECONDS
        + TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS;
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/** 缓出（前快后慢）：合拢 / 落位都用它 —— 起手就明显在动，尾段收住不抖。 */
function easeOut(x: number): number {
    const value = clamp01(x);
    return 1 - (1 - value) * (1 - value);
}

/** 缓入（前慢后快）：旧图被"带"着走，越走越快。 */
function easeIn(x: number): number {
    const value = clamp01(x);
    return value * value;
}

/** `cover` 段进度（0~1）；非法入参按 0。 */
export function territoryChapterSwitchCoverProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01(elapsed / TERRITORY_CHAPTER_SWITCH_COVER_SECONDS);
}

/**
 * `lead`（相机先行）段进度（0~1）；非法入参按 0。
 *
 * 这一段**云还没出来**，只有地图在动 —— 所以它单独计时，不能并到 `cover` 里：
 * 并进去就变成"云一边合拢、镜头一边慢慢走"，与用户要的"先动完再盖"相反。
 */
export function territoryChapterSwitchLeadProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01(elapsed / TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS);
}

/** `reveal` 段进度（0~1）；非法入参按 0。 */
export function territoryChapterSwitchRevealProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01(elapsed / TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS);
}

/**
 * 新章「从上面下来」的总高度（px）。
 *
 * 视口高度拿不到（0 / NaN）时给 `0` ⇒ 只演云、不演位移：
 * 位移算不出来还硬写，会把地图推到一个再也回不来的位置。
 */
export function territoryChapterSwitchRise(viewportHeight: number): number {
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
    return viewportHeight * TERRITORY_CHAPTER_SWITCH_RISE_RATIO;
}

/**
 * `lead` 段走完时整张地图**总共**的 y 偏移（px，负数 = 往下；世界下移 = 镜头上移）。
 *
 * 这一个数是**常量**，`cover` 段每一帧都写它（相机停在这儿不动）：
 * 合拢段再按进度写会从 0 重新算起 ⇒ 画面往回弹一下，读成"走了一下又退回来"。
 */
export function territoryChapterSwitchSinkDistance(rise: number): number {
    const value = Number.isFinite(rise) && rise > 0 ? rise : 0;
    // `-0` 归一成 `0`：`setPosition(-0)` 与 `0` 数值上一样，但用例里 `Object.is` 会判不相等，
    // 而"起点没动"这件事本来就该是干净的 0。
    const offset = -value * TERRITORY_CHAPTER_SWITCH_SINK_RATIO;
    return offset === 0 ? 0 : offset;
}

/**
 * `lead` 段：整张地图的 y 偏移（px，正数 = 往上）。
 *
 * 0 → {@link territoryChapterSwitchSinkDistance}，用 **easeOut**：起手就明显在动、
 * 尾段收住 —— 用户要的是"快速上移"，线性收尾会读成"顿了一下"。
 */
export function territoryChapterSwitchSinkOffset(progress: number, rise: number): number {
    const offset = territoryChapterSwitchSinkDistance(rise) * easeOut(clamp01(progress));
    return offset === 0 ? 0 : offset;
}

/**
 * `reveal` 段：整张地图的 y 偏移（px，正数 = 往上）。
 *
 * 起点 = `+rise`（新章在屏幕上方），终点 = `0`（居中）—— 用户要的「将新章节居中」
 * 就是终点这一帧：`syncGrid` 已经把新图按自己的基准摆好了。
 */
export function territoryChapterSwitchRevealOffset(progress: number, rise: number): number {
    const value = Number.isFinite(rise) && rise > 0 ? rise : 0;
    return value * (1 - easeOut(clamp01(progress)));
}

/**
 * 这一帧要不要开始揭幕：新章已经**画上来**了才允许。
 *
 * 🔴 判据必须是「渲染过的章号 == 目标章」，不是「state.chapterId == 目标章」：
 *   模型在 `loadChapter` 一开头就把 `chapterId` 改了，那时地图还是旧的
 *   （`state.ready` 为假）—— 按 state 判会在旧图上揭幕，玩家看到的是"上移了一下，
 *   还是老地图"。
 */
export function territoryChapterSwitchReadyToReveal(
    renderedChapterId: number,
    targetChapterId: number,
): boolean {
    return renderedChapterId === targetChapterId;
}

/**
 * 这次换章**该不该播转场**。
 *
 * 只有「玩家点了章节按钮」才播（用户原话）。页面通过 `chapterSwitch` 命令拿到这事，
 * 所以这里守的是另一条：**同章 / 非法章号不播**（`from === to` 时既没有位移方向，
 * 也会把云白白合拢一次）。
 */
export function territoryChapterSwitchWanted(fromChapterId: number, toChapterId: number): boolean {
    return Number.isFinite(fromChapterId) && Number.isFinite(toChapterId)
        && fromChapterId > 0 && toChapterId > 0 && fromChapterId !== toChapterId;
}
