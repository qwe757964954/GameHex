// 2026-11-04：`assets/bundles/bigmap/image/bigmap/` 整目录上提成 `assets/bundles/bigmap/image/`，
// 所以 bundle 内路径少了一层 `bigmap`。服务器下发的旧路径由 `toBigMapArtPath()` 归一（见 `BigMapArtLoader`）。
export const BIGMAP_CONCEPT_ROOT = 'image/concept';
export const BIGMAP_BASE_BACKGROUND = 'image/base_background';

/** 按 `baseBuilding.baseBuildType` 回退，不能再按旧版八个建筑 ID 对图。 */
export const BIGMAP_BUILDING_ART: Readonly<Record<number, string>> = {
    1: 'headquarters',
    2: 'farm',
    3: 'sawmill',
    4: 'ironworks',
    5: 'warehouse',
    6: 'water_tower',
    7: 'construction',
    8: 'rocks',
};

export const BIGMAP_UI_KEYS = ['header', 'detail', 'button', 'tab_idle', 'tab_active', 'badge', 'plot', 'stamina', 'home'] as const;
export type IBigMapUiKey = typeof BIGMAP_UI_KEYS[number];

/**
 * 据点**名条**（地图上压在建筑下方的「徽章 + 名字」条）。
 *
 * 口径（2026-11-02 山猫：「将大地图升级到蓝湖」，设计稿「大地图3」）：
 * 名条不再是手画圆角牌，改成**四张按归属分的整条贴图** —— 左端是徽章底
 * （野怪/关卡菱形、玩家占领圆形），右侧留名字位：
 * · `monster` 蓝（设计稿 `title_01`）= 野怪据点；
 * · `city`    红（`title_02`）= 关卡 / 无主城池；
 * · `self`    绿（`title_03`）= 己方占领；
 * · `other`   深灰（`title_04`）= 其他玩家占领。
 *
 * 四张**尺寸不同**（两个 202×56、两个 193×54），所以尺寸从贴图自身取，
 * 不要在代码里写死一个宽度 —— 换了图立刻错位。
 *
 * ⚠️ 不复用 `BIGMAP_UI_KEYS`：那一组是「九宫拉伸的通用面板件」，加载时会被统一
 * 覆写 `insetLeft/Right/Top/Bottom = 28`；名条是整条原尺寸贴图，覆写九宫边
 * 会把左右两端的圆角拉变形。
 */
export const BIGMAP_PLATE_KEYS = ['monster', 'city', 'self', 'other'] as const;
export type IBigMapPlateKey = typeof BIGMAP_PLATE_KEYS[number];

export const BIGMAP_PLATE_FILES: Readonly<Record<IBigMapPlateKey, string>> = {
    monster: `${BIGMAP_CONCEPT_ROOT}/ui/plate_monster`,
    city: `${BIGMAP_CONCEPT_ROOT}/ui/plate_city`,
    self: `${BIGMAP_CONCEPT_ROOT}/ui/plate_self`,
    other: `${BIGMAP_CONCEPT_ROOT}/ui/plate_other`,
};

/** 名条左端徽章外那颗小旗（设计稿 `icon_qizhi`）：标「谁占着这个据点」。 */
export const BIGMAP_PLATE_FLAG_FILE = `${BIGMAP_CONCEPT_ROOT}/ui/plate_flag`;

/** 通用 UI 图根目录 —— 与领地页（`TerritoryPageAssets`）同一个 `image/common`。 */
export const BIGMAP_COMMON_ART_ROOT = 'image/common';

/** 主城页 HUD / 按钮的根目录（`快速寻敌` 那颗大金钮就在这）。 */
export const BIGMAP_MAIN_CITY_ART_ROOT = 'image/main/city';

/** 主界面 HUD 的根目录（【任务】按钮那块深板岩底框 + 它压在上面的卡通图标）。 */
export const BIGMAP_MAIN_HUD_ART_ROOT = 'image/main/hud';

/**
 * 世界页「领地页 HUD 皮肤」要用的图（2026-10-22 第二轮用户口径：
 * *「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式」*）。
 *
 * 口径落定：面板/弹窗走**领地页顶部 HUD 那套深色卡**（手画，见 `BigMapSkin.drawBigMapCardPanel`），
 * 贴图只留「按钮」和「模式按钮」两类：
 * - `button` = `image/main/city/btn_quick_fight`，**领地页【快速寻敌】那颗 3D 金钮** ——
 *   一键收取 / 攻打 / 定位 / 建造 全用它（原生 196×72，无九宫边，横向拉伸幅度小、看不出来）；
 * - `mode_frame` / `mode_base` / `mode_world` = **【基地 / 大地图】那颗模式按钮的三件套**
 *   （2026-10-28 用户口径：*「基地按钮 和大地图按钮的图标更换成类似任务按钮的样式，
 *   底框加成对应内容(建筑icon-基地，地图icon--大地图)的卡通icon」*）：
 *     · `mode_frame` = `image/main/hud/hud_task_tab` —— **主界面【任务】按钮那块深板岩圆角底框**，
 *       111×79 原尺寸贴，不拉伸（`.meta` 没有九宫边，拉伸只会把圆角拉糊）；
 *     · `mode_base` = `image/main/city/nav_territory` —— 现成的**石堡城门**卡通图标（86×86）；
 *     · `mode_world` = `image/main/hud/hud_mode_world` —— **项目里没有地图类图标**（`find` 过
 *       world/map/globe/compass/scroll，全是地形贴图），所以按 `hud_task_icon` 的画法
 *       脚本画了一张折页地图（厚描边 + 平涂），生成器见 `tools/gen_bigmap_mode_icon.py`。
 *
 * 上一轮那两张 `cu_ty_btn13` / `cu_ty_btn14`（底部菜单栏七格的两态木牌）**已退役**：
 * 任务按钮那套是「底框 + 图标压在框上 + 文字压在最下」，木牌皮肤的 `setSkin` 只换底图、
 * 文字永远居中，做不出图标位，所以整颗按钮改成手搭三段结构（见 `BigMapPage.buildModeButton`）。
 *
 * 上一轮那张 `cu_title_brown` 红棕缎带**不再要了**：用户要求删掉「植物大地图」字样，
 * 没有文字的缎带只是一条空红条。`cu_9g_bar_02` 也退役 —— 扁按钮统一交给 3D 金钮。
 */
export const BIGMAP_HUD_UI_KEYS = ['mode_frame', 'mode_base', 'mode_world', 'button'] as const;
export type IBigMapHudUiKey = typeof BIGMAP_HUD_UI_KEYS[number];

/** 键 → 完整资源路径（不带 `/spriteFrame`）。按键分别落在三个根目录下，所以写全路径。 */
export const BIGMAP_HUD_UI_FILES: Readonly<Record<IBigMapHudUiKey, string>> = {
    mode_frame: `${BIGMAP_MAIN_HUD_ART_ROOT}/hud_task_tab`,
    mode_base: `${BIGMAP_MAIN_CITY_ART_ROOT}/nav_territory`,
    mode_world: `${BIGMAP_MAIN_HUD_ART_ROOT}/hud_mode_world`,
    button: `${BIGMAP_MAIN_CITY_ART_ROOT}/btn_quick_fight`,
};

