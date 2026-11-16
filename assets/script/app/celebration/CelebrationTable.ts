import type { IRewardAmount, IRewardGoodsInfo } from '../../core/types/Reward';
/**
 * 开服庆典的判定口径（老端 `VOCelebration` / `LayerOSRankUI` / `LayerOSRankDetailUI`）。
 * 与 `HangTable` / `GiftTable` / `SevenDayTable` 一样不 import 任何模块，判定逻辑可以直接在 Node 里跑单测；
 * 类型与枚举也放在本文件，不要再拆 `CelebrationTypes.ts`。
 *
 * 三个容易踩错的口径：
 * 1. `CmdCelebrationInfo.id` 是 `celebrationConfig.rankType`（`VOCelebration.GetRefConfig()` 按 rankType 反查），
 *    过滤 `celebrationTarget/Rank/Shop` 用的是反查出来的 `celebrationConfig.id`。两者混用只会静默得到空列表。
 * 2. 老端 `GetRd()` 外层遍历 `celebrationRank` 的 `subId`，内层 `GetStateBySubId` 查的却是 `celebrationTarget`。
 *    rank 的 subId 是 1..5、target 是 1..8，等价于只看 target 的前 5 档；这是老端原样，`rdOf` 照搬。
 * 3. `enabledOf` 顶的是老端 `ModelCelebration.Enabled()`。本工程没有 `ModelSystem` / 条件集那一层，
 *    只保留 `VarOSRankShow.OnComputeResult()` 的原始语义（落在 `CmdRankItem` 的 startTime~endTime 之间），
 *    因此比老端更宽：策划表达式另行关闭活动的那条路还没迁。
 *
 * 四张庆典表都是压缩表（`{k,v,c}`），解压由 `RefUtil` 的 `RefAsset` 完成，所以下面的 `parseXxxRows` 只洗对象行。
 */

import { parseRewardAmounts } from '../../core/table/RewardRows';
import { parseRows } from '../../core/table/RowParse';
import { parsePayChannelBaseRows } from '../common/PayChannelRows';
import type { IPayChannelBaseRow } from '../common/PayChannelRows';

// ============================================================
// 类型与枚举
// ============================================================

/**
 * 庆典目标项的三种状态。
 *
 * 值必须与老端 `ECelebrationTargetRewardType` 一致：FGUI 控制器 `状态` 的页序就是它
 * （`item1.xml` 的 `1,未领取,0,未达标,2,已完成`），prefab 按这个序号驱动显隐。
 */
export enum ECelebrationTargetRewardType {
    /** 可领取（老端 `Reward = 0`）。 */
    Reward = 0,
    /** 未完成（老端 `Unfinished = 1`）。 */
    Unfinished = 1,
    /** 已领取（老端 `Received = 2`）。 */
    Received = 2,
}

/** FGUI 主界面控制器 `页签` 的页序（`0,庆典目标,1,庆典排名,2,限时特惠`）。 */
export enum ECelebrationTab {
    Target = 0,
    Rank = 1,
    Shop = 2,
}

/** 名次分段（FGUI `item2` 控制器 `名次`：`0,第一名 / 1,2-3名 / 2,其他`）。 */
export enum ECelebrationRankSegment {
    First = 0,
    SecondThird = 1,
    Other = 2,
}

/** 商品卡的两个分支（FGUI `item3` 控制器 `buyType`：`0,rmb / 1,cost`）。 */
export type CelebrationPayBranch = 'rmb' | 'cost';

/** 一条奖励（`rewards` / `rewards1` / `rewards2` 的元素）。 */
export type ICelebrationReward = IRewardAmount;

/** `celebrationConfig` 一行。 */
export interface ICelebrationConfigRow {
    readonly id: number;
    readonly start: number;
    readonly end: number;
    readonly rankType: number;
    readonly name: string;
    readonly targetGroupId: number;
    readonly rankGroupId: number;
    readonly sellGroupId: number;
    readonly goto: number;
    readonly tips: string;
}

