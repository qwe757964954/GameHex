/** ShowReward 网格几何夹具：生产侧已迁到 `ShowReward.prefab` 的 Grid Layout / VirtualScrollView。 */
export const SR_VIEW_W = 468;
export const SR_VIEW_H = 330;
export const SR_ITEM_SIZE = 100;
export const SR_COL_GAP = 20;
export const SR_ROW_GAP = 12;
export const SR_STEP_X = SR_ITEM_SIZE + SR_COL_GAP;
export const SR_STEP_Y = SR_ITEM_SIZE + SR_ROW_GAP;

export function columnsOf(viewW: number, itemSize = SR_ITEM_SIZE, gap = SR_COL_GAP): number {
    if (!(itemSize > 0)) return 1;
    return Math.max(1, Math.floor((viewW + gap) / (itemSize + gap)));
}

export function rowsOf(viewH: number, itemSize = SR_ITEM_SIZE, gap = SR_ROW_GAP): number {
    if (!(itemSize > 0)) return 1;
    return Math.max(1, Math.floor((viewH + gap) / (itemSize + gap)));
}

export const SR_COLUMNS = columnsOf(SR_VIEW_W);
export const SR_ROWS = rowsOf(SR_VIEW_H);
export const SR_SLOT_COUNT = SR_COLUMNS * SR_ROWS;

export function slotLocalCenterOf(
    index: number,
    total: number = SR_SLOT_COUNT,
): { x: number; y: number } {
    const count = Math.max(1, Math.floor(total));
    const rows = Math.max(1, Math.ceil(count / SR_COLUMNS));
    const row = Math.floor(index / SR_COLUMNS);
    const col = index % SR_COLUMNS;
    const inRow = Math.min(count - row * SR_COLUMNS, SR_COLUMNS);
    const blockW = inRow * SR_ITEM_SIZE + Math.max(0, inRow - 1) * SR_COL_GAP;
    const blockH = rows * SR_ITEM_SIZE + Math.max(0, rows - 1) * SR_ROW_GAP;
    return {
        x: (SR_VIEW_W - blockW) / 2 + col * SR_STEP_X + SR_ITEM_SIZE / 2,
        y: (SR_VIEW_H - blockH) / 2 + row * SR_STEP_Y + SR_ITEM_SIZE / 2,
    };
}

export function contentHeightOf(total: number, itemSize = SR_ITEM_SIZE, gap = SR_ROW_GAP): number {
    const rows = Math.max(1, Math.ceil(Math.max(0, Math.floor(total)) / SR_COLUMNS));
    return rows * (itemSize + gap) - gap;
}

export function windowSlotOf(slot: number, topRow: number): number {
    const row = topRow + Math.floor(slot / SR_COLUMNS);
    return row * SR_COLUMNS + (slot % SR_COLUMNS);
}

export function maxTopRowOf(total: number, viewH: number = SR_VIEW_H): number {
    const content = contentHeightOf(total);
    return Math.max(0, Math.ceil((content - viewH) / SR_STEP_Y));
}
