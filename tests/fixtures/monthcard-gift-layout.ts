/** MonthCardGift 逐格摆位夹具：生产侧已迁到 DayList / PrivilegeList 的 cc.Layout。 */
import {
    MONTHCARD_DAY_LIST_SIZE,
    MONTHCARD_PRIVILEGE_LIST_SIZE,
    MONTHCARD_PRIVILEGE_ROW_SIZE,
    type ILayoutPoint,
} from '../../assets/script/app/monthcard/MonthCardGiftLayout';

export const MONTHCARD_SLOT_WIDTH = 80;
export const MONTHCARD_SLOT_HEIGHT = 80;
export const MONTHCARD_SLOT_STRIDE = MONTHCARD_SLOT_WIDTH + 10;
export const MONTHCARD_PRIVILEGE_ROW_HEIGHT = 34;
export const MONTHCARD_PRIVILEGE_STRIDE = MONTHCARD_PRIVILEGE_ROW_HEIGHT + 6;

export function dayRewardSlotPosition(index: number): ILayoutPoint {
    return {
        x: index * MONTHCARD_SLOT_STRIDE + MONTHCARD_SLOT_WIDTH / 2 - MONTHCARD_DAY_LIST_SIZE.width / 2,
        y: 0,
    };
}

export function privilegeRowPosition(index: number): ILayoutPoint {
    return {
        x: MONTHCARD_PRIVILEGE_ROW_SIZE.width / 2 - MONTHCARD_PRIVILEGE_LIST_SIZE.width / 2,
        y: MONTHCARD_PRIVILEGE_LIST_SIZE.height / 2
            - MONTHCARD_PRIVILEGE_ROW_HEIGHT / 2
            - index * MONTHCARD_PRIVILEGE_STRIDE,
    };
}
