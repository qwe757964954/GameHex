import {
    BigMapBuildingKind,
    BIGMAP_RES_ORDER,
    type BigMapResType,
    type IBigMapBuildingConfig,
    type IBigMapBuildingLevelConfig,
    type IBigMapCityConfig,
    type IBigMapCampConfig,
    type IBigMapCityLevelConfig,
    type IBigMapConfig,
    type IBigMapMonsterConfig,
    type IBigMapMonsterDrop,
    type IBigMapProduceConfig,
    type IBigMapQueueConfig,
    type IBigMapRankConfig,
    type IBigMapResConfig,
    type IBigMapScoreRuleConfig,
    type IBigMapStaminaConfig,
    type IBigMapWorldConfig,
} from './BigMapTypes';
import {
    parseBigMapClockTime,
    validateBigMapCitySchedule,
    type IBigMapCitySchedule,
} from './BigMapCitySchedule';

/**
 * 配置表名 —— 与 `assets/remoteRef/<名字>.json` 的文件名**逐字一致**。
 *
 * 命名照全仓规范（`pvpCard.json` / `mapTerrian.json` 那一套）：英文 camelCase + `bigmap` 前缀。
 * 中文名只留在策划 Excel 的 sheet 名与 `tools/config/gen_bigmap_tables.TITLES` 里给人看
 * —— 表名写中文会让 eSon 导出中文文件名（用户 2026-10-20 明确要求不要）。
 *
 * 格式沿用项目既有的 `{"k":[字段...],"v":[[值...]]}` 压缩表（`RefUtil` 解压成对象数组）。
 */
export const BIGMAP_TABLE = {
    world: 'bigmapWorld',
    schedule: 'bigmapSchedule',
    // 🔴 建筑/升级走**策划表**（`DM-建筑配置.xlsx` → `baseBuilding.json` / `DM-建筑升级.xlsx`
    // → `baseBuildingLevel.json`），早年 `gen_bigmap_tables.py` 推算的 `bigmapBuilding*`
    // 是另一套 id（8 个建筑 vs 策划 23 个），服务端只认策划表 ⇒ 建造请求会打错建筑。
    building: 'baseBuilding',
    buildingLevel: 'baseBuildingLevel',
    // 旧产出表保留读取，但产出**优先**从 `baseBuildingLevel` 的 resType/producePerHour/produceCap 取。
    produce: 'bigmapBuildingProduce',
    resource: 'bigmapResource',
    queue: 'bigmapQueue',
    city: 'bigmapCity',
    camp: 'bigMapCamp',
    cityLevel: 'bigmapCityLevel',
    rank: 'bigmapRank',
    scoreRule: 'bigmapScoreRule',
    monster: 'bigmapMonster',
    stamina: 'bigmapStamina',
} as const;

export type BigMapTableName = typeof BIGMAP_TABLE[keyof typeof BIGMAP_TABLE];

/** 原始表集合：表名 → `{k,v}` 压缩载荷，或已经解压好的对象数组。 */
export type BigMapRawTables = Readonly<Record<string, unknown>>;

export type BigMapRow = Readonly<Record<string, unknown>>;

/**
 * 把 `{"k":[...],"v":[[...]]}` 解压成对象数组；已经是对象数组时原样返回。
 *
 * 客户端正常路径由 `RefUtil` 解压（`tryGetCompressKeyRefData`），这里再兜一层是为了
 * **测试**能直接读盘上的 JSON —— 判据与运行时走同一条归一化入口，避免「测试绿、真机炸」。
 */
export function decompressBigMapRows(payload: unknown): readonly BigMapRow[] {
    if (Array.isArray(payload)) {
        return payload.filter((row): row is BigMapRow => !!row && typeof row === 'object');
    }
    if (!payload || typeof payload !== 'object') return [];
    const keys = (payload as { k?: unknown }).k;
    const values = (payload as { v?: unknown }).v;
    if (!Array.isArray(keys) || !Array.isArray(values)) return [];
    const names = keys.map((key) => String(key));
    const rows: BigMapRow[] = [];
    for (const value of values) {
        if (!Array.isArray(value)) continue;
        const row: Record<string, unknown> = {};
        for (let index = 0; index < names.length; index += 1) row[names[index]] = value[index];
        rows.push(row);
    }
    return rows;
}

/** 取表：缺表直接抛错（配置缺失必须**当场**暴露，不能静默退化成空玩法）。 */
function table(tables: BigMapRawTables, name: BigMapTableName): readonly BigMapRow[] {
    const rows = decompressBigMapRows(tables[name]);
    if (rows.length === 0) throw new Error(`[BigMap] 配置表缺失或为空：${name}`);
    return rows;
}

