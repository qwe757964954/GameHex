import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 挂机网络请求。
 * CmdHangTimeRspMsg.time 是 Long，转换在 HangRepository。
 * CmdBattleSweepReqMsg 的 proto 没有 times，倍率只作用于**客户端**的体力校验与花费文案。
 * 四个 Rsp 均已登记 MessageId，可以直接发。
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
 * 请求体只有 `{ type, level }` —— proto 里**没有** `times`，见文件头。
 */
export class RequestBattleSweep extends RequestMsg<CmdBattleSweepReqMsg, CmdBattleSweepRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdBattleSweepReqMsg';
    }
}
