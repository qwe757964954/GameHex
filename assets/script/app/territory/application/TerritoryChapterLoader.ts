import type { AssetService } from '../../../core/asset/AssetService';
import type {
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
} from './TerritoryPresenter';
import {
    loadTerritoryBattleArt,
    loadTerritoryMapJson,
} from './TerritoryPageAssets';
import { loadTerritoryCampaign } from '../model/TerritoryCampaignRepository';
import { configureTerritoryMap } from '../model/TerritoryMapConfig';

/**
 * 章节加载适配器：把「资源入口 + 地图 JSON + campaign + 美术」打包成 {@link ITerritoryChapterBundle}。
 *
 *  唯一允许碰 cc / RefUtil 的加载路径。Presenter 只消费归一化后的结构，不感知资源加载方式。
 *  地图 JSON 拉不到（≠ 单张美术缺失）返回 `null`，Presenter 展示加载失败。
 */
export class TerritoryChapterLoader implements ITerritoryChapterLoader {
    constructor(private readonly assets: AssetService) {}

    async load(chapterId: number): Promise<ITerritoryChapterBundle | null> {
        const [mapJson, campaign] = await Promise.all([
            loadTerritoryMapJson(this.assets, chapterId),
            loadTerritoryCampaign(chapterId),
        ]);
        if (mapJson == null) return null;
        // 先解析地图拿 background，再决定背景图路径；单张美术缺失由 loadTerritoryBattleArt 内部回落。
        const sourceMap = configureTerritoryMap(mapJson);
        const art = await loadTerritoryBattleArt(this.assets, sourceMap.background);
        return {
            mapJson,
            campaign: {
                stages: campaign.stages,
                playerCardCount: campaign.playerCardCount,
                idleRewardMaxHours: campaign.idleRewardMaxHours,
            },
            art,
        };
    }
}