function num(row: BigMapRow, field: string): number {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) {
        throw new Error(`[BigMap] 字段 ${field} 不是有效数字：${JSON.stringify(row)}`);
    }
    return value;
}

function int(row: BigMapRow, field: string): number {
    return Math.round(num(row, field));
}

function text(row: BigMapRow, field: string): string {
    const value = row[field];
    return value === null || value === undefined ? '' : String(value);
}

function flag(row: BigMapRow, field: string): boolean {
    return int(row, field) !== 0;
}

/**
 * 取「两个候选字段里的第一个有值的」——策划表与早期推算表字段名不同
 * （`baseBuildSize` vs `occupyHex`、`baseBuildMaxNum` vs `maxOwnNum`），
 * 两个都没有就用默认值。**有值但非法仍然抛**，不能把脏数据当成缺列。
 */
function pickInt(row: BigMapRow, primary: string, fallback: string, defaultValue: number): number {
    for (const field of [primary, fallback]) {
        const value = row[field];
        if (value === undefined || value === null || value === '') continue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`[BigMap] 字段 ${field} 不是有效数字：${JSON.stringify(row)}`);
        }
        return Math.round(parsed);
    }
    return defaultValue;
}

/** 缺失给 `defaultValue`，有值但非法抛错。 */
function optionalInt(row: BigMapRow, field: string, defaultValue = 0): number {
    const value = row[field];
    if (value === undefined || value === null || value === '') return defaultValue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`[BigMap] 字段 ${field} 不是有效数字：${JSON.stringify(row)}`);
    }
    return Math.round(parsed);
}

/** `baseBuildingLevel.preBuild`：`[{buildId,buildLevel}]`，可能是 JSON 字符串。 */
function parsePreBuild(value: unknown): readonly { readonly id: number; readonly level: number }[] {
    let raw = value;
    if (typeof raw === 'string') {
        if (!raw.trim()) return [];
        try { raw = JSON.parse(raw); } catch { return []; }
    }
    if (!Array.isArray(raw)) return [];
    const result: { id: number; level: number }[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as { buildId?: unknown; buildLevel?: unknown };
        const id = Number(record.buildId);
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const level = Number(record.buildLevel);
        result.push({ id, level: Number.isSafeInteger(level) && level > 0 ? level : 1 });
    }
    return result;
}

/** 资源类型白名单校验：配置里写错枚举会让产出直接消失，必须拦住。 */
function resType(row: BigMapRow): BigMapResType {
    const value = text(row, 'resType') as BigMapResType;
    if (!BIGMAP_RES_ORDER.includes(value)) {
        throw new Error(`[BigMap] 未知资源类型：${value}`);
    }
    return value;
}

/**
 * 解析全部 BigMap 配置。
 *
 * 校验集中在边界（契约先行）：id 唯一、等级连续、前置城池存在、名次连续、开放城池必须属于个人层。
 * 任何一条不满足都抛错 —— 这些错误在运行时是「玩法静默不工作」，越早炸越好定位。
 */
