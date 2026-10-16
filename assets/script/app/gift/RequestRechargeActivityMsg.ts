import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 累计充值（活动体系）领奖请求。
 *
 * 老端 `ModelActivity.RequestTakeRechargeGiftActReward(resId, rechargeProcess)`：
 *   - `resId` = 活动实例的 `openResId`（`VOActivity.GetId()`），**不是** `activity.resId`
 *   - `rechargeProcess` = 该档位要求的累计充值金额（`rechargeGiftActPlan.rechargeProcess`）
 *   - 响应 `tlReward`（`CmdGoods[]`）；进度与已领状态由服务端**另推** `CmdActivity` 更新缓存，
 *     这里不手工合并（与 `RequestGiftShopBuy` 同一口径）。
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
