/** 奖励金额解析骨架；校验策略由 `minNumber` 控制。 */
import type { IRewardAmount } from '../types/Reward';
import { toCount } from '../value/Coerce';
import { asRow } from './RowParse';

export interface IRewardAmountOptions {
    /**
     * 数量下限；默认 1，表示 `number < 1` 的行丢弃（正小数如 0.5 也会丢）。
     * 传 0 时允许数量为 0；该 0 可能来自显式 `0`，也可能来自缺失/非法值经
     * `toCount` 归一化后的结果，不能视为“仅保留显式零”。
     */
    readonly minNumber?: number;
}

export function parseRewardAmounts(
    values: unknown,
    options?: IRewardAmountOptions,
): IRewardAmount[] {
    const out: IRewardAmount[] = [];
    if (!Array.isArray(values)) return out;
    const minNumber = options?.minNumber ?? 1;
    for (const raw of values) {
        const row = asRow(raw);
        if (!row) continue;
        const resId = toCount(row.resId);
        const number = toCount(row.number);
        if (resId <= 0 || number < minNumber) continue;
        out.push({ resId, number });
    }
    return out;
}
