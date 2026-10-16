import { toCount } from '../net/RequestGuard';
import type { MatchProfileLookup } from './BattleStartModel';
import type { MatchPlayerData } from '../matching/MatchTypes';

/**
 * CmdPvpInfo（本机角色常驻 PVP 数据）模型与校验 —— 纯函数，零引擎依赖。
 * grade 是段位 id（不是名），score 是段位积分（奖杯数）。
 */

export interface ZCPvpInfo {
    /** 段位 id（grade.json gradeId）；显示名要查表。 */
    readonly grade: number;
    readonly score: number;
    readonly winCount: number;
    readonly gradeRewardTag: number;
}

/** 响应 → ZCPvpInfo；info 缺失返回 null。不拿 grade===0 当无效（语义由服务端定）。 */
export function normalizePvpInfo(rsp: CmdPvpInfoRspMsg | null | undefined): ZCPvpInfo | null {
    const info = rsp?.info;
    if (!info) {
        if (rsp) console.warn('[PvpInfoModel] 响应缺少 info，已丢弃', rsp);
        return null;
    }
    return {
        grade: toCount(info.grade),
        score: toCount(info.score),
        winCount: toCount(info.winCount),
        gradeRewardTag: toCount(info.gradeRewardTag),
    };
}

/**
 * 把 PVP 信息叠加到玩家数据：只覆盖服务端给了的字段。
 * rank 查 grade 表、查不到保留原值；score ≤ 0 保留原值。
 * winCount（连胜）刻意不上屏：没有对应图标口径。
 */
export function applyPvpInfoToPlayerView(
    base: MatchPlayerData,
    info: ZCPvpInfo | null,
    lookup?: MatchProfileLookup | null,
): MatchPlayerData {
    if (!info) return base;
    const next: MatchPlayerData = { ...base };
    const rank = lookup ? lookup.gradeName(info.grade) : '';
    if (rank) next.rank = rank;
    if (info.score > 0) next.trophy = info.score;
    return next;
}
