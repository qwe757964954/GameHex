import {
    BigMapBuildingKind,
    BIGMAP_RES_ORDER,
    type BigMapResType,
    type IBigMapBuildingConfig,
    type IBigMapBuildingLevelConfig,
    type IBigMapCityConfig,
    type IBigMapCityLevelConfig,
    type IBigMapConfig,
    type IBigMapMonsterConfig,
    type IBigMapProduceConfig,
    type IBigMapQueueConfig,
    type IBigMapRankConfig,
    type IBigMapResConfig,
    type IBigMapScoreRuleConfig,
    type IBigMapStaminaConfig,
    type IBigMapWorldConfig,
} from './BigMapTypes';

/**
 * 配置表名 —— 与 `assets/remoteRef/BigMap-*.json` 的文件名**逐字一致**。
 *
 * 用户 2026-10-17 规定：涉及本玩法的表格统一叫 `BigMap-<中文表名>`，
 * 格式沿用项目既有的 `{"k":[字段...],"v":[[值...]]}` 压缩表（`RefUtil` 解压成对象数组）。
 */
export const BIGMAP_TABLE = {
    world: 'BigMap-世界地图配置',
    building: 'BigMap-建筑配置',
    buildingLevel: 'BigMap-建筑升级',
    produce: 'BigMap-建筑产出',
    resource: 'BigMap-资源定义',
    queue: 'BigMap-队列配置',
    city: 'BigMap-城池配置',
    cityLevel: 'BigMap-城池等级',
    rank: 'BigMap-名次系数',
    scoreRule: 'BigMap-积分规则',
    monster: 'BigMap-野怪配置',
    stamina: 'BigMap-行动力配置',
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

    const levels = parseBuildingLevels(table(tables, BIGMAP_TABLE.buildingLevel), buildings);
    const produce = parseProduce(table(tables, BIGMAP_TABLE.produce), buildings);

    const resources = new Map<BigMapResType, IBigMapResConfig>();
    for (const row of table(tables, BIGMAP_TABLE.resource)) {
        const item = parseResource(row);
        resources.set(item.resType, item);
    }
    for (const res of BIGMAP_RES_ORDER) {
        if (!resources.has(res)) throw new Error(`[BigMap] 资源定义缺 ${res}`);
    }

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

    const stamina = parseStamina(table(tables, BIGMAP_TABLE.stamina)[0]);

    return {
        world, buildings, levels, produce, resources, queue,
        cities, cityLevels, ranks, scoreRule, monsters, stamina, mainBuildingId,
    };
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
    return {
        id: int(row, 'id'),
        name: text(row, 'baseBuildName'),
        kind: int(row, 'baseBuildType') as BigMapBuildingKind,
        occupyHex: Math.max(1, int(row, 'occupyHex')),
        maxOwnNum: Math.max(1, int(row, 'maxOwnNum')),
        unlockChapter: int(row, 'unlockChapter'),
        queueType: Math.max(1, int(row, 'queueType')),
        sort: int(row, 'sort'),
        info: text(row, 'baseBuildInfo'),
    };
}

