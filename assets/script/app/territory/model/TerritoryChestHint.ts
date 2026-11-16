import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';

/**
 * 固定奖励宝箱的提示气泡与「还没点我」跳动规则（纯函数，零 cc）。
 *
 * 气泡只在「已解锁且未领取」时出现；同屏只展示解锁序号最大的一个宝箱。
 * 点击被宝箱前置挡住的格子时，对应宝箱原地跳动 1.5s，并隐藏气泡。
 */

/** 气泡/跳动需要的最小进度视图。 */

/** 气泡/跳动的最小进度视图。 */
export interface ITerritoryChestHintProgress {
    isCellUnlocked(cellId: number): boolean;
    isOwned(cellId: number): boolean;
}

/**
 * 宝箱的解锁序号。
 *
 * 固定宝箱 id 形如 `fixedResource_<N>`，N 即编辑器建点顺序。取不到序号时退回
 * `cellId`，保证排序不依赖输入遍历顺序。
 */
export function territoryChestUnlockId(site: TerritorySite): number {
    const matched = /^fixedResource_(\d+)$/.exec(String(site.id));
    if (matched) return Number(matched[1]);
    const trailing = /(\d+)\s*$/.exec(String(site.id));
    return trailing ? Number(trailing[1]) : site.cellId;
}

/**
 * 这个宝箱该不该挂提示：固定宝箱、已激活且未领取。
 *
 * 判据用本格的 `isCellUnlocked / isOwned`，不能用区域口径，否则同片未解锁的宝箱
 * 也会挂上气泡。
 */
export function territoryChestShowsHint(site: TerritorySite, progress: ITerritoryChestHintProgress): boolean {
    if (site.type !== TERRITORY_SITE_TYPE.fixedResource) return false;
    return progress.isCellUnlocked(site.cellId) && !progress.isOwned(site.cellId);
}

/**
 * 同屏唯一的气泡挂在哪个宝箱上：已露出且满足提示条件里解锁序号最大的一个。
 * 没有候选返回 `null`。同序号时取 `cellId` 较小者，保证结果可重复。
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
 * 点某一格时该跳哪只宝箱：这一格的前置格里还没领取的固定宝箱。
 *
 * 前置格可能落在宝箱的 `footprint` 而不是 `cellId`，两种命中都收；多个时取解锁序号
 * 最大的那只。返回 `null` 表示这一格不阻塞在宝箱上。
 */
export function territoryPrerequisiteChestCell(
    site: TerritorySite,
    sites: readonly TerritorySite[],
    progress: ITerritoryChestHintProgress,
): number | null {
    const required = site.unlock.requiredCells;
    if (!required.length) return null;
    let best: { cellId: number; unlockId: number } | null = null;
    for (const cell of required) {
        // 判据落在前置格上：这一步卡住的是前置格本身。
        if (progress.isOwned(cell)) continue;
        const chest = sites.find((candidate) => candidate.type === TERRITORY_SITE_TYPE.fixedResource
            && (candidate.cellId === cell || candidate.footprint.includes(cell)));
        if (!chest) continue;
        const unlockId = territoryChestUnlockId(chest);
        if (!best || unlockId > best.unlockId || (unlockId === best.unlockId && chest.cellId < best.cellId)) {
            best = { cellId: chest.cellId, unlockId };
        }
    }
    return best ? best.cellId : null;
}

/** 跳动总时长（秒）。 */
export const TERRITORY_CHEST_HINT_SECONDS = 1.5;
/** 1.5s 里跳 3 下。 */
export const TERRITORY_CHEST_HINT_HOPS = 3;
/** 第一跳的抬起高度（地图像素），后续按 1 / 0.75 / 0.5 递减。 */
export const TERRITORY_CHEST_HINT_HEIGHT = 14;
/** 每一跳的衰减系数。 */
export const TERRITORY_CHEST_HINT_HOP_DECAY = 0.25;

/**
 * 跳动曲线：`elapsed` 秒时宝箱相对原位的纵向偏移（正数向上）。
 *
 * 每跳为半正弦，起跳与落地都归零，幅度逐跳衰减。非法入参返回 0，
 * 避免把 NaN 写进节点坐标。
 */
export function territoryChestHintBounceOffset(elapsed: number): number {
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TERRITORY_CHEST_HINT_SECONDS) return 0;
    const hopSeconds = TERRITORY_CHEST_HINT_SECONDS / TERRITORY_CHEST_HINT_HOPS;
    const index = Math.floor(elapsed / hopSeconds);
    const phase = (elapsed - index * hopSeconds) / hopSeconds;
    const decay = Math.max(0, 1 - index * TERRITORY_CHEST_HINT_HOP_DECAY);
    return TERRITORY_CHEST_HINT_HEIGHT * Math.sin(Math.PI * phase) * decay;
}
