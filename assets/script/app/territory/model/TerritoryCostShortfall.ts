import type { TerritoryWallet } from './TerritorySaveStore';

/**
 * 「银币 / 体力够不够」的唯一判据（纯函数、零 `cc`、零状态）。
 *
 * 需求（2026-11-03，山猫截图）：*「体力不足或银币不足时，对应的数字 UI 显示红色」*。
 * 关键词是**对应**：
 *
 *  · 银币数字（未解锁格左上那颗「银币 + 15」）只在**银币**不够时红；
 *  · 体力数字（宝箱水滴气泡里那颗「体力 + 1」）只在**体力**不够时红。
 *
 * 两项混成一个红会让玩家去攒错东西 —— 体力不足却把银币染红，等于说"钱不够"。
 *
 * ## 三条边界（都是"别乱红"）
 *
 * 1. `cost <= 0`（免费格 / 表里填 0 / 脏值）⇒ **不算不足**。否则整张图会红一片，
 *    而玩家其实点得进去。
 * 2. 余额**不是有限数**（`NaN` / `undefined` 透传 / 存档还没读到）⇒ **不算不足**。
 *    红是「确定不够」的断言；读不到钱包就染红只是噪音。真读到 `0` 而消耗 `> 0`
 *    才会红（`0` 是有限数，正常走比较）。
 * 3. 刚好够（`balance === cost`）⇒ 不算不足 —— 能开就是能开。
 *
 * ⚠️ 这里判的是**能不能付得起**，不是**能不能开**。前置没打、相邻没通、战力不够
 *    都不归它管（那些由 `checkUnlock` / `canOpenTerritoryRandomCell` 出 reason）。
 */

/** 这一项余额够不够付 `cost`；`true` = 不够（该染红）。 */
export function territoryCostShort(balance: number, cost: number): boolean {
    // 消耗本身无效（0 / 负 / NaN / ±Infinity）⇒ 没有"不够"这回事。
    // ∞ 也算脏值：配表写出 `Infinity` 时如果判红，整张图会红一片，而根因在配表
    // （配表侧有 `territory-editor-validation` 那条线管），不该由地图表现层兜。
    if (!(cost > 0) || !Number.isFinite(cost)) return false;
    // 余额未知 ⇒ 不妄断（`Number.isFinite` 一次挡掉 NaN / ±Infinity / undefined）。
    if (!Number.isFinite(balance)) return false;
    return balance < cost;
}

/** 一格解锁要付的两项消耗（与 `site.unlock` / `map.defaults` 结构兼容）。 */
export interface ITerritoryUnlockCost {
    readonly silverCost: number;
    readonly staminaCost: number;
}

/** 这一格的两项消耗分别够不够。 */
export interface ITerritoryUnlockShortfall {
    readonly silver: boolean;
    readonly stamina: boolean;
}

/**
 * 一次算出「银币不够 / 体力不够」。
 *
 * 分开返回（而不是合成一个 `short`）是这次需求的核心：两个数字各管各的颜色。
 * `wallet` / `cost` 为 `null`（沙箱测试的宽松输入、还没读到存档）时两项都是 `false`。
 */
export function territoryUnlockShortfall(
    wallet: Readonly<TerritoryWallet> | null | undefined,
    cost: ITerritoryUnlockCost | null | undefined,
): ITerritoryUnlockShortfall {
    return {
        silver: territoryCostShort(wallet?.silver as number, cost?.silverCost as number),
        stamina: territoryCostShort(wallet?.stamina as number, cost?.staminaCost as number),
    };
}
