/**
 * 「玩家点击界面」上报（`CmdGameViewClickReqMsg` / `CmdGameViewClickRspMsg`）。
 *
 * ## 协议
 *
 * ```
 * message CmdGameViewClickReqMsg { required uint32 mark = 1; }   // 编号 2世界
 * message CmdGameViewClickRspMsg { required uint32 succ = 1; }   // 1成功
 * ```
 *
 * ## 三条口径
 *
 * 1. **`mark` 是服务端编号，不是 `MainTab` 下标**。客户端的「世界」是 `MainTab.World = 6`，
 *    服务端要的却是 `2` —— 拿下标直接传，服务端会按另一张表解读（且**零报错**）。
 *    其他底栏入口统一传 `1`，由 `GAME_VIEW_MARK` 维护服务端口径，不借别的枚举。
 * 2. **单向埋点，不许阻塞界面**。回包只有 `succ`，没有任何业务数据；调用方
 *    `void reportGameViewClick(...)` 就好，拿不到成功也照常切页。
 * 3. **关掉重试**（`allowRetry = false`）：点击埋点重发 = 服务端多记一次点击，
 *    重连恢复补发更是给已经过去的操作补一条假记录。
 *
 * 本层永远兑现、不 reject（`withTimeout` 兜底），失败返回 `false`。
 */

import { RequestGameViewClick } from '../generated/requestMsg/RequestSystemMsg';
import { GameNet } from '../net/GameNet';
import { toCount, withTimeout } from '../net/RequestGuard';

/**
 * 界面编号 —— 协议 `mark` 的**服务端口径**。
 *
 * ⚠️ **不要**用 `MainTab` / `mainTabItem` 的下标填这里：两套编号没有对应关系
 * （客户端「世界」= 6，服务端 = 2；其他入口统一 = 1）。
 */
export const GAME_VIEW_MARK = {
    /** 其他底栏入口。 */
    Other: 1,
    /** 世界（大地图）。 */
    World: 2,
} as const;

export type GameViewMark = (typeof GAME_VIEW_MARK)[keyof typeof GAME_VIEW_MARK];

/** 上报硬超时（毫秒）。埋点卡住不该拖住调用方，也不该让请求在队列里飘着。 */
export const GAME_VIEW_CLICK_TIMEOUT_MS = 3000;

/**
 * 上报一次界面点击。
 *
 * @param mark 服务端界面编号（见 {@link GAME_VIEW_MARK}）
 * @param caller 归属对象（节点/组件）；随它销毁，迟到回包与排队中的请求一起失效
 * @returns `true` = 服务端回 `succ === 1`；未连接 / 超时 / 失败一律 `false`
 */
export function reportGameViewClick(mark: GameViewMark, caller?: object): Promise<boolean> {
    const net = GameNet.instance;
    if (!net.isConnected) {
        // 离线（单机预览 / 断线）不算错误：这是埋点，没有本地兜底也不需要告警刷屏。
        console.info('[GameViewClick] 游戏服未连接，跳过界面点击上报');
        return Promise.resolve(false);
    }
    return withTimeout(sendGameViewClick(mark, caller), GAME_VIEW_CLICK_TIMEOUT_MS, () => {
        console.warn(`[GameViewClick] 界面点击上报 ${GAME_VIEW_CLICK_TIMEOUT_MS}ms 无响应（mark=${mark}）`);
        return false;
    });
}

async function sendGameViewClick(mark: GameViewMark, caller?: object): Promise<boolean> {
    let succ = 0;
    try {
        const request = new RequestGameViewClick(
            { mark },
            caller,
            (rsp) => { succ = toCount(rsp.succ); },
        );
        // 见文件头 ③：埋点重发等于多记一次点击。
        request.allowRetry = false;
        // `needLoading = false`：埋点绝不能弹转圈。
        const sent = await GameNet.instance.send(request, false);
        if (!sent) return false;
    } catch (error) {
        console.warn('[GameViewClick] 界面点击上报失败', error);
        return false;
    }
    return succ === 1;
}
