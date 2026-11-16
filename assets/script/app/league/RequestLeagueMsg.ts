/**
 * 联盟网络请求。请求体字段和 MessageId 以生成协议为准。
 */

import { RequestMsg } from '../../framework/net/RequestMsg';

// 查询（4 条全量拉 + 1 条搜索）

/** 请求联盟详情（成员列表随 `CmdUnionMemberListUpdateBroMsg` 推）。 */
export class RequestUnionDetail extends RequestMsg<CmdUnionDetailReqMsg, CmdUnionDetailRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionDetailReqMsg';
    }
}

/** 请求联盟动态。 */
export class RequestUnionLog extends RequestMsg<CmdUnionLogReqMsg, CmdUnionLogRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionLogReqMsg';
    }
}

/** 请求联盟列表（全服页签）。 */
export class RequestUnionList extends RequestMsg<CmdUnionListReqMsg, CmdUnionListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionListReqMsg';
    }
}

/** 请求申请列表。 */
export class RequestUnionApplyList extends RequestMsg<CmdUnionApplyListReqMsg, CmdUnionApplyListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionApplyListReqMsg';
    }
}

/** 按联盟 **id** 搜索（全服页签的查询按钮）。 */
export class RequestUnionSearch extends RequestMsg<CmdUnionSearchReqMsg, CmdUnionSearchRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionSearchReqMsg';
    }
}

// 成员管理（详情页签的角色操作浮层）

/** 踢出联盟。 */
export class RequestUnionKick extends RequestMsg<CmdUnionKickReqMsg, CmdUnionKickRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionKickReqMsg';
    }
}

/** 任命 / 卸任职位（`type = true` 任命、`false` 卸任）。 */
export class RequestUnionAppoint extends RequestMsg<CmdUnionAppointReqMsg, CmdUnionAppointRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionAppointReqMsg';
    }
}

// 申请审批（申请列表面板）

/** 批准 / 拒绝单条申请（`agree = false` 即拒绝）。 */
export class RequestUnionApproveJoin extends RequestMsg<CmdUnionApproveJoinReqMsg, CmdUnionApproveJoinRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionApproveJoinReqMsg';
    }
}

/** 一键批准 / 拒绝全部申请（`agree = false` 即一键拒绝）。 */
export class RequestUnionApproveJoinOneKey extends RequestMsg<CmdUnionApproveJoinOneKeyReqMsg, CmdUnionApproveJoinOneKeyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionApproveJoinOneKeyReqMsg';
    }
}

// 联盟设置

/** 退出联盟（空请求体）。 */
export class RequestUnionQuit extends RequestMsg<CmdUnionQuitReqMsg, CmdUnionQuitRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionQuitReqMsg';
    }
}

/** 设置「快速加入」（管理页签的开关）。 */
export class RequestUnionSetQuickJoin extends RequestMsg<CmdUnionSetQuickJoinReqMsg, CmdUnionSetQuickJoinRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionSetQuickJoinReqMsg';
    }
}

/** 编辑信息：`type` 1 名字 / 2 微信号 / 3 公告 / 4 宣言。 */
export class RequestUnionEdit extends RequestMsg<CmdUnionEditReqMsg, CmdUnionEditRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionEditReqMsg';
    }
}

// 商店 / 捐献 / 活动（P4、P6 才用，先随联盟协议族一起收进来）

/** 创建联盟（**未入盟**态）。 */
export class RequestUnionCreate extends RequestMsg<CmdUnionCreateReqMsg, CmdUnionCreateRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionCreateReqMsg';
    }
}

/** 加入联盟（`unionIds` 是**数组**）。 */
export class RequestUnionJoin extends RequestMsg<CmdUnionJoinReqMsg, CmdUnionJoinRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionJoinReqMsg';
    }
}

/** 捐献（`adv = true` 走广告双倍）。 */
export class RequestUnionDonate extends RequestMsg<CmdUnionDonateReqMsg, CmdUnionDonateRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionDonateReqMsg';
    }
}

/** 砍价 / 购买（`buy = true` 即购买）。 */
export class RequestUnionBargain extends RequestMsg<CmdUnionBargainReqMsg, CmdUnionBargainRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionBargainReqMsg';
    }
}

