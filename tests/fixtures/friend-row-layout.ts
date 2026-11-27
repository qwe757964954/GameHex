/** Friend 行「整组位移」夹具：生产侧已改成 RowTemplate 的 DeleteGroupAnchor marker。 */
export const FRIEND_ROW_GROUP_NORMAL: { readonly x: number; readonly y: number } = { x: 0, y: 0 };
export const FRIEND_ROW_GROUP_DELETE: { readonly x: number; readonly y: number } = { x: 64, y: -6 };

export function rowGroupPosition(deleteMode: boolean): { readonly x: number; readonly y: number } {
    return deleteMode ? FRIEND_ROW_GROUP_DELETE : FRIEND_ROW_GROUP_NORMAL;
}
