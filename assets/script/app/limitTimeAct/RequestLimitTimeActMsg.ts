import { RequestMsg } from '../../framework/net/RequestMsg';

/**
 * 「限时活动」的网络请求（老端 `ModelBackStageAct` 的三条协议）。
 *
 *   - `CmdActivityJsonReqMsg { activityId, tlJsonName }` → `Rsp { content }`
 *     `content` 是一段 JSON 字符串：`{ "limitTimeTask": [...], "limitTimeDay": [...],
 *     "limitTimeActivity": [...], "limitTimeConfig": [...] }`（键 = `tlJsonName` 里的名）。
 *   - `CmdActivityLimitTimeInfoReqMsg {}` → `Rsp { tlCmdTask, tlLimitTimeActivity, tlLimitTimeDay }`
 *     每日任务进度 / 限购次数 / 每日礼包次数。
 *   - `CmdActivityLimitTimeTakeReqMsg { resId, type }` → `Rsp { tlCmdGoods, ... }`
 *     `type`：1 领每日任务奖励 / 2 买每日礼包 / 3 买限购。响应里带 `tlCmdGoods`（奖励）
 *     和更新后的 `tlCmdTask` / `tlLimitTimeDay` / `tlLimitTimeActivity`。
 *
 * 三条的 `resId` 口径不同：`Take` 的 `resId` 是**配置行 resId**（任务 / 礼包行的 id），
 * 不是活动实例 id —— 老端 `reqActivityLimitTimeTake(vo, ref.resId, type)` 直接传 `data.ref.resId`。
 */

/** 拉后台活动配置 JSON（`reqActivityJson`）。 */
export class RequestActivityJson extends RequestMsg<CmdActivityJsonReqMsg, CmdActivityJsonRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdActivityJsonReqMsg';
    }
}

/** 拉限时活动数据（每日任务进度 + 礼包 / 限购次数）。 */
export class RequestActivityLimitTimeInfo extends RequestMsg<
    CmdActivityLimitTimeInfoReqMsg,
    CmdActivityLimitTimeInfoRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdActivityLimitTimeInfoReqMsg';
    }
}

/** 领每日任务奖励 / 买每日礼包 / 买限购（`type` 区分）。 */
export class RequestActivityLimitTimeTake extends RequestMsg<
    CmdActivityLimitTimeTakeReqMsg,
    CmdActivityLimitTimeTakeRspMsg
> {
    getReqMsgProtoName(): ReqMsgProtoName {
        return 'CmdActivityLimitTimeTakeReqMsg';
    }
}
