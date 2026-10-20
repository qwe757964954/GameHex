/**
 * 大地图**布局文件**（`assets/resources/config/bigmap-maps/*.json`）—— 纯 TS，零 `cc` 依赖。
 *
 * ## 为什么需要它
 *
 * `buildBigMapWorld(config, seed)` 是**种子生成**：城池按 `slot/slotCount` 落在固定环上，
 * 策划一格都改不了。而文档要求 74 座城按同心圆分布、每城有势力范围、野怪按等级环带、
 * 出生区块要能控容量。这些必须可编辑，所以世界改成两条入口：
 *
 * ```
 * 有布局 → buildBigMapWorldFromLayout(config, layout)
 * 无布局 → buildBigMapWorld(config, seed)        // 离线调试档 / 单测夹具 / 老存档
 * ```
 *
 * ## 只装静态数据
 *
 * 布局里只有「地形种子 + 手改格 + 城池/野怪/基地落位」。
 * 归属、积分、榜、快照、基地坐标、刷新 CD 这些**运行态一律不进文件** ——
 * 与 `tools/map-editor/TERRITORY_README.md` 的口径一致（进度状态不写进静态地图 JSON）。
 *
 * ## 与配置表的分工
 *
 * 布局决定「东西在哪」，`BigMap-*` 配置表决定「东西值多少」。
 * 城池坐标**只在布局里**：若同时写进 `BigMap-城池配置.hexPos`，跑一次 eSon 导表就会把
 * 编辑器成果静默覆盖回去（`MEMORY` 303 条踩过的同类坑）。
 */

