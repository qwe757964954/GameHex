import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 「活动 → 每日任务」的网络请求。
 *
 * 两条协议都**只回奖励**，不回活动状态：
 *   - `CmdTakeDayChallengeActRewardRspMsg { tlReward }`
 *   - `CmdTakeDayActProgressRewardRspMsg { tlCmdGoods }`
 * 状态（任务进度 / 已领宝箱）只会落在缓存 `CmdActivity` 上，由服务端另外推 ——
 * 所以这两个请求叫「写」，但**不产生**客户端状态覆盖，见 `LayerActivityRepository` 的说明。
 *
 * `resId` 一律是**活动实例 id**（`CmdActivity.openResId`），不是 `activityRefId`、
 * 也不是 `activity.resId` —— 老端 `VOActivity.GetId()` 就是这个口径。
 */

/** 领取某条每日任务的奖励。 */
export class RequestTakeDayChallengeActReward extends RequestMsg<
    CmdTakeDayChallengeActRewardReqMsg,
    CmdTakeDayChallengeActRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTakeDayChallengeActRewardReqMsg';
    }
}

/** 领取某个周活跃进度宝箱的奖励。 */
export class RequestTakeDayActProgressReward extends RequestMsg<
    CmdTakeDayActProgressRewardReqMsg,
    CmdTakeDayActProgressRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTakeDayActProgressRewardReqMsg';
    }
}
