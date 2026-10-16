/**
 * 「联盟」的数据端口 —— **缓存 + 配置表 + 网络请求** 三合一的 Repository。
 *
 * 与 `FriendRepository` / `GiftRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `LeagueTable`（纯函数、可单测），本文件只负责「把数据搬进来 / 把请求发出去」。
 *
 * ## 数据来源（四张表全是**服务端推**，本类不存快照）
 *
 * `assets/resources/config/protoCache.json` 里有这几张表 ⇒ 服务端会主动推
 * （`GameCacheMgr.handleCache` 按 `CmdCache` 写进 `GameCache`）⇒ 每次 `load()` 现读
 * `CacheMgr`，不复制一份：
 *
 * | 缓存表 | `tlKey` | 内容 | 对应的推送 |
 * |---|---|---|---|
 * | `CmdRoleUnion` | `roleId` | **我的**联盟态（`unionId`） | `CmdUnionInfoUpdateBroMsg` |
 * | `CmdUnion` | `id` | 联盟本体（名称 / 等级 / 旗帜 / 人数上限 …） | `CmdUnionInfoUpdateBroMsg` |
 * | `CmdUnionMember` | `roleId` | 成员列表（职位 / 贡献 / 在线 …） | `CmdUnionMemberListUpdateBroMsg` |
 * | `CmdUnionApplys` | `applyId` | 入盟申请 | `CmdUnionApplyListUpdateBroMsg` |
 * | `CmdUnionLogs` | `id` | 动态 | `CmdUnionLogListUpdateBroMsg` |
 *
 * ## 唯一**必须自己存**的东西：搜索缓存（`searchCache`）
 *
 * 老端 `ModelLeague.searchCacheDict` 保存「按 id 搜到的那一个联盟」，**且以输入串为键**
 * （见 `LeagueTable.pickUnionListForSearch` 的注释）。搜索结果只在 Rsp 里、
 * 没有推送、也不在缓存表里 ⇒ 只能放内存。
 *
 * ⚠️ 为什么**不**把 Rsp 里的 `CmdUnion` 补写进 `CmdUnion` 缓存表（`FriendRepository` 的
 * `localPatches` 那种做法）：全服页签展示的是**别人家**的联盟，写进缓存会和「我所在的联盟」
 * 抢同一个 `tlKey`；而 `CmdUnion.getTlCmdUnion()` 是**全表**读，一旦混进来就会污染
 * 母面板头部的联盟信息。所以搜索缓存**独立存放**，不进缓存表。
 *
 * ## 请求三态
 *
 * 每个请求都是 `'ok' | 'offline' | 'failed'`：**离线早退**、`withTimeout` 兜底
 * （读 800ms / 写 5000ms），`catch` 一律返 `'failed'` —— 绝不把 Promise 悬着。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo as ILeagueGoodsInfo } from '../activity/LayerActivityTable';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { toIdString, withTimeout } from '../net/RequestGuard';
import {
    buildLeagueCostView,
    findLeagueProperty,
    findMyUnion,
    findSelfMember,
    ILeagueApplyRow,
    ILeagueCostView,
    ILeagueLogRow,
    ILeagueMemberRow,
    ILeagueOfficialRow,
    ILeagueUnionRow,
    isLeagueNameUsable,
    LeaguePosition,
    LEAGUE_CREATE_COST_RES_ID,
    LEAGUE_GAME_CONFIG_TABLE,
    LEAGUE_PROPERTY_TABLE,
    leagueCreateBannerIndexOf,
    leagueCreateCost,
    leagueMaxExp,
    LEAGUE_UNION_LEVEL_TABLE,
    LEAGUE_UNION_OFFICIAL_TABLE,
    LEAGUE_UNION_COIN_RES_ID,
    LEAGUE_UNION_CONTRI_RES_ID,
    LEAGUE_COIN_RES_ID,
    normalizeLeagueApplies,
    normalizeLeagueLogs,
    normalizeLeagueMembers,
    normalizeLeagueUnion,
    normalizeLeagueUnions,
    officialPowersMap,
    parseLeagueOfficialRows,
    parseLeaguePropertyRows,
    parseUnionLevelRows,
    rolePropertyAmount,
    // —— P4 ——
    buildLeagueDiscountRows,
    buildLeagueDiscountView,
    buildLeagueStoreRowViews,
    canLeagueBargain,
    canLeagueBuyBargain,
    hasLeagueDiscountRedDot,
    hasLeagueStoreRedDot,
    ILeagueDiscountRowView,
    ILeagueDiscountView,
    ILeagueP4Config,
    ILeagueStoreRowView,
    ILeagueUnionDiscountRow,
    ILeagueUnionShopRow,
    leagueShopBuyTimesOf,
    LEAGUE_ITEM_TABLE,
    LEAGUE_P4_CONFIG_DEFAULTS,
    LEAGUE_UNION_DISCOUNT_TABLE,
    LEAGUE_UNION_SHOP_TABLE,
    parseLeagueP4Config,
    parseUnionDiscountRows,
    parseUnionShopRows,
    // —— P5 ——
    buildLeagueTaskBoxViews,
    buildLeagueTaskRowViews,
    hasLeagueTaskRedDot,
    ILeagueTaskBoxView,
    ILeagueTaskCmd,
    ILeagueTaskProgressRow,
    ILeagueTaskRowView,
    ILeagueTaskUnionRow,
    leagueTaskProgress,
    LeagueUnionTaskType,
    LEAGUE_TASK_PROGRESS_TABLE,
    LEAGUE_TASK_UNION_TABLE,
    parseTaskUnionProgressRows,
    parseTaskUnionRows,
    // —— P6（北伐中原）——
    buildLeagueNorthRankRowView,
    buildLeagueNorthRankRowViews,
    buildLeagueNorthRewardRowViews,
    hasLeagueNorthChallengeRedDot,
    hasLeagueNorthRedDot,
    hasLeagueNorthRewardRedDot,
    ILeagueActivityView,
    ILeagueMonsterView,
    ILeagueNorthConfig,
    ILeagueReward,
    ILeagueNorthRankRowView,
    ILeagueNorthRewardRowView,
    ILeagueUnionRankAwardRow,
    LeagueNorthRankTab,
    LeagueNorthRewardTab,
    leagueActSelfStats,
    leagueNorthBossOf,
    leagueNorthBuffText,
    leagueNorthTimesText,
    parseLeagueActivity,
    parseLeagueGuanKaRows,
    parseLeagueMonsterRows,
    parseLeagueNorthConfig,
    parseLeagueRankRows,
    parseNorthTaskUnionRows,
    northRewardRowsOf,
    parseUnionRankAwardRows,
    LEAGUE_GUANKA_REWARD_TABLE,
    LEAGUE_MONSTER_TABLE,
    LEAGUE_NORTH_RANK_SHOW_NUM,
    LEAGUE_NORTH_RANK_TYPE,
    LEAGUE_UNION_RANK_AWARD_TABLE,
} from './LeagueTable';
import {
    RequestUnionAppoint,
    RequestUnionApplyList,
    RequestUnionApproveJoin,
    RequestUnionApproveJoinOneKey,
    RequestUnionCreate,
    RequestUnionDetail,
    RequestUnionEdit,
    RequestUnionJoin,
    RequestUnionKick,
    RequestUnionLog,
    RequestUnionList,
    RequestUnionQuit,
    RequestUnionSearch,
    RequestUnionSetQuickJoin,
    // —— P4 ——
    LeagueACT_TYPE,
    LEAGUE_SHOP_TYPE_UNION,
    RequestShopBuy,
    RequestUnionActList,
    RequestUnionBargain,
    RequestUnionDonate,
    LeagueEditType,
    // —— P5 ——
    RequestRoleWatchAdvert,
    RequestTaskUnionGetProgressReward,
    RequestTaskUnionGetReward,
    // —— P6（北伐中原）——
    RequestGetRank,
    RequestUnionActDrum,
    RequestUnionActSweep,
} from './RequestLeagueMsg';
import { LEAGUE_AD_TYPE_UNION_TASK, leagueAdLimit, leagueAdRest } from './LeagueAd';
import {
    fillLeagueText,
    LEAGUE_AD_PLAYBACK_AVAILABLE,
    LEAGUE_DISCOUNT_COUNT_TEMPLATE,
    LEAGUE_DONATE_COIN_PREFIX,
    LEAGUE_DONATE_COUNT_PREFIX,
    LEAGUE_DONATE_EXP_PREFIX,
    LEAGUE_DONATE_SUCCESS,
    LEAGUE_GOODS_COUNT_SEP,
} from './LeagueTexts';

/** 联盟商店的档位号（`CmdShopType.union = 8`）。 */
export { LEAGUE_SHOP_TYPE_UNION };
/** 联盟活动类型（`LeagueACT_TYPE`）。 */
export { LeagueACT_TYPE };
/**
 * 联盟任务的子类型（`LeagueUnionTaskType`）—— 领进度宝箱时要传 `leagueTask`。
 *
 * 照 `LEAGUE_SHOP_TYPE_UNION` / `LeagueACT_TYPE` 的先例转出，让页面只 import 本文件。
 */
export { LeagueUnionTaskType };

/** 计数归一：解析不出的、负数一律当 `0`（与 `LeagueTable.toCount` 同口径，本文件只用在这里）。 */
function countOf(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * `Long` / `number`（**毫秒**）→ **秒**。
 *
 * ⚠️ **入参单位是毫秒，这里必须 `/ 1000`** —— 服务端 `CmdUnionActivity.resetTime` 写的是
 *    `CommonUtils.getTodayZeroTimestamp()`，而它的实现是
 *    `todayZero.toInstant().toEpochMilli()`（`server/.../utils/CommonUtils.java`）⇒ **ms**。
 *    老端 `LayerLeagueDiscount.updateView()` 的 `cmd.resetTime + TimeUtil.S_DayTime * 1000`
 *    也正是「ms + ms」，随后 `updateTime()` 里 `(resetTime - nowMillisecond()) / 1000` 才折回秒。
 *    ⇒ 不除 1000 的话，砍价倒计时会算出十几万小时（本函数曾漏这一步，见下）。
 *
 * ⚠️ 也不能 `Number(long)` —— protobufjs 的 `Long` 转 number 是 `NaN`
 *    （同 `HangRepository.toNumber` 的教训），而 `NaN` 会让倒计时整段变 `NaN:NaN:NaN`。
 *
 * ⚠️ 本文件**只有砍价一处**用它（`loadDiscount`）—— 若将来有「服务端给的就是秒」的字段，
 *    别复用本函数，另写一个 `toSeconds` 直通版（否则会凭空少 1000 倍）。
 */
function toSecFromMs(value: unknown): number {
    const n = toMsNumber(value);
    return Number.isFinite(n) ? Math.trunc(n / 1000) : 0;
}

/** `Long` / `number`（毫秒）→ number（毫秒）。`toSecFromMs` 的前半段，单独拆出来便于判错。 */
function toMsNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : NaN;
    }
    const box = value as { toNumber?: () => number } | null | undefined;
    if (box && typeof box.toNumber === 'function') {
        const n = box.toNumber();
        return Number.isFinite(n) ? n : NaN;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
}

