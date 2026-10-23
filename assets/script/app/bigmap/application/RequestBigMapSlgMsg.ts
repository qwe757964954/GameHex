import { RequestMsg } from '../../../framework/net/RequestMsg';

export class RequestSlgActionUpdate extends RequestMsg<CmdSlgActionUpdateReqMsg, CmdSlgActionUpdateRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgActionUpdateReqMsg'; }
}
export class RequestSlgGameInfo extends RequestMsg<CmdSlgGameInfoReqMsg, CmdSlgGameInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgGameInfoReqMsg'; }
}
export class RequestSlgBuildInfo extends RequestMsg<CmdSlgBuildInfoReqMsg, CmdSlgBuildInfoRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildInfoReqMsg'; }
}
export class RequestSlgBuild extends RequestMsg<CmdSlgBuildReqMsg, CmdSlgBuildRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildReqMsg'; }
}
export class RequestSlgBuildUpgrade extends RequestMsg<CmdSlgBuildUpgradeReqMsg, CmdSlgBuildUpgradeRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildUpgradeReqMsg'; }
}
export class RequestSlgBuildCancel extends RequestMsg<CmdSlgBuildCancelReqMsg, CmdSlgBuildCancelRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildCancelReqMsg'; }
}
export class RequestSlgBuildMove extends RequestMsg<CmdSlgBuildMoveReqMsg, CmdSlgBuildMoveRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildMoveReqMsg'; }
}
export class RequestSlgBuildCollect extends RequestMsg<CmdSlgBuildCollectReqMsg, CmdSlgBuildCollectRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildCollectReqMsg'; }
}
export class RequestSlgBuildUnlockQueue extends RequestMsg<CmdSlgBuildUnlockQueueReqMsg, CmdSlgBuildUnlockQueueRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdSlgBuildUnlockQueueReqMsg'; }
}
