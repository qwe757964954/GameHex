/**
 *bundle 内旧前缀 —— 2026-11-04 `assets/bundles/bigmap/image/bigmap/` 整目录上提成
 *`assets/bundles/bigmap/image/`，bundle 内路径少了一层 `bigmap`。
 *
 *只有服务器下发的路径还可能是旧的（`bigMapCamp.campIcon`、`bigMapLayout.background`）：
 *客户端不能单方面改配置表，所以在加载入口统一归一。新配置直接用 `image/...` 也照常通过。
 */
const LEGACY_BUNDLE_IMAGE_PREFIX = 'image/bigmap/';

/** 旧前缀 `image/bigmap/x` → 新前缀 `image/x`；已是新前缀的原样返回（幂等）。 */
export function toBigMapArtPath(path: string): string {
    return path.startsWith(LEGACY_BUNDLE_IMAGE_PREFIX)
        ? `image/${path.slice(LEGACY_BUNDLE_IMAGE_PREFIX.length)}`
        : path;
}

//2026-11-04：`assets/bundles/bigmap/image/bigmap/` 整目录上提成 `assets/bundles/bigmap/image/`，
//所以 bundle 内路径少了一层 `bigmap`。服务器下发的旧路径由 `toBigMapArtPath()` 归一（见 `BigMapArtLoader`）。
export const BIGMAP_CONCEPT_ROOT = 'image/concept';
export const BIGMAP_BASE_BACKGROUND = 'image/base_background';

/**
 *基地建筑表里没配 `baseBuildIcon`（或配了但图没入库）时的通用外观。
 *
 *2026-11-12 之前这里是 `BIGMAP_BUILDING_ART`（按 `baseBuildType` 对 8 张概念图：
 *headquarters/farm/sawmill/ironworks/warehouse/water_tower/construction/rocks）。
 *那 8 张已随基地/世界换新美术删除，且实际上 23 座建筑里只有 71017（小玩法入口）没配图
 *—— 为它守一张 8 项的映射表不值得，改成一张通用图。
 *
 *选黏液巢穴：71017 是「小玩法入口」，洞口式造型最贴；其余建筑都有表里的 `baseBuildIcon`，
 *走不到这里（真走到了说明表或图有问题，`BigMapArtLoader` 会打一条汇总 warn）。
 */
export const BIGMAP_BASE_FALLBACK_ART = 'image/buildings/camp_outpost';

/** 概念占位图目录：`bigMapCamp.campIcon` 现在指向这里（由 `worldCampArtFor` 归一成新美术）。 */
export const BIGMAP_CONCEPT_SPRITE_ROOT = `${BIGMAP_CONCEPT_ROOT}/sprites`;

/**
 *世界地图据点外观：`campId // 100` 分段的候选图，段内按 `campId % len` 稳定取一张。
 *
 *用于把旧表/旧包里的概念占位图（`image/concept/sprites/*`）映射成新据点图。
 *
 *2026-11-12 `DM-城池配置.xlsx` 的 `campIcon` 列（81 行）已按本表填成真实图名，
 *客户端 `remoteRef/bigMapCamp.json` 同步完毕 ⇒ 正常链路下 `worldCampArtFor` 原样返回，不再命中本表。
 *保留它只为兜住两种旧数据：服务器下发的历史快照、以及别的分支导出的旧 json。
 *
 *为什么按段分：`bigMapCamp` 的 81 个据点就是 8 段（1xx 前哨营地 / 2xx 雾隐堡 / 3xx 军团壁垒 /
 *4xx 深渊地堡 / 5xx 腐化高塔 / 6xx 熔岩要塞 / 7xx 苍穹圣城 / 8xx 太阳神座），每段同气质。
 *段内给 2 张变体是为了让「14 座前哨营地长得一模一样」这件事消失 —— 相邻两座必然不同，
 *而仍属同一段（同气质），不会破坏「一眼看出这是同种据点」的读法。
 *
 * 图必须内容居中于 212 画布（`tmp/_world_camp_art.py` 的口径）：
 *`BigMapWorldMarker.render` 的落点是 `iconY = height/2 - FOOT_LIFT` 再减去 `offset.y*scale`，
 *只有 offset≈0 时底边才恒等于 `-FOOT_LIFT`（16）且与内容高无关。
 *内容一旦偏上（旧 `barracks-default` 就偏上 36.5px），补偿会把整座据点往下推，段间落点对不齐。
 */