/** 一次界面刷新要的全部数据。 */
export interface ILeagueSnapshot {
    /** 是否已入盟（`CmdRoleUnion.unionId > 0`）。 */
    readonly joined: boolean;
    /** 我所在的联盟 id（未入盟为 `'0'`）。 */
    readonly unionId: string;
    /** 我的职位（`LeaguePosition`；未入盟 / 查不到为 `0`）。 */
    readonly myPosition: number;
    readonly selfRoleId: string;
    /** 我所在的联盟那一行（未入盟 / 还没推回来为 `null`）。 */
    readonly myUnion: ILeagueUnionRow | null;
    /**
     * 本级经验的**上限**（老端 `VOUnion.GetMaxExp()` = 本级 `unionLevel.exp`）——
     * 进度条的 `max`。表读不到 / 等级越界时为 `0`（页面据此把 max 兜成 1，不算错）。
     */
    readonly myMaxExp: number;
    readonly members: readonly ILeagueMemberRow[];
    readonly logs: readonly ILeagueLogRow[];
    readonly applys: readonly ILeagueApplyRow[];
    /** 全服联盟列表。 */
    readonly unions: readonly ILeagueUnionRow[];
    /** `position → 权限`（`unionOfficial` 表）。 */
    readonly officialPowers: ReadonlyMap<number, ILeagueOfficialRow>;
    /** 这次快照的时间基准（毫秒）—— 「离线多久」按它算。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type LeagueRequestResult = 'ok' | 'offline' | 'failed';

// ============================================================
// P4 三个面板各自的快照
// ============================================================

/**
 * 联盟商店的一次刷新数据。
 *
 * `gameConfig` 在这一页里**用不到**（价格 / 限购全在 `unionShop` 表里），
 * 留着 `rows` 是为了让页面不必再自己读表拼视图。
 */
export interface ILeagueStoreSnapshot {
    /** 商品行视图（已按 `id` 升序）。 */
    readonly rows: readonly ILeagueStoreRowView[];
    /** 商店红点 = 任意一件「买得起且没买满」。 */
    readonly hasRedDot: boolean;
    /** 奖励图标解析用：`item` 表索引（`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    /** 奖励图标解析用：`roleProperty` 表索引（`iconIsPath = false`，落 `icons/resource`）。 */
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/** 联盟捐献的一次刷新数据。 */
export interface ILeagueDonateSnapshot {
    readonly config: ILeagueP4Config;
    /** 今日已捐次数（`CmdRoleUnion.todayDonateTimes`）。 */
    readonly todayDonateTimes: number;
    /** 今日已看广告捐献次数（`CmdRoleUnion.todayDonateAdvTimes`）。 */
    readonly todayDonateAdvTimes: number;
    /** 剩余次数（`max(0, maxCount − todayDonateTimes)`）。 */
    readonly remain: number;
    /** 「剩余捐献次数：N/M」。 */
    readonly remainText: string;
    /** 「联盟金币*300」/「联盟贡献*10」两条道具名。 */
    readonly coinNameText: string;
    readonly expNameText: string;
    /** 奖励两件的 `resId`（图标按它换帧）。 */
    readonly coinResId: number;
    readonly expResId: number;
    /** 捐献还要不要钱（够不够）。 */
    readonly enough: boolean;
    /** 次数还没用完。 */
    readonly hasTimes: boolean;
    /** 奖励图标解析用（见 `ILeagueStoreSnapshot.items` 的说明）。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/** `每日砍价` 的一次刷新数据。 */
export interface ILeagueDiscountSnapshot {
    /** 当前这一轮的商品（`unionDiscount` 第一行；表为空时 `null`）。 */
    readonly row: ILeagueUnionDiscountRow | null;
    readonly view: ILeagueDiscountView | null;
    /** 参与列表（已按「成员查得到」过滤）。 */
    readonly rows: readonly ILeagueDiscountRowView[];
    /** 「当前累计N人砍价」。 */
    readonly countText: string;
    readonly config: ILeagueP4Config;
    readonly canBargain: boolean;
    readonly canBuy: boolean;
    /**
     * 现价买得起 —— 老端 `onBuy()` 里 `CheckHaveEnoughCostAndOpenAlert([{resId: roleProperty.coin,
     * number: priceNow}])` 的等价物：`CmdRole` 里 `roleProperty.coin`（**resId 10**）的持有量
     * >= `view.priceNow`。
     *
     * ⚠️ 与 `canBuy` **不是一回事**：老端 `canBuy()` 只看**次数**（它决定 `状态` 切到哪一页），
     *    钱不够时仍然停在「购买」页、按钮不灰 —— 点下去才提示「金币不足」。
     *    这里把「够不够钱」单独留一个字段，供页面在 click 里分叉（口径同 `ILeagueStoreRowView.enough`）。
     */
    readonly enough: boolean;
    /** 奖励图标解析用（见 `ILeagueStoreSnapshot.items` 的说明）。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/**
 * 联盟任务面板的一次刷新数据 —— 老端 `LayerLeagueTask.updateView() + initList()` 的数据侧。
 *
 * ⚠️ **不发任何请求**：联盟任务就是**通用任务缓存**（老端 `VOLeagueTaskBag.GetCacheName()`
 *    返回 `"CmdTask"`）按 `taskUnion.resId` 反查 ⇒ `loadTask()` 只读 `getTlCmdTask()`。
 *    老端 `init()` 也不发包，只挂 `VOLeagueTaskBag` / `VORoleUnionBag` 的 `OnChanged`。
 *    ⇒ 本端 `onOpen` 读一次、**领奖成功后自己再读一次**（同 P4 三面板口径）。
 */
export interface ILeagueTaskSnapshot {
    /** 任务行视图（已排序：可领取 → 未完成 → 已领取，见 `buildLeagueTaskRowViews`）。 */
    readonly rows: readonly ILeagueTaskRowView[];
    /** 三个进度宝箱（按 `id` 升序）。 */
    readonly boxes: readonly ILeagueTaskBoxView[];
    /** 已领奖任务数（`lab_count` 显示的就是它）。 */
    readonly done: number;
    /**
     * **有 VO 的任务数** —— 顶部进度条的分母。
     *
     * ⚠️ 不是表行数：表里有任务但服务端还没下发 `CmdTask` 时，分母会小于行数。
     *    照抄表行数会让进度条永远不满（见 `leagueTaskProgress` 的注释）。
     */
    readonly total: number;
    /** 顶部进度条 `value`（= `min(done, total)`）。 */
    readonly progressValue: number;
    /** 顶部进度条 `max`（= `total`；`0` 时页面把 max 兜成 1，`cc.ProgressBar` 除以 0 会出 `NaN`）。 */
    readonly progressMax: number;
    /**
     * 任务行上那颗「看广告」小按钮**要不要出现** —— 老端
     * `item.setSelectedPage("显示广告", cmd.todayTaskAdvTimes > 0 ? "不显示" : "显示")`
     * ⇒ 今天已经看过广告任务了就不再显示（`true` = 显示）。
     */
    readonly showAd: boolean;
    /**
     * 广告**能力**是否可用（本端恒 `false`，见 `LEAGUE_AD_PLAYBACK_AVAILABLE`）。
     *
     * ⚠️ 与 `showAd` **是两件事**：`showAd` 是「今天的广告次数还没用」（数据），
     *    本字段是「这个包会不会真放广告」（能力）。老端不看后者（它有 `CtrlPay.PayforAdVideo`），
     *    本端没有 ⇒ 两个都为 `true` 才允许点（否则点了也拿不到东西）。
     */
    readonly adAvailable: boolean;
    /**
     * 底部「每日观看广告跳过剩余次数{0}/{1}」的**剩余**（老端 `GetAdvertRestTimes`）。
     *
     * = `ad` 表 `type = 14`（unionTask）那行的 `limit` − `CmdRole.tlCmdAdvert` 同 type 的已用 `num`
     *   （与 `HangRepository` 对 `sweep = 11` 的算法同源）。⚠️ `CmdAdvert.num` 是**已用**不是剩余。
     */
    readonly adRest: number;
    /** 同上这一行的**上限**（`ad` 表 `type = 14` 的 `limit`；缺行 / 非法退 **1**，同老端兜底）。 */
    readonly adLimit: number;
    /** 面板红点 = 有任务可领 ∪ 有宝箱可领（老端 `ModelLeague.hasTaskRD()`）。 */
    readonly hasRedDot: boolean;
    /** 奖励图标解析用（见 `ILeagueStoreSnapshot.items` 的说明）。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

// ============================================================
// 北伐中原（P6）
// ============================================================

/**
 * 北伐主面板（`ui/League/LeagueNorthExpedition`）的一次刷新数据 ——
 * 老端 `LayerLeagueNorthernExpedition.updateView()` 的数据侧。
 *
 * ⚠️ 老端 `initAsync()` 发 `RequestActList(NORTHERN_EXPEDITION)`（**只有这一条**），
 *    数值本体全在 `CmdUnionActivity`（`type = 2`）里；本端 `onOpen` 先发一次、
 *    再读缓存（同 P4/P5 的口径：Rsp 落地到缓存后由推送/重读拿到）。
 */
export interface ILeagueNorthSnapshot {
    /** 已入盟（未入盟时面板只渲染静态骨架）。 */
    readonly joined: boolean;
    /** 6 个 `gameConfig` 键（见 `ILeagueNorthConfig`）。 */
    readonly config: ILeagueNorthConfig;
    /** 当前活动（`CmdUnionActivity` 里 `type = 2` 的那一行）；没有 ⇒ `null`。 */
    readonly act: ILeagueActivityView | null;
    /** boss（`CmdUnionActivity.id` → `guankaReward.tlBoss[0]` → `monster`）；查不到 ⇒ `null`。 */
    readonly boss: ILeagueMonsterView | null;
    /** 「挑战次数:N/M」整串（`leagueNorthTimesText`）。 */
    readonly timesText: string;
    /** 我已用的挑战次数。 */
    readonly selfTimes: number;
    /**
     * 今日**已擂鼓**次数（`CmdRoleUnion.todayDrumTimes`，服务端权威）。
     *
     * ⚠️ 与 `selfTimes` **不是一个数**：`selfTimes` 是「本次北伐的挑战次数」
     *    （从 `CmdUnionActivity.tlCmdUnionActInfo` 里数出来的），擂鼓次数在
     *    `CmdRoleUnion` 上。老端 `按钮_擂鼓` 量的是**这个**（`GetRoleUnion().GetCmd().todayDrumTimes`）。
     */
    readonly todayDrumTimes: number;
    /** 「属性加成」整串（`攻击` + 数字）。 */
    readonly buffText: string;
    /** 「叠加层数」。 */
    readonly buffAddTimes: number;
    /** 「今日累计伤害」（我）。 */
    readonly selfValue: number;
    /** 「今日联盟累计伤害」（全盟）。 */
    readonly leagueValue: number;
    /** 「今日挑战奖励」的两个物品（表里怎么排就怎么排，最多取前 2 个）。 */
    readonly dailyRewards: readonly ILeagueReward[];
    /** 面板红点 = 挑战 ∪ 奖励（老端 `hasNorthernExpeditionRD()`）。 */
    readonly hasRedDot: boolean;
    /**
     * 「挑战」按钮上的红点 —— 老端 `(com.tm("按钮_挑战.组件_红点") as GObjRD)`
     * ← `hasNorthernExpeditionChallengeRD()`（= 本次北伐还有剩余挑战次数）。
     *
     * ⚠️ 与 `hasRedDot` 的区别：`hasRedDot` 是「挑战 ∪ 奖励」的并（入口红点用），
     *    这颗**只**吃挑战那一半 —— 奖励可领时不该把红点打到「挑战」按钮上。
     */
    readonly challengeRedDot: boolean;
    /** 奖励页两档红点（主面板左侧 `btn_reward` 上那颗只吃「奖励」那一半）。 */
    readonly rewardRedDot: boolean;
    /** 奖励图标解析用（见 `ILeagueStoreSnapshot.items` 的说明）。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/** 北伐排行页（`ui/League/LeagueNorthRank`）的一次刷新数据。 */
export interface ILeagueNorthRankSnapshot {
    readonly tab: LeagueNorthRankTab;
    /** 本次请求用的 `rankType`（24 联盟榜 / 22 盟内榜）。 */
    readonly rankType: number;
    /** 名次列表（榜内行）。 */
    readonly rows: readonly ILeagueNorthRankRowView[];
    /** **我的那一行**（`rankInfo.myRank`）；响应里没有 ⇒ `null`（那一栏整块藏掉）。 */
    readonly myRow: ILeagueNorthRankRowView | null;
    /** 请求本身是否成功（`false` ⇒ 页面保留上一趟数据 + 提示，而不是清空成 0 行）。 */
    readonly ok: boolean;
    /**
     * 奖励图标 / 品质框解析用（见 `ILeagueStoreSnapshot.items` 的说明）。
     *
     * ⚠️ 排行的奖励来自 `bfUnionRankAward`（只有 `resId` + `number`，**没有** `quality`）
     *    ⇒ 品质框只能靠这两张表反查。不带上它们，第 0 页两颗物品框会全部退到 1 档框。
     */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/** 北伐奖励页（`ui/League/LeagueNorthReward`）的一次刷新数据。 */
export interface ILeagueNorthRewardSnapshot {
    /** 「联盟奖励」页（`taskUnion.subType = 2`，已排序）。 */
    readonly leagueRows: readonly ILeagueNorthRewardRowView[];
    /** 「个人奖励」页（`subType = 3`，已排序）。 */
    readonly roleRows: readonly ILeagueNorthRewardRowView[];
    /** 两页签各自的红点（可领 ∪）。 */
    readonly leagueRedDot: boolean;
    readonly roleRedDot: boolean;
    /** 面板整体红点（= 两页签的并）。 */
    readonly hasRedDot: boolean;
    /** 奖励图标解析用。 */
    readonly items: ReadonlyMap<number, ILeagueGoodsInfo>;
    readonly resources: ReadonlyMap<number, ILeagueGoodsInfo>;
}

/**
 * 联盟**入口行**的红点状态（老端 `TabLeagueMain.updateRD()` + `ModelLeague.has*RD()`）。
 *
 * ⚠️ 刻意**不复用** `loadDiscount()`：后者除了两个数字之外还会走 `loadIconTables()`
 *    预载奖励图帧（`resources.load` + 8 张品质框）。联盟主页每次 `onLoad` 都要刷入口红点，
 *    把那笔开销挂上来是白花。本方法只读 `gameConfig`（一张小表）+ `CmdRoleUnion`（一行）
 *    + `taskUnion` / `taskUnionProgress`（两张小表）+ `CmdTask`（通用任务缓存）。
 *
 * 只有「每日砍价」与「联盟任务」两条是**真判据**；其余见
 * `LeagueTable.hasLeagueDiscountRedDot` / `hasLeagueTaskRedDot` 的注释。
 */
export interface ILeagueEntryRedDots {
    /**
     * 「每日砍价」入口 —— 老端 `hasDiscountRD()` = `todayBargainTimes < unionBargainBuyCount`。
     *
     * ⚠️ 额外加了「必须已入盟」这道闸：老端 `TabLeagueMain.updateRD()` 自己没判，
     *    但它是由 `RDLeague` 驱动的，而 `RDLeague.OnComputeResult()` 第一句就是
     *    `if (!IsJoinedLeague()) return 0`。未入盟时 `todayBargainTimes` 恒 0 ⇒
     *    单看表达式会**恒亮**（0 < 配置的非零上限），那是错的。
     */
    readonly discount: boolean;

