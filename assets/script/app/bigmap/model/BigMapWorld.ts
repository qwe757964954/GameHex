/**
 * 大世界地图生成 —— **确定性种子生成，纯 TS，零 `cc` 依赖**。
 *
 * 为什么不用 `Math.random()`：同一份配置 + 同一个种子必须永远生成同一张地图。
 * 否则「基地摆在哪个格子」「哪座城在哪个环」每帧/每次进页面都变，存档一写就废。
 * 口径与领地章节的「喷发扇形抖动」一致：`seed + 坐标` 哈希 → [0,1)，**不是引擎随机数**。
 *
 * 坐标系：沿用领地/对局的**奇数列偏移**六边格（`hexGridNeighborIds` 那一套）。
 * 换算成 axial 后 `q = column`、`r = row - (column - (column & 1)) / 2`，
 * 于是「环」（hex 距离）有闭式解，不用每帧跑 BFS。
 */
import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';
import {
    BigMapCityLayer,
    type BigMapTerrain,
    type IBigMapBaseSite,
    type IBigMapCityConfig,
    type IBigMapCitySite,
    type IBigMapConfig,
    type IBigMapMonsterConfig,
    type IBigMapMonsterSite,
    type IBigMapWorldConfig,
    type IBigMapWorldTile,
    type IBigMapWorld,
} from './BigMapTypes';

/** 默认世界种子。改它等于换一张新地图 —— 存档里的格子 id 会整体错位，仅调参时用。 */
export const DEFAULT_BIGMAP_WORLD_SEED = 20261017;

