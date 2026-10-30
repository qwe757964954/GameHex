import { RefUtil } from '../../../framework/ref/RefUtil';
import {
    buildTerritoryCampaign,
    TerritoryCardRow,
    TerritoryCampaignStage,
    TerritoryDefenceWaveRow,
    TerritoryGameConfigRow,
    TerritoryLevelRow,
    TerritoryNpcTeamRow,
    TerritoryResourceRow,
    readTerritoryIdleRewardMaxHours,
    readTerritoryLevelAutoStart,
} from './TerritoryCampaignConfig';

/** 把 RefUtil 返回的 unknown[] 收成强类型行表；表名对不上时给空数组而不是崩。 */
function asRows<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

/** 拉取领地/冒险页用到的全部已发布 PVP 表。 */
export async function loadTerritoryCampaign(chapterId: number): Promise<{
    stages: TerritoryCampaignStage[];
    playerCardCount: number;
    idleRewardMaxHours: number;
    /** `gameConfig.chapterLevelAutoStartConfig`：首次激活关卡地块是否自动进战斗。 */
    levelAutoStart: boolean;
}> {
    const [levels, monsters, teams, cards, defenceWaves, items, roleProperties, gameConfig] = await Promise.all([
        RefUtil.instance.getRefAllAsync('levelInfo'),
        RefUtil.instance.getRefAllAsync('monsterCard'),
        RefUtil.instance.getRefAllAsync('npcTeam'),
        RefUtil.instance.getRefAllAsync('pvpCard'),
        RefUtil.instance.getRefAllAsync('defenceModWave'),
        RefUtil.instance.getRefAllAsync('item'),
        RefUtil.instance.getRefAllAsync('roleProperty'),
        RefUtil.instance.getRefAllAsync('gameConfig'),
    ]);
    const resourceRows = asRows<TerritoryResourceRow>(items).concat(asRows<TerritoryResourceRow>(roleProperties));
    return {
        ...buildTerritoryCampaign(
            asRows<TerritoryLevelRow>(levels),
            asRows<TerritoryCardRow>(monsters),
            asRows<TerritoryNpcTeamRow>(teams),
            asRows<TerritoryCardRow>(cards),
            chapterId,
            asRows<TerritoryDefenceWaveRow>(defenceWaves),
            resourceRows,
        ),
        idleRewardMaxHours: readTerritoryIdleRewardMaxHours(asRows<TerritoryGameConfigRow>(gameConfig)),
        levelAutoStart: readTerritoryLevelAutoStart(asRows<TerritoryGameConfigRow>(gameConfig)),
    };
}