    /**
     * 「联盟任务」入口 —— 老端 `hasTaskRD()` = 「有任务可领」∪「有宝箱可领」。
     *
     * 同样的「必须已入盟」闸：`ModelLeague.hasTaskRD()` 里没有，但 `RDLeague` 有
     * （见 `discount` 的说明）。另外未入盟时 `CmdTask` 缓存里本来也不会有联盟任务，
     * 加这道闸主要是防「退盟后残留的 VO」。
     */
    readonly task: boolean;

    /**
     * 「联合战线（北伐中原）」入口 —— 老端 `ModelLeague.hasNorthernExpeditionRD()`
     * = 挑战红点 ∪ 奖励红点（两个页签）。
     *
     * 同样加「必须已入盟」闸（`RDLeague.OnComputeResult()` 第一句就是 `IsJoinedLeague()`）；
     * 另外 `hasNorthernExpeditionChallengeRD()` 自己第一句是 `if (!act) return false`
     * ⇒ 活动没开时**不亮**（见 `LeagueTable.hasLeagueNorthChallengeRedDot`）。
     */
    readonly north: boolean;
}

export interface ILeagueRepository {
    /** 读缓存 + 读表，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<ILeagueSnapshot>;
    /** 入口行红点（只读 `gameConfig` + `CmdRoleUnion`，**不加载图标**）。 */
    loadLeagueEntryRedDots(): Promise<ILeagueEntryRedDots>;
    /** 请求详情（成员列表随推送回来）。 */
    requestDetail(caller?: unknown): Promise<LeagueRequestResult>;
    /** 请求动态。 */
    requestLog(caller?: unknown): Promise<LeagueRequestResult>;
    /** 请求全服联盟列表。 */
    requestList(caller?: unknown): Promise<LeagueRequestResult>;
    /** 请求入盟申请列表。 */
    requestApplyList(caller?: unknown): Promise<LeagueRequestResult>;
    /** 按联盟 id 搜索（成功时把结果放进 `searchCache`）。 */
    search(unionId: string, caller?: unknown): Promise<LeagueRequestResult>;

    /** 取搜索缓存（键 = **输入框原串**，见类头）。 */
    cachedSearch(key: string): ILeagueUnionRow | null;
    /** 清搜索缓存（切走全服页签 / 手动刷新列表时调）。 */
    clearSearchCache(): void;