function parseBuildingLevels(
    rows: readonly BigMapRow[],
    buildings: ReadonlyMap<number, IBigMapBuildingConfig>,
): ReadonlyMap<number, ReadonlyMap<number, IBigMapBuildingLevelConfig>> {
    const byBuilding = new Map<number, Map<number, IBigMapBuildingLevelConfig>>();
    for (const row of rows) {
        const item: IBigMapBuildingLevelConfig = {
            id: int(row, 'id'),
            level: int(row, 'buildLevel'),
            costGrain: int(row, 'costGrain'),
            costWood: int(row, 'costWood'),
            costIron: int(row, 'costIron'),
            instantCost: int(row, 'instantCost'),
            preBuildId: int(row, 'preBuildId'),
            preBuildLevel: int(row, 'preBuildLevel'),
            buildTime: int(row, 'buildTime'),
            maxOtherLevel: int(row, 'maxOtherLevel'),
            resCap: int(row, 'resCap'),
            attrBonus: int(row, 'attrBonus'),
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

function parseProduce(
    rows: readonly BigMapRow[],
    buildings: ReadonlyMap<number, IBigMapBuildingConfig>,
): ReadonlyMap<number, ReadonlyMap<number, IBigMapProduceConfig>> {
    const byBuilding = new Map<number, Map<number, IBigMapProduceConfig>>();
    for (const row of rows) {
        const item: IBigMapProduceConfig = {
            id: int(row, 'id'),
            level: int(row, 'buildLevel'),
            resType: resType(row),
            producePerHour: num(row, 'producePerHour'),
            produceCap: num(row, 'produceCap'),
        };
        if (!buildings.has(item.id)) throw new Error(`[BigMap] 产出表引用了不存在的建筑 ${item.id}`);
        if (item.produceCap < item.producePerHour) {
            throw new Error(`[BigMap] 建筑 ${item.id} 等级 ${item.level} 的累积上限小于每小时产量`);
        }
        let levels = byBuilding.get(item.id);
        if (!levels) { levels = new Map(); byBuilding.set(item.id, levels); }
        levels.set(item.level, item);
    }
    return byBuilding;
}

function parseResource(row: BigMapRow): IBigMapResConfig {
    return {
        resType: resType(row),
        name: text(row, 'resName'),
        startAmount: Math.max(0, int(row, 'startAmount')),
    };
}

function parseQueue(row: BigMapRow): IBigMapQueueConfig {
    const queue: IBigMapQueueConfig = {
        maxBuildQueue: Math.max(1, int(row, 'maxBuildQueue')),
        initBuildQueue: Math.max(1, int(row, 'initBuildQueue')),
        queueUnlockCost2: Math.max(0, int(row, 'queueUnlockCost2')),
        queueUnlockCost3: Math.max(0, int(row, 'queueUnlockCost3')),
        cancelReturnRate: Math.min(1, Math.max(0, num(row, 'cancelReturnRate'))),
        offlineMaxHours: Math.max(0, int(row, 'offlineMaxHours')),
        upgradeUnlockChapter: Math.max(1, int(row, 'upgradeUnlockChapter')),
        plotRows: Math.max(3, int(row, 'plotRows')),
        plotCols: Math.max(3, int(row, 'plotCols')),
    };
    if (queue.initBuildQueue > queue.maxBuildQueue) throw new Error('[BigMap] 初始队列数大于上限');
    if (queue.plotRows % 2 === 0 || queue.plotCols % 2 === 0) {
        throw new Error('[BigMap] 建造区行列必须是奇数（中心格要放主城）');
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
    const level = cityLevels.get(cityLevel)!;
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

function parseMonster(row: BigMapRow): IBigMapMonsterConfig {
    return {
        id: int(row, 'monsterId'),
        name: text(row, 'monsterName'),
        level: int(row, 'monsterLevel'),
        occupyHex: Math.max(1, int(row, 'occupyHex')),
        preLevel: Math.max(0, int(row, 'preLevel')),
        staminaCost: Math.max(0, int(row, 'staminaCost')),
        warScore: Math.max(0, int(row, 'warScore')),
        defenseHp: Math.max(1, int(row, 'defenseHp')),
        respawnSeconds: Math.max(0, int(row, 'respawnSeconds')),
        rewardGrain: Math.max(0, int(row, 'rewardGrain')),
        rewardWood: Math.max(0, int(row, 'rewardWood')),
        rewardIron: Math.max(0, int(row, 'rewardIron')),
        rewardCoin: Math.max(0, int(row, 'rewardCoin')),
    };
}

function parseStamina(row: BigMapRow): IBigMapStaminaConfig {
    const stamina: IBigMapStaminaConfig = {
        staminaMax: Math.max(1, int(row, 'staminaMax')),
        recoverInterval: Math.max(1, int(row, 'recoverInterval')),
        buyTimesDaily: Math.max(0, int(row, 'buyTimesDaily')),
    };
    return stamina;
}
