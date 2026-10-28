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
 * 战斗结算广播（`CmdBattleResultBroMsg`）的订阅 + 等待器。
 *
 * ## 为什么必须 `GameNet.addEvent`
 *
 * `RequestMsg` 那套只管**自己发起的 req→rsp**；服务端主动推的结算数据只能靠广播接
 * （`ChatRepository` 的 `CmdChatBroMsg`、`TerritoryCellRepository` 的通关广播同款）。
 * **不订阅的症状是零报错**：结算页永远没有奖励、也不会报任何东西。
 *
 * ## 时序（为什么是「等」而不是「先弹后刷」）
 *
 * 广播必然**晚于**「对局结束」到达（要走一趟网络），所以在 `openSettlement` 里开始等、
 * 到了再弹页 —— 奖励一次到位，不会先闪一版空奖励格。等不到就走 {@link BATTLE_RESULT_WAIT_MS}
 * 超时兜底，**照弹页面**（奖励区空着），绝不把结算卡死。
 *
 * ## 不缓存历史结果
 *
 * 只喂**当前**的等待器：没人等时直接丢弃。缓存会让「上一局的广播」被下一局吃掉
 * （同一秒内连开两局时静默串数据），而广播本来就不可能早于等待开始。
 */
class BattleResultServiceClass {
    /** 订阅句柄（`GameNet.removeCallerEvent` 的凭据）；没订阅过为 `null`。 */
    private listener: object | null = null;

    /** 当前等待者；同一时刻只允许一个（新的会先把旧的按「没等到」兑现）。 */
    private waiter: ((result: IZCChapterBattleOutcome | null) => void) | null = null;
    private waiterBattleType: number | null = null;

    /** 超时定时器。 */
    private timer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 幂等订阅（进对局时调一次即可，重复调不叠加监听）。
     *
     * ⚠️ 监听必须在**对局开始前**挂上：广播是「对局结束时」才推的，
     * 等到 `openSettlement` 里再订阅就晚了（那一下就丢包）。
     */
    ensureListening(): void {
        if (this.listener) return;
        this.listener = {};
        GameNet.instance.addEvent(BATTLE_RESULT_BRO, this.listener, (msg: unknown) => this.onBroadcast(msg));
    }

    /**
     * 等这一局章节战斗的结算广播。
     *
     * 永远兑现、不 reject：广播到了给结果，超时给 `null`（调用方两种都按「照常弹页」处理）。
     */
    waitForChapterResult(timeoutMs: number = BATTLE_RESULT_WAIT_MS): Promise<IZCChapterBattleOutcome | null> {
        return this.waitForBattleResult(ZC_BATTLE_TYPE_CHAPTER, timeoutMs);
    }

    waitForBattleResult(battleType: number, timeoutMs: number = BATTLE_RESULT_WAIT_MS): Promise<IZCChapterBattleOutcome | null> {
        // 上一轮的等待器先作废（否则它永远悬着，调用方 await 卡死）。
        this.finish(null);
        if (!battleResultMessageName(battleType)) return Promise.resolve(null);
        this.waiterBattleType = battleType;
        return new Promise<IZCChapterBattleOutcome | null>((resolve) => {
            this.waiter = resolve;
            this.timer = setTimeout(() => {
                console.warn(`[BattleResult] 等 ${battleType} 结算广播超时（${timeoutMs}ms），按无奖励结算`);
                this.finish(null);
            }, Math.max(0, timeoutMs));
        });
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
     * `dataBytes` → `CmdChapterBattleResultInfo`。
     *
     * 空 / 形状不对 / 解码抛错都返回 `null`（上层退化成「奖励为空」）——
     * ⚠️ 但**不算超时**：广播确实到了，只是没内容，没必要让调用方再白等一个超时。
     *
     * 不写 `instanceof Uint8Array`：跨 realm（Node 用例 / 不同 JS 上下文）会假阴性，
     * 而「拿不到内容」这件事 `length` + 解码本身就能判 —— 形状真不对时 decode 会抛，照样兜住。
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

    /** 兑现（并清掉）当前等待器。 */
    private finish(result: IZCChapterBattleOutcome | null): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const waiter = this.waiter;
        this.waiter = null;
        this.waiterBattleType = null;
        if (waiter) waiter(result);
    }
}

/** 全局单例（订阅与等待器都要跨对局存活）。 */
export const BattleResultService = new BattleResultServiceClass();
