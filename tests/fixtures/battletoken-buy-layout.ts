/** BattleToken 购买按钮行夹具：生产侧已改为 PlansThree / PlansTwo 的 cc.Layout + setSiblingIndex。 */
export const BT_BUY_BTN_W = 193;
export const BT_BUY_BTN_H = 74;
export const BT_BUY_ROW_W = 720;
export const BT_BUY_ROW_H = 71;

export interface IBuyButtonBox {
    readonly left: number;
    readonly top: number;
    readonly w: number;
    readonly h: number;
}

export function buyButtonLayout(three: boolean): readonly (IBuyButtonBox | null)[] {
    if (three) {
        return [
            { left: 58, top: -1, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
            { left: 287, top: -2, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
            { left: 496, top: -2, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        ];
    }
    return [
        { left: 109, top: -3, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        { left: 440, top: -4, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        null,
    ];
}

export function buyButtonPos(three: boolean, index: number): { x: number; y: number } | null {
    const box = buyButtonLayout(three)[index];
    if (!box) return null;
    return {
        x: box.left + box.w / 2 - BT_BUY_ROW_W / 2,
        y: BT_BUY_ROW_H / 2 - (box.top + box.h / 2),
    };
}
