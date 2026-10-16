import { toCount } from '../../net/RequestGuard';

export interface ITerritoryGrantedReward {
    readonly resId: number;
    readonly amount: number;
}

/** Reward popups use the goods actually granted by the server, never the configured odds. */
export function readTerritoryGrantedRewards(goods: unknown): ITerritoryGrantedReward[] {
    if (!Array.isArray(goods)) return [];
    const rewards: ITerritoryGrantedReward[] = [];
    for (const item of goods) {
        if (!item || typeof item !== 'object') continue;
        const row = item as { resId?: unknown; number?: unknown };
        const resId = toCount(row.resId);
        const amount = toCount(row.number);
        if (!Number.isSafeInteger(resId) || resId <= 0
            || !Number.isSafeInteger(amount) || amount <= 0) continue;
        rewards.push({ resId, amount });
    }
    return rewards;
}
