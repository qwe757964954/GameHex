export const BIGMAP_CONCEPT_ROOT = 'image/bigmap/concept';

export const BIGMAP_BUILDING_ART: Readonly<Record<number, string>> = {
    71001: 'headquarters',
    71002: 'farm',
    71003: 'sawmill',
    71004: 'ironworks',
    71005: 'warehouse',
    71006: 'water_tower',
    71007: 'construction',
    71008: 'rocks',
};

export const BIGMAP_UI_KEYS = ['header', 'detail', 'button', 'tab_idle', 'tab_active', 'badge', 'plot', 'stamina', 'home'] as const;
export type IBigMapUiKey = typeof BIGMAP_UI_KEYS[number];

/** 通用 UI 图根目录 —— 与领地页（`TerritoryPageAssets`）同一个 `image/common`。 */
export const BIGMAP_COMMON_ART_ROOT = 'image/common';

/** 主城页 HUD / 按钮的根目录（`快速寻敌` 那颗大金钮就在这）。 */
export const BIGMAP_MAIN_CITY_ART_ROOT = 'image/main/city';

/**
 * 世界页「领地页 HUD 皮肤」要用的图（2026-10-22 第二轮用户口径：
 * *「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式」*）。
 *
 * 口径落定：面板/弹窗走**领地页顶部 HUD 那套深色卡**（手画，见 `BigMapSkin.drawBigMapCardPanel`），
 * 贴图只留「按钮」和「模式木牌」两类，全是**已经在用**的老图，不为世界页新造美术：
 * - `button` = `image/main/city/btn_quick_fight`，**领地页【快速寻敌】那颗 3D 金钮** ——
 *   一键收取 / 攻打 / 定位 / 建造 全用它（原生 196×72，无九宫边，横向拉伸幅度小、看不出来）；
 * - `tab_idle` / `tab_active` = `cu_ty_btn13` / `cu_ty_btn14`，**底部菜单栏七格的两态底图**
 *   （168×132 ⇒ 等比 ×0.726 = 122×96）—— 只给【基地 / 大地图】那颗模式切换用。
 *
 * 上一轮那张 `cu_title_brown` 红棕缎带**不再要了**：用户要求删掉「植物大地图」字样，
 * 没有文字的缎带只是一条空红条。`cu_9g_bar_02` 也退役 —— 扁按钮统一交给 3D 金钮。
 */
export const BIGMAP_HUD_UI_KEYS = ['tab_idle', 'tab_active', 'button'] as const;
export type IBigMapHudUiKey = typeof BIGMAP_HUD_UI_KEYS[number];

/** 键 → 完整资源路径（不带 `/spriteFrame`）。按键分别落在两个根目录下，所以写全路径。 */
export const BIGMAP_HUD_UI_FILES: Readonly<Record<IBigMapHudUiKey, string>> = {
    tab_idle: `${BIGMAP_COMMON_ART_ROOT}/cu_ty_btn13`,
    tab_active: `${BIGMAP_COMMON_ART_ROOT}/cu_ty_btn14`,
    button: `${BIGMAP_MAIN_CITY_ART_ROOT}/btn_quick_fight`,
};

