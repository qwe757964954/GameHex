/** FairyGUI → Cocos 坐标换算（纯 TS，零引擎依赖）。 */

export const FGUI_DESIGN_WIDTH = 720;
export const FGUI_DESIGN_HEIGHT = 1280;

export interface ILayoutPoint {
    readonly x: number;
    readonly y: number;
}

/** FGUI 左上角坐标 → Cocos 节点中心坐标。 */
export function fguiTopLeftToCocos(
    x: number,
    y: number,
    width: number,
    height: number,
    parentW: number = FGUI_DESIGN_WIDTH,
    parentH: number = FGUI_DESIGN_HEIGHT,
): ILayoutPoint {
    return {
        x: x + width / 2 - parentW / 2,
        y: parentH / 2 - y - height / 2,
    };
}

/** FGUI 带 anchor 的枢轴点坐标 → Cocos 中心坐标。 */
export function fguiAnchorToCocos(
    pivotX: number,
    pivotY: number,
    parentW: number = FGUI_DESIGN_WIDTH,
    parentH: number = FGUI_DESIGN_HEIGHT,
): ILayoutPoint {
    return {
        x: pivotX - parentW / 2,
        y: parentH / 2 - pivotY,
    };
}
