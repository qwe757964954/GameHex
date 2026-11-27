import {
    COMMON_ART_ROOT,
    FIRST_RECHARGE_ART_ROOT,
    LOGIN_ART_ROOT,
    SEVEN_DAY_ART_ROOT,
    spriteFramePath,
} from '../ArtPaths';

/** `cc.Sprite._type` 数值映射（避免非视图文件为了 `0` / `1` import `cc`）。 */
export const COMMON_SPRITE_TYPE = {
    SIMPLE: 0,
    SLICED: 1,
} as const;

/** 通用置灰三通道 RGB（零引擎依赖）。 */
export const COMMON_TINT = {
    NORMAL: [255, 255, 255] as readonly [number, number, number],
    GRAY: [132, 132, 132] as readonly [number, number, number],
} as const;

/** 跨 feature 复用的公共贴图定位。 */
export const COMMON_SHARED_ART = {
    closeBtn: { root: LOGIN_ART_ROOT, name: '公用_按钮_关闭01' },
    checkMark: { root: SEVEN_DAY_ART_ROOT, name: 'sd_check' },
    redDot: { root: COMMON_ART_ROOT, name: 'cm_red_dot' },
    redDotNum: { root: COMMON_ART_ROOT, name: 'cm_red_dot_num' },
    redDotNew: { root: COMMON_ART_ROOT, name: 'cm_red_dot_new' },
    panelTitleBrown: { root: FIRST_RECHARGE_ART_ROOT, name: 'title_brown' },
} as const;

/** 把 `{ root, name }` 组装为 `resources.load` / bundle 加载路径。 */
export function commonSharedArtPath(ref: { readonly root: string; readonly name: string }): string {
    return spriteFramePath(ref.root, ref.name);
}
