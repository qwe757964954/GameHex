import { SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import type { BigMapResType, IBigMapBuildingConfig, IBigMapCampConfig } from '../model/BigMapTypes';
import {
    BIGMAP_BASE_BACKGROUND, BIGMAP_BUILDING_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_HUD_UI_FILES, BIGMAP_HUD_UI_KEYS,
    BIGMAP_PLATE_FILES, BIGMAP_PLATE_FLAG_FILE, BIGMAP_PLATE_KEYS, BIGMAP_UI_KEYS,
    type IBigMapHudUiKey, type IBigMapPlateKey, type IBigMapUiKey,
} from './BigMapArtCatalog';

/**
 * bundle 内旧前缀 —— 2026-11-04 `assets/bundles/bigmap/image/bigmap/` 整目录上提成
 * `assets/bundles/bigmap/image/`，bundle 内路径少了一层 `bigmap`。
 *
 * 只有**服务器下发**的路径还可能是旧的（`bigMapCamp.campIcon`、`bigMapLayout.background`）：
 * 客户端不能单方面改配置表，所以在加载入口统一归一。新配置直接用 `image/...` 也照常通过。
 */
const LEGACY_BUNDLE_IMAGE_PREFIX = 'image/bigmap/';

/** 旧前缀 `image/bigmap/x` → 新前缀 `image/x`；已是新前缀的原样返回（幂等）。 */
export function toBigMapArtPath(path: string): string {
    return path.startsWith(LEGACY_BUNDLE_IMAGE_PREFIX)
        ? `image/${path.slice(LEGACY_BUNDLE_IMAGE_PREFIX.length)}`
        : path;
}

export interface IBigMapArt {
    readonly background: SpriteFrame | null;
    /** 世界坐标连续平铺底图；缺失时回退布局背景，地皮仍独立绘制。 */
    readonly tiledBackground: SpriteFrame | null;
    readonly ground: SpriteFrame | null;
    readonly groundVariants: readonly (SpriteFrame | null)[];
    readonly home: SpriteFrame | null;
    readonly city: SpriteFrame | null;
    readonly monster: SpriteFrame | null;
    readonly rock: SpriteFrame | null;
    readonly grass: SpriteFrame | null;
    readonly baseBackground: SpriteFrame | null;
    readonly construction: SpriteFrame | null;
    readonly buildings: ReadonlyMap<number, SpriteFrame | null>;
    readonly camps: ReadonlyMap<number, SpriteFrame | null>;
    readonly ui: ReadonlyMap<IBigMapUiKey, SpriteFrame | null>;
    /** 据点名条（按归属四选一）与「谁占着」小旗。缺图时标记退回手画角标，不影响布局。 */
    readonly plates: ReadonlyMap<IBigMapPlateKey, SpriteFrame | null>;
    readonly plateFlag: SpriteFrame | null;
    /** 领地页 HUD 同款按钮 / 模式木牌（`image/common` + `image/main/city`）。缺图时上层退回手画底，不影响布局。 */
    readonly hud: ReadonlyMap<IBigMapHudUiKey, SpriteFrame | null>;
    readonly resources: ReadonlyMap<BigMapResType, SpriteFrame | null>;
}

/**
 * 只装配表现资源；世界视图优先连续底图，缺图时回退 JSON 背景；地图坐标和规则只来自布局链。
 *
 * @param resourceIcons 资源类型 → **背包道具图标路径**（`item.icon`，来自 `bigmapResource.itemId`）。
 *   有就走背包那份图，没有 / 加载失败退回 `image/concept/sprites/<resType>` 概念图。
 * @param buildingConfigs 基地建筑配置。**优先用表里的 `baseBuildIcon`**（`building.icon`），
 *   没配 / 加载失败才退回按 `baseBuildType` 的概念图（`BIGMAP_BUILDING_ART`）。
 *
 *   ⚠️ 2026-11-06 之前这里写死「只按类型使用现有图片，baseBuildIcon 不接入加载」——
 *   而 `bigmapBuilding.json` 当时**根本没有这一列**，所以两层都退概念图，玩家看到的是
 *   同一张通用图。现在链路已经接通，策划在表里补上 `baseBuildIcon` 之后无需改代码即生效。
 */
export async function loadBigMapArt(
    assets: AssetService,
    scope: ResourceScope,
    background = '',
    resourceIcons: ReadonlyMap<BigMapResType, string> = new Map(),
    buildingConfigs: ReadonlyMap<number, IBigMapBuildingConfig> = new Map(),
    campConfigs: ReadonlyMap<number, IBigMapCampConfig> = new Map(),
): Promise<IBigMapArt> {
    const fetchFrame = async (path: string, quiet = false): Promise<SpriteFrame | null> => {
        try {
            const framePath = `${path}/spriteFrame`;
            const options = { scope, bundle: bundleForPath(path) };
            if (scope.disposed) return null;
            // ⚠️ 这里原来 `has()` 为 false 时**静默 return null**，日志里什么都看不到 ——
            // 排查「美术没显示」时会被误导成「加载没问题」。未命中必须留痕。
            //
            // `quiet` 只给**表驱动且可能整列未入库**的入口用（`baseBuildIcon`）：那一列现在
            // 23 座建筑都还没出图，逐条 warn 会在每次进大地图刷一屏、把真正的缺失淹掉。
            // 这类「配了但图还没进库」属于**预期状态**，静默回退概念图即可。
            if (!(await assets.has(framePath, SpriteFrame, options))) {
                if (!quiet) console.warn(`[BigMap] 资源未命中（has=false）：${framePath} bundle=${options.bundle}`);
                return null;
            }
            if (scope.disposed) return null;
            const frame = await assets.load(framePath, SpriteFrame, options);
            return scope.disposed ? null : frame;
        } catch (error) {
            if (!quiet) console.warn(`[BigMap] 美术加载失败，保留地形和标记兜底：${path}`, error);
            return null;
        }
    };
    const requests = new Map<string, Promise<SpriteFrame | null>>();
    const load = (rawPath: string, quiet = false): Promise<SpriteFrame | null> => {
        if (scope.disposed) return Promise.resolve(null);
        // 归一化放在**去重之前**：同一张图新旧两种写法只加载一次。
        const path = toBigMapArtPath(rawPath);
        const existing = requests.get(path);
        if (existing) return existing;
        const request = fetchFrame(path, quiet);
        requests.set(path, request);
        return request;
    };
    const terrainTask = Promise.all([
        background && toBigMapArtPath(background) !== 'image/wasteland_background'
            ? load(background) : Promise.resolve(null),
        load('image/buildings/hq-base'),
        load('image/buildings/barracks-default'),
        load('image/territory/buildings/territory_boss_v1'),
        load('image/decor/wasteland/st2'),
        load('image/decor/wasteland/cao'),
        load('bigMapBG'),
    ]);
    const sprite = (name: string): Promise<SpriteFrame | null> => load(`${BIGMAP_CONCEPT_ROOT}/sprites/${name}`);
    /**
     * 表里配了 `baseBuildIcon` 但没加载到的（建筑 id:路径）。
     *
     * ⚠️ 单条未命中走 `quiet` 不打日志（整列没入库时 23 条会把真问题淹掉），
     * 但**必须汇总留一条**：否则「读表了但全回退概念图」这种状态在日志里完全不可见，
     * 排查时只能靠猜（2026-11-06 就是踩了这个 —— 用户说"还是旧资源"，而日志一片干净）。
     */
    const missedIcons: string[] = [];
    const buildingTask = Promise.all([...buildingConfigs.values()].map(async (building) => {
        // ① 表里的 `baseBuildIcon` 优先：它才是「这座建筑长什么样」的唯一真源。
        //    路径口径与 `campIcon` 一致（相对 resources / bundle 内路径），统一过 `load`
        //    ⇒ 旧前缀归一、按 bundle 路由、命中检查都在一处，不另写一套加载分支。
        if (building.icon) {
            const frame = await load(building.icon, true);
            if (frame) return [building.id, frame] as const;
            missedIcons.push(`${building.id}:${building.icon}`);
        }
        // ② 没配 / 图还没入库 ⇒ 退回按 `baseBuildType` 的概念图（初版就是这套，别删）。
        const name = BIGMAP_BUILDING_ART[building.kind];
        return [building.id, name ? await sprite(name) : null] as const;
    }));
    const campTask = Promise.all([...campConfigs.values()].map(async (camp) => (
        [camp.campId, camp.iconPath ? await load(camp.iconPath) : null] as const
    )));
    const uiTask = Promise.all(BIGMAP_UI_KEYS.map(async (key) => {
        const frame = await load(`${BIGMAP_CONCEPT_ROOT}/ui/${key}`);
        if (frame && key !== 'plot' && key !== 'stamina' && key !== 'home') {
            frame.insetLeft = 28;
            frame.insetRight = 28;
            frame.insetTop = 28;
            frame.insetBottom = 28;
        }
        return [key, frame] as const;
    }));
    const hudTask = Promise.all(BIGMAP_HUD_UI_KEYS.map(async (key) => {
        // 按钮的九宫边 / 圆角走各自 `.png.meta` 的导入设置，不在这里覆写 ——
        // 覆写会和导入设置打架，改一次图就错一次（`btn_quick_fight` 本来就没有九宫边）。
        const frame = await load(BIGMAP_HUD_UI_FILES[key]);
        return [key, frame] as const;
    }));
    const resourceTask = Promise.all((['grain', 'wood', 'iron', 'coin', 'stamina'] as const).map(async (key) => {
        // 背包道具图标优先：`item.icon` 是相对 resources 的路径（`icons/item/xxx`），
        // `load` 补 `/spriteFrame`，bundle 由 `BundleCatalog` 路由到 `main-pages`。
        const itemIcon = resourceIcons.get(key);
        if (itemIcon) {
            const frame = await load(itemIcon);
            if (frame) return [key, frame] as const;
        }
        // 没配 itemId / 表还没导 / 图缺失 ⇒ 退回大地图自己的概念图，绝不留空图标。
        return [key, key === 'stamina'
            ? (await uiTask).find(([name]) => name === 'stamina')?.[1] ?? null
            : await sprite(key)] as const;
    }));
    const baseTask = Promise.all([
        load(BIGMAP_BASE_BACKGROUND), sprite('construction'), sprite('fortress'),
        sprite('mutant_camp'), sprite('rocks'), sprite('grass'),
    ]);
    // 名条原尺寸贴图：**不**走 `uiTask`，那组会统一覆写九宫边（见 `BIGMAP_PLATE_KEYS` 注释）。
    const plateTask = Promise.all(BIGMAP_PLATE_KEYS.map(async (key) => (
        [key, await load(BIGMAP_PLATE_FILES[key])] as const
    )));
    const plateFlagTask = load(BIGMAP_PLATE_FLAG_FILE);
    const [[backdrop, home, city, monster, rock, grass, tiledBackground], buildingEntries, uiEntries,
        hudEntries, resourceEntries, [baseBackground, construction, fortress, mutantCamp, conceptRock, conceptGrass], campEntries,
        plateEntries, plateFlag] = await Promise.all([
        terrainTask, buildingTask, uiTask, hudTask, resourceTask, baseTask, campTask, plateTask, plateFlagTask,
    ]);
    const buildings = new Map(buildingEntries);
    if (missedIcons.length > 0) {
        const sample = missedIcons.slice(0, 4).join('、');
        console.warn(`[BigMap] ${missedIcons.length} 座建筑的 baseBuildIcon 没加载到，已回退概念图：${sample}`
            + `${missedIcons.length > 4 ? ' …' : ''}（检查路径是否在 resources / 对应 bundle 下）`);
    }
    return { background: backdrop, tiledBackground, ground: null,
        groundVariants: [], home: home ?? buildings.get(71001) ?? null, city: city ?? fortress, monster: monster ?? mutantCamp,
        rock: conceptRock ?? rock, grass: conceptGrass ?? grass,
        baseBackground, construction, buildings,
        camps: new Map(campEntries.map(([id, frame]) => [id, frame ?? city ?? fortress])),
        ui: new Map(uiEntries), hud: new Map(hudEntries), plates: new Map(plateEntries), plateFlag,
        resources: new Map(resourceEntries) };
}
