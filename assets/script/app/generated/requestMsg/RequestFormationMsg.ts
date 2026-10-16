import { RequestMsg } from '../../../framework/net/RequestMsg';

/** 阵型拉取与保存。CmdFormationInfo 字段：formationId、heroId 列表。 */

/** 请求全部阵型。 */
export class RequestFormationInfo extends RequestMsg<CmdFormationInfoReqMsg, CmdFormationInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFormationInfoReqMsg';
    }
}

/** 保存（整份覆盖）一个阵型；一键下阵 = 发空 heroId 列表。 */
export class RequestFormationOp extends RequestMsg<CmdFormationOpReqMsg, CmdFormationOpRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFormationOpReqMsg';
    }
}

/** 选中某阵型（切页签时告知服务端）。 */
export class RequestFormationSelect extends RequestMsg<CmdFormationSelectReqMsg, CmdFormationSelectRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFormationSelectReqMsg';
    }
}
