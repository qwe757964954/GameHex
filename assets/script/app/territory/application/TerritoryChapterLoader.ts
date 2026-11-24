import type { AssetService } from '../../../core/asset/AssetService';
import type {
    ITerritoryChapterBundle,
    ITerritoryChapterLoader,
} from './TerritoryModel';
import {
    loadTerritoryBattleArt,
    loadTerritoryMapJson,
} from './TerritoryPageAssets';
import { loadTerritoryCampaign } from './TerritoryCampaignRepository';
import { configureTerritoryMap } from '../model/TerritoryMapConfig';
import { TERRITORY_PATROL_OUTLINE_EFFECT_PATH } from '../model/TerritoryMonsterPatrol';
import { parsePrefabSize } from '../../zcds/model/ZCPvpTableParser';
import { EffectAsset, Material, Prefab } from 'cc';
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
        const monsterIds = new Set<number>();
        for (let i = 0; i < sourceMap.sites.length; i++) {
            const patrolId = sourceMap.sites[i].patrolId;
            if (patrolId !== undefined && patrolId !== null) monsterIds.add(patrolId);
        }
        const monsterPrefabs = new Map<number, Prefab>();
        //  巡逻野怪的体型系数（`monsterCard.prefabSize`）：与战斗内单位同一列、同一个解析口径
        //  （留空 1、0/负数抛）。这里必须和 prefab 一起取 —— 视图只拿到 prefab 时
        //  只能按骨架高度做「塞进六边格」的技术归一，体型差（冰霜巨龙 1.5 / 豌豆游侠 0.8）
        //  会整个丢掉，画出来所有怪一样大。
        const monsterPrefabSizes = new Map<number, number>();
        if (monsterIds.size) {
            const rows = await RefUtil.instance.getRefAllAsync('monsterCard');
            const rowById = new Map<number, { id: number; unitPrefabPath?: string; prefabSize?: unknown }>();
            for (let i = 0; i < rows.length; i++) {
                const item = rows[i] as { id: number; unitPrefabPath?: string; prefabSize?: unknown };
                rowById.set(item.id, item);
            }
            for (const id of monsterIds) {
                const row = rowById.get(id);
                if (!row || typeof row.unitPrefabPath !== 'string' || !row.unitPrefabPath) {
                    throw new Error(`[Territory] 巡逻野怪 ${id} 缺少 monsterCard.unitPrefabPath`);
                }
                monsterPrefabSizes.set(id, parsePrefabSize(row.prefabSize, `monsterCard[${id}].prefabSize`));
                monsterPrefabs.set(id, await this.assets.load(row.unitPrefabPath, Prefab));
            }
        }
        // 巡逻宝箱怪「未挑战成功」要叠暗色 + 红描边，描边是战斗内 `ZCUnitView`
        // 同一份 `shaders/unit-outline-copy`（放大副本把不透明像素压成纯色）。
        // 只有这章真有巡逻怪时才加载：老章节没有 ⇒ 不多一次资源请求。
        // shader 取不到就只压暗、不描边，绝不退化成「一只放大的红色怪」。
        let monsterOutlineMaterial: Material | null = null;
        if (monsterIds.size) {
            try {
                const effect = await this.assets.load(TERRITORY_PATROL_OUTLINE_EFFECT_PATH, EffectAsset);
                if (effect) {
                    const material = new Material();
                    material.initialize({ effectAsset: effect });
                    monsterOutlineMaterial = material;
                }
            } catch (error) {
                console.warn(`[Territory] 巡逻野怪描边 shader 加载失败，本次只压暗不描边：${String(error)}`);
            }
        }
        return {
            mapJson,
            campaign: {
                stages: campaign.stages,
                playerCardCount: campaign.playerCardCount,
                idleRewardMaxHours: campaign.idleRewardMaxHours,
                levelAutoStart: campaign.levelAutoStart,
                patrolLevelIdByBattleId: campaign.patrolLevelIdByBattleId,
                monsterBoxGroups: campaign.monsterBoxGroups,
                monsterGroupByLevelId: campaign.monsterGroupByLevelId,
            },
            art: { ...art, monsterPrefabs, monsterPrefabSizes, monsterOutlineMaterial },
        };
    }
}
