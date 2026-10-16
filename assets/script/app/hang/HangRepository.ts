/**
 * 征收（挂机）的数据端口 —— **表 + 服务器状态 + 网络请求** 三合一的 Repository。
 *
 * 与 `GiftRepository` / `SevenDayRepository` / `BattleTokenRepository` 同一套分层：
 * 页面只依赖本文件，判定逻辑全在 `HangTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * ## 数据来源
 *
 * | # | 来源 | 用途 |
 * |---|---|---|
 * | ① | `guankaReward`（1632 行，**压缩表**） | 每关的 `idleRewards`（每小时基础产出）+ `end`（快速征收一次扣的体力） |
 * | ② | `interactReward` | 探索层「挂机收益建筑」互动加成（**只有 `type === 3` 的 9 行**产税） |
 * | ③ | `gameConfig` | `sweepFreeTimes`（免费扫荡次数上限） |
 * | ④ | `item` + `roleProperty` | 奖励格的品质框 + 图标（**两支分流**，唯一入口 `resolveRewardIconRef`） |
 * | ⑤ | `monthCardActPlan` + `payChannel` | 福利月卡的 `plan` / `type` / 真实金额（`rmb` 是 `payChannel.id`） |
 * | ⑥ | `CacheMgr.getTlCmdRole()[0]` | `lastIdleRewardTime`（挂机起点）+ `sweepTimes`（今日已扫荡次数） |
 * | ⑦ | `CacheMgr.getTlCmdRoleInteractInfo()` | 已互动建筑的 `resId` 集合（`state === 1`） |
 * | ⑧ | `CacheMgr.getCmdBattleLevel(level)` / `getCmdBattleChapter(chapter)` | `star`（**3 位位掩码**）⇒ 通关 / 完美通关判定；章节缓存是否存在 ⇒ `GetSweetLevel` 的 `break` |
 *
 * ## ⚠️ 走 `CacheMgr`，不自己存快照
 *
 * `CmdRole` / `CmdBattleLevel` / `CmdRoleInteractInfo` 全在 `protoCache.json` 里登记
 * ⇒ 服务端会推，`GameNet` 收包时已写进 `GameCache`。所以每次 `load()` 现读，**不要自己存一份**。
 *
 * ## ⚠️ 没有「拉取挂机数据」的请求
 *
 * `Cmd.d.ts` 里挂机相关的三个请求是 `GetReward` / `Quick` / `Time`（**没有"查询"**），
 * 老端 `LayerHang.init()` 也只读缓存 + `CmdRole`。缓存为空 = 服务端还没推 / 离线，
 * 界面按 `lastIdleRewardTime = 0` ⇒ 进度 0 渲染即可，**不要造一个假请求**。
 *
 * ## ⚠️ 三个「关卡」不是一个（本模块最大的坑）
 *
 * | 用途 | 取哪一关 | 老端实现 |
 * |---|---|---|
 * | 奖励区展示的每小时产出 | `GetMaxChallengeLevel() - 1`（**已通关的最后一关**） | `ModelChapterNew.ts:198` |
 * | 快速征收扣多少体力 | `GetSweetLevel()`（**最高 3 星「完美通关」的关**） | `ModelChapterNew.ts:237` |
 * | 进度条 / 倒计时 | **与关卡无关**，只看 `CmdRole.lastIdleRewardTime` | `LayerHang.refreshTime()` |
 *
 * 三者在 `HangTable` 里各有纯函数（`deriveMaxChallengeLevel` / `deriveSweetLevel` /
 * `incomeLevelOf` / `sweepLevelOf`），本文件只负责注入 `isPassed` / `starOf` / `hasChapter`
 * 三个查询器。
 *
 * ⚠️ 两处兜底**不对称，且是有意的**（见 `HangTable` 里两个函数的注释）：
 *   - `incomeLevelOf` **有**兜底（退到第 1 关）—— 纯展示，让离线预览 / 新号看得见产出区；
 *   - `sweepLevelOf` **没有**兜底（没满星关 = `0`）—— 它决定「发不发请求」，
 *     兜底会让新号发出老端从不发的 `{level: 1, type: 1}`。**纯展示可以退，发请求不能退。**
 *
 * ⚠️ `CmdBattleLevel.star` 是 **3 位位掩码**（bit0=1 星 / bit1=2 星 / bit2=3 星），**不是星数**。
 * 所以老端 `GetStageIsPerfectClean()` 的 `mask >= 3` 实际含义是「2 星及以上」——
 * 与 FGUI 文案一致。要星数请显式过 `HangTable.levelStarCount()`。
 *
 * ## ⚠️ 支付链路只到「业务前置请求」
 *
 * 老端 `onClickBuyWelfareMonthCard()` 的顺序是：先发 `CmdCardBuyReqMsg`，
 * 拿到 `rsp.ret === true` **之后**再 `SDKMgr.pay(payRef.id, "common", 0)`。
 * Demo3.8 没有支付 SDK（与礼包 / 首充 / 月卡 / 战令同一处置）⇒
 * **只留注释，发到业务前置请求为止**。而且本模块更要往上一层：本轮连「买」都不发，
 * 见下面「福利月卡」一节。
 *
 * ## ⚠️ 福利月卡：表在、玩家状态不在
 *
 * 已核实（2026-09-24）：
 *
 * | 事实 | 结论 |
 * |---|---|
 * | `monthCardActPlan` 有两行；**plan 1 = 「福利月卡」**，`privilege[].type` 含 **4**（`NoCountSweep`「无限次快速扫荡」） | **特权定义是有的**，不是缺表 |
 * | `monthCardActPlan.plan1.rmb = 9` ⇒ `payChannel` id 9 = `rmb: 30`、`name: "福利月卡"` | 月卡条上的 **￥30 能算出来**（与线上截图一致） |
 * | `protoCache.json`（78 张表）里**没有任何月卡表** | **玩家持卡状态读不到** ⇒ `hasUnlimited` 只能恒 `false` |
 *
 * ⇒ 本轮走「无月卡默认分支」（用户 2026-09-24 拍板）：
 * `是否购买月卡` 置「否」（月卡销售条**显示**，FGUI `n74` 的 `gearDisplay pages="1"` 正是
 * 「否」这一页）、倍率恒 1、`change_btn` 点击提示「激活月卡后解锁功能」。
 * 价格 / 标题仍从表里取真值（不写死 ￥30）。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    HJ_CFG_SWEEP_FREE_TIMES,
    HJ_END_RES_ID,
    HJ_INTERACT_STATE_DONE,
    HJ_MIN_CHALLENGE_LEVEL,
    HJ_PASSED_STAR,
    HJ_SWEEP_TYPE_CHAPTER,
    adCountBranchOf,
    adLeftOf,
    collectInteractTaxRewards,
    deriveMaxChallengeLevel,
    deriveSweetLevel,
    guankaRowOf,
    incomeLevelOf,
    mergeRewards,
    parseGameConfigRows,
    parseGuankaRows,
    parseInteractRows,
    sweepFreeTimesOf,
    sweepLevelOf,
} from './HangTable';
import type { IHjGuankaRow, IHjInteractRow, IHjReward, IHjSnapshotView } from './HangTable';

// 快照查询全在 `HangTable`（零引擎依赖 ⇒ 可单测），这里只做**转发**，
// 让页面的 `import { ... } from './HangRepository'` 一行不用改。
export {
    cappedElapsedMsOf,
    claimableOf,
    costTextOf,
    elapsedMsOf,
    freePageOf,
    monthCardBarVisibleOf,
    progressOf,
    reachedMaxOf,
    sweepUsedOf,
    timesOf,
} from './HangTable';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
import { resolveRewardIconRef } from '../activity/LayerActivityArt';
import { RequestRoleWatchAdvert } from '../generated/requestMsg/RequestRoleMsg';
import { HJ_TEXTS, hjFormat } from './HangTexts';
import { RequestBattleSweep, RequestHangGetReward } from './RequestHangMsg';

/** 福利月卡特权 `type`：无限次快速扫荡（老端 `PrivilegeType.NoCountSweep = 4`）。 */
export const HJ_PRIVILEGE_NO_COUNT_SWEEP = 4;

