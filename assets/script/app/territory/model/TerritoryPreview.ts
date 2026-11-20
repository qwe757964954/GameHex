import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritorySite } from './TerritoryMapConfig';

/**
 * 提前披露关卡：前置未满足也露出地块，建筑画成虚影。
 *
 * 披露序列 = 本章第 1 关 + 全部首领（按 stage 升序），前一项通过后才触发下一项，
 * 因此任一时刻最多只披露一个未通过关卡。
 * 本模块只负责格子集合，走独立通道并入揭示结果，不放宽前置判据。
 */

export interface ITerritoryPreviewQuery {
    /** 本章全部站点。 */
    readonly sites: readonly TerritorySite[];
    /** cellId 对应的关卡。 */
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    /** 这一格所属关卡是否已通过，按区域口径判定。 */
    readonly isAreaPassed: (cellId: number) => boolean;
}

export interface ITerritoryPreviewLevel {
    readonly levelId: number;
    /** 关序号，披露序列按它排。 */
    readonly order: number;
    /** 代表格，取该关 footprint 中最小的 cellId，避免依赖遍历顺序。 */
    readonly anchorCell: number;
    /** 触发它的那一关（`null` = 开局就披露）。 */
    readonly after: number | null;
    /** 整关 footprint 并集，升序。 */
    readonly cells: readonly number[];
}

/** 每一关的 footprint 并集 + 代表格。key = `levelId`。 */
function levelIndex(query: ITerritoryPreviewQuery): Map<number, { stage: TerritoryCampaignStage; anchorCell: number; cells: Set<number> }> {
    const byLevel = new Map<number, { stage: TerritoryCampaignStage; anchorCell: number; cells: Set<number> }>();
    for (const site of query.sites) {
        const stage = query.stageByCell.get(site.cellId);
        if (!stage) continue;
        let entry = byLevel.get(stage.levelId);
        if (!entry) {
            entry = { stage, anchorCell: site.cellId, cells: new Set<number>() };
            byLevel.set(stage.levelId, entry);
        } else if (site.cellId < entry.anchorCell) {
            entry.anchorCell = site.cellId;
        }
        // 统计整关 footprint，而不是单个 cellId。
        for (const cell of site.footprint) entry.cells.add(cell);
    }
    return byLevel;
}

/**
 * 当前应披露的关卡，链式触发：前一项未通过则后面的都不披露。
 *
 * 已触发项全部返回，重复并入揭示集合是幂等的。
 */
export function territoryPreviewLevels(query: ITerritoryPreviewQuery): ITerritoryPreviewLevel[] {
    const byLevel = levelIndex(query);
    if (byLevel.size === 0) return [];
    const ordered = Array.from(byLevel.values()).sort((a, b) =>
        a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId);
    const first = ordered[0];
    // 序列为第 1 关加全部首领；第 1 关本身是首领时不重复。
    const chain: (typeof ordered)[number][] = [first];
    for (let i = 0; i < ordered.length; i++) {
        const level = ordered[i];
        if (level !== first && level.stage.isBoss) {
            chain.push(level);
        }
    }

    const result: ITerritoryPreviewLevel[] = [];
    let previous: (typeof ordered)[number] | null = null;
    for (const level of chain) {
        if (previous && !query.isAreaPassed(previous.anchorCell)) break;
        result.push({
            levelId: level.stage.levelId,
            order: level.stage.stage,
            anchorCell: level.anchorCell,
            after: previous ? previous.stage.levelId : null,
            cells: Array.from(level.cells).sort((a, b) => a - b),
        });
        previous = level;
    }
    return result;
}

/** 已触发目标关卡的 footprint 并集，升序去重。 */
export function territoryPreviewCells(query: ITerritoryPreviewQuery): number[] {
    const cells = new Set<number>();
    for (const level of territoryPreviewLevels(query)) {
        for (const cell of level.cells) cells.add(cell);
    }
    return Array.from(cells).sort((a, b) => a - b);
}
