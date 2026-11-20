import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritoryMapConfig, TerritorySite, TerritorySiteType } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import { territoryPatrolBattleByCell } from './TerritoryMonsterPatrol';
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
 * 快速寻敌的目标：当前章节关卡链上「推进到的那一关」。
 *
 * 取关卡序号最小的未通过关卡；全部通关时退回序号最高的一关，供重复挑战。
 * 同一关绑了多格时优先带建筑的那格，再按 cellId 升序，结果不依赖遍历顺序。
 * 只挑已解锁的关卡：锁着的关卡选中后也打不了。
 * 异步据点不进线性推进链，不作为目标。
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
    const unpassed: { site: TerritorySite; stage: TerritoryCampaignStage }[] = [];
    for (let i = 0; i < candidates.length; i++) {
        if (!progress.isAreaPassed(candidates[i].site.cellId)) {
            unpassed.push(candidates[i]);
        }
    }
    const targets = unpassed.length ? unpassed : candidates;
    const direction = unpassed.length ? 1 : -1;
    targets.sort((a, b) => direction * (a.stage.stage - b.stage.stage || a.stage.levelId - b.stage.levelId)
        || Number(!!b.site.buildingId) - Number(!!a.site.buildingId) || a.site.cellId - b.site.cellId);
    return targets[0] ?? null;
}

/**
 * 扫荡目标查询用到的进度子集。
 *
 * 用**结构子集**而不是 `TerritoryProgress`：视图层拿到的是
 * `ITerritoryProgressView`（`Pick` 出来的只读查询），它不是类实例、传不进原签名。
 * 与 `TerritoryChestHint` 的「最小进度视图」同一处置。
 */
export interface ITerritoryStagePassQuery {
    isAreaPassed(cellId: number): boolean;
    isDisabled(cellId: number): boolean;
}

/**
 * 「**已通关**的最高关卡格」—— 征收扫荡的目标格（口径）。
 *
 * 与 {@link findCurrentTerritoryLevel} 的分工：
 * - 那个优先给「还没打的下一关」，是**快速寻敌**（跳过去打）；
 * - 这个只在**已通关**的关卡里挑关号最大的，是**扫荡**（把已经推进到的进度再收一次）。
 *
 * 一个都没通关 ⇒ `null`。别退到第 1 关：新号点扫荡应该提示「暂无可扫荡」，
 * 而不是发一个必然被服务端拒的 `cellId`。
 *
 * 同关号多格时取 `levelId` 大的，再同则取 `cellId` 小的（保证结果稳定，不随 map 顺序漂）。
 */
export function findHighestPassedTerritoryLevel(
    sites: readonly TerritorySite[],
    stageByCell: ReadonlyMap<number, TerritoryCampaignStage>,
    progress: ITerritoryStagePassQuery,
): TerritoryStageBinding | null {
    let best: TerritoryStageBinding | null = null;
    for (const site of sites) {
        const stage = stageByCell.get(site.cellId);
        if (!stage) continue;
        if (site.type !== TERRITORY_SITE_TYPE.stage && site.type !== TERRITORY_SITE_TYPE.boss) continue;
        if (progress.isDisabled(site.cellId)) continue;
        if (!progress.isAreaPassed(site.cellId)) continue;
        if (!best) {
            best = { site, stage };
            continue;
        }
        const better = stage.stage !== best.stage.stage
            ? stage.stage > best.stage.stage
            : stage.levelId !== best.stage.levelId
                ? stage.levelId > best.stage.levelId
                : site.cellId < best.site.cellId;
        if (better) best = { site, stage };
    }
    return best;
}

/**
 * 这一格关卡能不能直接打（快速寻敌的准入条件）。
 *
 * 与点击路径同源：区域已通关视为解锁；服务端格子状态未拉回时使用 `isUnlockable`
 * 放行，避免弱网下按钮永久不可用。
 */
function isLevelUnlocked(progress: TerritoryProgress, cellId: number): boolean {
    return progress.isAreaPassed(cellId) || progress.isUnlockable(cellId);
}

/** 章节完成度以当前地图站点为准；表里未绑定的关卡不参与统计。 */
export function territoryChapterCompletion(
    bindings: readonly TerritoryStageBinding[],
    ownedCells: readonly number[],
): TerritoryChapterCompletion {
    const owned = new Set(ownedCells);
    let occupied = 0;
    for (let i = 0; i < bindings.length; i++) {
        if (owned.has(bindings[i].site.cellId)) occupied += 1;
    }
    const total = bindings.length;
    return { occupied, total, complete: total > 0 && occupied === total };
}

/**
 * 本章最后一个首领关卡的格子，作为章节通关判据。
 *
 * 按 `stage.stage` 排序而非全局 `levelId`，与线性推进链一致；同 stage 时按 levelId、
 * cellId 兜底。只认已绑定的 stage/boss 站点，避免把打不了的格子算成通关门槛。
 * 返回 `null` 表示本章没有可打的首领，调用方应退回「全部站点占领」的旧口径。
 */
