import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';
import type { TerritoryProgress } from './TerritoryProgress';

/**
 * 已开启格、前置满足的非随机站点，以及紧邻的随机候选格；其余格子保持未知。
 *
 * 非随机站点以「前置满足」为显示门槛，不要求与已开格相邻；无前置站点与随机候选格
 * 仍按相邻揭示。前置判据统一走 {@link TerritoryProgress.isPrerequisiteComplete}，
 * 与点击拦截同源。只揭示有内容的格，空格留在云里。
 *
 * `previewCells` 是独立的提前披露通道，无条件并入，不改变解锁与扣费逻辑。
 */
export function territoryRevealedCells(
    map: TerritoryMapConfig,
    progress: TerritoryProgress,
    /** 提前披露的格（见 `model/TerritoryPreview`）。缺省 = 不披露任何额外格。 */
    previewCells: readonly number[] = [],
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
        if (required.length > 0 && required.every((cell) => progress.isPrerequisiteComplete(cell))) {
            revealed.add(site.cellId);
        } else if (required.length === 0 && frontier.has(site.cellId)) {
            revealed.add(site.cellId);
        }
    }
    for (const cellId of map.randomSites?.candidateCells ?? []) {
        if (frontier.has(cellId)) revealed.add(cellId);
    }
    // 提前披露通道：无条件并入，不看前置。
    for (const cellId of previewCells) revealed.add(cellId);
    return Array.from(revealed).sort((a, b) => a - b);
}