/** `celebrationTarget` 一行（庆典目标）。 */
export interface ICelebrationTargetRow {
    readonly id: number;
    readonly subId: number;
    readonly count: number;
    readonly rewards: readonly ICelebrationReward[];
}

/** `celebrationRank` 一行（庆典排名奖档）。 */
export interface ICelebrationRankRow {
    readonly id: number;
    readonly subId: number;
    readonly start: number;
    readonly end: number;
    readonly rewards1: readonly ICelebrationReward[];
    readonly count: number;
    readonly rewards2: readonly ICelebrationReward[];
}

/** `celebrationShop` 一行（限时特惠商品）。 */
export interface ICelebrationShopRow {
    readonly id: number;
    readonly subId: number;
    readonly name: string;
    readonly rewards: readonly ICelebrationReward[];
    /** 是 `payChannel.id`（不是元）；`0` 表示走 `costType` / `costCount` 货币购买。 */
    readonly rmb: number;
    readonly costType: number;
    readonly costCount: number;
    readonly limit: number;
    readonly price: number;
    readonly discount: number;
}

/** `payChannel` 里本模块用的字段；公共解析见 `common/PayChannelRows`。 */
export type ICelebrationPayChannelRow = IPayChannelBaseRow;

/** 服务器下发的庆典状态（`CmdCelebrationInfo`）。 */
export interface ICelebrationServerState {
    /** 是 rankType，不是 `celebrationConfig.id`；见文件头。 */
    readonly id: number;
    /** `curValue: Long` 已转 number（当前进度值）。 */
    readonly curValue: number;
    /** 下标 `subId - 1`；值为 1 表示该档已领。 */
    readonly targetInfos: readonly number[];
    /** 下标 `subId - 1`；值为已购买次数。 */
    readonly shopInfos: readonly number[];
}

/** `CmdRankItem` 里本模块用的时间字段（已换算成毫秒）。 */
export interface ICelebrationRankTime {
    /** `CmdRankItem.type` = `celebrationConfig.rankType`。 */
    readonly type: number;
    readonly startTimeMs: number;
    /** `(showEndTime || endTime) * 1000`（老端 `VORank.GetEndTime`）。 */
    readonly endTimeMs: number;
}

/** 商品卡的展示口径（`pricingOf` 的返回值）。 */
export interface ICelebrationShopPricing {
    readonly branch: CelebrationPayBranch;
    /** `lab_old_price`：原价，两个分支都会写。 */
    readonly oldPriceText: string;
    /** `lab_price`：rmb 分支是真实金额，cost 分支是 `costCount`。 */
    readonly priceText: string;
    /** `icon_cost` 的 `costType`；怎么解析成图标由页面交给 `LayerActivityArt.resolveRewardIconRef`。 */
    readonly costIconResId: number;
    /** `RmbSign3`（rmb 分支的 ￥）。 */
    readonly showRmbSign: boolean;
    /** `CostIcon2`（cost 分支的货币图标）。 */
    readonly showCostIcon: boolean;
}

/**
 * 一件道具 / 货币的展示信息。
 *
 * 与 activity 的 `IActivityGoodsInfo`、`common` 的资源行共用 core 的 `IRewardGoodsInfo` 形状，
 * `Map<IActivityGoodsInfo>` 可以直接赋给 `ReadonlyMap<ICelebrationGoodsInfo>`。
 */
export type ICelebrationGoodsInfo = IRewardGoodsInfo;

