/**
 * 章节宝箱的三档判定（纯 TS，零 cc）。
 *
 * 分档只看这一批奖励的数量总和：< 100 弱、100~1000 中、> 1000 强。
 * 1000 归中档。分档属于产品规则且决定动画规模，因此放在 model 里单测。
 */

/** 档位常量。 */
export const TERRITORY_CHEST_TIER = {
    weak: 'weak',
    medium: 'medium',
    strong: 'strong',
} as const;

export type TerritoryChestTier = typeof TERRITORY_CHEST_TIER[keyof typeof TERRITORY_CHEST_TIER];

/** 弱档上界（不含）。 */
export const TERRITORY_CHEST_WEAK_BELOW = 100;

/** 中档上界（含）。 */
export const TERRITORY_CHEST_MEDIUM_MAX = 1000;

/** 一条奖励的最小形状。 */
export interface ITerritoryChestRewardLike {
    readonly resId?: number;
    readonly amount?: number;
}

/**
 * 这一批奖励的数量总和，所有类型直接相加。
 *
 * 非有限值与非正数按 0 计，空数组返回 0。
 */
export function territoryChestTotal(rewards: readonly ITerritoryChestRewardLike[] | null | undefined): number {
    if (!rewards || rewards.length === 0) return 0;
    let total = 0;
    for (const reward of rewards) {
        if (!reward) continue;
        const amount = Number(reward.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        total += amount;
    }
    return total;
}

/** 总数量转档位；非有限值按弱档处理。 */
export function territoryChestTierOf(total: number): TerritoryChestTier {
    if (!Number.isFinite(total)) return TERRITORY_CHEST_TIER.weak;
    if (total < TERRITORY_CHEST_WEAK_BELOW) return TERRITORY_CHEST_TIER.weak;
    if (total <= TERRITORY_CHEST_MEDIUM_MAX) return TERRITORY_CHEST_TIER.medium;
    return TERRITORY_CHEST_TIER.strong;
}

/**
 * 一批奖励转档位；没有可展示的奖励返回 `null`。
 */
export function territoryChestTierOfRewards(
    rewards: readonly ITerritoryChestRewardLike[] | null | undefined,
): TerritoryChestTier | null {
    if (!rewards || rewards.length === 0) return null;
    const total = territoryChestTotal(rewards);
    if (total <= 0) return null;
    return territoryChestTierOf(total);
}

/** 档位中文名，用于提示与日志。 */
export const TERRITORY_CHEST_TIER_LABEL: Readonly<Record<TerritoryChestTier, string>> = {
    weak: '弱宝箱',
    medium: '中宝箱',
    strong: '大宝箱',
};

/**
 * 固定格奖励音效的分界（用户 2026-11-23 第 3 条）。
 *
 * 「奖励数量小于 1000 播固定格奖励小，大于 1000 播固定格奖励大」——**注意它与三档动画
 * 不是同一套刻度**：动画还分弱 / 中 / 强（100 / 1000），音效只按 1000 切两档，
 * 所以不能拿 `territoryChestTierOf` 的档位当音效判据（弱档会错误地落到「大」上）。
 */
const TERRITORY_FIXED_TILE_SOUND_LARGE_ABOVE = 1000;

/**
 * 这批固定格奖励该播「大」还是「小」音效。
 *
 * 合计 > 1000 ⇒ 大；≤ 1000（含 1000）⇒ 小 —— 与「小于 1000 小 / 大于 1000 大」一致，
 * 边界值 1000 取小档（与三档动画的中档上界同口径）。
 */
export function territoryFixedTileSoundIsLarge(
    rewards: readonly ITerritoryChestRewardLike[] | null | undefined,
): boolean {
    return territoryChestTotal(rewards) > TERRITORY_FIXED_TILE_SOUND_LARGE_ABOVE;
}
