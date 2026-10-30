/**
 * 开服庆典（老端 `LayerOSRankUI` / `LayerOSRankDetailUI` + FGUI 包「开服冲榜」）的数据端口
 * —— **表 + 服务器状态 + 网络请求** 三合一的 Repository。
 *
 * 与 `HangRepository` / `GiftRepository` / `SevenDayRepository` / `BattleTokenRepository`
 * 同一套分层：页面只依赖本文件，判定逻辑全在 `CelebrationTable`（零 import 纯函数、可单测），
 * 本文件只负责「把数据搬进来 + 把请求发出去」。
 *
 * ## 数据来源
 *
 * | # | 来源 | 用途 |
 * |---|---|---|
 * | ① | `celebrationConfig`（**压缩表** `{k,v,c}`，11 行） | `rankType` ↔ `id`、`name`（战力口径名）、`targetGroupId`、`goto`、`tips` |
 * | ② | `celebrationTarget` | 庆典目标各档的 `count`（门槛值）+ `rewards` |
 * | ③ | `celebrationRank` | 排名奖档 `start~end`（名次区间）+ `count`（战力要求）+ `rewards1/2` |
 * | ④ | `celebrationShop` | 限时特惠商品 `rmb`（=`payChannel.id`）/ `costType` / `costCount` / `limit` / `price` / `discount` |
 * | ⑤ | `payChannel` | `celebrationShop.rmb` → 真实金额（元） |
 * | ⑥ | `item` + `roleProperty` | 奖励格 / 货币图标的图标（**两支分流**，唯一入口 `resolveRewardIconRef`） |
 * | ⑦ | `CacheMgr.getTlCmdCelebrationInfo()` | `curValue`（当前进度值）+ `targetInfos`（已领档）+ `shopInfos`（已购次数） |
 * | ⑧ | `CacheMgr.getTlCmdRankItem()` | 活动时间窗（`startTime` / `endTime` / `showEndTime`，**秒**） |
 *
 * ## ⚠️ 走 `CacheMgr`，不自己存快照
 *
 * `CmdCelebrationInfo` / `CmdRankItem` 都在 `assets/resources/config/protoCache.json` 里登记着
 * （实测核对过：`CmdCelebrationInfo` 的 `tlKey = ["id"]`，`CmdRankItem` 的 `tlKey = ["type"]`）
 * ⇒ 服务端会推，`GameNet` 收包时已写进 `GameCache`。所以每次 `load()` 现读，**不要自己存一份**。
 *
 * ## ⚠️ 没有「拉取庆典数据」的请求
 *
 * `Cmd.d.ts` 里庆典只有两个请求：`GetTargetReward` / `BuyShopGoods`（**没有"查询"**）。
 * 缓存为空 = 服务端还没推 / 离线 ⇒ 界面按空渲染，**不要造一个假请求**
 * （与 `HangRepository` 的「没有拉取挂机数据的请求」同一处置）。
 *
 * ⚠️ 但**详细排名**有查询：`CmdGetRankReqMsg{rankType, showNum, unionId}`
 * （`CmdGetRankRspMsg = 345265589`，已登记）。那一支在 `CelebrationRepository.requestRank()`。
 *
 * ## 🔴 `server.id` 是 **rankType**、`config.id` 才是过滤键
 *
 * 见 `CelebrationTable` 文件头。这里只强调落地点：`pickActiveServer()` 返回的 `s.id`
 * 拿去 `configOfRankType()`；反查出来的 `celebrationIdOf()` 拿去过滤三张子表。
 * 两者混用**不报错、只是三个列表全空**。
 *
 * ## ⚠️ 支付链路只到「业务前置请求」
 *
 * 老端 `ModelCelebration.RequestCelebrationBuyShop` 的顺序是：
 * `rsp.canRmb === true` ⇒ `SDKMgr.pay(rmb, "common", 0)`；否则 `FW.ShowReward(rsp.tlCmdGoods)`。
 * Demo3.8 没有支付 SDK（与礼包 / 首充 / 月卡 / 战令同一处置）⇒ 请求照发，拿到 `canRmb`
 * 之后**只把结果交回页面**，由页面提示「支付暂未接入」，**不假装成功**。
 * 见 `CL_PAY_SDK_AVAILABLE`。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { toIdString, withTimeout } from '../net/RequestGuard';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import { resolveRewardIconRef } from '../activity/LayerActivityArt';
import {
    CL_COUNTDOWN_LEAD_MS,
    buyCountOf,
    celebrationIdOf,
    configOfRankType,
    conditionTextOf,
    countdownHmsOf,
    countdownOffsetOf,
    enabledOf,
    limitBuyTextOf,
    myRankTextOf,
    numAbbrOf,
    parseConfigRows,
    parsePayChannelRows,
    parseRankRows,
    parseRankTimes,
    parseServerStates,
    parseShopRows,
    parseTargetRows,
    pickActiveServer,
    pricingOf,
    propertyWantTextOf,
    rankReachedOf,
    rankSegmentOf,
    rankTextOf,
    rankTimeOf,
    ranksOf,
    rdOf,
    saleTextOf,
    shopsOf,
    sortTargetsByState,
    stateBySubId,
    targetsOf,
} from './CelebrationTable';
import type {
    CelebrationPayBranch,
    ECelebrationTargetRewardType,
    ICelebrationConfigRow,
    ICelebrationGoodsInfo,
    ICelebrationRankRow,
    ICelebrationRankTime,
    ICelebrationReward,
    ICelebrationServerState,
    ICelebrationShopPricing,
    ICelebrationShopRow,
    ICelebrationSnapshot,
    ICelebrationTargetRow,
} from './CelebrationTable';
import { CL_TEXTS } from './CelebrationTexts';
import { RequestCelebrationBuyShop, RequestCelebrationGetTargetReward } from './RequestCelebrationMsg';
import { RequestGetRank } from '../generated/requestMsg/RequestRankMsg';

// 判定 / 格式化全在 `CelebrationTable`（零 import 纯函数 ⇒ 可单测），这里只做**转发**，
// 让页面的 `import { … } from './CelebrationRepository'` 一行不用改。
export {
    CL_COUNTDOWN_LEAD_MS,
    CL_NOT_IN_RANK,
    buyCountOf,
    celebrationIdOf,
    configOfRankType,
    countdownHmsOf,
    countdownOffsetOf,
    numAbbrOf,
    purchaseStateOf,
    rankActiveOf,
    rankReachedOf,
    rankSegmentOf,
    rankTextOf,
    realRmbOf,
    saleTextOf,
    stateBySubId,
} from './CelebrationTable';
export type {
    CelebrationPayBranch,
    ICelebrationConfigRow,
    ICelebrationRankRow,
    ICelebrationRankTime,
    ICelebrationReward,
    ICelebrationServerState,
    ICelebrationShopPricing,
    ICelebrationShopRow,
    ICelebrationSnapshot,
    ICelebrationTargetRow,
};

/** 三个页签的个数（FGUI 控制器 `页签` 的页数）。 */
export const CL_TAB_COUNT = 3;