/** 32 位整数哈希（MurmurHash3 的收尾混合，够散且无分配）。 */
export function bigMapHash(seed: number, a = 0, b = 0, c = 0): number {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (a | 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h ^ (b | 0), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    h = Math.imul(h ^ (c | 0), 0x27d4eb2f) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h;
}

/** 稳定伪随机 `[0, 1)`；同参数恒等。 */
export function bigMapRandom(seed: number, a = 0, b = 0, c = 0): number {
    return bigMapHash(seed, a, b, c) / 4294967296;
}

/**
 * 奇数列偏移 → axial 的 `r`。
 *
 * ⚠️ 这里的 `+ (column & 1)` 不能写成 `- (column & 1)`：偶数**列整体下移半格**（`hexGridViewPoint`
 * 的相位是 `column % 2 === 0 ? -phase : +phase`），对角邻居在「下一行」而不是上一行。
 * 写成减号时 6 个邻居里会有一个算成 2 环 —— `bigMapHexDistance` 的相邻性测试就是拦这个的。
 */
function axialR(row: number, column: number): number {
    return row - (column + (column & 1)) / 2;
}

/** 两格之间的六边距离（环数）。越界返回 `Number.POSITIVE_INFINITY`。 */
export function bigMapHexDistance(
    rows: number,
    cols: number,
    fromHexId: number,
    toHexId: number,
): number {
    const total = rows * cols;
    if (fromHexId < 0 || fromHexId >= total || toHexId < 0 || toHexId >= total) {
        return Number.POSITIVE_INFINITY;
    }
    const fromRow = Math.floor(fromHexId / cols);
    const fromCol = fromHexId % cols;
    const toRow = Math.floor(toHexId / cols);
    const toCol = toHexId % cols;
    const dq = toCol - fromCol;
    const dr = axialR(toRow, toCol) - axialR(fromRow, fromCol);
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** 每层城池所在的环半径：个人层 / 军团层来自配置，战盟层与王座按比例内推。 */
export function bigMapCityRing(world: IBigMapWorldConfig, layer: BigMapCityLayer): number {
    switch (layer) {
        case BigMapCityLayer.Legion: return world.cityRing2;
        case BigMapCityLayer.WarAlliance: return Math.max(3, Math.round(world.cityRing2 / 2));
        case BigMapCityLayer.Throne: return 0;
        default: return world.cityRing1;
    }
}

/** 地形权重：靠近中心的出生区保持可走，外围才长石头和水。 */
function terrainAt(seed: number, hexId: number, ring: number): BigMapTerrain {
    const roll = bigMapRandom(seed, hexId, 7);
    if (ring <= 2) return 'plain';
    if (ring <= 6) return roll < 0.72 ? 'plain' : roll < 0.9 ? 'forest' : 'rock';
    return roll < 0.5 ? 'plain' : roll < 0.72 ? 'forest' : roll < 0.9 ? 'rock' : 'water';
}

/** 把一个锚点扩成 `size` 格的连通块（BFS，只吃空格）。返回实际占到的格 + 剩余缺口。 */
function claimFootprint(
    anchorHexId: number,
    size: number,
    rows: number,
    cols: number,
    taken: Set<number>,
    canClaim?: (hexId: number) => boolean,
): number[] {
    const claimed: number[] = [];
    const queue: number[] = [anchorHexId];
    while (queue.length > 0 && claimed.length < size) {
        const hexId = queue.shift();
        if (taken.has(hexId) || (canClaim && !canClaim(hexId))) continue;
        taken.add(hexId);
        claimed.push(hexId);
        for (const neighbor of hexGridNeighborIds(hexId, rows, cols)) {
            if (!taken.has(neighbor)) queue.push(neighbor);
        }
    }
    return claimed;
}

interface IPlacementContext {
    readonly rows: number;
    readonly cols: number;
    readonly taken: Set<number>;
    readonly ringOf: (hexId: number) => number;
}

/** 在指定环上按槽位均匀取点：`slot / slotCount` 是**环上弧长比例**，不吃随机，天然不重叠。 */
function pickRingAnchor(context: IPlacementContext, ring: number, slot: number, slotCount: number): number {
    const circle: number[] = [];
    const total = context.rows * context.cols;
    for (let hexId = 0; hexId < total; hexId += 1) {
        if (context.ringOf(hexId) === ring && !context.taken.has(hexId)) circle.push(hexId);
    }
    if (circle.length === 0) return -1;
    // 按极角排序，保证槽位 0..n-1 是「绕圈均匀分布」而不是「按 id 排的锯齿」。
    const centerRow = (context.rows - 1) / 2;
    const centerCol = (context.cols - 1) / 2;
    const angleOf = (hexId: number): number => {
        const row = Math.floor(hexId / context.cols);
        const col = hexId % context.cols;
        // axial → 近似笛卡尔，只为排序稳定；比例不影响环上顺序。
        return Math.atan2((row - centerRow) + (col - centerCol) * 0.5, (col - centerCol) * 1.5);
    };
    circle.sort((a, b) => angleOf(a) - angleOf(b) || a - b);
    const index = Math.floor((slot * circle.length) / Math.max(1, slotCount));
    return circle[Math.min(circle.length - 1, Math.max(0, index))];
}

function placeCities(
    config: IBigMapConfig,
    context: IPlacementContext,
    seed: number,
): { sites: Map<number, IBigMapCitySite>; byHex: Map<number, number> } {
    const sites = new Map<number, IBigMapCitySite>();
    const byHex = new Map<number, number>();
    const cities = [...config.cities.values()].sort((a, b) => a.layer - b.layer || a.cityId - b.cityId);
    for (const city of cities) {
        const ring = bigMapCityRing(config.world, city.layer as BigMapCityLayer);
        let anchor = pickRingAnchor(context, ring, city.slot, city.slotCount);
        if (anchor < 0) {
            // 环上被野怪/基地占满了：退一环再找，绝不放弃放置（否则城池在界面上凭空消失）。
            for (let fallback = ring + 1; fallback <= ring + 3 && anchor < 0; fallback += 1) {
                anchor = pickRingAnchor(context, fallback, city.slot, city.slotCount);
            }
        }
        if (anchor < 0) continue;
        const footprint = config.camps.get(city.cityId)?.campSize ?? cityFootprint(city);
        const hexIds = claimFootprint(anchor, footprint, context.rows, context.cols, context.taken);
        const site: IBigMapCitySite = {
            cityId: city.cityId,
            anchorHexId: hexIds[0],
            hexIds,
            ring,
        };
        sites.set(city.cityId, site);
        for (const hexId of hexIds) byHex.set(hexId, city.cityId);
        void seed;
    }
    return { sites, byHex };
}

/** 复用原有环位/BFS 占格算法，为布局缺少的城池补位；已有实体作为保留格。 */
export function placeBigMapCities(config: IBigMapConfig, seed: number, reserved: ReadonlySet<number>): Map<number, IBigMapCitySite> {
    const rows = config.world.rows;
    const cols = config.world.cols;
    const center = Math.floor((rows - 1) / 2) * cols + Math.floor((cols - 1) / 2);
    return placeCities(config, { rows, cols, taken: new Set(reserved),
        ringOf: (id) => bigMapHexDistance(rows, cols, center, id) }, seed).sites;
}

/** 历史离线城池的占格；新版取 `bigMapCamp.campSize`，布局模式仍保持原占格。 */
function cityFootprint(city: IBigMapCityConfig): number {
    return city.layer === BigMapCityLayer.Throne ? 6 : 4;
}

function placeMonsters(
    config: IBigMapConfig,
    context: IPlacementContext,
    seed: number,
): { sites: IBigMapMonsterSite[]; byHex: Map<number, number> } {
    const sites: IBigMapMonsterSite[] = [];
    const byHex = new Map<number, number>();
    const monsters = [...config.monsters.values()].sort((a, b) => a.level - b.level || a.id - b.id);
    // 低级怪靠近出生区，高级怪向外推：迭代顺序本身已按等级升序，环带用等级做下限。
    for (const monster of monsters) {
        const anchor = pickMonsterAnchor(monster, config, context, seed, sites.length);
        if (anchor < 0) continue;
        const hexIds = claimFootprint(anchor, Math.max(1, monster.occupyHex), context.rows, context.cols, context.taken,
            (hexId) => context.ringOf(hexId) <= config.world.monsterRingMax);
        const site: IBigMapMonsterSite = {
            instanceId: sites.length + 1,
            monsterId: monster.id,
            level: monster.level,
            anchorHexId: hexIds[0],
            hexIds,
        };
        sites.push(site);
        for (const hexId of hexIds) byHex.set(hexId, site.instanceId);
    }
    return { sites, byHex };
}

function pickMonsterAnchor(
    monster: IBigMapMonsterConfig,
    config: IBigMapConfig,
    context: IPlacementContext,
    seed: number,
    ordinal: number,
): number {
    const ringMin = Math.min(config.world.monsterRingMax, 3 + monster.level);
    const ringMax = Math.min(config.world.monsterRingMax, ringMin + 2);
    const candidates: number[] = [];
    const total = context.rows * context.cols;
    for (let hexId = 0; hexId < total; hexId += 1) {
        if (context.taken.has(hexId)) continue;
        const ring = context.ringOf(hexId);
        if (ring >= ringMin && ring <= ringMax) candidates.push(hexId);
    }
    if (candidates.length === 0) return -1;
    // 从种子决定的起点开始转一圈找空位：同参数恒等，且不会全挤在一处。
    const start = bigMapHash(seed, monster.id, ordinal, 31) % candidates.length;
    for (let step = 0; step < candidates.length; step += 1) {
        const hexId = candidates[(start + step) % candidates.length];
        const free = hexGridNeighborIds(hexId, context.rows, context.cols)
            .filter((neighbor) => !context.taken.has(neighbor) && context.ringOf(neighbor) <= config.world.monsterRingMax).length;
        if (free >= monster.occupyHex - 1) return hexId;
    }
    return -1;
}

function placeBases(
    config: IBigMapConfig,
    context: IPlacementContext,
    seed: number,
): IBigMapBaseSite[] {
    const world = config.world;
    const band: number[] = [];
    const total = context.rows * context.cols;
    for (let hexId = 0; hexId < total; hexId += 1) {
        if (context.taken.has(hexId)) continue;
        const ring = context.ringOf(hexId);
        if (ring >= world.baseRadiusMin && ring <= world.baseRadiusMax) band.push(hexId);
    }
    // 按环号升序，让「出生基地」落在环带内侧（离中心近，玩家一眼能看到自己的家）。
    band.sort((a, b) => context.ringOf(a) - context.ringOf(b) || a - b);

    const sites: IBigMapBaseSite[] = [];
    const playerStart = bigMapHash(seed, 9001, 0, 17) % Math.max(1, band.length);
    const playerHex = band[playerStart % band.length];
    if (playerHex === undefined) return sites;
    context.taken.add(playerHex);
    const player: IBigMapBaseSite = {
        baseId: 'player',
        name: '我的基地',
        isPlayer: true,
        hexId: playerHex,
        ring: context.ringOf(playerHex),
        power: 0,
    };
    sites.push(player);

    const total2 = world.npcBaseCount;
    // 基地之间至少隔 3 环宽的距离：线框图上每个基地都带名字，挤在一起会糊成一团。
    const MIN_BASE_GAP = 3;
    for (let index = 0; index < total2; index += 1) {
        const offset = bigMapHash(seed, 9100, index, 23) % Math.max(1, band.length);
        let chosen = -1;
        for (let step = 0; step < band.length; step += 1) {
            const hexId = band[(offset + step) % band.length];
            if (context.taken.has(hexId)) continue;
            if (sites.some((site) => bigMapHexDistance(context.rows, context.cols, site.hexId, hexId) < MIN_BASE_GAP)) {
                continue;
            }
            chosen = hexId;
            break;
        }
        if (chosen < 0) break;
        context.taken.add(chosen);
        sites.push({
            baseId: `npc-${String(index + 1).padStart(2, '0')}`,
            name: npcBaseName(index),
            isPlayer: false,
            hexId: chosen,
            ring: context.ringOf(chosen),
            power: 600 + index * 180,
        });
    }
    return sites;
}

const NPC_BASE_NAMES = [
    '藤蔓占星师', '苔藓骑士', '双头向日葵', '铁壳蜗牛', '酸浆射手', '孢子祭司',
    '枯枝游侠', '泥沼守卫', '夜灯萤群', '刺藤斗士', '露水侍女', '朽木君王',
    '落果学徒', '腐叶猎手', '霜叶哨兵', '光合教徒',
];

function npcBaseName(index: number): string {
    return NPC_BASE_NAMES[index % NPC_BASE_NAMES.length];
}

/** 地形覆盖表：`hexId → terrain`。策划在编辑器里手改过的格子走这里，其余仍由种子决定。 */
export type BigMapTerrainOverride = ReadonlyMap<number, BigMapTerrain>;

/** 格子层的构建产物（世界生成与布局重建共用）。 */
export interface IBigMapTileLayer {
    readonly tiles: readonly IBigMapWorldTile[];
    readonly tileById: Map<number, IBigMapWorldTile>;
    readonly ringCounts: number[];
    readonly centerHexId: number;
}

/**
 * 只造格子层（地形 + 环号）。
 *
 * 抽出来的唯一理由：世界有**两条**构建入口（种子生成 / 布局文件），地形算法只能有一份。
 * 两处各写一遍，改一处忘一处就是「编辑器里是水、游戏里是平地」这种查半天的漂移。
 */
export function buildBigMapTiles(
    rows: number,
    cols: number,
    seed: number,
    overrides?: BigMapTerrainOverride,
): IBigMapTileLayer {
    const centerRow = Math.floor((rows - 1) / 2);
    const centerCol = Math.floor((cols - 1) / 2);
    const centerHexId = centerRow * cols + centerCol;

    const tiles: IBigMapWorldTile[] = [];
    const tileById = new Map<number, IBigMapWorldTile>();
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const id = row * cols + col;
            const ring = bigMapHexDistance(rows, cols, centerHexId, id);
            const terrain = overrides?.get(id) ?? terrainAt(seed, id, ring);
            const tile: IBigMapWorldTile = { id, row, column: col, ring, terrain };
            tiles.push(tile);
            tileById.set(id, tile);
        }
    }

    const ringCounts: number[] = [];
    for (const tile of tiles) {
        ringCounts[tile.ring] = (ringCounts[tile.ring] ?? 0) + 1;
    }
    return { tiles, tileById, ringCounts, centerHexId };
}

