import { RequestStartBattle, RequestFinishBattle } from '../generated/requestMsg/RequestBattleMsg';
import { GameNet } from '../net/GameNet';
import { withTimeout } from '../net/RequestGuard';
import { toCount } from '../net/RequestGuard';
import { ZC_BATTLE_TYPE_PVP, ZC_BATTLE_TYPE_SLG_CAMP, ZC_BATTLE_TYPE_SLG_MONSTER, normalizeBattleStart } from './BattleStartModel';
import type { ZCBattleStart } from './BattleStartModel';

/**
 * 「开始游戏」网络层（数据模型与校验见 `BattleStartModel`）。
 * 对应 `CmdStartBattleReqMsg` / `CmdStartBattleRspMsg`。
 * 载荷必须嵌在 `startBattleInfo` 里：`{ startBattleInfo: { battleType, battleParams } }`。
 * 本层永远兑现、不 reject；拿不到数据返回 `null`，正式入口必须终止本次开战。
 */

/** 开始游戏请求硬超时（毫秒）。 */
export const BATTLE_START_TIMEOUT_MS = 10000;

/** 最近一次成功的结果；对局随机源与单元信息从这里取。 */
let lastResult: ZCBattleStart | null = null;

/** 相同参数的并发请求合并；不同战斗不能共用同一份回包。 */
let pendingRequest: Promise<ZCBattleStart | null> | null = null;
let pendingRequestKey: string | null = null;

/** 请求开一局；返回 `null` 表示服务端未确认开战。 */
export function startBattle(
    battleType: number = ZC_BATTLE_TYPE_PVP,
    battleParams: readonly string[] = [],
    caller?: object,
    isCurrent?: () => boolean,
): Promise<ZCBattleStart | null> {
    if (isCurrent && !isCurrent()) return Promise.resolve(null);
    const requestKey = JSON.stringify([battleType, battleParams]);
    if (pendingRequest) {
        if (pendingRequestKey === requestKey && !isCurrent) return pendingRequest;
        console.warn('[BattleStartService] 另一种战斗的开战请求尚未结束');
        return Promise.resolve(null);
    }
    pendingRequestKey = requestKey;
    pendingRequest = requestStartBattle(battleType, battleParams, caller, isCurrent).finally(() => {
        pendingRequest = null;
        pendingRequestKey = null;
    });
    return pendingRequest;
}

/** 读取最近一次成功响应（`null` = 从没成功过）。 */
export function getLastBattleStart(): ZCBattleStart | null {
    return lastResult;
}

/** 离开对局/重新匹配时清掉。 */
export function clearLastBattleStart(): void {
    lastResult = null;
}

async function requestStartBattle(
    battleType: number,
    battleParams: readonly string[],
    caller?: object,
    isCurrent?: () => boolean,
): Promise<ZCBattleStart | null> {
    const net = GameNet.instance;
    if (!net.isConnected) {
        console.warn('[BattleStartService] 游戏服未连接，无法确认开战');
        return null;
    }

    let active = true;
    const canSend = (): boolean => active && (!isCurrent || isCurrent());
    try {
        return await withTimeout(sendStartBattle(battleType, battleParams, caller, canSend), BATTLE_START_TIMEOUT_MS, () => {
            active = false;
            console.info(`[BattleStartService] 开始战斗 ${BATTLE_START_TIMEOUT_MS}ms 无响应，无法进入对局`);
            return null;
        });
    } finally {
        active = false;
    }
}

async function sendStartBattle(
    battleType: number,
    battleParams: readonly string[],
    caller?: object,
    isCurrent: () => boolean = () => true,
): Promise<ZCBattleStart | null> {
    let response: CmdStartBattleRspMsg | null = null;
    let responseAt = 0;
    const isSlg = battleType === ZC_BATTLE_TYPE_SLG_CAMP || battleType === ZC_BATTLE_TYPE_SLG_MONSTER;
    try {
        const request = new RequestStartBattle(
            { startBattleInfo: { battleType, battleParams: Array.from(battleParams) }, version: '1.0.1' },
            caller,
            (rsp) => {
                if (!isCurrent()) return;
                response = rsp;
                responseAt = Date.now();
                console.info(`[BattleLoading] 收到开战回包 type=${battleType}`);
            },
        );
        if (isSlg) {
            request.allowRetry = false;
            request.canSend = isCurrent;
        }
        const ok = await GameNet.instance.send(request, false);
        if (!isCurrent()) return null;
        if (!ok || !response) {
            console.warn(`[BattleLoading] 开战未获确认 type=${battleType} sendOk=${ok} hasResponse=${response !== null}`);
            return null;
        }
        console.info(`[BattleLoading] 开战回包交接 ${Date.now() - responseAt}ms`);
    } catch (error) {
        console.warn('[BattleStartService] 开始战斗请求失败，未获得开战确认', error);
        return null;
    }

    if (isSlg) {
        const info = response.startBattleInfo;
        if (!info || info.battleType !== battleType || JSON.stringify(info.battleParams) !== JSON.stringify(battleParams)) return null;
    }
    const result = normalizeBattleStart(response);
    // SLG 只随 entry params 交接，不能被后续 PVP 匹配消费。
    if (result && !isSlg) lastResult = result;
    return result;
}

// ==================== 完成战斗上报 ====================

/** 对局胜负上报结果（`CmdFinishBattleReqMsg.result`：1胜 2负）。 */
export const BATTLE_RESULT_WIN = 1;
export const BATTLE_RESULT_LOSE = 2;

/** 完成战斗上报硬超时（毫秒）。 */
export const BATTLE_FINISH_TIMEOUT_MS = 3000;

/**
 * 完成战斗响应。
 *
 * ⚠️ 2026-09-24 协议同步：`CmdFinishBattleRspMsg` 已**收敛为单字段 `code`**
 * （原 `addScore` / `newGrade` / `newScore` 三个字段已从后端 proto 删除）。
 * 段位 / 积分等结算数据改由**广播** `CmdBattleResultBroMsg.dataBytes` 下发
 * （1001 -> `CmdPveBattleResultInfo`），不再走这条回包。
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
    const net = GameNet.instance;
    if (!net.isConnected) {
        console.warn('[BattleStartService] 游戏服未连接，跳过完成战斗上报');
        return Promise.resolve(null);
    }
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
        const ok = await GameNet.instance.send(new RequestFinishBattle(
            {
                clientTickCount: Math.max(0, Math.floor(clientTickCount)),
                result,
                commands: commands.map((c) => ({ ...c })),
                statisticsInfos: statisticsInfos.map((s) => ({ ...s })),
            },
            caller,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return null;
    } catch (error) {
        console.warn('[BattleStartService] 完成战斗上报失败', error);
        return null;
    }
    return {
        code: toCount(response.code),
    };
}
