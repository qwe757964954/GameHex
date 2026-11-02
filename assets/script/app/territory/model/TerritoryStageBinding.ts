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

/**
 * 快速寻敌的目标：**当前章节关卡链上「推进到的那一关」**（2026-10-31 用户口径）。
 *
 *   > 「快速寻敌功能的逻辑是跳到当前章节地图上最新一个未通过的关卡，
 *   >   如果没有未通过的关卡，就打开已通过的关卡，其他镜头逻辑不变。」
 *
 * 「最新一个未通过的关卡」= 关卡序号最小的**未通过**关卡。关卡链是线性的
 * （`applyTerritoryStageUnlocks` 把每一关的前置写成上一格，见本文件下半段），
 * 所以「序号最小的未通过」和「玩家接下来该打的那一关」是同一关。
 *
 * 🔴 2026-10-31 之前这里**只收 Boss**（`site.type === boss || stage.isBoss`）：
 *   一章有两个 Boss（chapter_01 = stage 5 / stage 10）时，快速寻敌会跳过前面所有普通关卡
 *   直接怼到 Boss 上 —— 玩家还没打 1-1 就被丢到 1-5。现在**普通关卡与 Boss 一视同仁**。
 *
 * 全部通关（没有未通过的）⇒ 退回**关卡序号最高**的那一关（打开详情，可重复挑战）。
 * 同一关绑了多格（`expandBindingsToAreaSites`）⇒ 优先取**带建筑**的那格、再按 cellId 升序：
 * 定位结果不许依赖入参 `sites` 的遍历顺序。
 *
 * 🔴 **只挑已解锁的**（2026-10-31 用户追加「只挑已解锁的」）：锁着的关卡被选中时，
 *   详情只能显示「解锁后开战」，玩家点了也打不了 —— 那不是"快速寻敌"，是"快速看价目表"。
 *   判据见 {@link isLevelUnlocked}：与点击路径同口径，**区域已通关也算解锁**。
 *
 * ⚠️ `asyncPvp`（异步据点）**不算**关卡：它不进线性推进链，当成终点会把玩家带去 PVP 格子。
 */
export function findCurrentTerritoryLevel(
    sites: readonly TerritorySite[],
    stageByCell: ReadonlyMap<number, TerritoryCampaignStage>,
    progress: TerritoryProgress,
): TerritoryStageBinding | null {
    const candidates: TerritoryStageBinding[] = [];
    for (const site of sites) {
        const stage = stageByCell.get(site.cellId);
        if (!stage) continue;
        if (site.type !== TERRITORY_SITE_TYPE.stage && site.type !== TERRITORY_SITE_TYPE.boss) continue;
        if (progress.isDisabled(site.cellId)) continue;
        if (!isLevelUnlocked(progress, site.cellId)) continue;
        candidates.push({ site, stage });
    }
    const unpassed = candidates.filter(({ site }) => !progress.isAreaPassed(site.cellId));
    const targets = unpassed.length ? unpassed : candidates;
    const direction = unpassed.length ? 1 : -1;
    targets.sort((a, b) => direction * (a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId)
        || Number(!!b.site.buildingId) - Number(!!a.site.buildingId) || a.site.cellId - b.site.cellId);
    return targets[0] ?? null;
}

/**
 * 这一格关卡**能不能直接打**（快速寻敌的准入条件）。
 *
 * 两条与点击路径 `TerritoryModel.selectSite` 完全同源：
 *  1. **区域已通关也算解锁** —— 那种格子不会再走解锁请求（见 `isAreaPassed` 的注释），
 *     只判"本格在 `unlockCells` 里"会把「区域通了但这格没单独解锁」的关卡漏掉；
 *  2. 用 `isUnlockable` 而不是 `isCellUnlocked`：前者在**服务端格子状态还没拉回来**时一律放行，
 *     后者是严格集合。首帧快照未到就严格过滤，快速寻敌会直接变成「暂无可定位的关卡」——
 *     一个按钮在弱网 / 请求失败时变成死的，比偶尔落在锁着的关卡上更糟。
 */
function isLevelUnlocked(progress: TerritoryProgress, cellId: number): boolean {
    return progress.isAreaPassed(cellId) || progress.isUnlockable(cellId);
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
