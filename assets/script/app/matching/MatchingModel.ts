import { applyUnitToPlayerView, splitBattleUnits, type MatchProfileLookup, type ZCBattleStart } from '../battle/BattleStartModel';
import { applyPvpInfoToPlayerView, type ZCPvpInfo } from '../battle/PvpInfoModel';
import type { MatchPhase, MatchPlayerData } from './MatchTypes';

export interface IMatchingViewState {
    readonly phase: MatchPhase;
    readonly mine: MatchPlayerData;
    readonly opponents: readonly MatchPlayerData[];
}
/** 本轮匹配的权威数据；不读全局最近开战缓存。 */
export class MatchingModel {
    battle: ZCBattleStart | null = null;
    pvp: ZCPvpInfo | null = null;
    phase: MatchPhase = 'searching';
    constructor(private readonly base: MatchPlayerData, readonly selfRoleId: string | undefined, private readonly lookup: MatchProfileLookup | null) {}
    snapshot(): IMatchingViewState {
        const teams = this.battle ? splitBattleUnits(this.battle.units, this.selfRoleId) : null;
        const withPvp = applyPvpInfoToPlayerView(this.base, this.pvp, this.lookup);
        const mine = applyUnitToPlayerView(withPvp, teams?.mine ?? null, this.lookup);
        const empty: MatchPlayerData = { name: '', avatarIcon: '', power: 0, rank: '', trophy: 0, artifactName: '', artifactIcon: '', stats: [] };
        return { phase: this.phase, mine, opponents: teams?.enemy ? [applyUnitToPlayerView(empty, teams.enemy, this.lookup)] : [] };
    }
}
