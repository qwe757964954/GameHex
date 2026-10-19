import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';
import type { TerritoryProgress } from './TerritoryProgress';

/**
 * 已开启格、前置满足的非随机站点，以及紧邻的随机候选格；远处格子保持未知。
 *
 * 非随机站点（fixedResource / stage / boss / asyncPvp 等）以「前置条件满足」为显示门槛：
 * 只要 `requiredCells` 全部已解锁/已占领就揭示，不要求与已开格相邻——否则配置里
 * 「依赖主城 367」的 fixedResource_326 会被相邻揭示过滤掉（它与主城中心距 ≈169px，隔 1.7 格）。
 * 无前置（`requiredCells` 为空，如 bonus）的站点与随机候选格仍按相邻揭示。
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
        if (required.length > 0 && required.every((cell) => opened.has(cell))) {
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
