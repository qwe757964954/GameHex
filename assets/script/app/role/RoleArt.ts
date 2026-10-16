/**
 * 角色模块（背包 / 天赋 / 宝物 / 共鸣）美术的**唯一入口**。
 *
 * 约定（对齐 `HangArt.ts` / `GiftArt.ts` / `BattleTokenArt.ts`）：
 *  - 这里的 value 是**相对 `assets/resources/image/` 的路径（不带扩展名）**
 *    （**例外**：`icons/**` 那几条已经是相对 `assets/resources/` —— `icons/` 与 `image/` 平级）；
 *  - 取图走 `roleArtRelPath(key)` + `ArtPaths.spriteFramePathOf()`：
 *    🔴 **拼 `image/` 前缀**和**补 `/spriteFrame`**是两件事，缺一件都报同一个错
 *    `Bundle resources doesn't contain xxx`，且只是静默留白 + 一条 warn
 *    （庆典那轮 2026-09-28 漏前缀，装备锻造页签图标那两条则是**多拼**前缀）；
 *  - `RL_ART_SLICED` 必须与 `.png.meta` 的 border 一一对应（`tmp/gen_role.mjs` 会双向对账）。
 *
 * 迁移来源（老端 FGUI）：`主界面_角色` / `民兵` / `宝物` 三包 + `公用0` / `共用组件` 的共用图。
 * 前缀：`rl_` = 主界面_角色，`ml_` = 民兵，`at_` = 宝物，`cu_` = 共用（公用0 / 共用组件）。
 */
