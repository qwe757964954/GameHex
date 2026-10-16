/**
 * 个人信息五弹窗（个人信息 / 他人信息 / 更换头像 / 改名）+ 设置面板美术的**唯一入口**
 * （纯数据、零 `cc`）。
 *
 * 零 `cc` 的理由与 `MainTaskArt` / `ItemDetailArt` 完全一致：本文件零 `cc` ⇒ 单测能直接
 * import 它做「映射 ↔ 磁盘文件 ↔ `.meta` border」三向对账；一旦出现 `import { resources }`
 * 整个用例文件会 `Cannot find module 'cc'` **静默失效**（规则 78）。
 *
 * 迁移来源（老端 `D:/City1001/zarts/art/UIProject/trunk/UIProject/assets/`）：
 *   公共图直接指 `image/common/**`（**不另存第二份**，与其他模块共用同一份文件）；
 *   本模块自有图见 `tmp/_copy_playerinfo_art.py`（20 条）+ `tmp/_copy_playerinfo_art2.py`（2 条），
 *   九宫见 `tmp/_set_playerinfo_border.py`。
 *
 * ⚠️ 图的**原尺寸**必须与 FGUI 包条目逐条相等 —— `tmp/_role_fgui.mjs` 的 `compile()`
 * 会按 `art.rawW !== n.art.w` 反查对账，错一张直接 throw（这就是「同名不同图」的防线：
 * 老端 `bb_pic11.png` 就有 38×38 与 345×83 两个不同版本）。
 */

/** 本模块自有图目录（`assets/resources/image/playerinfo`）。 */
export const PI_ART_DIR = 'playerinfo';

/**
 * 全部图的 key → 相对 `assets/resources/image/` 的路径（不带扩展名）。
 */