export function parseBigMapConfig(tables: BigMapRawTables): IBigMapConfig {
    const world = parseWorld(table(tables, BIGMAP_TABLE.world)[0]);
    const schedule = parseSchedule(table(tables, BIGMAP_TABLE.schedule)[0]);
    const buildingRows = table(tables, BIGMAP_TABLE.building);
    const buildings = new Map<number, IBigMapBuildingConfig>();
    let mainBuildingId = 0;
    for (const row of buildingRows) {
        const item = parseBuilding(row);
        if (buildings.has(item.id)) throw new Error(`[BigMap] 建筑 id 重复：${item.id}`);
        buildings.set(item.id, item);
        if (item.kind === BigMapBuildingKind.Main) {
            if (mainBuildingId !== 0) throw new Error('[BigMap] 主城建筑只能有一个');
            mainBuildingId = item.id;
        }
    }
    if (mainBuildingId === 0) throw new Error('[BigMap] 缺少 baseBuildType = 1 的主城建筑');

    const levelRows = table(tables, BIGMAP_TABLE.buildingLevel);
    const levels = parseBuildingLevels(levelRows, buildings);

    // 资源表要先于产出表：`baseBuildingLevel.resType` 存的是**背包道具 id**（18501 粮食…），
    // 要按 `bigmapResource.itemId` 反查成 grain/wood/iron/coin。
    const resources = new Map<BigMapResType, IBigMapResConfig>();
    for (const row of table(tables, BIGMAP_TABLE.resource)) {
        const item = parseResource(row);
        resources.set(item.resType, item);
    }
    for (const res of BIGMAP_RES_ORDER) {
        if (!resources.has(res)) throw new Error(`[BigMap] 资源定义缺 ${res}`);
    }

    const produce = parseProduce(levelRows, table(tables, BIGMAP_TABLE.produce), buildings, resources);

    const queue = parseQueue(table(tables, BIGMAP_TABLE.queue)[0]);
    const cityLevels = new Map<number, IBigMapCityLevelConfig>();
    for (const row of table(tables, BIGMAP_TABLE.cityLevel)) {
        const item = parseCityLevel(row);
        if (cityLevels.has(item.level)) throw new Error(`[BigMap] 城池等级重复：${item.level}`);
        cityLevels.set(item.level, item);
    }

    const cities = new Map<number, IBigMapCityConfig>();
    for (const row of table(tables, BIGMAP_TABLE.city)) {
        const item = parseCity(row, cityLevels);
        if (cities.has(item.cityId)) throw new Error(`[BigMap] 城池 id 重复：${item.cityId}`);
        cities.set(item.cityId, item);
    }
    for (const city of cities.values()) {
        if (city.prevCityId !== 0 && !cities.has(city.prevCityId)) {
            throw new Error(`[BigMap] 城池 ${city.cityId} 的前置城池 ${city.prevCityId} 不存在`);
        }
        if (city.slotCount <= 0 || city.slot < 0 || city.slot >= city.slotCount) {
            throw new Error(`[BigMap] 城池 ${city.cityId} 的 slot/slotCount 越界`);
        }
    }

    const ranks = parseRanks(table(tables, BIGMAP_TABLE.rank));
    const scoreRule = parseScoreRule(table(tables, BIGMAP_TABLE.scoreRule)[0]);

    const monsters = new Map<number, IBigMapMonsterConfig>();
    for (const row of table(tables, BIGMAP_TABLE.monster)) {
        const item = parseMonster(row);
        if (monsters.has(item.id)) throw new Error(`[BigMap] 野怪 id 重复：${item.id}`);
        monsters.set(item.id, item);
    }

    const camps = new Map<number, IBigMapCampConfig>();
    for (const row of table(tables, BIGMAP_TABLE.camp)) {
        const item = parseCamp(row);
        if (camps.has(item.campId)) throw new Error(`[BigMap] 据点 campId 重复：${item.campId}`);
        camps.set(item.campId, item);
    }
    const stamina = parseStamina(table(tables, BIGMAP_TABLE.stamina)[0]);

    return {
        world, schedule, buildings, levels, produce, resources, queue,
        cities, camps, cityLevels, ranks, scoreRule, monsters, stamina, mainBuildingId,
        // 背包道具图标要读 `item` 表，那条链在 loader 上（`attachBigMapResourceItemIcons`）；
        // 这里保持纯函数，先给空表 —— 视图查不到就退回概念图。
        resourceIcons: new Map(),
    };
}

/**
 * 把 `item` 表里的图标并进资源定义：`bigmapResource.itemId → item.icon`。
 *
 * 为什么要单独一步：`parseBigMapConfig` 是纯函数，只吃 bigmap 那 12 张表；而资源图标
 * 现在跟背包道具共用一份图（用户 2026-10-26 口径：「大地图顶部资源 18501..18505 走背包的」），
 * 读 `item` 表属于「配置加载编排」的活，放 loader 侧才不破坏纯函数。
 *
 * `item.icon` 为空（例如策划还没配图）⇒ 这一项不进来，视图退回
 * `image/bigmap/concept/sprites/<resType>` 概念图，不会出现空图标。
 */
export function attachBigMapResourceItemIcons(
    config: IBigMapConfig,
    itemRows: readonly unknown[] | null | undefined,
): IBigMapConfig {
    const wanted = new Map<number, BigMapResType>();
    for (const res of config.resources.values()) {
        if (res.itemId > 0) wanted.set(res.itemId, res.resType);
    }
    if (wanted.size === 0 || !itemRows || itemRows.length === 0) return config;

    const byId = new Map<number, BigMapRow>();
    for (const row of itemRows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as BigMapRow;
        const id = Number(record.resId);
        if (Number.isSafeInteger(id) && wanted.has(id)) byId.set(id, record);
    }

    const resourceIcons = new Map<BigMapResType, string>();
    for (const [itemId, resType] of wanted) {
        const icon = text(byId.get(itemId) ?? {}, 'icon').trim();
        if (icon) resourceIcons.set(resType, icon);
    }
    if (resourceIcons.size === 0) return config;
    return { ...config, resourceIcons };
}

