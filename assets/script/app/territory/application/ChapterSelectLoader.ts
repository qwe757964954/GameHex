import { JsonAsset } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { readRoleRow } from '../../main/MainRoleRow';
import { toIdString } from '../../net/RequestGuard';
import { configureTerritoryMap, TERRITORY_SITE_TYPE } from '../model/TerritoryMapConfig';
import type { TerritorySite } from '../model/TerritoryMapConfig';
import { TerritorySaveStore } from '../model/TerritorySaveStore';
import type { ITerritorySaveOwner } from '../model/TerritorySaveStore';
import { buildChapterSelectRows } from '../model/ChapterSelectRows';
import type { IChapterSelectMapInfo, IChapterSelectRow } from '../model/ChapterSelectRows';
import { TerritoryChapterInfoRepository } from './TerritoryChapterInfoRepository';
import { territoryMapPath } from './TerritoryPageAssets';

/**
 * 章节选择弹窗的数据装配（**唯一允许碰资源加载的地方**，消费方只拿归一后的行）。
 *
 * 三步：
 * 1. `TerritoryChapterInfoRepository.availableChapters` 决定哪些章可切；
 * 2. 读取 chapterName / levelInfo 配表；逐章读地图 JSON（名称兜底 + 站点格 + 最后首领格）；
 * 3. 逐章读本地存档的已占领格，交给 {@link buildChapterSelectRows} 算百分比与状态。
 *
 * 资源用 `has()` 预检：Cocos 对不在索引里的路径抛的是
 * `Bundle resources doesn't contain …`（不是 404），直接 load 会在
 * 「列表要比可切章节多看一章」时刷一条误导性 error。
 */

interface IChapterNameConfig {
    readonly chapterId: number;
    readonly chapterName: string;
}

/**
 * `levelInfo` 里判「最后一个首领」只需要四个字段（其余列读不读都一样）。
 *
 * 🔴 首领 = `levelMod === 2`（塔防）。这是 `buildTerritoryCampaign` 里
 *   `mode = row.levelMod === 2 ? 'defence' : 'match'` / `isBoss: mode === 'defence'`
 *   的同一条判据，两处必须同源，否则弹窗的「已通关」会和 HUD 的通关判据打架。
 */
interface ILevelStageRow {
    readonly levelId: number;
    readonly levelChapter: number;
    readonly chapterStage: number;
    readonly levelMod: number;
}

/**
 * 本章**最后一个首领关卡**的 `levelId`（2026-11-04：章节通关 = 通过这一关）。
 *
 * 排序口径与 `chapterFinalBossCell` 一致：先 `chapterStage`、再 `levelId`
 * （`levelId` 是全局号，同章内不单调）。一章没有首领 ⇒ `null`。
 */
function finalBossLevelIdOf(levels: readonly ILevelStageRow[], chapterId: number): number | null {
    let best: ILevelStageRow | null = null;
    for (const row of levels) {
        if (row.levelChapter !== chapterId || row.levelMod !== 2) continue;
        if (!best) {
            best = row;
            continue;
        }
        // 三级比较：先「第几关」，同关再按 levelId（全局号，同章内不单调）。
        const cmp = row.chapterStage - best.chapterStage || row.levelId - best.levelId;
        if (cmp > 0) best = row;
    }
    return best ? best.levelId : null;
}

/**
 * 章节存档的账号作用域（与 `TerritoryEntry` 同一口径）。
 *
 * 导出给 `MainPage` 用：它要读账号级的「已通关领地关卡」（战斗宝箱入口的开启条件），
 * 那份存档跟章节存档同一个命名空间 —— 两处各拼一份 `server:…:role:…` 迟早会飘。
 */
export function readTerritorySaveOwner(): ITerritorySaveOwner | null {
    const role = readRoleRow();
    return role
        ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) }
        : null;
}

/**
 * 「同一片战斗区域占多格」的组（完成度要把整片一起算通关）。
 *
 * 口径必须与 `TerritoryProgress.areaPeers` / `isAreaPassed` **完全一致**：
 * `type ∈ {stage, boss, asyncPvp}` 且 `configId` 是非空数字串。
 * 资源据点（`fixedResource` 同 `configId` 有多格，比如 chapter_01 的 `fixedResource_173`
 * 占 173/195/174）**不参与** —— 它们是各自独立的据点，占了其中一格不代表另外两格也通。
 *
 * 只收长度 > 1 的组：单格站点没有"扩散"可言，白占内存。
 */
