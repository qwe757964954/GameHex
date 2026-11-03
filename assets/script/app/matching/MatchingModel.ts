import { applyUnitToPlayerView, splitBattleUnits, type MatchProfileLookup, type ZCBattleStart } from '../battle/BattleStartModel';
import { applyPvpInfoToPlayerView, type ZCPvpInfo } from '../battle/PvpInfoModel';
import { matchSlotCount } from './MatchSlots';
import type { MatchPhase, MatchPlayerData } from './MatchTypes';

export interface IMatchingViewState {
    readonly phase: MatchPhase;
    readonly mine: MatchPlayerData;
    readonly opponents: readonly MatchPlayerData[];
    /**
     * 本局**实际参与人数**（2~4）= 匹配界面该摆几条信息条。
     *
     * 回包前 = 入口声明 / 本地固定人数（都不知道就是最小值 2）；回包后 = 服务端下发的
     * 参战单元数。页面**只按这个数排**，不许在视图里另写一个数字（见 `MatchSlots`）。
     */
    readonly slots: number;
}
/** 本轮匹配的权威数据；不读全局最近开战缓存。 */
export class MatchingModel {
    battle: ZCBattleStart | null = null;
    pvp: ZCPvpInfo | null = null;
    phase: MatchPhase = 'searching';
    /**
     * @param roomSeats 入口声明 / 本地固定的席位数（`null` = 不知道）。
     *                  只影响"回包前"的排布；回包后一律以 `battle.units` 为准。
     */
    constructor(
        private readonly base: MatchPlayerData,
        readonly selfRoleId: string | undefined,
        private readonly lookup: MatchProfileLookup | null,
        private readonly roomSeats: number | null = null,
    ) {}
    snapshot(): IMatchingViewState {
        const units = this.battle?.units ?? [];
        const teams = this.battle ? splitBattleUnits(units, this.selfRoleId) : null;
        const mineUnit = teams?.mine ?? null;
        const withPvp = applyPvpInfoToPlayerView(this.base, this.pvp, this.lookup);
        const mine = applyUnitToPlayerView(withPvp, mineUnit, this.lookup);
        const empty: MatchPlayerData = { name: '', avatarIcon: '', power: 0, rank: '', trophy: 0, artifactName: '', artifactIcon: '', stats: [] };
        // 🔴 一个席位都不能少：除我方之外**全部**要露出来，只取"第一个敌对单元"的话
        //    3/4 人局就会少显示 1~2 条（用户 2026-11-02 实机：只画了 2 条）。
        //    `teams.mine` 与 `units` 里的是**同一个对象引用**，所以直接按引用排除即可。
        const others = mineUnit ? units.filter((unit) => unit !== mineUnit) : units.slice(1);
        return {
            phase: this.phase,
            mine,
            opponents: others.map((unit) => applyUnitToPlayerView(empty, unit, this.lookup)),
            slots: matchSlotCount(this.roomSeats, units.length),
        };
    }
}
