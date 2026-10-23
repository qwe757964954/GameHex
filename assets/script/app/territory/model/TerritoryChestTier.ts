/**
 * 章节（领地）宝箱的**三档判定** —— 纯 TS，零 `cc` 依赖。
 *
 * ## 用户口径（2026-10-22）
 *
 * > 「三种宝箱动画播放的判断标准，获得的奖励
 * >  弱宝箱表现：所有类型的**资源数量相加** 小于 100
 * >  中宝箱表现：所有类型的资源数量相加 处于 100~1000
 * >  大宝箱表现：所有类型的资源数量相加 1000 以上」
 *
 * 三条判据的**唯一真源就是总数量**，不是宝箱类型、不是城池等级、不是奖励条目数。
 * 「所有类型相加」= 把这一批奖励里**每一条的 `amount` 直接加起来**，不按资源稀有度加权 ——
 * 1 个「幻灵玉 ×50」与 50 个「银币 ×1」在分档上是同一档（用户没说加权，就别自己加）。
 *
 * ## 边界怎么切
 *
 * | 总数量 | 档位 |
 * | --- | --- |
 * | `< 100` | 弱 |
 * | `100 ~ 1000`（两端都含） | 中 |
 * | `> 1000` | 强 |
 *
 * ⚠️ `1000` 正好落在「中」：用户写的是「100~1000」与「1000 以上」，两句在 1000 处重叠，
 * 按「区间闭合优先」取**中**。这条边界有单测钉着（`tests/territory-chest-tier.test.ts`），
 * 想改成「1000 也算强」必须同时改测试与本文档，别只动一边。
 *
 * ## 为什么分档要放在 model（而不是 view 里 if 一下）
 *
 * 1. 档位决定**动画规模**（有没有光柱 / 镜头 / 粒子雨），这是产品规则，不是画法；
 * 2. 纯函数能在 Node 下单测，不用起引擎 —— 本工程所有曲线/判定都是这个套路
 *    （见 `TerritoryResourceGain` / `TerritoryHexFlip`）。
 */

/** 档位常量（禁止在调用方写 `'weak'` 这类裸字面量：改名/拼错会静默失配）。 */
export const TERRITORY_CHEST_TIER = {
    weak: 'weak',
    medium: 'medium',
    strong: 'strong',
} as const;

export type TerritoryChestTier = typeof TERRITORY_CHEST_TIER[keyof typeof TERRITORY_CHEST_TIER];

/**
 * 弱档的**上界（不含）**：总数量 `< 100` ⇒ 弱。
 *
 *  写成「上界不含」而不是「弱档 ≤ 99」，是为了让下面的 `territoryChestTierOf` 只用一次比较。
 */
export const TERRITORY_CHEST_WEAK_BELOW = 100;

/**
 * 中档的**上界（含）**：总数量 `≤ 1000` ⇒ 中；`> 1000` ⇒ 强。
 */
export const TERRITORY_CHEST_MEDIUM_MAX = 1000;

/** 一条奖励的最小形状：`ITerritoryGrantedReward` / `TerritoryIdleRewardGain` 都满足。 */
export interface ITerritoryChestRewardLike {
    readonly resId?: number;
    readonly amount?: number;
}

/**
 * 这一批奖励的**总数量**（所有类型直接相加）。
 *
 *  - 非有限值 / 非正数按 **0** 计（服务端脏数据不该让整次开箱崩掉，也不该把它算成一份奖励）；
 *  - 空数组 / `null` ⇒ `0`。
 *
 * ⚠️ 不四舍五入：`amount` 本身应该是整数（`readTerritoryGrantedRewards` 已保证），
 *   这里保留原值相加，是为了「配表写了 0.5 也照实累加」这种脏数据能被单测看见。
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

/**
 * 总数量 → 档位。
 *
 * ⚠️ 非有限值（`NaN` / `±Infinity`）一律当 **弱档**：脏数据最多是「小动画」，
 *   绝不能因为一个 `NaN` 触发全屏镜头 + 粒子雨。
 */
export function territoryChestTierOf(total: number): TerritoryChestTier {
    if (!Number.isFinite(total)) return TERRITORY_CHEST_TIER.weak;
    if (total < TERRITORY_CHEST_WEAK_BELOW) return TERRITORY_CHEST_TIER.weak;
    if (total <= TERRITORY_CHEST_MEDIUM_MAX) return TERRITORY_CHEST_TIER.medium;
    return TERRITORY_CHEST_TIER.strong;
}

/**
 * 一批奖励 → 档位；**空奖励返回 `null`**（= 根本没有宝箱要开，调用方据此跳过整套表现）。
 *
 * 为什么不直接返回 `weak`：`null` 让「没有奖励」与「奖励很小」在类型上就分开，
 * 调用方不需要再判一次 `rewards.length`（少一个漏判点就会空放一次开箱动画）。
 */
export function territoryChestTierOfRewards(
    rewards: readonly ITerritoryChestRewardLike[] | null | undefined,
): TerritoryChestTier | null {
    if (!rewards || rewards.length === 0) return null;
    const total = territoryChestTotal(rewards);
    // 条目都在、但金额全被过滤掉（全 0 / 负数 / NaN）⇒ 同样视为「没有可展示的奖励」。
    if (total <= 0) return null;
    return territoryChestTierOf(total);
}

/** 档位 → 中文名（提示 / 日志 / 截图对照用，不进 UI 主流程）。 */
export const TERRITORY_CHEST_TIER_LABEL: Readonly<Record<TerritoryChestTier, string>> = {
    weak: '弱宝箱',
    medium: '中宝箱',
    strong: '大宝箱',
};