    /** 踢人。 */
    kick(memberId: string, caller?: unknown): Promise<LeagueRequestResult>;
    /** 任命盟主。 */
    appointLeader(memberId: string, caller?: unknown): Promise<LeagueRequestResult>;
    /** 任命副盟主。 */
    appointAdmin(memberId: string, caller?: unknown): Promise<LeagueRequestResult>;
    /** 卸任副盟主。 */
    dismissAdmin(memberId: string, caller?: unknown): Promise<LeagueRequestResult>;
    /** 退出联盟。 */
    quit(caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 申请加入联盟（联盟信息弹窗的「加入」／加入联盟页的「快速加入」）。
     *
     * ⚠️ 入参是**数组**：协议是 `CmdUnionJoinReqMsg { unionIds: Long[] }`，
     *    老端 `LayerLeagueInfoUI.onClickJoin()` 发的是 `RequestLeagueJoin([cmd.id])`
     *    （包一层单元素数组，不是裸 id）；「快速加入」则是 `RequestLeagueJoin(arr)`（最多 5 条）。
     *    这里保留数组形状，两条调用链共用同一个方法。
     */
    join(unionIds: readonly string[], caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 创建联盟（**未入盟**态）。
     *
     * 协议是 `CmdUnionCreateReqMsg { icon: number, name: string, quick: boolean }`：
     * `icon` = 旗帜色（`组件_联盟_旗帜` 的 `颜色` 页序）、`name` = 联盟名、
     * `quick` = 「允许快速加入」勾选框。老端 `ModelLeague.RequestLeagueCreat(icon, name, quick)` 同名同序。
     */
    requestCreat(icon: number, name: string, quick: boolean, caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 创建消耗的展示模型（**读表 + 读缓存，不发包**）：
     * `roleProperty` 取图标 / 字段名 / 不足提示，`gameConfig` 取数量，`CmdRole` 取持有量。
     */
    createCost(): Promise<ILeagueCostView>;

    /** 批准 / 拒绝单条申请。 */
    approveApply(applyId: string, agree: boolean, caller?: unknown): Promise<LeagueRequestResult>;
    /** 一键批准 / 一键拒绝。 */
    approveApplyOneKey(agree: boolean, caller?: unknown): Promise<LeagueRequestResult>;

    /** 设置「快速加入」。 */
    setQuickJoin(quick: boolean, caller?: unknown): Promise<LeagueRequestResult>;
    /** 编辑信息（`type` 取 `LeagueEditType`）。 */
    edit(type: number, content: string, caller?: unknown): Promise<LeagueRequestResult>;

    // ============================================================
    // P4：商店 / 捐献 / 砍价
    // ============================================================

    /** 商店快照（读 `unionShop` + `CmdShop(8)` + `roleProperty` + `CmdRole`，**不发包**）。 */
    loadStore(): Promise<ILeagueStoreSnapshot>;

    /**
     * 买一件（`CmdShopBuyReqMsg { id, cmdShopType: 8, buyTimes: 1 }`）。
     *
     * ⚠️ 老端 `requestBuy` 里那段 `if (id == 1) { … gemBox … }` 是**宝石商店**专用的价格改写，
     *    只在 `StoreType.gemBox` 下才走。**联盟商店不走那一支** ⇒ 本端不移植那段。
     *
     * ★ **成功（`'ok'`）时本方法自己会弹「获得奖励」**（消费响应里的 `tlCmdGoods`
     *   ⇒ `FW.ShowReward`）。调用方**不要**再弹一次。
     */
    buyStoreGoods(id: number, caller?: unknown): Promise<LeagueRequestResult>;

    /** 捐献快照（读 `gameConfig` 6 键 + `CmdRoleUnion` + `roleProperty`，**不发包**）。 */
    loadDonate(): Promise<ILeagueDonateSnapshot>;

    /**
     * 捐献（`adv = true` 走广告，需外部先确认真放完了广告）。
     *
     * ★ **成功（`rsp.ret === true`）时本方法自己会** `FW.showTip('捐献成功')` +
     *   `FW.ShowReward(...)` 弹「获得物品」窗。调用方**不要**再弹一次。
     *
     * ⚠️ `CmdUnionDonateRspMsg` **只有 `ret`、没有奖励字段** —— 奖励是**本地**按
     *    `gameConfig` 的 `unionDonateGainCoin` / `unionDonateGainExp` 算出来的
     *    （老端 `ModelLeague.showCommonDonateReward`，它的 `adv` 形参**根本没用到**）。
     *    所以两个数在 `loadDonate()` 时缓存（`donateGain`），`requestDonate` 直接取用。
     */
    requestDonate(adv: boolean, caller?: unknown): Promise<LeagueRequestResult>;

    /** 砍价快照（读 `unionDiscount` + `CmdUnionActivity` + `CmdUnionMember` + `CmdRoleUnion`，**不发包**）。 */
    loadDiscount(): Promise<ILeagueDiscountSnapshot>;

    /**
     * 砍价 / 购买（`buy = true` 即购买）。
     *
     * ★ **`buy = true` 成功时会自己弹「获得奖励」**（消费响应的 `tlCmdGoods` ⇒ `FW.ShowReward`）；
     *   砍价（`buy = false`）无奖励、不弹。调用方不要自己再弹一次。
     */
    requestBargain(buy: boolean, caller?: unknown): Promise<LeagueRequestResult>;

    /** 拉活动列表（`type` 取 `LeagueACT_TYPE`；数据由 `CmdUnionActivity` 推送落地）。 */
    requestActList(type: number, caller?: unknown): Promise<LeagueRequestResult>;

    // ============================================================
    // P5：联盟任务
    // ============================================================

    /**
     * 任务快照（读 `taskUnion` + `taskUnionProgress` + `CmdTask` + `CmdRoleUnion`，**不发包**）。
     *
     * ⚠️ 联盟任务**没有独立请求**：老端 `VOLeagueTaskBag.GetCacheName()` 返回 `"CmdTask"`
     *    ⇒ 就是通用任务缓存按 `taskUnion.resId` 反查。所有数据都在缓存里、进面板即可渲染。
     */
    loadTask(): Promise<ILeagueTaskSnapshot>;

    /**
     * 领某一个任务的奖励（`CmdTaskUnionGetRewardReqMsg { resId }`）。
     *
     * ⚠️ 协议里 `CmdCommonState.FINISH` 的语义是「**可领奖**」不是「已完成」——
     *    所以「能领」的判据是 `rewardState === 1`（见 `LeagueTable.leagueTaskStateOf`），
     *    不是 `>= 1`。领完服务端把 `rewardState` 推到 `2`（`REWARDED`）。
     *
     * ★ **成功时会自己弹「获得奖励」**（`rsp.ret` + `tlCmdGoods` ⇒ `FW.ShowReward`）。调用方别再弹。
     */
    requestTaskReward(resId: number, caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 任务「看广告」跳过 —— `CmdRoleWatchAdvertReqMsg { type: 14, id: resId }`
     * （老端 `btn_adv.onClick` 的 `RequestWatchAdvert(unionTask, false, resId)`）。
     *
     * ⚠️ **调用方必须先把广告真放完**（`LeagueAd.playLeagueAd()` 返回 `true` 才发）：
     *    这个请求本身就是「记一次广告」的凭据，裸发等于白送。
     */
    requestTaskAdvert(resId: number, caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 领进度宝箱奖励（`CmdTaskUnionGetProgressRewardReqMsg { subType }`）。
     *
     * ⚠️ 请求体只有 `subType`、**没有宝箱 id** —— 服务端按
     *    `CmdRoleUnion.todayTaskGetProgressCount` 自己推进到下一个宝箱。
     *    所以调用点不能「按点中的那个箱子」传参，只能传 `LeagueUnionTaskType.leagueTask`。
     *
     * ★ **成功时会自己弹「获得奖励」**（`rsp.ret` + `tlCmdGoods` ⇒ `FW.ShowReward`）。调用方别再弹。
     */
    requestTaskProgressReward(subType: number, caller?: unknown): Promise<LeagueRequestResult>;

    // ============================================================
    // P6：北伐中原（主面板 + 排行 / 奖励两个子页）
    // ============================================================

    /**
     * 北伐主面板快照（读 `CmdUnionActivity(2)` + `taskUnion` + `CmdTask` + `gameConfig` +
     * `guankaReward` + `monster`，**不发包**）。
     *
     * ⚠️ 老端进面板时**发一条** `RequestActList(NORTHERN_EXPEDITION)`（`initAsync()` 里）；
     *    本端把「发包」与「读数」分开：页面 `onOpen` 里先 `requestActList` 再 `loadNorthExpedition()`
     *    （同 P4 三面板的做法 —— Rsp 落地到 `CmdUnionActivity` 缓存后才读得到）。
     */
    loadNorthExpedition(): Promise<ILeagueNorthSnapshot>;

    /** 北伐奖励页快照（读 `taskUnion` 的 `subType` 2/3 + `CmdTask`，**不发包**）。 */
    loadNorthReward(): Promise<ILeagueNorthRewardSnapshot>;

    /**
     * 北伐排行页 —— **唯一一条要等响应的联盟请求**（通用排行协议 `CmdGetRankReqMsg`）。
     *
     * 老端 `requestRankInfo()`：`{ rankType: [24, 22][页签], showNum: 50, unionId: … }`。
     * `ok = false` 时调用点保留上一趟数据（不清空）。
     */
    loadNorthRank(tab: LeagueNorthRankTab, caller?: unknown): Promise<ILeagueNorthRankSnapshot>;

    /** 擂鼓（`CmdUnionActDrumReqMsg { type: 2 }`）。 */
    requestDrum(caller?: unknown): Promise<LeagueRequestResult>;

    /**
     * 扫荡（`CmdUnionActSweepReqMsg { type: 2 }`）。
     *
     * ★ **成功时会自己弹「获得奖励」**（`rsp.ret` + `tlCmdGoods` ⇒ `FW.ShowReward`）。调用方别再弹。
     */
    requestSweep(caller?: unknown): Promise<LeagueRequestResult>;
}

/** 请求超时（与好友 / 礼包 / 首充同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读缓存里一张表；拿不到返回空数组（**不抛**）。 */
function readCacheRows(
    table: 'CmdUnion' | 'CmdUnionMember' | 'CmdUnionApplys' | 'CmdUnionLogs' | 'CmdRoleUnion',
): unknown[] {
    try {
        const mgr = CacheMgr.instance as any;
        if (!mgr) return [];
        if (table === 'CmdUnion') return mgr.getTlCmdUnion() ?? [];
        if (table === 'CmdUnionMember') return mgr.getTlCmdUnionMember() ?? [];
        if (table === 'CmdUnionApplys') return mgr.getTlCmdUnionApplys() ?? [];
        if (table === 'CmdUnionLogs') return mgr.getTlCmdUnionLogs() ?? [];
        return mgr.getTlCmdRoleUnion() ?? [];
    } catch (error) {
        console.warn(`[League] 读 ${table} 缓存失败`, error);
        return [];
    }
}

/** 读 `CmdRole` 的第一行（拿自己的 id）。 */
function readSelfRoleId(): string {
    const row = readSelfRoleRow();
    return toIdString((row as { id?: unknown } | null)?.id);
}

/**
 * 读 `CmdRole` 的第一行本身（创建消耗要按 `roleProperty.key` 从这一行取持有量）。
 *
 * ⚠️ 选行口径与原 `readSelfRoleId` **完全一致**：优先「id 非空且非 0」的那一行，
 *    全表都没有合法 id 时才退回第一行 —— 免得两条链路读到不同的行（缓存被塞了脏行时尤其明显）。
 */
function readSelfRoleRow(): CmdRole | null {
    try {
        const rows = (CacheMgr.instance as any)?.getTlCmdRole?.() ?? [];
        let first: CmdRole | null = null;
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            if (!first) first = row as CmdRole;
            const id = toIdString((row as { id?: unknown } | null)?.id);
            if (id && id !== '0') return row as CmdRole;
        }
        return first;
    } catch (error) {
        console.warn('[League] 读 CmdRole 缓存失败', error);
    }
    return null;
}

/** 生产环境 Repository。 */
export class RuntimeLeagueRepository implements ILeagueRepository {
    /** 搜索结果（**内存**，键 = 输入框原串；老端 `ModelLeague.searchCacheDict`）。 */
    private readonly searchCache = new Map<string, ILeagueUnionRow>();

    /**
     * 一次捐献到手的两个数（`gameConfig.unionDonateGainCoin` / `unionDonateGainExp`）。
     *
     * ⚠️ `CmdUnionDonateRspMsg` 里**没有奖励**（只有 `ret`）⇒ 弹窗内容只能本地算，
     *    所以在 `loadDonate()` 时缓存一份（等价于老端 `showCommonDonateReward` 里
     *    现读 `RefMgrgameConfig` —— 那边表是全局常驻，这边取值要 await，只能先存）。
     *    捐献界面一定会先 `loadDonate()` 再发包（页面 `onOpen` → `reload()`），
     *    所以 `requestDonate` 时它必然已就位；万一没有，就只弹提示、不弹空奖励窗。
     */
    private donateGain: { readonly coin: number; readonly exp: number } | null = null;

    async load(nowMs: number = Date.now()): Promise<ILeagueSnapshot> {
        const officialRows = parseLeagueOfficialRows(await readRows(LEAGUE_UNION_OFFICIAL_TABLE));
        const officialPowers = officialRows.length > 0 ? officialPowersMap(officialRows) : new Map<number, ILeagueOfficialRow>();

        const selfRoleId = readSelfRoleId();

        // 我的联盟态：`CmdRoleUnion` 里 `roleId == 我` 的那一行。
        const roleUnionRows = readCacheRows('CmdRoleUnion');
        let unionId = '0';
        for (const row of roleUnionRows) {
            const roleId = toIdString((row as { roleId?: unknown } | null)?.roleId);
            if (selfRoleId && roleId !== selfRoleId) continue;
            const id = toIdString((row as { unionId?: unknown } | null)?.unionId);
            if (id) {
                unionId = id;
                break;
            }
        }
        const joined = !!unionId && unionId !== '0';

        const unions = normalizeLeagueUnions(readCacheRows('CmdUnion'));
        const members = normalizeLeagueMembers(readCacheRows('CmdUnionMember'));
        const logs = normalizeLeagueLogs(readCacheRows('CmdUnionLogs'));
        const applys = normalizeLeagueApplies(readCacheRows('CmdUnionApplys'));

        const myMember = findSelfMember(members, selfRoleId);
        const myUnion = findMyUnion(unions, unionId);
        // 本级经验上限：`unionLevel` 表按 level 查（老端 `VOUnion.GetMaxExp`）。
        const myMaxExp = myUnion ? leagueMaxExp(parseUnionLevelRows(await readRows(LEAGUE_UNION_LEVEL_TABLE)), myUnion.level) : 0;

        return {
            joined,
            unionId,
            myPosition: myMember ? myMember.position : 0,
            selfRoleId,
            myUnion,
            myMaxExp,
            members,
            logs,
            applys,
            unions,
            officialPowers,
            now: nowMs,
        };
    }

    // ============================================================
    // 查询（全是空请求体的全量拉）
    // ============================================================

    async requestDetail(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionDetail({}, caller as any));
    }

    async requestLog(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionLog({}, caller as any));
    }

    async requestList(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionList({}, caller as any));
    }

    async requestApplyList(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionApplyList({}, caller as any));
    }