export function chapterFinalBossCell(bindings: readonly TerritoryStageBinding[]): number | null {
    let best: TerritoryStageBinding | null = null;
    for (const binding of bindings) {
        if (binding.site.type !== TERRITORY_SITE_TYPE.boss) continue;
        if (!best) {
            best = binding;
            continue;
        }
        const byStage = binding.stage.stage - best.stage.stage;
        const byLevel = byStage || (binding.stage.levelId - best.stage.levelId);
        const byCell = byLevel || (binding.site.cellId - best.site.cellId);
        if (byCell > 0) best = binding;
    }
    return best ? best.site.cellId : null;
}

/**
 * 把地图 JSON 里的关卡站点绑定到 PVP 关卡表：只有显式数字 configId 的 stage/boss 站点
 * 进入线性推进链，重复 ID 按地图顺序绑定一次。
 */
export function bindTerritoryStages(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
): TerritoryStageBinding[] {
    return bindStagesForSiteTypes(sites, stages, [TERRITORY_SITE_TYPE.stage, TERRITORY_SITE_TYPE.boss]);
}

/** 绑定异步据点用于战斗查询，不进入线性推进链。 */
export function bindTerritoryBattleStages(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
): TerritoryStageBinding[] {
    return bindStagesForSiteTypes(sites, stages, [TERRITORY_SITE_TYPE.stage, TERRITORY_SITE_TYPE.boss, TERRITORY_SITE_TYPE.asyncPvp]);
}

/**
 * 巡逻宝箱绑定：每格按自己的 `battleId` 找关卡行（同片共用一个）。
 *
 * 与 {@link bindTerritoryStages} 的两点不同，都是必须的：
 * - **不做 `levelId` 去重**：一片巡逻区里多个格子共享同一个 `battleId`，
 *   每一格都要能点开打这一场；去重会让第二格起「查出没有关卡」。
 * - **不进线性推进链**：`applyTerritoryStageUnlocks` 只吃主线绑定，
 *   巡逻区的解锁前置由地图 JSON 的 `requiredCells` 决定，不能被串成关卡链。
 *
 * 巡逻关在 `levelInfo` 里是 `levelType=4 / levelMod=2 / chapterStage=0`（如 `60001`），
 * 战斗走 `chapterCellBattleParams`（格子 id 定位），与本绑定只用于「取这一格的关卡行」。
 */
export function bindTerritoryPatrolStages(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
): TerritoryStageBinding[] {
    const stageById = new Map<number, TerritoryCampaignStage>();
    for (let i = 0; i < stages.length; i++) {
        stageById.set(stages[i].levelId, stages[i]);
    }
    const battleByCell = territoryPatrolBattleByCell(sites);
    const bindings: TerritoryStageBinding[] = [];
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        // 关卡 id 优先用 `patrolLevelId`（`monsterBox.monsterBoxLevel` 注入的那一跳）；
        // 没有注入时退回 `battleId`（老地图 / 单测里没带 monsterBox 表的场景）。
        const levelId = site.patrolLevelId ?? battleByCell.get(site.cellId);
        const stage = levelId === undefined ? undefined : stageById.get(levelId);
        if (stage) bindings.push({ site, stage });
    }
    return bindings;
}

function bindStagesForSiteTypes(
    sites: readonly TerritorySite[],
    stages: readonly TerritoryCampaignStage[],
    siteTypes: readonly TerritorySiteType[],
): TerritoryStageBinding[] {
    const stageById = new Map<number, TerritoryCampaignStage>();
    for (let i = 0; i < stages.length; i++) {
        stageById.set(stages[i].levelId, stages[i]);
    }
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
 * 把「区域代表格」的关卡**扩散给同区域的全部站点**。
 *
 * 需要扩散到同区全部站点
 *
 * `bindTerritoryStages` 只给每个 `levelId` 绑**第一个**站点（去重），
 * 于是同一 `configId` 的其余站点 `stageByCell` 查不到 ⇒ 走「`!stage`」分支 ⇒
 * 弹「站点配置待补齐 / 当前 PVP-关卡表中没有可绑定关卡」——
 * 可实际上 `configId` 配了、`levelInfo.json` 里也有那一行，**只是被去重踢掉了**。
 *
 * 不能直接放开 `bindTerritoryStages` 的去重
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
    const stageById = new Map<number, TerritoryCampaignStage>();
    for (let i = 0; i < bindings.length; i++) {
        stageById.set(bindings[i].stage.levelId, bindings[i].stage);
    }
    const byCell = new Map<number, TerritoryCampaignStage>();
    for (const { site, stage } of bindings) byCell.set(site.cellId, stage);
    // 遍历顺序不影响结果（按 cellId 写 Map，后者不覆盖前者即可）；
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
 * 入参必须是 `bindTerritoryStages` 的**去重后**列表（每 `levelId` 恰好一条）。
 * 它把链上的每一步的 `requiredCells` 改写成「上一格的cellId」⇒
 * **链长 = `bindings.length`**。若误传 `expandBindingsToAreaSites` 的结果，
 * 同区域的格子会各自占一步，链会按格子数（而非关卡数）膨胀。
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
    const newSites: TerritorySite[] = [];
    for (let i = 0; i < map.sites.length; i++) {
        const site = map.sites[i];
        const prerequisite = requiredByCell.get(site.cellId);
        if (prerequisite === undefined) {
            newSites.push(site);
        } else {
            newSites.push({
                ...site,
                unlock: { ...site.unlock, requiredCells: [prerequisite] },
            });
        }
    }
    return {
        ...map,
        sites: newSites,
    };
}
