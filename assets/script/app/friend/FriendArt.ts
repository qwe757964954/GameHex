/**
 * 「好友」美术资源的**唯一入口** —— 任何地方要这些图的资源名 / 九宫格口径，都从这里取。
 *
 * 目录：`assets/resources/image/friend/`（模块前缀 `fd_`，与礼包 `gf_` / 七日 `sd_` 同套命名）。
 *
 * ⚠️ 本文件**保持引擎无关**（不 import `cc`）——`tests/friend.test.ts` 直接 import 它做
 *    美术名 / 九宫格口径的断言（同 `GiftArt` / `GiftTable` 的分工：能脱离引擎跑单测）。
 *    真正的 `resources.load` 在页面类里走 `loadArt(name, FRIEND_ART_ROOT)`。
 *
 * ## 图从哪来 / 为什么不全复用新端现成的
 *
 * 12 张是从老端 FGUI `好友` 包引用的**公共图**里拷出来的（来源见 `tmp/_copy_friend_art.py`）。
 * 不直接复用新端已有的 `activity/act_row_bg.png` / `gameui/img_Touxiang_01.png` /
 * `main/city/nav_sel.png` 这类同名图：**md5 全不一样**（是别的版本的美术），而好友的几何是按
 * FGUI 原稿算的，换图会让九宫格拉伸后的边框宽度对不上。
 *
 * 只有 3 张 md5 与新端完全一致、**且导入设置不需要改**的图直接复用（`FRIEND_SHARED_*`）：
 *   `login/公用_按钮_关闭01` / `sevenDay/sd_check` / `common/cm_red_dot`
 *
 * ## 九宫格（`FRIEND_ART_SLICED`）—— 这张表是「prefab 里必须 `_type=1`」的真源
 *
 * FGUI 在 `公用0/package.xml` 给这几张图标了 `scale="9grid" scale9grid="x,y,w,h"`
 * （那个矩形是**中间格**）。Cocos 的九宫格边框只存在 **SpriteFrame 资源**上，`.prefab` 里
 * 表达不了 ⇒ 边框写进了各自的 `.png.meta`（`tmp/_friend_meta_patch.py`，已实测 `library` 侧
 * `capInsets` 落到位），而 **`cc.Sprite._type` 必须写 1(SLICED)** 才用得上它。
 *
 * 漏写 `_type=1` 的症状：图照样显示、**不报错**，只是整张被拉伸 ——
 * 底板（394×307 → 626×882）四角会被拉成 2.9 倍细长条，是那种「看得出来但说不清哪错」的偏差。
 * 生成器与单测都按 `FRIEND_ART_SLICED` 核对这一点。
 *
 * ⚠️ `fd_input_bg` 是新端**自己留的一份**输入框底图，不是复用 `login/input_box`：
 *    登录界面已经把那 30×30 的图当 `_type=1` 用且边框为 0，给它配边框会顺手改掉登录界面
 *    ⇒ 本模块内单独留一份（1KB），互不牵连。
 */

/** 好友自有图目录（`loadArt(name, FRIEND_ART_ROOT)` 用；不带 `resources/` 前缀）。 */
export const FRIEND_ART_ROOT = 'image/friend';

/** 静态图名（`FRIEND_ART_ROOT` 下）。 */
export const FRIEND_ART_ROW_BG = 'fd_row_bg';
export const FRIEND_ART_HEAD_FRAME = 'fd_head_frame';
export const FRIEND_ART_LV_TAG = 'fd_lv_tag';
export const FRIEND_ART_PANEL_BG = 'fd_panel_bg';
export const FRIEND_ART_TITLE_BG = 'fd_title_bg';
/** 主按钮底图（FGUI `颜色` 控制器的 `Orange` = 金色）。 */
export const FRIEND_ART_BTN_GOLD = 'fd_btn_gold';
/** 次按钮底图（FGUI `颜色` 控制器的 `Bule` —— 原文拼写如此 = 深色）。 */
export const FRIEND_ART_BTN_DARK = 'fd_btn_dark';
export const FRIEND_ART_TAB_ON = 'fd_tab_on';
export const FRIEND_ART_TAB_OFF = 'fd_tab_off';
export const FRIEND_ART_TAB_OVER = 'fd_tab_over';
export const FRIEND_ART_CHECK_BG = 'fd_check_bg';
export const FRIEND_ART_INPUT_BG = 'fd_input_bg';