/**
 * 广告位类型：扫荡（老端 `AdType.sweep = 11`）。
 *
 * ⚠️ `AdType` 是**协议枚举**、两端同源（`generated/refGen/RefEnum.ts`），但这里不 import 它：
 * `HangRepository` 要能在纯 Node 单测里跑，import 生成目录会拖进一堆引擎依赖。
 * 值本身有单测钉住（`tests/hang.test.ts` 会断言 `ad.json` 里 `type === 11` 那行的 `key === 'sweep'`）。
 */
export const HJ_AD_TYPE_SWEEP = 11;

/**
 * 老端「打开征收」用的跳转类型：`JUMP_TYPE.HANG = 9`
 * （`client/assets/script/app/game/model/jump/ModelJump.ts:22`）。
 *
 * ## ⚠️ 征收**不是** `open.json` 入口 —— 别往 `MainEntranceRoute` 里加 `LayerHang`
 *
 * 已核实（2026-09-24，三处证据）：
 *
 * | 事实 | 出处 |
 * |---|---|
 * | 策划源表 `doc/塔防数据配置/json/client/open.json`（64 行）**没有** `LayerHang` 行 | 全量枚举过 |
 * | 老端 `client/assets/remoteRef/open.json` 也没有 | 同上 |
 * | 老端打开征收走的是跳转：`ViewJump.ts:40` `case JUMP_TYPE.HANG: CtrlHang.openLayerHang()` | 另有 `GObjChapterSelect.ts:469` 直接 `openLayerHang()` |
 *
 * 所以「入口白名单只两处」这条约定对征收**不适用**：`MainEntranceRoute.POPUP_URLS` 的语义是
 * `open.url → 弹窗`，塞一个表里不存在的 url 会打破
 * `tests/main-entrance-route.test.ts`「白名单 ⊆ open.json」那条守卫（专治拼错导致的静默失效）。
 *
 * ⚠️ 本工程**还没接跳转链路**（与活动 / 七日同一处置，见 `LayerActivityPage` 的 `goto` 分支）⇒
 * 这里只留常量与出处。等跳转链路落地，在它 `JumpType` 的 switch 里加
 * `case HJ_JUMP_TYPE_HANG: void HangPage.open();` 即可 —— 那才是老端的位置。
 */
