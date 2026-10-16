import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 首充礼包（新首充）的网络请求，移植自老客户端
 * `client/assets/script/app/generated/requestMsg/RequestFirstRechargeMsg.ts`。
 *
 *  协议体（见 `assets/script/app/generated/netProto/Cmd.d.ts`）：
 *    CmdFirstRechargesBuyReqMsg    { id }        → CmdFirstRechargesBuyRspMsg    { ret }
 *    CmdFirstRechargeRewardReqMsg  { id, day }  → CmdFirstRechargeRewardRspMsg  { ret, tlCmdGoods }
 *    CmdFirstRechargeOpenReqMsg    {}            → CmdFirstRechargeOpenRspMsg    {}
 *
 *  ⚠️ `id` 的口径不一致，别想当然：
 *   - **买入**用的 `id` 是 `firstRechargeNew.rmb`（= `payChannel.id`，也就是支付渠道 id）——
 *     老客户端 `RequestFirstRechargeBuy` 里写的是 `{ id: ref.rmb }`；
 *   - **领奖**用的 `id` 是 `firstRechargeNew.id`（档位 id）。
 *   两处都照抄老客户端，不要"统一"成一个。
 */

/** 购买首充（服务端会做一次校验并把支付参数下发，真正扣款在 SDK 层）。 */
export class RequestFirstRechargeBuy extends RequestMsg<
    CmdFirstRechargesBuyReqMsg,
    CmdFirstRechargesBuyRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFirstRechargesBuyReqMsg';
    }
}

/** 领取首充第 `day` 天的奖励。 */
export class RequestFirstRechargeReward extends RequestMsg<
    CmdFirstRechargeRewardReqMsg,
    CmdFirstRechargeRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFirstRechargeRewardReqMsg';
    }
}

/** 打开界面时拉取一次首充状态（服务端会把 `CmdFirstRechargeNew` 同步进缓存）。 */
export class RequestFirstRechargeOpen extends RequestMsg<
    CmdFirstRechargeOpenReqMsg,
    CmdFirstRechargeOpenRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFirstRechargeOpenReqMsg';
    }
}