/**
 * 攻城日程：表里写 `"09:00"` 这种人类可读格式，这里折成当日秒并**复用同一套校验**。
 *
 * 解析与校验放同一条链上（`parseBigMapClockTime` → `validateBigMapCitySchedule`），
 * 保证「表写错」和「代码里手写常量写错」炸在同一个地方。
 */
function parseSchedule(row: BigMapRow): IBigMapCitySchedule {
    const schedule: IBigMapCitySchedule = {
        utcOffsetSeconds: num(row, 'utcOffsetHours') * 3600,
        openAt: parseBigMapClockTime(text(row, 'openTime'), 'openTime'),
        lockAt: parseBigMapClockTime(text(row, 'lockTime'), 'lockTime'),
        settleAt: parseBigMapClockTime(text(row, 'settleTime'), 'settleTime'),
        snapshotAt: parseBigMapClockTime(text(row, 'snapshotTime'), 'snapshotTime'),
    };
    validateBigMapCitySchedule(schedule);
    return schedule;
}

function parseWorld(row: BigMapRow): IBigMapWorldConfig {
    const world: IBigMapWorldConfig = {
        worldId: int(row, 'worldId'),
        worldName: text(row, 'worldName'),
        rows: int(row, 'rows'),
        cols: int(row, 'cols'),
        cityRing1: int(row, 'cityRing1'),
        cityRing2: int(row, 'cityRing2'),
        baseRadiusMin: int(row, 'baseRadiusMin'),
        baseRadiusMax: int(row, 'baseRadiusMax'),
        npcBaseCount: Math.max(0, int(row, 'npcBaseCount')),
        monsterRingMax: int(row, 'monsterRingMax'),
    };
    if (world.rows < 8 || world.cols < 8) throw new Error('[BigMap] 地图尺寸过小');
    if (world.cityRing1 <= 2 || world.cityRing1 >= Math.min(world.rows, world.cols) / 2) {
        throw new Error('[BigMap] cityRing1 必须落在 (2, 地图半径) 区间内');
    }
    if (world.baseRadiusMin > world.baseRadiusMax) throw new Error('[BigMap] 基地分布半径倒挂');
    return world;
}

function parseBuilding(row: BigMapRow): IBigMapBuildingConfig {
    // 策划表：`baseBuildSize` / `baseBuildMaxNum` / `unlockType` + `unlockParam`；
    // 早期推算表：`occupyHex` / `maxOwnNum` / `unlockChapter`。两套都认。
    const unlockType = optionalInt(row, 'unlockType', 1);
    const unlockParam = optionalInt(row, 'unlockParam', 0);
    const kind = num(row, 'baseBuildType');
    if (!Number.isInteger(kind) || kind < BigMapBuildingKind.Main || kind > BigMapBuildingKind.Decoration) {
        throw new Error(`[BigMap] baseBuildType 非法：${kind}`);
    }
    const rawCellId = row.basebuildPositon;
    const initialCellId = rawCellId === undefined || rawCellId === null || rawCellId === ''
        ? 0 : num(row, 'basebuildPositon');
    if (!Number.isInteger(initialCellId) || initialCellId < 0) {
        throw new Error(`[BigMap] basebuildPositon 非法：${initialCellId}`);
    }
    return {
        id: int(row, 'id'),
        name: text(row, 'baseBuildName'),
        kind,
        icon: text(row, 'baseBuildIcon').trim(),
        initialCellId: initialCellId || null,
        occupyHex: Math.max(1, pickInt(row, 'baseBuildSize', 'occupyHex', 1)),
        maxOwnNum: Math.max(1, pickInt(row, 'baseBuildMaxNum', 'maxOwnNum', 1)),
        // 章节解锁时章节号写在 `unlockParam`；其它解锁方式（赛季天数 / 积分购买）没有章节。
        unlockChapter: unlockType === 1 ? Math.max(0, unlockParam)
            : Math.max(0, optionalInt(row, 'unlockChapter', 0)),
        unlockType: unlockType > 0 ? unlockType : 1,
        unlockParam: Math.max(0, unlockParam),
        queueType: Math.max(1, optionalInt(row, 'queueType', 1)),
        sort: int(row, 'sort'),
        // 缺列按「可移动」处理（早期推算表没这一列，行为与搬移上线时一致）。
        canMove: pickInt(row, 'canMove', 'canMove', 1) !== 0,
        info: text(row, 'baseBuildInfo'),
    };
}

