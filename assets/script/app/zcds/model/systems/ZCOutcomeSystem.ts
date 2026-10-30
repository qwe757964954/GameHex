import type { ZCPveDefenceConfig } from '../ZCMatchConfig';
import { ZC_OWNER_ORDER, ZCOwner } from '../ZCMapConfig';
import type { ZCGameStatus, ZCScoreBreakdown, ZCSnapshot } from '../ZCGameTypes';

export type IZCOutcomeState = Pick<ZCSnapshot, 'hexes' | 'units' | 'status' | 'elapsedSeconds' | 'durationSeconds'>;

export interface IZCOutcomeContext {
    readonly activeOwners: readonly ZCOwner[];
    readonly pveDefence: Readonly<ZCPveDefenceConfig> | null;
    homeId(owner: ZCOwner): number;
}

export interface IZCOutcomeResult {
    readonly status: Exclude<ZCGameStatus, 'playing'>;
    readonly reason: string;
    /**
     * **真正的胜方**（`draw` 时为 `null`）。
     *
     * 为什么不能靠 `status` 反推：`status` 是**以我方视角**的二值（victory / defeat），
     * 4 人局里「我方出局」既可能是 2 号红方赢，也可能是 4 号紫方赢，两者 status 都是 `defeat`。
     * 结算胜利扫场要按**胜方本色**铺地（2026-10-28 用户口径「结算胜利动画的颜色应该对应
     * 胜利玩家的颜色」），红方色铺在紫方赢的局上就是错的 —— 所以身份必须在这里定下来，
     * 不能留给视图猜。
     */
    readonly winner: ZCOwner | null;
}

/** 结算四项的排序优先级（领地 → 主城血量 → 兵种数量 → 兵种总血量）。 */
const OUTCOME_FIELDS: ReadonlyArray<{ key: keyof ZCScoreBreakdown; label: string }> = [
    { key: 'territory', label: '占领地块' },
    { key: 'mainCityHp', label: '主城血量' },
    { key: 'unitCount', label: '兵种数量' },
    { key: 'totalUnitHp', label: '兵种总血量' },
];

/** 两份结算数据按 `OUTCOME_FIELDS` 逐项比；0 = 四项完全相同。 */
function compareScores(left: ZCScoreBreakdown, right: ZCScoreBreakdown): number {
    for (const field of OUTCOME_FIELDS) {
        if (left[field.key] !== right[field.key]) return left[field.key] - right[field.key];
    }
    return 0;
}

/** Reads the current match snapshot and returns a result; committing it remains the model's job. */
export class ZCOutcomeSystem {
    static scoreFor(state: IZCOutcomeState, owner: ZCOwner, homeId: number): ZCScoreBreakdown {
        const units = state.units.filter((unit) => unit.owner === owner && unit.battleState !== 'dead');
        return {
            territory: state.hexes.filter((hex) => hex.owner === owner).length,
            mainCityHp: Math.max(0, state.hexes[homeId]?.hp || 0),
            unitCount: units.length,
            totalUnitHp: Math.round(units.reduce((total, unit) => total + Math.max(0, unit.hp), 0)),
        };
    }

