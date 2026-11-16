/** ItemDetail 弹窗纵向布局夹具：生产侧已改为 `PanelBg` Widget + 列表高度反写。 */
export const ID_PANEL_WIDTH = 515;
export const ID_PANEL_TOP = 362;
export const ID_LIST_TOP = -111;
export const ID_ROW_HEIGHT = 70;
export const ID_ROW_GAP = 17;
export const ID_LIST_MAX_HEIGHT = 253;
export const ID_LIST_BUTTON_GAP = 8;
export const ID_BUTTON_HEIGHT = 60;
export const ID_BUTTON_BOTTOM_MARGIN = 36;
export const ID_CONTENT_BLOCK_HEIGHT = 151;
export const ID_ACCESS_TITLE_HEIGHT = 44;

export interface IItemDetailLayout {
    readonly panelHeight: number;
    readonly listHeight: number;
    readonly listTop: number;
    readonly titleY: number;
    readonly goY: number;
    readonly go1Y: number;
}

export function itemDetailLayoutOf(rowCount: number, hasContent = true): IItemDetailLayout {
    const rows = Math.max(1, Math.floor(Number(rowCount) || 0));
    const needed = rows * ID_ROW_HEIGHT + Math.max(0, rows - 1) * ID_ROW_GAP;
    const listHeight = rows >= 3 ? ID_LIST_MAX_HEIGHT : Math.min(ID_LIST_MAX_HEIGHT, needed);
    const listTop = hasContent ? ID_LIST_TOP : ID_LIST_TOP + ID_CONTENT_BLOCK_HEIGHT;
    const listBottom = listTop - listHeight;
    const buttonTop = listBottom - ID_LIST_BUTTON_GAP;
    const panelBottom = buttonTop - ID_BUTTON_HEIGHT - ID_BUTTON_BOTTOM_MARGIN;
    return {
        panelHeight: ID_PANEL_TOP - panelBottom,
        listHeight,
        listTop,
        titleY: listTop + ID_ACCESS_TITLE_HEIGHT,
        goY: buttonTop,
        go1Y: buttonTop - 2,
    };
}
