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
                return { status: 'defeat', reason: '塔防失败：我方主城领地已失守。' };
            }
            const allWavesSpawned = nextDefenceWaveIndex >= context.pveDefence.waves.length;
            const aliveEnemies = state.units.some((unit) => unit.owner !== ZCOwner.Player && unit.battleState !== 'dead');
            return allWavesSpawned && !aliveEnemies
                ? { status: 'victory', reason: `塔防胜利：已击退全部 ${context.pveDefence.waves.length} 波守军。` }
                : null;
        }
        const developedCount = (owner: ZCOwner): number => state.hexes.filter((hex) =>
            hex.owner === owner && hex.building !== 'none' && hex.hp > 0).length;
        if (context.activeOwners.slice(1).every((owner) => developedCount(owner) === 0)) {
            return { status: 'victory', reason: '强攻胜利：全部对手的已开发地块归零！' };
        }
        if (developedCount(ZCOwner.Player) === 0) {
            return { status: 'defeat', reason: '战斗失败：我方已开发地块归零。' };
        }
        if (state.elapsedSeconds < state.durationSeconds) return null;
        return this.compareScores(state, context);
    }

    private static compareScores(state: IZCOutcomeState, context: IZCOutcomeContext): IZCOutcomeResult {
        const player = this.scoreFor(state, ZCOwner.Player, context.homeId(ZCOwner.Player));
        const fields: Array<{ key: keyof ZCScoreBreakdown; label: string }> = [
            { key: 'territory', label: '占领地块' },
            { key: 'mainCityHp', label: '主城血量' },
            { key: 'unitCount', label: '兵种数量' },
            { key: 'totalUnitHp', label: '兵种总血量' },
        ];
        const scores = context.activeOwners.map((owner) => ({ owner, score: this.scoreFor(state, owner, context.homeId(owner)) }));
        const compare = (left: ZCScoreBreakdown, right: ZCScoreBreakdown): number => {
            for (const field of fields) {
                if (left[field.key] !== right[field.key]) return left[field.key] - right[field.key];
            }
            return 0;
        };
        const best = scores.slice().sort((a, b) => compare(b.score, a.score))[0];
        const tied = scores.filter((entry) => compare(entry.score, best.score) === 0);
        if (tied.length > 1) {
            return { status: 'draw', reason: `${tied.length} 方四项结算数据完全相同，本局平局。` };
        }
        const won = best.owner === ZCOwner.Player;
        const comparison = won
            ? scores.filter((entry) => entry.owner !== ZCOwner.Player).sort((a, b) => compare(b.score, a.score))[0]?.score
            : best.score;
        const decisive = fields.find((field) => comparison && player[field.key] !== comparison[field.key]);
        const ownerName = best.owner === ZCOwner.Player ? '我方' : `对手${ZC_OWNER_ORDER.indexOf(best.owner)}`;
        return {
            status: won ? 'victory' : 'defeat',
            reason: `${won ? '结算胜利' : '结算失败'}：${ownerName}按${decisive?.label ?? '综合数据'}领先。`,
        };
    }
}
