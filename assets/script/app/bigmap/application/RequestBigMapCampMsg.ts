import { RequestMsg } from '../../../framework/net/RequestMsg';

export class RequestSlgCampSimpleInfo extends RequestMsg<CmdSlgCampSimpleInfoReqMsg, CmdSlgCampSimpleInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampSimpleInfoReqMsg';
    }
}

export class RequestSlgCampInfo extends RequestMsg<CmdSlgCampInfoReqMsg, CmdSlgCampInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampInfoReqMsg';
    }
}
