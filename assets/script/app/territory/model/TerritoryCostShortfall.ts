import type { TerritoryWallet } from './TerritorySaveStore';

/**
 * 「银币 / 体力够不够」的判据（纯函数，无状态）。
 *
 * 银币与体力分别判断：各自不足时只染红对应的数字。消耗无效或余额未知都不算不足，
 * 只有确定不够时才返回 true。
 *
 * 这里判的是能否付得起，不负责前置、邻接、战力等开启条件。
 */

/** 这一项余额够不够付 `cost`；`true` = 不够。 */
export function territoryCostShort(balance: number | undefined, cost: number | undefined): boolean {
    // 消耗无效（0 / 负 / NaN / ±Infinity）不算不足。
    if (!Number.isFinite(cost) || cost <= 0) return false;
    // 余额未知不妄断；读到 0 且消耗大于 0 才判不足。
    if (!Number.isFinite(balance)) return false;
    return balance < cost;
}

/** 一格解锁要付的两项消耗（与 `site.unlock` / `map.defaults` 结构兼容）。 */
interface ITerritoryUnlockCost {
    readonly silverCost: number;
    readonly staminaCost: number;
}

/** 这一格的两项消耗分别够不够。 */
export interface ITerritoryUnlockShortfall {
    readonly silver: boolean;
    readonly stamina: boolean;
}

/**
 * 一次算出银币与体力是否不足。
 *
 * 两项分开返回，分别驱动各自的数字颜色；钱包或消耗缺失时都视为够用。
 */
export function territoryUnlockShortfall(
    wallet: Readonly<TerritoryWallet> | null | undefined,
    cost: ITerritoryUnlockCost | null | undefined,
): ITerritoryUnlockShortfall {
    return {
        silver: territoryCostShort(wallet?.silver, cost?.silverCost),
        stamina: territoryCostShort(wallet?.stamina, cost?.staminaCost),
    };
}
