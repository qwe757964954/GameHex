import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritorySite } from './TerritoryMapConfig';

/**
 * 「提前披露」（预告）关卡：**不满足前置**也要把地块露出来、把建筑画成虚影。
 *
 * ## 需求（2026-11-09 用户口径）
 *
 * > ① 默认提前展示关卡 10001 所在的地块；
 * > ② 通过第一关后，提前展示 boss 关卡建筑（虚影 35%）和所在地块；
 * > ③ 通过 boss 关卡后，提前披露第 2 个 boss 关卡的位置。
 * > 「提前展示不改变消耗银币激活地块的逻辑」。
 *
 * ## 口径：只披露**序列里前一项已通过**的那一个
 *
 * 披露序列 = `[本章第 1 关] + [本章每个首领]`（按 `stage.stage` 升序）。链式触发：
 *
 * | 目标 | 触发条件 |
 * | :--- | :--- |
 * | 第 1 关 | **开局恒披露**（前一项是出生点，永远满足） |
 * | 首领 1 | 第 1 关**已通过** |
 * | 首领 2 | 首领 1 已通过 |
 *
 * ⇒ 任一时刻最多只有 **1 个**目标关卡处于「未通过、被披露」状态，场上最多一组虚影。
 *
 * 「已通过」走 {@link ITerritoryPreviewQuery.isAreaPassed}（**同 `configId` 任一格 owned
 * 即算通过**），与显示侧 `territoryRevealedCells` / 点击拦截 `checkUnlock` 同源，
 * 别另写一套"每一格都归我才算通过"。
 *
 * ## 🔴 为什么不改 `isPrerequisiteComplete`
 *
 * 2026-11-06 用户报过一个 bug：「boss 关卡的解锁关系没有绑定到 2-9 的关卡中，提前披露了」
 * —— 根因是**显示侧**自己写了一套"花钱解锁就算完成"，比点击侧宽松。修法是把两侧并成
 * `isPrerequisiteComplete` 一个口径，并留了守卫用例
 * `tests/territory-cell-reveal.test.ts`「前置关卡只『解锁』没通关时，后继关卡（首领）不许提前揭示」。
 *
 * 所以这条「有意披露」**不能**去放宽那个判据，而是走**并行的第二条通道**：
 * 本模块独立算出 `previewCells`，由 `territoryRevealedCells` 作为**可选入参**并进揭示集合。
 * 不传就是零变化 ⇒ 那条守卫用例继续成立，意外披露的洞也没被重新打开。
 *
 * ## 披露范围：整关 footprint
 *
 * 用户 2026-11-09：「整关 footprint，不然大建筑会有错位」。`chapter_02` 起一关是**一个站点
 * 带 5~10 格 footprint**（`stage_1` = 8 格），只露建筑那格会让大建筑悬在云上、和地块错位。
 * 所以披露的是该关**全部站点的 footprint 并集**。
 *
 * ⚠️ 只负责**格子集合**，不管画法：虚影 / 锁 / 价格的组合由视图层按现有三态走。
 */

export interface ITerritoryPreviewQuery {
    /** 本章全部站点。 */
    readonly sites: readonly TerritorySite[];
    /** cellId → 关卡（同区域格子共享同一关，见 `expandBindingsToAreaSites`）。 */
    readonly stageByCell: ReadonlyMap<number, TerritoryCampaignStage>;
    /**
     * 这一格所属的关卡**是否已通过**。必传（且必须是区域口径）——
     * 传 `() => false` 就等于"永远只披露第 1 关"。
     */
    readonly isAreaPassed: (cellId: number) => boolean;
}

export interface ITerritoryPreviewLevel {
    readonly levelId: number;
    /** 关序号（`stage.stage`），披露序列按它排。 */
    readonly order: number;
    /**
     * 代表格（该关 footprint 里最小的那个 cellId）。
     *
     * 用它去问 `isAreaPassed`：判据是区域共享的，取哪一格结果一样，
     * 固定成最小值只是为了**不依赖入参 `sites` 的遍历顺序**（否则同样的数据换序就换结果）。
     */
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
        // ⚠️ 收的是 **footprint**，不是 `cellId`：`chapter_02` 起一关就是一个带多格的站点。
        for (const cell of site.footprint) entry.cells.add(cell);
    }
    return byLevel;
}

/**
 * 当前该披露哪些关卡（**链式**：前一项没过，后面的都不披露）。
 *
 * 返回顺序即披露序列顺序，已触发的那几项全部返回（含早已通过的 —— 它们的格子本来就在
 * `revealedCells` 里，再并一次是幂等的，视图也不会在已激活的格子上画虚影）。
 */
export function territoryPreviewLevels(query: ITerritoryPreviewQuery): ITerritoryPreviewLevel[] {
    const byLevel = levelIndex(query);
    if (byLevel.size === 0) return [];
    const ordered = Array.from(byLevel.values()).sort((a, b) =>
        a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId);
    const first = ordered[0];
    // 序列 = 第 1 关 + 每个首领。第 1 关本身是首领时别重复收。
    const chain = [first, ...ordered.filter((level) => level !== first && level.stage.isBoss)];

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

/** {@link territoryPreviewLevels} 的格子视图：全部已触发目标关卡的 footprint 并集，升序去重。 */
export function territoryPreviewCells(query: ITerritoryPreviewQuery): number[] {
    const cells = new Set<number>();
    for (const level of territoryPreviewLevels(query)) {
        for (const cell of level.cells) cells.add(cell);
    }
    return Array.from(cells).sort((a, b) => a - b);
}
