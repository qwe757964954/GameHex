/**
 * 章节切换转场的纯时间轴（零 cc，供 Node 直接测试）。
 *
 * 内存中只保留一张章节地图，转场由四段拼成：相机先行、云层合拢、黑场换图、新章落位。
 * 只有玩家点章节按钮才播放，自动换章不会触发这段演出。
 */

import { clamp01Finite } from '../../../core/math/Scalar';

/** 相机先行段时长（秒），云层尚未出现。 */
export const TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS = 0.1;

/** 云层合拢时长（秒）。 */
export const TERRITORY_CHAPTER_SWITCH_COVER_SECONDS = 0.32;

/** 新章落回居中的时长（秒）。 */
export const TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS = 0.58;

/** 新章起点高度占视口高度的比例。 */
export const TERRITORY_CHAPTER_SWITCH_RISE_RATIO = 0.45;

/** 相机先行段地图下移距离占 rise 的比例。 */
export const TERRITORY_CHAPTER_SWITCH_SINK_RATIO = 0.25;

/** 等待新章加载的上限（秒），避免云层永远盖着。 */
export const TERRITORY_CHAPTER_SWITCH_WAIT_MAX_SECONDS = 6;

/** 整段转场总时长，不含等加载。 */
export function territoryChapterSwitchTotalSeconds(): number {
    return TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS
        + TERRITORY_CHAPTER_SWITCH_COVER_SECONDS
        + TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS;
}

/** 缓出（前快后慢）。 */
function easeOut(x: number): number {
    const value = clamp01Finite(x);
    return 1 - (1 - value) * (1 - value);
}

/** `cover` 段进度（0~1）；非法入参按 0。 */
export function territoryChapterSwitchCoverProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01Finite(elapsed / TERRITORY_CHAPTER_SWITCH_COVER_SECONDS);
}

/** `lead` 段进度；非法入参按 0。 */
export function territoryChapterSwitchLeadProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01Finite(elapsed / TERRITORY_CHAPTER_SWITCH_LEAD_SECONDS);
}

/** `reveal` 段进度（0~1）；非法入参按 0。 */
export function territoryChapterSwitchRevealProgress(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return clamp01Finite(elapsed / TERRITORY_CHAPTER_SWITCH_REVEAL_SECONDS);
}

/**
 * 新章从上方落下的总高度（px）。
 *
 * 视口高度拿不到时返回 0，只演云层不演位移。
 */
export function territoryChapterSwitchRise(viewportHeight: number): number {
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
    return viewportHeight * TERRITORY_CHAPTER_SWITCH_RISE_RATIO;
}

/**
 * `lead` 段走完时地图的总 y 偏移（负数表示下移）。
 *
 * 合拢段固定使用这个值，避免相机回弹。
 */
export function territoryChapterSwitchSinkDistance(rise: number): number {
    const value = Number.isFinite(rise) && rise > 0 ? rise : 0;
    const offset = -value * TERRITORY_CHAPTER_SWITCH_SINK_RATIO;
    return offset === 0 ? 0 : offset;
}

/** `lead` 段地图 y 偏移，easeOut 从 0 到下沉距离。 */
export function territoryChapterSwitchSinkOffset(progress: number, rise: number): number {
    const offset = territoryChapterSwitchSinkDistance(rise) * easeOut(clamp01Finite(progress));
    return offset === 0 ? 0 : offset;
}

/** `reveal` 段地图 y 偏移，从 `rise` 落回 0。 */
export function territoryChapterSwitchRevealOffset(progress: number, rise: number): number {
    const value = Number.isFinite(rise) && rise > 0 ? rise : 0;
    return value * (1 - easeOut(clamp01Finite(progress)));
}

/** 新章已画上来才允许揭幕，避免在旧图上播落位。 */
export function territoryChapterSwitchReadyToReveal(
    renderedChapterId: number,
    targetChapterId: number,
): boolean {
    return renderedChapterId === targetChapterId;
}

/** 同章或非法章号不播转场。 */
export function territoryChapterSwitchWanted(fromChapterId: number, toChapterId: number): boolean {
    return Number.isFinite(fromChapterId) && Number.isFinite(toChapterId)
        && fromChapterId > 0 && toChapterId > 0 && fromChapterId !== toChapterId;
}
