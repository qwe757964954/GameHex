/**
 *据点状态（`SlgCampSimpleInfo` / `SlgCampInfo`）—— 纯 TS，零 `cc` 依赖。
 *
 *## 协议形状（2026-10-30 后端定稿）
 *
 *```
 *message SlgCampSimpleInfo {                       // 大地图缩略视角
 *  required uint32 campId     = 1;
 *  required uint32 opType     = 2;                 // 0=尚未占领(黄色) 1=已占领(红色)
 *}
 *message SlgCampInfo {                             // 点击据点弹窗
 *  required uint32 campId         = 1;
 *  required uint32 opType         = 2;             // 0=尚未占领 1=已占领
 *  optional uint64 occupyRoleId   = 3;             // 占领者玩家 id
 *  optional string occupyRoleName = 4;             // 占领者名字
 *}
 *```
 *
 *## 三条口径（错一条就是静默出错）
 *
 *1. 服务器只表达「有没有人占」，不再下发「开放 / 攻城中 / 结算中」。能不能打完全由客户端
 *   日程（`bigMapCityAttackGate`）判 —— 早期 `state` 字段已从协议移除，这里不保留兼容字段，
 *   否则「服务器说的」和「日程算的」必然两套真源打架。
 *2. `occupyRoleId` 是 `uint64`，一律走字符串（与 `BigMapCampRoleInfo.roleId` 同一口径），
 *   `Number()` 超过 `MAX_SAFE_INTEGER` 会静默丢精度。
 *3. 简略包与详情包字段不同：`detailed = false` 的条目只可信 `opType`，占领者字段恒空；
 *   合并由 `BigMapCampRepository` 负责（简略包只覆盖 `opType`、详情包整条替换），
 *   这样「先详情、后简略」不会把已经拿到的占领者名字抹掉。
 */

import { toIdString } from '../../net/RequestGuard';

/** 一个据点的服务器状态。`opType`：0 = 尚未占领 / 1 = 已占领。 */
export interface IBigMapCampInfo {
    readonly campId: number;
    readonly opType: 0 | 1;
    /** 占领者玩家 id（`uint64` → 十进制字符串）；简略包或未占领时为空串。 */
    readonly occupyRoleId: string;
    /** 占领者名字；简略包或未占领时为空串。 */
    readonly occupyRoleName: string;
    /** 这条快照来自详情包（`SlgCampInfo`）。`false` = 只有 `opType` 可信。 */
    readonly detailed: boolean;
}

export const BIGMAP_CAMP_OCCUPATION_TEXT = ['未占领', '已占领'] as const;

export const BIGMAP_CAMP_QUERY_TEXT = {
    pending: '据点信息加载中',
    failed: '据点信息获取失败，请重新选择据点重试',
    failedCanAttack: '暂未获取据点状态，可尝试攻打',
    attackUnavailable: '攻城操作暂未接入服务器',
} as const;

export function isBigMapCampId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 0xFFFFFFFF;
}

/**
 *归一化据点回包。
 *
 *@param detailed `true` = 详情包（`SlgCampInfo`，带占领者），`false` = 简略包（只有 `opType`）。
 *  这里只标注「这一包是什么类型」，不与已有快照合并（那是 Repository 的事）。
 *@returns 整包不可用（不是对象 / `infos` 不是数组）返回 `null`，由调用方保留旧快照；
 *  单条缺字段或枚举未知只跳过该条，不能把脏回包当成「未占领」。
 */
export function normalizeBigMapCampInfos(
    response: unknown,
    detailed = false,
): readonly IBigMapCampInfo[] | null {
    if (!response || typeof response !== 'object') return null;
    const infos = (response as { infos?: unknown }).infos;
    if (!Array.isArray(infos)) return null;
    const result = new Map<number, IBigMapCampInfo>();
    for (const info of infos) {
        if (!info || typeof info !== 'object') continue;
        const { campId, opType, occupyRoleId, occupyRoleName } =
            info as { campId?: unknown; opType?: unknown; occupyRoleId?: unknown; occupyRoleName?: unknown };
        if (!isBigMapCampId(campId) || (opType !== 0 && opType !== 1)) continue;
        //简略包不解析占领者：本包没有这个字段，不能据此判定「占领者被清空」。
        const roleId = detailed ? toIdString(occupyRoleId) : '';
        const roleName = detailed && typeof occupyRoleName === 'string' ? occupyRoleName.trim() : '';
        result.set(campId, {
            campId,
            opType,
            //未占领时清空占领者：`opType` 与占领者必须自洽，否则界面会出现「未占领 · 张三」。
            occupyRoleId: opType === 1 ? roleId : '',
            occupyRoleName: opType === 1 ? roleName : '',
            detailed,
        });
    }
    return Array.from(result.values());
}
