import { RequestMsg } from '../../../framework/net/RequestMsg';

/**
 * 占城（领地）网络请求。
 *
 * 协议一览（`client_proto/protoCompiled.proto:4527-4594`，消息号见 `MessageId` 枚举）：
 *
 * | 协议 | 消息号 | 用途 |
 * |---|---|---|
 * | `CmdCityChapterCellInfoReqMsg` | 1137184677 | 拉章节格子状态（解锁 / 通关 / 领奖态）|
 * | `CmdCityChapterUnlockCellReqMsg` | 45711217 | 解锁格子 |
 * | `CmdCityChapterPassCellReqMsg` | 1560327682 | 通关格子（占领）|
 * | `CmdCityChapterSweepReqMsg` | 1335059463 | 章节扫荡 |
 * | `CmdCityChapterIdleRewardReqMsg` | 1309083890 | 领挂机奖励 |
 *
 * ⚠️ **`levelChapter` 就是领地侧的 `chapterId`** —— 同一套章节号
 * （见 `TerritoryCampaignConfig.buildTerritoryCampaign` 里 `row.levelChapter === chapterId` 的筛法）。
 *
 * ⚠️ 服务端**一条都不推**：`assets/resources/config/protoCache.json` 里没有这些表
 * ⇒ 全部必须主动请求。走 `CacheMgr` 只会拿到**恒空数组**，
 * 症状是"数据永远空的、且零报错"（`ProcedureMatching` 踩过同款坑）。
 */

/** 拉章节格子信息。 */
export class RequestTerritoryCellInfo extends RequestMsg<
    CmdCityChapterCellInfoReqMsg,
    CmdCityChapterCellInfoRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterCellInfoReqMsg';
    }
}

/** 解锁格子。 */
export class RequestTerritoryUnlockCell extends RequestMsg<
    CmdCityChapterUnlockCellReqMsg,
    CmdCityChapterUnlockCellRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterUnlockCellReqMsg';
    }
}

/** 通关格子（= 占领）。 */
export class RequestTerritoryPassCell extends RequestMsg<
    CmdCityChapterPassCellReqMsg,
    CmdCityChapterPassCellRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterPassCellReqMsg';
    }
}

/** 章节扫荡。 */
export class RequestTerritorySweep extends RequestMsg<
    CmdCityChapterSweepReqMsg,
    CmdCityChapterSweepRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterSweepReqMsg';
    }
}

/** 领挂机奖励。 */
export class RequestTerritoryIdleReward extends RequestMsg<
    CmdCityChapterIdleRewardReqMsg,
    CmdCityChapterIdleRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterIdleRewardReqMsg';
    }
}