/** Store 分段几何夹具：生产侧已迁到 `Store.prefab` 的 VERTICAL Layout。 */
import {
    STORE_GRID_LINE_GAP,
    STORE_GRID_ROWS,
    STORE_SECTIONS,
    type StoreSectionKey,
} from '../../assets/script/app/store/StoreTable';

export const STORE_GRID_COL_X: readonly number[] = [-215, 0, 215];
export const STORE_CARD_H = 276;
export const STORE_SECTION_LIST_TOP: Readonly<Record<StoreSectionKey, number>> = {
    gem: 89, gift: 85, gold: 90, silver: 79, goods: 88,
};
export const STORE_SECTION_H: Readonly<Record<StoreSectionKey, number>> = {
    gem: 842,
    gift: 365,
    gold: STORE_SECTION_LIST_TOP.gold + (STORE_GRID_ROWS.gold! * STORE_CARD_H + (STORE_GRID_ROWS.gold! - 1) * STORE_GRID_LINE_GAP.gold!),
    silver: STORE_SECTION_LIST_TOP.silver + (STORE_GRID_ROWS.silver! * STORE_CARD_H + (STORE_GRID_ROWS.silver! - 1) * STORE_GRID_LINE_GAP.silver!),
    goods: STORE_SECTION_LIST_TOP.goods + (STORE_GRID_ROWS.goods! * STORE_CARD_H + (STORE_GRID_ROWS.goods! - 1) * STORE_GRID_LINE_GAP.goods!),
};
export const STORE_SECTION_GAP = 10;
export const STORE_CONTENT_H: number =
    STORE_SECTIONS.reduce((sum, section) => sum + STORE_SECTION_H[section.key], 0)
    + STORE_SECTION_GAP * (STORE_SECTIONS.length - 1);

export function storeSectionTop(key: StoreSectionKey): number {
    let y = 0;
    for (const section of STORE_SECTIONS) {
        if (section.key === key) return y;
        y -= STORE_SECTION_H[section.key] + STORE_SECTION_GAP;
    }
    return y;
}
