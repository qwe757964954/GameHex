import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 心跳请求：定时对时，同时作为断线探测的在途协议。
 * 请求体 CmdSystemSyncTimeReqMsg 为空，响应 CmdSystemSyncTimeRspMsg 带回 serverTime。
 * 没有在途协议时浏览器可能长时间不触发 onclose，心跳保证 1 个超时周期内可判定断线。
 */
export class RequestHeartbeat extends RequestMsg<CmdSystemSyncTimeReqMsg, CmdSystemSyncTimeRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSystemSyncTimeReqMsg';
    }
}
