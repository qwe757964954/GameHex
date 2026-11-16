/** ItemInfo 获取途径列表的版面夹具：生产侧已迁到 `ItemInfo.prefab` 的 RowsRoot Layout。 */
export const ITEM_INFO_MAX_ROWS = 4;
export const ITEM_INFO_PLATE_WIDTH = 437;
export const ITEM_INFO_ROWS_PAD = 13;
export const ITEM_INFO_ROW_GAP = 11;
export const ITEM_INFO_ROW_HEIGHT = 57;
export const ITEM_INFO_ROW_WIDTH = 414;

export function itemInfoRowsHeightOf(count: number): number {
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n <= 0) return 2 * ITEM_INFO_ROWS_PAD + ITEM_INFO_ROW_HEIGHT;
    return 2 * ITEM_INFO_ROWS_PAD + n * ITEM_INFO_ROW_HEIGHT + (n - 1) * ITEM_INFO_ROW_GAP;
}

export function itemInfoRowCountOf(count: number): number {
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(n, ITEM_INFO_MAX_ROWS);
}
