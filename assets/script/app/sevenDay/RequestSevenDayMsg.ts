import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 七日狂欢网络请求。参数口径各不相同：
 * 领任务奖励传 day（按天结算）、买商品传 sevenDayShop.id、领积分宝箱传 sevenDayPoint.resId。
 * 服务端不推 CmdSevenDayInfo，状态靠每条 rsp 的 cmdSevenDayInfo 整体覆盖。
 */

export class RequestSevenDayInfo extends RequestMsg<
    CmdSevenDayInfoReqMsg,
    CmdSevenDayInfoRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSevenDayInfoReqMsg';
    }
}

/** 领取第 day 天任务奖励（按天，不按任务 id）。 */
export class RequestSevenDayTakeTaskReward extends RequestMsg<
    CmdSevenDayTakeTaskRewardReqMsg,
    CmdSevenDayTakeTaskRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSevenDayTakeTaskRewardReqMsg';
    }
}

/** 购买商店商品。 */
export class RequestSevenDayShopBuy extends RequestMsg<
    CmdSevenDayShopBuyReqMsg,
    CmdSevenDayShopBuyRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSevenDayShopBuyReqMsg';
    }
}

/** 领取积分宝箱。 */
export class RequestSevenDayTakePointReward extends RequestMsg<
    CmdSevenDayTakePointRewardReqMsg,
    CmdSevenDayTakePointRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSevenDayTakePointRewardReqMsg';
    }
}
