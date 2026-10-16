import { CacheMgr } from '../net/CacheMgr';
import type { ZCItemCounter } from './CardUpgradeCost';

/**
 * 物品背包读取入口。背包是服务器下发的 CmdItem 缓存，不是 remoteRef 表。
 * 数量为 0 的条目不出现，消费方用 ?? 0 兜底。
 */

/** 背包快照：物品 id → 数量。 */
export function readItemCounts(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const item of CacheMgr.instance.getTlCmdItemNew()) {
        if (!item) continue;
        const id = String(item.resId);
        if (id.length === 0) continue;
        const number = Number(item.number);
        if (!Number.isFinite(number) || number <= 0) continue;
        counts.set(id, (counts.get(id) ?? 0) + Math.floor(number));
    }
    return counts;
}

/** 生成物品计数函数，喂给 evaluateUpgrade。每次调用重读缓存。 */
export function createItemCounter(): ZCItemCounter {
    const counts = readItemCounts();
    return (itemId: string): number => counts.get(String(itemId)) ?? 0;
}

/** 单个物品持有数量。 */
export function countItem(itemId: number | string): number {
    return readItemCounts().get(String(itemId)) ?? 0;
}
