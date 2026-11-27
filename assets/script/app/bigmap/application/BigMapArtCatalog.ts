/**
 * 大地图美术资源目录表（纯路径常量与旧前缀归一化函数，零 `cc` 依赖）。
 *
 * 路径归属与跨包规则见 `BundleCatalog.ts`：
 * - `image/concept/*` 与 `bigMapBG` 在按需包 `bigmap`（由 `bundleForPath` 路由）；
 * - 其余首包目录（`image/buildings/*`、`image/decor/*`、`image/territory/buildings/*`、`image/main/*`）由 `resources` 加载。
 */
import {
    ART_ROOT, COMMON_ART_ROOT, DECOR_ART_ROOT, MAIN_ART_ROOT,
    MAIN_CITY_ART_ROOT, TERRITORY_BUILDING_ART_ROOT,
} from '../../ArtPaths';
import type { BigMapResType } from '../model/BigMapTypes';

/**
 * bundle 内已移除外层 `bigmap/` 前缀（现直接挂在 `image/` 下）；
 * 服务端历史布局或旧配置（`campIcon`、`bigMapLayout.background`）仍可能带该旧前缀，加载前在此统一剥离。
 */
const LEGACY_BUNDLE_IMAGE_PREFIX = 'image/bigmap/';

/** 旧前缀 `image/bigmap/x` → 新前缀 `image/x`；已是新前缀时原样返回（幂等）；空值或非字符串返回空串。 */
export function toBigMapArtPath(path: string): string {
    // 外部配置 / 历史快照在运行期可能缺失为 null/undefined；`strict` 未开启时先窄化再判前缀，避免抛 TypeError。
    if (!path || typeof path !== 'string') return '';
    return path.startsWith(LEGACY_BUNDLE_IMAGE_PREFIX)
        ? `image/${path.slice(LEGACY_BUNDLE_IMAGE_PREFIX.length)}`
        : path;
}

/** `bigmap` 分包概念根目录（具体打包条目由 `BundleCatalog.ts` 维护）。 */
export const BIGMAP_CONCEPT_ROOT = 'image/concept';

/**
 * 基地地皮切片（草地 / 泥土六边形，126×117、台面 123×90）。
 *
 * 资源位于首包 `resources/image/buildings/`，与 `BIGMAP_TILED_BG_ART` 平铺底图叠用；
 * 绘图尺寸常量见 `BigMapBasePresentation.ts`（`BIGMAP_BASE_TILE_IMAGE_WIDTH` / `HEIGHT`）。
 */
export const BIGMAP_BASE_TILE_GRASS = 'image/buildings/img_land_01';
export const BIGMAP_BASE_TILE_DIRT = 'image/buildings/img_land_02';

/**
 * 基地建筑兜底外观：表里未配 `baseBuildIcon`（当前如 `71017`）或图标尚未入库时使用。
 *
 * 复用首包 `resources/image/buildings/camp_outpost`，统一替换原先按 `baseBuildType` 分发的旧概念图映射；
 * 若因配置缺失回落到这里，`BigMapArtLoader` 会输出汇总 warn 提示。
 */
export const BIGMAP_BASE_FALLBACK_ART = 'image/buildings/camp_outpost';

/**
 * 历史概念占位图前缀（磁盘 `image/concept/sprites/` 目录已移除）。
 * 仅作 `worldCampArtFor` 识别并拦截服务端旧快照 / 旧分支配置中的过期路径使用。
 */
const BIGMAP_CONCEPT_SPRITE_ROOT = `${BIGMAP_CONCEPT_ROOT}/sprites`;

/** 体力资源兜底图标（`bigmap` 分包唯一随 `concept/manifest.json` 校验保留的概念 UI 件）。 */
export const BIGMAP_STAMINA_ART = `${BIGMAP_CONCEPT_ROOT}/ui/stamina`;

/**
 * 大地图资源图标兜底表（`BigMapBaseView` 基地建筑产出角标在 `item.icon` 缺失或加载失败时使用）。
 *
 * `grain` / `wood` / `iron` / `coin` 指向 `concept/ui/top_*`（与背包道具表 18501–18504 同源），
 * `stamina` 复用上方的 `BIGMAP_STAMINA_ART`。顶栏 `BigMapTopHud` 图标已由 prefab 固定绑定，不读取此表。
 */
