import { JsonAsset } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { readRoleRow } from '../../main/MainRoleRow';
import { toIdString } from '../../net/RequestGuard';
import { configureTerritoryMap } from '../model/TerritoryMapConfig';
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
 * 2. 逐章读地图 JSON（只取 `name` + 站点格）—— 读不到就当「这章还没做内容」；
 * 3. 逐章读本地存档的已占领格，交给 {@link buildChapterSelectRows} 算百分比与状态。
 *
 * 资源用 `has()` 预检：Cocos 对不在索引里的路径抛的是
 * `Bundle resources doesn't contain …`（不是 404），直接 load 会在
 * 「列表要比可切章节多看一章」时刷一条误导性 error。
 */

/** 章节存档的账号作用域（与 `TerritoryEntry` 同一口径）。 */
function readSaveOwner(): ITerritorySaveOwner | null {
    const role = readRoleRow();
    return role
        ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) }
        : null;
}

async function loadMapInfo(
    assets: AssetService,
    chapterId: number,
): Promise<IChapterSelectMapInfo | null> {
    const path = territoryMapPath(chapterId);
    try {
        if (!await assets.has(path, JsonAsset)) return null;
        const asset = await assets.load(path, JsonAsset);
        const map = configureTerritoryMap(asset.json);
        return { name: map.name, siteCells: map.sites.map((site) => site.cellId) };
    } catch (error) {
        console.warn(`[ChapterSelect] 章节 ${chapterId} 地图读取失败，按未开放处理`, error);
        return null;
    }
}

/**
 * 组装弹窗列表。
 *
 * @param assets MainPage 的展示资源入口（带页面作用域，页面销毁时自动释放）
 * @param currentChapterId 运行时当前章节（模型输出的 `state.chapterId`）
 */
export async function loadChapterSelectRows(
    assets: AssetService,
    currentChapterId: number,
): Promise<IChapterSelectRow[]> {
    const availableChapters = TerritoryChapterInfoRepository.instance.availableChapters;
    let highest = 0;
    for (const chapterId of availableChapters) if (chapterId > highest) highest = chapterId;
    if (highest === 0) highest = 1;

    const chapterIds = Array.from({ length: highest + 1 }, (_, index) => index + 1);
    const store = new TerritorySaveStore(readSaveOwner());
    const [infos, ownedCells] = await Promise.all([
        Promise.all(chapterIds.map((chapterId) => loadMapInfo(assets, chapterId))),
        Promise.resolve(chapterIds.map((chapterId) => store.load(chapterId).progress.ownedCells ?? [])),
    ]);

    const maps = new Map<number, IChapterSelectMapInfo>();
    const cells = new Map<number, readonly number[]>();
    chapterIds.forEach((chapterId, index) => {
        const info = infos[index];
        if (info) maps.set(chapterId, info);
        cells.set(chapterId, ownedCells[index]);
    });
    return buildChapterSelectRows(availableChapters, currentChapterId, maps, cells);
}
