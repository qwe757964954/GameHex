/**
 * 礼包商店的数据口径。纯函数、无引擎依赖，可直接在 Node 单测中运行。
 *
 * 关键约定：
 * - `giftShop.type` 决定子页签；`desc` 是商品名，`title` 只是分组名。
 * - `priceType = 10` 对应 `roleProperty.coin`，界面统一称“幻灵玉”。
 * - `item` 表主键是 `resId`；货币档 7/8/9/10 的图走 `image/main/resbar`。
 *
 * 子页签由 `GIFT_SUB_TAB_ORDER` 与表内实际数据取交集，不跟随表行顺序。
 */

/** 一条奖励：`{ resId, number }`。 */
export interface IGiftReward {
    readonly resId: number;
    readonly number: number;
}

/** 配置表 `giftShop` 的一行（归一化后）。 */
export interface IGiftShopRow {
    /** 请求 `CmdShopBuy` 时传的 `id`。 */
    readonly id: number;
    /** `1` 每日 / `2` 周常 / `3` 月度 / `4` 终身（= 老端 `GiftType`）。 */
    readonly type: number;
    /** 二级分组；**只有 `type = 4`（终身）用**（`1..6` = 六个系别）。其余恒 `1`。 */
    readonly type2: number;
    /** 分组名（只有每个 `type` 的首行有值，如「每日福利」）；**不是商品名**。 */
    readonly title: string;
    /** 商品名 —— 行标题显示的就是它。 */
    readonly desc: string;
    readonly rewards: readonly IGiftReward[];
    /** 货币 `resId`；`10` = 幻灵玉（`roleProperty.coin`）。 */
    readonly priceType: number;
    /** 实付数量；`0` = 免费。 */
    readonly cost: number;
    /** 限购次数；`0` = 不限购。 */
    readonly limit: number;
    /** 折扣（十分制的「几折」）：`0` = 不打折；`5` → 「5折」。表里实测取值 `0~7`。 */
    readonly discount: number;
}

/** 配置表 `payChannel` 的一行（归一化后）。 */
export interface IPayChannelRow {
    /** 请求支付时传的 `id`（老端 `SDKMgr.pay(ref.id, "common", 0)`）。 */
    readonly id: number;
    readonly key: string;
    readonly type: number;
    readonly name: string;
    /** 人民币价格（元）。 */
    readonly rmb: number;
    readonly productid: number;
    /** 到账数量。 */
    readonly coin: number;
    /** 首次购买的额外赠送数量。 */
    readonly coin2: number;
    /** 老端图标名 —— Demo3.8 里没落这套图，**不用它**，界面按 `gf_icon_stone` 统一画。 */
    readonly path: string;
    /** `1` 才在灵玉直冲页显示（全表只有 6 行是 `1`）。 */
    readonly isShow: number;
}

/** 商品行三态（对应 FGUI `状态` 控制器的三个 page）。 */
export type GiftShopState = 'free' | 'buyable' | 'soldOut';

/** `CmdShopType.gift` —— 礼包商店的类型号（协议里是 enum，这里收成常量以免依赖生成代码）。 */
export const GIFT_SHOP_TYPE = 5;

/** 老端 `GiftType`。 */
export const GIFT_TYPE_DAILY = 1;
export const GIFT_TYPE_WEEK = 2;
export const GIFT_TYPE_MONTH = 3;
export const GIFT_TYPE_ONCE = 4;

/**
 * 「超值礼包」页开启的子页签（按 `type` 排序）。
 *
 * `416` 终身礼包、`417` 连充礼包在 `open.json` 中未开启，因此不列入。
 */
export const GIFT_SUB_TAB_ORDER: readonly number[] = [
    GIFT_TYPE_DAILY,
    GIFT_TYPE_WEEK,
    GIFT_TYPE_MONTH,
];

/** 一个子页签的展示信息。 */
export interface IGiftSubTab {
    /** `giftShop.type`。 */
    readonly type: number;
    readonly name: string;
    /** 页签标题图在 `GiftArt` 里的键（`daily` / `week` / `month` / `once`）。 */
    readonly artKey: string;
}

/** `type` → 页签展示信息。表里没有的号返回 `null`。 */
export function giftSubTabOf(type: number): IGiftSubTab | null {
    switch (type) {
        case GIFT_TYPE_DAILY:
            return { type, name: '每日礼包', artKey: 'daily' };
        case GIFT_TYPE_WEEK:
            return { type, name: '周常礼包', artKey: 'week' };
        case GIFT_TYPE_MONTH:
            return { type, name: '月度礼包', artKey: 'month' };
        case GIFT_TYPE_ONCE:
            return { type, name: '终身礼包', artKey: 'once' };
        default:
            return null;
    }
}

