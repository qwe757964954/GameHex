import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 战令网络请求（老端 `generated/requestMsg/RequestBattleTokenMsg.ts` 的 Demo3.8 版）。
 *
 * ## 为什么不能照抄老端文件
 *
 * Demo3.8 的 `ReqMsgProtoName`（`generated/netProto/Cmd.d.ts`）是**从 proto 重新生成**的
 * 联合类型，老端那份的成员名 / 泛型形状与它不一定同名。这里按新工程的 `Cmd.d.ts`
 * （`CmdBattleToken{Open,TakeReward,Reset}{Req,Rsp}Msg`）重写 —— 与 `RequestGiftMsg` 同一套写法。
 *
 * ## 三条请求的三件套（`MessageId` 登记已核）
 *
 * `Cmd.d.ts` 里三个 Rsp 都**有** `MessageId` ⇒ 可以发（规则 20：没有 `<Base>RspMsg` 就不能发）：
 *
 * | 请求 | Rsp `MessageId` | 说明 |
 * |---|---|---|
 * | `CmdBattleTokenOpenReqMsg` | `224520948` | 开通某档战令（返回 `ret: boolean`） |
 * | `CmdBattleTokenTakeRewardReqMsg` | `2063652608` | 领奖（返回 `tlReward`） |
 * | `CmdBattleTokenResetReqMsg` | `952348427` | 重置战令（返回空） |
 *
 * 另有服务端**主动推**的 `CmdBattleTokenOpenBroMsg`（`221599277`）与缓存 `CmdBattleToken`
 * （`protoCache.json` 里有，key = `type`）⇒ 状态**不自己存快照**，走 `CacheMgr.instance.getCmdBattleToken(type)`。
 *
 * ## ⚠️ 没有「拉取战令数据」的请求
 *
 * `Cmd.d.ts` 里没有 `CmdBattleTokenReqMsg`（只有上面的三个），老端 `ModelBattleToken.enter()`
 * 里也只读 `VOBattleTokenBag`（缓存）。所以缓存为空 = 服务端还没推 / 离线，界面按 0 级渲染即可，
 * **不要造一个假请求**。
 */

/** 开通一个档位（`resId` = `battleTokenPlan.resId`）。 */
export class RequestBattleTokenOpen extends RequestMsg<
    CmdBattleTokenOpenReqMsg,
    CmdBattleTokenOpenRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdBattleTokenOpenReqMsg';
    }
}

/** 领取奖励（`takeAll` / `resId` / `level` / `type` 四个可选字段）。 */
export class RequestBattleTokenTakeReward extends RequestMsg<
    CmdBattleTokenTakeRewardReqMsg,
    CmdBattleTokenTakeRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdBattleTokenTakeRewardReqMsg';
    }
}

/** 重置战令（无请求参数）。 */
export class RequestBattleTokenReset extends RequestMsg<
    CmdBattleTokenResetReqMsg,
    CmdBattleTokenResetRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdBattleTokenResetReqMsg';
    }
}
