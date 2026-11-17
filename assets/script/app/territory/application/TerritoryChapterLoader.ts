import type { AssetService } from '../../../core/asset/AssetService';
import type {
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
} from './TerritoryModel';
import {
    loadTerritoryBattleArt,
    loadTerritoryMapJson,
} from './TerritoryPageAssets';
import { loadTerritoryCampaign } from '../model/TerritoryCampaignRepository';
import { configureTerritoryMap } from '../model/TerritoryMapConfig';
import { Prefab } from 'cc';
import { RefUtil } from '../../../framework/ref/RefUtil';

/**
 * 章节加载适配器：把「资源入口 + 地图 JSON + campaign + 美术」打包成 {@link ITerritoryChapterBundle}。
 *
 * 唯一允许碰 cc / RefUtil 的加载路径。Controller 只消费归一化后的结构，不感知资源加载方式。
 * 地图 JSON 拉不到（≠ 单张美术缺失）返回 `null`，Controller 展示加载失败。
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
        const monsterIds = new Set(sourceMap.sites.flatMap(site => site.patrolId ? [site.patrolId] : []));
        const monsterPrefabs = new Map<number, Prefab>();
        if (monsterIds.size) {
            const rows = await RefUtil.instance.getRefAllAsync('monsterCard');
            await Promise.all(Array.from(monsterIds, async (id) => {
                const row = rows.find((item: { id: number }) => item.id === id);
                if (!row || typeof row.unitPrefabPath !== 'string' || !row.unitPrefabPath) {
                    throw new Error(`[Territory] 巡逻野怪 ${id} 缺少 monsterCard.unitPrefabPath`);
                }
                monsterPrefabs.set(id, await this.assets.load(row.unitPrefabPath, Prefab));
            }));
        }
        return {
            mapJson,
            campaign: {
                stages: campaign.stages,
                playerCardCount: campaign.playerCardCount,
                idleRewardMaxHours: campaign.idleRewardMaxHours,
                levelAutoStart: campaign.levelAutoStart,
            },
            art: { ...art, monsterPrefabs },
        };
    }
}