export const RL_ART_NAMES = {
    // ---------- 角色背包页（image/role）----------
    /** 整屏底图 720×2015（老端 `js_img_bg`） */
    bg: 'role/rl_js_img_bg',
    /** 右侧装备区底板 441×749（老端 `frame_window_02_9gong`，**未配 9 宫**） */
    equipPlate: 'role/rl_frame_window_02_9gong',
    /** 战斗力底条 345×83（老端 `bb_pic11`，9 宫 2,0,343,83） */
    powerBar: 'role/rl_bb_pic11',
    /** 新手引导气泡 164×66（老端 `frame_qipao1`，9 宫 87,16,36,20） */
    qipao: 'role/rl_frame_qipao1',
    /** 左钮标题底 `zg_pic24` 76×34（`标题底=1` 时显示，默认关） */
    navTitleBg: 'role/rl_zg_pic24',
    // 左钮图标（老端 `按钮_角色_通用` 的 `icon`）
    icoHero: 'role/rl_yx',
    icoMilitia: 'role/rl_tf',
    icoGuards: 'role/rl_jj',
    icoGongMing: 'role/rl_gm',
    icoPreview: 'role/rl_bs',
    icoArtifact: 'role/rl_sq',

    // ---------- 天赋页（image/militia）----------
    talentBg: 'militia/ml_tf_img_bg01',
    talentBarBg: 'militia/ml_tf_bar01_bg',
    talentBarFg: 'militia/ml_tf_bar_fg_3gong',
    /** 天赋节点底 `tf_icon_bg03`（未解锁态） */
    talentNodeBg: 'militia/ml_tf_icon_bg03',
    /** 天赋节点底 `tf_icon_bg01`（解锁 / 当前 态 ⇒ FGUI `gearIcon{状态=1,4}`） */
    talentNodeOn: 'militia/ml_tf_icon_bg01',
    /** 天赋节点当前态外发光 `tf_icon_bg02`（`gearDisplay{状态=4}`） */
    talentNodeCurrent: 'militia/ml_tf_icon_bg02',
    talentAttrIcon: 'militia/ml_tf_icon_tian_fu_shu_xing',

    // ---------- 宝物页（image/artifact）----------
    artifactPlate: 'artifact/at_bw14',
    artifactPlate2: 'artifact/at_bw15',
    artifactCell: 'artifact/at_bw11',
    artifactCellBg: 'artifact/at_bw1',
    artifactDeco: 'artifact/at_bw9',
    artifactDeco2: 'artifact/at_bw10',
    artifactDefaultIcon: 'artifact/at_treasure_1',
    /** 坑位底条 `bw12` 116×55（`宝物_坑位_item` 的 `n1`） */
    artifactSlotBar: 'artifact/at_bw12',
    /** 碎片角标 `suipian` 32×33 */
    fragment: 'artifact/at_suipian',

    // ---------- 星级（组件_公用_星级，45×42 / 41×38）----------
    starBg: 'common/cu_img_star_bg',
    starFg: 'common/cu_img_star_fg',
    /** 高星（8~17 星）用的两种特殊星（`zg_pic04_1/2`） */
    starSpecial1: 'common/cu_zg_pic04_1',
    starSpecial2: 'common/cu_zg_pic04_2',

    // ---------- 共用（image/common）----------
    title07: 'common/cu_title_07',
    tybg: 'common/cu_tybg',
    /**
     * 底栏页签底板 —— **两态两张图**（老端 `按钮_角色_页签` 的 `gearIcon`/`gearXY`/`gearSize`）：
     *   - `up`（控制器 `button` 页 id `1`，= 设计期 `selected`）⇒ `js_tab_01`，`xy=(23,4)`，尺寸 **153×59**
     *   - `down`（页 id `0`）⇒ `TY_btn30`，`xy=(0,-2)`，尺寸 191×66
     * ⚠️ 2026-09-24 更正：先前把两者**写反了**（以为 up=TY_btn30）。真源 = `fairygui.js` 的 gear 语义 +
     * `tmp/_fgui_layout.mjs` 引擎复算（`按钮_角色_页签/icon` = `(23,4,153,59)`）。
     */
    tabBgUp: 'role/rl_js_tab_01_9g',
    tabBgDown: 'common/cu_ty_btn30',
    navPlate: 'common/cu_bb_pic20_sj',
    /**
     * 右侧宝石页签的选中 / 未选中底图（`按钮_角色_装备分页.xml`）。
     *
     * ⚠️ 2026-09-24 更正：**与直觉相反**，`gearDisplay 选中` 的可见页是
     *   `n14` = `bb_pic20` → 页 `1`=「否」（**未选中**）
     *   `n15` = `bb_pic21` → 页 `0`=「是」（**选中**）
     * ⇒ 先前把两者写反了（以为 pic20 = on）。两张图几何相同（64×60 @ 0,0），
     * 运行时只切节点 `active`，不需要改尺寸。
     */
    pageTabOn: 'common/cu_bb_pic21',
    pageTabOff: 'common/cu_bb_pic20',
    iconLock: 'common/cu_icon_lock_01',
    iconEdit: 'common/cu_bb_pic24',
    btn9Gone: 'common/cu_ty_btn07',
    /** 9Gone 的另一配色 `TY_btn06` 84×77（`颜色=Orange`） */
    btn9GoneAlt: 'common/cu_ty_btn06',
    btnFilter: 'common/cu_ty_btn09',
    redDot: 'common/cu_icon_dot',
    bossBar: 'common/cu_bb_img03',
    marker: 'common/cu_bb_pic18',
    arrowDown: 'common/cu_img_jian_tou_01',
    arrowUp: 'common/cu_img_jian_tou_02',
    arrowUpList: 'common/cu_img_jian_tou_05',
    frame1: 'common/cu_frame_zhikuang01',
    frame4: 'common/cu_frame_zhikuang04',
    frame6: 'common/cu_frame_zhikuang06',
    panel: 'common/cu_panel_window_01_9gong',
    /** 弹窗标题底 `title_brown` 344×81 */
    panelTitle: 'common/cu_title_brown',
    btnClose: 'common/cu_btn_close_01',
    btnBack: 'common/cu_btn_fan_hui',
    barBg: 'common/cu_9g_bar_01_bg',
    barFill: 'common/cu_9g_bar_02',
    barTextBg: 'common/cu_icon_top_frame_bg',
    maskCorner: 'common/cu_frame_white_zhijiao',
    /** 属性行底 `list_02_9gong` 20×20 */
    listRow: 'common/cu_list_02_9gong',
    /** 细边条 `bw8` 162×44 */
    bar8: 'common/cu_bw8',
    selEdge: 'common/cu_icon_fg_selected',
    selEdge2: 'common/cu_icon_fg1',
    tagStar: 'common/cu_tag_star',
    tagEquipped: 'common/cu_tag_zhuang_bei_zhong',
    tagCheck: 'common/cu_tag_gou',
    diban: 'common/cu_diban_bg',
    coinMin: 'common/cu_icon_coin_min',

    // ---------- 二级按钮 `按钮_公共_多颜色_二级_变暗`（160×60 底，实例尺寸覆写）----------
    btn2Gray: 'common/cu_ty_btn10',
    btn2Green: 'common/cu_ty_btn21',
    btn2Blue: 'common/cu_ty_btn22',
    btn2Red: 'common/cu_ty_btn24',
    // ---------- 二级按钮 `_变暗狂欢`（尺寸 147~218×66~69）----------
    btn2Gray2: 'common/cu_zb_btn02',
    btn2Blue2: 'common/cu_ty_btn27',

    // ---------- 装备锻造页（`组件_装备锻造_主界面` + `_洗练分页`，2026-09-26 移植）----------
    evoBg: 'role/rl_zhuangbei_bg',            // zhuangbei_bg 720×1280（锻造主背景）
    evoFrame: 'role/rl_frame_dikuang03',      // frame_Dikuang03 九宫 147,110,100,112（主容器外框）
    evoPlate: 'role/rl_frame_01_9gong',       // frame_01_9gong 九宫 160,127,57,50（内板）
    // ⚠️ `evoPlate` 必须用 rl_ 这份：工程里 image/chat/ct_bubble_bg.png 与它 **md5 同源但 border 不同**
    //    （160,127,153,115 vs FGUI 的 160,127,57,50），而复用会按 chat 的拉伸口径走 ⇒ 另存一份。
    evoNameBar: 'role/rl_tital_05',           // tital_05 299×97（装备名条）
    evoArrowUp: 'role/rl_arrow_up_03',        // img_JianTou_03（强化/升品箭头）
    evoArrow: 'role/rl_icon_arrow_01',        // 公用_图标_箭头01（洗练前后箭头）
    evoBtnWash: 'role/rl_btn_wash',           // ZB_btn01 九宫 59,25,24,15（升品分页「洗练」按钮）
    // —— 以下 6 张与工程已有图 md5 同源 ⇒ 跨模块复用，不另存 ——
    evoTitle: 'activity/act_title',           // = title_02 359×93（无九宫）
    evoHelp: 'celebration/os_zx_btn01',       // = zx_btn01 61×62（升品说明按钮）
    evoTabOn: 'common/cu_ty_btn13',           // = TY_btn13 168×132（底部页签·选中）
    evoTabOff: 'common/cu_ty_btn14',          // = TY_btn14 168×132（底部页签·未选中）
    // 图标在 `icons/` 根（与 `image/` 同一套 resources 路径规则，见 ArtPaths 的 ICON_ART_ROOT）
    evoIcoOn: 'icons/main/icon_qianghua',     // = icon_qianghua 80×100
    evoIcoOff: 'icons/main/icon_qianghua_02', // = icon_qianghua_02 64×80

    // ---------- 宝石品质（组件_公用_装备宝石，18×20，7 色）----------
    gemBg: 'common/cu_icon_fw_s_bg',
    gemWhite: 'common/cu_icon_fw_s_white',
    gemGreen: 'common/cu_icon_fw_s_green',
    gemBlue: 'common/cu_icon_fw_s_blue',
    gemPink: 'common/cu_icon_fw_s_pink',
    gemRed: 'common/cu_icon_fw_s_red',
    gemYellow: 'common/cu_icon_fw_s_yellow',
    gemGold: 'common/cu_icon_fw_s_gold',

    // ---------- 品质框（跨模块同源，100×100 物品框专用）----------
    quality1: 'frame/common_img_pzk_01',
    quality2: 'frame/common_img_pzk_02',
    quality3: 'frame/common_img_pzk_03',
    quality4: 'frame/common_img_pzk_04',
};

