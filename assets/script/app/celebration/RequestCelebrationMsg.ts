import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 开服庆典网络请求（老端 `generated/requestMsg/RequestCelebration.ts` 的 Demo3.8 版）。
 *
 * 只有两个请求，都不是查询：
 * - `CmdCelebrationGetTargetRewardReqMsg{id,subId}`（Rsp 1808065367）领庆典目标奖励，返回 `tlCmdGoods`；
 * - `CmdCelebrationBuyShopGoodsReqMsg{id,subId}`（Rsp 1473298867）买限时特惠，返回 `canRmb` + `tlCmdGoods`。
 *
 * 庆典数据没有拉取请求：`CmdCelebrationInfo` 在 `protoCache.json` 里登记着（`getTlCmdCelebrationInfo()`），
 * 服务端主动推，缓存为空就是还没推 / 离线，界面按空渲染，不要造一个假请求。
 *
 * 两条广播不发但要知道：
 * - `CmdCelebrationUpdateDataBroMsg`（无字段，1157544859）：老端回调体是空的，改数据的是缓存更新；
 * - `CmdCelebrationBuyShopGoodsBroMsg{tlCmdGoods}`（1919419092）：老端在里面 `FW.ShowReward`。
 * BroMsg 的号不能走 `apply_msgid.mjs`（它只收 `*RspMsg`），这两条已在 `Cmd.d.ts` 登记。
 *
 * 请求体只有 `{ id, subId }`，其中 `id` 是 `celebrationConfig.id`，不是 `rankType`：
 * 老端调用点是 `RequestCelebrationGetTargetReward(data.id, data.subId)`，`data` 是
 * `celebrationTarget` / `celebrationShop` 的行。传成 `rankType` 时服务端会回空 `tlCmdGoods` 或干脆不认，
 * 界面上只是「点了没反应」。
 *
 * 第三参数是业务回调；`RequestMsg` 只管发，超时 / 离线兜底在 `CelebrationRepository`（`withTimeout`）。
 */

/** 领取庆典目标奖励（`CmdCelebrationGetTargetRewardReqMsg`）。 */
export class RequestCelebrationGetTargetReward extends RequestMsg<
    CmdCelebrationGetTargetRewardReqMsg,
    CmdCelebrationGetTargetRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCelebrationGetTargetRewardReqMsg';
    }
}

/** 购买限时特惠商品（`CmdCelebrationBuyShopGoodsReqMsg`）。 */
export class RequestCelebrationBuyShop extends RequestMsg<
    CmdCelebrationBuyShopGoodsReqMsg,
    CmdCelebrationBuyShopGoodsRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCelebrationBuyShopGoodsReqMsg';
    }
}
