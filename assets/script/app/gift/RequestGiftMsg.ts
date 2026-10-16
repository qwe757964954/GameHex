import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 礼包网络请求。
 *
 * 礼包商城的购买走**通用商店协议** `CmdShopBuy`（不是礼包专属协议）——
 * `cmdShopType = CmdShopType.gift = 5` 区分出「礼包商店」：
 *
 *   | 项 | 值 |
 *   |---|---|
 *   | 老端调用 | `ModelGift.requestBuy(id, StoreType.Gift)` |
 *   | 请求体 | `{ id, cmdShopType: 5, buyTimes: 1, tlGoodReplace }` |
 *   | 响应 | `CmdShopBuyRspMsg.tlCmdGoods`（本次获得的物品） |
 *   | 状态更新 | 服务端**另推** `CmdShop`（`protoCache` 里有，key = `cmdShopType`） |
 *
 * ⚠️ 与本模块无关但别搞混：**灵玉直冲页不在这里发请求** —— 它的按钮走
 * `SDKMgr.pay(ref.id, "common", 0)`（真实支付），Demo3.8 没有支付 SDK，
 * 照 `FirstRechargeRepository` / `MonthCardGiftRepository` 的既定范式
 * **只留注释、发到业务前置请求为止**。
 */

/** 购买礼包商店里的一个商品（`id` = `giftShop.id`）。 */
export class RequestGiftShopBuy extends RequestMsg<
    CmdShopBuyReqMsg,
    CmdShopBuyRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdShopBuyReqMsg';
    }
}
