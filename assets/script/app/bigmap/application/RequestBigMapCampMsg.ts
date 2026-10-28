import { RequestMsg } from '../../../framework/net/RequestMsg';

export class RequestSlgCampSimpleInfo extends RequestMsg<CmdSlgCampSimpleInfoReqMsg, CmdSlgCampSimpleInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampSimpleInfoReqMsg';
    }
}

export class RequestSlgCampInfo extends RequestMsg<CmdSlgCampInfoReqMsg, CmdSlgCampInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampInfoReqMsg';
    }
}

/**
 * 据点**角色展示**（r879 新增）：某座据点里当前有哪些角色、各自血量与所在格。
 *
 * 与 `RequestSlgCampInfo`（据点状态：占领/开放/攻城）是**两条独立协议**，
 * 一次查询只带一个 `campId`（不像 simple/detail 支持批量）。
 */
export class RequestSlgCampRoleInfos extends RequestMsg<CmdSlgCampRoleInfosReqMsg, CmdSlgCampRoleInfosRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampRoleInfosReqMsg';
    }
}

/**
 * 据点**迁城**（r882 新增）：把自己所在的据点挪到目标位置。
 *
 * 与 `RequestSlgCampRoleInfos`（据点内角色）不是一回事，也与建筑搬移
 * （`CmdSlgBuildMoveReqMsg`，建造区内挪建筑）不是一回事 —— 迁城改的是「我在哪座城」。
 */
export class RequestSlgCampMove extends RequestMsg<CmdSlgCampMoveReqMsg, CmdSlgCampMoveRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdSlgCampMoveReqMsg';
    }
}
