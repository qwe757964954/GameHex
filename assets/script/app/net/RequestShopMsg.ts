/**
 * 通用商店协议（原先分散在 store / league 各一份的 `RequestShopBuy`）。
 * 只放协议入口，不承载业务规则。
 */
import { RequestMsg } from '../../framework/net/RequestMsg';

/** 通用商店购买（`CmdShopBuyReqMsg`）；`cmdShopType` 由调用方按 proto 枚举传值。 */
export class RequestShopBuy extends RequestMsg<CmdShopBuyReqMsg, CmdShopBuyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdShopBuyReqMsg';
    }
}
