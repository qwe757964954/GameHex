import type { ZCGamePreparedResources } from './ZCGameLoader';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { IRankSeatProfile } from '../model/ZCRankBoard';
import type { ZCOwner } from '../model/ZCMapConfig';
import type { IZCSlgBattleType } from '../../battle/BattleStartModel';

export interface IZCGamePveContext {
    readonly chapterId: number;
    readonly territoryCellId: number;
    readonly levelId: number;
    readonly onResult: (victory: boolean) => void;
}

/** 单局启动所需数据；由 ProcedureGame 组装，再交给 ZCGame 实例消费。 */
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
