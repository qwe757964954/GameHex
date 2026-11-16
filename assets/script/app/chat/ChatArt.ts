/**
 * 「聊天」美术资源的唯一入口 —— 资源名与九宫格口径都从这里取。
 *
 * 目录 `assets/resources/image/chat/`，模块前缀 `ct_`（与 `fd_` / `ml_` / `gf_` 同套）。
 * 本文件保持引擎无关（不 import `cc`），真正的 `resources.load` 在页面类里。
 *
 * 复用外模块的图不再存第二份：好友的头像框 / 弹窗底 / 页签两态 / 金色按钮、
 * 登录的关闭按钮、通用头像底与标题带都直接引各自目录。
 */

/** 聊天自有图目录（不带 `resources/` 前缀）。 */
export const CHAT_ART_ROOT = 'image/chat';

/** 表情图名前缀（`ct_emoji_<n>`）。 */
export const CHAT_EMOJI_PREFIX = 'ct_emoji_';

/** 输入条黑框底（页签 0/2/4）。 */
export const CHAT_ART_BLACK_BOX = 'ct_black_box';
/** 输入框底：公共 / 私聊两个输入条共用。 */
export const CHAT_ART_INPUT_BG = 'ct_input_bg';
/** 招募项底板。 */
export const CHAT_ART_RECRUIT_BG = 'ct_recruit_bg';
/** 左右气泡底。 */
export const CHAT_ART_BUBBLE_BG = 'ct_bubble_bg';
/** 输入条上的「艾特」按钮图标。 */
export const CHAT_ART_AT_BTN = 'ct_at_btn';
/** 输入条上的「表情」按钮图标。 */
export const CHAT_ART_BQ_BTN = 'ct_bq_btn';
/** 招募项「点击加入」按钮底图。 */
export const CHAT_ART_JOIN_BTN = 'ct_join_btn';
/** 私聊项「删除」按钮。 */
export const CHAT_ART_CLOSE_02 = 'ct_close_02';

/** 复用外模块的图（目录 + 图名分开给，加载时要两个参数）。 */
export const CHAT_SHARED_HEAD_BOX_ROOT = 'image/friend';
export const CHAT_SHARED_HEAD_BOX_NAME = 'fd_row_bg';
export const CHAT_SHARED_POPUP_BG_ROOT = 'image/friend';
export const CHAT_SHARED_POPUP_BG_NAME = 'fd_panel_bg';
export const CHAT_SHARED_HEAD_FRAME_ROOT = 'image/gameui';
export const CHAT_SHARED_HEAD_FRAME_NAME = 'img_Touxiang_01';
export const CHAT_SHARED_TITLE_BG_ROOT = 'image/firstRecharge';
export const CHAT_SHARED_TITLE_BG_NAME = 'title_brown';

/** 弹窗右上「关闭」按钮：与好友弹窗同一个 FGUI 模板，直接复用那张图。 */
export const CHAT_SHARED_CLOSE_ROOT = 'image/login';
export const CHAT_SHARED_CLOSE_NAME = '公用_按钮_关闭01';

/**
 * 页签两态底图：与好友模块同一张图（FGUI 模板同源），页签组件类也复用
 * `FriendTabButton`（见 `ChatPage`）。
 */
export const CHAT_SHARED_TAB_ROOT = 'image/friend';
export const CHAT_SHARED_TAB_ON = 'fd_tab_on';
export const CHAT_SHARED_TAB_OFF = 'fd_tab_off';

/** 「发送」按钮底图：复用好友模块的金色按钮（FGUI `按钮_公用_9Gone` 同款）。 */
export const CHAT_SHARED_SEND_ROOT = 'image/friend';
export const CHAT_SHARED_SEND_NAME = 'fd_btn_gold';