/**
 * 生成整张大地图。**纯函数**：同一 `config + seed` 必得同一结果，可在测试里反复断言。
 *
 * 这是「没有布局文件时」的兜底路径：离线调试档、单测夹具、以及 M1 之前的老存档都走它。
 * 有布局文件时请用 `BigMapLayout.buildBigMapWorldFromLayout`。
 */
export function buildBigMapWorld(config: IBigMapConfig, seed = DEFAULT_BIGMAP_WORLD_SEED): IBigMapWorld {
    const world = config.world;
    const rows = world.rows;
    const cols = world.cols;
    const centerHexId = Math.floor((rows - 1) / 2) * cols + Math.floor((cols - 1) / 2);
    const { tiles, tileById, ringCounts } = buildBigMapTiles(rows, cols, seed);
    const ringOf = (hexId: number): number => tileById.get(hexId)?.ring ?? Number.POSITIVE_INFINITY;
    const taken = new Set<number>();
    const context: IPlacementContext = { rows, cols, taken, ringOf };

    // 顺序很重要：城 → 野怪 → 基地。城最稀缺（要占环），基地最灵活（环带内任意空位）。
    const cityPlacement = placeCities(config, context, seed);
    const monsterPlacement = placeMonsters(config, context, seed);
    const bases = placeBases(config, context, seed);
    const playerBase = bases.find((site) => site.isPlayer);

    return {
        worldId: world.worldId,
        worldName: world.worldName,
        rows,
        cols,
        seed,
        centerHexId,
        tiles,
        tileById,
        ringCounts,
        cities: cityPlacement.sites,
        cityByHex: cityPlacement.byHex,
        monsters: monsterPlacement.sites,
        monsterByHex: monsterPlacement.byHex,
        bases,
        playerBase: playerBase ?? {
            baseId: 'player', name: '我的基地', isPlayer: true,
            hexId: centerHexId, ring: 0, power: 0,
        },
        baseByHex: new Map(bases.map((site) => [site.hexId, site] as const)),
    };
}

