import { ProtoMgr } from '../../framework/net/ProtoMgr';
import { GameNet } from '../net/GameNet';
import { toCount } from '../net/RequestGuard';
import {
    BATTLE_RESULT_WAIT_MS,
    battleResultOf,
    battleResultMessageName,
} from './BattleResultTable';
import type { IZCChapterBattleResult } from './BattleResultTable';
import { ZC_BATTLE_TYPE_CHAPTER } from './BattleStartModel';

export interface IZCChapterBattleOutcome extends IZCChapterBattleResult {
    /** CmdBattleResultBroMsg.code: 1 胜，2 负。 */
    readonly code: 1 | 2;
}

/** 广播消息名（`CmdBattleResultBroMsg`，MessageId `921618703`）。 */
const BATTLE_RESULT_BRO = 'CmdBattleResultBroMsg';

/**
 * 战斗结算广播的订阅与等待器。
 *
 * RequestMsg 只处理自己发起的请求，服务端主动推的结算只能通过 GameNet.addEvent 接。
 * 广播总在对局结束后到达，所以先开始等再弹结算页；等不到就超时兜底，照样弹页，不卡死。
 * 只喂当前等待器，不缓存历史结果，避免连开两局时串数据。
 */
class BattleResultServiceClass {
    /** 订阅句柄；没订阅过为 null。 */
    private listener: object | null = null;

    /** 当前等待者；同一时刻只允许一个。 */
    private waiter: ((result: IZCChapterBattleOutcome | null) => void) | null = null;
    private waiterBattleType: number | null = null;
    private waiterOwner: object | null = null;

    /** 超时定时器。 */
    private timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 幂等订阅，进对局时调一次。监听要在对局开始前挂上，
     * 否则结算广播到达时还没人接，会直接丢包。
     */
    ensureListening(): void {
        if (this.listener) return;
        this.listener = {};
        GameNet.instance.addEvent(BATTLE_RESULT_BRO, this.listener, (msg: unknown) => this.onBroadcast(msg));
    }

    /**
     * 等这一局章节战斗的结算广播。永远兑现：广播到了给结果，超时给 null。
     */
    waitForChapterResult(timeoutMs: number = BATTLE_RESULT_WAIT_MS): Promise<IZCChapterBattleOutcome | null> {
        return this.waitForBattleResult(ZC_BATTLE_TYPE_CHAPTER, timeoutMs);
    }

    waitForBattleResult(battleType: number, timeoutMs: number = BATTLE_RESULT_WAIT_MS, caller?: object): Promise<IZCChapterBattleOutcome | null> {
        // 上一轮的等待器先作废（否则它永远悬着，调用方 await 卡死）。
        this.finish(null);
        if (!battleResultMessageName(battleType)) return Promise.resolve(null);
        this.waiterBattleType = battleType;
        this.waiterOwner = caller ?? null;
        return new Promise<IZCChapterBattleOutcome | null>((resolve) => {
            this.waiter = resolve;
            this.timer = setTimeout(() => {
                console.warn(`[BattleResult] 等 ${battleType} 结算广播超时（${timeoutMs}ms），按无奖励结算`);
                this.finish(null);
            }, Math.max(0, timeoutMs));
        });
    }

    /** 只解除当前调用方的等待，不影响后来进入的对局。 */
    cancelWait(caller: object): void {
        if (this.waiterOwner === caller) this.finish(null);
    }

    /** 广播只能唤醒正在等待同一种战斗的对局；不缓存历史结果。 */
    private onBroadcast(msg: unknown): void {
        const row = (msg ?? {}) as { battleType?: unknown; code?: unknown; dataBytes?: unknown };
        const battleType = toCount(row.battleType);
        if (!this.waiter || battleType !== this.waiterBattleType) return;
        const messageName = battleResultMessageName(battleType);
        if (!messageName) return;
        const code = toCount(row.code);
        if (code !== 1 && code !== 2) return;

        const result = battleResultOf(battleType, this.decodeResultData(messageName, row.dataBytes));
        console.log(`[BattleResult] ${battleType} 结算广播到达：奖励 ${result.goods.length} 条`);
        this.finish({ ...result, code });
    }

    /**
     * dataBytes 转结算行。空、形状不对或解码抛错都返回 null，上层按奖励为空处理；
     * 广播已经到达，不再等超时。
     * 不写 instanceof Uint8Array，跨 realm 会误判；length 加解码本身足够判断。
     */
    private decodeResultData(messageName: string, data: unknown): unknown {
        const bytes = data as Uint8Array | null | undefined;
        if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return null;
        try {
            return ProtoMgr.get().decodeDataByName(messageName, bytes);
        } catch (error) {
            console.warn(`[BattleResult] ${messageName} dataBytes 解码失败`, error);
            return null;
        }
    }

    /** 兑现并清掉当前等待器。 */
    private finish(result: IZCChapterBattleOutcome | null): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const waiter = this.waiter;
        this.waiter = null;
        this.waiterBattleType = null;
        this.waiterOwner = null;
        if (waiter) waiter(result);
    }
}

/** 全局单例（订阅与等待器都要跨对局存活）。 */
export const BattleResultService = new BattleResultServiceClass();
