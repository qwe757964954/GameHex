import { SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import type { BigMapResType, IBigMapBuildingConfig, IBigMapCampConfig } from '../model/BigMapTypes';
import {
    BIGMAP_BASE_BACKGROUND, BIGMAP_BUILDING_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_HUD_UI_FILES, BIGMAP_HUD_UI_KEYS, BIGMAP_UI_KEYS,
    type IBigMapHudUiKey, type IBigMapUiKey,
} from './BigMapArtCatalog';

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
    /** 领地页 HUD 同款按钮 / 模式木牌（`image/common` + `image/main/city`）。缺图时上层退回手画底，不影响布局。 */
    readonly hud: ReadonlyMap<IBigMapHudUiKey, SpriteFrame | null>;
    readonly resources: ReadonlyMap<BigMapResType, SpriteFrame | null>;
}

/**
 * 只装配表现资源；世界视图优先连续底图，缺图时回退 JSON 背景；地图坐标和规则只来自布局链。
 *
 * @param resourceIcons 资源类型 → **背包道具图标路径**（`item.icon`，来自 `bigmapResource.itemId`）。
 *   有就走背包那份图，没有 / 加载失败退回 `image/bigmap/concept/sprites/<resType>` 概念图。
 * @param buildingConfigs 基地建筑配置。只按类型使用现有图片，尚未入库的 baseBuildIcon 不接入加载。
 */
export async function loadBigMapArt(
    assets: AssetService,
    scope: ResourceScope,
    background = '',
    resourceIcons: ReadonlyMap<BigMapResType, string> = new Map(),
    buildingConfigs: ReadonlyMap<number, IBigMapBuildingConfig> = new Map(),
    campConfigs: ReadonlyMap<number, IBigMapCampConfig> = new Map(),
): Promise<IBigMapArt> {
    const fetchFrame = async (path: string): Promise<SpriteFrame | null> => {
        try {
            const framePath = `${path}/spriteFrame`;
            const options = { scope, bundle: bundleForPath(path) };
            if (scope.disposed || !(await assets.has(framePath, SpriteFrame, options)) || scope.disposed) return null;
            const frame = await assets.load(framePath, SpriteFrame, options);
            return scope.disposed ? null : frame;
        } catch (error) {
            console.warn(`[BigMap] 美术加载失败，保留地形和标记兜底：${path}`, error);
            return null;
        }
    };
    const requests = new Map<string, Promise<SpriteFrame | null>>();
    const load = (path: string): Promise<SpriteFrame | null> => {
        if (scope.disposed) return Promise.resolve(null);
        const existing = requests.get(path);
        if (existing) return existing;
        const request = fetchFrame(path);
        requests.set(path, request);
        return request;
    };
    const terrainTask = Promise.all([
        load(background || 'image/bigmap/wasteland_background'),
        Promise.all([1, 2, 3, 4, 5, 6].map((index) => load(`image/bigmap/grounds/ground_${String(index).padStart(2, '0')}`))),
        load('image/buildings/hq-base'),
        load('image/buildings/barracks-default'),
        load('image/territory/buildings/territory_boss_v1'),
        load('image/decor/wasteland/st2'),
        load('image/decor/wasteland/cao'),
        load('image/bigmap/bigMapBG'),
    ]);
    const sprite = (name: string): Promise<SpriteFrame | null> => load(`${BIGMAP_CONCEPT_ROOT}/sprites/${name}`);
    const buildingTask = Promise.all([...buildingConfigs.values()].map(async (building) => {
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
    const [[backdrop, groundVariants, home, city, monster, rock, grass, tiledBackground], buildingEntries, uiEntries,
        hudEntries, resourceEntries, [baseBackground, construction, fortress, mutantCamp, conceptRock, conceptGrass], campEntries] =
        await Promise.all([terrainTask, buildingTask, uiTask, hudTask, resourceTask, baseTask, campTask]);
    const buildings = new Map(buildingEntries);
    return { background: backdrop, tiledBackground, ground: groundVariants.find((frame) => frame !== null) ?? null,
        groundVariants, home: home ?? buildings.get(71001) ?? null, city: city ?? fortress, monster: monster ?? mutantCamp,
        rock: conceptRock ?? rock, grass: conceptGrass ?? grass,
        baseBackground, construction, buildings,
        camps: new Map(campEntries.map(([id, frame]) => [id, frame ?? city ?? fortress])),
        ui: new Map(uiEntries), hud: new Map(hudEntries),
        resources: new Map(resourceEntries) };
}