export const HJ_JUMP_TYPE_HANG = 9;

/** `CmdRole` 里本模块要的两个字段。 */
export interface IHangRoleState {
    /** 挂机起点（毫秒）。`CmdRole.lastIdleRewardTime` 是 `Long`；读不到为 0。 */
    readonly lastIdleRewardTimeMs: number;
    /** 今日已扫荡次数（有月卡时恒 0 —— 老端 `refreshGearBtn` 会复位档位）。 */
    readonly sweepTimes: number;
}

/** 福利月卡的展示信息（`owned` 见文件头「玩家状态不在」一节）。 */
export interface IHangMonthCardRef {
    /** `monthCardActPlan.plan`。 */
    readonly plan: number;
    /** `monthCardActPlan.type`（下单用这个，**不是** `plan`）。 */
    readonly type: number;
    /** 表里的描述（`福利月卡`）。 */
    readonly desc: string;
    /** 真实金额（元）；由 `payChannel` 按 `monthCardActPlan.rmb` 换算。 */
    readonly rmb: number;
    /** 玩家是否持有 —— 状态表缺失，**恒 `false`**。 */
    readonly owned: boolean;
}

/** 一次界面刷新要的全部数据。 */
export interface IHangSnapshot extends IHjSnapshotView {
    readonly guankaRows: readonly IHjGuankaRow[];
    readonly interactRows: readonly IHjInteractRow[];
    /** `gameConfig` 的 `key → value`。 */
    readonly config: ReadonlyMap<string, unknown>;
    /** `item` 表（`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `roleProperty` 表（`iconIsPath = false`，货币 / 属性类落这里）。 */
    readonly resources: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `CmdRole` 的第一行（自己）；读不到为 `null`。 */
    readonly role: IHangRoleState | null;
    /** 已互动（`state === 1`）建筑的 `resId` 集合。 */
    readonly interactedIds: ReadonlySet<number>;
    /** 福利月卡 ref；表里找不到返回 `null`（月卡条按空渲染）。 */
    readonly monthCard: IHangMonthCardRef | null;
    /** 是否有「无限次快速扫荡」特权 ⇒ 倍率可切。本轮恒 `false`。 */
    readonly hasUnlimited: boolean;