export const PI_ART_NAMES: Readonly<Record<string, string>> = {
    // ---------- 公共（`image/common`，与主线任务 / 物品详情共用同一份）----------
    /** 公共弹窗底 394×307（老端 `panel_window_01_9gong`，九宫 129,128,123,36）。 */
    panelWindow: 'common/cu_panel_window_01_9gong',
    /** 标题缎带 344×81（老端 `title_brown`，九宫 171,20,16,40）。 */
    titleBrown: 'common/cu_title_brown',
    /** 关闭按钮 60×60（老端 `公用_按钮_关闭01`，**无九宫**）。 */
    btnClose: 'common/cu_btn_close_01',
    /** 小标题条 233×31（老端 `BB_img03`，九宫 58,0,59,0）。 */
    sectionBar: 'common/cu_bb_img03',
    /** 9Gone 系按钮底 83×77（老端 `TY_btn07`，九宫 15,11,64,57）。 */
    btn9Gone: 'common/cu_ty_btn07',
    /** 灰色按钮底 210×77（老端 `TY_btn10`，九宫 54,0,149,0）。 */
    btn2Gray: 'common/cu_ty_btn10',
    /**
     * 「一级按钮」**绿**底 218×69（老端 `TY_btn28`，**无九宫** —— `.meta` 四条 border 全 0）。
     *
     * 为什么会用到它：`按钮_公共_多颜色_一级_变暗` 的 `颜色` 控制器
     * `pages="3,黄,1,绿,0,灰,4,红"`，四张底图分别是
     * `TY_btn21(224×79) | TY_btn28(218×69) | TY_btn29(218×69) | TY_btn24(224×79)`；
     * 布局引擎只认**组件定义期**的页（`selected="0"` ⇒ 灰 `TY_btn29`），**不处理实例上的
     * `controller="颜色,N"`** ⇒ 实例指定绿/黄时必须由生成器 `inline` 逐节点改写。
     * 出处：`个人信息/组件/更换昵称/组件_个人信息_更换昵称界面.xml` 的 `按钮_免费`。
     */
    btnPrimaryGreen: 'common/cu_ty_btn28',
    /**
     * 「一级按钮」**黄**底 224×79（老端 `TY_btn21`，九宫 56,19,56,22）。
     * 出处：`个人信息/组件/更换头像/组件_个人信息_更换头像界面.xml` 的 `btn_confirm`
     * 带 `controller="颜色,3"`（3 = 黄）。
     */
    btnPrimaryYellow: 'common/cu_ty_btn21',
    /** 红点 29×28（老端 `公用_图标_红点`）。 */
    redDot: 'common/cm_red_dot',
    /** 头像项底 84×77（老端 `bb_pic21`，九宫 11,12,61,54）。 */
    headItemBg: 'common/cu_bb_pic21',
    /** 选中框 110×110（老端 `icon_fg_selected`，九宫 27,27,29,29）。 */
    headSelected: 'common/cu_icon_fg_selected',
    /** 装备格底 620×656（老端 `tybg`，九宫 155,164,155,164）。 */
    equipBg: 'common/cu_tybg',
    /** 宝石底 20×20（老端 `icon_fw_s_bg`，**无九宫**）。 */
    gemBg: 'common/cu_icon_fw_s_bg',

    // ---------- 个人信息（`组件_个人信息_主界面`）----------
    /** 头像框底 73×73（老端 `img_Touxiang_01`，**无九宫**；FGUI 元素 110×110 直接拉伸）。 */
    headFrame: 'playerinfo/pi_head_frame',
    /** 名字底条 616×71（老端 `BY_wenzi_bg02`，九宫 154,17,154,20）。 */
    nameBg: 'playerinfo/pi_name_bg',
    /** 改名铅笔 64×64（老端 `btn_BianJi`，**无九宫**）。 */
    editIcon: 'playerinfo/pi_btn_edit',
    /** 经验条底 384×22（老端 `bar_hp_bg`，九宫 95,9,95,9）。 */
    progressBg: 'playerinfo/pi_progress_bg',
    /** 经验条填充 384×22（老端 `bar_hp_fg`，九宫 96,7,96,7）。 */
    progressFg: 'playerinfo/pi_progress_fg',
    /** 兑换码输入框底 90×47（老端 `frame_SouSuokuang02`，九宫 22,11,24,14）。 */
    inputBg: 'playerinfo/pi_input_bg',
    /** 输入框九宫底 30×30（老端 `公用_九宫_输入框01`，九宫 14,13,12,14）。 */
    input9g: 'playerinfo/pi_9g_input',
    /** 内容底框九宫 30×30（老端 `公用_九宫_内容底框01`，九宫 14,13,11,12）。 */
    content9g: 'playerinfo/pi_9g_content',

    // ---------- 他人信息（`组件_查看信息_界面`）----------
    /** 他人信息弹窗底 600×464（老端 `wjxx5`，九宫 150,116,150,116）。 */
    otherPanel: 'playerinfo/pi_other_panel',
    /** 内嵌大图 543×461（老端 `wjxx6`，**无九宫**）。 */
    otherPic: 'playerinfo/pi_other_pic',
    /** 顶部标题牌 458×112（老端 `tou`，九宫 0,0,46,12）。 */
    otherTitle: 'playerinfo/pi_other_title',
    /** 联盟底 511×129（老端 `wjxx4`，**无九宫**）。 */
    otherUnion: 'playerinfo/pi_other_union',
    /** 拉黑图标 45×53（老端 `wjxx3`，**无九宫**）。 */
    otherBlack: 'playerinfo/pi_other_black',
    /** 属性条 345×83（老端 `bb_pic11`，九宫 2,0,343,83 ⇒ 只左 2px）。 */
    otherBar: 'playerinfo/pi_other_bar',
    /** 私聊图标 64×64（老端 `btn_LiaoTian`，**无九宫**）。 */
    chatIcon: 'playerinfo/pi_btn_chat',

    // ---------- 设置（`组件_设置`）----------
    /** 开关底槽 370×292（老端 `frame_04_9gong`，九宫 130,111,120,103；实例 180×40）。 */
    switchBg: 'setting/st_switch_bg',
    /** 开关滑块 92×44（老端 `btn_green_9Gong`，**无九宫**）。 */
    switchKnob: 'setting/st_switch_knob',
    /** 音量条底 66×22（老端 `bar_set_bg_3gong`，九宫 26,9,26,9；实例 246×22）。 */
    sliderBg: 'setting/st_slider_bg',
    /** 音量条填充 66×22（老端 `bar_set_fg_3gong`，九宫 16,9,18,7）。 */
    sliderFg: 'setting/st_slider_fg',
    /** 音量滑块头 40×40（老端 `btn_slider_01`，**无九宫**）。 */
    sliderGrip: 'setting/st_slider_grip',
    /** 音乐图标 80×80（老端 `sz_img_YinYue`，**无九宫**）。 */
    iconMusic: 'setting/st_icon_music',
    /** 音效图标 80×80（老端 `sz_img_YinXiao`，**无九宫**）。 */
    iconSound: 'setting/st_icon_sound',
};

