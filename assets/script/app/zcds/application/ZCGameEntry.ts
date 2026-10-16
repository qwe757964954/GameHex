import type { ZCGamePreparedResources } from './ZCGameLoader';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { IRankSeatProfile } from '../model/ZCRankBoard';
import type { ZCOwner } from '../model/ZCMapConfig';

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
    readonly pveContext: IZCGamePveContext | null;
}
