import { RequestMsg } from "../../../framework/net/RequestMsg"

export class RequestRoleLogin extends RequestMsg<CmdRoleLoginReqMsg, CmdRoleLoginRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleLoginReqMsg"
    }
}

export class RequestRoleChangeName extends RequestMsg<CmdRoleChangeNameReqMsg, CmdRoleChangeNameRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleChangeNameReqMsg"
    }
}

export class RequestRoleChangeImg extends RequestMsg<CmdRoleChangeImgReqMsg, CmdRoleChangeImgRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleChangeImgReqMsg"
    }
}

export class RequestRoleUploadPlatformImg extends RequestMsg<CmdRoleUploadPlatformImgReqMsg, CmdRoleUploadPlatformImgRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleUploadPlatformImgReqMsg"
    }
}

export class RequestRoleChangeHeadFrame extends RequestMsg<CmdRoleChangeHeadFrameReqMsg, CmdRoleChangeHeadFrameRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleChangeHeadFrameReqMsg"
    }
}

export class RequestEndBuyInfo extends RequestMsg<CmdEndBuyInfoReqMsg, CmdEndBuyInfoRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdEndBuyInfoReqMsg"
    }
}

export class RequestEndBuy extends RequestMsg<CmdEndBuyReqMsg, CmdEndBuyRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdEndBuyReqMsg"
    }
}

export class RequestRoleEndUpdate extends RequestMsg<CmdRoleEndUpdateReqMsg, CmdRoleEndUpdateRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleEndUpdateReqMsg"
    }
}

export class RequestMiningBuy extends RequestMsg<CmdMiningBuyReqMsg, CmdMiningBuyRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdMiningBuyReqMsg"
    }
}

export class RequestCodeExchange extends RequestMsg<CmdCodeExchangeReqMsg, CmdCodeExchangeRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdCodeExchangeReqMsg"
    }
}

export class RequestRoleTakeFirstCharge extends RequestMsg<CmdRoleTakeFirstChargeReqMsg, CmdRoleTakeFirstChargeRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleTakeFirstChargeReqMsg"
    }
}

export class RequestRoleWatchAdvert extends RequestMsg<CmdRoleWatchAdvertReqMsg, CmdRoleWatchAdvertRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleWatchAdvertReqMsg"
    }
}

export class RequestRoleInfoView extends RequestMsg<CmdRoleInfoViewReqMsg, CmdRoleInfoViewRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleInfoViewReqMsg"
    }
}

export class RequestRoleDouYinReward extends RequestMsg<CmdRoleDouYinRewardReqMsg, CmdRoleDouYinRewardRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleDouYinRewardReqMsg"
    }
}

export class RequestRoleAppletShare extends RequestMsg<CmdRoleAppletShareReqMsg, CmdRoleAppletShareRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleAppletShareReqMsg"
    }
}

export class RequestRoleAppletShareReward extends RequestMsg<CmdRoleAppletShareRewardReqMsg, CmdRoleAppletShareRewardRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleAppletShareRewardReqMsg"
    }
}

export class RequestRoleGuanKaGiftSelect extends RequestMsg<CmdRoleGuanKaGiftSelectReqMsg, CmdRoleGuanKaGiftSelectRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleGuanKaGiftSelectReqMsg"
    }
}

export class RequestRoleGuanKaGiftBuy extends RequestMsg<CmdRoleGuanKaGiftBuyReqMsg, CmdRoleGuanKaGiftBuyRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdRoleGuanKaGiftBuyReqMsg"
    }
}