    /** `GetMaxChallengeLevel()`：已通关的最后一关 + 1。 */
    readonly maxChallengeLevel: number;
    /** `GetSweetLevel()`：最高达完美门槛（`star 掩码 >= 3`，即 2 星及以上）的关；一个都没有为 `null`。 */
    readonly sweetLevel: number | null;
    /** 收益展示用的关号（`maxChallengeLevel - 1`）。 */
    readonly incomeLevel: number;
    /** 快速征收按哪一关扣体力（老端 `GetSweetLevel()`；没满星关为 **0** ⇒ 页面不发请求）。 */
    readonly sweepLevel: number;
    /** `sweepLevel` 那一关的单次体力消耗（老端 `ref.end`）；查不到为 0。 */
    readonly sweepEnd: number;

    /** 关卡基础每小时产出。 */
    readonly baseRewards: readonly IHjReward[];
    /** 互动建筑加成（已按 resId 汇总）。 */
    readonly interactRewards: readonly IHjReward[];
    /** 基础 ∪ 加成，**同 resId 相加、新 resId 追加末尾**（顺序有语义）。 */
    readonly mergedRewards: readonly IHjReward[];

    /** 免费扫荡次数上限（`gameConfig.sweepFreeTimes`，缺省 3）。 */
    readonly sweepFreeTimes: number;
    /**
     * 今日**剩余**的看广告次数（`ad` 表 `limit` − `CmdRole.tlCmdAdvert` 里 `type=11` 的 `num`）。
     *
     * 老端 `ModelRole.GetAdvertRestTimes(AdType.sweep)`：`maxTimes - GetAdvertTimes(type)`。
     * 读不到时按「一次都没用」算（`= adLimit`），而不是 0 —— 0 会让二次确认弹窗永远不出现。
     */
    readonly adRest: number;
    /** 今日看广告次数上限（`ad` 表 `type=11` 的 `limit`，实测 5）。 */
    readonly adLimit: number;
    readonly now: number;
}

/**
 * 请求结果。
 *
 * 与战令 / 礼包同口径：`offline` = 未连服务器（**早退，不发请求**）、
 * `failed` = 发了但超时 / 异常 / 没回包。
 */
export type HangRequestResult = 'ok' | 'offline' | 'failed';

export interface IHangRepository {
    /** 读表 + 读缓存，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<IHangSnapshot>;
    /** 领取挂机奖励（`CmdHangGetRewardReqMsg`）。 */
    claimReward(caller?: unknown): Promise<HangRequestResult>;
    /** 快速征收 / 扫荡（`CmdBattleSweepReqMsg`）。 */
    sweep(level: number, type?: number, caller?: unknown): Promise<HangRequestResult>;
    /**
     * 记一次「看完广告」（`CmdRoleWatchAdvertReqMsg`）。
     *
     * ⚠️ 这只是**网络那一半**：老端 `ModelRole.RequestWatchAdvert` 是先
     * `CtrlPay.PayforAdVideo(type)` 真的把广告放完、拿到凭据再发这个请求。
     * Demo3.8 没有广告 SDK ⇒ 调用点由 `HangPage.HJ_AD_PLAYBACK_AVAILABLE` 把关，
     * **没有播放凭据不许发**（否则可刷）。
     */
    watchAd(type?: number, caller?: unknown): Promise<HangRequestResult>;
}

/** 请求超时（与首充 / 七日 / 礼包 / 战令同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/**
 * `Long` / `number` / `string` → 毫秒数；认不出返回 0。
 *
 * ⚠️ 不能 `Number(long)` —— protobufjs 的 `Long` 转 number 会得到 `NaN`，
 * 而 `NaN` 参与算术会静默污染整条链路（`elapsed = NaN` ⇒ 进度条 0、文案 `NaN:NaN:NaN`）。
 */
function toNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    if (value && typeof value === 'object') {
        const long = value as { low?: number; high?: number; unsigned?: boolean };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            const n = long.high * 4294967296 + (long.low >>> 0);
            return Number.isFinite(n) ? n : 0;
        }
    }
    return 0;
}

/** 读 `CmdRole` 的第一行；拿不到返回 `null`。 */
function readRole(): IHangRoleState | null {
    try {
        const rows = CacheMgr.instance?.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const cmd = row as unknown as Record<string, unknown>;
            return {
                lastIdleRewardTimeMs: toNumber(cmd.lastIdleRewardTime),
                sweepTimes: Number(cmd.sweepTimes) || 0,
            };
        }
    } catch (error) {
        console.warn('[Hang] 读 CmdRole 缓存失败', error);
    }
    return null;
}

/**
 * 读已互动建筑的 `resId` 集合（`CmdRoleInteractInfo.state === HJ_INTERACT_STATE_DONE`）。
 *
 * ⚠️ `CmdRoleInteractInfo` 的行**同时携带 `state = 0` 的未互动项**，
 * 直接拿全表当"已互动"会把加成算多 —— 必须过滤 `state === 1`
 * （老端 `VORoleInteractBag.GetBagAsArray((vo) => vo.GetState() === 1)`）。
 */
function readInteractedIds(): Set<number> {
    const ids = new Set<number>();
    try {
        const rows = CacheMgr.instance?.getTlCmdRoleInteractInfo() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const item = row as unknown as Record<string, unknown>;
            const resId = Number(item.resId);
            if (!Number.isFinite(resId) || resId <= 0) continue;
            if (Number(item.state) === HJ_INTERACT_STATE_DONE) ids.add(resId);
        }
    } catch (error) {
        console.warn('[Hang] 读 CmdRoleInteractInfo 缓存失败', error);
    }
    return ids;
}

/**
 * 通关判定器（`CacheMgr.getCmdBattleLevel(level).star >= 1`）。
 *
 * ⚠️ `CmdBattleLevel.star` 是 **3 位掩码**（bit0=1 星 / bit1=2 星 / bit2=3 星），不是星数。
 * 老端 `GetStageIsClean(stage)` 是 `mask > 0`，在位掩码下与 `>= 1` 等价，故此处照抄 `HJ_PASSED_STAR`。
 * `star` 缺失（服务端没推过这一关）视作未通关。
 */
function makePassedLookup(): (level: number) => boolean {
    return (level: number): boolean => {
        const cmd = readBattleLevel(level);
        return Number(cmd?.star ?? 0) >= HJ_PASSED_STAR;
    };
}

/**
 * 星级**掩码**查询器（给 `deriveSweetLevel` 用）。
 *
 * ⚠️ 直接返回 `star` 原始值 —— **不要**在这里过 `levelStarCount()`：
 * 老端 `GetStageIsPerfectClean()` 比的就是掩码（`mask >= 3` ⇔ 2 星及以上），
 * 换成星数再比 `>= 3` 会让 2 星关被误判成满星关。
 */
function makeStarLookup(): (level: number) => number {
    return (level: number): number => Number(readBattleLevel(level)?.star ?? 0);
}

/**
 * 章节缓存是否存在的查询器（给 `deriveSweetLevel` 的 `break` 用）。
 *
 * 老端 `GetSweetLevel()` 里 `VOBattleChapterBag.Get(ref.chapter) == null` ⇒ **break**
 * （整段停止扫描，不是跳过这一条）。服务端只在「挑战过该章」时才下发 `CmdBattleChapter`,
 * 所以它等价于「这章还没碰过」。
 */
function makeChapterLookup(): (chapter: number) => boolean {
    return (chapter: number): boolean => {
        try {
            return (CacheMgr.instance as any)?.getCmdBattleChapter(chapter) != null;
        } catch (error) {
            console.warn('[Hang] 读 CmdBattleChapter 缓存失败', error);
            return false;
        }
    };
}

function readBattleLevel(level: number): CmdBattleLevel | null {
    try {
        // `getCmdBattleLevel` 的形参是生成的 number 键；level 来自表，天然是 number。
        return (CacheMgr.instance as any)?.getCmdBattleLevel(level) ?? null;
    } catch (error) {
        console.warn('[Hang] 读 CmdBattleLevel 缓存失败', error);
        return null;
    }
}

