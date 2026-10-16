import { RequestPvpInfo } from '../generated/requestMsg/RequestPvpMsg';
import { GameNet } from '../net/GameNet';
import { withTimeout } from '../net/RequestGuard';
import { normalizePvpInfo } from './PvpInfoModel';
import type { ZCPvpInfo } from './PvpInfoModel';

/**
 * PVP 玩法信息（`CmdPvpInfoReqMsg`）网络层（数据模型与校验见 `PvpInfoModel`）。
 * 匹配页我方段位/积分走这条；永远兑现、不 reject，拿不到返回 `null`，调用方保留本地值。
 */

/** PVP 信息请求硬超时（毫秒）。 */
export const PVP_INFO_TIMEOUT_MS = 10000;

/** 最近一次成功响应（`null` = 从没成功过）。 */
let lastResult: ZCPvpInfo | null = null;

/** 在途请求（并发合并成一次）。 */
let pendingRequest: Promise<ZCPvpInfo | null> | null = null;

/** 拉取本机 PVP 玩法信息；返回 `null` 表示没拿到，调用方保留本地值。 */
export function fetchPvpInfo(caller?: unknown): Promise<ZCPvpInfo | null> {
    if (!pendingRequest) {
        pendingRequest = requestPvpInfo(caller).finally(() => {
            pendingRequest = null;
        });
    }
    return pendingRequest;
}

/** 读取最近一次成功响应（`null` = 从没成功过）。 */
export function getLastPvpInfo(): ZCPvpInfo | null {
    return lastResult;
}

/** 清掉缓存（每次进匹配流程重新拉）。 */
export function clearLastPvpInfo(): void {
    lastResult = null;
}

async function requestPvpInfo(caller?: unknown): Promise<ZCPvpInfo | null> {
    const net = GameNet.instance;
    if (!net.isConnected) {
        console.warn('[PvpInfoService] 游戏服未连接，跳过 PVP 信息请求（保留本地占位值）');
        return lastResult;
    }

    return withTimeout(sendPvpInfo(caller), PVP_INFO_TIMEOUT_MS, () => {
        console.warn(`[PvpInfoService] PVP 信息 ${PVP_INFO_TIMEOUT_MS}ms 无响应，段位信息暂空`);
        return lastResult;
    });
}

async function sendPvpInfo(caller?: unknown): Promise<ZCPvpInfo | null> {
    let response: CmdPvpInfoRspMsg | null = null;
    try {
        const ok = await GameNet.instance.send(new RequestPvpInfo(
            {},
            caller as destroyable,
            (rsp) => { response = rsp; },
        ), false);
        if (!ok || !response) return lastResult;
    } catch (error) {
        console.warn('[PvpInfoService] PVP 信息请求失败', error);
        return lastResult;
    }
    const info = normalizePvpInfo(response);
    if (info) lastResult = info;
    return info;
}
