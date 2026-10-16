/**
 * 「聊天」美术资源的**唯一入口** —— 任何地方要资源名 / 九宫格口径都从这里取。
 *
 * 目录：`assets/resources/image/chat/`（模块前缀 `ct_`，与 `fd_` / `ml_` / `gf_` 同套命名）。
 *
 * ⚠️ 本文件**保持引擎无关**（不 import `cc`），`tests/chat.test.ts` 直接 import 它做口径断言。
 *    真正的 `resources.load` 在页面类里。
 *
 * ## 哪些是自有、哪些是复用（约定：同图不另存第二份）
 *
 * 自有（51 张，见 `tmp/_copy_chat_art.py` / `tmp/_chat_meta_patch.py` / `tmp/_chat_meta_patch2.py`）：
 *   `ct_emoji_0..43`（44 张表情）、`ct_at_btn`、`ct_bq_btn`、`ct_black_box`（输入条底）、
 *   `ct_recruit_bg`（招募项底）、`ct_bubble_bg`（左右气泡底）、
 *   `ct_join_btn`（招募项「点击加入」底图）、`ct_close_02`（私聊项「删除」按钮）、
 *   `ct_main_chat`（主界面入口按钮图标）。
 *
 * 复用（md5 与已有图一致，直接引别的目录）：
 *   `image/friend/fd_row_bg`（= FGUI `frame_Zhikuang06`，聊天里作**私聊头像框 / 艾特项底**）
 *   `image/friend/fd_panel_bg`（= `panel_window_01_9gong`，**表情 / 艾特弹窗底**）
 *   `image/gameui/img_Touxiang_01`（头像框底，非九宫）
 *   `image/firstRecharge/title_brown`（弹窗标题带）
 *   `image/common/*`（关闭按钮 / 红点，按现有入口取）
 *
 * ## ⚠️ `ct_bubble_bg` 为什么要单独留一份
 *
 * FGUI 的 `frame_01_9gong` 在新端已经躺在 `image/login/frame_dialog.png`，但**登录界面是当
 * 普通图用的（border 全 0）**；就地给它配九宫格边框会顺手改掉登录界面。
 * ⇒ 按 friend 轮 `fd_input_bg` 的同一处置：聊天目录单独留一份（`ct_bubble_bg`，1 份 ≈ 54KB）。
 *
 * ## 九宫格（`CHAT_ART_SLICED`）
 *
 * 值 = FGUI `package.xml` 的 `scale9grid="x,y,w,h"` 换算成 Cocos 的四边边框，
 * 已写进各自 `.png.meta` 的 `subMetas.f9941.userData.border*`。
 * **`.prefab` 里的 `cc.Sprite._type` 必须写 `1(SLICED)` 才用得上它** ——
 * 漏写的症状是「图照样显示、只是整张被拉伸」，不报错。
 */

/** 聊天自有图目录（不带 `resources/` 前缀）。 */
export const CHAT_ART_ROOT = 'image/chat';

/** 表情图名前缀（`ct_emoji_<n>`）。 */
export const CHAT_EMOJI_PREFIX = 'ct_emoji_';

