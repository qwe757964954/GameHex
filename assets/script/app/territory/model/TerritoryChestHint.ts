import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';

/**
 * 固定奖励宝箱（`fixedResource`）的**提示气泡**与**「还没点我」跳动**规则（纯函数，零 cc）。
 *
 * 需求（2026-11-02 用户，三条一起）：
 *  1. 「领地玩法内的固定奖励配置的宝箱**增加一个气泡UI提示**（气泡样式同章节），
 *     气泡内的提示UI是**体力 icon + 需要消耗的数量值**」；
 *  2. 「同屏内多个宝箱时，**只展示 1 个气泡**，气泡优先展示在**解锁 id 最大**的宝箱上」；
 *  3. 「当玩家点击地块，地块的**前置宝箱已激活、未点击**时播放宝箱未通过的提示动画：
 *     对应的宝箱**原地跳动 1.5s** 提示玩家点击，播放动画时**隐藏宝箱的提示气泡**」。
 *
 * 三条都建在同一个状态上 —— {@link territoryChestShowsHint}：
 * **已解锁（激活）且未领取（未点击）**。这一对判据与 `TerritoryMapView.stationRenderOf`
 * 里「未解锁格的前置宝箱已解锁未领取 ⇒ 银币数字染红」**同源**，别各写一套。
 */

/** 气泡/跳动的最小进度视图（`TerritoryProgress` 与 `ITerritoryProgressView` 都结构化满足）。 */
export interface ITerritoryChestHintProgress {
    isCellUnlocked(cellId: number): boolean;
    isOwned(cellId: number): boolean;
}

/**
 * 宝箱的**解锁序号**（需求原文「解锁 id 最大」）。
 *
 * 取 `site.id` 末尾的数字：地图里固定宝箱的 id 恒为 `fixedResource_<N>`（chapter_01~07、
 * chapter_smile 全部如此，且**同一章内不重复**，见 `tests/territory-chest-hint.test.ts`），
 * `N` 就是编辑器里的建点顺序 = 解锁推进顺序。
 *
 * 兜底（拿不到序号时）用 `cellId`：至少保证「同屏只留一个」这件事还有确定的答案，
 * 而不是随 `sites` 的遍历顺序漂 —— 排序不许依赖输入顺序，这一条与 `findCurrentTerritoryLevel` 同口径。
 */
export function territoryChestUnlockId(site: TerritorySite): number {
    const matched = /^fixedResource_(\d+)$/.exec(String(site.id ?? ''));
    if (matched) return Number(matched[1]);
    const trailing = /(\d+)\s*$/.exec(String(site.id ?? ''));
    return trailing ? Number(trailing[1]) : site.cellId;
}

/**
 * 这个宝箱**该不该挂提示**：是固定宝箱 + 已激活（解锁）+ 还没领。
 *
 * 🔴 判据刻意用**本格**的 `isCellUnlocked / isOwned`，不用 `isAreaPassed`：
 *   宝箱是「解锁 → 领取」一次性事件，没有区域共享的状态；
 *   用区域口径会让同一片里未解锁的宝箱也挂上气泡（看着像"能领"，点了才发现在解锁银币那一步）。
 */
export function territoryChestShowsHint(site: TerritorySite, progress: ITerritoryChestHintProgress): boolean {
    if (site.type !== TERRITORY_SITE_TYPE.fixedResource) return false;
    return progress.isCellUnlocked(site.cellId) && !progress.isOwned(site.cellId);
}

/**
 * 同屏**唯一**那只气泡挂在哪个宝箱上：已露出 + {@link territoryChestShowsHint} 里
 * **解锁序号最大**的那一个；没有候选 ⇒ `null`（一个气泡都不画）。
 *
 * 「同屏」在本实现里 = **本轮渲染出来的格子集合**（`revealedCells`）。
 * 地图是整张 ScrollView 内容层、没有视口裁剪，所以「渲染出来的 = 玩家可能看到的」，
 * 不需要再算一次屏幕矩形（算了反而会有"滚到边缘气泡忽隐忽现"的抖动）。
 *
 * 排序：解锁序号大者优先；**同序号**（数据脏了）时取 `cellId` 小的那个 ——
 * 保证结果与 `sites` 的遍历顺序无关，可重复。
 */
export function territoryChestHintCell(
    sites: readonly TerritorySite[],
    progress: ITerritoryChestHintProgress,
    revealedCells: readonly number[],
): number | null {
    const revealed = new Set(revealedCells);
    let best: { cellId: number; unlockId: number } | null = null;
    for (const site of sites) {
        if (!revealed.has(site.cellId)) continue;
        if (!territoryChestShowsHint(site, progress)) continue;
        const unlockId = territoryChestUnlockId(site);
        if (!best || unlockId > best.unlockId || (unlockId === best.unlockId && site.cellId < best.cellId)) {
            best = { cellId: site.cellId, unlockId };
        }
    }
    return best ? best.cellId : null;
}