export const BIGMAP_WORLD_CAMP_ART: Readonly<Record<number, readonly string[]>> = {
    1: ['image/buildings/camp_outpost', 'image/buildings/camp_outpost_2'],
    2: ['image/buildings/camp_mist_fort', 'image/buildings/camp_mist_fort_2'],
    3: ['image/buildings/camp_legion', 'image/buildings/camp_legion_2'],
    4: ['image/buildings/camp_abyss'],
    5: ['image/buildings/camp_rot_tower', 'image/buildings/camp_rot_tower_2'],
    6: ['image/buildings/camp_lava'],
    7: ['image/buildings/camp_sky'],
    8: ['image/buildings/camp_sun_throne'],
};

/** 世界地图玩家主城 / 基地的据点外观（`art.home`）。 */
export const BIGMAP_WORLD_HOME_ART = 'image/buildings/camp_home';

/** 城池没配 `campIcon`（或配了但不在分段表里）时的兜底外观（`art.city`）。 */
export const BIGMAP_WORLD_CITY_ART = 'image/buildings/camp_legion';

/**
 *把旧数据里配的概念占位图换成新美术；已经是真实图名就原样返回。
 *
 *只在 `campIcon` 指向 `image/concept/sprites/*` 时生效 —— 那 8 张是初版占位图，
 *不代表「这座据点就该长这样」。表已在 2026-11-12 换成真实图名，所以正常链路不会命中
 *（见 `BIGMAP_WORLD_CAMP_ART` 注释）；留这条是为了兜服务器历史快照 / 旧分支导出的 json。
 */
export function worldCampArtFor(iconPath: string, campId: number): string {
    const path = toBigMapArtPath(iconPath);
    if (!path.startsWith(`${BIGMAP_CONCEPT_SPRITE_ROOT}/`)) return path;
    const group = BIGMAP_WORLD_CAMP_ART[Math.floor(campId / 100)];
    if (!group || group.length === 0) return path;
    return group[campId % group.length] ?? path;
}

/**
 *体力图标（`ui/stamina`）—— 概念题花里唯一还在用的 UI 件。
 *
 *2026-11-12 删掉 `BIGMAP_UI_KEYS`（header/detail/button/tab_idle/tab_active/badge/plot/home 共 8 张，
 *加 stamina 组成 9 张）：那 8 张在 `assets/script` 里零消费点（`IBigMapArt.ui` 从来没人读），
 *加载后还统一覆写 `insetLeft/Right/Top/Bottom = 28` 做九宫拉伸，而图自身 `.meta` 的 border 全是 0
 *—— 两套真源并存，且和下方 `BIGMAP_HUD_UI_KEYS` 那段「九宫走 .meta、不在代码里覆写」的口径打架。
 *只保留 `stamina`：`BigMapArtLoader` 拿它给「体力」资源图标兜底（`item.icon` 缺失时）。
 *
 *→ PNG 与 `manifest.json` 条目仍在库里（删图要同步裁清单和测试，属独立清理），代码侧只认这一张。
 */
export const BIGMAP_STAMINA_ART = `${BIGMAP_CONCEPT_ROOT}/ui/stamina`;