/** 一次刷新要的全部数据。 */
export interface ICelebrationSnapshot {
    readonly now: number;
    readonly configs: readonly ICelebrationConfigRow[];
    readonly targets: readonly ICelebrationTargetRow[];
    readonly ranks: readonly ICelebrationRankRow[];
    readonly shops: readonly ICelebrationShopRow[];
    readonly payRows: readonly ICelebrationPayChannelRow[];
    /** `item` 表（`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, ICelebrationGoodsInfo>;
    /** `roleProperty` 表（`iconIsPath = false`，货币 / 属性类在这里）。 */
    readonly resources: ReadonlyMap<number, ICelebrationGoodsInfo>;
    /** `rankType` → 时间窗（`CmdRankItem`）。 */
    readonly rankTimes: ReadonlyMap<number, ICelebrationRankTime>;
    /** 选中的那一行 `CmdCelebrationInfo`（选法见 `pickActiveServer`）；读不到为 `null`。 */
    readonly server: ICelebrationServerState | null;
    /** `rankType === snapshot.rankType` 的那一行；查不到为 `null`。 */
    readonly config: ICelebrationConfigRow | null;
    /** 当前庆典的 rankType（`server.id`；没有 server 时退到 `configs[0].rankType`）。 */
    readonly rankType: number;
    /** 当前庆典的 `celebrationConfig.id`（老端 `VOCelebration.GetId()`）；查不到为 0。 */
    readonly celebrationId: number;
    /** 当前进度值（`CmdCelebrationInfo.curValue`）；读不到为 0。 */
    readonly curValue: number;
    /** 庆典目标页的行（已按状态升序，老端 `GetTargetArr`）。 */
    readonly targetArr: readonly ICelebrationTargetRow[];
    /** 庆典排名页的行（表序，老端 `GetRankArr` 不排序）。 */
    readonly rankArr: readonly ICelebrationRankRow[];
    /** 限时特惠页的行（表序，老端 `GetShopArr` 不排序）。 */
    readonly shopArr: readonly ICelebrationShopRow[];
    /** 红点值（0 / 1，老端 `GetRd`）。 */
    readonly rd: number;
    /** 活动是否在时间窗内（口径见文件头第 3 条）。 */
    readonly enabled: boolean;
    /** 当前 rankType 的时间窗；读不到为 `null`。 */
    readonly rankTime: ICelebrationRankTime | null;
    /** `EndTime()`（毫秒）；读不到为 0。 */
    readonly endTimeMs: number;
    /** 倒计时用（`endTimeMs - 3e5 - now`，可能为负，页面按 0 显示）。 */
    readonly countdownOffsetMs: number;
}

/** 名次文案里 `data.rank = -1` 表示未上榜（老端 `RANK_POSITION_TEXT` / `Client_NotInRank`）。 */
export const CL_NOT_IN_RANK = -1;

/** 倒计时提前量：老端 `UpdateTime` 里的 `- 3e5`。 */
export const CL_COUNTDOWN_LEAD_MS = 3e5;

// ============================================================
// 基础工具
// ============================================================

/**
 * `unknown` → 数字；认不出返回 0。
 *
 * 压缩表解压后的值可能是字符串或 `undefined`，而 `Number(undefined)` 是 `NaN`，
 * `NaN` 参与比较恒为 false，会让「已达标」静默变成「未达标」。
 */
export function toCount(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/** `unknown` → 字符串；认不出返回 `''`。 */
export function toText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    return '';
}

/** 洗一条奖励数组（`{resId, number}`），`resId <= 0` 的项丢掉；number=0 保留（庆典的「仅展示」条目）。 */
export function parseRewards(raw: unknown): ICelebrationReward[] {
    return parseRewardAmounts(raw, { minNumber: 0 });
}

/** 一行原始数据的对象视图；不是对象返回 `null`。 */
function asRow(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}

/** 逐行洗表：非对象行跳过，`build` 返回 `null` 也算无效行。 */
/** 逐行洗表：非对象行跳过，`build` 返回 `null` 也算无效行。实现归位 `core/table/RowParse`。 */

// ============================================================
// 洗表
// ============================================================

/** 洗整张 `celebrationConfig`。 */
export function parseConfigRows(values: unknown): ICelebrationConfigRow[] {
    return parseRows(values, (r) => {
        const id = toCount(r.id);
        if (id <= 0) return null;
        return {
            id,
            start: toCount(r.start),
            end: toCount(r.end),
            rankType: toCount(r.rankType),
            name: toText(r.name),
            targetGroupId: toCount(r.targetGroupId),
            rankGroupId: toCount(r.rankGroupId),
            sellGroupId: toCount(r.sellGroupId),
            goto: toCount(r.goto),
            tips: toText(r.tips),
        };
    });
}