import {
    HEX_GRID_LOGICAL_COLUMN_STEP,
    HEX_GRID_LOGICAL_ROW_STEP,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../../../core/hex/HexGridLayout';
import { buildBigMapTiles } from './BigMapWorld';
import type {
    BigMapTerrain,
    IBigMapBaseSite,
    IBigMapCitySite,
    IBigMapConfig,
    IBigMapMonsterSite,
    IBigMapWorld,
} from './BigMapTypes';

/** 布局文件标识（`kind` 字段），与领地地图的 `territoryChapter` 同性质。 */
export const BIGMAP_LAYOUT_KIND = 'bigmapWorld';

/** 结构版本。**加字段不用改它**（可选字段向后兼容），语义变化才 +1。 */
export const BIGMAP_LAYOUT_VERSION = 1;

/** 允许的地形取值，`parseBigMapLayout` 用它挡脏数据。 */
const TERRAINS: readonly BigMapTerrain[] = ['plain', 'forest', 'rock', 'water'];

/**
 * 编辑器**逻辑坐标** → 客户端**渲染坐标**的缩放，**两个轴不一样**。
 *
 * 逻辑网格是 36×42（`HEX_GRID_LOGICAL_*`），渲染网格是 92.25×90（`HEX_GRID_VIEW_*`）——
 * 因为底图是 130×119 的压扁画布。`x` 放大 2.5625、`y` 只放大 2.1428…
 *
 * ⚠️ 这就是「编辑器里摆 A、游戏里显示 B」最常见的成因：只按一个轴等比放大，
 * 越往右下偏得越多。M2 编辑器与客户端做像素对拍时必须**分轴**乘这两个值。
 */
export const BIGMAP_EDITOR_TO_VIEW_SCALE = {
    x: HEX_GRID_VIEW_COLUMN_SPACING / HEX_GRID_LOGICAL_COLUMN_STEP,
    y: HEX_GRID_VIEW_ROW_SPACING / HEX_GRID_LOGICAL_ROW_STEP,
} as const;

export interface IBigMapLayoutTerrainOverride {
    readonly hexId: number;
    readonly terrain: BigMapTerrain;
}

export interface IBigMapLayoutCity {
    readonly cityId: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
    /**
     * 落位时选的环号。
     * **不能由格子几何反推**：种子生成里有「目标环被占满就退一环」的兜底，
     * 那时 `ring` 与实际距离不相等，反推会让往返对拍假红。
     */
    readonly ring: number;
    /**
     * 势力范围格子（透明色区）。
     *
     * ⚠️ `IBigMapWorld` **不承载**它：现在的势力范围判定走 `radiateCapacity` 距离
     * （`bigMapWithinCityRange`），这套格子要到 P1 联盟层做「势力范围染色 + 进入/离开增益」
     * 才进规则。在此之前它只是编辑器维护、随布局保存的标注 —— 别以为改了它游戏里就生效。
     */
    readonly rangeHex: readonly number[];
    /** 相邻城池 id（编辑器按范围邻接自动推导，允许手改）。双向一致性由校验保证。 */
    readonly adjacentCityIds: readonly number[];
    /** 地图上显示的编号，如 `1-16`。 */
    readonly label: string;
}

/** 出生区块：把若干格圈成一区，容量按辐射容量算（文档 `spawnCapRatio`）。 */
export interface IBigMapSpawnZone {
    readonly zoneId: number;
    /** 归属城池；0 = 未绑定任何城（仅作图用）。 */
    readonly cityId: number;
    readonly cells: readonly number[];
    readonly capacity: number;
}

/** 活动据点 / 挂机资源田 / 地图 BOSS 的落位（城池之外的静态点位）。 */
export interface IBigMapLayoutPoint {
    readonly pointId: number;
    /** 1 = 城池（一般不用，城池走 cities）2 = 挂机资源田 3 = 地图 BOSS。 */
    readonly pointType: number;
    readonly hexIds: readonly number[];
    readonly openCron: string;
}

export interface IBigMapLayoutMonster {
    readonly instanceId: number;
    readonly monsterId: number;
    readonly level: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
}

export interface IBigMapLayoutBase {
    readonly baseId: string;
    readonly name: string;
    readonly isPlayer: boolean;
    readonly hexId: number;
    readonly ring: number;
    readonly power: number;
}

export interface IBigMapLayout {
    readonly kind: typeof BIGMAP_LAYOUT_KIND;
    readonly version: number;
    readonly layoutVersion: number;
    readonly worldId: number;
    readonly worldName: string;
    readonly rows: number;
    readonly columns: number;
    /** 地形仍由种子生成（100×100 手摆 10000 格不现实），只有手改过的格子进 `terrainOverrides`。 */
    readonly terrainSeed: number;
    readonly terrainOverrides: readonly IBigMapLayoutTerrainOverride[];
    readonly cities: readonly IBigMapLayoutCity[];
    readonly monsters: readonly IBigMapLayoutMonster[];
    /** 空数组 = 该图不预置基地（联机版由服务器下发落点）。离线调试档才写。 */
    readonly bases: readonly IBigMapLayoutBase[];
    /** 障碍 / 禁放格（不能摆城、怪、基地）。 */
    readonly blocked: readonly number[];
    readonly spawnZones: readonly IBigMapSpawnZone[];
    readonly points: readonly IBigMapLayoutPoint[];
    /** 背景图资源名（相对 `assets/resources`、不带扩展名，如 `image/bigmap/world_01`）。空串 = 无背景。 */
    readonly background: string;
}

export interface IBigMapExportOptions {
    readonly layoutVersion?: number;
    /**
     * 手改地形透传。
     *
     * `IBigMapWorld` 里只有**最终地形**，反推不出「哪几格是手改的」，所以导出时必须由调用方
     * （通常是 memory 里还留着原 layout 的 loader / 编辑器）把它带回来。
     * 不传 = 整张图纯种子决定。
     */
    readonly terrainOverrides?: readonly IBigMapLayoutTerrainOverride[];
    /**
     * 底稿布局：`IBigMapWorld` 不承载的静态标注（城池 `rangeHex`/`adjacentCityIds`/`label`、
     * `blocked`/`spawnZones`/`points`）从它兜底。
     *
     * 「世界 → 布局」是有损的（world 只装规则与渲染要用的东西），编辑器改完落位再导出时
     * 必须把底稿传进来，否则策划刷了半天的势力范围会被一次导出抹掉。
     */
    readonly base?: IBigMapLayout;
}

function fail(message: string): never {
    throw new Error(`BigMap 布局非法：${message}`);
}

function readInt(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) fail(`${field} 必须是整数，收到 ${String(value)}`);
    return value;
}

function readHexId(value: unknown, field: string, total: number): number {
    const hexId = readInt(value, field);
    if (hexId < 0 || hexId >= total) fail(`${field}=${hexId} 越界（合法范围 0..${total - 1}）`);
    return hexId;
}

function readHexIds(value: unknown, field: string, total: number): number[] {
    if (!Array.isArray(value) || value.length === 0) fail(`${field} 必须是非空数组`);
    const hexIds = value.map((item, index) => readHexId(item, `${field}[${index}]`, total));
    if (new Set(hexIds).size !== hexIds.length) fail(`${field} 内有重复格子`);
    return hexIds;
}

