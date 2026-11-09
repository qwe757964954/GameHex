import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';
import type { TerritoryProgress } from './TerritoryProgress';

/**
 * 已开启格、前置满足的非随机站点，以及紧邻的随机候选格；远处格子保持未知。
 *
 * 非随机站点（fixedResource / stage / boss / asyncPvp 等）以「前置条件满足」为显示门槛：
 * 只要 `requiredCells` 全部满足就揭示，不要求与已开格相邻——否则配置里
 * 「依赖主城 367」的 fixedResource_326 会被相邻揭示过滤掉（它与主城中心距 ≈169px，隔 1.7 格）。
 * 无前置（`requiredCells` 为空，如 bonus）的站点与随机候选格仍按相邻揭示。
 *
 * 🔴 **「满足」的判据只有一份**：{@link TerritoryProgress.isPrerequisiteComplete}。
 *    关卡 / 首领 / 异步据点前置必须**通关**（`isAreaPassed`），宝箱前置解锁即可 ——
 *    与点击拦截 `checkUnlock` 完全同源。2026-11-06 之前这里写的是「前置格 ∈ `owned ∪ unlocked`」，
 *    于是「花钱解锁了 2-9、没打」也会把 2-10 揭示出来（用户报的「提前披露」）。
 *
 * ⚠️ **只揭示有内容的格**（2026-11-05 山猫）：前沿上「没有站点、没有随机候选」的空格
 *   一律留在云里，不要为了放锁标把它们露出来 —— 那会让地图边缘凭空长出一整排灰地块。
 *   锁标只叠在**本来就会显示**的未解锁格上（见 `TerritoryMapView.isHexLockCell`）。
 */
export function territoryRevealedCells(
    map: TerritoryMapConfig,
    progress: TerritoryProgress,
): number[] {
    const opened = new Set(progress.ownedCells.concat(progress.unlockedCells));
    const frontier = new Set<number>();
    for (const cellId of opened) {
        for (const neighbor of hexGridNeighborIds(cellId, map.rows, map.columns)) {
            frontier.add(neighbor);
        }
    }
    const revealed = new Set<number>(opened);
    for (const site of map.sites) {
        const required = site.unlock.requiredCells;
        // 🔴 2026-11-06：前置是否满足**必须问 `progress.isPrerequisiteComplete`**，
        //    不能只判「前置格在 `opened`（`owned ∪ unlocked`）里」——
        //    那样「用银币解锁了 2-9 的格子、但没打」也会让 2-10 露出来
        //    （用户：「boss 关卡的解锁关系没有绑定到 2-9 的关卡中，提前披露了」）。
        //    与点击拦截（`checkUnlock` → `prerequisiteBlockers`）同源后，「看得见」与
        //    「点得动」才是同一套条件：关卡前置必须**通关**，宝箱前置解锁即可。
        if (required.length > 0 && required.every((cell) => progress.isPrerequisiteComplete(cell))) {
            revealed.add(site.cellId);
        } else if (required.length === 0 && frontier.has(site.cellId)) {
            revealed.add(site.cellId);
        }
    }
    for (const cellId of map.randomSites?.candidateCells ?? []) {
        if (frontier.has(cellId)) revealed.add(cellId);
    }
    return Array.from(revealed).sort((a, b) => a - b);
}
