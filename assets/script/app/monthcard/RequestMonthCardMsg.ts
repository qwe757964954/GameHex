import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 月卡网络请求。
 * 注意两个请求 id 口径不同：购买传 monthCardActPlan.type（1福利/2超值），
 * 领奖传活动缓存的 openResId；两者都不是 plan。
 */

/** 购买 / 续费月卡（服务端开单，扣款在 SDK 层）。 */
export class RequestMonthCardBuy extends RequestMsg<
    CmdCardBuyReqMsg,
    CmdCardBuyRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCardBuyReqMsg';
    }
}

/** 领取某张月卡今日奖励。 */
export class RequestTakeMonthCardReward extends RequestMsg<
    CmdTakeMonthCardActRewardReqMsg,
    CmdTakeMonthCardActRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTakeMonthCardActRewardReqMsg';
    }
}