function parseBuildingLevels(
    rows: readonly BigMapRow[],
    buildings: ReadonlyMap<number, IBigMapBuildingConfig>,
): ReadonlyMap<number, ReadonlyMap<number, IBigMapBuildingLevelConfig>> {
    const byBuilding = new Map<number, Map<number, IBigMapBuildingLevelConfig>>();
    for (const row of rows) {
        const preBuildList = parsePreBuild(row.preBuild);
        const item: IBigMapBuildingLevelConfig = {
            id: int(row, 'id'),
            level: int(row, 'buildLevel'),
            costGrain: int(row, 'costGrain'),
            costWood: int(row, 'costWood'),
            costIron: int(row, 'costIron'),
            instantCost: int(row, 'instantCost'),
            preBuild: preBuildList,
            preBuildId: preBuildList[0]?.id ?? optionalInt(row, 'preBuildId', 0),
            preBuildLevel: preBuildList[0]?.level ?? optionalInt(row, 'preBuildLevel', 0),
            buildTime: int(row, 'buildTime'),
            maxOtherLevel: int(row, 'maxOtherLevel'),
            resCap: int(row, 'resCap'),
            // 策划表这列是**数组**（`[]`），旧表是千分比数字；数组一律按 0 处理。
            attrBonus: Array.isArray(row.attrBonus) ? 0 : optionalInt(row, 'attrBonus', 0),
        };
        if (!buildings.has(item.id)) throw new Error(`[BigMap] 建筑升级表引用了不存在的建筑 ${item.id}`);
        let levels = byBuilding.get(item.id);
        if (!levels) { levels = new Map(); byBuilding.set(item.id, levels); }
        if (levels.has(item.level)) throw new Error(`[BigMap] 建筑 ${item.id} 等级 ${item.level} 重复`);
        if (item.buildTime < 0) throw new Error(`[BigMap] 建筑 ${item.id} 等级 ${item.level} 耗时非法`);
        levels.set(item.level, item);
    }
    // 等级必须从 1 连续排到 max，否则「升到 L+1」会查不到配置。
    for (const [id, levels] of byBuilding) {
        const max = Math.max(...levels.keys());
        for (let level = 1; level <= max; level += 1) {
            if (!levels.has(level)) throw new Error(`[BigMap] 建筑 ${id} 缺 ${level} 级配置`);
        }
    }
    return byBuilding;
}

/**
 * 建筑产出（每等级每小时产量与累积上限）。
 *
 * 两个来源，**策划表优先**：
 * - `baseBuildingLevel` 的 `resType`（**背包道具 id** 18501/18502/18503/18504，0 = 不产）
 *   + `producePerHour` + `produceCap` —— 策划把产出并进了升级表；
 * - 早期独立的 `bigmapBuildingProduce`（`resType` 是 grain/wood 字符串），只在上面一行产出都没有时兜底。
 */
function parseProduce(
    levelRows: readonly BigMapRow[],
    legacyRows: readonly BigMapRow[],
    buildings: ReadonlyMap<number, IBigMapBuildingConfig>,
    resources: ReadonlyMap<BigMapResType, IBigMapResConfig>,
): ReadonlyMap<number, ReadonlyMap<number, IBigMapProduceConfig>> {
    const byBuilding = new Map<number, Map<number, IBigMapProduceConfig>>();
    const resTypeByItemId = new Map<number, BigMapResType>();
    for (const res of resources.values()) {
        if (res.itemId > 0) resTypeByItemId.set(res.itemId, res.resType);
    }

    const push = (item: IBigMapProduceConfig): void => {
        if (!buildings.has(item.id)) throw new Error(`[BigMap] 产出配置引用了不存在的建筑 ${item.id}`);
        if (item.produceCap < item.producePerHour) {
            throw new Error(`[BigMap] 建筑 ${item.id} 等级 ${item.level} 的累积上限小于每小时产量`);
        }
        let levels = byBuilding.get(item.id);
        if (!levels) { levels = new Map(); byBuilding.set(item.id, levels); }
        levels.set(item.level, item);
    };

    for (const row of levelRows) {
        const itemId = optionalInt(row, 'resType', 0);
        if (itemId <= 0) continue;
        const type = resTypeByItemId.get(itemId);
        if (!type) {
            throw new Error(`[BigMap] baseBuildingLevel.resType=${itemId} 对不上任何资源的 itemId`);
        }
        push({
            id: int(row, 'id'),
            level: int(row, 'buildLevel'),
            resType: type,
            producePerHour: num(row, 'producePerHour'),
            produceCap: num(row, 'produceCap'),
        });
    }
    if (byBuilding.size > 0) return byBuilding;

    for (const row of legacyRows) {
        push({
            id: int(row, 'id'),
            level: int(row, 'buildLevel'),
            resType: resType(row),
            producePerHour: num(row, 'producePerHour'),
            produceCap: num(row, 'produceCap'),
        });
    }
    return byBuilding;
}