/** 可空的格子集合（势力范围 / 出生区块 / 障碍）：缺省给空数组，重复项静默去重。 */
function readHexIdSet(value: unknown, field: string, total: number): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail(`${field} 必须是数组`);
    const seen = new Set<number>();
    value.forEach((item, index) => seen.add(readHexId(item, `${field}[${index}]`, total)));
    return [...seen];
}

/** 可空的整数集合（相邻城池 id 之类）：缺省空数组，重复去重、升序 —— 与 js 侧同口径，便于对拍。 */
function readIntSet(value: unknown, field: string): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail(`${field} 必须是数组`);
    const seen = new Set<number>();
    value.forEach((item, index) => seen.add(readInt(item, `${field}[${index}]`)));
    return [...seen].sort((a, b) => a - b);
}

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string') fail(`${field} 必须是字符串`);
    return value;
}

/**
 * 校验 + 归一化一份布局（丢弃未知字段，给出的返回对象可直接序列化回盘）。
 *
 * 所有规则都在这里一次判完，`buildBigMapWorldFromLayout` 只做组装 ——
 * 避免「parse 放一半、build 再放一半」导致编辑器预览与发布校验口径不一致。
 */
export function parseBigMapLayout(raw: unknown): IBigMapLayout {
    if (!raw || typeof raw !== 'object') fail('顶层必须是对象');
    const src = raw as Record<string, unknown>;
    if (src.kind !== BIGMAP_LAYOUT_KIND) fail(`kind 必须是 "${BIGMAP_LAYOUT_KIND}"，收到 ${String(src.kind)}`);

    const version = readInt(src.version, 'version');
    if (version !== BIGMAP_LAYOUT_VERSION) fail(`version=${version} 不受支持（当前 ${BIGMAP_LAYOUT_VERSION}）`);

    const rows = readInt(src.rows, 'rows');
    const columns = readInt(src.columns, 'columns');
    if (rows <= 0 || columns <= 0) fail(`rows/columns 必须为正，收到 ${rows}×${columns}`);
    const total = rows * columns;

    const overridesRaw = src.terrainOverrides ?? [];
    if (!Array.isArray(overridesRaw)) fail('terrainOverrides 必须是数组');
    const seenOverride = new Set<number>();
    const terrainOverrides = overridesRaw.map((item, index): IBigMapLayoutTerrainOverride => {
        if (!item || typeof item !== 'object') fail(`terrainOverrides[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const hexId = readHexId(entry.hexId, `terrainOverrides[${index}].hexId`, total);
        const terrain = entry.terrain as BigMapTerrain;
        if (!TERRAINS.includes(terrain)) fail(`terrainOverrides[${index}].terrain=${String(terrain)} 不是合法地形`);
        if (seenOverride.has(hexId)) fail(`terrainOverrides 里格 ${hexId} 重复`);
        seenOverride.add(hexId);
        return { hexId, terrain };
    });

    const citiesRaw = src.cities ?? [];
    if (!Array.isArray(citiesRaw)) fail('cities 必须是数组');
    const cityIds = new Set<number>();
    const cities = citiesRaw.map((item, index): IBigMapLayoutCity => {
        if (!item || typeof item !== 'object') fail(`cities[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const cityId = readInt(entry.cityId, `cities[${index}].cityId`);
        if (cityIds.has(cityId)) fail(`城池 ${cityId} 重复`);
        cityIds.add(cityId);
        const hexIds = readHexIds(entry.hexIds, `cities[${index}].hexIds`, total);
        const anchorHexId = readHexId(entry.anchorHexId, `cities[${index}].anchorHexId`, total);
        if (!hexIds.includes(anchorHexId)) fail(`城池 ${cityId} 的锚点 ${anchorHexId} 不在自己的 hexIds 里`);
        return {
            cityId,
            anchorHexId,
            hexIds,
            ring: readInt(entry.ring, `cities[${index}].ring`),
            rangeHex: readHexIdSet(entry.rangeHex, `cities[${index}].rangeHex`, total),
            adjacentCityIds: readIntSet(entry.adjacentCityIds, `cities[${index}].adjacentCityIds`),
            label: typeof entry.label === 'string' ? entry.label : String(cityId),
        };
    });

    const monstersRaw = src.monsters ?? [];
    if (!Array.isArray(monstersRaw)) fail('monsters 必须是数组');
    const instanceIds = new Set<number>();
    const monsters = monstersRaw.map((item, index): IBigMapLayoutMonster => {
        if (!item || typeof item !== 'object') fail(`monsters[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const instanceId = readInt(entry.instanceId, `monsters[${index}].instanceId`);
        if (instanceIds.has(instanceId)) fail(`野怪实例 ${instanceId} 重复`);
        instanceIds.add(instanceId);
        const hexIds = readHexIds(entry.hexIds, `monsters[${index}].hexIds`, total);
        const anchorHexId = readHexId(entry.anchorHexId, `monsters[${index}].anchorHexId`, total);
        if (!hexIds.includes(anchorHexId)) fail(`野怪 ${instanceId} 的锚点 ${anchorHexId} 不在自己的 hexIds 里`);
        return {
            instanceId,
            monsterId: readInt(entry.monsterId, `monsters[${index}].monsterId`),
            level: readInt(entry.level, `monsters[${index}].level`),
            anchorHexId,
            hexIds,
        };
    });

    const basesRaw = src.bases ?? [];
    if (!Array.isArray(basesRaw)) fail('bases 必须是数组');
    const baseIds = new Set<string>();
    const usedHexes = new Set<number>();
    const bases = basesRaw.map((item, index): IBigMapLayoutBase => {
        if (!item || typeof item !== 'object') fail(`bases[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const baseId = readString(entry.baseId, `bases[${index}].baseId`);
        if (baseIds.has(baseId)) fail(`基地 ${baseId} 重复`);
        baseIds.add(baseId);
        const hexId = readHexId(entry.hexId, `bases[${index}].hexId`, total);
        if (usedHexes.has(hexId)) fail(`基地 ${baseId} 的格 ${hexId} 与其它基地重叠`);
        usedHexes.add(hexId);
        return {
            baseId,
            name: readString(entry.name, `bases[${index}].name`),
            isPlayer: entry.isPlayer === true,
            hexId,
            ring: readInt(entry.ring, `bases[${index}].ring`),
            power: readInt(entry.power ?? 0, `bases[${index}].power`),
        };
    });
    if (bases.filter((base) => base.isPlayer).length > 1) fail('玩家基地最多 1 个');

    const blocked = readHexIdSet(src.blocked, 'blocked', total);

    const zonesRaw = src.spawnZones ?? [];
    if (!Array.isArray(zonesRaw)) fail('spawnZones 必须是数组');
    const zoneIds = new Set<number>();
    const spawnZones = zonesRaw.map((item, index): IBigMapSpawnZone => {
        if (!item || typeof item !== 'object') fail(`spawnZones[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const zoneId = readInt(entry.zoneId, `spawnZones[${index}].zoneId`);
        if (zoneIds.has(zoneId)) fail(`出生区块 ${zoneId} 重复`);
        zoneIds.add(zoneId);
        const cells = readHexIdSet(entry.cells, `spawnZones[${index}].cells`, total);
        if (cells.length === 0) fail(`出生区块 ${zoneId} 的 cells 不能为空`);
        return {
            zoneId,
            cityId: readInt(entry.cityId ?? 0, `spawnZones[${index}].cityId`),
            cells,
            capacity: readInt(entry.capacity ?? 0, `spawnZones[${index}].capacity`),
        };
    });

    const pointsRaw = src.points ?? [];
    if (!Array.isArray(pointsRaw)) fail('points 必须是数组');
    const pointIds = new Set<number>();
    const points = pointsRaw.map((item, index): IBigMapLayoutPoint => {
        if (!item || typeof item !== 'object') fail(`points[${index}] 必须是对象`);
        const entry = item as Record<string, unknown>;
        const pointId = readInt(entry.pointId, `points[${index}].pointId`);
        if (pointIds.has(pointId)) fail(`据点 ${pointId} 重复`);
        pointIds.add(pointId);
        const pointType = readInt(entry.pointType, `points[${index}].pointType`);
        if (pointType < 1 || pointType > 3) fail(`points[${index}].pointType=${pointType} 只能是 1~3`);
        return {
            pointId,
            pointType,
            hexIds: readHexIds(entry.hexIds, `points[${index}].hexIds`, total),
            openCron: typeof entry.openCron === 'string' ? entry.openCron : '',
        };
    });

    // 三类占位互斥：城池之间、城与怪、怪之间、基地与城/怪，全部不能压同一格；障碍也是占位。
    const occupied = new Map<number, string>();
    const claim = (hexId: number, tag: string): void => {
        const previous = occupied.get(hexId);
        if (previous !== undefined) fail(`格 ${hexId} 被 ${previous} 和 ${tag} 同时占用`);
        occupied.set(hexId, tag);
    };
    for (const hexId of blocked) claim(hexId, '障碍');
    for (const city of cities) city.hexIds.forEach((hexId) => claim(hexId, `城池${city.cityId}`));
    for (const monster of monsters) monster.hexIds.forEach((hexId) => claim(hexId, `野怪${monster.instanceId}`));
    for (const base of bases) claim(base.hexId, `基地${base.baseId}`);
    for (const point of points) point.hexIds.forEach((hexId) => claim(hexId, `据点${point.pointId}`));

    return {
        kind: BIGMAP_LAYOUT_KIND,
        version,
        layoutVersion: readInt(src.layoutVersion ?? BIGMAP_LAYOUT_VERSION, 'layoutVersion'),
        worldId: readInt(src.worldId, 'worldId'),
        worldName: readString(src.worldName, 'worldName'),
        rows,
        columns,
        terrainSeed: readInt(src.terrainSeed, 'terrainSeed'),
        terrainOverrides,
        cities,
        monsters,
        bases,
        blocked,
        spawnZones,
        points,
        background: typeof src.background === 'string' ? src.background : '',
    };
}

/**
 * 从已生成的世界反推一份布局。
 *
 * ⚠️ **地形只有最终值**，所以 `terrainOverrides` 必须由调用方透传（见 `IBigMapExportOptions`）；
 * 不传等价于「整张图纯种子决定」，此时若原图有手改格，往返后的地形会回退成种子值。
 */
export function exportBigMapLayout(world: IBigMapWorld, options: IBigMapExportOptions = {}): IBigMapLayout {
    const base = options.base;
    const baseCityById = new Map<number, IBigMapLayoutCity>();
    for (const city of base?.cities ?? []) baseCityById.set(city.cityId, city);

    const cities = [...world.cities.values()]
        .sort((a, b) => a.cityId - b.cityId)
        .map((site): IBigMapLayoutCity => {
            const carried = baseCityById.get(site.cityId);
            return {
                cityId: site.cityId,
                anchorHexId: site.anchorHexId,
                hexIds: [...site.hexIds],
                ring: site.ring,
                // 世界不承载这三项，只能从底稿抄回来；没有底稿就是「没刷过范围」。
                rangeHex: [...(carried?.rangeHex ?? [])],
                adjacentCityIds: [...(carried?.adjacentCityIds ?? [])],
                label: carried?.label ?? String(site.cityId),
            };
        });

    const monsters = [...world.monsters]
        .sort((a, b) => a.instanceId - b.instanceId)
        .map((site): IBigMapLayoutMonster => ({
            instanceId: site.instanceId,
            monsterId: site.monsterId,
            level: site.level,
            anchorHexId: site.anchorHexId,
            hexIds: [...site.hexIds],
        }));

    const bases = [...world.bases].map((site): IBigMapLayoutBase => ({
        baseId: site.baseId,
        name: site.name,
        isPlayer: site.isPlayer,
        hexId: site.hexId,
        ring: site.ring,
        power: site.power,
    }));

    return {
        kind: BIGMAP_LAYOUT_KIND,
        version: BIGMAP_LAYOUT_VERSION,
        layoutVersion: options.layoutVersion ?? BIGMAP_LAYOUT_VERSION,
        worldId: world.worldId,
        worldName: world.worldName,
        rows: world.rows,
        columns: world.cols,
        terrainSeed: world.seed,
        terrainOverrides: (options.terrainOverrides ?? base?.terrainOverrides ?? []).map((entry) => ({ ...entry })),
        cities,
        monsters,
        bases,
        blocked: [...(base?.blocked ?? [])],
        spawnZones: (base?.spawnZones ?? []).map((zone) => ({ ...zone, cells: [...zone.cells] })),
        points: (base?.points ?? []).map((point) => ({ ...point, hexIds: [...point.hexIds] })),
        background: base?.background ?? '',
    };
}

/** 布局与配置表的尺寸是否对得上（对不上就不是这张图，直接走种子兜底，别硬套）。 */
export function isBigMapLayoutCompatible(layout: IBigMapLayout, config: IBigMapConfig): boolean {
    return layout.rows === config.world.rows && layout.columns === config.world.cols;
}

export interface IBigMapLayoutResolution {
    readonly layout: IBigMapLayout | null;
    /** 不可用的原因（人话，直接进日志）。可用时为空串。 */
    readonly reason: string;
}

/**
 * 把磁盘上的原始 JSON 变成可用布局；不可用就返回 `null` + 原因。
 *
 * **纯函数、零 `cc`**，所以加载器（要 `JsonAsset`）和单测（不能碰引擎）能共用同一条判据。
 * `null` 不是错误 —— 调用方一律回退种子生成：策划的图挂了最多是「回到默认地图」，不能白屏。
 */
export function resolveBigMapLayout(raw: unknown, config: IBigMapConfig): IBigMapLayoutResolution {
    if (raw === null || raw === undefined) return { layout: null, reason: '没有布局文件' };
    let layout: IBigMapLayout;
    try {
        layout = parseBigMapLayout(raw);
    } catch (error) {
        return { layout: null, reason: `布局不合法：${(error as Error).message}` };
    }
    if (!isBigMapLayoutCompatible(layout, config)) {
        return {
            layout: null,
            reason: `布局尺寸 ${layout.rows}×${layout.columns} 与配置 ${config.world.rows}×${config.world.cols} 不一致`,
        };
    }
    return { layout, reason: '' };
}

/**
 * 用布局重建世界。
 *
 * 这里只做**外键**校验（布局里的城/怪是否在配置表里），格位合法性已由 `parseBigMapLayout` 判完。
 * 直接喂手搓对象进来（绕过 parse）时，外键错误会在这里抛。
 */
export function buildBigMapWorldFromLayout(config: IBigMapConfig, layout: IBigMapLayout): IBigMapWorld {
    if (!isBigMapLayoutCompatible(layout, config)) {
        throw new Error(
            `BigMap 布局与配置表尺寸不一致：布局 ${layout.rows}×${layout.columns}，`
            + `配置 ${config.world.rows}×${config.world.cols}`,
        );
    }

    const overrideMap = new Map<number, BigMapTerrain>();
    for (const entry of layout.terrainOverrides) overrideMap.set(entry.hexId, entry.terrain);
    const { tiles, tileById, ringCounts, centerHexId } = buildBigMapTiles(
        layout.rows,
        layout.columns,
        layout.terrainSeed,
        overrideMap,
    );

    const cities = new Map<number, IBigMapCitySite>();
    const cityByHex = new Map<number, number>();
    for (const city of layout.cities) {
        if (!config.cities.has(city.cityId)) {
            throw new Error(`BigMap 布局里的城池 ${city.cityId} 不在 BigMap-城池配置 中（配置与布局不同步）`);
        }
        const site: IBigMapCitySite = {
            cityId: city.cityId,
            anchorHexId: city.anchorHexId,
            hexIds: city.hexIds,
            ring: city.ring,
        };
        cities.set(city.cityId, site);
        for (const hexId of city.hexIds) cityByHex.set(hexId, city.cityId);
    }

    const monsters: IBigMapMonsterSite[] = layout.monsters.map((monster) => {
        if (!config.monsters.has(monster.monsterId)) {
            throw new Error(`BigMap 布局里的野怪 ${monster.monsterId} 不在 BigMap-野怪配置 中（配置与布局不同步）`);
        }
        return {
            instanceId: monster.instanceId,
            monsterId: monster.monsterId,
            level: monster.level,
            anchorHexId: monster.anchorHexId,
            hexIds: monster.hexIds,
        };
    });
    const monsterByHex = new Map<number, number>();
    for (const monster of monsters) {
        for (const hexId of monster.hexIds) monsterByHex.set(hexId, monster.instanceId);
    }

    const bases: IBigMapBaseSite[] = layout.bases.map((base) => ({
        baseId: base.baseId,
        name: base.name,
        isPlayer: base.isPlayer,
        hexId: base.hexId,
        ring: base.ring,
        power: base.power,
    }));
    const playerBase = bases.find((base) => base.isPlayer) ?? {
        baseId: 'player', name: '我的基地', isPlayer: true,
        hexId: centerHexId, ring: 0, power: 0,
    };

    return {
        worldId: layout.worldId,
        worldName: layout.worldName,
        rows: layout.rows,
        cols: layout.columns,
        seed: layout.terrainSeed,
        centerHexId,
        tiles,
        tileById,
        ringCounts,
        cities,
        cityByHex,
        monsters,
        monsterByHex,
        bases,
        playerBase,
        baseByHex: new Map(bases.map((site) => [site.hexId, site] as const)),
    };
}
