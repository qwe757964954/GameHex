import { SpriteFrame } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { BigMapResType } from '../model/BigMapTypes';
import {
    BIGMAP_BUILDING_ART, BIGMAP_CONCEPT_ROOT, BIGMAP_HUD_UI_FILES, BIGMAP_HUD_UI_KEYS, BIGMAP_UI_KEYS,
    type IBigMapHudUiKey, type IBigMapUiKey,
} from './BigMapArtCatalog';

export interface IBigMapArt {
    readonly background: SpriteFrame | null;
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
    readonly ui: ReadonlyMap<IBigMapUiKey, SpriteFrame | null>;
    /** 领地页 HUD 同款按钮 / 模式木牌（`image/common` + `image/main/city`）。缺图时上层退回手画底，不影响布局。 */
    readonly hud: ReadonlyMap<IBigMapHudUiKey, SpriteFrame | null>;
    readonly resources: ReadonlyMap<BigMapResType, SpriteFrame | null>;
}

/** 只装配表现资源；JSON 中的背景优先，地图坐标和规则仍只来自原来的布局链。 */
export async function loadBigMapArt(assets: AssetService, scope: ResourceScope, background = ''): Promise<IBigMapArt> {
    const fetchFrame = async (path: string): Promise<SpriteFrame | null> => {
        try {
            const framePath = `${path}/spriteFrame`;
            if (scope.disposed || !(await assets.has(framePath, SpriteFrame)) || scope.disposed) return null;
            const frame = await assets.load(framePath, SpriteFrame, { scope });
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
    const [backdrop, groundVariants, home, city, monster, rock, grass] = await Promise.all([
        load(background || 'image/bigmap/wasteland_background'),
        Promise.all([1, 2, 3, 4, 5, 6].map((index) => load(`image/bigmap/grounds/ground_${String(index).padStart(2, '0')}`))),
        load('image/buildings/hq-base'),
        load('image/buildings/barracks-default'),
        load('image/territory/buildings/territory_boss_v1'),
        load('image/decor/wasteland/st2'),
        load('image/decor/wasteland/cao'),
    ]);
    const sprite = (name: string): Promise<SpriteFrame | null> => load(`${BIGMAP_CONCEPT_ROOT}/sprites/${name}`);
    const buildingEntries = await Promise.all(Object.entries(BIGMAP_BUILDING_ART).map(async ([id, name]) => (
        [Number(id), await sprite(name)] as const
    )));
    const uiEntries = await Promise.all(BIGMAP_UI_KEYS.map(async (key) => {
        const frame = await load(`${BIGMAP_CONCEPT_ROOT}/ui/${key}`);
        if (frame && key !== 'plot' && key !== 'stamina' && key !== 'home') {
            frame.insetLeft = 28;
            frame.insetRight = 28;
            frame.insetTop = 28;
            frame.insetBottom = 28;
        }
        return [key, frame] as const;
    }));
    const hudEntries = await Promise.all(BIGMAP_HUD_UI_KEYS.map(async (key) => {
        // 按钮的九宫边 / 圆角走各自 `.png.meta` 的导入设置，不在这里覆写 ——
        // 覆写会和导入设置打架，改一次图就错一次（`btn_quick_fight` 本来就没有九宫边）。
        const frame = await load(BIGMAP_HUD_UI_FILES[key]);
        return [key, frame] as const;
    }));
    const resourceEntries = await Promise.all((['grain', 'wood', 'iron', 'coin', 'stamina'] as const).map(async (key) => (
        [key, key === 'stamina' ? uiEntries.find(([name]) => name === 'stamina')?.[1] ?? null : await sprite(key)] as const
    )));
    const [baseBackground, construction, fortress, mutantCamp, conceptRock, conceptGrass] = await Promise.all([
        load(`${BIGMAP_CONCEPT_ROOT}/base_ground`), sprite('construction'), sprite('fortress'),
        sprite('mutant_camp'), sprite('rocks'), sprite('grass'),
    ]);
    const buildings = new Map(buildingEntries);
    return { background: backdrop, ground: groundVariants.find((frame) => frame !== null) ?? null,
        groundVariants, home: buildings.get(71001) ?? home, city: fortress ?? city, monster: mutantCamp ?? monster,
        rock: conceptRock ?? rock, grass: conceptGrass ?? grass,
        baseBackground, construction, buildings, ui: new Map(uiEntries), hud: new Map(hudEntries),
        resources: new Map(resourceEntries) };
}