// 缺列的资源表仍须连接背包；图标、余额与建筑产出共用归一后的身份。
const BIGMAP_RESOURCE_ITEM_IDS: Readonly<Record<BigMapResType, number>> = {
    grain: 18501, wood: 18502, iron: 18503, coin: 18504, stamina: 18505,
};

function parseResource(row: BigMapRow): IBigMapResConfig {
    const type = resType(row);
    const itemId = row.itemId === undefined || row.itemId === null
        ? BIGMAP_RESOURCE_ITEM_IDS[type] : int(row, 'itemId');
    return {
        resType: type,
        name: text(row, 'resName'),
        startAmount: Math.max(0, int(row, 'startAmount')),
        itemId: Number.isSafeInteger(itemId) && itemId > 0 ? itemId : 0,
    };
}

// 新版队列表不再提供这三列；保留现有预览时长与建造区布局，联机结算仍走服务端。
const BIGMAP_QUEUE_CLIENT_DEFAULTS = { offlineMaxHours: 8, plotRows: 5, plotCols: 5 } as const;

function queueClientInt(row: BigMapRow, field: keyof typeof BIGMAP_QUEUE_CLIENT_DEFAULTS): number {
    if (!(field in row)) return BIGMAP_QUEUE_CLIENT_DEFAULTS[field];
    const value = row[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`[BigMap] 字段 ${field} 不是有效的非负整数：${JSON.stringify(row)}`);
    }
    return value;
}

function parseQueue(row: BigMapRow): IBigMapQueueConfig {
    const queue: IBigMapQueueConfig = {
        maxBuildQueue: Math.max(1, int(row, 'maxBuildQueue')),
        initBuildQueue: Math.max(1, int(row, 'initBuildQueue')),
        queueUnlockCost2: Math.max(0, int(row, 'queueUnlockCost2')),
        queueUnlockCost3: Math.max(0, int(row, 'queueUnlockCost3')),
        cancelReturnRate: Math.min(1, Math.max(0, num(row, 'cancelReturnRate'))),
        offlineMaxHours: queueClientInt(row, 'offlineMaxHours'),
        upgradeUnlockChapter: Math.max(1, int(row, 'upgradeUnlockChapter')),
        plotRows: Math.max(3, queueClientInt(row, 'plotRows')),
        plotCols: Math.max(3, queueClientInt(row, 'plotCols')),
    };
    if (queue.initBuildQueue > queue.maxBuildQueue) throw new Error('[BigMap] 初始队列数大于上限');
    if (queueClientInt(row, 'plotRows') < 3 || queueClientInt(row, 'plotCols') < 3
        || queue.plotRows > 20 || queue.plotCols > 20) {
        throw new Error('[BigMap] 建造区行列必须在3～20之间');
    }
    return queue;
}

function parseCityLevel(row: BigMapRow): IBigMapCityLevelConfig {
    return {
        level: int(row, 'cityLevel'),
        warScoreRate: num(row, 'warScoreRate'),
        occupyScore: int(row, 'occupyScore'),
        powerThreshold: int(row, 'powerThreshold'),
        cityLevelCoeff: num(row, 'cityLevelCoeff'),
        staminaCost: int(row, 'staminaCost'),
        minOccupyWarScore: int(row, 'minOccupyWarScore'),
        defenseHp: int(row, 'defenseHp'),
    };
}