/**
 * 商店购买 —— 联盟商店（`CmdShopType.union = 8`）走的是**通用商店**协议，不是联盟自己的。
 *
 * 老端 `ModelStore.requestBuy(id, StoreType.League, false, true)` → `RequestShopBuy`
 * （`generated/requestMsg/RequestShopMsg.ts`，那份文件 Demo3.8 **没有**移植 —— 这里补上，
 * 因为它是联盟商店唯一的购买入口，没有第二条路）。
 *
 * 请求体：`{ id, cmdShopType, buyTimes }`；响应 `{ tlCmdGoods }`（买到的奖励，联盟商店买的是实体道具）。
 *
 * `cmdShopType` 是 **proto 枚举**（`CmdShopType`），不是老端的 `StoreType` ——
 * 两者数值重合（联盟都是 8），但类型不同，调用点请用 `LEAGUE_SHOP_TYPE_UNION`。
 */
export class RequestShopBuy extends RequestMsg<CmdShopBuyReqMsg, CmdShopBuyRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdShopBuyReqMsg';
    }
}

/** 联盟商店在 `CmdShopType` / `CmdShop` 缓存里的档位号（老端 `StoreType.League = 8`）。 */
export const LEAGUE_SHOP_TYPE_UNION = 8;

/** 联盟活动类型（老端 `LeagueACT_TYPE`）。 */
export const LeagueACT_TYPE = {
    DISCOUNT: 1,
    NORTHERN_EXPEDITION: 2,
} as const;

/** 请求活动列表（`type` 取 `LeagueACT_TYPE`）。 */
export class RequestUnionActList extends RequestMsg<CmdUnionActListReqMsg, CmdUnionActListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionActListReqMsg';
    }
}

/** 活动擂鼓。 */
export class RequestUnionActDrum extends RequestMsg<CmdUnionActDrumReqMsg, CmdUnionActDrumRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionActDrumReqMsg';
    }
}

/** 活动扫荡。 */
export class RequestUnionActSweep extends RequestMsg<CmdUnionActSweepReqMsg, CmdUnionActSweepRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdUnionActSweepReqMsg';
    }
}

/** 观看广告（协议本身属角色域 `CmdRoleWatchAdvertReqMsg`，老端放在联盟文件里，这里保持同位）。 */
export class RequestRoleWatchAdvert extends RequestMsg<CmdRoleWatchAdvertReqMsg, CmdRoleWatchAdvertRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdRoleWatchAdvertReqMsg';
    }
}

// 联盟任务（P5）

/** 领取联盟任务奖励。 */
export class RequestTaskUnionGetReward extends RequestMsg<CmdTaskUnionGetRewardReqMsg, CmdTaskUnionGetRewardRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTaskUnionGetRewardReqMsg';
    }
}

/** 领取联盟任务进度奖励。 */
export class RequestTaskUnionGetProgressReward extends RequestMsg<CmdTaskUnionGetProgressRewardReqMsg, CmdTaskUnionGetProgressRewardRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTaskUnionGetProgressRewardReqMsg';
    }
}

// 北伐中原（P6）—— 排行走**通用排行协议**

/**
 * 拉排行榜（**通用排行协议**，不是联盟的）。
 *
 * 老端 `LayerLeagueNorthernExpeditionRank.requestRankInfo()` 用的是
 * `generated/requestMsg/RequestRankMsg.ts` 的 `RequestGetRank`：
 *
 * ```ts
 * { rankType: [24, 22][页签], showNum: 50, unionId: 我角色id }
 * ```
 *
 * 本端 `generated/requestMsg/` 下**没有**排行请求类（那份文件没迁），而 `CmdGetRankReqMsg` /
 * `CmdGetRankRspMsg` / `CmdRankRole` 三者在 `netProto/Cmd.d.ts` 里**都有**、
 * `CmdGetRankReqMsg` 也已登记进 `ReqMsgProtoName`（`Cmd.d.ts` 7038 行）⇒ 补一个类即可。
 *
 * 位置：与 `RequestRoleWatchAdvert` 一样，**跨域协议就近收在本文件**
 * （理由同 —— 只有一个调用点，为它单开一个 `RequestRankMsg.ts` 不值当）。
 * 老端那个 `unionId` 填的是**角色 id**（`ModelRole.GetRole().GetCmd().id`），不是 `unionId`
 * —— 看着像老代码的 bug，但**服务端那边就是这么认的**（否则老端的 `myRank` 永远是空的）。
 * 本端照抄（`loadNorthRank` 里传 `readSelfRoleId()`），不"顺手修正"。
 */
export class RequestGetRank extends RequestMsg<CmdGetRankReqMsg, CmdGetRankRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdGetRankReqMsg';
    }
}

/** 编辑信息的 `type` 取值（老端 `RequestLeagueEdit(type, content)` 的注释）。 */
export const LeagueEditType = {
    NAME: 1,
    WX: 2,
    NOTICE: 3,
    DECLARATION: 4,
} as const;
