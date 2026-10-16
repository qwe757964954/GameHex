/**
 * 物品详情模块（`主界面_角色/组件/道具`）美术的**唯一入口**。
 *
 * 约定（对齐 `RoleArt` / `HangArt` / `CelebrationArt`）：
 *  - value 是**相对 `assets/resources/image/`** 的路径（不带扩展名、不带 `/spriteFrame`）；
 *  - 取图必须走 `ID_ART_NAMES` + `ArtPaths.spriteFramePathOf()`（`resources.load` **必须带
 *    `/spriteFrame`**，漏了只会静默留白 + 一条 warn）；
 *  - `ID_ART_SLICED` 必须与 `.png.meta` 的 border 一一对应（`tmp/gen_itemdetail.mjs` 双向对账）。
 *
 * 迁移来源：老端 FGUI `公用0/图片/框体_frame`（主底板 / 行底 / 品质缎带）。
 * 共用图（按钮 / 红点 / 品质框 / 箭头）**不另存第二份**，直接指已有路径。
 */

/** 本模块自有图目录（`assets/resources/image/itemdetail`）。 */
export const ID_ART_DIR = 'itemdetail';

/** 全部图的 key → 相对 `image/` 的路径。 */
export const ID_ART_NAMES: Readonly<Record<string, string>> = {
    // ---------- 本模块自有（image/itemdetail）----------
    /** 主底板 620×656（老端 `tybg`，九宫 155,164,310,328；FGUI 实例显示 515×709）。 */
    panelBg: 'itemdetail/id_panel_bg',
    /** 行底 / 描述条 407×103（老端 `tycb_pt`，九宫 101,25,104,28；实例显示 469×70 / 466×61）。 */
    rowBg: 'itemdetail/id_row_bg',
    /** 品质缎带 344×81 —— 7 档（FGUI 控制器「品质」的 gearIcon）。 */
    titleGray: 'itemdetail/id_title_gray',
    titleGreen: 'itemdetail/id_title_green',
    titleBlue: 'itemdetail/id_title_blue',
    titlePurple: 'itemdetail/id_title_purple',
    titleYellow: 'itemdetail/id_title_yellow',
    titleRed: 'itemdetail/id_title_red',
    titleCaise: 'itemdetail/id_title_caise',

    // ---------- 共用（image/common）----------
    /** 二级按钮底：灰（`TY_btn10`，FGUI 多颜色按钮 `颜色=0`）。 */
    btn2Gray: 'common/cu_ty_btn10',
    /** 二级按钮底：绿（`TY_btn21`，`颜色=1` —— 物品详情三个按钮都用这一档）。 */
    btn2Green: 'common/cu_ty_btn21',
    /** 二级按钮底：蓝（`TY_btn22`，`颜色=3`）。 */
    btn2Blue: 'common/cu_ty_btn22',
    /** 二级按钮底：红（`TY_btn24`，`颜色=4`）。 */
    btn2Red: 'common/cu_ty_btn24',
    /** 普通红点 29×28（`公用_图标_红点`；与 `cm_red_dot`/`cu_icon_dot` 同款，取工程既有的那张）。 */
    redDot: 'common/cm_red_dot',

    /**
     * 途径行的箭头 50×71（老端 `公用0/图片/散件_img/img_Jiantou_04`，
     * FGUI `scale="-0.5,0.5"` ⇒ 水平翻转后贴右）。
     *
     * ⚠️ **不能复用 `image/matching/img_Jiantou_04.png`** —— 那是**同名不同图**
     * （32×46，给别的模块用的）。2026-09-25 实测：`compile()` 按原图尺寸对账时直接炸
     * 「FGUI 的 img_Jiantou_04 是 50×71，而 matching/img_Jiantou_04 原尺寸 32×46」
     * —— 这正是「美术映射按尺寸反查」这道防线存在的理由。
     */
    arrow: 'itemdetail/id_arrow',
};

/**
 * 需要 `Sprite._type = SLICED(1)` 的图（= `.png.meta` 里 border 有任意一条非 0）。
 * ⚠️ 不是第二真源：`tmp/gen_itemdetail.mjs` 会与 `.meta` 双向对账，不一致直接 fail。
 *
 * 注意 `btn2Blue` / `btn2Red`（`TY_btn22` / `TY_btn24`）**不在**名单里 —— 它们的
 * `scale9grid` 是 null（FGUI 无九宫），迁过来时 meta 的 border 也全 0。
 * 而 `btn2Gray`(TY_btn10) / `btn2Green`(TY_btn21) 有 border，才进 SLICED。
 */
export const ID_ART_SLICED: ReadonlySet<string> = new Set<string>([
    'panelBg',    // tybg          border 155,164,155,164
    'rowBg',      // tycb_pt       border 101,25,104,28
    'titleGray',  // title_gray    border 170,26,146,34
    'titleGreen', // title_green   border 178,30,144,36
    'titleBlue',  // title_blue    border 169,29,158,40
    'titlePurple',// title_purple  border 162,24,147,40
    'titleYellow',// title_yellow  border 165,23,144,41
    'titleRed',   // title_red     border 168,27,145,37
    'titleCaise', // title_caise   border 176,26,147,42
    'btn2Gray',   // TY_btn10      border 54,0,149,0
    'btn2Green',  // TY_btn21      border 56,19,56,22
]);

/** 品质缎带的 key（按 `ItemDetailTable.TITLE_ART_STEPS` 的顺序 1:1）。 */
export const ID_TITLE_KEYS: readonly string[] = [
    'titleGray', 'titleGreen', 'titleBlue', 'titlePurple', 'titleYellow', 'titleRed', 'titleCaise',
];

/**
 * 需要 `Sprite._type = TILED(2)` 的图 —— FGUI `scale="tile"` 平铺。
 *
 * 本模块**一张都没有**（底板 / 缎带 / 按钮全是九宫或普通图）。
 * 但这个常量必须存在：生成器内核 `tmp/_fguilib.mjs` 的 `createLib()` 会
 * `readArtSet(opts.tiledConst)`，缺了直接 `throw`。
 * ⚠️ 写法必须带 `([`（`new Set<string>([])`）—— 内核的正则是
 * `new Set<string>\(\[([\s\S]*?)\]\)`，写成无参的 `new Set<string>()` 匹配不上。
 */
export const ID_ART_TILED: ReadonlySet<string> = new Set<string>([]);

/** 品质缎带的图路径（`quality` 1..7；越界给灰）。 */
export function titleArtPathOf(titleStep: string): string {
    const map: Readonly<Record<string, string>> = {
        gray: ID_ART_NAMES.titleGray,
        green: ID_ART_NAMES.titleGreen,
        blue: ID_ART_NAMES.titleBlue,
        purple: ID_ART_NAMES.titlePurple,
        yellow: ID_ART_NAMES.titleYellow,
        red: ID_ART_NAMES.titleRed,
        caise: ID_ART_NAMES.titleCaise,
    };
    return map[titleStep] ?? ID_ART_NAMES.titleGray;
}

// ============================================================
// 物品框品质框（8 档，跨模块共用 ⇒ 放 image/common）
// ============================================================

/** 品质框图目录（`assets/resources/image/common`）。 */
export const QUALITY_FRAME_ART_DIR = 'common';

/** 品质框档位 → 相对 `image/` 的路径（`quality` 1..8）。 */
export function qualityFrameArtPath(suffix: string): string {
    return `${QUALITY_FRAME_ART_DIR}/cu_quality_${suffix}`;
}