/** `RL_ART_NAMES` 里所有图的 key（生成器 / 单测用来做「有没有漏摆」的反向对账）。 */
export const RL_ART_ALL_KEYS = Object.keys(RL_ART_NAMES);

// ============================================================
// 装配路径（`resources.load` 口径）
// ============================================================

/** 角色模块美术的根（绝大多数 value 相对它；与 `CelebrationArt.OS_ART_ROOT` 同一口径）。 */
export const RL_ART_ROOT = 'image';

/** `icons/` 与 `image/` **平级**，本来就相对 `assets/resources/` ⇒ 不能再拼 `RL_ART_ROOT`。 */
export const RL_ICON_ROOT_PREFIX = 'icons/';

/**
 * key → **相对 `assets/resources/`** 的路径（不带扩展名、`/spriteFrame` 由调用方补）。
 *
 * 🔴 这一步必须在**零 `cc`** 的模块里：拼错了不崩、只留白，只有单测逐条对磁盘才逮得到。
 * 分两支：
 *  | value 形如 | 例子 | 结果 |
 *  |---|---|---|
 *  | `role/…` `common/…` `frame/…` `activity/…` `celebration/…` | `role/rl_zhuangbei_bg` | `image/role/rl_zhuangbei_bg` |
 *  | `icons/**`（与 `image/` 平级） | `icons/main/icon_qianghua` | 原样，**不拼前缀** |
 */
