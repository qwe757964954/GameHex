import { RequestMsg } from '../../../framework/net/RequestMsg';

/**
 * 排行榜查询（老端 `generated/requestMsg/RequestRankMsg.ts` 的 Demo3.8 版）。
 *
 * ## 只有一个请求
 *
 * | 请求 | Rsp `MessageId` | 说明 |
 * |---|---|---|
 * | `CmdGetRankReqMsg{rankType, showNum, unionId, type?}` | `345265589` | 查排行榜（回 `CmdRankData{myRank, rankList, region}`） |
 *
 * ## ⚠️ 为什么放在 `generated/requestMsg/` 而不是某个业务模块里
 *
 * 它与庆典**没有**耦合：老端 `LayerOSRank` / `LayerOSRankDetail` 也只是一次
 * `new RequestGetRank(cmd, this, cb)`。放进 `generated/requestMsg/`
 * （与 `RequestBattleMsg` / `RequestPvpMsg` / `RequestFormationMsg` / `RequestRoleMsg` 同层）
 * 是为了对齐老端目录，第二个用它的模块不用再搬一次。
 *
 * ## ⚠️ `unionId` 传的是 **自己的 roleId**，不是公会 id
 *
 * 老端两处调用（`LayerOSRankUI.updateRank` / `LayerOSRankDetailUI.enterAsync`）都是：
 *
 * ```ts
 * unionId: this.ModelMgr.ModelRole.GetRole().GetCmd().id
 * ```
 *
 * 形参名沿用了协议字段名（早期这个协议是给联盟榜用的），**别改成一个真的公会 id** ——
 * 传错服务端照样回包，只是 `myRank` 里永远没有你（界面上「我的名次」恒 `未上榜`）。
 *
 * ## ⚠️ `unionId` 是 `uint64` ⇒ 用**十进制字符串**进
 *
 * protobufjs 的 `fromObject` 对 long 字段会走 `Long.fromValue(value)`，
 * 它同时认 `Long` / `number` / 十进制字符串。`number` 在超过
 * `Number.MAX_SAFE_INTEGER` 时会**静默丢精度**（规则 23）⇒ 调用方一律传字符串。
 */

/** 查排行榜（`CmdGetRankReqMsg`）。 */
export class RequestGetRank extends RequestMsg<CmdGetRankReqMsg, CmdGetRankRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdGetRankReqMsg';
    }
}
