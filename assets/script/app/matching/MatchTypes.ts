import type { ZCGameEntryParams } from '../zcds/application/ZCGameEntry';

export const MATCHING_EVENTS = {
    STATE: 'matching:state',
    /** 隐藏匹配 UI，并将云层移交给跨流程盖层。 */
    HANDOFF: 'matching:handoff',
    LEAVE: 'matching:leave',
} as const;

/** Composition 发起导航后，由盖层等待目标流程落定再散云。 */
export type IMatchingLeave =
    | { readonly destination: 'battle'; readonly entry: ZCGameEntryParams & { readonly opponents: readonly MatchPlayerData[] } }
    | { readonly destination: 'main'; readonly error: unknown };
/** 匹配开战参数；普通 PVP 可不传。 */
export interface IMatchingEntryParams {
    readonly battleType: number;
    /** 协议为 repeated string，数字需由入口转成字符串。 */
    readonly battleParams: readonly string[];
    /**
     * 本局**实际参与人数**（2~4），入口按模式声明；不传就不猜。
     *
     * 搜索阶段服务端还没回包，匹配界面要摆几条信息条只能从"入口声明 / 本地固定人数"里取
     * （见 `MatchSlots.resolveMatchSeats`）。回包之后**一律以 `unitInfos` 的条数为准**，
     * 这个字段只是提前量 —— 传错了也不会让战场少人，只影响搜索阶段那几秒的排布。
     */
    readonly participants?: number;
    /**
     * 领地普通关的关卡载荷，匹配页**不消费**，只在跳战场时原样透传给战斗流程。
     *
     * 为什么需要：领地关卡（`mode = match`）现在要先过匹配界面，而战场那边靠这份载荷取
     * 波次表 / 敌阵 / `territorySaveOwner`（战报回写）。匹配规则不消费它；组合层使用战斗入口契约传递，保证准备与挂载使用同一份波次及存档归属。
     */
    readonly pve?: ZCGameEntryParams['pve'];
    /**
     * 领地过场云层的待机**步进**（`cloud_idle_0..4` 的第几步）。
     *
     * 领地页把一整屏云交给匹配页时带过来，匹配页底层那层云从这里**接着走**：
     * 不接的话切换那一帧每朵云的形态会同时换一次，整屏"抖一下"。
     * 只有领地普通关（`mode = match`）会传；其它入口没有云，传了也不影响。
     */
    readonly coverStep?: number;
    /**
     * 云层的铺设尺寸（px）。领地页量的是地图视口（ScrollView 的可见区），与
     * `view.getVisibleSize()` 不一定相等，所以**必须带过来**：
     * 两边尺寸不同 ⇒ 点阵不同 ⇒ 切流程那一帧整屏云整体位移。
     */
    readonly coverViewport?: { readonly width: number; readonly height: number };
}

/** 废弃字段类型，保留兼容旧接口。 */
export interface MatchStat {
    icon: string;
    value: number;
}

/** 匹配条上展示的卡牌（6 格）。头像是 `icons/head` 的方头像名，品级决定卡框颜色。 */
export interface MatchCardData {
    readonly id: string;
    readonly rarity: 'gold' | 'purple' | 'blue' | 'green';
    /** 职业角标资源名；空串 = 无角标（查不到职业时）。 */
    readonly roleIcon: string;
    /** `HEAD_ART_ROOT` 下的方头像资源名。 */
    readonly headIcon: string;
    /** 头像根目录（与 `headIcon` 成对）。 */
    readonly headRoot: string;
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
    /** @deprecated 已废弃，匹配页现已改用卡牌列表（cards） */
    stats?: MatchStat[];
    /** 匹配条下方 6 格卡牌；空数组 = 无卡（匹配中 / 对手未回包）。 */
    cards: readonly MatchCardData[];
}

/** 匹配条上的卡牌格数（蓝湖稿固定 6 格）。 */
export const MATCH_CARD_SLOTS = 8;

export type MatchPhase = 'searching' | 'matched';

export const MATCH_TEXT = {
    searching: '正在寻找对手中...',
    matched: '匹配成功！',
} as const;
