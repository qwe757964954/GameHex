import type { IZCGamePreparedResources } from './ZCGamePreparedResources';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCPvpRarityModifier } from '../model/ZCPvpTileRules';
import type { IRankSeatProfile } from '../model/ZCRankBoard';
import type { ZCOwner } from '../model/ZCMapConfig';
import type { ZCBattleController } from './ZCBattleController';
import type { ZCGame } from '../ZCGame';
import type { MatchPlayerData } from '../../matching/MatchTypes';
import type { ITerritorySaveOwner } from '../../territory/model/TerritorySaveStore';
import type { ZCBattleStart, IZCSlgBattleType } from '../../battle/BattleStartModel';

export interface IZCGamePveContext {
    readonly chapterId: number;
    readonly territoryCellId: number;
    readonly levelId: number;
}

/** 单局启动所需数据；由 ZCBattleEntryBuilder 组装，再交给 ZCGame 实例消费。 */
export interface IZCGameEntry {
    readonly resources: IZCGamePreparedResources;
    readonly battleSeed: string | null;
    readonly matchConfig: ZCMatchConfig;
    readonly playerAvatars: Readonly<{ player: string; enemy: string }> | null;
    readonly seatProfiles: readonly (readonly [ZCOwner, IRankSeatProfile])[];
    /**
     * 席位 → 服务端战斗单元 id（`CmdBattleUnitInfo.unitId`）。
     *
     * 只服务战斗统计上报（`CmdBattleStatisticsInfo.unitId`，服务端靠它把伤害归属到单元）。
     * 与 {@link seatProfiles} **同一份席位分配逻辑**（`buildSeatUnitIds` 与 `buildSeatProfiles`
     * 共用 `assignSeatUnits`），所以两边不会漂。
     *
     * ⚠️ 可选：无服务端对局的本地模式（没有 `battle.units`）不产出这张表 ——
     * 那时统计里的 `unitId` 只能是 0（"不知道"，不是"0 号单元"）。
     */
    readonly seatUnitIds?: readonly (readonly [ZCOwner, number])[];
    readonly pveContext: IZCGamePveContext | null;
    readonly slgBattleType?: IZCSlgBattleType | null;
    /**
     * 本局的**实际 battleType**（`CmdStartBattleReqMsg.battleType` 那一份），结算等广播用。
     *
     * 由 `buildZCBattleEntry` 从入口参数收敛：`params.battleType` → `params.slgBattleType` → `null`。
     * 领地 PVE 不在这里补 1002（那是**推导**不是入口声明），运行时仍按 `pveContext` 兜底。
     *
     * ⚠️ 漏传的症状是**静默**的：结算不调 `waitResult` ⇒ `result = null` ⇒ 结算页奖励区全空，
     * 且日志里一条错都没有（宝箱栏「开始战斗」曾经就是这样丢奖励的）。
     */
    readonly battleType?: number | null;
}

/** 对局入口模式：PVP 匹配 或 领地守城 PVE。 */
export const ZCGameEntryMode = {
    Match: 'match',
    Defence: 'defence',
} as const;
export type ZCGameEntryMode = (typeof ZCGameEntryMode)[keyof typeof ZCGameEntryMode];

export interface ZCGameEntryParams {
    slgBattleType?: IZCSlgBattleType;
    /**
     * 本局的协议 battleType（1001 PVP / 1002 章节 / 1003 野怪 / 1004 据点）。
     *
     * 匹配入口（`IMatchingEntryParams.battleType`）必须原样透传：结算要按它等
     * `CmdBattleResultBroMsg`，丢一个字段就是「打得完、结算没奖励」。
     */
    battleType?: number;
    opponent?: MatchPlayerData;
    /** 领地/冒险绕过 PVP 匹配，携带关卡数据直接进入本地 PVE。 */
    pve?: {
        levelId: number;
        chapterId: number;
        stage: number;
        territoryCellId: number;
        /** 捕获发起战斗时的存档归属，结算不读取可能已切换的当前角色。 */
        territorySaveOwner: ITerritorySaveOwner | null;
        mode: ZCGameEntryMode;
        enemyName: string;
        /** 关卡 NPC / 塔防波次投影出的 pvpCard ID；为空时沿用默认 AI 卡组。 */
        enemyCardIds: number[];
        /** One card list per matching NPC seat, in enemy/enemy2/enemy3 order. */
        enemyTeamCardIds: readonly (readonly number[])[];
        /** 领地关卡固定玩家与一名 NPC。 */
        playerCount: 2;
        hpRate: number;
        attackRate: number;
        /**
         * `levelInfo.openGrideTime`：「关卡翻地块频率」（秒，0 = 够钱就翻）。
         *
         * 对局内作为 **NPC 翻地块（AI 开发中立格）的最小间隔**：AI 再快也不能比这个字段更快。
         * 缺省 / 0 ⇒ 只受全局 `enemyAiIntervalSeconds` 约束（旧行为）。
         */
        openGrideTime?: number;
        /**
         * `levelInfo.gradeProModifier`：**NPC 席位**翻地块抽卡的品质权重乘数
         * （`{ green: 2, blue: 3 }`）。缺省 / 空 ⇒ 抽卡仍走 `pvpTile.rarityWeights` 原表。
         *
         * 玩家席位不受它影响；金色保底也不受它影响。
         */
        gradeProModifier?: ZCPvpRarityModifier;
        /** 塔防关卡的确定性出怪表；空数组表示该关卡尚无可用波次，回退普通守军 AI。 */
        waves: ReadonlyArray<{
            waveId: number;
            showAtSeconds: number;
            pvpCardId: number;
            monsterCount: number;
            hpRate: number;
            attackRate: number;
            /** BOSS 波（`defenceModWave.monsterType=3`，即每组最后一波）。 */
            isBoss?: boolean;
            /** 怪物体型（`defenceModWave.monsterSize`）：1 普通 / 2 BOSS，出怪时当模型缩放倍率。 */
            monsterSize?: number;
        }>;
    };
    /**
     * 本局的服务端数据（`CmdStartBattleRspMsg` 归一化结果：`battleId` / `seed` / 双方单元）。
     *
     *  拿不到时是 `null` —— 对局照常按本地数据开，不要为它加前置校验。
     *  `seed` 已经接进对局随机源（`ProcedureGame` → `IZCGameEntry.battleSeed` →
     *  `ZCGameModel` 的 `random`）；单元信息由 `ZCClientCombatConfig` 收敛成本局敌我卡池与
     *  武将修改器，`battleId` 用于战绩。协议边界只在 BattleStartModel 解析一次。
     */
    battle?: ZCBattleStart | null;
    /** 本机角色 id，用于把服务端多方单元稳定映射到 player，其余按 campId 映射到本地 AI。 */
    selfRoleId?: string;
    session?: ZCBattleController<ZCGame>;
}
