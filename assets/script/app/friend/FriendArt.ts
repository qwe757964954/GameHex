/**
 * 「好友」美术资源的唯一入口 —— 资源名、九宫格口径都从这里取。
 *
 * 目录 `assets/resources/image/friend/`，模块前缀 `fd_`（与礼包 `gf_` / 七日 `sd_` 同套命名）。
 *
 * 本文件保持引擎无关（不 import `cc`），`tests/friend.test.ts` 直接 import 它断言资源名与
 * 九宫格口径；真正的 `resources.load` 在页面类里走 `loadArt(name, FRIEND_ART_ROOT)`。
 *
 * 12 张图取自老端 FGUI `好友` 包引用的公共图。不复用新端已有的同名图：那几张是别的版本的
 * 美术，而好友的几何按 FGUI 原稿算，换图会让九宫格拉伸后的边框宽度对不上。只有 3 张与新端
 * 完全一致、导入设置也不需要改的直接复用（见 `FRIEND_SHARED_*`）。
 *
 * `FRIEND_ART_SLICED` 是「prefab 里必须 `_type = 1`」的真源：Cocos 的九宫格边框只存在
 * SpriteFrame 资源上（写在各 `.png.meta` 里），`.prefab` 里表达不了，所以 `cc.Sprite._type`
 * 必须写 1 才用得上它。漏写的症状是图照样显示、不报错，只是整张被拉伸 ——
 * 底板从 394×307 拉到 626×882 时四角会被拉成细长条。
 *
 * `fd_input_v2` 是 v2 好友搜索框自己的主题底图（米黄底 + 深棕描边），不复用 `login/input_box`：
 * 登录界面已把那张 30×30 的图当 `_type = 1` 且边框为 0 用着，给它配边框会顺手改掉登录界面。
 */

import {
    FRIEND_ART_ROOT,
    MAIN_CHEST_ART_ROOT,
    MAIN_HUD_ART_ROOT,
    MAIN_POPUP_ART_ROOT,
    ROLE_ART_ROOT,
} from '../ArtPaths';

/** 静态图名（`FRIEND_ART_ROOT` 下）。 */
const FRIEND_ART_ROW_BG = 'fd_row_v2';
const FRIEND_ART_HEAD_FRAME = 'hud_avatar_frame';
export const FRIEND_ART_HEAD_FRAME_ROOT = MAIN_HUD_ART_ROOT;
const FRIEND_ART_LV_TAG = 'hud_level_bg';
export const FRIEND_ART_LV_TAG_ROOT = MAIN_HUD_ART_ROOT;
export const FRIEND_ART_PANEL_BG = 'bg';
export const FRIEND_ART_PANEL_BG_ROOT = MAIN_POPUP_ART_ROOT;
export const FRIEND_ART_TITLE_BG = 'title';
export const FRIEND_ART_TITLE_BG_ROOT = MAIN_POPUP_ART_ROOT;
/** 主按钮底图（main 图集金色小按钮）。 */
export const FRIEND_ART_BTN_GOLD = 'chest_btn_gold';
export const FRIEND_ART_BTN_GOLD_ROOT = MAIN_CHEST_ART_ROOT;
/** 次按钮底图（main 图集蓝色小按钮）。 */
export const FRIEND_ART_BTN_BLUE = 'chest_btn_blue';
export const FRIEND_ART_BTN_BLUE_ROOT = MAIN_CHEST_ART_ROOT;
/** 置灰主按钮（沿用旧深色图，避免运行时再生成灰度材质）。 */
export const FRIEND_ART_BTN_DARK = 'fd_btn_dark';
export const FRIEND_ART_TAB_ON = 'btn_04';
export const FRIEND_ART_TAB_ON_ROOT = ROLE_ART_ROOT;
export const FRIEND_ART_TAB_OFF = '';
/** 勾选框底框。 */
const FRIEND_ART_CHECK_BG = 'fd_check_bg';
const FRIEND_ART_INPUT_BG = 'fd_input_v2';