/** 九宫格图名 → 所在目录（要按图名去核 `.png.meta` 的边框）。 */
export const CHAT_ART_DIRS: Readonly<Record<string, string>> = {
    [CHAT_ART_BUBBLE_BG]: CHAT_ART_ROOT,
    [CHAT_ART_BLACK_BOX]: CHAT_ART_ROOT,
    [CHAT_ART_INPUT_BG]: CHAT_ART_ROOT,
    [CHAT_ART_RECRUIT_BG]: CHAT_ART_ROOT,
    [CHAT_ART_JOIN_BTN]: CHAT_ART_ROOT,
    [CHAT_SHARED_HEAD_BOX_NAME]: CHAT_SHARED_HEAD_BOX_ROOT,
    [CHAT_SHARED_POPUP_BG_NAME]: CHAT_SHARED_POPUP_BG_ROOT,
    [CHAT_SHARED_SEND_NAME]: CHAT_SHARED_SEND_ROOT,
    [CHAT_SHARED_TITLE_BG_NAME]: CHAT_SHARED_TITLE_BG_ROOT,
};

/**
 * 需要九宫格渲染的图（prefab 里 `cc.Sprite._type` 必须是 `SLICED`）—— 由 `CHAT_ART_DIRS` 派生。
 *
 * 边框值来自 FGUI 的 `scale9grid`，已写进各自 `.png.meta` 的 `border*`；漏列一项不会报错，
 * 只会让 `chatSpriteType()` 给出 `SIMPLE` ⇒ 图照显示、整张被拉伸。
 *
 * | 图名 | FGUI 源 | LRTB |
 * |---|---|---|
 * | `ct_bubble_bg` | `frame_01_9gong` | 160,153,127,115 |
 * | `ct_black_box` | `末日_公用_九宫格_黑色框` | 10,10,10,10 |
 * | `ct_input_bg` | 输入框底（原稿未记档） | 19,12,18,10 |
 * | `ct_recruit_bg` | `biaoq_BG` | 167,136,145,130 |
 * | `ct_join_btn` | `TY_btn21` | 56,56,19,22 |
 * | `fd_row_bg` | `frame_Zhikuang06` | 12,13,12,11 |
 * | `fd_panel_bg` | `panel_window_01_9gong` | 129,142,128,143 |
 * | `fd_btn_gold` | `TY_btn06` | 14,11,66,54 |
 * | `title_brown` | `title_brown` | 171,16,20,40 |
 *
 * 非九宫：44 张 emoji、`ct_at_btn`、`ct_bq_btn`、`ct_close_02`、`img_Touxiang_01`。
 */
export const CHAT_ART_SLICED: ReadonlySet<string> = new Set(Object.keys(CHAT_ART_DIRS));

/** `cc.Sprite._type` 取值（`_sizeMode` 恒为 `CUSTOM`）。 */
export const CHAT_SPRITE_SIMPLE = 0;
export const CHAT_SPRITE_SLICED = 1;

/** 按资源名给出该用的 `cc.Sprite._type`。 */
export function chatSpriteType(artName: string): number {
    return CHAT_ART_SLICED.has(artName) ? CHAT_SPRITE_SLICED : CHAT_SPRITE_SIMPLE;
}

/** 表情图名（`0 <= index < EMOJI_COUNT`）。 */
export function emojiArtName(index: number): string {
    return `${CHAT_EMOJI_PREFIX}${index}`;
}

/**
 * 富文本 `<img src='...'/>` 用的路径。
 *
 * 必须是完整资源路径（`resources` 相对路径），裸图名会让 `cc.RichText` 静默不渲染。
 */
export function emojiRichSrc(index: number): string {
    return `${CHAT_ART_ROOT}/${emojiArtName(index)}/spriteFrame`;
}

/** 一行里通用的头像框底（三段式：底图 + 头像 icon）。 */
export const CHAT_HEAD_ART = {
    frame: CHAT_SHARED_HEAD_FRAME_NAME,
    box: CHAT_SHARED_HEAD_BOX_NAME,
} as const;

// ============================================================
// 置灰（口径同 `FriendArt`）
// ============================================================

/** FGUI 的 `grayed` 是真灰度滤镜，Cocos 没有内置 ⇒ 用灰色 tint 近似。 */
export const CHAT_TINT_NORMAL: readonly [number, number, number] = [255, 255, 255];
export const CHAT_TINT_GRAY: readonly [number, number, number] = [132, 132, 132];

/** 按是否置灰取 tint（唯一入口，避免各处写魔数）。 */
export function chatTint(gray: boolean): readonly [number, number, number] {
    return gray ? CHAT_TINT_GRAY : CHAT_TINT_NORMAL;
}