/**
 * 找「福利月卡」那一行（`privilege[].type` 含 `NoCountSweep = 4`），并把 `rmb` 换成真实金额。
 *
 * ⚠️ `monthCardActPlan.rmb` 是 **`payChannel.id`**（不是钱数）—— 与 `battleTokenPlan.rmb`
 * 同一个坑。查不到时退化成 `rmb = id`（宁可显示怪数字，也不要空按钮）。
 */
function readMonthCard(planRows: readonly unknown[], payRows: readonly unknown[]): IHangMonthCardRef | null {
    let hit: { plan: number; type: number; desc: string; rmbId: number } | null = null;
    for (const raw of planRows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const privilege = Array.isArray(r.privilege) ? r.privilege : [];
        const has = privilege.some((p) => {
            const item = p as Record<string, unknown> | null;
            return !!item && Number(item.type) === HJ_PRIVILEGE_NO_COUNT_SWEEP;
        });
        if (!has) continue;
        hit = {
            plan: Number(r.plan) || 0,
            type: Number(r.type) || 0,
            desc: typeof r.desc === 'string' ? r.desc : '',
            rmbId: Number(r.rmb) || 0,
        };
        break;
    }
    if (!hit) return null;

    let rmb = hit.rmbId;
    for (const raw of payRows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (Number(r.id) === hit.rmbId) {
            const n = Number(r.rmb);
            if (Number.isFinite(n) && n > 0) rmb = n;
            break;
        }
    }
    return { plan: hit.plan, type: hit.type, desc: hit.desc, rmb, owned: false };
}

/**
 * 今日看广告的**上限**（`ad` 表里 `type = 11`（扫荡）那行的 `limit`）。
 *
 * 老端 `ModelRole.GetAdvertLimit(type)` = `RefMgrad.getRef("type", type).limit || 1`。
 * 表缺失 / 没有这一行时退到 **1**（与老端同一兜底），而不是 0 —— 0 会让文案变成 `1/0`。
 */
function readAdLimit(adRows: readonly unknown[]): number {
    for (const raw of adRows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (Number(r.type) !== HJ_AD_TYPE_SWEEP) continue;
        const limit = Number(r.limit);
        return Number.isFinite(limit) && limit > 0 ? limit : 1;
    }
    return 1;
}

/**
 * 今日**已用**的看广告次数（`CmdRole.tlCmdAdvert` 里 `type = 11` 那行的 `num`）。
 *
 * ⚠️ `CmdAdvert.num` 是「已用次数」不是「剩余次数」；老端
 * `GetAdvertRestTimes = maxTimes - GetAdvertTimes` —— 别把 `num` 直接当剩余。
 * ⚠️ 该表**只在有记录时才存在**（`tlCmdAdvert?: (CmdAdvert[]|null)`）⇒ 读不到按 0 算。
 */
function readAdUsed(): number {
    try {
        const rows = CacheMgr.instance?.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const list = (row as unknown as Record<string, unknown>).tlCmdAdvert;
            if (!Array.isArray(list)) return 0;
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const e = entry as Record<string, unknown>;
                if (Number(e.type) === HJ_AD_TYPE_SWEEP) return Number(e.num) || 0;
            }
            return 0;
        }
    } catch (error) {
        console.warn('[Hang] 读 CmdAdvert 缓存失败', error);
    }
    return 0;
}

