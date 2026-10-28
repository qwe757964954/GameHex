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

/**
 * 玩家点击界面（`mark` 是**服务端编号**，2 = 世界；与客户端 `MainTab` 下标无关）。
 *
 * 这是**单向埋点**：回包只有 `succ`，不携带任何业务数据 ⇒ 调用方 fire-and-forget，
 * 失败只 warn，绝不阻塞界面切换。
 */
export class RequestGameViewClick extends RequestMsg<CmdGameViewClickReqMsg, CmdGameViewClickRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return "CmdGameViewClickReqMsg"
    }
}
