/**
 * 「商城」的**花费 / 限购 / 概率**判定 —— 引擎无关（不 import `cc`），单测直接 import。
 *
 * 与 `StoreShopTable.ts`（静态内容表）的分工：
 * - `StoreShopTable` 管「卡上显示什么」（图标、文案、行数据）；
 * - 本文件管「点了之后允许不允许、花多少」——**全部是纯函数**，把「持有量」的读取
 *   交给调用方注入（`heldOf` / `buyTimes`），这样单测不需要网络也不需要有存档。
 *
 * `StoreRepository`（连接层）负责把真表 / 真缓存喂进来，`StoreActions` 负责编排。
 *
 * ## 三处老端真源（逐条对齐，不自己发明规则）
 *
 * | 判定 | 老端位置 | 规则 |
 * |---|---|---|
 * | 抽奖花费 | `TabStoreMain.RenderBox` L620–633 | 单次 / 十连**各自独立**算：`priceType` 为 0 或**持有不足** ⇒ 换 `priceType3`，数量换 `cost3`（单）/ `cost2`（十连） |
 * | 铜钱铺分流 | `TabStoreMain.onClickCoin` L906–940 | `buyTimes < freeTimes` ⇒ 免费；`< freeTimes + adTimes` ⇒ 广告；否则 ⇒ 付费（再查限购 / 冷却 / 够钱） |
 * | 限购 | 同上 + `RenderGoods` | `limit <= 0` ⇒ 不限购；否则 `buyTimes < limit` 才可买 |
 */

/** `gemBox` 一行的花费相关字段（`assets/remoteRef/gemBox.json`）。 */
export interface IGemBoxCostRow {
    /** 宝箱 id（1 = 低级 / 2 = 高级）；也是 `RequestShopBuy` 的 `id`。 */
    readonly id: number;
    /** 首选价格类型（`10991` 金钥匙 / `10992` 高级钥匙）。 */
    readonly priceType: number;
    /** 单次的首选数量。 */
    readonly cost: number;
    /** 备选价格类型（`10` 金币）。 */
    readonly priceType3: number;
    /** 备选**单次**数量（`cost3`，低级 50 / 高级 250）。 */
    readonly cost3: number;
    /** 备选**十连**数量（`cost2`，低级 500 / 高级 2500）。 */
    readonly cost2: number;
    /** 保底品质（`quality` / `quality2` 对应 `gemQuality` 表）。 */
    readonly quality: number;
    readonly quality2: number;
}

/** `goldShop` / `resourceShop` 一行的购买相关字段。 */
export interface IShopCostRow {
    readonly id: number;
    /** 价格数量（`cost`）。 */
    readonly cost: number;
    /** 价格货币（`priceType`，一律 10 = 金币）。 */
    readonly priceType: number;
    /** 前 N 次免费（`goldShop.freeTimes`；`resourceShop` 没有这个字段 ⇒ 视为 0）。 */
    readonly freeTimes: number;
    /** 免费之后可看广告抵一次的次数（`goldShop.adTimes`；同上）。 */
    readonly adTimes: number;
    /** 限购上限（`limit`，`<= 0` 表示不限购）。 */
    readonly limit: number;
}

/** 抽一次的实际花费。 */
export interface IDrawCost {
    /** 实际扣的资源 / 货币 id。 */
    readonly resId: number;
    /** 实际扣的数量。 */
    readonly number: number;
    /** 是否走了备选价格（= 首选货币不足）⇒ 界面可以据此提示「改用金币」。 */
    readonly fallback: boolean;
}