    /**
     * 搜索：`CmdUnionSearchReqMsg` 只有 `id` 一个字段，**按 id 搜**。
     *
     * ⚠️ 缓存键用**未清洗的原串**（老端口径）—— 界面上的输入框会做「非正整数就清空」
     * （`onInputTextChange`），所以到这里的串已经被上游保证是数字串了；但缓存键仍按原串存，
     * 与 `pickUnionListForSearch` 的查法一致。
     */
    async search(unionId: string, caller?: unknown): Promise<LeagueRequestResult> {
        const id = toIdString(unionId);
        if (!id || id === '0') return 'failed';
        return this.send(() => new RequestUnionSearch({ id } as any, caller as any, (rsp: any) => {
            const row = normalizeLeagueUnion(rsp?.union);
            if (row) this.searchCache.set(unionId, row);
        }));
    }

    cachedSearch(key: string): ILeagueUnionRow | null {
        return this.searchCache.get(key) ?? null;
    }

    clearSearchCache(): void {
        this.searchCache.clear();
    }

    // ============================================================
    // 成员管理
    // ============================================================

    async kick(memberId: string, caller?: unknown): Promise<LeagueRequestResult> {
        return this.memberRequest((id) => new RequestUnionKick({ memberId: id } as any, caller as any), memberId);
    }

    /** 任命盟主（`officialId = LeaguePosition.LEADER`、`type = true`）。 */
    async appointLeader(memberId: string, caller?: unknown): Promise<LeagueRequestResult> {
        return this.appoint(memberId, LeaguePosition.LEADER, true, caller);
    }

    /** 任命副盟主。 */
    async appointAdmin(memberId: string, caller?: unknown): Promise<LeagueRequestResult> {
        return this.appoint(memberId, LeaguePosition.ADMIN, true, caller);
    }

    /** 卸任副盟主（`type = false`）。 */
    async dismissAdmin(memberId: string, caller?: unknown): Promise<LeagueRequestResult> {
        return this.appoint(memberId, LeaguePosition.ADMIN, false, caller);
    }

    async quit(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionQuit({}, caller as any));
    }

    /**
     * 申请加入联盟。
     *
     * ⚠️ 每个 id 都过一遍 `toIdString`（口径同 `memberRequest`）—— 裸数字 / `Long` 都收敛成
     *    十进制字符串；**整条请求体一个合法 id 都没有时直接早退**（不发包，
     *    与 `memberRequest` 的空 id 守卫同性质：宁可不发，也别发一条 `unionIds: []` 让服务端记一笔）。
     */
    async join(unionIds: readonly string[], caller?: unknown): Promise<LeagueRequestResult> {
        const ids: string[] = [];
        for (const raw of unionIds ?? []) {
            const id = toIdString(raw);
            if (id && id !== '0') ids.push(id);
        }
        if (!ids.length) return 'failed';
        return this.send(() => new RequestUnionJoin({ unionIds: ids } as any, caller as any));
    }

    // ============================================================
    // 创建联盟（未入盟态）
    // ============================================================

    /**
     * 创建联盟。
     *
     * ⚠️ 名称为空 / 是 `***`（违禁词占位）时**直接早退**（口径同老端 `LayerLeagueCreat.onClickCreat`
     *    的守卫：`if (!labName || labName == "***") return`）—— 页面层会先拦一道并给提示，
     *    这里再兜一道，免得被别的调用方绕过。
     * ⚠️ `icon` 过一遍 `leagueCreateBannerIndexOf` 夹到 `[0, 7]`：FGUI `颜色` controller 只有 8 页。
     */
    async requestCreat(icon: number, name: string, quick: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        const leagueName = typeof name === 'string' ? name : '';
        if (!isLeagueNameUsable(leagueName)) return 'failed';
        return this.send(() => new RequestUnionCreate({
            icon: leagueCreateBannerIndexOf(icon),
            name: leagueName,
            quick: quick === true,
        } as any, caller as any));
    }

    /**
     * 创建消耗：`roleProperty.coin`（10 = 金币）× `gameConfig.unionCreateCost`（现网 100）。
     *
     * 三张表都是**读**（`roleProperty` / `gameConfig` 走 `RefUtil`，`CmdRole` 走 `CacheMgr`）⇒
     * 不发包、不缓存（消耗量会随运营改配置变）。
     */
    async createCost(): Promise<ILeagueCostView> {
        const properties = parseLeaguePropertyRows(await readRows(LEAGUE_PROPERTY_TABLE));
        const property = findLeagueProperty(properties, LEAGUE_CREATE_COST_RES_ID);
        const need = leagueCreateCost(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const has = rolePropertyAmount(readSelfRoleRow(), property?.key ?? '');
        return buildLeagueCostView(property, has, need);
    }

    // ============================================================
    // 申请审批
    // ============================================================

    async approveApply(applyId: string, agree: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        return this.memberRequest(
            (id) => new RequestUnionApproveJoin({ reqId: id, agree } as any, caller as any),
            applyId,
        );
    }

    async approveApplyOneKey(agree: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionApproveJoinOneKey({ agree } as any, caller as any));
    }

    // ============================================================
    // 联盟设置
    // ============================================================

    async setQuickJoin(quick: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionSetQuickJoin({ quick } as any, caller as any));
    }

    async edit(type: number, content: string, caller?: unknown): Promise<LeagueRequestResult> {
        if (!Number.isFinite(type)) return 'failed';
        return this.send(() => new RequestUnionEdit({ type, content } as any, caller as any));
    }

    // ============================================================
    // P4：商店 / 捐献 / 砍价
    // ============================================================

    /**
     * 商店快照 —— 老端 `LayerLeagueStore.updateView() + initList()` 的数据侧。
     *
     * 四张来源：`unionShop`（商品表）/ `CmdShop(8)`（已购次数）/ `roleProperty`（货币图标与字段名）/
     * `CmdRole`（持有量）。**一张都不发请求** ⇒ 进面板即可渲染，购买成功后再靠推送刷新。
     */
    async loadStore(): Promise<ILeagueStoreSnapshot> {
        const rows = parseUnionShopRows(await readRows(LEAGUE_UNION_SHOP_TABLE));
        const goods = this.readShopGoodsRows();
        const properties = parseLeaguePropertyRows(await readRows(LEAGUE_PROPERTY_TABLE));
        const self = readSelfRoleRow();
        const propertyOf = new Map<number, { key: string }>();
        for (const property of properties) propertyOf.set(property.resId, property);

        const views = buildLeagueStoreRowViews(rows, {
            buyTimesOf: (id) => leagueShopBuyTimesOf(goods, id),
            ownedOf: (resId) => {
                const property = propertyOf.get(resId);
                if (!property) return 0;
                return rolePropertyAmount(self, property.key).value;
            },
        });
        const { items, resources } = await this.loadIconTables();
        return { rows: views, hasRedDot: hasLeagueStoreRedDot(views), items, resources };
    }

    /**
     * 购买 —— `CmdShopBuyReqMsg { id, cmdShopType: 8, buyTimes: 1 }`
     * （老端 `ModelStore.requestBuy(id, StoreType.League, false, **true**)`）。
     *
     * ★ 老端第 4 个参数就是 `showReward`，响应回调里
     *   `if (showReward && rsp.tlCmdGoods?.length > 0) → CtrlAlert.openLayerShowReward2(config)`
     *   （`switch (storeType)` 里联盟走 `default` ⇒ 不需要额外按钮配置）。
     *   本工程等价物 = `FW.ShowReward(tlCmdGoods)` → `ShowRewardPage`（「获得奖励」弹窗）。
     *   ⚠️ 曾经这里把响应整个丢掉、只回三态 ⇒ **买成功却不弹「获得奖励」**（用户报的缺陷）。
     */
    async buyStoreGoods(id: number, caller?: unknown): Promise<LeagueRequestResult> {
        const goodsId = Number.isFinite(id) ? Math.trunc(id) : 0;
        if (goodsId <= 0) return 'failed';
        return this.sendWithResponse<CmdShopBuyRspMsg>(
            (onRsp) => new RequestShopBuy({
                id: goodsId,
                cmdShopType: LEAGUE_SHOP_TYPE_UNION,
                buyTimes: 1,
            } as any, caller as any, onRsp),
            // ⚠️ `CmdShopBuyRspMsg` **没有 `ret`**（见 Cmd.d.ts）⇒ 只能按奖励列表是否为空判
            (rsp) => { if (rsp?.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods); },
        );
    }