/** 格上有什么（建造/攻打/渲染拾取共用）。 */
export function bigMapOccupantOf(world: IBigMapWorld, hexId: number, playerBaseHexId?: number):
    | { readonly kind: 'city'; readonly cityId: number }
    | { readonly kind: 'monster'; readonly instanceId: number }
    | { readonly kind: 'base'; readonly base: IBigMapBaseSite }
    | { readonly kind: 'empty' } {
    // 玩家基地钉在服务器 `toCampId` 那座城的锚点上，会与城占格重叠 —— 这一格必须先按「基地」响应，
    // 否则城占格优先，「点自己的基地回基地」永远走不到。缺省仍取布局档的玩家基地格（离线档行为不变）。
    const baseHexId = playerBaseHexId ?? world.playerBase.hexId;
    if (hexId === baseHexId) return { kind: 'base', base: world.baseByHex.get(hexId) ?? world.playerBase };
    const cityId = world.cityByHex.get(hexId);
    if (cityId !== undefined) return { kind: 'city', cityId };
    const instanceId = world.monsterByHex.get(hexId);
    if (instanceId !== undefined) return { kind: 'monster', instanceId };
    const base = world.baseByHex.get(hexId);
    if (base) return { kind: 'base', base };
    return { kind: 'empty' };
}
