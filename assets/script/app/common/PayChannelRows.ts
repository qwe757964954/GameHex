import { toCount, toText } from '../../core/value/Coerce';
import { parseRows } from '../../core/table/RowParse';

/** `payChannel` 的公共字段；feature 可在其上补商品字段。 */
export interface IPayChannelBaseRow {
    readonly id: number;
    readonly name: string;
    readonly rmb: number;
}

/** 洗 `payChannel` 公共字段；`id <= 0` 的行跳过。 */
export function parsePayChannelBaseRows(values: unknown): IPayChannelBaseRow[] {
    return parseRows(values, (row) => {
        const id = toCount(row.id);
        if (id <= 0) return null;
        return { id, name: toText(row.name), rmb: toCount(row.rmb) };
    });
}