export const BIGMAP_RES_ICON_ART: Readonly<Record<BigMapResType, string>> = {
    grain: `${BIGMAP_CONCEPT_ROOT}/ui/top_grain`,
    wood: `${BIGMAP_CONCEPT_ROOT}/ui/top_wood`,
    iron: `${BIGMAP_CONCEPT_ROOT}/ui/top_iron`,
    coin: `${BIGMAP_CONCEPT_ROOT}/ui/top_coin`,
    stamina: BIGMAP_STAMINA_ART,
};

/**
 * 旧据点概念图（`image/concept/sprites/*`）到真实据点图的分段映射（按 `Math.floor(campId / 100)` 分 1xx–8xx 段）。
 *
 * 正式 `bigMapCamp` 配置的 `campIcon` 已改配真实 `image/buildings/camp_*`，正常链路在 `worldCampArtFor` 早退、
 * 不会命中本表；保留它仅用于兼容服务端历史快照或旧分支配置。段内多图按 `campId % len` 轮转以区分相邻据点。
 *
 * 图资源契约：锚点居中且底边偏移 `offset.y ≈ 0`，才能保证 `BigMapWorldLayout.bigMapMarkerLayout` 按
 * `iconY = height / 2 - BIGMAP_MARKER_FOOT_LIFT` 落位时，各段据点底边与下方名条齐平。
 */
const BIGMAP_WORLD_CAMP_ART: Readonly<Record<number, readonly string[]>> = {
    1: ['image/buildings/camp_outpost', 'image/buildings/camp_outpost_2'],
    2: ['image/buildings/camp_mist_fort', 'image/buildings/camp_mist_fort_2'],
    3: ['image/buildings/camp_legion', 'image/buildings/camp_legion_2'],
    4: ['image/buildings/camp_abyss'],
    5: ['image/buildings/camp_rot_tower', 'image/buildings/camp_rot_tower_2'],
    6: ['image/buildings/camp_lava'],
    7: ['image/buildings/camp_sky'],
    8: ['image/buildings/camp_sun_throne'],
};

/** 世界地图玩家主城 / 基地外观（首包 `resources/image/buildings/`，对应 `art.home`）。 */
export const BIGMAP_WORLD_HOME_ART = 'image/buildings/camp_home';

/** 城池未配置图标或映射未命中时的兜底外观（首包 `resources/image/buildings/`，对应 `art.city`）。 */
export const BIGMAP_WORLD_CITY_ART = 'image/buildings/camp_legion';

/** 野怪据点默认外观（复用首包 `image/territory/buildings` 首领建筑图）。 */
export const BIGMAP_WORLD_MONSTER_ART = `${TERRITORY_BUILDING_ART_ROOT}/territory_boss_v1`;

/** 荒地装饰：石头 / 草（首包 `image/decor`）。 */
export const BIGMAP_DECOR_ROCK_ART = `${DECOR_ART_ROOT}/wasteland/st2`;
export const BIGMAP_DECOR_GRASS_ART = `${DECOR_ART_ROOT}/wasteland/cao`;

/**
 * 大地图连续平铺底图（2048×2048，供世界与基地底图共用）。
 *
 * 刻意放在 `bigmap` bundle 顶层、不放进 `image/` 自动图集子树（见 `BundleCatalog.ts`），避免大图合图被缩糊。
 */
export const BIGMAP_TILED_BG_ART = 'bigMapBG';

/** 已退役的整幅荒地背景路径；`BigMapArtLoader` 仅用它过滤旧布局数据，不再加载。 */
export const BIGMAP_LEGACY_WASTELAND_BG = `${ART_ROOT}/wasteland_background`;

/**
 * 将历史配置里的旧据点占位路径（`image/concept/sprites/*`）映射为真实据点路径；真实路径归一化前缀后原样返回。
 * 未知段（0 / ≥9xx / NaN）回退 `BIGMAP_WORLD_CITY_ART`，防止回落到已删库的概念占位图。
 */
