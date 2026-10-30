/** 匹配开战参数；普通 PVP 可不传。 */
export interface IMatchingEntryParams {
    readonly battleType: number;
    /** 协议为 repeated string，数字需由入口转成字符串。 */
    readonly battleParams: readonly string[];
}

/** 信息条统计项，图标根目录为 MATCH_ICON_ART_ROOT。 */
export interface MatchStat {
    icon: string;
    value: number;
}

/** 参与方展示数据，阵营配色由槽位决定。 */
export interface MatchPlayerData {
    name: string;
    /** 头像资源名；缺失时保留占位图。 */
    avatarIcon: string;
    /** 缺省 MATCH_ART_ROOT；由 applyHeadArt 与头像资源名成对写入。 */
    avatarRoot?: string;
    power: number;
    rank: string;
    trophy: number;
    artifactName: string;
    /** 神器资源名，根目录为 ARTIFACT_ART_ROOT。 */
    artifactIcon: string;
    /** 最多展示 MATCH_STAT_SLOTS 项。 */
    stats: MatchStat[];
}

export type MatchPhase = 'searching' | 'matched';

export const MATCH_STAT_SLOTS = 4;

export const MATCH_TEXT = {
    searching: '正在寻找对手中...',
    matched: '匹配成功！',
} as const;