function parseCity(row: BigMapRow, cityLevels: ReadonlyMap<number, IBigMapCityLevelConfig>): IBigMapCityConfig {
    const cityLevel = int(row, 'cityLevel');
    if (!cityLevels.has(cityLevel)) throw new Error(`[BigMap] 城池等级 ${cityLevel} 未配置`);
    const level = cityLevels.get(cityLevel);
    const available = flag(row, 'available');
    const layer = int(row, 'layer');
    // 本期只做「纯玩家个人战斗」，联盟/战盟层配置成 available = 0；反过来开放层必须是个人层。
    if (available && layer !== 1) {
        throw new Error(`[BigMap] 城池 ${int(row, 'cityId')} 开放但层级不是个人层（本期未做联盟/战盟）`);
    }
    return {
        cityId: int(row, 'cityId'),
        name: text(row, 'cityName'),
        layer,
        available,
        cityLevel,
        unlockChapter: int(row, 'unlockChapter'),
        openDay: int(row, 'openDay'),
        // 城池表没填行动力时退回等级表，保证「攻打一定消耗」不被 0 绕过。
        staminaCost: int(row, 'staminaCost') || level.staminaCost,
        defenseHp: int(row, 'defenseHp') || level.defenseHp,
        radiateCapacity: Math.max(1, int(row, 'radiateCapacity')),
        cityLevelCoeff: num(row, 'cityLevelCoeff') || level.cityLevelCoeff,
        prevCityId: int(row, 'prevCityId'),
        rewardCoin: Math.max(0, int(row, 'rewardCoin')),
        desc: text(row, 'cityDesc'),
        slot: int(row, 'slot'),
        slotCount: int(row, 'slotCount'),
    };
}

function parseRanks(rows: readonly BigMapRow[]): readonly IBigMapRankConfig[] {
    const ranks = rows
        .map((row) => ({ rank: int(row, 'rank'), coeffPct: num(row, 'coeffPct') }))
        .sort((a, b) => a.rank - b.rank);
    ranks.forEach((item, index) => {
        if (item.rank !== index + 1) throw new Error('[BigMap] 名次系数必须从 1 开始连续');
        if (item.coeffPct <= 0) throw new Error('[BigMap] 名次系数必须为正');
    });
    if (ranks.length === 0) throw new Error('[BigMap] 名次系数表为空');
    return ranks;
}

function parseScoreRule(row: BigMapRow): IBigMapScoreRuleConfig {
    const rule: IBigMapScoreRuleConfig = {
        marginalDamageCap: Math.max(1, int(row, 'marginalDamageCap')),
        rankExtendStepPct: Math.max(0, num(row, 'rankExtendStepPct')),
        rankExtendMinPct: Math.max(0, num(row, 'rankExtendMinPct')),
        crowdBase: num(row, 'crowdBase'),
        crowdK: num(row, 'crowdK'),
        offRangeDamageCutPct: num(row, 'offRangeDamageCutPct'),
        npcScoreRatio: Math.max(0, num(row, 'npcScoreRatio')),
    };
    if (rule.rankExtendMinPct > 100) throw new Error('[BigMap] 名次系数下限超过 100%');
    return rule;
}

function campInt(row: BigMapRow, field: string, min: number, max = 0xFFFFFFFF): number {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`[BigMap] 据点字段 ${field} 必须为 ${min}~${max} 的整数`);
    }
    return value;
}

function campNumber(row: BigMapRow, field: string): number {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`[BigMap] 据点字段 ${field} 必须为非负有限数值`);
    }
    return value;
}

function campIds(row: BigMapRow, field: string): readonly number[] {
    let value = row[field];
    if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { throw new Error(`[BigMap] 据点字段 ${field} 不是有效 JSON`); }
    }
    if (!Array.isArray(value) || value.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error(`[BigMap] 据点字段 ${field} 必须为正整数数组`);
    }
    return [...value];
}

function parseCamp(row: BigMapRow): IBigMapCampConfig {
    return {
        campId: campInt(row, 'campId', 1),
        battleId: campInt(row, 'campBattleId', 1),
        name: text(row, 'campName'),
        staminaCost: campInt(row, 'staminaCost', 0),
        desc: text(row, 'campDesc'),
        chapter: campInt(row, 'chapter', 1),
        gateNo: campInt(row, 'gateNo', 1),
        occupyType: campInt(row, 'occupyType', 1, 4),
        rallyOpen: campInt(row, 'rallyOpen', 0, 1) === 1,
        campSize: campInt(row, 'campSize', 1),
        adjacentCampIds: campIds(row, 'adjacentcampIds'),
        openDay: campInt(row, 'openDay', 0),
        dailyBattleLimit: campInt(row, 'dailyBattleLimit', 0),
        rankMinScore: campInt(row, 'rankMinScore', 0, Number.MAX_SAFE_INTEGER),
        warScoreRate: campNumber(row, 'warScoreRate'),
        singleDamageScoreMax: campInt(row, 'singleDamageScoreMax', 0, Number.MAX_SAFE_INTEGER),
        maxScoreConfig: campNumber(row, 'maxScoreConfig'),
        occupyScore: campInt(row, 'occupyScore', 0),
        minOccupyScore: campInt(row, 'minOccupyScore', 0, Number.MAX_SAFE_INTEGER),
        rankResetTime: campInt(row, 'rankResetTime', 0),
        warScoreReset: campInt(row, 'warScoreReset', 0, Number.MAX_SAFE_INTEGER),
        buffGroupIds: campIds(row, 'buffGroupId'),
        buffEffectIds: campIds(row, 'buffEffectId'),
        firstRewardId: campInt(row, 'firstRewardId', 0),
        buffConNum: campInt(row, 'buffConNum', 0),
        buffRate: campNumber(row, 'buffRate'),
        iconPath: text(row, 'campIcon').trim(),
    };
}

