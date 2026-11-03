import type { ZCGamePreparedResources } from './ZCGameLoader';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
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
    readonly resources: ZCGamePreparedResources;
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
}

/** 对局入口模式：PVP 匹配 或 领地守城 PVE。 */
export const ZCGameEntryMode = {
    Match: 'match',
    Defence: 'defence',
} as const;
export type ZCGameEntryMode = (typeof ZCGameEntryMode)[keyof typeof ZCGameEntryMode];

export interface ZCGameEntryParams {
    slgBattleType?: IZCSlgBattleType;
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
        /** 塔防关卡的确定性出怪表；空数组表示该关卡尚无可用波次，回退普通守军 AI。 */
        waves: ReadonlyArray<{
            waveId: number;
            showAtSeconds: number;
            pvpCardId: number;
            monsterCount: number;
            hpRate: number;
            attackRate: number;
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
