/** 「获得奖励」纯口径层（零 cc）：归一化、排序、图标路径、展示数据。 */
import { toCount } from '../../core/value/Coerce';
import type { IRewardAmount, IResGoodsInfo } from '../../core/types/Reward';
import { gemRewardOf, type IGemTables } from './GemReward';
import { rewardGoodsOf } from './ResTypes';
import { resolveRewardIconRef } from './RewardIcon';

/**
 * `CmdGoods` 的最小形状。
 *
 * `quality` 是服务端**可选**下发的品质：宝石这类「品质不在 `item` / `roleProperty` 表里」的奖励
 * 必须靠它；普通道具 / 货币仍以表为准（表里缺失才回退到它）。
 */
export interface ICmdGoodsLike extends IRewardAmount {
    readonly quality?: number;
}

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
    const quality = toCount(row.quality);
    // 品质缺省（0）不落键：既有调用方的 deepEqual 口径不受影响。
    return quality > 0
        ? { resId, number: toCount(row.number), quality }
        : { resId, number: toCount(row.number) };
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

/**
 * 一条奖励 → 展示数据。
 *
 * 分流顺序：宝石（`gem` / `gemQuality`）→ `item` → `roleProperty`。
 * 宝石的品质取 `CmdGoods.quality`，缺省按实例 id 末四位推；两张道具表都查不到时按品质 1 + 无图标降级。
 */
export function rewardEntryOf(
    goods: ICmdGoodsLike,
    items: ReadonlyMap<number, IResGoodsInfo>,
    resources: ReadonlyMap<number, IResGoodsInfo>,
    gems?: IGemTables | null,
): IShowRewardEntry {
    const gem = gemRewardOf(goods.resId, goods.quality, gems);
    if (gem) {
        return { resId: goods.resId, number: goods.number, quality: gem.quality, iconPath: gem.iconPath };
    }
    const info = rewardGoodsOf(goods.resId, items, resources);
    return {
        resId: goods.resId,
        number: goods.number,
        quality: info ? info.quality : 1,
        iconPath: rewardIconPathOf(info),
    };
}