function buildAreaGroups(sites: readonly TerritorySite[]): number[][] {
    const groups = new Map<string, number[]>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.stage
            && site.type !== TERRITORY_SITE_TYPE.boss
            && site.type !== TERRITORY_SITE_TYPE.asyncPvp) continue;
        const configId = site.configId;
        if (typeof configId !== 'string' || !/^\d+$/.test(configId)) continue;
        const group = groups.get(configId);
        if (group) group.push(site.cellId);
        else groups.set(configId, [site.cellId]);
    }
    const result: number[][] = [];
    for (const group of groups.values()) if (group.length > 1) result.push(group);
    return result;
}

async function loadMapInfo(
    assets: AssetService,
    chapterId: number,
    levels: readonly ILevelStageRow[],
): Promise<IChapterSelectMapInfo | null> {
    const path = territoryMapPath(chapterId);
    try {
        if (!await assets.has(path, JsonAsset)) return null;
        const asset = await assets.load(path, JsonAsset);
        const map = configureTerritoryMap(asset.json);
        // 首领关卡的 `configId` = 该关 `levelId` 字符串；同一关可能占多格（整片区域算通过），
        // 所以把同 `configId` 的格子全部收进来 —— 玩家打了区域里任意一格都算通了这一关。
        const bossLevelId = finalBossLevelIdOf(levels, chapterId);
        const bossConfigId = bossLevelId === null ? '' : String(bossLevelId);
        const finalBossCells = bossConfigId
            ? map.sites.filter((site) => site.configId === bossConfigId).map((site) => site.cellId)
            : [];
        return {
            name: map.name,
            siteCells: map.sites.map((site) => site.cellId),
            areaGroups: buildAreaGroups(map.sites),
            ...(finalBossCells.length ? { finalBossCells } : {}),
        };
    } catch (error) {
        console.warn(`[ChapterSelect] 章节 ${chapterId} 地图读取失败，按未开放处理`, error);
        return null;
    }
}

/**
 * 组装弹窗列表。
 *
 * @param resources MainPage 的展示资源与配置入口（资源带页面作用域）
 * @param currentChapterId 运行时当前章节（模型输出的 `state.chapterId`）
 */
export async function loadChapterSelectRows(
    resources: Pick<IControllerResources, 'assets' | 'configs'>,
    currentChapterId: number,
): Promise<IChapterSelectRow[]> {
    const availableChapters = TerritoryChapterInfoRepository.instance.availableChapters;
    // 全部章节数 = 配表 chapterName 的最大 chapterId（配表是章节全集）；配表缺失或
    // 服务端可切章节超出配表范围时，以两者较大者为准，保证已解锁的章一定有行。
    const [chapterConfigs, levels] = await Promise.all([
        resources.configs.getTable<IChapterNameConfig>('chapterName'),
        // 2026-11-04：章节通关 = 通过本章最后一个首领关卡 ⇒ 弹窗要能认出那一关占哪些格。
        // 读不回来就退化成空表（`finalBossCells` 缺省 ⇒ 行状态退回占领率口径）。
        resources.configs.getTable<ILevelStageRow>('levelInfo'),
    ]);
    let totalChapters = 0;
    for (const row of chapterConfigs) if (row.chapterId > totalChapters) totalChapters = row.chapterId;
    let highest = 0;
    for (const chapterId of availableChapters) if (chapterId > highest) highest = chapterId;
    if (totalChapters < highest) totalChapters = highest;
    if (totalChapters === 0) totalChapters = 1;

    const chapterIds = Array.from({ length: totalChapters }, (_, index) => index + 1);
    const store = new TerritorySaveStore(readTerritorySaveOwner());
    const [infos, ownedCells] = await Promise.all([
        Promise.all(chapterIds.map((chapterId) => loadMapInfo(resources.assets, chapterId, levels))),
        Promise.resolve(chapterIds.map((chapterId) => store.load(chapterId).progress.ownedCells ?? [])),
    ]);

    const maps = new Map<number, IChapterSelectMapInfo>();
    const cells = new Map<number, readonly number[]>();
    chapterIds.forEach((chapterId, index) => {
        const info = infos[index];
        if (info) maps.set(chapterId, info);
        cells.set(chapterId, ownedCells[index]);
    });
    const chapterNames = new Map(chapterConfigs.map((row) => [row.chapterId, row.chapterName]));
    return buildChapterSelectRows(availableChapters, currentChapterId, maps, cells, chapterNames, totalChapters);
}
