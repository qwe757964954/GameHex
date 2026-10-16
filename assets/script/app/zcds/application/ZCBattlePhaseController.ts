export type ZCBattlePhase =
    | 'idle'
    | 'spawn-selection'
    | 'playing'
    | 'settlement-presentation'
    | 'settlement'
    | 'leaving';

/** 只记录对局阶段转换；异步请求、节点和弹窗仍由 ZCGame 负责。 */
export class ZCBattlePhaseController {
    private phase: ZCBattlePhase = 'idle';

    get current(): ZCBattlePhase {
        return this.phase;
    }

    get isLeaving(): boolean {
        return this.phase === 'leaving';
    }

    get isSettled(): boolean {
        return this.phase === 'settlement' || this.phase === 'leaving';
    }

    startSpawnSelection(): boolean {
        return this.transition('idle', 'spawn-selection');
    }

    startPlaying(): boolean {
        if (this.phase === 'spawn-selection') return this.transition('spawn-selection', 'playing');
        return this.transition('idle', 'playing');
    }

    beginSettlementPresentation(): boolean {
        return this.transition('playing', 'settlement-presentation');
    }

    /** 撤退可从 playing 直接进入结算；正常终局从演出阶段进入。 */
    openSettlement(): boolean {
        if (this.phase === 'playing') return this.transition('playing', 'settlement');
        return this.transition('settlement-presentation', 'settlement');
    }

    leave(): boolean {
        if (this.phase === 'leaving') return false;
        this.phase = 'leaving';
        return true;
    }

    private transition(from: ZCBattlePhase, to: ZCBattlePhase): boolean {
        if (this.phase !== from) return false;
        this.phase = to;
        return true;
    }
}
