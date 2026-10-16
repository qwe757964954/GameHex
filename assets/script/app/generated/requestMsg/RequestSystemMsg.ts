import { RequestMsg } from "../../../framework/net/RequestMsg"

/**
 * 系统类请求（从 client 的 app/generated/requestMsg/RequestSystemMsg.ts 同步）。
 * 协议类型（CmdSystemGmReqMsg / CmdGmListReqMsg / CmdGmListRspMsg）已在
 * app/generated/netProto/Cmd.d.ts 中声明，编码走 framework/net/ProtoMgr。
 */
export class RequestSystemGm extends RequestMsg<CmdSystemGmReqMsg, CmdSystemGmRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return "CmdSystemGmReqMsg"
    }
}

export class RequestGmList extends RequestMsg<CmdGmListReqMsg, CmdGmListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return "CmdGmListReqMsg"
    }
}
