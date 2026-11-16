/**
 * 「聊天」的请求封装 —— 与老端 `generated/requestMsg/RequestChatMsg.ts` 对应。
 *
 * 请求体字段照 `Cmd.d.ts` 写：拉历史 `{ channel, page, id? }`、发消息
 * `{ channel, content, id? }`、删私聊对象 `{ id }`。
 *
 * `id` / `chatId` / `sendTime` / `roleId` 都是 `uint64`，一律走 `toIdString`：
 * 生成的请求类构造函数是裸赋值，不发换算，真正的换算在编码时由 `LongBits.from` 做；
 * 传普通对象会被当成 `zero`，id 静默变成 0。
 */

import { RequestMsg } from '../../framework/net/RequestMsg';

/** 拉某个频道的历史（私聊 / 联盟要带 `id`）。Rsp: `CmdChatInitRspMsg{ channel, id, page, list }`。 */
export class RequestChatInit extends RequestMsg<CmdChatInitReqMsg, CmdChatInitRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdChatInitReqMsg';
    }
}

/** 发一条消息（私聊 / 联盟带 `id`）。Rsp: `CmdChatSendRspMsg{ ret }`。 */
export class RequestChatSend extends RequestMsg<CmdChatSendReqMsg, CmdChatSendRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdChatSendReqMsg';
    }
}

/** 从私聊对象列表里删掉一个。Rsp: `CmdChatDelTargetRspMsg{ id }`。 */
export class RequestChatDelTarget extends RequestMsg<CmdChatDelTargetReqMsg, CmdChatDelTargetRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdChatDelTargetReqMsg';
    }
}

/**
 * 拉招募列表 —— 协议属组队模块，只因「招募」是聊天页签 0 的内容才就地封装。
 *
 * Rsp: `CmdTeamRecruitInitRspMsg{ infoList: { recruitList } }`，空请求体、不依赖战前数据。
 * 同族的 `CmdTeamRecruitSend` / `CmdTeamRecruitJoin` 都带 `attr: CmdBattleRoleAttr`
 * （战前属性快照），本工程造不出来，所以只发 Init。
 */
export class RequestTeamRecruitInit extends RequestMsg<CmdTeamRecruitInitReqMsg, CmdTeamRecruitInitRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTeamRecruitInitReqMsg';
    }
}
