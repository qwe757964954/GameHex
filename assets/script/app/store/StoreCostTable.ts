/**
 * 商城的纯函数判定：抽奖花费、铜钱铺分流、限购和冷却。
 *
 * 持有量和购买次数由调用方注入，单测不需要网络和存档。
 * 规则对齐老端 TabStoreMain，不额外发明限制。
 */

/** gemBox 一行的花费字段。 */
export interface IGemBoxCostRow {
    /** 宝箱 id，也是购买请求的 id。 */
    readonly id: number;
    /** 首选价格类型。 */
    readonly priceType: number;
    /** 单次的首选数量。 */
    readonly cost: number;
    /** 备选价格类型。 */
    readonly priceType3: number;
    /** 备选单次数量。 */
    readonly cost3: number;
    /** 备选十连数量。 */
    readonly cost2: number;
    /** 保底品质。 */
    readonly quality: number;
    readonly quality2: number;
}

/** goldShop / resourceShop 一行的购买字段。 */
export interface IShopCostRow {
    readonly id: number;
    readonly cost: number;
    readonly priceType: number;
    /** 前 N 次免费；resourceShop 没有这个字段，按 0 处理。 */
    readonly freeTimes: number;
    /** 免费之后可看广告抵一次的次数。 */
    readonly adTimes: number;
    /** 限购上限，<= 0 表示不限购。 */
    readonly limit: number;
}

/** 抽一次的实际花费。 */
export interface IDrawCost {
    readonly resId: number;
    readonly number: number;
    /** 是否退到了备选价格。 */
    readonly fallback: boolean;
}

function toNonNegativeInt(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 算单次或十连的实际花费。单次和十连分别判定，不互相连坐。
 * 首选货币为 0 或持有不足时退到备选价格。
 */
export function resolveDrawCost(
    row: IGemBoxCostRow,
    heldOf: (resId: number) => number,
    ten: boolean,
): IDrawCost {
    const baseType = toNonNegativeInt(row.priceType);
    const baseNumber = ten ? toNonNegativeInt(row.cost) * 10 : toNonNegativeInt(row.cost);
    if (baseType > 0 && baseNumber > 0 && heldOf(baseType) >= baseNumber) {
        return { resId: baseType, number: baseNumber, fallback: false };
    }
    const altType = toNonNegativeInt(row.priceType3);
    const altNumber = ten ? toNonNegativeInt(row.cost2) : toNonNegativeInt(row.cost3);
    return { resId: altType, number: altNumber, fallback: true };
}

/** 铜钱铺的三个档位。 */
export type StoreCoinBranch = 'free' | 'ad' | 'paid';

/**
 * 铜钱铺这次点击落在哪一档。参数只收次数，黑市没有免费/广告档时传 0 即可。
 */
export function resolveCoinBranch(freeTimes: unknown, adTimes: unknown, buyTimes: unknown): StoreCoinBranch {
    const free = toNonNegativeInt(freeTimes);
    const ad = toNonNegativeInt(adTimes);
    const times = Math.max(0, Number(buyTimes) || 0);
    if (times < free) return 'free';
    if (times < free + ad) return 'ad';
    return 'paid';
}

/** 限购判定：limit <= 0 不限购，否则已买次数必须小于上限。 */
export function canBuyWithLimit(limit: unknown, buyTimes: unknown): boolean {
    const cap = toNonNegativeInt(limit);
    if (cap <= 0) return true;
    return Math.max(0, Number(buyTimes) || 0) < cap;
}

/** 冷却是否已过；nextBuyTime 为 0 或缺失时视为已过。 */
export function isCooldownOver(nextBuyTime: unknown, nowSeconds: number): boolean {
    const next = Number(nextBuyTime) || 0;
    if (next <= 0) return true;
    return nowSeconds >= next;
}

/**
 * 概率说明。老端从 mL 表读预置文案，这里改为按 gemBox 的奖励字段生成。
 * pro 只展示原始权重，不换算百分比，因为两端都没有可用的分母。
 */

/** gemBox.rewards / rareRewards 的一条。 */
export interface IGemBoxRewardRow {
    readonly resId: number;
    readonly number: number;
    /** 仅 rareRewards 有：原始权重。 */
    readonly pro?: number;
}

/** 概率说明的一段。 */
export interface IStoreProbabilitySection {
    readonly heading: string;
    readonly lines: readonly string[];
}

/**
 * 生成概率说明段落。只处理奖励列表，保底信息由调用方按服务端进度传入。
 * nameOf 读不到物品名时应回退到「物品{resId}」。
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
