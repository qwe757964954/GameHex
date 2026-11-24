import {
    applyUnitToPlayerView, splitBattleUnits, type MatchProfileLookup, type ZCBattleStart, type ZCBattleUnit,
} from '../battle/BattleStartModel';
import { applyPvpInfoToPlayerView, type ZCPvpInfo } from '../battle/PvpInfoModel';
import { matchSlotCount } from './MatchSlots';
import type { MatchPhase, MatchPlayerData } from './MatchTypes';

export interface IMatchingViewState {
    readonly phase: MatchPhase;
    readonly mine: MatchPlayerData;
    readonly opponents: readonly MatchPlayerData[];
    /** 展示席位数，按预期席位与已确认参战人数取较大值，再由 MatchSlots 限定范围。 */
    readonly slots: number;
}
/** 本轮匹配的权威数据；不读全局最近开战缓存。 */
export class MatchingModel {
    private accepted: {
        readonly battle: ZCBattleStart;
        readonly mine: ZCBattleUnit;
        readonly opponents: readonly ZCBattleUnit[];
    } | null = null;
    private pvp: ZCPvpInfo | null = null;
    private hasElapsedMinimumSearchTime = false;

    constructor(
        private readonly base: MatchPlayerData,
        readonly selfRoleId: string | undefined,
        private readonly lookup: MatchProfileLookup | null,
        private readonly roomSeats: number | null = null,
    ) {}

    get battle(): ZCBattleStart | null {
        return this.accepted?.battle ?? null;
    }

    private get phase(): MatchPhase {
        return this.accepted && this.hasElapsedMinimumSearchTime ? 'matched' : 'searching';
    }

    updatePvpInfo(info: ZCPvpInfo | null): void {
        this.pvp = info;
    }

    acceptBattleResult(battle: ZCBattleStart | null): MatchPhase | 'rejected' | 'ignored' {
        if (this.accepted) return 'ignored';
        if (!battle) return 'rejected';

        const { mine } = splitBattleUnits(battle.units, this.selfRoleId);
        // 匹配页展示除我方外的所有参战单元，splitBattleUnits.enemy 只代表其中一个。
        const opponents = battle.units.filter(unit => unit !== mine);
        if (!mine || opponents.length === 0) return 'rejected';
        this.accepted = { battle, mine, opponents };
        return this.phase;
    }

    /** 仅在本次输入使阶段推进到 matched 时返回 true。 */
    elapseMinimumSearchTime(): boolean {
        if (this.hasElapsedMinimumSearchTime) return false;
        this.hasElapsedMinimumSearchTime = true;
        return this.phase === 'matched';
    }

    snapshot(): IMatchingViewState {
        const withPvp = applyPvpInfoToPlayerView(this.base, this.pvp, this.lookup);
        const mine = applyUnitToPlayerView(withPvp, this.accepted?.mine ?? null, this.lookup);
        const empty: MatchPlayerData = { name: '', avatarIcon: '', power: 0, rank: '', trophy: 0, artifactName: '', artifactIcon: '', stats: [], cards: [] };
        return {
            phase: this.phase,
            mine,
            opponents: this.accepted?.opponents.map(unit => applyUnitToPlayerView(empty, unit, this.lookup)) ?? [],
            slots: matchSlotCount(this.roomSeats, this.battle?.units.length ?? 0),
        };
    }
}