export function worldCampArtFor(iconPath: string, campId: number): string {
    const path = toBigMapArtPath(iconPath);
    if (!path.startsWith(`${BIGMAP_CONCEPT_SPRITE_ROOT}/`)) return path;
    // 先净化 ID 再取段，避免 NaN 或负数算出非法段索引而透传废弃概念图。
    const id = Number.isFinite(campId) ? Math.abs(Math.trunc(campId)) : 0;
    const group = BIGMAP_WORLD_CAMP_ART[Math.floor(id / 100)];
    if (!group || group.length === 0) return BIGMAP_WORLD_CITY_ART;
    return group[id % group.length] ?? BIGMAP_WORLD_CITY_ART;
}

/**
 * 据点名条整图键清单（压在地图建筑正下方，含左端徽章底与名字位）。
 *
 * 按贴图原尺寸展示（`202×56` / `193×54`），不走代码侧九宫拉伸覆写以免圆角变形；
 * `monster`（`plate_monster` 蓝底）保留加载以便随时切回，当前 `BigMapWorldView.syncMarkers` 统一取 `city` 红底展示。
 */
export const BIGMAP_PLATE_KEYS = ['monster', 'city', 'self', 'other'] as const;
export type IBigMapPlateKey = typeof BIGMAP_PLATE_KEYS[number];

export const BIGMAP_PLATE_FILES = {
    monster: `${BIGMAP_CONCEPT_ROOT}/ui/plate_monster`,
    city: `${BIGMAP_CONCEPT_ROOT}/ui/plate_city`,
    self: `${BIGMAP_CONCEPT_ROOT}/ui/plate_self`,
    other: `${BIGMAP_CONCEPT_ROOT}/ui/plate_other`,
} as const satisfies Record<IBigMapPlateKey, string>;

/** 名条左端徽章外角标小旗（标记据点当前占领方）。 */
export const BIGMAP_PLATE_FLAG_FILE = `${BIGMAP_CONCEPT_ROOT}/ui/plate_flag`;

/** 通用 UI 图根目录（首包 `resources/image/common`；当前主要由皮肤/规范守卫引用，保留兼容性导出）。 */
export const BIGMAP_COMMON_ART_ROOT = COMMON_ART_ROOT;

/** 主城页 HUD / 按钮根目录（首包 `resources/image/main/city`）。 */
export const BIGMAP_MAIN_CITY_ART_ROOT = MAIN_CITY_ART_ROOT;

/** 主界面 HUD 根目录（首包 `resources/image/main/hud`）。 */
export const BIGMAP_MAIN_HUD_ART_ROOT = `${MAIN_ART_ROOT}/hud`;

/**
 * 大地图切换模式按钮与 HUD 皮肤图片键清单（均来自首包 `resources`）：
 * - `mode_frame` / `mode_base` / `mode_world`：模式切换按钮三层贴图，由 `BigMapPageLayout.refreshModeButton` 消费
 *   （`mode_world` 由 `tools/gen_bigmap_mode_icon.py` 生成）；
 * - `button`：`btn_quick_fight`，原计划用于代码侧按钮皮肤，现已在 `BigMapPage.prefab` 直接绑定并保留按契约预加载。
 *
 * 贴图九宫/尺寸统一由各自 `.png.meta` 决定，不在加载后覆写。
 */
export const BIGMAP_HUD_UI_KEYS = ['mode_frame', 'mode_base', 'mode_world', 'button'] as const;
export type IBigMapHudUiKey = typeof BIGMAP_HUD_UI_KEYS[number];

/** 键 → 完整 resources 路径（不含 `/spriteFrame`）。 */
export const BIGMAP_HUD_UI_FILES = {
    mode_frame: `${BIGMAP_MAIN_HUD_ART_ROOT}/hud_task_tab`,
    mode_base: `${BIGMAP_MAIN_CITY_ART_ROOT}/nav_territory`,
    mode_world: `${BIGMAP_MAIN_HUD_ART_ROOT}/hud_mode_world`,
    button: `${BIGMAP_MAIN_CITY_ART_ROOT}/btn_quick_fight`,
} as const satisfies Record<IBigMapHudUiKey, string>;