/** 请求结果 —— 与挂机 / 战令 / 礼包同口径。 */
export type CelebrationRequestResult = 'ok' | 'offline' | 'failed';

/** 买商品的结果：多了「服务端说这次要走支付 SDK」这一支。 */
export type CelebrationBuyResult = CelebrationRequestResult | 'pay';

/**
 * Demo3.8 是否接了支付 SDK。
 *
 * 老端 `SDKMgr.pay(...)`；本工程**没有**（礼包 / 首充 / 月卡 / 战令同一处置）。
 * 恒 `false`：`buyShopGoods()` 拿到 `canRmb === true` 时返回 `'pay'`，
 * 由页面提示 `CL_TEXTS.payUnavailable`，**不谎报成功**。
 */
export const CL_PAY_SDK_AVAILABLE = false;

/** 请求超时（与全家族同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读 `CmdCelebrationInfo` 全表；拿不到返回空数组。 */
function readServers(): ICelebrationServerState[] {
    try {
        return parseServerStates(CacheMgr.instance.getTlCmdCelebrationInfo() ?? []);
    } catch (error) {
        console.warn('[Celebration] 读 CmdCelebrationInfo 缓存失败', error);
        return [];
    }
}

/** 读 `CmdRankItem` 全表 → `rankType` → 时间窗；拿不到返回空表。 */
function readRankTimes(): Map<number, ICelebrationRankTime> {
    try {
        return parseRankTimes(CacheMgr.instance.getTlCmdRankItem() ?? []);
    } catch (error) {
        console.warn('[Celebration] 读 CmdRankItem 缓存失败', error);
        return new Map<number, ICelebrationRankTime>();
    }
}

