import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 征收（挂机）网络请求（老端 `generated/requestMsg/RequestHangMsg.ts` 的 Demo3.8 版）。
 *
 * ## 四条请求的 `MessageId` 登记（已逐条核过，规则 20）
 *
 * `Cmd.d.ts` 里四个 Rsp **都**有 `MessageId` ⇒ 可以发：
 *
 * | 请求 | Rsp `MessageId` | 说明 |
 * |---|---|---|
 * | `CmdHangGetRewardReqMsg` | `1443586620` | 领取挂机奖励（返回 `tlCmdGoods`） |
 * | `CmdHangQuickReqMsg` | `1023337980` | 快速征收（返回 `tlCmdGoods`） |
 * | `CmdHangTimeReqMsg` | `20353276` | 询问挂机时间（返回 `time`） |
 * | `CmdBattleSweepReqMsg` | `70842819` | 扫荡（返回 `tlCmdGoods`） |
 *
 * 四个请求名都在 `ReqMsgProtoName` 联合类型里（`Cmd.d.ts` 约 6972 行起）。
 *
 * ## ⚠️ `CmdHangTimeRspMsg.time` 是 `Long`
 *
 * protobufjs 开了 `--force-long` ⇒ 运行时拿到的是 `Long` 对象，**不能直接当 number 用**。
 * 本文件只负责发请求；转换在 `HangRepository`（走 `toIdString` 同族的十进制口径）。
 *
 * ## ⚠️ `CmdBattleSweepReqMsg` 在 Demo3.8 的 proto 里**没有 `times` 字段**
 *
 * 这是本模块最容易踩空的一处（**症状是静默失效**：请求发得出去、服务端也回包，只是倍率不起作用）：
 *
 * | 版本 | 定义 |
 * |---|---|
 * | 老端 `.d.ts` | `{ type: number; level: number; times?: number }` |
 * | **老端 proto 源** `client_proto/protoCompiled.proto:317` | `required sint32 level = 2; required sint32 type = 1;`（**没有 times**） |
 * | **Demo3.8 proto 源** `client_proto/protoCompiled.proto:317` | 同上（**没有 times**） |
 *
 * ⇒ 老端 `.d.ts` 里的 `times?` 是**过期产物**（与 proto 源不一致），真正的线上协议
 * 从来没有 `times` 字段；老端 `ModelChapterNew.requestSweep(type, level, times)` 传的那个
 * `times` 在 protobufjs 编码时**被静默丢掉**（不属于 schema 的属性不参与编码）。
 *
 * **处置**：请求体严格只写 `{ level, type }`（写了 `times` 反而会 `TS2353`）。
 * 倍率只作用于**客户端**的体力校验与花费文案（`HangTable.sweepCostText`）。
 * 本轮「无月卡默认分支」下倍率恒为 1，这个问题**不触发**；
 * 等福利月卡特权表补上、真要开倍率时，必须**先让服务端补 `times` 字段**再谈。
 */

/** 领取挂机奖励（无请求参数）。 */
export class RequestHangGetReward extends RequestMsg<
    CmdHangGetRewardReqMsg,
    CmdHangGetRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdHangGetRewardReqMsg';
    }
}

/** 快速征收（无请求参数；老端面板里没用它，走的是扫荡，留着备服务端另一次改版）。 */
export class RequestHangQuick extends RequestMsg<CmdHangQuickReqMsg, CmdHangQuickRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdHangQuickReqMsg';
    }
}

/** 询问挂机时间（无请求参数；回包 `time: Long`）。 */
export class RequestHangTime extends RequestMsg<CmdHangTimeReqMsg, CmdHangTimeRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdHangTimeReqMsg';
    }
}

/**
 * 扫荡 / 快速征收（老端 `ModelChapterNew.requestSweep(type, level, times)`）。
 *
 * ⚠️ 请求体只有 `{ type, level }` —— proto 里**没有** `times`，见文件头。
 */
export class RequestBattleSweep extends RequestMsg<CmdBattleSweepReqMsg, CmdBattleSweepRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdBattleSweepReqMsg';
    }
}
