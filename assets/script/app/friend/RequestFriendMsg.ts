/**
 * 「好友」的 14 个请求封装 —— 与老端 `generated/requestMsg/RequestFriendsMsg.ts` 一一对应。
 *
 * 为什么不照抄老端文件：Demo3.8 的 `ReqMsgProtoName` 是**从 proto 重新生成**的
 * （`assets/script/app/generated/netProto/Cmd.d.ts` 7130~7143 行），
 * 老端那份的键名与这里是同一套（`CmdFriendsApplyReqMsg` …），所以逐个重建即可，
 * 顺带把老端拼错的类名（`RequestdFriendAgreeOneKey` / `RequestdFriendRefreshSuggest`）
 * **保留原样** —— 保持可对照，改名会让「老端有没有这个调用」的检索失效。
 *
 * ⚠️ 「能不能发」的判据是 **`MessageId` 里有没有登记对应的 `<Base>RspMsg`**
 *   （`Cmd.d.ts` 5832~5845 行）。本轮实测 14 个 **全部登记**，
 *   另有 8 个 `…BroMsg` 推送（6011~6018 行）—— 推送侧由 `FriendRepository.listen()` 接。
 *
 * ⚠️ 请求体字段口径（照抄 `Cmd.d.ts`，别照抄老端 TS 的形参类型）：
 *   | 请求 | 请求体 |
 *   |---|---|
 *   | 申请 / 通过 / 拒绝 / 领取 / 赠送 / 拉黑 / 移除黑名单 | `{ targetId: Long }` |
 *   | 删除好友 | `{ targetId: Long[] }` ← **数组**（唯一一个批量） |
 *   | 搜索 | `{ targetId: Long, targetName: string }`（按名搜时 id 传 0） |
 *   | 一键领取 / 一键赠送 / 一键同意 / 一键拒绝 / 刷新推荐 | `{}`（空请求体） |
 */

import { RequestMsg } from '../../framework/net/RequestMsg';

/** 好友申请。Rsp: `CmdFriendsApplyRspMsg{ targetId }`。 */
export class RequestFriendsApply extends RequestMsg<CmdFriendsApplyReqMsg, CmdFriendsApplyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsApplyReqMsg';
    }
}

/** 通过好友申请。Rsp: `CmdFriendsAddRspMsg`。 */
export class RequestFriendsAdd extends RequestMsg<CmdFriendsAddReqMsg, CmdFriendsAddRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsAddReqMsg';
    }
}

/** 拒绝好友申请。 */
export class RequestFriendsRefuse extends RequestMsg<CmdFriendsRefuseReqMsg, CmdFriendsRefuseRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsRefuseReqMsg';
    }
}

/** 删除好友（**批量**，`targetId` 是数组）。Rsp 回带真正删掉的那批 id。 */
export class RequestFriendsRemove extends RequestMsg<CmdFriendsRemoveReqMsg, CmdFriendsRemoveRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsRemoveReqMsg';
    }
}

/** 拉黑好友。 */
export class RequestFriendsBlack extends RequestMsg<CmdFriendsBlackReqMsg, CmdFriendsBlackRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsBlackReqMsg';
    }
}

/** 移出黑名单（注意是 `Friend` 单数 + `BlackRemove`，与上面的复数形式不同）。 */
export class RequestFriendBlackRemove extends RequestMsg<CmdFriendBlackRemoveReqMsg, CmdFriendBlackRemoveRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendBlackRemoveReqMsg';
    }
}

/** 搜索玩家（按 id 或按名字，另一个字段传 0 / 空串）。 */
export class RequestFriendsSearch extends RequestMsg<CmdFriendsSearchReqMsg, CmdFriendsSearchRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendsSearchReqMsg';
    }
}

/** 领取某个好友的体力。 */
export class RequestFriendGetEnd extends RequestMsg<CmdFriendGetEndReqMsg, CmdFriendGetEndRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendGetEndReqMsg';
    }
}

/** 一键领取（Rsp 里的 `friendList` 是**本次真的领到**的那批，可能为空）。 */
export class RequestFriendGetEndOneKey extends RequestMsg<CmdFriendGetEndOneKeyReqMsg, CmdFriendGetEndOneKeyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendGetEndOneKeyReqMsg';
    }
}

/** 赠送体力给某个好友。 */
export class RequestFriendSendEnd extends RequestMsg<CmdFriendSendEndReqMsg, CmdFriendSendEndRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendSendEndReqMsg';
    }
}

/** 一键赠送（Rsp 的 `friendList` 是本次赠送到的那些）。 */
export class RequestFriendSendEndOneKey extends RequestMsg<CmdFriendSendEndOneKeyReqMsg, CmdFriendSendEndOneKeyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendSendEndOneKeyReqMsg';
    }
}

/** 一键同意（**类名保留老端的拼写** `Requestd…`，见文件头注释）。 */
export class RequestdFriendAgreeOneKey extends RequestMsg<CmdFriendAgreeOneKeyReqMsg, CmdFriendAgreeOneKeyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendAgreeOneKeyReqMsg';
    }
}

/** 一键拒绝（类名同上，保留老端拼写）。 */
export class RequestdFriendRefuseOneKey extends RequestMsg<CmdFriendRefuseOneKeyReqMsg, CmdFriendRefuseOneKeyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendRefuseOneKeyReqMsg';
    }
}

/** 刷新「添加好友」页签的推荐列表（Rsp 的 `suggestList` 是全量替换）。 */
export class RequestdFriendRefreshSuggest extends RequestMsg<CmdFriendRefreshSuggestReqMsg, CmdFriendRefreshSuggestRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFriendRefreshSuggestReqMsg';
    }
}