/**
 * 取**自己的 roleId**（十进制字符串）。
 *
 * 只给详细排名的 `CmdGetRankReqMsg.unionId` 用 —— ⚠️ 那个字段名叫 union 但老端传的是
 * 自己 roleId（`ModelRole.GetRole().GetCmd().id`），**不是公会 id**（见 `requestRank`）。
 *
 * `CmdRole` 是单行表，`getTlCmdRole()` 拿到的数组取第一行即可（与 `FriendRepository.readRole`
 * / `HangRepository` 同一处置）。读不到返回空串：服务端照样回包，只是 `myRank` 为空。
 */
export function celebrationSelfRoleId(): string {
    try {
        const rows = CacheMgr.instance.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const id = toIdString((row as unknown as Record<string, unknown>).id);
            if (id) return id;
        }
    } catch (error) {
        console.warn('[Celebration] 读 CmdRole 缓存失败', error);
    }
    return '';
}

/** 详细排名弹窗要一行数据（`CmdRankRole` 的裁剪视图）。 */
export interface ICelebrationRankEntry {
    readonly rank: number;
    readonly roleName: string;
    readonly power: number;
    readonly usedSkinResId: number;
}

/** 详细排名的回包。 */
export interface ICelebrationRankDetail {
    readonly myRank: ICelebrationRankEntry;
    readonly list: readonly ICelebrationRankEntry[];
    /** 服务端返回的区服标识（`CmdRankData.region`），可能为空串。 */
    readonly region: string;
}

export interface ICelebrationRepository {
    /** 读表 + 读缓存，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<ICelebrationSnapshot>;
    /** 领取庆典目标奖励（`CmdCelebrationGetTargetRewardReqMsg`，返回 `tlCmdGoods`）。 */
    claimTargetReward(id: number, subId: number, caller?: object): Promise<CelebrationRequestResult>;
    /** 购买限时特惠商品（`CmdCelebrationBuyShopGoodsReqMsg`）。 */
    buyShopGoods(id: number, subId: number, caller?: object): Promise<CelebrationBuyResult>;
    /**
     * 查详细排名（`CmdGetRankReqMsg`）。
     *
     * 与另两个不同：**这是查询**，回包才有数据 ⇒ 读超时用 800ms（不是 5000）。
     */
    requestRank(rankType: number, showNum: number, unionId: string, caller?: object): Promise<ICelebrationRankDetail | null>;
}

