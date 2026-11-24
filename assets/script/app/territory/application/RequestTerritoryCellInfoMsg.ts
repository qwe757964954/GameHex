import { RequestMsg } from '../../../framework/net/RequestMsg';
import { TERRITORY_TEXTS } from './TerritoryTexts';

/**
 * 占城（领地）网络请求。
 *
 * 单章格子状态的拉取、解锁、通关、扫荡与挂机奖励均使用这里的消息类；
 * 账号级章节汇总在 `RequestTerritoryChapterInfoMsg`。
 * 这些协议没有推包，必须主动请求，不能依赖缓存。
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

/**
 * 升级怪物宝箱等级（`CmdCityChapterUpMonsterBoxLvReqMsg`）。
 *
 * 请求体只有 `levelChapter` + `cellId`：**消耗不随包带**（不像解锁要付银币），
 * 由服务端按当前等级查表扣。回包 `succ` + `monsterBoxInfo`（那一格的新等级），
 * 客户端不本地 +1 —— 服务端才是等级真源。
 */
export class RequestTerritoryUpMonsterBoxLv extends RequestMsg<
    CmdCityChapterUpMonsterBoxLvReqMsg,
    CmdCityChapterUpMonsterBoxLvRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterUpMonsterBoxLvReqMsg';
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

/**
 * 领挂机奖励。
 *
 * 请求体是**空消息**（`client_proto/protoCompiled.proto:4606` 里 `{}`）——
 * 不要像早期那样塞 `{ levelChapter }`：不属于 schema 的属性会被 protobufjs 编码时
 * **静默丢弃**（与 `CmdBattleSweepReqMsg` 的 `times` 同款坑），日志里看不出任何异常。
 * 章节归属由服务端按当前活动章节判定。
 */
export class RequestTerritoryIdleReward extends RequestMsg<
    CmdCityChapterIdleRewardReqMsg,
    CmdCityChapterIdleRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdCityChapterIdleRewardReqMsg';
    }
}
