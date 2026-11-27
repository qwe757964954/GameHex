import { RequestFinishBattle, RequestStartBattle } from '../generated/requestMsg/RequestBattleMsg';
import { GameNet } from '../net/GameNet';
import { toCount, withTimeout, type CancellableRequest } from '../net/RequestGuard';
import type { ZCBattleStart } from './BattleStartModel';
import {
    BATTLE_START_SETTLED, ZC_BATTLE_TYPE_PVP, ZC_BATTLE_TYPE_SLG_CAMP, ZC_BATTLE_TYPE_SLG_MONSTER,
    normalizeBattleStart,
} from './BattleStartModel';

/**
 * 开始战斗网络层。载荷必须放在 startBattleInfo 里：
 * { startBattleInfo: { battleType, battleParams } }。
 * 本层永远兑现、不 reject；拿不到数据返回 null，正式入口据此终止开战。
 */

/** 开始游戏请求硬超时（毫秒）。 */
export const BATTLE_START_TIMEOUT_MS = 10000;

/** 最近一次成功的结果；对局随机源与单元信息从这里取。 */
let lastResult: ZCBattleStart | null = null;

/** 同参数的重复开战共用同一个在途请求。 */
let pending: {
    readonly key: string;
    readonly result: CancellableRequest<ZCBattleStart | null>;
} | null = null;

/** 统一开战入口，网络层通知当前开战场景。 */
export function requestBattleStart(
    battleType: number = ZC_BATTLE_TYPE_PVP,
    battleParams: readonly string[] = [],
): CancellableRequest<ZCBattleStart | null> {
    const key = JSON.stringify([battleType, battleParams]);
    if (pending?.key === key) return pending.result;

    const blocked = pending !== null;
    const isSlg = battleType === ZC_BATTLE_TYPE_SLG_CAMP || battleType === ZC_BATTLE_TYPE_SLG_MONSTER;
    if (blocked) console.warn('[BattleStartService] 有开战请求尚未结束');
    const result = GameNet.requestResult<CmdStartBattleRspMsg, ZCBattleStart>(blocked ? null : receive => {
        const request = new RequestStartBattle(
            { startBattleInfo: { battleType, battleParams: Array.from(battleParams) }, version: '1.0.1' },
            undefined,
            receive,
        );
        if (isSlg) request.allowRetry = false;
        return request;
    }, {
        event: BATTLE_START_SETTLED,
        timeoutMs: BATTLE_START_TIMEOUT_MS,
        tag: 'BattleStartService',
        decode(response) {
            if (isSlg) {
                const info = response.startBattleInfo;
                if (!info || info.battleType !== battleType || JSON.stringify(info.battleParams) !== JSON.stringify(battleParams)) return null;
            }
            const battle = normalizeBattleStart(response);
            // SLG 只随 entry params 交接。
            if (battle && !isSlg) lastResult = battle;
            return battle;
        },
    });
    if (blocked) return result;
    const release = (): void => {
        if (pending?.result === result) pending = null;
    };
    const cancel = result.cancel;
    result.cancel = () => {
        release();
        cancel();
    };
    pending = { key, result };
    void result.then(release, release);
    return result;
}

/** 读取最近一次成功响应（`null` = 从没成功过）。 */
export function getLastBattleStart(): ZCBattleStart | null {
    return lastResult;
}

/** 离开对局/重新匹配时清掉。 */
export function clearLastBattleStart(): void {
    lastResult = null;
}

// 完成战斗上报

/** 对局胜负上报结果：1 胜、2 负。 */
export const BATTLE_RESULT_WIN = 1;
export const BATTLE_RESULT_LOSE = 2;

/** 完成战斗上报硬超时（毫秒）。 */
const BATTLE_FINISH_TIMEOUT_MS = 3000;

/**
 * 完成战斗响应。协议已收敛为单字段 code；段位和积分改由
 * CmdBattleResultBroMsg 广播下发，不再走这条回包。
 */
export interface ZCBattleFinish {
    readonly code: number;
}

/** 请求完成战斗上报；永远兑现、不 reject，失败返回 `null`。 */
export function finishBattle(
    clientTickCount: number,
    result: number,
    commands: ReadonlyArray<CmdBattleFrameInfo> = [],
    statisticsInfos: ReadonlyArray<CmdBattleStatisticsInfo> = [],
    caller?: object,
): Promise<ZCBattleFinish | null> {
    return withTimeout(
        sendFinishBattle(clientTickCount, result, commands, statisticsInfos, caller),
        BATTLE_FINISH_TIMEOUT_MS,
        () => {
            console.warn('[BattleStartService] 完成战斗上报超时，按失败处理');
            return null;
        },
    );
}

async function sendFinishBattle(
    clientTickCount: number,
    result: number,
    commands: ReadonlyArray<CmdBattleFrameInfo>,
    statisticsInfos: ReadonlyArray<CmdBattleStatisticsInfo>,
    caller?: object,
): Promise<ZCBattleFinish | null> {
    let response: CmdFinishBattleRspMsg | null = null;
    try {
        const status = await GameNet.sendRequest(() => new RequestFinishBattle(
            {
                clientTickCount: Math.max(0, Math.floor(clientTickCount)),
                result,
                commands: commands.map((c) => ({ ...c })),
                statisticsInfos: statisticsInfos.map((s) => ({ ...s })),
            },
            caller,
            (rsp) => { response = rsp; },
        ), { timeoutMs: BATTLE_FINISH_TIMEOUT_MS, tag: 'BattleStartService' });
        if (status !== 'ok' || !response) return null;
    } catch (error) {
        console.warn('[BattleStartService] 完成战斗上报失败', error);
        return null;
    }
    return {
        code: toCount(response.code),
    };
}