/** 输入条黑框底（页签 0/2/4）。 */
export const CHAT_ART_BLACK_BOX = 'ct_black_box';
/** 输入框底（FGUI `末日_公用_九宫格_黑灰框`）—— 公共 / 私聊两个输入条共用。 */
export const CHAT_ART_INPUT_BG = 'ct_input_bg';
/** 招募项底板（FGUI `biaoq_BG`）。 */
export const CHAT_ART_RECRUIT_BG = 'ct_recruit_bg';
/** 左右气泡底（FGUI `frame_01_9gong` 的副本）。 */
export const CHAT_ART_BUBBLE_BG = 'ct_bubble_bg';
/** 输入条上的「艾特」按钮图标。 */
export const CHAT_ART_AT_BTN = 'ct_at_btn';
/** 输入条上的「表情」按钮图标。 */
export const CHAT_ART_BQ_BTN = 'ct_bq_btn';
/** 招募项「点击加入」按钮底图（FGUI `按钮_公共_多颜色_一级_变暗` 的 `颜色,3(黄)` = `TY_btn21`）。 */
export const CHAT_ART_JOIN_BTN = 'ct_join_btn';
/** 私聊项「删除」按钮（FGUI `按钮_公共_详情` 的 `type,1(关闭)` = `公用_按钮_关闭02`）。 */
export const CHAT_ART_CLOSE_02 = 'ct_close_02';
/** 主界面右侧「聊天」入口按钮图标（FGUI `zjm_icon03_LiaoTian`）。 */
export const CHAT_ART_MAIN_CHAT = 'ct_main_chat';

/** 复用外模块的图（各自目录 + 图名）。 */
export const CHAT_SHARED_HEAD_BOX_ROOT = 'image/friend';
export const CHAT_SHARED_HEAD_BOX_NAME = 'fd_row_bg';
export const CHAT_SHARED_POPUP_BG_ROOT = 'image/friend';
export const CHAT_SHARED_POPUP_BG_NAME = 'fd_panel_bg';
export const CHAT_SHARED_HEAD_FRAME_ROOT = 'image/gameui';
export const CHAT_SHARED_HEAD_FRAME_NAME = 'img_Touxiang_01';
export const CHAT_SHARED_TITLE_BG_ROOT = 'image/firstRecharge';
export const CHAT_SHARED_TITLE_BG_NAME = 'title_brown';
/**
 * 弹窗右上「关闭」按钮 —— 复用好友模块落的那张（`image/login/公用_按钮_关闭01.png`）。
 *
 * 弹窗外框是**同一个** FGUI 模板（`共用组件/组件/弹窗/组件_公共弹窗_新.xml`）⇒
 * 关的图也该是同一张。FGUI 原稿里那个 loader 引的是模板自带的内嵌资源
 * （`ui://w3m64m87eb31531e03d2d158`，在 `共用组件/package.xml` 里查询不到，
 * 属于 FGUI 内部 hash），与好友那份视觉同款 ⇒ 直接复用、不重复落地。
 */
export const CHAT_SHARED_CLOSE_ROOT = 'image/login';
export const CHAT_SHARED_CLOSE_NAME = '公用_按钮_关闭01';

/**
 * 页签两态底图 —— 与好友模块**同一张图**（FGUI 模板同源：`组件_弹窗_页签`）。
 *
 * `TY_btn23`（常态）→ `fd_tab_off`、`TY_btn20`（选中）→ `fd_tab_on`，
 * 已实测与 `image/friend/fd_tab_*.png` 的 md5 一致 ⇒ 直接引那个目录，不再落一份。
 * 页签**组件类**同理复用 `FriendTabButton`（见 `ChatPage` 文件头）。
 */
export const CHAT_SHARED_TAB_ROOT = 'image/friend';
export const CHAT_SHARED_TAB_ON = 'fd_tab_on';
export const CHAT_SHARED_TAB_OFF = 'fd_tab_off';

/**
 * 「发送」按钮底图 —— 复用好友模块的金色按钮。
 *
 * FGUI 是 `按钮_公用_9Gone` 实例 118×70（`颜色,1` = 橙金），与好友弹窗的金色按钮同款
 * （`uid://…TY_btn06`，md5 一致）⇒ 同 `fd_tab_*` 的处置：直接引、不另存。
 */
export const CHAT_SHARED_SEND_ROOT = 'image/friend';
export const CHAT_SHARED_SEND_NAME = 'fd_btn_gold';