/** 生产环境 Repository。 */
export class RuntimeHangRepository implements IHangRepository {
    async load(nowMs: number = Date.now()): Promise<IHangSnapshot> {
        const [guankaRaw, interactRaw, configRaw, itemRaw, resRaw, planRaw, payRaw, adRaw] = await Promise.all([
            readRows('guankaReward'),
            readRows('interactReward'),
            readRows('gameConfig'),
            readRows('item'),
            readRows('roleProperty'),
            readRows('monthCardActPlan'),
            readRows('payChannel'),
            readRows('ad'),
        ]);

        const guankaRows = parseGuankaRows(guankaRaw);
        const interactRows = parseInteractRows(interactRaw);
        const config = parseGameConfigRows(configRaw);
        const role = readRole();
        const interactedIds = readInteractedIds();
        const monthCard = readMonthCard(planRaw, payRaw);

        // ---- 看广告次数（`ad` 表 limit − `CmdAdvert` 已用）----
        const adLimit = readAdLimit(adRaw);
        const adRest = Math.max(0, adLimit - readAdUsed());

        // ---- 关卡进度（三个口径，各有各的算法）----
        const maxChallengeLevel = deriveMaxChallengeLevel(guankaRows, makePassedLookup());
        const sweetLevel = deriveSweetLevel(guankaRows, makeStarLookup(), makeChapterLookup());
        const incomeLevel = incomeLevelOf(maxChallengeLevel);
        const sweepLevel = sweepLevelOf(sweetLevel);

        // ---- 产出奖励 ----
        const incomeRow = guankaRowOf(guankaRows, incomeLevel);
        const baseRewards = incomeRow ? incomeRow.idleRewards : [];
        const interactRewards = collectInteractTaxRewards(interactRows, interactedIds);
        const mergedRewards = mergeRewards(baseRewards, interactRewards);

        // ---- 快速征收消耗 ----
        const sweepRow = guankaRowOf(guankaRows, sweepLevel);
        const sweepEnd = sweepRow ? sweepRow.end : 0;

        return {
            guankaRows,
            interactRows,
            config,
            items: parseItemRows(itemRaw),
            resources: parseRolePropertyRows(resRaw),
            role,
            interactedIds,
            monthCard,
            // ⚠️ 玩家持卡状态读不到（`protoCache.json` 无月卡表）⇒ 恒 false，见文件头
            hasUnlimited: monthCard?.owned === true,
            maxChallengeLevel,
            sweetLevel,
            incomeLevel,
            sweepLevel,
            sweepEnd,
            baseRewards,
            interactRewards,
            mergedRewards,
            sweepFreeTimes: sweepFreeTimesOf(config),
            adRest,
            adLimit,
            now: nowMs,
        };
    }

    /** 领取挂机奖励：`CmdHangGetRewardReqMsg`（无请求参数）。 */
    async claimReward(caller?: unknown): Promise<HangRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdHangGetRewardRspMsg): void => {
            // 老端 `ModelHang.requestHangGetReward`：`FW.ShowReward(rsp.tlCmdGoods)` + `FW.showTip(ModelWorkShop_1)`。
            // 与 `CelebrationRepository.claimTargetReward` 同口径：`FW.ShowReward` 是**可注入的全局出口**
            // （`FW.showReward` → 组合根接成 `ShowRewardPage.open`），本文件不 import 任何视图类、不 import `cc`，
            // 与「页面自己 `Toast.show`」那条约定不冲突。空数组时 `ShowRewardPage` 自己 `close()`，这里不判空。
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(
                net.send(new RequestHangGetReward({}, caller as any, callback), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Hang] 领取挂机奖励失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }

    /**
     * 快速征收 / 扫荡：`CmdBattleSweepReqMsg`。
     *
     * ⚠️ 请求体只有 `{ level, type }` —— **proto 里没有 `times`**，见 `RequestHangMsg.ts` 文件头。
     * ⚠️ 老端 `onClickLevy` 在发请求**之前**还会做两件事，都在页面侧：
     *   ① `CheckHaveEnoughCostAndOpenAlert([{ resId: 9, number: 5 * times }])` —— 体力不足就早退；
     *   ② 免费次数用完时先弹「看广告」二次确认。
     * Repository 不替页面做这两个判断（它要弹框 / 要读 UI），只负责发请求。
     */
    async sweep(level: number, type: number = HJ_SWEEP_TYPE_CHAPTER, caller?: unknown): Promise<HangRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdBattleSweepRspMsg): void => {
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            const sent = await withTimeout(
                net.send(
                    new RequestBattleSweep({ level, type }, caller as any, callback),
                    false,
                ),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Hang] 快速征收失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }

    /**
     * 记一次「看完广告」：`CmdRoleWatchAdvertReqMsg { type, id? }`（老端 `ModelRole.RequestWatchAdvert`）。
     *
     * ⚠️ 调用前必须先真的把广告放完（`HangPage.HJ_AD_PLAYBACK_AVAILABLE` 把关）——
     * 这个请求本身就是「加一次广告次数」的凭据，裸发等于白送。
     */
    async watchAd(type: number = HJ_AD_TYPE_SWEEP, caller?: unknown): Promise<HangRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdRoleWatchAdvertRspMsg): void => {
            // 老端会 `FW.ShowReward(rsp.tlCmdGoods)`；扫荡这类广告通常没有 goods。
            if (rsp?.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods);
            applied = true;
        };

        try {
            const sent = await withTimeout(
                net.send(
                    new RequestRoleWatchAdvert({ type }, caller as any, callback),
                    false,
                ),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Hang] 看广告请求失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }
}