/**
 * 实际显示的子页签：`GIFT_SUB_TAB_ORDER` 中表内有数据的项。
 *
 * 顺序固定按 `GIFT_SUB_TAB_ORDER`，不随配置表行序变化。
 */
export function listSubTabs(rows: readonly IGiftShopRow[]): readonly IGiftSubTab[] {
    const present = new Set<number>();
    for (const row of rows) present.add(row.type);

    const tabs: IGiftSubTab[] = [];
    for (const type of GIFT_SUB_TAB_ORDER) {
        if (!present.has(type)) continue;
        const tab = giftSubTabOf(type);
        if (tab) tabs.push(tab);
    }
    return tabs;
}

/** 取某个子页签下的全部商品（保持表里的行序）。 */
export function listGiftOfType(
    rows: readonly IGiftShopRow[],
    type: number,
): readonly IGiftShopRow[] {
    return rows.filter((row) => row.type === type);
}

// ============================================================
// 表行解析
// ============================================================

function asNumber(value: unknown, fallback: number = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** 奖励数组：老端存 `{ resId, number }`，`resId <= 0` 或数量为 0 的条目丢掉。 */
function parseRewards(value: unknown): readonly IGiftReward[] {
    if (!Array.isArray(value)) return [];
    const out: IGiftReward[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const raw = item as Record<string, unknown>;
        const resId = asNumber(raw.resId);
        const number = asNumber(raw.number);
        if (resId <= 0 || number <= 0) continue;
        out.push({ resId, number });
    }
    return out;
}

/** 解析 `giftShop` 一行；`id` 非法或缺 `desc` 时返回 `null`（跳过该行）。 */
export function parseGiftShopRow(raw: unknown): IGiftShopRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;

    const id = asNumber(row.id);
    if (id <= 0) return null;

    const type = asNumber(row.type);
    if (type <= 0) return null;

    const desc = asString(row.desc);
    // `desc` 是行标题唯一来源，没有它就画不出东西 —— 直接判非法，别产出空行。
    if (!desc) return null;

    return {
        id,
        type,
        type2: asNumber(row.type2, 1),
        title: asString(row.title),
        desc,
        rewards: parseRewards(row.rewards),
        priceType: asNumber(row.priceType),
        cost: asNumber(row.cost),
        limit: asNumber(row.limit),
        discount: asNumber(row.discount),
    };
}

/** 批量解析 `giftShop`；非法行跳过，**不抛异常**。 */
export function parseGiftShopRows(rows: readonly unknown[]): readonly IGiftShopRow[] {
    const out: IGiftShopRow[] = [];
    for (const raw of rows) {
        const row = parseGiftShopRow(raw);
        if (row) out.push(row);
    }
    return out;
}

/** 解析 `payChannel` 一行；`id` / `rmb` 非法时返回 `null`。 */
function parsePayChannelRow(raw: unknown): IPayChannelRow | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;

    const id = asNumber(row.id);
    if (id <= 0) return null;

    const rmb = asNumber(row.rmb);
    if (rmb <= 0) return null;

    return {
        id,
        key: asString(row.key),
        type: asNumber(row.type),
        name: asString(row.name),
        rmb,
        productid: asNumber(row.productid),
        coin: asNumber(row.coin),
        coin2: asNumber(row.coin2),
        path: asString(row.path),
        isShow: asNumber(row.isShow),
    };
}

/** 批量解析 `payChannel`。 */
export function parsePayChannelRows(rows: readonly unknown[]): readonly IPayChannelRow[] {
    const out: IPayChannelRow[] = [];
    for (const raw of rows) {
        const row = parsePayChannelRow(raw);
        if (row) out.push(row);
    }
    return out;
}

/**
 * 灵玉直冲页要显示的档位：只留 `isShow === 1`，按 `rmb` 升序。
 * `payChannel` 有数百行，但 `isShow` 只有 6 行为 `1`。
 */
export function visiblePayChannels(
    rows: readonly IPayChannelRow[],
): readonly IPayChannelRow[] {
    return rows
        .filter((row) => row.isShow === 1)
        .sort((a, b) => a.rmb - b.rmb || a.id - b.id);
}

// ============================================================
// 状态与文案
// ============================================================

/**
 * 商品行的三态。
 *
 * 语义照 `SubTabSpecialGiftBase.InitList()`：
 *   - `limit > 0 && buyTimes >= limit` → **售罄**（优先判，售罄时不再看 `cost`）
 *   - 否则 `cost > 0` → **可购买**；`cost === 0` → **免费**
 */