export function roleArtRelPath(key: string): string {
    const rel = (RL_ART_NAMES as Readonly<Record<string, string>>)[key];
    if (!rel) return '';
    return rel.startsWith(RL_ICON_ROOT_PREFIX) ? rel : `${RL_ART_ROOT}/${rel}`;
}

/**
 * 需要 `Sprite._type = SLICED(1)` 的图（= `.png.meta` 里 border 有任意一条非 0）。
 * ⚠️ 这份名单**不是**第二真源：`tmp/gen_role.mjs` 会把它和 `.meta` 双向对账，
 * 不一致直接 fail。改图（或改九宫）后必须同步。
 */
export const RL_ART_SLICED = new Set<string>([
    'powerBar',       // bb_pic11      border 2,0,0,0
    'qipao',          // frame_qipao1  border 87,16,41,30
    'talentBg',       // tf_img_bg01   border 180,320,180,320
    'artifactPlate',  // bw14          border 176,436,166,107
    'artifactPlate2', // bw15          border 162,149,164,151
    'tybg',           // tybg          border 155,164,155,164
    'pageTabOn',      // bb_pic20      border 13,11,62,60
    'pageTabOff',     // bb_pic21      border 11,12,61,54
    'btn9Gone',       // TY_btn07      border 15,11,64,57
    'btn9GoneAlt',    // TY_btn06      border 14,11,66,54
    'btnFilter',      // TY_btn09      border 59,0,144,0
    'btn2Gray',       // TY_btn10      border 54,0,149,0
    'btn2Green',      // TY_btn21      border 56,19,56,22
    'btn2Gray2',      // ZB_btn02      border 51,23,55,26
    'btn2Blue2',      // TY_btn27      border 54,17,56,18
    'tabBgUp',        // js_tab_01     border 8,11,189,71（207×84，页签 up 态）
    'bossBar',        // BB_img03      border 58,0,59,0
    'frame1',         // frame_Zhikuang01 border 38,28,41,29
    'frame6',         // frame_Zhikuang06 border 12,12,13,11
    'panel',          // panel_window_01_9gong border 129,128,142,143
    'panelTitle',     // title_brown   border 171,20,157,21
    'barBg',          // 九宫_进度条01底 border 18,10,15,11
    'barFill',        // 九宫_进度条02   border 20,11,18,10
    'maskCorner',     // frame_white_zhijiao border 1,1,5,5
    'listRow',        // list_02_9gong border 7,6,9,8
    'bar8',           // bw8           border 40,11,42,11
    'selEdge',        // icon_fg_selected border 27,27,29,29
    'diban',          // diban_BG      border 347,69,607,136
    // 装备锻造（2026-09-26）—— border 已按 FGUI `scale9grid` 写进 .png.meta（tmp/_equip_border_check.mjs 对账）
    'evoFrame',       // frame_Dikuang03 border 147,110,100,112
    'evoPlate',       // frame_01_9gong  border 160,127,57,50
    'evoBtnWash',     // ZB_btn01        border 59,25,24,15
]);

/**
 * `Sprite._type = TILED(2)` 的图（FGUI `scale="tile"`）。
 * ⚠️ 这类图的 `.png.meta` border 全是 0 ⇒ 光看 border 判不出，**必须单独列**。
 */
export const RL_ART_TILED = new Set<string>(['talentBarBg']); // tf_bar01_bg，FGUI scale="tile" 38×95

/**
 * 品质框图（装备锻造「升品分页」的 `now` / `next` / `max` 三个品质角标）。
 *
 * 老端 = `组件_装备锻造_品质` 的 `loader n16` + `gearIcon` **17 页**，逐页换图
 * （`主界面_角色/图片/1.png` ~ `17.png`，59×29 / 59×31，无九宫）。
 * 这里不写 17 个 key（会淹掉 Art 表），改成**按品质值算路径** —— 运行时直接
 * `spriteFramePathOf(qualityIconPath(q))`。
 */
export const RL_QUALITY_MAX = 17;

/** 品质值 → 品质框图路径（超范围自动夹到 1..17）。 */
export function qualityIconPath(quality: number): string {
    const q = Math.min(Math.max(Math.round(quality) || 1, 1), RL_QUALITY_MAX);
    return `role/rl_quality_${String(q).padStart(2, '0')}`;
}