export const hangRepository: IHangRepository = new RuntimeHangRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const HJ_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const HJ_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;

// ============================================================
// 快照上的便捷查询（需要文案模板的那两个留在这里）
// ============================================================

/**
 * 「广告次数」那一行的文案。
 *
 * 三个分支（老端 `refreshBtn`）的分支判定在 `HangTable.adCountBranchOf`（可单测），
 * 这里只负责套模板 —— 保持「判定逻辑不进 Repository」这条家族约定。
 */
export function adCountTextOf(snapshot: IHangSnapshot, adRest: number = 0, adLimit: number = 0): string {
    switch (adCountBranchOf(snapshot)) {
        case 'unlimited':
            return HJ_TEXTS.unlimitedTime;
        case 'watch':
            return hjFormat(HJ_TEXTS.dayWatchTime, adRest, adLimit);
        default:
            return hjFormat(HJ_TEXTS.dayLeftTime, adLeftOf(snapshot), snapshot.sweepFreeTimes);
    }
}

/** 奖励展示信息（`item` 优先，回落 `roleProperty`；都查不到返回 `null`）。 */
export function goodsOf(snapshot: IHangSnapshot, resId: number): IActivityGoodsInfo | null {
    return snapshot.items.get(resId) ?? snapshot.resources.get(resId) ?? null;
}

/**
 * 奖励图标的两支分流解析；解析不出返回 `null`（奖励格降级成只画品质框）。
 *
 * ⚠️ **不要**自己判 `item` / `roleProperty` —— 走 `LayerActivityArt.resolveRewardIconRef`
 * （本模块自己那份转发在 `HangArt.hjResolveRewardIconRef`）。
 */
export function rewardIconRefOf(snapshot: IHangSnapshot, resId: number): { root: string; name: string } | null {
    return resolveRewardIconRef(goodsOf(snapshot, resId));
}

/** 奖励格的品质（查不到按 1；页面按品质选框）。 */
export function rewardQualityOf(snapshot: IHangSnapshot, resId: number): number {
    return goodsOf(snapshot, resId)?.quality || 1;
}

/** 月卡按钮上的价格文案 `￥30`；没有月卡 ref 时返回 FGUI 初值。 */
export function monthCardPriceTextOf(snapshot: IHangSnapshot): string {
    if (!snapshot.monthCard) return HJ_TEXTS.monthCardPriceFallback;
    return hjFormat(HJ_TEXTS.priceTemplate, snapshot.monthCard.rmb);
}

/**
 * 关卡基础产出里每小时的体力消耗 resId —— 用于「快速征收」按钮的 `costIcon`。
 *
 * ⚠️ 这次没用上（体力图标固定写 `HangArt.HJ_COST_ICON_PATH`），但保留常量出口，
 * 免得以后再有人从 `roleProperty` 里手抄一遍 `9`。
 */
export const HJ_COST_RES_ID = HJ_END_RES_ID;

/** `gameConfig` 里 `sweepFreeTimes` 的 key（给单测断言用）。 */
export const HJ_SWEEP_FREE_TIMES_KEY = HJ_CFG_SWEEP_FREE_TIMES;

/** 最低可挑战关号（给单测断言用）。 */
export const HJ_MIN_LEVEL = HJ_MIN_CHALLENGE_LEVEL;