export function giftShopStateOf(row: IGiftShopRow, buyTimes: number): GiftShopState {
    const bought = Number.isFinite(buyTimes) && buyTimes > 0 ? buyTimes : 0;
    if (row.limit > 0 && bought >= row.limit) return 'soldOut';
    return row.cost > 0 ? 'buyable' : 'free';
}

/**
 * 折扣文案；`discount <= 0` 或 `>= 10` 时返回空串。
 * 表内取值为 `0~7`，`1~7` 都应显示。
 */
export function discountTextOf(discount: number): string {
    if (!Number.isFinite(discount)) return '';
    if (discount <= 0 || discount >= 10) return '';
    return `${discount}折`;
}

/** 限购文案；`limit <= 0` 时返回空串（= 不限购，不显示）。 */
export function limitTextOf(buyTimes: number, limit: number): string {
    if (!Number.isFinite(limit) || limit <= 0) return '';
    const bought = Number.isFinite(buyTimes) && buyTimes > 0 ? buyTimes : 0;
    return `限购 ${bought}/${limit}`;
}

/**
 * 商品行排序：还能买的在前，同组按 `id` 升序。
 */
export function sortGiftRows(
    rows: readonly IGiftShopRow[],
    buyTimesOf: (id: number) => number,
): readonly IGiftShopRow[] {
    return rows.slice().sort((a, b) => {
        const soldA = a.limit > 0 && buyTimesOf(a.id) >= a.limit;
        const soldB = b.limit > 0 && buyTimesOf(b.id) >= b.limit;
        if (soldA !== soldB) return soldA ? 1 : -1;
        return a.id - b.id;
    });
}

/** 人民币价格文案：`6` → `¥6`。 */
export function payPriceText(rmb: number): string {
    if (!Number.isFinite(rmb) || rmb <= 0) return '';
    // 整数不显示小数点（表里全是整数；留这个分支是防策划填 6.5 之类）
    return Number.isInteger(rmb) ? `¥${rmb}` : `¥${rmb.toFixed(2)}`;
}

/** 灵玉档位到账文案：`60` → `60`（纯数字，单位由图/标题表达）。 */
export function payCoinText(coin: number): string {
    if (!Number.isFinite(coin) || coin <= 0) return '0';
    return `${Math.floor(coin)}`;
}

/**
 * 把服务端 `CmdShop`（`unknown` 形状）收敛成 `id → 已购次数`。
 *
 * `CmdShop.tlCmdShopGoods` 是 `CmdShopGoods[]`，每项 `{ id, buyTimes, ... }`。
 * 缺字段 / 非法行一律跳过 —— 宁可少显示已购次数，也不要让整页渲染不出来。
 */
export function normalizeShopGoods(shop: unknown): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    if (!shop || typeof shop !== 'object') return out;

    const list = (shop as Record<string, unknown>).tlCmdShopGoods;
    if (!Array.isArray(list)) return out;

    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const id = asNumber(row.id);
        if (id <= 0) continue;
        out.set(id, Math.max(0, asNumber(row.buyTimes)));
    }
    return out;
}

// ============================================================
// `item` 表（奖励图标 / 品质）
// ============================================================

/**
 * `item` 表里礼包用得到的字段。
 *
 * 主键列是 `resId`，不是 `id`。用错列不会报错，只会让奖励格全部查不到图。
 */
export interface IGiftItemInfo {
    readonly resId: number;
    readonly name: string;
    /** `item.icon` 原样带出（2026-09-23 起是相对 `assets/resources/` 的资源路径）。 */
    readonly icon: string;
    readonly quality: number;
}

/** 解析 `item` 表一行；`resId` 非法时返回 `null`。 */
function parseGiftItemRow(raw: unknown): IGiftItemInfo | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = asNumber(row.resId);
    if (resId <= 0) return null;
    return {
        resId,
        name: asString(row.name),
        icon: asString(row.icon),
        quality: asNumber(row.quality, 1),
    };
}

/** 批量解析 `item` 表（`resId` 去重，先出现的胜）。 */
export function parseGiftItemRows(rows: readonly unknown[]): ReadonlyMap<number, IGiftItemInfo> {
    const out = new Map<number, IGiftItemInfo>();
    for (const raw of rows) {
        const row = parseGiftItemRow(raw);
        if (row && !out.has(row.resId)) out.set(row.resId, row);
    }
    return out;
}

/** `priceType` 的货币 id：`10` = `roleProperty.coin`，界面称“幻灵玉”。 */
export const GIFT_CURRENCY_RES_ID = 10;

/**
 * 需要单独取图的货币档：灵石 / 铜币 / 体力 / 幻灵玉。
 *
 * 这些档位不在 `item` 表中，图统一放在 `image/main/resbar/`。
 */
