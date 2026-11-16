/** PlayerInfo 头像列表的版面夹具：生产侧已改成 ChangeHead.prefab 的 Grid Layout + getter。 */
export const HEAD_ITEM_COLUMNS = 4;
export const HEAD_ITEM_SCALE = 0.9;
export const HEAD_ITEM_SIZE = 110.7;
export const HEAD_ITEM_STEP_X = 131.4;
export const HEAD_ITEM_STEP_Y = 128.7;
export const HEAD_VIEW_W = 550.8;
export const HEAD_ITEM_ROWS = 2;
export const HEAD_ITEM_SLOT_COUNT = HEAD_ITEM_COLUMNS * HEAD_ITEM_ROWS;

export function headContentHeight(total: unknown): number {
    const n = Math.max(0, Math.floor(Number(total) || 0));
    const rows = Math.max(1, Math.ceil(n / HEAD_ITEM_COLUMNS));
    return rows * HEAD_ITEM_STEP_Y - (HEAD_ITEM_STEP_Y - HEAD_ITEM_SIZE);
}

export function headSlotOffset(index: unknown): { x: number; y: number } {
    const i = Math.max(0, Math.floor(Number(index) || 0));
    return {
        x: (i % HEAD_ITEM_COLUMNS) * HEAD_ITEM_STEP_X,
        y: Math.floor(i / HEAD_ITEM_COLUMNS) * HEAD_ITEM_STEP_Y,
    };
}