/** 洗整张 `celebrationTarget`。 */
export function parseTargetRows(values: unknown): ICelebrationTargetRow[] {
    return parseRows(values, (r) => {
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) return null;
        return { id, subId, count: toCount(r.count), rewards: parseRewards(r.rewards) };
    });
}

/** 洗整张 `celebrationRank`。 */
export function parseRankRows(values: unknown): ICelebrationRankRow[] {
    return parseRows(values, (r) => {
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) return null;
        return {
            id,
            subId,
            start: toCount(r.start),
            end: toCount(r.end),
            rewards1: parseRewards(r.rewards1),
            count: toCount(r.count),
            rewards2: parseRewards(r.rewards2),
        };
    });
}

/** 洗整张 `celebrationShop`。 */
export function parseShopRows(values: unknown): ICelebrationShopRow[] {
    return parseRows(values, (r) => {
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) return null;
        return {
            id,
            subId,
            name: toText(r.name),
            rewards: parseRewards(r.rewards),
            rmb: toCount(r.rmb),
            costType: toCount(r.costType),
            costCount: toCount(r.costCount),
            limit: toCount(r.limit),
            price: toCount(r.price),
            discount: toCount(r.discount),
        };
    });
}

/** 洗 `payChannel` 公共字段；本模块只保留旧导出名。 */
export function parsePayChannelRows(values: unknown): ICelebrationPayChannelRow[] {
    return parsePayChannelBaseRows(values);
}

/**
 * 洗 `CmdRankItem` 缓存 → `rankType` → 时间窗。
 *
 * 服务端下发的时间字段是秒，这里 ×1000。`endTimeMs` 取 `showEndTime || endTime`
 * （老端 `VORank.GetEndTime`），展示期常常比真实结束时间多留一段。
 */
export function parseRankTimes(values: unknown): Map<number, ICelebrationRankTime> {
    const map = new Map<number, ICelebrationRankTime>();
    if (!Array.isArray(values)) return map;
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const type = toCount(r.type);
        if (type <= 0) continue;
        const show = toCount(r.showEndTime);
        const end = toCount(r.endTime);
        map.set(type, {
            type,
            startTimeMs: toCount(r.startTime) * 1000,
            endTimeMs: (show || end) * 1000,
        });
    }
    return map;
}

/** 洗 `CmdCelebrationInfo` 缓存行。 */
export function parseServerStates(values: unknown): ICelebrationServerState[] {
    return parseRows(values, (r) => {
        const id = toCount(r.id);
        if (id <= 0) return null;
        return {
            id,
            curValue: toCount(r.curValue),
            targetInfos: Array.isArray(r.targetInfos) ? r.targetInfos.map(toCount) : [],
            shopInfos: Array.isArray(r.shopInfos) ? r.shopInfos.map(toCount) : [],
        };
    });
}

// ============================================================
// 取行 / 反查
// ============================================================

/** 按 `id` 过滤，保持表序。 */
function rowsOfId<T extends { readonly id: number }>(rows: readonly T[], id: number): T[] {
    const out: T[] = [];
    for (const row of rows) if (row.id === id) out.push(row);
    return out;
}

/** `celebrationConfig` 里 `rankType === rankType` 的那一行（老端 `GetRefConfig`）；查不到 `null`。 */
export function configOfRankType(
    configs: readonly ICelebrationConfigRow[],
    rankType: number,
): ICelebrationConfigRow | null {
    for (const row of configs) if (row.rankType === rankType) return row;
    return null;
}

/** `rankType` → `celebrationConfig.id`（老端 `VOCelebration.GetId`）；查不到 0。 */
export function celebrationIdOf(configs: readonly ICelebrationConfigRow[], rankType: number): number {
    return configOfRankType(configs, rankType)?.id ?? 0;
}

/** 过滤 `celebrationTarget`（老端 `GetTargetArr` 的过滤部分，不排序）。 */
export function targetsOf(rows: readonly ICelebrationTargetRow[], id: number): ICelebrationTargetRow[] {
    return rowsOfId(rows, id);
}

