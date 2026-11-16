import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 每日充值领奖请求：按天领取和累计达标领取。
 *
 * 两个响应都带 `tlCmdGoods`；已充金币数和已领状态由服务端另推 `CmdRechargeDaily` 更新。
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
