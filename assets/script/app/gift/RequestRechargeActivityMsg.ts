import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 累计充值领奖请求。
 *
 * `resId` 传活动实例的 `openResId`，`rechargeProcess` 传档位要求的累计充值金额；
 * 进度与已领状态由服务端另推 `CmdActivity` 更新。
 */

/** 领取某档位（`rechargeProcess` 元）的累计充值奖励。 */
export class RequestTakeRechargeGiftActReward extends RequestMsg<
    CmdTakeRechargeGiftActRewardReqMsg,
    CmdTakeRechargeGiftActRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTakeRechargeGiftActRewardReqMsg';
    }
}