/** 生产环境 Repository。 */
export class RuntimeCelebrationRepository implements ICelebrationRepository {
    async load(nowMs: number = Date.now()): Promise<ICelebrationSnapshot> {
        const [configRaw, targetRaw, rankRaw, shopRaw, payRaw, itemRaw, resRaw] = await Promise.all([
            readRows('celebrationConfig'),
            readRows('celebrationTarget'),
            readRows('celebrationRank'),
            readRows('celebrationShop'),
            readRows('payChannel'),
            readRows('item'),
            readRows('roleProperty'),
        ]);

        const configs = parseConfigRows(configRaw);
        const targets = parseTargetRows(targetRaw);
        const ranks = parseRankRows(rankRaw);
        const shops = parseShopRows(shopRaw);

        // ---- 选中哪一份庆典（老端 `VOCelebrationBag.GetFirstOne`）----
        const rankTimes = readRankTimes();
        const server = pickActiveServer(readServers(), rankTimes, nowMs);

        // ⚠️ 没有活跃 server 时**仍然**给一个 rankType / config：
        //    否则 `configs[0]` 一张表都读不到，页面连表头都画不出来（离线预览 / 新号）。
        //    但 `enabled` 仍为 false（见 enabledOf） ⇒ 入口 / 面板不显示，与老端一致。
        const fallbackRankType = configs.length > 0 ? configs[0].rankType : 0;
        const rankType = server ? server.id : fallbackRankType;
        const config = configOfRankType(configs, rankType);
        const celebrationId = celebrationIdOf(configs, rankType);
        const curValue = server ? server.curValue : 0;
        const targetInfos = server ? server.targetInfos : [];

        const targetArr = sortTargetsByState(
            targetsOf(targets, celebrationId),
            (subId) => stateBySubId(targets, celebrationId, subId, curValue, targetInfos),
        );

        const rankTime = rankTimeOf(rankTimes, rankType);
        const endTimeMs = rankTime ? rankTime.endTimeMs : 0;

        return {
            now: nowMs,
            configs,
            targets,
            ranks,
            shops,
            payRows: parsePayChannelRows(payRaw),
            items: parseItemRows(itemRaw),
            resources: parseRolePropertyRows(resRaw),
            rankTimes,
            server,
            config,
            rankType,
            celebrationId,
            curValue,
            targetArr,
            rankArr: ranksOf(ranks, celebrationId),
            shopArr: shopsOf(shops, celebrationId),
            rd: rdOf(ranks, targets, celebrationId, curValue, targetInfos),
            enabled: enabledOf(rankTime, server, nowMs),
            rankTime,
            endTimeMs,
            countdownOffsetMs: countdownOffsetOf(endTimeMs, nowMs),
        };
    }

