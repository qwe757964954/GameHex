/** 奖励金额解析骨架；校验策略由 `minNumber` 控制。 */
import type { IRewardAmount } from '../types/Reward';
import { toCount } from '../value/Coerce';
import { asRow } from './RowParse';

export interface IRewardAmountOptions {
    /** 数量下限；默认 1（`number <= 0` 丢弃），传 0 时保留显式 0。 */
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
