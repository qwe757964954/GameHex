import type { INetRequestStatus } from '../../core/types/NetResult';
/**
 * 开服庆典的数据端口（老端 `LayerOSRankUI` / `LayerOSRankDetailUI` + FGUI 包「开服冲榜」）。
 *
 * 与 `HangRepository` / `GiftRepository` / `SevenDayRepository` 一套分层：页面只依赖本文件，
 * 判定逻辑都在零 import 的 `CelebrationTable`，这里只负责读表、读缓存、发请求。
 *
 * 数据来源：
 * - `celebrationConfig`（压缩表）：`rankType` ↔ `id`、`name`、`goto`、`tips`
 * - `celebrationTarget` / `celebrationRank` / `celebrationShop`：目标门槛与奖励、排名奖档、限时特惠商品
 * - `payChannel`：`celebrationShop.rmb` → 真实金额
 * - `item` / `roleProperty`：奖励与货币图标（经 `resolveRewardIconRef` 分流）
 * - `CacheMgr.getTlCmdCelebrationInfo()`：进度值与已领 / 已购次数
 * - `CacheMgr.getTlCmdRankItem()`：活动时间窗（秒）
 *
 * `CmdCelebrationInfo` / `CmdRankItem` 都在 `protoCache.json` 登记着，服务端会推，`GameNet` 收包时写进缓存，
 * 所以 `load()` 每次现读，不自己存快照。庆典没有「查询」请求，缓存空就按空渲染，不要造一个假请求。
 * 只有详细排名要查：`CmdGetRankReqMsg`，见 `requestRank()`。
 *
 * `server.id` 是 rankType，`config.id` 才是过滤三张子表的键，两者混用不会报错、只是列表全空。
 *
 * 支付链路只做到业务前置请求：老端拿到 `rsp.canRmb === true` 后走 `SDKMgr.pay`，本工程没有支付 SDK，
 * 因此把结果原样交回页面提示「支付暂未接入」，不假装成功。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { readRefRows } from '../common/TableRead';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { toIdString, withTimeout } from '../net/RequestGuard';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import { resolveRewardIconRef } from '../activity/LayerActivityArt';
import {
    buyCountOf,
    celebrationIdOf,
    configOfRankType,
    conditionTextOf,
    countdownHmsOf,
    countdownOffsetOf,
    enabledOf,
    limitBuyTextOf,
    myRankTextOf,
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
    rankTextOf,
    ranksOf,
    rdOf,
    saleTextOf,
    shopsOf,
    sortTargetsByState,
    stateBySubId,
    targetsOf,
} from './CelebrationTable';
import type {
    ECelebrationTargetRewardType,
    ICelebrationGoodsInfo,
    ICelebrationRankRow,
    ICelebrationRankTime,
    ICelebrationServerState,
    ICelebrationShopPricing,
    ICelebrationShopRow,
    ICelebrationSnapshot,
    ICelebrationTargetRow,
} from './CelebrationTable';
import { CL_TEXTS } from './CelebrationTexts';
import { RequestCelebrationBuyShop, RequestCelebrationGetTargetReward } from './RequestCelebrationMsg';
import { RequestGetRank } from '../generated/requestMsg/RequestRankMsg';

// 判定与格式化都在零 import 的 `CelebrationTable`，这里转出一部分，页面只 import 本文件。
export { CL_NOT_IN_RANK, buyCountOf, numAbbrOf, purchaseStateOf } from './CelebrationTable';
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
} from './CelebrationTable';

/** 三个页签的个数（FGUI 控制器 `页签` 的页数）。 */
export const CL_TAB_COUNT = 3;

/** 请求结果 —— 与挂机 / 战令 / 礼包同口径。 */
export type CelebrationRequestResult = INetRequestStatus;

/** 买商品的结果：多了「服务端说这一单要走支付 SDK」这一支。 */
export type CelebrationBuyResult = CelebrationRequestResult | 'pay';