    static checkOutcome(state: IZCOutcomeState, context: IZCOutcomeContext, nextDefenceWaveIndex: number): IZCOutcomeResult | null {
        if (state.status !== 'playing') return null;
        if (context.pveDefence) {
            const playerHome = state.hexes[context.homeId(ZCOwner.Player)];
            if (!playerHome || playerHome.owner !== ZCOwner.Player || playerHome.building !== 'hq' || playerHome.hp <= 0) {
                // 塔防失败没有「PvP 胜方」，扫场仍按敌方色铺（= 现存行为），显式写出来免得被当成漏填。
                return { status: 'defeat', reason: '塔防失败：我方主城领地已失守。', winner: ZCOwner.Enemy };
            }
            const allWavesSpawned = nextDefenceWaveIndex >= context.pveDefence.waves.length;
            const aliveEnemies = state.units.some((unit) => unit.owner !== ZCOwner.Player && unit.battleState !== 'dead');
            return allWavesSpawned && !aliveEnemies
                ? { status: 'victory', reason: `塔防胜利：已击退全部 ${context.pveDefence.waves.length} 波守军。`, winner: ZCOwner.Player }
                : null;
        }
        const developedCount = (owner: ZCOwner): number => state.hexes.filter((hex) =>
            hex.owner === owner && hex.building !== 'none' && hex.hp > 0).length;
        if (context.activeOwners.slice(1).every((owner) => developedCount(owner) === 0)) {
            return { status: 'victory', reason: '强攻胜利：全部对手的已开发地块归零！', winner: ZCOwner.Player };
        }
        if (developedCount(ZCOwner.Player) === 0) {
            // 我方被打光 ⇒ 胜方是**还站着的那个人**（不是写死的 2 号席）。4 人局里可能是
            // `enemy` / `enemy2` / `enemy3`，靠 `developedCount > 0` 过滤出一个子集再比四项。
            // 走 `checkOutcome` 走到这里时至少有一个对手还有地（上面那条已经排除了全归零）。
            const survivors = this.rankOwners(
                state,
                context.activeOwners.filter((owner) => owner !== ZCOwner.Player && developedCount(owner) > 0),
                context,
            );
            return {
                status: 'defeat',
                reason: '战斗失败：我方已开发地块归零。',
                winner: survivors.length ? this.leaderOf(survivors).best.owner : null,
            };
        }
        if (state.elapsedSeconds < state.durationSeconds) return null;
        return this.compareScores(state, context);
    }

    /** 按 `scoreFor` 给一批席位打分（顺序保持传入顺序，供 `leaderOf` 做稳定排序）。 */
    private static rankOwners(
        state: IZCOutcomeState,
        owners: readonly ZCOwner[],
        context: IZCOutcomeContext,
    ): Array<{ owner: ZCOwner; score: ZCScoreBreakdown }> {
        return owners.map((owner) => ({ owner, score: this.scoreFor(state, owner, context.homeId(owner)) }));
    }

    /** 四项比较后的头名与「与之全等」的席位（`tied.length > 1` ⇒ 平局）。 */
    private static leaderOf(
        entries: ReadonlyArray<{ owner: ZCOwner; score: ZCScoreBreakdown }>,
    ): { best: { owner: ZCOwner; score: ZCScoreBreakdown }; tied: Array<{ owner: ZCOwner; score: ZCScoreBreakdown }> } {
        const best = entries.slice().sort((a, b) => compareScores(b.score, a.score))[0];
        return { best, tied: entries.filter((entry) => compareScores(entry.score, best.score) === 0) };
    }

    private static compareScores(state: IZCOutcomeState, context: IZCOutcomeContext): IZCOutcomeResult {
        const player = this.scoreFor(state, ZCOwner.Player, context.homeId(ZCOwner.Player));
        const scores = this.rankOwners(state, context.activeOwners, context);
        const { best, tied } = this.leaderOf(scores);
        if (tied.length > 1) {
            return { status: 'draw', reason: `${tied.length} 方四项结算数据完全相同，本局平局。`, winner: null };
        }
        const won = best.owner === ZCOwner.Player;
        const comparison = won
            ? scores.filter((entry) => entry.owner !== ZCOwner.Player).sort((a, b) => compareScores(b.score, a.score))[0]?.score
            : best.score;
        const decisive = OUTCOME_FIELDS.find((field) => comparison && player[field.key] !== comparison[field.key]);
        const ownerName = best.owner === ZCOwner.Player ? '我方' : `对手${ZC_OWNER_ORDER.indexOf(best.owner)}`;
        return {
            status: won ? 'victory' : 'defeat',
            reason: `${won ? '结算胜利' : '结算失败'}：${ownerName}按${decisive?.label ?? '综合数据'}领先。`,
            // 分数局要按**领先的那一方**上色，而不是「我方输 ⇒ 一律红方色」。
            winner: best.owner,
        };
    }
}
