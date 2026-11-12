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
 * 扫荡目标查询用到的进度子集。
 *
 * ⚠️ 用**结构子集**而不是 `TerritoryProgress`：视图层拿到的是
 * `ITerritoryProgressView`（`Pick` 出来的只读查询），它不是类实例、传不进原签名。
 * 与 `TerritoryChestHint` 的「最小进度视图」同一处置。
 */
export interface ITerritoryStagePassQuery {
    isAreaPassed(cellId: number): boolean;
    isDisabled(cellId: number): boolean;
}

/**
 * 「**已通关**的最高关卡格」—— 征收扫荡的目标格（山猫 2026-11-09 口径）。
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
 * 本章**最后一个首领关卡**的格子 —— 章节通关的判据（2026-11-04 用户口径）。
 *
 * > 「章节通关条件：通过该章节的最后 1 个 boss 关卡」*（异步据点**不**参与判定）*
 *
 * ## 为什么按 `stage.stage` 而不是 `levelId`
 * `levelInfo` 的 `levelId` 是全局号，同一章里不一定单调（chapter_01 的 20001 排在 10010 之后）；
 * 而 `stage.stage` 就是策划表里的「第几关」，**线性推进链**（`applyTerritoryStageUnlocks`）
 * 也是按它排序的 ⇒ 取 `stage` 最大的那个 boss，才是链尾那一关。
 * 同 `stage` 撞车时按 `levelId`、再按 `cellId` 兜底，结果不依赖入参顺序。
 *
 * ## 为什么只认 `bindings`
 * `bindings` = `bindTerritoryStages`（stage + boss，按 `levelId` 去重）。它天然排除了两类
 * **打不了**的站点：没绑关卡的（`configId` 缺 / 表里没这一行）和异步据点。
 * 拿"打不了的格子"当通关门槛 = 这一章永远通不了、下一章永远锁着 —— 死锁比漏判严重得多。
 *
 * 一章配了多个 boss（chapter_01 有 stage 5 / stage 10）⇒ 取**最后**那个，
 * 这也是「链尾打完才算通关」的本意：前面那个 boss 通不通不影响。
 *
 * @returns `null` = 本章一个可打的首领都没有（配置缺失）。调用方必须**退回**旧口径
 *          「全部站点占领」，别把它当成"已经通关"。
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
