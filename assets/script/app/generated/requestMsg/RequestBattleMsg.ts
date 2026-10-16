import { RequestMsg } from '../../../framework/net/RequestMsg';

/**
 * 「开始游戏」请求：开一局，拿回战斗 id / 种子 / 双方单元。
 * 请求载荷必须嵌在 startBattleInfo 里。seed 是 uint64，先转字符串再用。
 */
export class RequestStartBattle extends RequestMsg<CmdStartBattleReqMsg, CmdStartBattleRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdStartBattleReqMsg';
    }
}

/** 「完成战斗」请求：上报结果，拿回加减分与新段位/积分。 */
export class RequestFinishBattle extends RequestMsg<CmdFinishBattleReqMsg, CmdFinishBattleRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdFinishBattleReqMsg';
    }
}
