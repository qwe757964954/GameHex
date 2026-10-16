/**
 * 「聊天」的 3 个请求封装 —— 与老端 `generated/requestMsg/RequestChatMsg.ts` 一一对应。
 *
 * ⚠️ 「能不能发」的判据是 **`MessageId` 里有没有登记对应的 `<Base>RspMsg`**
 *   （`Cmd.d.ts` 5809~5811）。本轮实测三个**全部登记**：
 *     `CmdChatInitRspMsg = 691376229` / `CmdChatSendRspMsg = 917389533` / `CmdChatDelTargetRspMsg = 63079597`
 *   另有一个 `CmdChatBroMsg = 754420972` 是**服务端广播**（无 Req），由 `GameNet.addEvent` 接。
 *
 * ⚠️ 请求体字段口径（照抄 `Cmd.d.ts` 4066~4114，别照抄老端 TS 的形参类型）：
 *   | 请求 | 请求体 |
 *   |---|---|
 *   | 拉历史 | `{ channel: number, page: number, id?: Long }` |
 *   | 发消息 | `{ channel: number, content: string, id?: Long }` |
 *   | 删私聊对象 | `{ id: Long }` |
 *
 * ⚠️ `id` / `chatId` / `sendTime` / `roleId` 都是 `uint64/int64` ⇒ 一律走 `toIdString`
 *   （`protoCompiledStatic` 的构造函数是裸赋值，不做 `Long.fromValue`；发普通对象会被
 *   当成 `zero` ⇒ **id 静默变成 0**）。
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

/** 从私聊对象列表里删掉一个。Rsp: `CmdChatDelTargetRspMsg{ id }`（回带被删的 id）。 */
export class RequestChatDelTarget extends RequestMsg<CmdChatDelTargetReqMsg, CmdChatDelTargetRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdChatDelTargetReqMsg';
    }
}

/**
 * 拉招募列表 —— **协议属组队模块**（`CmdTeam*`），只因「招募」是聊天页签 0 的内容
 * 才就地封装在这里（老端也是 `LayerChat` 直接调 `ModelTeam.RequestRecruitList()`）。
 *
 * Rsp: `CmdTeamRecruitInitRspMsg{ infoList: { recruitList } }`。
 * 空请求体（`CmdTeamRecruitInitReqMsg {}`），**不依赖任何客户端战前数据** ⇒ 可以直接发。
 *
 * ⚠️ 与它同族的 `CmdTeamRecruitSendReqMsg{ battleType, battleId, attr }` /
 *    `CmdTeamRecruitJoinReqMsg{ roleId, attr }` 都带 **`attr: CmdBattleRoleAttr`**
 *    （战前属性快照）—— Demo3.8 造不出来，所以**只发 Init**，加入那一步退化（见 `ChatTexts.joinUnavailable`）。
 */
export class RequestTeamRecruitInit extends RequestMsg<CmdTeamRecruitInitReqMsg, CmdTeamRecruitInitRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTeamRecruitInitReqMsg';
    }
}