function toNonNegativeInt(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 算一次抽奖（单次 / 十连）的实际花费。
 *
 * 对齐老端 `RenderBox`：**单次与十连分别判定**，不要「单次不够就十连也不够」这种连坐。
 *
 * @param heldOf 持有量查询（`resId → 数量`）。不足判定就是 `heldOf(resId) < number`。
 */
export function resolveDrawCost(
    row: IGemBoxCostRow,
    heldOf: (resId: number) => number,
    ten: boolean,
): IDrawCost {
    const baseType = toNonNegativeInt(row.priceType);
    const baseNumber = ten ? toNonNegativeInt(row.cost) * 10 : toNonNegativeInt(row.cost);
    // `priceType == 0` 与「持有不足」在老端是**同一个分支**（`||` 连在一起）。
    if (baseType > 0 && baseNumber > 0 && heldOf(baseType) >= baseNumber) {
        return { resId: baseType, number: baseNumber, fallback: false };
    }
    const altType = toNonNegativeInt(row.priceType3);
    const altNumber = ten ? toNonNegativeInt(row.cost2) : toNonNegativeInt(row.cost3);
    return { resId: altType, number: altNumber, fallback: true };
}

/** 铜钱铺的三个档位（老端 `onClickCoin` 的 if / else if / else）。 */
export type StoreCoinBranch = 'free' | 'ad' | 'paid';

/**
 * 铜钱铺这次点击落在哪一档。
 *
 * ⚠️ 参数顺序刻意用「次数」而不是整行：`goldShop` 才有 `freeTimes / adTimes`，
 *    `resourceShop`（黑市）没有 ⇒ 调用方传 0 即可，两边共用同一个函数。
 */
export function resolveCoinBranch(freeTimes: unknown, adTimes: unknown, buyTimes: unknown): StoreCoinBranch {
    const free = toNonNegativeInt(freeTimes);
    const ad = toNonNegativeInt(adTimes);
    const times = Math.max(0, Number(buyTimes) || 0);
    if (times < free) return 'free';
    if (times < free + ad) return 'ad';
    return 'paid';
}

/** 限购判定：`limit <= 0` 不限购；否则已买次数必须小于上限（老端 `ref.limit <= 0 || buyTimes < ref.limit`）。 */
export function canBuyWithLimit(limit: unknown, buyTimes: unknown): boolean {
    const cap = toNonNegativeInt(limit);
    if (cap <= 0) return true;
    return Math.max(0, Number(buyTimes) || 0) < cap;
}

/** 冷却是否已过（`interval` 秒；`nextBuyTime` 是服务端给的下次可买时间戳，单位秒。0 / 缺省一律视为已过）。 */
export function isCooldownOver(nextBuyTime: unknown, nowSeconds: number): boolean {
    const next = Number(nextBuyTime) || 0;
    if (next <= 0) return true;
    return nowSeconds >= next;
}

// ============================================================
// 概率说明（`btn_help`）
// ============================================================
//
// ⚠️ 老端是从 `mL` 表读**预置文案**（`putongbaoxiangjilv` / `gaojibaoxiangjilv`），
//    本端 `mL.json` 里**没有这两个键**，而且 `FW.G_W` 是空实现（见 `StoreTexts` 文件头）。
//
//    所以这里改为**按 `gemBox` 表的原始字段当场生成**：
//    - 保底：`quality` / `quality2` + 服务端进度（`nextTime` / `nextTime50`）；
//    - 奖励：`rewards`（必得）+ `rareRewards`（稀有，带原始权重 `pro`）。
//
//    ⚠️ **刻意不把 `pro` 换算成百分比**：`gemPro`(993800) 与 `pro`(40/4/16/2) 的
//       量纲在两端代码里都没有除数，硬凑一个分母等于编数据。展示原始权重要诚实得多。

/** `gemBox.rewards` / `rareRewards` 的一条。 */
export interface IGemBoxRewardRow {
    readonly resId: number;
    readonly number: number;
    /** 仅 `rareRewards` 有：原始权重。 */
    readonly pro?: number;
}

/** 概率说明的一段。 */
export interface IStoreProbabilitySection {
    readonly heading: string;
    readonly lines: readonly string[];
}

/**
 * 生成概率说明的文本段落。
 *
 * ⚠️ 只吃**奖励两串**，不吃 `gemBox` 行 —— 行列的是价格，与「出什么」无关；
 *    保底那一行由调用方按服务端进度（`nextTime` / `nextTime50`）单独传进来。
 *
 * @param nameOf `resId → 物品名`（读 `item` 表；读不到时回退 `物品{resId}`）。
 */
export function buildProbabilitySections(
    rewards: readonly IGemBoxRewardRow[],
    rareRewards: readonly IGemBoxRewardRow[],
    nameOf: (resId: number) => string,
    guarantee?: { readonly rest: number; readonly qualityName: string },
): IStoreProbabilitySection[] {
    const sections: IStoreProbabilitySection[] = [];

    if (guarantee && guarantee.rest > 0) {
        sections.push({
            heading: '保底',
            lines: [`剩余 ${guarantee.rest} 次必得「${guarantee.qualityName}」`],
        });
    }

    if (rewards.length > 0) {
        sections.push({
            heading: '必得奖励',
            lines: rewards.map((r) => `${nameOf(r.resId)} x${r.number}`),
        });
    }

    if (rareRewards.length > 0) {
        sections.push({
            heading: '稀有奖励（权重取自 gemBox 表 pro 字段）',
            lines: rareRewards.map((r) => `${nameOf(r.resId)} x${r.number}    权重 ${r.pro ?? 0}`),
        });
    }

    if (sections.length === 0) {
        sections.push({ heading: '概率说明', lines: ['该宝箱未配置奖励'] });
    }
    return sections;
}

/** 把段落拼成 `CommonTips` 的一整段文本（`heading` 单独一行，`lines` 各占一行）。 */
export function formatProbabilityText(sections: readonly IStoreProbabilitySection[]): string {
    return sections
        .map((s) => [`【${s.heading}】`, ...s.lines].join('\n'))
        .join('\n\n');
}