/**
 * 点某一格时该跳哪只宝箱（需求 3 + 2026-11-02 追加）：这一格的前置格里，**还没领取**的固定宝箱。
 *
 *  · 前置格 = `site.unlock.requiredCells`（与「银币数字染红」那条规则**同一份数据**）；
 *  · 前置格可能落在宝箱站点的 `footprint` 上而不是它的 `cellId` —— 判据与
 *    `stationRenderOf` 里那处 `sites.find(s => s.footprint.includes(cell))` 对齐，两种命中都收；
 *  · 有多个（罕见）⇒ 同样取**解锁序号最大**的那只，与气泡的优先级一致（玩家看到气泡的那只先跳）。
 *
 * 返回 `null` = 这一格不阻塞在宝箱上，不该跳。
 *
 * 🔴 判据是 **`!isOwned`**，不是「已激活且未领取」：`isPrerequisiteComplete` 对固定资源的口径是
 * 「解锁即算完成」，所以「宝箱还锁着」那种情况**不会**被前置判定拦住、却同样是把玩家挡在门外的
 * 那一格。两种状态对玩家的意思都是「这个宝箱还没打开」，提示文案也统一写「前置宝箱未打开」
 * （见 `TerritoryPrerequisite`），跳动的目标自然也要覆盖这两态 —— 否则玩家读到提示抬头看，
 * 地图上一点反馈都没有。
 *
 * ⚠️ 气泡的判据**不跟着放宽**（{@link territoryChestShowsHint} 仍然是「激活且未领取」）：
 *    气泡里写的是"花多少体力领"，箱子还没激活时挂上去只会让人以为现在就能点。
 */
export function territoryPrerequisiteChestCell(
    site: TerritorySite,
    sites: readonly TerritorySite[],
    progress: ITerritoryChestHintProgress,
): number | null {
    const required = site.unlock?.requiredCells ?? [];
    if (!required.length) return null;
    let best: { cellId: number; unlockId: number } | null = null;
    for (const cell of required) {
        // 前置格是不是「还没领取」的宝箱 —— 判据落在**前置格**上（这一步卡住的是前置格本身）。
        if (progress.isOwned(cell)) continue;
        const chest = sites.find((candidate) => candidate.type === TERRITORY_SITE_TYPE.fixedResource
            && (candidate.cellId === cell || (candidate.footprint ?? []).includes(cell)));
        if (!chest) continue;
        const unlockId = territoryChestUnlockId(chest);
        if (!best || unlockId > best.unlockId || (unlockId === best.unlockId && chest.cellId < best.cellId)) {
            best = { cellId: chest.cellId, unlockId };
        }
    }
    return best ? best.cellId : null;
}

/** 跳动总时长（需求原话「原地跳动 1.5s」）。 */
export const TERRITORY_CHEST_HINT_SECONDS = 1.5;
/** 1.5s 里跳几下。3 下 ⇒ 每下 0.5s，节奏够"催"，也不会看着像抽搐。 */
export const TERRITORY_CHEST_HINT_HOPS = 3;
/** 第一下的抬起高度（地图像素）；后面两下按 1 / 0.75 / 0.5 递减，收得住。 */
export const TERRITORY_CHEST_HINT_HEIGHT = 14;
/** 每一跳的衰减系数（第 n 跳 × (1 − n × 0.25)）。 */
export const TERRITORY_CHEST_HINT_HOP_DECAY = 0.25;

/**
 * 跳动曲线：`elapsed` 秒时宝箱**相对原位**的纵向偏移（正数向上）。
 *
 * 形状 = 每跳一条半正弦 `sin(π·phase)`：起跳与落地都是 0（不会瞬移），最高点在跳中；
 * 幅度逐跳衰减，1.5s 结束时正好回 0 —— **不需要额外复位动画**，播完把偏移写 0 就落回原位。
 *
 * 非法入参（NaN / 负数 / 已播完）一律返回 0：站点每秒会被刷一次，宁可"这一帧没跳"，
 * 也不能把 NaN 写进节点坐标（那是整只宝箱消失，且零报错）。
 */
export function territoryChestHintBounceOffset(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_CHEST_HINT_SECONDS) return 0;
    const hopSeconds = TERRITORY_CHEST_HINT_SECONDS / TERRITORY_CHEST_HINT_HOPS;
    const index = Math.floor(elapsed / hopSeconds);
    const phase = (elapsed - index * hopSeconds) / hopSeconds;
    const decay = Math.max(0, 1 - index * TERRITORY_CHEST_HINT_HOP_DECAY);
    return TERRITORY_CHEST_HINT_HEIGHT * Math.sin(Math.PI * phase) * decay;
}