/**
 * **需要九宫格渲染的图**（prefab 里 `cc.Sprite._type` 必须 = 1）。
 *
 * ⚠️ **共 9 项** —— 与生成器 `tmp/gen_chat.mjs` 的 `U.blackBox, U.inputBg, U.recruitBg,
 *    U.bubbleBg, U.joinBtn, U.panelBg, U.rowBg, U.btnGold, U.titleBg` 逐项对齐。
 *    少列一项不会报错，只会让 `chatSpriteType()` 给出 `SIMPLE` ⇒ 图照显示、整张被拉伸。
 *
 * 逐项对上 FGUI 的 `scale="9grid"`：
 *   `ct_bubble_bg`        ← `frame_01_9gong`        `160,127,57,50`  → LRTB (160,153,127,115)
 *   `ct_black_box`        ← `末日_公用_九宫格_黑色框`   `10,10,10,10`    → LRTB (10,10,10,10)
 *   `ct_input_bg`         ← 输入框底（FGUI 原始 scale9grid 未记档）→ LRTB (19,12,18,10)
 *   `ct_recruit_bg`       ← `biaoq_BG`              `167,145,117,14` → LRTB (167,136,145,130)
 *   `ct_join_btn`         ← `TY_btn21`              `56,19,112,38`   → LRTB (56,56,19,22)
 *   `fd_row_bg`(复用)     ← `frame_Zhikuang06`      `12,12,292,119`  → LRTB (12,13,12,11)
 *   `fd_panel_bg`(复用)   ← `panel_window_01_9gong` `129,128,123,36` → LRTB (129,142,128,143)
 *   `fd_btn_gold`(复用)   ← `TY_btn06`              （好友轮已落档）  → LRTB (14,11,66,54)
 *   `title_brown`(复用)   ← `title_brown`           `171,20,16,40`   → LRTB (171,16,20,40)
 *
 * 非九宫：44 张 emoji、`ct_at_btn`、`ct_bq_btn`、`ct_close_02`、`ct_main_chat`、`img_Touxiang_01`。
 */
export const CHAT_ART_SLICED: ReadonlySet<string> = new Set<string>([
    CHAT_ART_BUBBLE_BG,
    CHAT_ART_BLACK_BOX,
    CHAT_ART_INPUT_BG,
    CHAT_ART_RECRUIT_BG,
    CHAT_ART_JOIN_BTN,
    CHAT_SHARED_HEAD_BOX_NAME,
    CHAT_SHARED_POPUP_BG_NAME,
    CHAT_SHARED_SEND_NAME,
    CHAT_SHARED_TITLE_BG_NAME,
]);

/** 九宫格图名 → 所在目录（`chatSpriteType` 之外还要知道去哪张 meta 上核边框）。 */
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

/** `cc.Sprite._type`：`SIMPLE = 0` / `SLICED = 1`；`_sizeMode` 恒为 `CUSTOM = 0`。 */
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
 * 富文本里 `<img src='...'/>` 用的路径。
 *
 * ⚠️ 必须是**完整资源路径**（`resources` 相对路径），不是裸图名 ——
 *    裸名会让 `cc.RichText` 静默不渲染那张图（同 MEMORY 规则 57 的 `/spriteFrame` 坑）。
 * ⚠️ 表情项是**小图**，`cc.RichText` 的 img 只要 spriteFrame 即可，这里给到 `spriteFrame` 后缀。
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
// 置灰（老端 `grayed` 的近似，口径同 `FriendArt`）
// ============================================================

/** ⚠️ FGUI 的 `grayed` 是真灰度滤镜；Cocos 没有内置灰度 ⇒ 用灰色 tint 近似（有意偏离）。 */
export const CHAT_TINT_NORMAL: readonly [number, number, number] = [255, 255, 255];
export const CHAT_TINT_GRAY: readonly [number, number, number] = [132, 132, 132];

/** 按是否置灰取 tint（唯一入口，避免各处写魔数）。 */
export function chatTint(gray: boolean): readonly [number, number, number] {
    return gray ? CHAT_TINT_GRAY : CHAT_TINT_NORMAL;
}
