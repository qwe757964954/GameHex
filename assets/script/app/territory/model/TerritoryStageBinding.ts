import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritoryMapConfig, TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritoryProgress } from './TerritoryProgress';

export interface TerritoryStageBinding {
    site: TerritorySite;
    stage: TerritoryCampaignStage;
}

export interface TerritoryChapterCompletion {
    occupied: number;
    total: number;
    complete: boolean;
}

/** 优先定位推进中的 Boss；全部通关后回到最高关卡，同区域优先定位建筑格。 */
export function findCurrentTerritoryBoss(
    sites: readonly TerritorySite[],
    stageByCell: ReadonlyMap<number, TerritoryCampaignStage>,
    progress: TerritoryProgress,
): TerritoryStageBinding | null {
    const candidates: TerritoryStageBinding[] = [];
    for (const site of sites) {
        const stage = stageByCell.get(site.cellId);
        if (!stage || (site.type !== TERRITORY_SITE_TYPE.boss
            && !(site.type === TERRITORY_SITE_TYPE.stage && stage.isBoss))) continue;
        if (progress.isDisabled(site.cellId)) continue;
        candidates.push({ site, stage });
    }
    const unpassed = candidates.filter(({ site }) => !progress.isAreaPassed(site.cellId));
    const targets = unpassed.length ? unpassed : candidates;
    const direction = unpassed.length ? 1 : -1;
    targets.sort((a, b) => direction * (a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId)
        || Number(!!b.site.buildingId) - Number(!!a.site.buildingId) || a.site.cellId - b.site.cellId);
    return targets[0] ?? null;
}

/** Current map stations are the completion authority; unbound table rows do not block a chapter. */
export function territoryChapterCompletion(
    bindings: readonly TerritoryStageBinding[],
    ownedCells: readonly number[],
): TerritoryChapterCompletion {
    const owned = new Set(ownedCells);
    const occupied = bindings.reduce((count, binding) => count + (owned.has(binding.site.cellId) ? 1 : 0), 0);
    const total = bindings.length;
    return { occupied, total, complete: total > 0 && occupied === total };
}

/**
 * Binds the current territory-map JSON to PVP levels without changing either table.
 * Only an explicit numeric configId on a stage or boss site can join linear progression.
 * Repeated IDs on display stations bind once, in map order.
 */
export function bindTerritoryStages(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
): TerritoryStageBinding[] {
    return bindStagesForSiteTypes(sites, stages, [TERRITORY_SITE_TYPE.stage, TERRITORY_SITE_TYPE.boss]);
}

/** Bind async PvP stations for battle lookup, while keeping them out of linear progression. */
export function bindTerritoryBattleStages(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
): TerritoryStageBinding[] {
    return bindStagesForSiteTypes(sites, stages, [TERRITORY_SITE_TYPE.stage, TERRITORY_SITE_TYPE.boss, TERRITORY_SITE_TYPE.asyncPvp]);
}

function bindStagesForSiteTypes(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
    siteTypes: readonly TerritorySite['type'][],
): TerritoryStageBinding[] {
    const stageById = new Map(stages.map((stage) => [stage.levelId, stage]));
    const usedLevelIds = new Set<number>();
    const bindings: TerritoryStageBinding[] = [];
    for (const site of sites) {
        if (!siteTypes.includes(site.type)) continue;
        const levelId = Number(site.configId);
        const stage = Number.isInteger(levelId) ? stageById.get(levelId) : undefined;
        if (!stage || usedLevelIds.has(stage.levelId)) continue;
        bindings.push({ site, stage });
        usedLevelIds.add(stage.levelId);
    }
    return bindings;
}

/**
 * 把「区域代表格」的关卡**扩散给同区域的全部站点**（2026-10-12）。
 *
 * ## 为什么需要这一步
 *
 * `bindTerritoryStages` 只给每个 `levelId` 绑**第一个**站点（去重），
 * 于是同一 `configId` 的其余站点 `stageByCell` 查不到 ⇒ 走「`!stage`」分支 ⇒
 * 弹「站点配置待补齐 / 当前 PVP-关卡表中没有可绑定关卡」——
 * 可实际上 `configId` 配了、`levelInfo.json` 里也有那一行，**只是被去重踢掉了**。
 *
 * ## 🔴 为什么不能直接放开 `bindTerritoryStages` 的去重
 *
 * 放开后 chapter_01 的绑定数会从 **10 → 54**，`applyTerritoryStageUnlocks` 会把整张图
 * 串成 **54 格长的线性链**，每片区域的每个格子都变成一个独立关卡：
 * - 章节进度的分母 `total` 从 10 变 54（`territoryChapterCompletion` 直接读`bindings.length`）；
 * - 「一片区域打穿一次」的节奏彻底变了（现在 10001 打一次就够，之后要去 10002）。
 *
 * 所以口径是：**关卡链仍按 `levelId` 去重（一片区域只占链上一步），
 * 但同区域的每个格子都能打同一个关卡。**
 *
 * 返回的是**站点 → 关卡**的完整映射（不是任一绑定函数的去重列表），
 * 调用方可把 `bindTerritoryBattleStages` 结果喂给 `stageByCell`；
 * `applyTerritoryStageUnlocks` 仍只吃主线 `bindTerritoryStages` 列表。
 */
export function expandBindingsToAreaSites(
    sites: readonly TerritorySite[],
    bindings: readonly TerritoryStageBinding[],
): Map<number, TerritoryCampaignStage> {
    const stageById = new Map(bindings.map(({ stage }) => [stage.levelId, stage]));
    const byCell = new Map<number, TerritoryCampaignStage>();
    for (const { site, stage } of bindings) byCell.set(site.cellId, stage);
    // ⚠️ 遍历顺序不影响结果（按 cellId 写 Map，后者不覆盖前者即可）；
    // 同区域的展示格在此补上同一个 stage ⇒ 它不再被当成「没配关卡」。
    for (const site of sites) {
        if (byCell.has(site.cellId)) continue;
        if (site.type !== TERRITORY_SITE_TYPE.stage && site.type !== TERRITORY_SITE_TYPE.boss && site.type !== TERRITORY_SITE_TYPE.asyncPvp) continue;
        const levelId = Number(site.configId);
        if (!Number.isInteger(levelId)) continue;
        const stage = stageById.get(levelId);
        if (stage) byCell.set(site.cellId, stage);
    }
    return byCell;
}
/** Playable levels advance in chapter order; decorative stations keep their map gates.
 *
 *  ⚠️ 入参必须是 `bindTerritoryStages` 的**去重后**列表（每 `levelId` 恰好一条）。
 *  它把链上的每一步的 `requiredCells` 改写成「上一格的cellId」⇒
 *  **链长 = `bindings.length`**。若误传 `expandBindingsToAreaSites` 的结果，
 *  同区域的格子会各自占一步，链会按格子数（而非关卡数）膨胀。
 */
export function applyTerritoryStageUnlocks(
    map: TerritoryMapConfig,
    bindings: readonly TerritoryStageBinding[],
): TerritoryMapConfig {
    const ordered = Array.from(bindings).sort((a, b) => a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId);
    const requiredByCell = new Map<number, number>();
    for (const [index, binding] of ordered.entries()) {
        requiredByCell.set(binding.site.cellId, index === 0 ? map.startCellId : ordered[index - 1].site.cellId);
    }
    return {
        ...map,
        sites: map.sites.map((site) => {
            const prerequisite = requiredByCell.get(site.cellId);
            return prerequisite === undefined ? site : {
                ...site,
                unlock: { ...site.unlock, requiredCells: [prerequisite] },
            };
        }),
    };
}