/** 过滤 `celebrationRank`（老端 `GetRankArr`）。 */
export function ranksOf(rows: readonly ICelebrationRankRow[], id: number): ICelebrationRankRow[] {
    return rowsOfId(rows, id);
}

/** 过滤 `celebrationShop`（老端 `GetShopArr`）。 */
export function shopsOf(rows: readonly ICelebrationShopRow[], id: number): ICelebrationShopRow[] {
    return rowsOfId(rows, id);
}

/** 取 `id + subId` 那一行（老端 `GetTargetRefBySubId` 走 `["id","subId"]` 复合键）；查不到 `null`。 */
export function targetOfSubId(
    rows: readonly ICelebrationTargetRow[],
    id: number,
    subId: number,
): ICelebrationTargetRow | null {
    for (const row of rows) if (row.id === id && row.subId === subId) return row;
    return null;
}

// ============================================================
// 目标状态 / 红点
// ============================================================

/**
 * 某一档庆典目标的状态（老端 `VOCelebration.GetStateBySubId`）：
 * `count <= currentValue` 时看 `targetInfos[subId-1]` 决定已领还是可领，否则未完成。
 *
 * `targetInfos` 的下标是 `subId - 1`，越界 / 缺失都当未领（老端 `undefined` 是 falsy）。
 * 查不到 `celebrationTarget` 那一行时退到 `Unfinished`：老端会抛 `TypeError`，
 * 这里按「配置缺失 = 做不了」处理，也不至于把 `GetTargetArr` 的排序整体带崩。
 */
export function stateBySubId(
    targets: readonly ICelebrationTargetRow[],
    id: number,
    subId: number,
    currentValue: number,
    targetInfos: readonly number[],
): ECelebrationTargetRewardType {
    const row = targetOfSubId(targets, id, subId);
    if (!row) return ECelebrationTargetRewardType.Unfinished;
    if (row.count > currentValue) return ECelebrationTargetRewardType.Unfinished;
    const got = toCount(targetInfos[subId - 1]) !== 0;
    return got ? ECelebrationTargetRewardType.Received : ECelebrationTargetRewardType.Reward;
}

/**
 * 红点值（老端 `VOCelebration.GetRd`）：任意一档可领取即 1。
 * 外层扫 `celebrationRank`、内层判 `celebrationTarget` 是老端原样，见文件头第 2 条。
 */
export function rdOf(
    ranks: readonly ICelebrationRankRow[],
    targets: readonly ICelebrationTargetRow[],
    id: number,
    currentValue: number,
    targetInfos: readonly number[],
): number {
    for (const row of ranks) {
        if (row.id !== id) continue;
        if (stateBySubId(targets, id, row.subId, currentValue, targetInfos) === ECelebrationTargetRewardType.Reward) {
            return 1;
        }
    }
    return 0;
}

/**
 * 按状态升序排（老端 `GetTargetArr` 的 sort）：可领取 → 未完成 → 已领取。
 * `Array.prototype.sort` 自 ES2019 起稳定，同状态内保持表序，与老端一致。返回新数组，不改入参。
 */
export function sortTargetsByState(
    rows: readonly ICelebrationTargetRow[],
    stateOf: (subId: number) => number,
): ICelebrationTargetRow[] {
    return rows.slice().sort((a, b) => stateOf(a.subId) - stateOf(b.subId));
}

// ============================================================
// 名次
// ============================================================

/**
 * 名次分段（老端 `renderRankListItem` 的三段 if）：`start === 1` 第一名，
 * `start >= 2 && end <= 3` 2-3 名，其余其他。老端第二段不是 `start === 2`，照原条件。
 */
export function rankSegmentOf(start: number, end: number): ECelebrationRankSegment {
    if (start === 1) return ECelebrationRankSegment.First;
    if (start >= 2 && end <= 3) return ECelebrationRankSegment.SecondThird;
    return ECelebrationRankSegment.Other;
}

/** 名次文案：`start === end` 时 `第N名`，否则 `N-M名`（不带「第」）。 */
export function rankTextOf(start: number, end: number): string {
    return start === end ? `第${start}名` : `${start}-${end}名`;
}

