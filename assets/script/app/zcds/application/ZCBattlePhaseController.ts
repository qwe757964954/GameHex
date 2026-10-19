/**
 * 对局阶段取值真源。
 *
 * 🔴 阶段判据一律引用本对象，别在调用处写 `'playing'` / `'settlement'` 这类裸字面量：
 *    - 改一个阶段名（比如 `spawn-selection` → `spawnSelection`）只改这里；
 *    - `transition(from, to)` 的入参会被类型约束住，传错阶段当场编译报错；
 *    - const + 同名 type 的写法与 `ZCCardType` 一致，值仍是字符串（快照 / 日志可读）。
 *
 * 外部消费方（`ZCGame` 等）也读这个对象，不要 `controller.current === 'settlement'`。
 */
export const ZCBattlePhase = {
    Idle: 'idle',
    SpawnSelection: 'spawn-selection',
    Playing: 'playing',
    SettlementPresentation: 'settlement-presentation',
    Settlement: 'settlement',
    Leaving: 'leaving',
} as const;
export type ZCBattlePhase = (typeof ZCBattlePhase)[keyof typeof ZCBattlePhase];

/** 只记录对局阶段转换；异步请求、节点和弹窗仍由 ZCGame 负责。 */
export class ZCBattlePhaseController {
    private phase: ZCBattlePhase = ZCBattlePhase.Idle;

    get current(): ZCBattlePhase {
        return this.phase;
    }

    get isPlaying(): boolean {
        return this.phase === ZCBattlePhase.Playing;
    }

    get isLeaving(): boolean {
        return this.phase === ZCBattlePhase.Leaving;
    }

    get isSettled(): boolean {
        return this.phase === ZCBattlePhase.Settlement || this.phase === ZCBattlePhase.Leaving;
    }

    startSpawnSelection(): boolean {
        return this.transition(ZCBattlePhase.Idle, ZCBattlePhase.SpawnSelection);
    }

    startPlaying(): boolean {
        if (this.phase === ZCBattlePhase.SpawnSelection) {
            return this.transition(ZCBattlePhase.SpawnSelection, ZCBattlePhase.Playing);
        }
        return this.transition(ZCBattlePhase.Idle, ZCBattlePhase.Playing);
    }

    beginSettlementPresentation(): boolean {
        return this.transition(ZCBattlePhase.Playing, ZCBattlePhase.SettlementPresentation);
    }

    /** 撤退可从 playing 直接进入结算；正常终局从演出阶段进入。 */
    openSettlement(): boolean {
        if (this.phase === ZCBattlePhase.Playing) {
            return this.transition(ZCBattlePhase.Playing, ZCBattlePhase.Settlement);
        }
        return this.transition(ZCBattlePhase.SettlementPresentation, ZCBattlePhase.Settlement);
    }

    leave(): boolean {
        if (this.phase === ZCBattlePhase.Leaving) return false;
        this.phase = ZCBattlePhase.Leaving;
        return true;
    }

    private transition(from: ZCBattlePhase, to: ZCBattlePhase): boolean {
        if (this.phase !== from) return false;
        this.phase = to;
        return true;
    }
}