/** 复用新端现有路径的 3 张（各自所在的目录 + 图名）。 */
export const FRIEND_SHARED_CLOSE_ROOT = 'image/login';
export const FRIEND_SHARED_CLOSE_NAME = '公用_按钮_关闭01';
export const FRIEND_SHARED_CHECK_ROOT = 'image/sevenDay';
export const FRIEND_SHARED_CHECK_NAME = 'sd_check';
export const FRIEND_SHARED_RED_DOT_ROOT = 'image/common';
export const FRIEND_SHARED_RED_DOT_NAME = 'cm_red_dot';

/**
 * **需要九宫格渲染的图**（prefab 里挂 `cc.Sprite` 且 `_type` 必须 = 1）。
 *
 * 与 FGUI `package.xml` 里带 `scale="9grid"` 的图一一对应；每张的边框来自
 * `tmp/_friend_meta_patch.py` 的 `BORDERS` 表（值 = `scale9grid` 换算）。
 */
export const FRIEND_ART_SLICED: ReadonlySet<string> = new Set<string>([
    FRIEND_ART_PANEL_BG,
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

/** 按钮两态底图（FGUI `按钮_公用_9Gone` 的 `颜色` controller：0=Bule / 1=Orange）。 */
export const FRIEND_BUTTON_ART = {
    /** `颜色,0`（FGUI 拼作 `Bule`）—— 深色，次按钮：一键赠送 / 换一批 / 搜索 / 私聊 / 拒绝。 */
    dark: FRIEND_ART_BTN_DARK,
    /** `颜色,1`（FGUI 写 `Orange`）—— 金色，主按钮：批量删除 / 领取体力 / 好友申请 / 一键删除 / 主操作。 */
    gold: FRIEND_ART_BTN_GOLD,
} as const;

/**
 * 按钮「颜色」语义 → 底图名。
 *
 * ⚠️ 别按图名直觉猜：FGUI 里 `颜色,1`(=Orange) 指向的是 **`TY_btn06`**（金色），
 *    `颜色,0`(=Bule) 指向 **`TY_btn07`**（深色）—— 与 `TY_btn0N` 的编号顺序相反。
 *    实测像素：`TY_btn06` 主色 RGB≈(189,136,70)、`TY_btn07` ≈(95,71,52)。
 */
export type FriendButtonColor = 'dark' | 'gold';

export function friendButtonArt(color: FriendButtonColor): string {
    return color === 'gold' ? FRIEND_ART_BTN_GOLD : FRIEND_ART_BTN_DARK;
}

/**
 * `cc.Sprite._type` 的取值（生成器 / 页面共用，避免各处写魔数）。
 *
 * `SIMPLE = 0` / `SLICED = 1`；`_sizeMode` 恒为 `CUSTOM = 0`（规则 7：被渲染组件回写
 * `contentSize` 的坑）。
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
// 置灰（老端 `item.tm("btn").grayed = isGray`）
// ============================================================

/**
 * 置灰用的**三通道值**（不在这里 `new Color` —— 本文件要保持引擎无关）。
 *
 * ⚠️ FGUI 的 `grayed` 是**真灰度滤镜**（渲染期整块去色）；Cocos 3.x 的 `cc.Sprite` /
 *    `cc.Label` **没有内置灰度**。这里用**灰色 tint** 近似：底图与文案都乘同一个灰值，
 *    观感是「暗下来的同一块按钮」，但不是逐像素去色。
 *    若要真灰度得给按钮上 `cc.Material`（灰度 effect），代价是每个按钮多一个材质实例 ——
 *    对「已赠送 / 已申请」这种非关键态不值得，先按 tint 落地（**有意偏离**，已写进单测）。
 */
export const FRIEND_TINT_NORMAL: readonly [number, number, number] = [255, 255, 255];
export const FRIEND_TINT_GRAY: readonly [number, number, number] = [132, 132, 132];

/** 按是否置灰取 tint（默认取值的唯一入口，避免各处写魔数）。 */
export function friendTint(gray: boolean): readonly [number, number, number] {
    return gray ? FRIEND_TINT_GRAY : FRIEND_TINT_NORMAL;
}

/** 勾选框两态：底框（`fd_check_bg`）+ 对勾（复用 `sevenDay/sd_check`）。 */
export const FRIEND_CHECK_BG_NAME = FRIEND_ART_CHECK_BG;
export const FRIEND_CHECK_MARK_ROOT = FRIEND_SHARED_CHECK_ROOT;
export const FRIEND_CHECK_MARK_NAME = FRIEND_SHARED_CHECK_NAME;