/**
 * 需要九宫格渲染的图（prefab 里挂 `cc.Sprite` 且 `_type` 必须 = 1）。
 * 与 FGUI `package.xml` 里带 `scale="9grid"` 的图一一对应。
 */
export const FRIEND_ART_SLICED: ReadonlySet<string> = new Set<string>([
    FRIEND_ART_ROW_BG,
    FRIEND_ART_BTN_GOLD,
    FRIEND_ART_BTN_DARK,
    FRIEND_ART_CHECK_BG,
    FRIEND_ART_INPUT_BG,
]);

/** 一行里三张固定的图（三个页签共用同款行底框 + 头像框 + 等级标签）。 */
export const FRIEND_ROW_ART = {
    rowBg: FRIEND_ART_ROW_BG,
    headFrame: FRIEND_ART_HEAD_FRAME,
    lvTag: FRIEND_ART_LV_TAG,
} as const;

/** 按钮两态底图（FGUI `按钮_公用_9Gone` 的 `颜色` controller：0 = Bule / 1 = Orange）。 */
export const FRIEND_BUTTON_ART = {
    /** 次要按钮：蓝底（一键赠送 / 换一批 / 搜索）。 */
    dark: FRIEND_ART_BTN_BLUE,
    /** 主按钮：金底（领取体力 / 好友申请 / 一键删除）。 */
    gold: FRIEND_ART_BTN_GOLD,
} as const;

/**
 * 按钮「颜色」语义 → 底图名。
 *
 * 别按图名直觉猜：FGUI 里 `颜色,1`（Orange）指向 `TY_btn06`（金色），
 * `颜色,0`（Bule）指向 `TY_btn07`（深色）—— 与 `TY_btn0N` 的编号顺序相反。
 */
export type FriendButtonColor = 'dark' | 'gold';

export function friendButtonArt(color: FriendButtonColor): string {
    return color === 'gold' ? FRIEND_ART_BTN_GOLD : FRIEND_ART_BTN_BLUE;
}

/**
 * `cc.Sprite._type` 的取值（生成器 / 页面共用，避免各处写魔数）。
 * `SIMPLE = 0` / `SLICED = 1`；`_sizeMode` 恒为 `CUSTOM = 0`。
 */
export const FRIEND_SPRITE_SIMPLE = 0;
export const FRIEND_SPRITE_SLICED = 1;

/** 按资源名给出该图应使用的 `cc.Sprite._type`。 */
export function friendSpriteType(artName: string): number {
    return FRIEND_ART_SLICED.has(artName) ? FRIEND_SPRITE_SLICED : FRIEND_SPRITE_SIMPLE;
}

/** 页签两态底图名（FGUI `组件_弹窗_页签` 的 `button` controller：常态 `TY_btn23` / 选中 `TY_btn20`）。 */
export function friendTabArt(selected: boolean): string {
    return selected ? FRIEND_ART_TAB_ON : FRIEND_ART_TAB_OFF;
}

// ============================================================
// 置灰
// ============================================================

/**
 * 置灰用的三通道值（不在这里 `new Color` —— 本文件要保持引擎无关）。
 *
 * FGUI 的 `grayed` 是真灰度滤镜，而 Cocos 3.x 的 `cc.Sprite` / `cc.Label` 没有内置灰度，
 * 这里用灰色 tint 近似：底图与文案乘同一个灰值，观感是「暗下来的同一块按钮」，不是逐像素去色。
 * 要真灰度得给按钮上灰度 `cc.Material`，每个按钮多一个材质实例 —— 对「已赠送 / 已申请」
 * 这种非关键态不值得。
 */
export const FRIEND_TINT_NORMAL: readonly [number, number, number] = [255, 255, 255];
export const FRIEND_TINT_GRAY: readonly [number, number, number] = [132, 132, 132];

/** 按是否置灰取 tint（默认取值的唯一入口，避免各处写魔数）。 */
export function friendTint(gray: boolean): readonly [number, number, number] {
    return gray ? FRIEND_TINT_GRAY : FRIEND_TINT_NORMAL;
}