/** 「我的名次」文案：`rank === -1` 显示未上榜，否则套 `第{0}名` 模板。 */
export function myRankTextOf(rank: number, notInRankText: string, positionTemplate: string): string {
    if (rank === CL_NOT_IN_RANK) return notInRankText;
    return positionTemplate.replace('{0}', String(rank));
}

/** 排名档是否已达标（老端 `enough = voCelebration.GetValue() >= data.count`）。 */
export function rankReachedOf(currentValue: number, count: number): boolean {
    return currentValue >= count;
}

// ============================================================
// 文案
// ============================================================

/** `{n}` 占位符替换；越界的占位符原样保留，便于在界面上看出表填错了列数。 */
function fill(template: string, args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const i = Number(index);
        return Number.isInteger(i) && i >= 0 && i < args.length ? String(args[i]) : whole;
    });
}

/** 庆典目标项的描述（`SERVER_LAUNCH_RANKING_CONDITION_TEXT_0`：`{0}达到{1}`）。 */
export function conditionTextOf(propertyName: string, count: number, template: string): string {
    return fill(template, [propertyName, count]);
}

/** 庆典目标页表头（老端 `lab_proty1 = refConfig.name + SERVER_LAUNCH_RANKING_CONDITION_TITLE`）。 */
export function propertyWantTextOf(propertyName: string, titleSuffix: string): string {
    return `${propertyName}${titleSuffix}`;
}

/** 折扣文案（老端 `` `${data.discount / 100}折` ``）：`500 → 5折`、`150 → 1.5折`。 */
export function saleTextOf(discount: number, suffix: string): string {
    return `${discount / 100}${suffix}`;
}

/** 限购文案（`Client_LimitSale`：`限购{0}/{1}`）。 */
export function limitBuyTextOf(buyCount: number, limit: number, template: string): string {
    return fill(template, [buyCount, limit]);
}

/**
 * 商品的购买状态页（FGUI `购买状态`：`0,可购买 / 1,不可购买`）。
 * 老端是 `buyCount >= data.limit ? 1 : 0`，`limit` 为 0 时恒不可购买。
 */
export function purchaseStateOf(buyCount: number, limit: number): number {
    return buyCount >= limit ? 1 : 0;
}

/** 已购买次数（老端 `GetBuyCountBySubId`：`shopInfos[subId - 1] || 0`）。 */
export function buyCountOf(server: ICelebrationServerState | null, subId: number): number {
    if (!server) return 0;
    return toCount(server.shopInfos[subId - 1]);
}

/** `payChannel.id` → 真实金额（元）；查不到退化成 `rmbId`。 */
export function realRmbOf(payRows: readonly ICelebrationPayChannelRow[], rmbId: number): number {
    for (const row of payRows) if (row.id === rmbId) return row.rmb > 0 ? row.rmb : rmbId;
    return rmbId;
}

/**
 * 商品卡的支付分支（老端 `renderShopListItem` 的 `if (data.rmb) … else …`）。
 * rmb 分支：原价 `data.price`、现价 `payChannel.rmb`、显示 ￥；
 * cost 分支：原价 `data.price`、现价 `data.costCount`、显示货币图标。
 *
 * `data.rmb` 是 `payChannel.id` 不是元，价格必须过一次 `realRmbOf`。
 * 老端 `setText(data.price)` 传的是 number（FGUI 自己转字符串），这里显式 `String()`。
 */
export function pricingOf(
    row: ICelebrationShopRow,
    payRows: readonly ICelebrationPayChannelRow[],
): ICelebrationShopPricing {
    if (row.rmb > 0) {
        return {
            branch: 'rmb',
            oldPriceText: String(row.price),
            priceText: String(realRmbOf(payRows, row.rmb)),
            costIconResId: 0,
            showRmbSign: true,
            showCostIcon: false,
        };
    }
    return {
        branch: 'cost',
        oldPriceText: String(row.price),
        priceText: String(row.costCount),
        costIconResId: row.costType,
        showRmbSign: false,
        showCostIcon: true,
    };
}

