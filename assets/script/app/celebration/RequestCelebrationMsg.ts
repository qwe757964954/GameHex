import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 开服庆典网络请求（老端 `generated/requestMsg/RequestCelebration.ts` 的 Demo3.8 版）。
 *
 * ## ⚠️ 只有**两个**请求，而且都**不是查询**
 *
 * | 请求 | Rsp `MessageId` | 说明 |
 * |---|---|---|
 * | `CmdCelebrationGetTargetRewardReqMsg{id,subId}` | `1808065367` | 领取庆典目标奖励（返回 `tlCmdGoods`） |
 * | `CmdCelebrationBuyShopGoodsReqMsg{id,subId}` | `1473298867` | 购买限时特惠商品（返回 `canRmb` + `tlCmdGoods`） |
 *
 * 「读庆典数据」**没有请求** —— `CmdCelebrationInfo` 在
 * `assets/resources/config/protoCache.json` 里登记着（`CacheMgrGen.getTlCmdCelebrationInfo()`），
 * 服务端会主动推。缓存为空 = 还没推 / 离线，界面按空渲染即可，**不要造一个假请求**
 * （与 `HangRepository` 的「没有拉取挂机数据的请求」同一处置）。
 *
 * ## 两条广播（**不发**，但要认得）
 *
 * | BroMsg | `MessageId` | 谁在听 |
 * |---|---|---|
 * | `CmdCelebrationUpdateDataBroMsg`（无字段） | `1157544859` | 老端 `ModelCelebration.enter()` —— **回调体是空的**（改数据的是 `CmdCelebrationInfo` 自己的缓存更新） |
 * | `CmdCelebrationBuyShopGoodsBroMsg{tlCmdGoods}` | `1919419092` | 老端 `ModelCelebration.enter()` —— `FW.ShowReward(tlCmdGoods)` |
 *
 * ⚠️ `BroMsg` 的号**不能**走 `apply_msgid.mjs`（它只收 `*RspMsg`）——
 * 本次没有新增号，两条都已经在 `Cmd.d.ts` 里登记（实测核对过，与 `CmdInterface` 同源）。
 *
 * ## ⚠️ 请求体只有 `{ id, subId }`
 *
 * 🔴 `id` 是 **`celebrationConfig.id`**（不是 `rankType`）——
 * 老端调用点是 `ModelCelebration.RequestCelebrationGetTargetReward(data.id, data.subId)`，
 * 其中 `data` 是 `celebrationTarget` / `celebrationShop` 的行，它们的 `id` 就是配置表的 `id`。
 * 传错成 `rankType` 服务端会**回一个空 `tlCmdGoods` 或者干脆不认**，界面上只是"点了没反应"。
 *
 * `RequestMsg` 的第三参数是业务回调（`rsp` 到手时触发）；`RequestMsg` 只管发，
 * 超时 / 离线兜底在 `CelebrationRepository`（走 `withTimeout`，与全家族同口径）。
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