    /**
     * 捐献快照 —— 老端 `LayerLeagueDonate.updateView()` 的数据侧。
     *
     * `gameConfig` 的 6 个键 + `CmdRoleUnion` 的两个计数 + `roleProperty`（两件奖励的图标）。
     *
     * ⚠️ 老端的「免费：{剩余}/{上限}」不在这里 —— 那两个数来自**广告子系统**
     *    （`RefMgrad` + `VORole.GetAdvertTimes`），Demo3.8 没迁（见 `LEAGUE_AD_PLAYBACK_AVAILABLE`）。
     */
    async loadDonate(): Promise<ILeagueDonateSnapshot> {
        const config = parseLeagueP4Config(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const roleUnion = this.readMyRoleUnionRow();
        const todayDonateTimes = countOf(roleUnion?.todayDonateTimes);
        const todayDonateAdvTimes = countOf(roleUnion?.todayDonateAdvTimes);

        // ⚠️ 捐的钱是 `roleProperty.coin`（= **10** 金币）—— 老端 `onClickDonate` 里是
        //    `CheckHaveEnoughCostAndOpenAlert([{resId: roleProperty.coin, number: donateConst}])`，
        //    按钮上的 `icon` 也是这个（`LayerLeagueDonate.updateView` 的 `GetGoodsIconKeyByRefId(roleProperty.coin)`）。
        //    **不是** `unionCoin`(11)：11 是「捐出去之后到手的奖励」那一件（见下面的 `coinResId`）。
        const owned = await this.ownedResourceOf(LEAGUE_COIN_RES_ID);

        const maxCount = config.donateMaxCount;
        const remain = Math.max(0, maxCount - todayDonateTimes);
        const { items, resources } = await this.loadIconTables();
        // 捐献到手的两个数先存一份：`CmdUnionDonateRspMsg` 只有 `ret`，发包时算不出来（见 `donateGain`）。
        this.donateGain = { coin: config.donateGainCoin, exp: config.donateGainExp };
        return {
            config,
            todayDonateTimes,
            todayDonateAdvTimes,
            remain,
            remainText: `${LEAGUE_DONATE_COUNT_PREFIX}${remain}/${maxCount}`,
            // ⚠️ 道具名走**语言表**（「联盟金币」/「联盟贡献」），不是 `roleProperty.name`
            //    （`resId=11` 那张表的 name 是「联盟银币」）—— 老端也是 `FW.G_W(...)`。
            coinNameText: `${LEAGUE_DONATE_COIN_PREFIX}${LEAGUE_GOODS_COUNT_SEP}${config.donateGainCoin}`,
            expNameText: `${LEAGUE_DONATE_EXP_PREFIX}${LEAGUE_GOODS_COUNT_SEP}${config.donateGainExp}`,
            coinResId: LEAGUE_UNION_COIN_RES_ID,
            expResId: LEAGUE_UNION_CONTRI_RES_ID,
            enough: owned >= config.donateCost,
            hasTimes: remain > 0,
            items,
            resources,
        };
    }

    async requestDonate(adv: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        return this.sendWithResponse<CmdUnionDonateRspMsg>(
            (onRsp) => new RequestUnionDonate({ adv: adv === true } as any, caller as any, onRsp),
            // 老端 `ModelLeague.RequestLeagueDonate`：
            //   `if (rsp.ret) { FW.showTip(FW.G_W("DONATE_SUCCESS")); this.showCommonDonateReward(adv); }`
            // ⚠️ 少了这一段 = 「捐献成功既没提示、也不弹获得物品的窗」（用户报的缺陷）。
            (rsp) => {
                if (!rsp?.ret) return;
                FW.showTip(LEAGUE_DONATE_SUCCESS);
                const gain = this.donateGain;
                if (!gain) {
                    // 理论上到不了（页面 `onOpen` 必先 `loadDonate()`）；宁可只提示，也不弹 0 的假奖励。
                    console.warn('[League] 捐献奖励数未就绪（loadDonate 还没跑过？），跳过「获得物品」弹窗');
                    return;
                }
                // ⚠️ 老端 `showCommonDonateReward` **不区分 adv** —— 它那个 `adv` 形参压根没用，
                //    两条路都是 `[{ unionCoin, gainCoin }, { unionContri, gainExp }]`。
                //
                // `CmdGoods` 在 proto 里是 `{ resId: Long; number: string }`（uint64 ⇒ 可能是 Long），
                // 而弹窗侧 `parseCmdGoodsList` 走 `toCount` 容错收敛（number / string 都认）⇒
                // 这里按 proto 的形状给（数量用字符串），只是要过一次 `Long` 的类型断言。
                FW.ShowReward([
                    { resId: LEAGUE_UNION_COIN_RES_ID, number: String(gain.coin) },
                    { resId: LEAGUE_UNION_CONTRI_RES_ID, number: String(gain.exp) },
                ] as unknown as CmdGoods[]);
            },
        );
    }

    /**
     * 砍价快照 —— 老端 `LayerLeagueDiscount.updateView()` 的数据侧。
     *
     * ⚠️ 老端把 `RefMgrunionDiscount` 的**全部行**都 preload，但 `updateView` 只取
     *    `VOUnionActivityBag.GetTypeArray(DISCOUNT)[0]`（**当前进行中的那一轮**）⇒
     *    商品取 `unionDiscount` 表的**第一行**（按 id 升序），与老端口径一致。
     */
    async loadDiscount(): Promise<ILeagueDiscountSnapshot> {
        const rows = parseUnionDiscountRows(await readRows(LEAGUE_UNION_DISCOUNT_TABLE));
        const row = rows[0] ?? null;
        const config = parseLeagueP4Config(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const roleUnion = this.readMyRoleUnionRow();
        const canBargain = canLeagueBargain(countOf(roleUnion?.todayBargainTimes), config.bargainBuyCount);
        const canBuy = canLeagueBuyBargain(countOf(roleUnion?.todayBuyBargainTimes), config.bargainBuyCount);

        const act = this.readUnionActivity(LeagueACT_TYPE.DISCOUNT);
        const actInfo = act?.tlCmdUnionActInfo ?? [];
        const nameOf = this.memberNameLookup();
        const listRows = buildLeagueDiscountRows(actInfo, nameOf);
        const view = buildLeagueDiscountView(row, actInfo, act ? toSecFromMs(act.resetTime) : 0, canBargain, canBuy);
        const { items, resources } = await this.loadIconTables();
        // 现价买不买得起（见 `ILeagueDiscountSnapshot.enough`）—— 表空时 `view` 为 `null` ⇒ 恒 `false`
        const owned = await this.ownedResourceOf(LEAGUE_COIN_RES_ID);
        const enough = view ? owned >= view.priceNow : false;

        return {
            row,
            view,
            rows: listRows,
            countText: fillLeagueText(LEAGUE_DISCOUNT_COUNT_TEMPLATE, listRows.length),
            config,
            canBargain,
            canBuy,
            enough,
            items,
            resources,
        };
    }

    /**
     * 入口行红点（见 `ILeagueEntryRedDots`）。**不发包、不加载图**。
     *
     * ⚠️ `task` 那一支要把 `taskUnion` / `taskUnionProgress` 两张表 + `CmdTask` 缓存都读一遍
     *    （`hasLeagueTaskRedDot` 要「有任务可领 ∪ 有宝箱可领」两个判据）。两张表都很小、
     *    `getRefAllAsync` 有缓存 ⇒ 这点开销比 `loadDiscount()` 的图标预载小得多。
     */
    async loadLeagueEntryRedDots(): Promise<ILeagueEntryRedDots> {
        const config = parseLeagueP4Config(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const unionId = this.myUnionId();
        const joined = !!unionId && unionId !== '0';
        const roleUnion = this.readMyRoleUnionRow();

        const taskRows = parseTaskUnionRows(await readRows(LEAGUE_TASK_UNION_TABLE));
        const progressRows = parseTaskUnionProgressRows(await readRows(LEAGUE_TASK_PROGRESS_TABLE));
        const cmds = this.readTaskCmds();

        // ⚠️ 北伐用的是 `taskUnion` 的**另两档**（`subType` 2/3）⇒ 单独解析一次。
        //    两张表同一份文件、`getRefAllAsync` 有缓存 ⇒ 多读一次的代价只是多遍历 33 行。
        const northRows = parseNorthTaskUnionRows(await readRows(LEAGUE_TASK_UNION_TABLE));
        const northConfig = parseLeagueNorthConfig(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const northAct = parseLeagueActivity(this.readUnionActivity(LeagueACT_TYPE.NORTHERN_EXPEDITION));

        return {
            discount: joined
                && hasLeagueDiscountRedDot(countOf(roleUnion?.todayBargainTimes), config.bargainBuyCount),
            task: joined
                && hasLeagueTaskRedDot(
                    taskRows,
                    cmds,
                    progressRows,
                    countOf(roleUnion?.todayTaskGetProgressCount),
                ),
            north: joined
                && hasLeagueNorthRedDot(
                    northAct,
                    readSelfRoleId(),
                    northConfig.enterMaxCount,
                    northRows,
                    cmds,
                ),
        };
    }

    /**
     * 砍价 / 购买（`buy = true` 即购买）。
     *
     * ★ `buy = true`（真买）时服务端把成交物放在响应的 `tlCmdGoods` 里 ——
     *   老端 `ModelLeague.RequestUnionBargain`：`if (rsp.ret && rsp.tlCmdGoods) FW.ShowReward(...)`。
     *   砍价（`buy = false`）没有奖励 ⇒ 回调自然空跑。
     *   ⚠️ 同一个方法两种语义，**不能**因为「砍价不弹」就整条不接。
     */
    async requestBargain(buy: boolean, caller?: unknown): Promise<LeagueRequestResult> {
        return this.sendWithResponse<CmdUnionBargainRspMsg>(
            (onRsp) => new RequestUnionBargain({ buy: buy === true } as any, caller as any, onRsp),
            (rsp) => { if (rsp?.ret && rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods); },
        );
    }

    async requestActList(type: number, caller?: unknown): Promise<LeagueRequestResult> {
        const value = Number.isFinite(type) ? Math.trunc(type) : 0;
        return this.send(() => new RequestUnionActList({ type: value } as any, caller as any));
    }

    // ============================================================
    // P5：联盟任务
    // ============================================================

    /**
     * 任务快照 —— 老端 `LayerLeagueTask.updateView() + initList()` 的数据侧。
     *
     * 四张来源：`taskUnion`（任务表）/ `taskUnionProgress`（三个宝箱）/ `CmdTask`（进度与状态）/
     * `CmdRoleUnion`（`todayTaskAdvTimes` / `todayTaskGetProgressCount`）。**一张都不发请求**。
     *
     * ⚠️ 排序、百分比、红点全部交给 `LeagueTable` 的纯函数（可单测），这里只负责取数与拼装。
     */
    async loadTask(): Promise<ILeagueTaskSnapshot> {
        const taskRows: ILeagueTaskUnionRow[] = parseTaskUnionRows(await readRows(LEAGUE_TASK_UNION_TABLE));
        const progressRows: ILeagueTaskProgressRow[] = parseTaskUnionProgressRows(await readRows(LEAGUE_TASK_PROGRESS_TABLE));
        // 广告次数（底部「每日观看广告跳过剩余次数 N/M」）—— `ad` 表 limit − `CmdAdvert` 已用
        const adRows = await readRows('ad');
        const cmds = this.readTaskCmds();

        const rows = buildLeagueTaskRowViews(taskRows, cmds);
        const { done, total } = leagueTaskProgress(taskRows, cmds);

        const roleUnion = this.readMyRoleUnionRow();
        const progressGot = countOf(roleUnion?.todayTaskGetProgressCount);
        const boxes: ILeagueTaskBoxView[] = buildLeagueTaskBoxViews(progressRows, done, progressGot);

        const { items, resources } = await this.loadIconTables();
        return {
            rows,
            boxes,
            done,
            total,
            // ⚠️ 老端 `progress.value = Math.min(done, total)` 里的 `Math.min` 不是多余的：
            //    服务端有可能先推「已领奖」再把任务行推下来，中间态 `done > total`。
            progressValue: Math.min(done, total),
            progressMax: total,
            showAd: countOf(roleUnion?.todayTaskAdvTimes) <= 0,
            adAvailable: LEAGUE_AD_PLAYBACK_AVAILABLE,
            adRest: leagueAdRest(adRows, LEAGUE_AD_TYPE_UNION_TASK),
            adLimit: leagueAdLimit(adRows, LEAGUE_AD_TYPE_UNION_TASK),
            hasRedDot: hasLeagueTaskRedDot(taskRows, cmds, progressRows, progressGot),
            items,
            resources,
        };
    }

    async requestTaskReward(resId: number, caller?: unknown): Promise<LeagueRequestResult> {
        const id = Number.isFinite(resId) ? Math.trunc(resId) : 0;
        if (id <= 0) return 'failed';
        // ★ 老端 `ModelLeague.RequestTaskReward`：`if (rsp.ret) FW.ShowReward(rsp.tlCmdGoods)`
        return this.sendWithResponse<CmdTaskUnionGetRewardRspMsg>(
            (onRsp) => new RequestTaskUnionGetReward({ resId: id } as any, caller as any, onRsp),
            (rsp) => { if (rsp?.ret && rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods); },
        );
    }

    async requestTaskAdvert(resId: number, caller?: unknown): Promise<LeagueRequestResult> {
        const id = Number.isFinite(resId) ? Math.trunc(resId) : 0;
        if (id <= 0) return 'failed';
        return this.send(() => new RequestRoleWatchAdvert(
            { type: LEAGUE_AD_TYPE_UNION_TASK, id } as any,
            caller as any,
        ));
    }

    async requestTaskProgressReward(subType: number, caller?: unknown): Promise<LeagueRequestResult> {
        const value = Number.isFinite(subType) ? Math.trunc(subType) : 0;
        if (value <= 0) return 'failed';
        // ★ 老端 `ModelLeague.RequestTaskUnionGetProgressReward`：`if (rsp.ret) FW.ShowReward(rsp.tlCmdGoods)`
        return this.sendWithResponse<CmdTaskUnionGetProgressRewardRspMsg>(
            (onRsp) => new RequestTaskUnionGetProgressReward({ subType: value } as any, caller as any, onRsp),
            (rsp) => { if (rsp?.ret && rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods); },
        );
    }

    // ============================================================
    // P6：北伐中原
    // ============================================================

    /**
     * 北伐主面板快照 —— 老端 `LayerLeagueNorthernExpedition.updateView()` + `updateTime()` 的数据侧。
     *
     * 七处来源：`gameConfig`（6 键）/ `CmdUnionActivity`（`type = 2`）/ `guankaReward` + `monster`
     * （boss 名）/ `taskUnion`（`subType` 2/3，红点用）/ `CmdTask`（那两档的进度）/ `CmdRoleUnion`
     * （`todayDrumTimes` 之类）+ `item` / `roleProperty`（奖励图标）。**一张都不发请求**。
     *
     * ⚠️ 「今日挑战奖励」老端是**按下标硬取** `reward[0]` / `reward[1]` 铺两个物品框
     *    （`com_goods` / `com_goods1`）⇒ 本端保留数组、由页面按下标取前两个。
     */
    async loadNorthExpedition(): Promise<ILeagueNorthSnapshot> {
        const config = parseLeagueNorthConfig(await readRows(LEAGUE_GAME_CONFIG_TABLE));
        const actRaw = this.readUnionActivity(LeagueACT_TYPE.NORTHERN_EXPEDITION);
        const act: ILeagueActivityView | null = parseLeagueActivity(actRaw);

        const selfRoleId = readSelfRoleId();
        const guanKaRows = parseLeagueGuanKaRows(await readRows(LEAGUE_GUANKA_REWARD_TABLE));
        const monsters = parseLeagueMonsterRows(await readRows(LEAGUE_MONSTER_TABLE));
        const boss: ILeagueMonsterView | null = leagueNorthBossOf(guanKaRows, monsters, act ? act.id : 0);

        const unionId = this.myUnionId();
        const joined = !!unionId && unionId !== '0';

        const taskRows = parseNorthTaskUnionRows(await readRows(LEAGUE_TASK_UNION_TABLE));
        const cmds = this.readTaskCmds();

        const stats = leagueActSelfStats(act, selfRoleId);
        const rewardRedDot = hasLeagueNorthRewardRedDot(taskRows, cmds, 'league')
            || hasLeagueNorthRewardRedDot(taskRows, cmds, 'role');

        const { items, resources } = await this.loadIconTables();
        return {
            joined,
            config,
            act,
            boss,
            timesText: leagueNorthTimesText(config, stats.times),
            selfTimes: stats.times,
            todayDrumTimes: countOf(this.readMyRoleUnionRow()?.todayDrumTimes),
            buffText: leagueNorthBuffText(config, act ? act.addBuffTimes : 0),
            buffAddTimes: act ? act.addBuffTimes : 0,
            selfValue: stats.value,
            leagueValue: act ? act.allValue : 0,
            dailyRewards: config.dailyRewards,
            hasRedDot: joined && hasLeagueNorthRedDot(
                act,
                selfRoleId,
                config.enterMaxCount,
                taskRows,
                cmds,
            ),
            // ⚠️ 与 `rewardRedDot` 同口径（**不加 `joined`**）：这两颗都是**面板内**红点，
            //    面板只可能从「已入盟」的联盟入口进；入口红点 `hasRedDot` 才需要那道闸。
            //    `hasLeagueNorthChallengeRedDot` 自带 `if (!act) return false`（活动没开不亮）。
            challengeRedDot: hasLeagueNorthChallengeRedDot(act, selfRoleId, config.enterMaxCount),
            rewardRedDot,
            items,
            resources,
        };
    }

    /** 北伐奖励页快照 —— 老端 `LayerLeagueNorthernExpeditionReward.updateView()` 的数据侧。 */
    async loadNorthReward(): Promise<ILeagueNorthRewardSnapshot> {
        const rows = parseNorthTaskUnionRows(await readRows(LEAGUE_TASK_UNION_TABLE));
        const cmds = this.readTaskCmds();
        const leagueRedDot = hasLeagueNorthRewardRedDot(rows, cmds, 'league');
        const roleRedDot = hasLeagueNorthRewardRedDot(rows, cmds, 'role');
        const { items, resources } = await this.loadIconTables();
        return {
            // ⚠️ 两档**各自过滤**（老端 `refArray.filter(t => t.subType == subType)`），
            //    不是「一次全过滤 + 页签切显示」—— 两档的行数差很多（现网 20 vs 5）。
            leagueRows: buildLeagueNorthRewardRowViews(northRewardRowsOf(rows, 'league'), cmds),
            roleRows: buildLeagueNorthRewardRowViews(northRewardRowsOf(rows, 'role'), cmds),
            leagueRedDot,
            roleRedDot,
            hasRedDot: leagueRedDot || roleRedDot,
            items,
            resources,
        };
    }

    /**
     * 北伐排行页（**唯一一条要等响应的联盟请求**）。
     *
     * 老端 `requestRankInfo()` 的请求体：
     * `{ rankType: [24, 22][页签], showNum: 50, unionId: 我角色id }`（见 `RequestGetRank` 的说明）。
     */
    async loadNorthRank(tab: LeagueNorthRankTab, caller?: unknown): Promise<ILeagueNorthRankSnapshot> {
        const rankType = tab === 'progress' ? LEAGUE_NORTH_RANK_TYPE.progress : LEAGUE_NORTH_RANK_TYPE.league;
        const awards = parseUnionRankAwardRows(await readRows(LEAGUE_UNION_RANK_AWARD_TABLE));

        const rsp = await this.requestRsp<any>((done, fail) => new RequestGetRank({
            rankType,
            showNum: LEAGUE_NORTH_RANK_SHOW_NUM,
            // ⚠️ 填**角色 id**（不是 unionId）—— 照抄老端 `ModelRole.GetRole().GetCmd().id`，
            //    见 `RequestGetRank` 的说明（`unionId` 这个字段名在服务端被当角色 id 用）。
            unionId: readSelfRoleId(),
        } as any, caller as any, done, fail));

        const rankInfo = rsp?.rankInfo ?? null;
        const { items, resources } = await this.loadIconTables();
        if (!rankInfo) {
            // 请求没回来 / 没有 `rankInfo` ⇒ `ok: false`，页面保留上一趟数据
            return { tab, rankType, rows: [], myRow: null, ok: false, items, resources };
        }
        const rows = buildLeagueNorthRankRowViews(parseLeagueRankRows(rankInfo.rankList), awards);
        const myRankRows = parseLeagueRankRows(rankInfo.myRank ? [rankInfo.myRank] : []);
        return {
            tab,
            rankType,
            rows,
            myRow: myRankRows.length > 0 ? buildLeagueNorthRankRowView(myRankRows[0], awards) : null,
            ok: true,
            items,
            resources,
        };
    }

    async requestDrum(caller?: unknown): Promise<LeagueRequestResult> {
        return this.send(() => new RequestUnionActDrum({ type: LeagueACT_TYPE.NORTHERN_EXPEDITION } as any, caller as any));
    }

    async requestSweep(caller?: unknown): Promise<LeagueRequestResult> {
        // ★ 老端 `ModelLeague.RequestUnionActSweep`：`if (rsp.ret) FW.ShowReward(rsp.tlCmdGoods)`
        return this.sendWithResponse<CmdUnionActSweepRspMsg>(
            (onRsp) => new RequestUnionActSweep(
                { type: LeagueACT_TYPE.NORTHERN_EXPEDITION } as any, caller as any, onRsp,
            ),
            (rsp) => { if (rsp?.ret && rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods); },
        );
    }

    /**
     * 发一条**要拿回数据**的请求（北伐排行专用）。
     *
     * 为什么不能用 `send()`：那个只看「请求有没有被接受」（`GameNet.send` 兑现的是
     * `boolean`），响应体只从 `RequestMsg.fCallback` 出来。要数据就得自己包一层 Promise。
     *
     * 三重兜底，保证**一定兑现**（与 `send()` 同口径）：
     * ① 离线 ⇒ 立刻 `null`；② `make()` 或 `net.send()` 抛 ⇒ `fail()`；
     * ③ `withTimeout(WRITE_TIMEOUT_MS)` ⇒ 服务端不回也 `null`。
     */
    private requestRsp<T>(
        make: (done: (rsp: T) => void, fail: () => void) => any,
    ): Promise<T | null> {
        const net = GameNet.instance;
        if (!net?.isConnected) return Promise.resolve(null);
        return withTimeout(new Promise<T | null>((resolve) => {
            let settled = false;
            const finish = (value: T | null): void => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            let request: any;
            try {
                request = make((rsp) => finish(rsp), () => finish(null));
            } catch (error) {
                console.warn('[League] 构造排行请求失败', error);
                finish(null);
                return;
            }
            try {
                const accepted = net.send(request, false);
                if (accepted && typeof accepted.catch === 'function') void accepted.catch(() => finish(null));
            } catch (error) {
                console.warn('[League] 排行请求发送失败', error);
                finish(null);
            }
        }), WRITE_TIMEOUT_MS, () => null);
    }

    /**
     * 缓存里的 `CmdTask` 全表 —— 联盟任务**没有独立缓存**，就是它按 `resId` 反查。
     *
     * ⚠️ 只保留 `resId` / `count` / `rewardState` 三个字段，**不裁剪到 `taskUnion` 的行**：
     *    过滤交给 `LeagueTable`（`buildLeagueTaskRowViews` 用 `Map` 反查，表外的任务自然落空），
     *    这样本函数与「表里有哪些联盟任务」解耦（表热更后不必重进面板）。
     */
    private readTaskCmds(): ILeagueTaskCmd[] {
        try {
            const rows = ((CacheMgr.instance as any)?.getTlCmdTask?.() ?? []) as unknown[];
            const out: ILeagueTaskCmd[] = [];
            for (const raw of rows) {
                if (!raw || typeof raw !== 'object') continue;
                const row = raw as { resId?: unknown; count?: unknown; rewardState?: unknown };
                const resId = Number(row.resId);
                if (!Number.isFinite(resId)) continue;
                const state = Number(row.rewardState);
                out.push({
                    resId: Math.trunc(resId),
                    // ⚠️ `count` 是 protobuf 的 `Long`：`countOf` 走 `Number(value)`，
                    //    protobufjs 的 `Long#valueOf()` 会给出 number ⇒ 能过；
                    //    直接 `value as number` 则会在比较里得到 `NaN`（同砍价倒计时那条教训）。
                    count: countOf(row.count),
                    rewardState: Number.isFinite(state) ? Math.trunc(state) : 0,
                });
            }
            return out;
        } catch (error) {
            console.warn('[League] 读 CmdTask 缓存失败', error);
            return [];
        }
    }

    /**
     * 「我持有多少某个 `roleProperty` 资源」—— 老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert`
     * 的取数口径，两步走：
     *
     * 1. `roleProperty` 表里按 `resId` 找那一行，取它的 `key`（如 `resId=10 → "coin"`）；
     * 2. 用这个 `key` 去 `CmdRole`（我自己的角色行）上取字段值。
     *
     * ⚠️ **不能拿 `resId` 当字段名去猜**（`CmdRole[10]` 恒 `undefined`）——
     *    `resId → key` 这一步才是映射本体（`LeagueTable.findLeagueProperty`）。
     * ⚠️ 表 / 角色行读不到时 `key` 落空串 ⇒ `rolePropertyAmount` 返回 0（不抛、不猜）。
     *
     * P4 用它两处：砍价的 `enough`（`resId 10` 金币）、捐献的 `enough`（`resId 11` 联盟银币）。
     */
    private async ownedResourceOf(resId: number): Promise<number> {
        const properties = parseLeaguePropertyRows(await readRows(LEAGUE_PROPERTY_TABLE));
        const key = findLeagueProperty(properties, resId)?.key ?? '';
        return rolePropertyAmount(readSelfRoleRow(), key).value;
    }

    /**
     * 奖励图标的两张索引表 —— `item`（`iconIsPath = true`）+ `roleProperty`（落 `icons/resource`）。
     *
     * P4 三个面板都要它（奖励格按 `resId` 换图），读法全工程统一：
     * `rewardGoodsOf(resId, items, resources)` → `resolveRewardIconRef(...)`
     * （见 `LeagueArt.leagueRewardIconRef`）。战令 / 邮件 / 挂机 / 活动都是这一套。
     */
    private async loadIconTables(): Promise<{
        items: Map<number, ILeagueGoodsInfo>;
        resources: Map<number, ILeagueGoodsInfo>;
    }> {
        return {
            items: parseItemRows(await readRows(LEAGUE_ITEM_TABLE)),
            resources: parseRolePropertyRows(await readRows(LEAGUE_PROPERTY_TABLE)),
        };
    }

    /** `CmdShop` 里联盟档（`cmdShopType = 8`）的货品行；拿不到返回空数组。 */
    private readShopGoodsRows(): unknown[] {
        try {
            const shop = (CacheMgr.instance as any)?.getCmdShop?.(LEAGUE_SHOP_TYPE_UNION);
            const list = shop?.tlCmdShopGoods;
            return Array.isArray(list) ? list : [];
        } catch (error) {
            console.warn('[League] 读 CmdShop(union) 缓存失败', error);
            return [];
        }
    }

    /** 缓存里的 `CmdRoleUnion`（我那一行）；读不到返回 `null`。 */
    private readMyRoleUnionRow(): CmdRoleUnion | null {
        const rows = readCacheRows('CmdRoleUnion');
        const selfId = readSelfRoleId();
        let first: CmdRoleUnion | null = null;
        for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as CmdRoleUnion;
            if (!first) first = row;
            if (selfId && toIdString((row as { roleId?: unknown }).roleId) === selfId) return row;
        }
        return first;
    }

    /** 缓存里的联盟活动行（按 `unionId` 归档，再按 `type` 过滤）。 */
    private readUnionActivity(type: number): CmdUnionActivity | null {
        try {
            const mgr = CacheMgr.instance as any;
            const unionId = this.myUnionId();
            if (unionId && unionId !== '0' && typeof mgr?.getCmdUnionActivity === 'function') {
                const hit = mgr.getCmdUnionActivity(unionId) as CmdUnionActivity | undefined;
                if (hit && Number(hit.type) === type) return hit;
            }
            const all = (mgr?.getTlCmdUnionActivity?.() ?? []) as CmdUnionActivity[];
            for (const row of all) {
                if (row && Number(row.type) === type) return row;
            }
        } catch (error) {
            console.warn('[League] 读 CmdUnionActivity 缓存失败', error);
        }
        return null;
    }

    /** 我所在的联盟 id（`'0'` = 未入盟）。 */
    private myUnionId(): string {
        const row = this.readMyRoleUnionRow();
        return toIdString((row as { unionId?: unknown } | null)?.unionId);
    }

    /**
     * `roleId → 成员名` 的查表函数。
     *
     * ⚠️ 返回 `undefined`（不是空串）表示「查不到」—— `buildLeagueDiscountRows` 靠它
     *    把整条丢掉（老端 `if (member)` 同口径）。名字是空串的成员**照留**。
     */
    private memberNameLookup(): (roleId: string) => string | null | undefined {
        const members = normalizeLeagueMembers(readCacheRows('CmdUnionMember'));
        const byRole = new Map<string, string>();
        for (const member of members) byRole.set(member.roleId, member.name);
        return (roleId: string) => byRole.get(roleId);
    }

    // ============================================================
    // 内部工具
    // ============================================================

    private async appoint(
        memberId: string,
        officialId: number,
        type: boolean,
        caller?: unknown,
    ): Promise<LeagueRequestResult> {
        return this.memberRequest(
            (id) => new RequestUnionAppoint({ memberId: id, officialId, type } as any, caller as any),
            memberId,
        );
    }

    /**
     * 把 id 过一遍 `toIdString` 再发。
     *
     * ⚠️ 必须发**字符串**：`protoCompiledStatic.ts` 生成的请求类构造函数是**裸赋值**
     * （`this[key] = properties[key]`，不做 `Long.fromValue`），真正的换算在编码时由
     * `LongBits.from` 做 —— 它认 `Long` / `number` / **十进制字符串**，其余形状（普通对象）
     * 会被当成 `zero` ⇒ **id 静默变成 0**。口径同 `FriendRepository`。
     */
    private memberRequest(make: (id: string) => any, memberId: string): Promise<LeagueRequestResult> {
        const id = toIdString(memberId);
        if (!id || id === '0') return Promise.resolve('failed');
        return this.send(() => make(id));
    }

    /** 统一的发包 + 三态收口。 */
    private async send(make: () => any): Promise<LeagueRequestResult> {
        const net = GameNet.instance;
        if (!net?.isConnected) return 'offline';
        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(net.send(make(), false), WRITE_TIMEOUT_MS, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[League] 请求失败', error);
            return 'failed';
        }
    }

    /**
     * 与 {@link send} 同口径（离线 / 超时 / 异常三态），**额外把响应交给 `onResponse` 消费**。
     *
     * ★ 为什么必须有这个东西：`send()` **把响应整个丢掉了** ——
     *   而联盟有一整类请求的**唯一产物就在响应里**（`tlCmdGoods` = 本次获得的奖励）。
     *   丢掉它 = 「服务端发了奖、客户端不弹窗」，而且**一句错都不报**。
     *   老端对应的是 `ModelLeague.RequestXxx` 里那一串
     *   `if (rsp.ret) FW.ShowReward(rsp.tlCmdGoods)`。
     *   ⚠️ 本工程这条曾整片缺失（商店 / 砍价 / 任务领奖 / 任务进度奖 / 北伐扫荡
     *   —— 全被 `tests/reward-popup-wiring.test.ts` 点名过），别再用 `send()` 发这类请求。
     *
     * ⚠️ **`applied` 闸**：只有真收到响应才算 `'ok'`。
     *   `net.send` 的 `true` 只代表「包发出去了」，不代表服务端回了。
     *   可靠性依据：`NetworkRequest.resolve(rsp)` 是**先** `fCallback(rsp)`、**再** `resolve(true)`
     *   （见 `framework/net/NetworkRequest.ts`），所以 `await` 回来时 `applied` 已经落定。
     *   同口径先例：`GiftRepository.buyGift`。
     *
     * @param make       收到 `onRsp` 后构造请求（把它作为 `RequestMsg` 的第 3 个参数传进去）
     * @param onResponse 消费响应；**只在真收到响应时调用**
     */
    private async sendWithResponse<Rsp>(
        make: (onRsp: (rsp: Rsp) => void) => unknown,
        onResponse: (rsp: Rsp) => void,
    ): Promise<LeagueRequestResult> {
        const net = GameNet.instance;
        if (!net?.isConnected) return 'offline';
        let applied = false;
        try {
            const sent = await withTimeout(
                net.send(make((rsp: Rsp) => { applied = true; onResponse(rsp); }) as any, false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[League] 请求失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }
}

export const leagueRepository: ILeagueRepository = new RuntimeLeagueRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const LEAGUE_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const LEAGUE_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;

/** 编辑信息的 `type` 取值（从 `RequestLeagueMsg` 转出，方便页面只 import 本文件）。 */
export { LeagueEditType };

/** 读一张分表（`remoteRef`）；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 未入盟时的空快照（页面用它做「未入盟」空态，免得每处都写一遍）。 */
export function emptyLeagueSnapshot(nowMs: number = Date.now()): ILeagueSnapshot {
    return {
        joined: false,
        unionId: '0',
        myPosition: 0,
        selfRoleId: '',
        myUnion: null,
        myMaxExp: 0,
        members: [],
        logs: [],
        applys: [],
        unions: [],
        officialPowers: new Map<number, ILeagueOfficialRow>(),
        now: nowMs,
    };
}