    /** 领取庆典目标奖励。⚠️ `id` 是 `celebrationConfig.id`，不是 `rankType`（见 `RequestCelebrationMsg`）。 */
    async claimTargetReward(id: number, subId: number, caller?: object): Promise<CelebrationRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdCelebrationGetTargetRewardRspMsg): void => {
            // 老端 `ModelCelebration` L72：`FW.ShowReward(rsp.tlCmdGoods)` —— 与老端同一条路
            // （那层 Model 也是这么调的）。之前这里只置 `applied`、奖励明细被整个丢掉。
            //
            // ⚠️ 关于「Repository 不碰 UI」：这里调的 `FW.ShowReward` 是**可注入的全局出口**
            //    （`FW.showReward`，由组合根接成 `ShowRewardPage.open`），本文件**没有** import
            //    任何视图类、也不 import `cc` —— 与「页面自己 `Toast.show`」那条约定不冲突。
            // ⚠️ 空数组时 `ShowRewardPage` 会自己 `close()`，所以这里不判空 —— 判空反而会漏掉
            //    「响应到了但 `ts` 里确实没有 goods」这种情况（老端是 `length <= 0` 就 unload）。
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(
                net.send(new RequestCelebrationGetTargetReward({ id, subId }, caller, callback), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Celebration] 领取庆典目标奖励失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }

    /**
     * 购买限时特惠商品。
     *
     * 返回 `'pay'` = 服务端说「这一单要走支付 SDK」（`rsp.canRmb === true`）。
     * Demo3.8 没有 SDK ⇒ 页面提示 `CL_TEXTS.payUnavailable`，**不谎报成功**。
     *
     * ⚠️ 老端在发请求**之前**还会做一次「够不够钱」的前置校验（`CheckHaveEnoughCost`），
     * 那是页面的事（要弹框 / 要读 UI），Repository 不替它做。
     */
    async buyShopGoods(id: number, subId: number, caller?: object): Promise<CelebrationBuyResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        let needPay = false;
        const callback = (rsp: CmdCelebrationBuyShopGoodsRspMsg): void => {
            if (rsp?.canRmb) {
                needPay = true;
                return;
            }
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            const sent = await withTimeout(
                net.send(new RequestCelebrationBuyShop({ id, subId }, caller, callback), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[Celebration] 购买庆典商品失败', error);
            return 'failed';
        }
        if (needPay) return 'pay';
        return applied ? 'ok' : 'failed';
    }

    /**
     * 查详细排名（`CmdGetRankReqMsg`）。
     *
     * ⚠️ `unionId` 老端传的是**自己的 roleId**（`ModelRole.GetRole().GetCmd().id`），
     * 不是公会 id —— 形参名沿用了协议字段名。传空串服务端也能回，只是 `myRank` 为空。
     */
    async requestRank(
        rankType: number,
        showNum: number,
        unionId: string,
        caller?: object,
    ): Promise<ICelebrationRankDetail | null> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;

        let result: ICelebrationRankDetail | null = null;
        const callback = (rsp: CmdGetRankRspMsg): void => {
            const info = rsp?.rankInfo;
            if (!info) return;
            result = {
                myRank: toRankEntry(info.myRank),
                list: Array.isArray(info.rankList) ? info.rankList.map(toRankEntry) : [],
                region: typeof info.region === 'string' ? info.region : '',
            };
        };

        try {
            const sent = await withTimeout(
                net.send(
                    // ⚠️ `unionId` 是 `Long` ⇒ 用十进制字符串进。protobufjs 的 `fromObject`
                    //    对 long 字段走 `Long.fromValue(value)`，认字符串；直接传 number
                    //    在超过 `Number.MAX_SAFE_INTEGER` 时会**静默丢精度**（规则 23）。
                    new RequestGetRank(
                        { rankType: rankType as CmdRankType, showNum, unionId: unionId as any },
                        caller,
                        callback,
                    ),
                    false,
                ),
                READ_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return null;
        } catch (error) {
            console.warn('[Celebration] 查详细排名失败', error);
            return null;
        }
        return result;
    }
}

/** `CmdRankRole` → 裁剪视图（读不到 0 / 空串，不抛）。 */
function toRankEntry(role: CmdRankRole | null | undefined): ICelebrationRankEntry {
    if (!role) return { rank: 0, roleName: '', power: 0, usedSkinResId: 0 };
    return {
        // ⚠️ `rank` 可能是 `-1`（未上榜）—— **不要**在 `toRankEntry` 里抹成 0，
        //    否则 `CL_NOT_IN_RANK` 那条分支永远走不到（界面把未上榜显示成「第0名」）。
        rank: Number(role.rank) || 0,
        roleName: typeof role.roleName === 'string' ? role.roleName : '',
        power: toLongNumber(role.value),
        usedSkinResId: toLongNumber(role.usedSkinResId),
    };
}

/**
 * `Long` / `number` / `string` → number；认不出返回 0。
 *
 * ⚠️ 不能 `Number(long)` —— protobufjs 的 `Long` 转 number 会得到 `NaN`
 * （`Long` 没有 `valueOf` 到 number 的路径），`NaN` 参与算术会静默污染整条链路
 * （战力显示 `NaN`、名次判 `NaN === -1` 恒 false）。
 */
function toLongNumber(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    if (value && typeof value === 'object') {
        const long = value as { low?: number; high?: number };
        if (typeof long.low === 'number' && typeof long.high === 'number') {
            const n = long.high * 4294967296 + (long.low >>> 0);
            return Number.isFinite(n) ? n : 0;
        }
    }
    return 0;
}

export const celebrationRepository: ICelebrationRepository = new RuntimeCelebrationRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const CL_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const CL_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;

// ============================================================
// 快照上的便捷查询（要文案模板的那几个留在这里 ——
// 「判定进 Table、文案包装留 Repository」是家族约定，对齐 `HangRepository.adCountTextOf`）
// ============================================================

/** 庆典目标项的描述（`{0}达到{1}`）；`config` 缺失时属性名退到 `''`。 */
export function targetDescTextOf(snapshot: ICelebrationSnapshot, row: ICelebrationTargetRow): string {
    const name = snapshot.config ? snapshot.config.name : '';
    return conditionTextOf(name, row.count, CL_TEXTS.conditionText0);
}

/** 庆典排名项的战力要求（`{0}达{1}`）。 */
export function rankConditionTextOf(snapshot: ICelebrationSnapshot, row: ICelebrationRankRow): string {
    const name = snapshot.config ? snapshot.config.name : '';
    return conditionTextOf(name, row.count, CL_TEXTS.conditionText1);
}

/** 庆典目标页表头（`config.name + 要求`）；`config` 缺失时退到 FGUI 设计期初值。 */
export function propertyWantTextOf_(snapshot: ICelebrationSnapshot): string {
    if (!snapshot.config) return CL_TEXTS.colConditionFallback;
    return propertyWantTextOf(snapshot.config.name, CL_TEXTS.conditionTitle);
}

/** 庆典排名项的名次文案（`第1名` / `2-3名` / …）。 */
export function rankRowTextOf(row: ICelebrationRankRow): string {
    return rankTextOf(row.start, row.end);
}

/** 「我的名次」文案（`第{0}名` / `未上榜`）。 */
export function myRankValueTextOf(rank: number): string {
    return myRankTextOf(rank, CL_TEXTS.notInRank, CL_TEXTS.positionTemplate);
}

/** 限购文案（`限购{0}/{1}`）。 */
export function limitBuyTextOf_(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow): string {
    return limitBuyTextOf(buyCountOf(snapshot.server, row.subId), row.limit, CL_TEXTS.limitSaleTemplate);
}

/** 折扣文案（`5折`）。 */
export function saleTextOf_(row: ICelebrationShopRow): string {
    return saleTextOf(row.discount, CL_TEXTS.discountSuffix);
}

/** 商品卡的展示口径（含 rmb 分支的真实金额换算）。 */
export function shopPricingOf(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow): ICelebrationShopPricing {
    return pricingOf(row, snapshot.payRows);
}

/** 倒计时文案（`13:16:55后刷新`）；活动未开始 / 已结束时为 `00:00:00后刷新`。 */
export function countdownTextOf(snapshot: ICelebrationSnapshot, nowMs?: number): string {
    const now = nowMs ?? Date.now();
    const offset = countdownOffsetOf(snapshot.endTimeMs, now);
    return `${countdownHmsOf(offset)}${CL_TEXTS.countdownSuffix}`;
}

/** 奖励行用的奖励条（目标项 / 排名项各取一支；查不到返回空数组）。 */
export function rewardsOfTarget(row: ICelebrationTargetRow): readonly ICelebrationReward[] {
    return row.rewards;
}

/** 排名项的第一份奖励（老端 `renderRankListItem` 取 `data.rewards2[0]`）。 */
export function firstReward2Of(row: ICelebrationRankRow): ICelebrationReward | null {
    return row.rewards2.length > 0 ? row.rewards2[0] : null;
}

/** 奖励的展示信息（`item` 优先，回落 `roleProperty`；都查不到返回 `null`）。 */
export function goodsOf(snapshot: ICelebrationSnapshot, resId: number): ICelebrationGoodsInfo | null {
    return snapshot.items.get(resId) ?? snapshot.resources.get(resId) ?? null;
}

/**
 * 奖励图标的两支分流解析；解析不出返回 `null`（奖励格降级成只画品质框）。
 *
 * ⚠️ **不要**自己判 `item` / `roleProperty` —— 走 `LayerActivityArt.resolveRewardIconRef`
 * （唯一入口，与挂机 / 活动 / 礼包同一条）。
 */
export function rewardIconRefOf(
    snapshot: ICelebrationSnapshot,
    resId: number,
): { root: string; name: string } | null {
    return resolveRewardIconRef(goodsOf(snapshot, resId));
}

/** 奖励格的品质（查不到按 1；页面按品质选框）。 */
export function rewardQualityOf(snapshot: ICelebrationSnapshot, resId: number): number {
    return goodsOf(snapshot, resId)?.quality || 1;
}

/** 某个目标档的状态（页面驱动 prefab 控制器用）。 */
export function targetStateOf(
    snapshot: ICelebrationSnapshot,
    row: ICelebrationTargetRow,
): ECelebrationTargetRewardType {
    const infos = snapshot.server ? snapshot.server.targetInfos : [];
    return stateBySubId(snapshot.targets, snapshot.celebrationId, row.subId, snapshot.curValue, infos);
}

/** 排名档是否已达标（老端 `enough`；够不够「显示为已达标」那一页）。 */
export function rankReached(snapshot: ICelebrationSnapshot, row: ICelebrationRankRow): boolean {
    return rankReachedOf(snapshot.curValue, row.count);
}

/** 商品卡的分支（`rmb` / `cost`；页面驱动 `buyType` 用）。 */
export function shopBranchOf(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow): CelebrationPayBranch {
    return shopPricingOf(snapshot, row).branch;
}