/** 请求超时（与全家族同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
const readRows = (table: string): Promise<unknown[]> => readRefRows(RefUtil.instance, table);

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
 * 取自己的 roleId（十进制字符串）。
 *
 * 只给详细排名的 `CmdGetRankReqMsg.unionId` 用：那个字段名沿用协议里的 union，老端传的是
 * 自己的 roleId（`ModelRole.GetRole().GetCmd().id`），不是公会 id。
 * `CmdRole` 是单行表，取第一行即可（与 `FriendRepository.readRole` / `HangRepository` 同一处置）；
 * 读不到返回空串，服务端照样回包，只是 `myRank` 为空。
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
    /** 读表 + 读缓存，组装一次快照；不发任何请求。 */
    load(nowMs?: number): Promise<ICelebrationSnapshot>;
    /** 领取庆典目标奖励（`CmdCelebrationGetTargetRewardReqMsg`，返回 `tlCmdGoods`）。 */
    claimTargetReward(id: number, subId: number, caller?: object): Promise<CelebrationRequestResult>;
    /** 购买限时特惠商品（`CmdCelebrationBuyShopGoodsReqMsg`）。 */
    buyShopGoods(id: number, subId: number, caller?: object): Promise<CelebrationBuyResult>;
    /** 查详细排名（`CmdGetRankReqMsg`）；这是查询，回包才有数据，读超时用 800ms。 */
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

        const rankTimes = readRankTimes();
        const server = pickActiveServer(readServers(), rankTimes, nowMs);

        // 没有活跃 server 时仍给一个 rankType / config，否则页面连表头都画不出来（离线预览 / 新号）。
        // `enabled` 此时仍为 false，入口和面板不显示，与老端一致。
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

        const rankTime = rankTimes.get(rankType) ?? null;
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

    /** 领取庆典目标奖励。`id` 是 `celebrationConfig.id`，不是 rankType（见 `RequestCelebrationMsg`）。 */
    async claimTargetReward(id: number, subId: number, caller?: object): Promise<CelebrationRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdCelebrationGetTargetRewardRspMsg): void => {
            // 老端 `ModelCelebration` 也是这么调的。`FW.ShowReward` 是可注入的全局出口（组合根接成
            // `ShowRewardPage.open`），本文件不 import 视图类也不 import cc，与「页面自己 Toast」那条约定不冲突。
            // 空数组时 `ShowRewardPage` 会自己关闭，这里不判空。
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        };

        try {
            // `GameNet.send` 没有按请求的超时，服务端不回就永悬，必须包一层。
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
     * 返回 `'pay'` 表示服务端要求走支付 SDK（`rsp.canRmb === true`），由页面提示
     * `CL_TEXTS.payUnavailable`，不谎报成功。
     * 「钱够不够」的前置校验归页面（要弹框、要读 UI），Repository 不做。
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
     * `unionId` 老端传的是自己的 roleId，不是公会 id，形参名沿用了协议字段名；
     * 传空串服务端也能回，只是 `myRank` 为空。
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
                    // `unionId` 是 Long，protobufjs 的 fromObject 认十进制字符串；直接传 number
                    // 在超过 MAX_SAFE_INTEGER 时会静默丢精度。
                    new RequestGetRank({ rankType: rankType as CmdRankType, showNum, unionId }, caller, callback),
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

/** `CmdRankRole` → 裁剪视图（读不到给 0 / 空串，不抛）。 */
function toRankEntry(role: CmdRankRole | null | undefined): ICelebrationRankEntry {
    if (!role) return { rank: 0, roleName: '', power: 0, usedSkinResId: 0 };
    return {
        // `rank` 可能是 -1（未上榜），不要在这里抹成 0，否则 `CL_NOT_IN_RANK` 那条分支永远走不到。
        rank: Number(role.rank) || 0,
        roleName: typeof role.roleName === 'string' ? role.roleName : '',
        power: toLongNumber(role.value),
        usedSkinResId: toLongNumber(role.usedSkinResId),
    };
}

/**
 * `Long` / `number` / `string` → number；认不出返回 0。
 *
 * 不能直接 `Number(long)`：protobufjs 的 `Long` 走不到 number，会得到 `NaN`，
 * 之后战力显示 `NaN`、名次判 `NaN === -1` 恒 false。
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

// ============================================================
// 快照上的便捷查询
// 判定进 Table，带文案模板的包装留在这里（对齐 `HangRepository.adCountTextOf`）。
// ============================================================

/** 庆典目标项的描述（`{0}达到{1}`）；`config` 缺失时属性名退到空串。 */
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
export function targetHeaderTextOf(snapshot: ICelebrationSnapshot): string {
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
export function shopLimitTextOf(snapshot: ICelebrationSnapshot, row: ICelebrationShopRow): string {
    return limitBuyTextOf(buyCountOf(snapshot.server, row.subId), row.limit, CL_TEXTS.limitSaleTemplate);
}

/** 折扣文案（`5折`）。 */
export function shopSaleTextOf(row: ICelebrationShopRow): string {
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

/** 奖励的展示信息（`item` 优先，回落 `roleProperty`；都查不到返回 `null`）。 */
export function goodsOf(snapshot: ICelebrationSnapshot, resId: number): ICelebrationGoodsInfo | null {
    return snapshot.items.get(resId) ?? snapshot.resources.get(resId) ?? null;
}

/**
 * 奖励图标的两支分流解析；解析不出返回 `null`（奖励格降级成只画品质框）。
 * 统一走 `LayerActivityArt.resolveRewardIconRef`，不要自己判 `item` / `roleProperty`。
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

/** 排名档是否已达标（老端 `enough`，驱动「已达标」那一页的颜色）。 */
export function isRankReached(snapshot: ICelebrationSnapshot, row: ICelebrationRankRow): boolean {
    return rankReachedOf(snapshot.curValue, row.count);
}