// ============================================================
// 时间
// ============================================================

/**
 * 排名是否处在活动期内（老端 `VORank.Actived`）：`now` 落在 `[startTime, endTime]`。
 * `startTime <= 0`（服务端还没推或推了 0）一律 false。
 */
export function rankActiveOf(time: ICelebrationRankTime | null, nowMs: number): boolean {
    if (!time) return false;
    if (time.startTimeMs <= 0) return false;
    return nowMs >= time.startTimeMs && nowMs <= time.endTimeMs;
}

/**
 * `enabled` 口径（替代老端 `ModelCelebration.Enabled`）：在时间窗内且有 server 行。
 * 老端第二个条件是 `VOCelebrationBag.GetFirstOne() != null`，而 `GetFirstOne` 本身只返回 `Actived()` 的 VO。
 */
export function enabledOf(
    rankTime: ICelebrationRankTime | null,
    server: ICelebrationServerState | null,
    nowMs: number,
): boolean {
    if (!server) return false;
    return rankActiveOf(rankTime, nowMs);
}

/**
 * 倒计时偏移（老端 `LayerOSRankUI.UpdateTime`）：`EndTime() - 3e5 - now`。
 * 老端是「减」5 分钟，所以活动最后 5 分钟这个值就是负数，页面按 0 显示；
 * 这里不钳制，`UpdateTime` 的判据是「归零即停」。
 */
export function countdownOffsetOf(endTimeMs: number, nowMs: number): number {
    return endTimeMs - CL_COUNTDOWN_LEAD_MS - nowMs;
}

// ============================================================
// 选中哪一行 server（老端 `VOCelebrationBag.GetFirstOne`）
// ============================================================

/**
 * 从 `CmdCelebrationInfo` 里选出第一行处于活动期的。
 *
 * 服务端会同时下发多个庆典，取第一行会在旧庆典过期后展示错的那一个，而且不报错。
 * 一个活跃的都没有就返回 `null`，入口和面板都不显示。
 */
export function pickActiveServer(
    servers: readonly ICelebrationServerState[],
    rankTimes: ReadonlyMap<number, ICelebrationRankTime>,
    nowMs: number,
): ICelebrationServerState | null {
    for (const s of servers) {
        if (rankActiveOf(rankTimes.get(s.id) ?? null, nowMs)) return s;
    }
    return null;
}

/**
 * 数字缩写（老端 `StringUtil.numAbbr`）：`>= 1e10` 取 G、`>= 1e7` 取 M、`>= 1e4` 取 k，其余取 floor，
 * 阈值判断走绝对值，`k` 是小写。
 *
 * 不要换成 `StringUtil.formatNumberToKMBT`：后者是 T/B/M/K 四档，分母差 1000 倍，
 * 同一战力会显示成两个数。详细排行那行战力走的是 `numAbbr`。
 */
export function numAbbrOf(value: number): string {
    const n = Number.isFinite(value) ? value : 0;
    const abs = Math.abs(n);
    if (abs >= 1e10) return `${Math.floor(n / 1e9)}G`;
    if (abs >= 1e7) return `${Math.floor(n / 1e6)}M`;
    if (abs >= 1e4) return `${Math.floor(n / 1e3)}k`;
    return `${Math.floor(n)}`;
}

/** 两段补零。 */
function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * `HH:MM:SS` 倒计时文案（老端 `TimeUtil.timeMillisecond2HMSStr(ms)`，
 * 内部是 `timeSec2HMSStr(Math.ceil(ms * 0.001))`）。
 *
 * 秒数要进位，用 `Math.ceil` 不是截断：`3_599_999ms` 应显示 `01:00:00`。
 * 与 `HangTable.formatHms` 是同一实现的两份副本，各模块自持一份。这里把负数钳到 0
 * （老端没有这个钳制，最后 5 分钟会输出 `0-1:0-1:0-59` 这类垃圾，是有意修正）。
 */
export function countdownHmsOf(ms: number): string {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
