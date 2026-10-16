/**
 * 「邮件」的 4 个请求封装 —— 与老端 `generated/requestMsg/RequestMailMsg.ts` 一一对应。
 *
 * ⚠️ 「能不能发」的判据是 **`MessageId` 里有没有登记对应的 `<Base>RspMsg`**
 *   （`assets/script/app/generated/netProto/Cmd.d.ts` 5883~5886 行）。本轮实测 4 个**全部登记**：
 *
 *   ```
 *   CmdMailListRspMsg       = 319013138
 *   CmdMailReadRspMsg       = 546189302
 *   CmdMailDeleteRspMsg     = 172353567
 *   CmdMailTakeRewardRspMsg = 555367350
 *   ```
 *
 * ⚠️ 请求体字段口径（照抄 `Cmd.d.ts`，别照抄老端 TS 的形参类型）：
 *   | 请求 | 请求体 | 说明 |
 *   |---|---|---|
 *   | 列表 | `{}` | 空请求体（老端 `let mgr: CmdMailListReqMsg = {}`） |
 *   | 读取（看详情） | `{ id: Long }` | **单数** |
 *   | 删除 | `{ id: Long[] }` | **数组**（一键删除 / 单封删除共用） |
 *   | 领取奖励 | `{ id: Long[] }` | **数组**（一键领取 / 单封领取共用） |
 */

import { RequestMsg } from '../../framework/net/RequestMsg';

/** 拉邮件列表。Rsp: `CmdMailListRspMsg{ tlCmdMailSimple }` —— 全量替换。 */
export class RequestMailList extends RequestMsg<CmdMailListReqMsg, CmdMailListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdMailListReqMsg';
    }
}

/** 读一封邮件（看详情，服务端顺带把它标成已读）。Rsp: `CmdMailReadRspMsg{ cmdMail }`。 */
export class RequestMailRead extends RequestMsg<CmdMailReadReqMsg, CmdMailReadRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdMailReadReqMsg';
    }
}

/** 删除邮件（批量）。Rsp: `CmdMailDeleteRspMsg`（空消息，删完要重拉列表）。 */
export class RequestMailDelete extends RequestMsg<CmdMailDeleteReqMsg, CmdMailDeleteRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdMailDeleteReqMsg';
    }
}

/** 领取奖励（批量）。Rsp: `CmdMailTakeRewardRspMsg{ tlReward }` —— 回带**真正领到**的奖励。 */
export class RequestMailTakeReward extends RequestMsg<CmdMailTakeRewardReqMsg, CmdMailTakeRewardRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdMailTakeRewardReqMsg';
    }
}
