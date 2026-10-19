import type { TerritoryCampaignReward } from './TerritoryCampaignConfig';

export const TERRITORY_IDLE_REWARD_INTERVAL_MS = 60 * 60 * 1000;

/** roleProperty: gold = 银币。 */
export const TERRITORY_SILVER_RES_ID = 7;
/** roleProperty: end = 体力。 */
export const TERRITORY_STAMINA_RES_ID = 9;

/**
 * 挂机奖励去向（**唯一事实源**：`TerritoryIdleRewardDestination` 由它推导，禁止写
 * `'wallet.silver'` 这类裸字面量）。
 *
 * ⚠️ **键是合法标识符，值是存档里的真实路径**（`save.wallet.silver` / `save.wallet.stamina`）——
 * `TerritorySaveStore` 的 switch 按**值**匹配，存档路径由值携带，改名只动键。
 */
export const TERRITORY_IDLE_REWARD_DESTINATION = {
    walletSilver: 'wallet.silver',
    walletStamina: 'wallet.stamina',
    inventory: 'inventory',
} as const;

export type TerritoryIdleRewardDestination =
    typeof TERRITORY_IDLE_REWARD_DESTINATION[keyof typeof TERRITORY_IDLE_REWARD_DESTINATION];

/** 银币 / 体力直接进钱包，其余资源进领地背包。 */
export function idleRewardDestinationOf(resId: number): TerritoryIdleRewardDestination {
    if (resId === TERRITORY_SILVER_RES_ID) return TERRITORY_IDLE_REWARD_DESTINATION.walletSilver;
    if (resId === TERRITORY_STAMINA_RES_ID) return TERRITORY_IDLE_REWARD_DESTINATION.walletStamina;
    return TERRITORY_IDLE_REWARD_DESTINATION.inventory;
}

export interface TerritoryIdleRewardSource {
    levelId: number;
    rewards: readonly TerritoryCampaignReward[];
}

export interface TerritoryIdleRewardGain {
    resId: number;
    name: string;
    amount: number;
}

export interface TerritoryIdleRewardSettlement {
    claimedAtByLevel: Record<string, number>;
    rewards: TerritoryIdleRewardGain[];
    settledHours: number;
    changed: boolean;
}

function safeTimestamp(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

/**
 * Settles each occupied level independently. Missing ledger entries are initialized
 * at `now`, so migrated saves and newly occupied sites never earn retroactive rewards.
 */
export function settleTerritoryIdleRewards(
    claimedAtByLevel: Readonly<Record<string, number>>,
    sources: readonly TerritoryIdleRewardSource[],
    now: number,
    maxHours: number,
    random: () => number = Math.random,
): TerritoryIdleRewardSettlement {
    const timestamp = Math.max(0, Math.floor(Number(now) || 0));
    const cap = Math.max(1, Math.floor(Number(maxHours) || 1));
    const nextLedger = { ...claimedAtByLevel };
    const totals = new Map<number, TerritoryIdleRewardGain>();
    const uniqueSources = new Map(sources.map((source) => [source.levelId, source]));
    let settledHours = 0;
    let changed = false;

    for (const source of uniqueSources.values()) {
        const key = String(source.levelId);
        const previous = Object.prototype.hasOwnProperty.call(claimedAtByLevel, key)
            ? safeTimestamp(claimedAtByLevel[key])
            : null;
        if (previous === null || previous > timestamp) {
            nextLedger[key] = timestamp;
            changed = true;
            continue;
        }

        const elapsedHours = Math.floor((timestamp - previous) / TERRITORY_IDLE_REWARD_INTERVAL_MS);
        if (elapsedHours <= 0) continue;
        const hours = Math.min(elapsedHours, cap);
        settledHours = Math.max(settledHours, hours);

        for (let hour = 0; hour < hours; hour += 1) {
            for (const reward of source.rewards) {
                const probability = Math.max(0, Math.min(10000, Math.floor(reward.probability)));
                if (probability <= 0 || (probability < 10000 && random() * 10000 >= probability)) continue;
                const amount = Math.max(0, Math.floor(reward.amount));
                if (!amount) continue;
                const old = totals.get(reward.resId);
                if (old) old.amount += amount;
                else totals.set(reward.resId, { resId: reward.resId, name: reward.name, amount });
            }
        }

        // Once the cap is exceeded, overflow time is discarded; otherwise keep a partial hour.
        nextLedger[key] = elapsedHours > cap
            ? timestamp
            : previous + hours * TERRITORY_IDLE_REWARD_INTERVAL_MS;
        changed = true;
    }

    return {
        claimedAtByLevel: nextLedger,
        rewards: Array.from(totals.values()),
        settledHours,
        changed,
    };
}
