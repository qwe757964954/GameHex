/**
 * SLG 据点**迁城**（`CmdSlgCampMoveReqMsg` / `CmdSlgCampMoveRspMsg`，协议 r882）的归一化与文案。
 *
 * 纯 TS、零引擎依赖（规则 78），Node 下可直接单测。
 *
 * ## 协议形状
 *
 * ```
 * message CmdSlgCampMoveReqMsg {
 *   required uint32 campId   = 1; // 据点id
 *   required uint32 pos      = 2; // 下标
 *   required uint32 moveType = 3; // 移动类型,1常规移动
 * }
 * message CmdSlgCampMoveRspMsg {
 *   required uint32 succ = 1;                       // 1成功
 *   required CmdSlgCampMoveReqMsg req = 2;          // 请求信息（原样回带）
 * }
 * ```
 *
 * ## 为什么回包校验必须逐个字段比
 *
 * `CmdSlgCampMoveRspMsg.req` 是服务端**原样回带的请求信息**，协议把它设成 `required` 就是为了让客户端
 * 认出"这个回包是不是我这次请求的"。只判 `succ === 1` 会踩两种静默错误：
 *   - 玩家连点两次迁城，前一次的迟到回包被当成后一次的成功 ⇒ 界面按错的落点刷新；
 *   - 换城/换格后旧回包到达 ⇒ 把 A 城的迁城当成 B 城成功。
 * 所以 `campId` / `pos` / `moveType` **三项都要与本次请求逐字相同**，任何一项不符整包作废。
 *
 * ## `pos` 的口径
 *
 * 协议注释只写"下标"，与 `SlgGameCameRoleInfo.pos`（"所在格子"）不同名同义 —— 客户端**不做任何
 * 下标↔格 id 的换算**，`pos` 一律按调用方传入的原值透传、原值回验，换算口径留给上层（谁选的格谁负责）。
 */

import { toCount } from '../../net/RequestGuard';
import { isBigMapCampId } from './BigMapCampInfo';

const UINT32_MAX = 0xffffffff;

/**
 * 迁城类型 —— 对应 `CmdSlgCampMoveReqMsg.moveType`。
 *
 * 目前协议只有 `1 常规移动`；用 `as const` 对象 + 同名派生类型（工程规范，禁 `enum` / 禁数组下标）。
 */
export const BIGMAP_CAMP_MOVE_TYPE = {
    /** 常规移动（协议当前唯一口径）。 */
    Normal: 1,
} as const;

export type BigMapCampMoveType = (typeof BIGMAP_CAMP_MOVE_TYPE)[keyof typeof BIGMAP_CAMP_MOVE_TYPE];

/** 一次迁城请求（与协议同形）。 */
export interface IBigMapCampMoveRequest {
    readonly campId: number;
    readonly pos: number;
    readonly moveType: BigMapCampMoveType;
}

/** 迁城结果（与 `IBigMapActionFeedback` 同形，避免 Presenter 再包一层）。 */
export interface IBigMapCampMoveResult {
    readonly ok: boolean;
    readonly message: string;
}

/** 迁城相关文案。 */
export const BIGMAP_CAMP_MOVE_TEXT = {
    moved: '迁城成功',
    busy: '正在迁城，请稍候',
    invalid: '迁城参数不合法',
    failed: '迁城失败，请重试',
    disposed: '页面已关闭',
    offline: '当前未连接服务器，无法迁城',
} as const;

/** `pos` 是 `uint32`；**0 合法**（同建造 `position=0` 口径），只拒负数/小数/超界。 */
export function isBigMapCampPos(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

/** 迁城请求参数校验；不合法返回 `null`（调用方直接拒发，不浪费一次往返）。 */
export function normalizeBigMapCampMoveRequest(
    campId: unknown,
    pos: unknown,
    moveType: unknown = BIGMAP_CAMP_MOVE_TYPE.Normal,
): IBigMapCampMoveRequest | null {
    if (!isBigMapCampId(campId) || !isBigMapCampPos(pos)) return null;
    const type = toCount(moveType);
    if (type !== BIGMAP_CAMP_MOVE_TYPE.Normal) return null;
    return { campId, pos, moveType: BIGMAP_CAMP_MOVE_TYPE.Normal };
}

/**
 * 迁城回包是否属于**本次**请求，且成功。
 *
 * 判定三件，缺一不可：
 *   ① `succ === 1`；
 *   ② 回包带回的 `req` 存在且是对象（协议 `required`，缺了就是坏包）；
 *   ③ `req.campId` / `req.pos` / `req.moveType` 与本次请求**逐字相同**（见文件头）。
 *
 * @returns `true` 仅当「本次请求 + 成功」两件事同时成立
 */
export function isBigMapCampMoveSucceeded(response: unknown, request: IBigMapCampMoveRequest): boolean {
    if (!response || typeof response !== 'object') return false;
    const { succ, req } = response as { succ?: unknown; req?: unknown };
    if (toCount(succ) !== 1) return false;
    if (!req || typeof req !== 'object') return false;
    const echoed = req as { campId?: unknown; pos?: unknown; moveType?: unknown };
    return toCount(echoed.campId) === request.campId
        && toCount(echoed.pos) === request.pos
        && toCount(echoed.moveType) === request.moveType;
}
