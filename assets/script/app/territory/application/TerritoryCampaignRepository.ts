import { RefUtil } from '../../../framework/ref/RefUtil';
import {
    buildTerritoryCampaign,
    readTerritoryGuardMonsters,
    TerritoryCardRow,
    TerritoryCampaignStage,
    TerritoryDefenceWaveRow,
    TerritoryGameConfigRow,
    TerritoryGuardMonster,
    TerritoryLevelRow,
    TerritoryNpcTeamRow,
    TerritoryResourceRow,
    readTerritoryIdleRewardMaxHours,
    readTerritoryLevelAutoStart,
} from '../model/TerritoryCampaignConfig';
import { ROLE_PROPERTY_TABLE, ITEM_TABLE } from '../../../core/config/TableNames';
import {
    lowestGradeOf,
    readTerritoryMonsterBoxGroups,
    type ITerritoryMonsterBoxGroup,
} from '../../territory/model/TerritoryMonsterBoxConfig';

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
    /**
     * 巡逻宝箱组 → 关卡 id（`monsterBox.monsterBoxId → monsterBox.monsterBoxLevel`）。
     *
     * 地图上的 `site.battleId`（如 `1002`）是**宝箱组 id**，不是 `levelInfo.levelId`；
     * 少这一跳会让巡逻宝箱永远绑不到关卡（「开始挑战」恒灰、点格子弹「站点配置待补齐」）。
     * 取该组**最低等级**那行的 `monsterBoxLevel`。
     */
    patrolLevelIdByBattleId: ReadonlyMap<number, number>;
    /**
     * 宝箱组 id → 该组全部等级行（升级消耗 / 成功率 / 失败上限 / 奖励池 / 对应关卡）。
     *
     * 面板的数值全部从这里读 —— 别再往  里补猜的常量。
     */
    monsterBoxGroups: ReadonlyMap<number, ITerritoryMonsterBoxGroup>;
    /**
     * 关卡 id → 守护怪（`levelInfo.levelMonsterGroup` → `monsterCard.headIcon`）。
     *
     * 巡逻宝箱面板的守护怪头像读它：`monsterBox.monsterBoxLevel` 定位关卡再取前几只。
     * 全表建表（不按章过滤）—— 宝箱组的等级行可能指向本章之外的关卡 id。
     */
    monsterGroupByLevelId: ReadonlyMap<number, readonly TerritoryGuardMonster[]>;
}> {
    const [levels, monsters, teams, cards, defenceWaves, items, roleProperties, gameConfig, monsterBoxes] = await Promise.all([
        RefUtil.instance.getRefAllAsync('levelInfo'),
        RefUtil.instance.getRefAllAsync('monsterCard'),
        RefUtil.instance.getRefAllAsync('npcTeam'),
        RefUtil.instance.getRefAllAsync('pvpCard'),
        RefUtil.instance.getRefAllAsync('defenceModWave'),
        RefUtil.instance.getRefAllAsync(ITEM_TABLE),
        RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE),
        RefUtil.instance.getRefAllAsync('gameConfig'),
        // 缺这张表只让巡逻宝箱绑不到关卡（按钮置灰），不阻断整章加载。
        RefUtil.instance.getRefAllAsync('monsterBox').catch(() => []),
    ]);
    const resourceRows = asRows<TerritoryResourceRow>(items).concat(asRows<TerritoryResourceRow>(roleProperties));
    const monsterBoxGroups = readTerritoryMonsterBoxGroups(monsterBoxes);
    const levelRows = asRows<TerritoryLevelRow>(levels);
    const monsterRows = asRows<TerritoryCardRow>(monsters);
    return {
        ...buildTerritoryCampaign(
            levelRows,
            monsterRows,
            asRows<TerritoryNpcTeamRow>(teams),
            asRows<TerritoryCardRow>(cards),
            chapterId,
            asRows<TerritoryDefenceWaveRow>(defenceWaves),
            resourceRows,
        ),
        idleRewardMaxHours: readTerritoryIdleRewardMaxHours(asRows<TerritoryGameConfigRow>(gameConfig)),
        levelAutoStart: readTerritoryLevelAutoStart(asRows<TerritoryGameConfigRow>(gameConfig)),
        patrolLevelIdByBattleId: patrolLevelIdMapOf(monsterBoxGroups),
        monsterBoxGroups,
        monsterGroupByLevelId: readTerritoryGuardMonsters(levelRows, monsterRows),
    };
}

/** 宝箱组 → 最低等级的关卡 id（供 `bindTerritoryPatrolStages` 用）。 */
function patrolLevelIdMapOf(
    groups: ReadonlyMap<number, ITerritoryMonsterBoxGroup>,
): ReadonlyMap<number, number> {
    const map = new Map<number, number>();
    for (const [id, group] of groups) {
        const lowest = lowestGradeOf(group);
        if (lowest && lowest.levelId > 0) map.set(id, lowest.levelId);
    }
    return map;
}
