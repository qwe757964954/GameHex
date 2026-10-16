import { RequestMsg } from "../../../framework/net/RequestMsg"

/**
 * 兵种（民兵 66014 …）相关请求。
 *
 * ⚠️ 本文件与同目录其它 `Request*Msg.ts` 一样是**手写补全**的：生成脚本目前不产出
 * 兵种这一族，但协议号 `CmdArmyLevelUpRspMsg` 在 `protoCompiledStatic` 里是有的
 * （项目规则 20：能不能发只看 `MessageId` 在不在）。
 */
export class RequestArmyUpLevel extends RequestMsg<CmdArmyLevelUpReqMsg, CmdArmyLevelUpRspMsg>
{
    getReqMsgProtoName():ReqMsgProtoName
    {
        return "CmdArmyLevelUpReqMsg"
    }
}
