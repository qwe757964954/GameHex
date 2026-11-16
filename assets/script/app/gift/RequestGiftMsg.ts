import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 礼包购买请求。
 *
 * 购买走通用商店协议 `CmdShopBuy`，用 `CmdShopType.gift` 区分；获得的物品在响应的
 * `tlCmdGoods` 里，礼包状态由服务端另推 `CmdShop` 更新。
 *
 * 灵玉直冲页走真实支付 SDK，本模块不发请求。
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