/**
 * 需要 `cc.Sprite._type = SLICED(1)` 的图（= `.png.meta` 的 border 有任意一条非 0）。
 * ⚠️ 不是第二真源：`tmp/_fguilib.mjs` 的 `emit()` 自检③ 会与 `.meta` **双向对账**，
 * 这里写了而 `.meta` 没打（或反之）都会直接 fail。
 */
export const PI_ART_SLICED: ReadonlySet<string> = new Set<string>([
    'panelWindow',  // common/cu_panel_window_01_9gong  129,128,142,143
    'titleBrown',   // common/cu_title_brown           171,20,157,21
    'sectionBar',   // common/cu_bb_img03              58,0,59,0
    'btn9Gone',     // common/cu_ty_btn07              15,11,64,57
    'btn2Gray',     // common/cu_ty_btn10              54,0,149,0
    'btnPrimaryYellow', // common/cu_ty_btn21          56,19,56,22
    // ⚠️ `btnPrimaryGreen`（cu_ty_btn28）**不进**本名单：它的 `.meta` 四条 border 全 0，
    //    而 `tmp/_fguilib.mjs` 的 `emit()` 自检③ 与 `.meta` **双向对账** ⇒ 写了会 fail。
    'headItemBg',   // common/cu_bb_pic21              11,12,61,54
    'headSelected', // common/cu_icon_fg_selected      27,27,29,29
    'equipBg',      // common/cu_tybg                  155,164,155,164
    'nameBg',       // playerinfo/pi_name_bg           154,17,154,20
    'progressBg',   // playerinfo/pi_progress_bg       95,9,95,9
    'progressFg',   // playerinfo/pi_progress_fg       96,7,96,7
    'inputBg',      // playerinfo/pi_input_bg          22,11,24,14
    'input9g',      // playerinfo/pi_9g_input          14,13,12,14
    'content9g',    // playerinfo/pi_9g_content        14,13,11,12
    'otherPanel',   // playerinfo/pi_other_panel       150,116,150,116
    'otherTitle',   // playerinfo/pi_other_title       0,0,46,12
    'otherBar',     // playerinfo/pi_other_bar         2,0,0,0
    'switchBg',     // setting/st_switch_bg            130,111,120,103
    'sliderBg',     // setting/st_slider_bg            26,9,26,9
    'sliderFg',     // setting/st_slider_fg            16,9,18,7
]);

/**
 * 平铺图 —— 本模块一张都没有。
 * 但 `tmp/_fguilib.mjs` 的 `createLib()` 会 `readArtSet(opts.tiledConst)`，缺了直接 `throw`；
 * ⚠️ 写法必须带 `([`，否则内核正则匹配不上。
 */
export const PI_ART_TILED: ReadonlySet<string> = new Set<string>([]);