export const GIFT_RESOURCE_ICON_IDS: readonly number[] = [6, 7, 9, 10];

// ============================================================
// 展示组合（纯函数，页面直接拿去铺 UI）
// ============================================================

/** 购买按钮的文案 + 要不要画货币图标。 */
export interface IGiftBuyButton {
    readonly text: string;
    /** `true` 时按钮文案是**裸数字**、货币靠左边的小图标表达（老端就是这套）。 */
    readonly showIcon: boolean;
}

export interface IGiftBuyButtonOptions {
    /** 「免费」两个字（来自 `GiftTexts`，避免本文件依赖文案表）。 */
    readonly freeText: string;
    /** 货币名 —— 只在拿不到货币图标时才会被拼进文案。 */
    readonly currencyName: string;
    /** 货币图标是否加载成功。 */
    readonly hasCurrencyIcon: boolean;
}

/**
 * 购买按钮怎么画。
 *
 * 老端 `SubTabSpecialGiftBase.InitList()`：
 *   `cost > 0` → `btn_buy.免费 = 否`，`btn_buy.title = cost`（**裸数字**）+ 货币图标
 *   `cost == 0` → `btn_buy.免费 = 是`（只显示「免费」）
 * 售罄时整个按钮被 `gearDisplay` 藏掉，所以这里不管售罄态。
 *
 * Demo3.8 不保证一定拿得到货币图标，所以补一条降级：拿不到就写「60幻灵玉」。
 */
export function giftBuyButtonOf(
    row: IGiftShopRow,
    buyTimes: number,
    options: IGiftBuyButtonOptions,
): IGiftBuyButton {
    if (giftShopStateOf(row, buyTimes) === 'free') {
        return { text: options.freeText, showIcon: false };
    }
    if (options.hasCurrencyIcon) return { text: String(row.cost), showIcon: true };
    return { text: `${row.cost}${options.currencyName}`, showIcon: false };
}

/** 灵玉直冲页要铺的一张卡。 */
export interface IGiftLingYuCard {
    readonly row: IPayChannelRow;
    /** `CmdRole.tlExtraId` 里**没有**本档位 ⇒ 首充双倍还没用掉。 */
    readonly firstBuy: boolean;
}

/**
 * 灵玉直冲页的卡片列表：`isShow === 1` 的档位 + 首充标记。
 *
 * 首充口径照老端 `VORole.CheckIsFirstBuy(payChannelId)` —— **没买过才算 true**：
 *   `return tlExtraId.indexOf(payChannelId) == -1`
 */
export function listLingYuCards(
    rows: readonly IPayChannelRow[],
    paidChannelIds: ReadonlySet<number> = new Set<number>(),
): readonly IGiftLingYuCard[] {
    return visiblePayChannels(rows).map((row) => ({
        row,
        firstBuy: !paidChannelIds.has(row.id),
    }));
}

/** 从 `CmdRole.tlExtraId` 收敛出「已买过的档位 id 集合」；形状不对返回空集。 */
export function normalizePaidChannelIds(role: unknown): ReadonlySet<number> {
    const out = new Set<number>();
    if (!role || typeof role !== 'object') return out;
    const list = (role as Record<string, unknown>).tlExtraId;
    if (!Array.isArray(list)) return out;
    for (const id of list) {
        const value = asNumber(id);
        if (value > 0) out.add(value);
    }
    return out;
}

/**
 * 一批商品行要用到的全部奖励 `resId`（去重，按出现顺序）。
 *
 * 宿主拿它去**预加载图标** —— 必须在铺列表**之前** await 完：行渲染是同步的，
 * 边渲染边加载会先闪一帧上一行的图（`VScrollView` 回收残影同款缺陷）。
 */
export function collectGiftRewardResIds(rows: readonly IGiftShopRow[]): readonly number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const row of rows) {
        for (const reward of row.rewards) {
            if (seen.has(reward.resId)) continue;
            seen.add(reward.resId);
            out.push(reward.resId);
        }
    }
    return out;
}

/**
 * 大页签定义。
 *
 * `special` 对应 `open.json` 的 409；`total` / `daily` 是充值活动页，不在该表中，
 * `resId` 记 `0`。
 */
export type GiftMainTabKey = 'special' | 'total' | 'daily';

export interface IGiftMainTab {
    readonly key: GiftMainTabKey;
    /** `open.json` 中的 `resId`；非入口页为 `0`。 */
    readonly resId: number;
}

export const GIFT_MAIN_TABS: readonly IGiftMainTab[] = [
    { key: 'special', resId: 409 },
    { key: 'total', resId: 0 },
    { key: 'daily', resId: 0 },
];