/**
 *据点名条（地图上压在建筑下方的「徽章 + 名字」条）。
 *
 *口径（2026-11-02 山猫：「将大地图升级到蓝湖」，设计稿「大地图3」）：
 *名条不再是手画圆角牌，改成四张按归属分的整条贴图 —— 左端是徽章底
 *（野怪/关卡菱形、玩家占领圆形），右侧留名字位：
 *· `monster` 蓝（设计稿 `title_01`）= 野怪据点 —— 已停用：2026-11-03 用户口径
 *  「野怪的标识和城池据点的保持一样的红色」，野怪标记改取 `city` 那条红底
 *  （见 `BigMapWorldView.syncMarkers` 的 monster 分支）。图仍按本表加载、随时可切回，
 *  只是没有调用点了 —— 别以为少读一张就是漏配；
 *· `city`    红（`title_02`）= 关卡 / 无主城池 / 野怪；
 *· `self`    绿（`title_03`）= 己方占领；
 *· `other`   深灰（`title_04`）= 其他玩家占领。
 *
 *四张尺寸不同（两个 202×56、两个 193×54），所以尺寸从贴图自身取，
 *不要在代码里写死一个宽度 —— 换了图立刻错位。
 *
 * 不复用 `BIGMAP_UI_KEYS`（2026-11-12 已删）：那一组原来是「九宫拉伸的通用面板件」，加载时会被统一
 *覆写 `insetLeft/Right/Top/Bottom = 28`；名条是整条原尺寸贴图，覆写九宫边
 *会把左右两端的圆角拉变形。
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
 *世界页「领地页 HUD 皮肤」要用的图（2026-10-22 第二轮用户口径：
 * 「将世界玩法的 UI 风格改成领地玩法的 ui 风格，按钮的样式，题头底板的样式，弹窗样式」）。
 *
 *口径落定：面板/弹窗走领地页顶部 HUD 那套深色卡（手画，见 `BigMapSkin.drawBigMapCardPanel`），
 *贴图只留「按钮」和「模式按钮」两类：
 *- `button` = `image/main/city/btn_quick_fight`，领地页【快速寻敌】那颗 3D 金钮 ——
 *  一键收取 / 攻打 / 定位 / 建造 全用它（原生 196×72，无九宫边，横向拉伸幅度小、看不出来）；
 *- `mode_frame` / `mode_base` / `mode_world` = 【基地 / 大地图】那颗模式按钮的三件套
 *  （2026-10-28 用户口径：「基地按钮 和大地图按钮的图标更换成类似任务按钮的样式，
 *  底框加成对应内容(建筑icon-基地，地图icon--大地图)的卡通icon」）：
 *    · `mode_frame` = `image/main/hud/hud_task_tab` —— 主界面【任务】按钮那块深板岩圆角底框，
 *      111×79 原尺寸贴，不拉伸（`.meta` 没有九宫边，拉伸只会把圆角拉糊）；
 *    · `mode_base` = `image/main/city/nav_territory` —— 现成的石堡城门卡通图标（86×86）；
 *    · `mode_world` = `image/main/hud/hud_mode_world` —— 项目里没有地图类图标（`find` 过
 *      world/map/globe/compass/scroll，全是地形贴图），所以按 `hud_task_icon` 的画法
 *      脚本画了一张折页地图（厚描边 + 平涂），生成器见 `tools/gen_bigmap_mode_icon.py`。
 *
 *上一轮那两张 `cu_ty_btn13` / `cu_ty_btn14`（底部菜单栏七格的两态木牌）已退役：
 *任务按钮那套是「底框 + 图标压在框上 + 文字压在最下」，木牌皮肤的 `setSkin` 只换底图、
 *文字永远居中，做不出图标位，所以整颗按钮改成手搭三段结构（见 `BigMapPage.buildModeButton`）。
 *
 *上一轮那张 `cu_title_brown` 红棕缎带不再要了：用户要求删掉「植物大地图」字样，
 *没有文字的缎带只是一条空红条。`cu_9g_bar_02` 也退役 —— 扁按钮统一交给 3D 金钮。
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

