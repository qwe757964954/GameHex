/** 「获得奖励」纯口径层（零 cc）：归一化、排序、图标路径、展示数据。 */
import { toCount } from '../../core/value/Coerce';
import type { IRewardAmount, IResGoodsInfo } from '../../core/types/Reward';
import { rewardGoodsOf } from './ResTypes';
import { resolveRewardIconRef } from './RewardIcon';

export type ICmdGoodsLike = IRewardAmount;

/** 收敛后的奖励展示数据。 */
export interface IShowRewardEntry {
    readonly resId: number;
    readonly number: number;
    readonly quality: number;
    readonly iconPath: string;
}

/** 原始一行 → 奖励；resId <= 0 / 形状不对返回 null。 */
export function toCmdGoods(raw: unknown): ICmdGoodsLike | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const resId = toCount(row.resId);
    if (resId <= 0) return null;
    return { resId, number: toCount(row.number) };
}

/** 一串原始奖励 → 归一化列表。 */
export function parseCmdGoodsList(raw: unknown): ICmdGoodsLike[] {
    const out: ICmdGoodsLike[] = [];
    if (!Array.isArray(raw)) return out;
    for (const one of raw) {
        const goods = toCmdGoods(one);
        if (goods) out.push(goods);
    }
    return out;
}

/** 奖励排序：品质降序，同品质按 resId 升序。 */
export function sortRewardEntries(entries: readonly IShowRewardEntry[]): IShowRewardEntry[] {
    return [...entries].sort((a, b) => (b.quality - a.quality) || (a.resId - b.resId));
}

/** 展示信息 → 相对 resources 的图标路径；解析不出返回空串。 */
export function rewardIconPathOf(info: IResGoodsInfo | null): string {
    const ref = resolveRewardIconRef(info);
    return ref ? `${ref.root}/${ref.name}` : '';
}

/** 一条奖励 → 展示数据；两表都查不到按品质 1 + 无图标降级。 */
export function rewardEntryOf(
    goods: ICmdGoodsLike,
    items: ReadonlyMap<number, IResGoodsInfo>,
    resources: ReadonlyMap<number, IResGoodsInfo>,
): IShowRewardEntry {
    const info = rewardGoodsOf(goods.resId, items, resources);
    return {
        resId: goods.resId,
        number: goods.number,
        quality: info ? info.quality : 1,
        iconPath: rewardIconPathOf(info),
    };
}
