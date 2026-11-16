/**
 * 物品详情模块（`主界面_角色/组件/道具`）的美术唯一入口，约定对齐 `RoleArt` / `CelebrationArt`：
 *   - value 是相对 `assets/resources/image/` 的路径（不带扩展名、不带 `/spriteFrame`）；
 *   - 取图统一走 `ID_ART_NAMES` + `ArtPaths.spriteFramePathOf()`，漏了 `/spriteFrame` 会静默留白；
 *   - `ID_ART_SLICED` 必须与 `.png.meta` 的 border 一致（`tmp/gen_itemdetail.mjs` 双向对账）。
 *
 * 图来自老端 FGUI `公用0/图片/框体_frame`；按钮 / 红点 / 品质框这些共用图直接指已有路径，
 * 不另存第二份。
 */

/** 本模块自有图目录（`assets/resources/image/itemdetail`）。 */
export const ID_ART_DIR = 'itemdetail';

/** 全部图的 key → 相对 `image/` 的路径。 */
export const ID_ART_NAMES: Readonly<Record<string, string>> = {
    // ---------- 本模块自有（image/itemdetail）----------
    /** 主底板 620×656（老端 `tybg`，九宫 155,164,310,328）；登录「选服」弹窗复用，故放 common。 */
    panelBg: 'common/id_panel_bg',
    /** 行底 / 描述条 407×103（老端 `tycb_pt`，九宫 101,25,104,28；实例显示 469×70 / 466×61）。 */
    rowBg: 'itemdetail/id_row_bg',
    /** 品质缎带 344×81，7 档；灰档与选服弹窗共用，放 common，其余 6 档在本目录。 */
    titleGray: 'common/id_title_gray',
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
    /** 普通红点 29×28（与工程既有的 `cm_red_dot` 同一张）。 */
    redDot: 'common/cm_red_dot',

    /**
     * 途径行箭头 50×71（老端 `公用0/图片/散件_img/img_Jiantou_04`，FGUI 水平翻转后贴右）。
     *
     * 不能复用 `image/matching/img_Jiantou_04.png`：那是同名不同图（32×46，给别的模块用的）。
     * 生成器按原图尺寸对账时会因此直接报错。
     */
    arrow: 'itemdetail/id_arrow',
};

/**
 * 需要 `Sprite._type = SLICED(1)` 的图（即 `.png.meta` 的 border 有非 0 项）。
 * 这不是第二真源：`tmp/gen_itemdetail.mjs` 会与 `.meta` 双向对账，不一致直接 fail。
 *
 * `btn2Blue` / `btn2Red` 不在名单里：它们的 FGUI `scale9grid` 是 null，meta 的 border 也全 0。
 */
export const ID_ART_SLICED: ReadonlySet<string> = new Set<string>([
    'panelBg',     // tybg          border 155,164,155,164
    'rowBg',       // tycb_pt       border 101,25,104,28
    'titleGray',   // title_gray    border 170,26,146,34
    'titleGreen',  // title_green   border 178,30,144,36
    'titleBlue',   // title_blue    border 169,29,158,40
    'titlePurple', // title_purple  border 162,24,147,40
    'titleYellow', // title_yellow  border 165,23,144,41
    'titleRed',    // title_red     border 168,27,145,37
    'titleCaise',  // title_caise   border 176,26,147,42
    'btn2Gray',    // TY_btn10      border 54,0,149,0
    'btn2Green',   // TY_btn21      border 56,19,56,22
]);

/** 品质缎带的 key（按 `ItemDetailTable.TITLE_ART_STEPS` 的顺序 1:1）。 */
export const ID_TITLE_KEYS: readonly string[] = [
    'titleGray', 'titleGreen', 'titleBlue', 'titlePurple', 'titleYellow', 'titleRed', 'titleCaise',
];

/**
 * 需要 `Sprite._type = TILED(2)` 的图 —— 本模块一张都没有。
 *
 * 这个常量必须存在：生成器内核 `tmp/_fguilib.mjs` 会读它，缺了直接 throw。
 * 写法必须是 `new Set<string>([])`：内核的正则匹配这个形态，无参的空 Set 匹配不上。
 */
export const ID_ART_TILED: ReadonlySet<string> = new Set<string>([]);

/** 缎带档位 → 图路径（未知档位回灰）。 */
const TITLE_ART_PATHS: Readonly<Record<string, string>> = {
    gray: ID_ART_NAMES.titleGray,
    green: ID_ART_NAMES.titleGreen,
    blue: ID_ART_NAMES.titleBlue,
    purple: ID_ART_NAMES.titlePurple,
    yellow: ID_ART_NAMES.titleYellow,
    red: ID_ART_NAMES.titleRed,
    caise: ID_ART_NAMES.titleCaise,
};

/** 品质缎带的图路径（`quality` 1..7；越界给灰）。 */
export function titleArtPathOf(titleStep: string): string {
    return TITLE_ART_PATHS[titleStep] ?? ID_ART_NAMES.titleGray;
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
