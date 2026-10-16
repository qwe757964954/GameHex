import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 每日充值（TabGiftEveryDay）领奖网络请求。
 *
 * 老端 `TabGiftEveryDay` 发两类请求：
 *   - 按天领当天奖励：`CmdRechargeDailyGetRewardReqMsg { id: round, day }`
 *   - 领累计达标奖励：`CmdRechargeDailyGetAccRewardReqMsg { id: round, day }`
 * 响应里都带 `tlCmdGoods`（本次获得的物品）。
 * 已充金币数 / 已领状态由服务端**另推** `CmdRechargeDaily` 更新缓存，这里不用手动合并。
 */

/** 领取某一档（round）某天（day）的充值奖励。 */
export class RequestRechargeDailyGetReward extends RequestMsg<
    CmdRechargeDailyGetRewardReqMsg,
    CmdRechargeDailyGetRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdRechargeDailyGetRewardReqMsg';
    }
}

/** 领取某一档（round）累计达标第 day 天的奖励。 */
export class RequestRechargeDailyGetAccReward extends RequestMsg<
    CmdRechargeDailyGetAccRewardReqMsg,
    CmdRechargeDailyGetAccRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdRechargeDailyGetAccRewardReqMsg';
    }
}
