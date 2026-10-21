/** 匹配流程的开战参数；未传入时沿用普通 PVP 匹配。 */
export interface IMatchingEntryParams {
    readonly battleType: number;
    /** 协议 repeated string，入口必须将数字参数转成字符串。 */
    readonly battleParams: readonly string[];
}

/** 匹配界面小图标统计（图标资源名 + 数值）。 */
export interface MatchStat {
    /** 资源名；根目录固定 MATCH_ICON_ART_ROOT。 */
    icon: string;
    value: number;
}

/** 匹配界面一名玩家的展示数据。两侧共用，prefab 区分阵营配色。 */
export interface MatchPlayerData {
    name: string;
    /** 头像资源名；为空时保留当前头像。 */
    avatarIcon: string;
    /** 头像根目录；缺省用 MATCH_ART_ROOT（占位图）。写入走 applyHeadArt。 */
    avatarRoot?: string;
    power: number;
    rank: string;
    trophy: number;
    artifactName: string;
    /** 神器图标资源名；根目录 MATCH_ART_ROOT。 */
    artifactIcon: string;
    /** 小图标统计，最多 4 项。 */
    stats: MatchStat[];
}

export type MatchPhase = 'searching' | 'matched';

export const MATCH_STAT_SLOTS = 4;

/** 匹配状态机文案（非策划运营文案）。 */
export const MATCH_TEXT = {
    searching: '正在寻找对手中...',
    matched: '匹配成功！',
} as const;
