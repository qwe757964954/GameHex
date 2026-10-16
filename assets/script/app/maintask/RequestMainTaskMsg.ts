import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 主线任务的网络请求。
 *
 * `CmdTakeMainTaskRewardReqMsg { resId: number }` ⇒ `CmdTakeMainTaskRewardRspMsg
 * { ret?: boolean, resId?: number, tlCmdGoods?: CmdGoods[] }`。
 *
 * 登记情况（项目规则 20：**能不能发只看 `MessageId` 有没有登记 `<Base>RspMsg`**）：
 * `assets/script/lib/protobuf/protoCompiledStatic.ts` 的 `cmd.MessageId` 里
 * `values[valuesById[189258127] = "CmdTakeMainTaskRewardRspMsg"]` ⇒ 已登记，发得出去。
 *
 * ⚠️ 服务端**没有** `CmdMainTask` 这类整包推送（`CacheMgrGen` 里只有
 * `getCmdTask(resId)` / `getTlCmdTask()`，走的是通用的 `CmdTask` 缓存），
 * 所以领奖后状态由 `CmdTask` 缓存自身更新，本类不做「增量覆盖」。
 */

/** 领取英雄任务奖励（「10级领取」）。 */
export class RequestTakeMainTaskReward extends RequestMsg<
    CmdTakeMainTaskRewardReqMsg,
    CmdTakeMainTaskRewardRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdTakeMainTaskRewardReqMsg';
    }
}
