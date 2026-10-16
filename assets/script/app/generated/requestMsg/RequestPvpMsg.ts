import { RequestMsg } from '../../../framework/net/RequestMsg';

/** 请求本机角色 PVP 玩法信息。请求体为空，身份靠长连接，返回的是自己的数据。 */
export class RequestPvpInfo extends RequestMsg<CmdPvpInfoReqMsg, CmdPvpInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdPvpInfoReqMsg';
    }
}

/** 请求拥有的 PVP 英雄及等级。 */
export class RequestPvpHeroInfoList extends RequestMsg<CmdPvpHeroInfoListReqMsg, CmdPvpHeroInfoListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdPvpHeroInfoListReqMsg';
    }
}

/**
 * 把某 PVP 英雄升一级。请求体只有 heroId，消耗由服务端按 cardLevelUp 算；
 * 客户端算材料只决定按钮能否点，不是请求参数。
 */
export class RequestPvpHeroUpLevel extends RequestMsg<CmdPvpHeroUpLevelReqMsg, CmdPvpHeroUpLevelRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdPvpHeroUpLevelReqMsg';
    }
}

/**
 * 把某个 PVP 英雄的某个技能升一级。
 *
 * 请求体 `{ heroId, skillId }`，消耗同样由服务端按表自己扣，
 * 与 {@link RequestPvpHeroUpLevel} 同口径（客户端算材料只决定按钮能否点）。
 *
 * ⚠️ 响应只回**那一条** `CmdPvpHeroInfo`（含 `skills` 全量），不刷英雄列表
 * —— 调用方必须自己把新技能等级写回本地缓存，见 `applyPvpHeroSkillLevel`。
 */
export class RequestPvpHeroUpSkill extends RequestMsg<CmdPvpHeroUpSkillReqMsg, CmdPvpHeroUpSkillRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdPvpHeroUpSkillReqMsg';
    }
}