function parseMonster(row: BigMapRow): IBigMapMonsterConfig {
    const common = {
        id: int(row, 'monsterId'),
        name: text(row, 'monsterName'),
        level: int(row, 'monsterLevel'),
        staminaCost: Math.max(0, int(row, 'staminaCost')),
    };
    if ('monsterBattle' in row || 'monsterSize' in row) {
        return {
            ...common,
            occupyHex: monsterInt(row, 'monsterSize', 1),
            battle: {
                battleId: monsterInt(row, 'monsterBattle', 1),
                recommendAttack: monsterInt(row, 'recommendAttack', 0),
                unlockType: monsterInt(row, 'unlockType', 0),
                unlockValue: monsterInt(row, 'unlockValue', 0),
                rallyOpen: monsterInt(row, 'rallyOpen', 0, 1) === 1,
                rallyNum: monsterInt(row, 'rallyNum', 0),
                firstKillDrops: parseMonsterDrops(row, 'firstKillDropId'),
                normalDrops: parseMonsterDrops(row, 'normalDropId'),
                iconPath: text(row, 'monsterHeaIcon'),
                modelPath: text(row, 'monsterModel'),
            },
            offlineBattle: null,
        };
    }
    // 兼容旧版离线配置；等离线模拟与对应存档退役后删除，不为新版表补造旧战斗数值。
    return {
        ...common,
        occupyHex: Math.max(1, int(row, 'occupyHex')),
        battle: null,
        offlineBattle: {
            preLevel: Math.max(0, int(row, 'preLevel')),
            warScore: Math.max(0, int(row, 'warScore')),
            defenseHp: Math.max(1, int(row, 'defenseHp')),
            respawnSeconds: Math.max(0, int(row, 'respawnSeconds')),
            rewardGrain: Math.max(0, int(row, 'rewardGrain')),
            rewardWood: Math.max(0, int(row, 'rewardWood')),
            rewardIron: Math.max(0, int(row, 'rewardIron')),
            rewardCoin: Math.max(0, int(row, 'rewardCoin')),
        },
    };
}

function monsterInt(row: BigMapRow, field: string, min: number, max = Number.MAX_SAFE_INTEGER, prefix = ''): number {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`[BigMap] 野怪字段 ${prefix}${field} 必须为 ${min}~${max} 的整数：${JSON.stringify(row)}`);
    }
    return value;
}

function parseMonsterDrops(row: BigMapRow, field: string): readonly IBigMapMonsterDrop[] {
    const drops = row[field];
    if (!Array.isArray(drops)) throw new Error(`[BigMap] 野怪字段 ${field} 必须为掉落数组`);
    return drops.map((drop: unknown) => {
        if (!drop || typeof drop !== 'object' || Array.isArray(drop)) {
            throw new Error(`[BigMap] 野怪字段 ${field} 存在非法掉落`);
        }
        const item = drop as BigMapRow;
        return {
            resId: monsterInt(item, 'resId', 1, Number.MAX_SAFE_INTEGER, `${field}.`),
            number: monsterInt(item, 'number', 0, Number.MAX_SAFE_INTEGER, `${field}.`),
            pro: monsterInt(item, 'pro', 0, 10000, `${field}.`),
        };
    });
}

function parseStamina(row: BigMapRow): IBigMapStaminaConfig {
    const stamina: IBigMapStaminaConfig = {
        staminaMax: Math.max(1, int(row, 'staminaMax')),
        recoverInterval: Math.max(1, int(row, 'recoverInterval')),
        buyTimesDaily: Math.max(0, int(row, 'buyTimesDaily')),
    };
    return stamina;
}
