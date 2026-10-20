/**
 * 大地图布局的**编辑器侧**校验与几何工具（浏览器 + server.mjs 共用）。
 *
 * ## 与 TS 权威实现的关系
 *
 * 运行时权威是 `assets/script/app/bigmap/model/BigMapLayout.ts` 的 `parseBigMapLayout`。
 * 这里是为浏览器重写的一份：编辑器要即时校验（输一格就报错），不能等发布才炸。
 *
 * 两份实现必须**同口径**，靠 `tests/bigmap-format.test.ts` 对拍（同一批脏样本两边都拒）。
 * 改动任何一边都要跑它 —— 否则就是「编辑器保存成功了，进游戏一片空白」。
 *
 * ## 六边邻居：**别抄 territory-format.js**
 *
 * `territory-format.js` 的 `hexNeighbors` 用的是另一套 offset 约定。大地图必须与客户端
 * `core/hex/HexGridLayout.hexGridNeighborIds` 逐格一致（奇数列偏移 + 偶数列 y 下移半格），
 * 抄错一个 dr 就是「编辑器里相邻、游戏里差两环」这种查半天的偏一格 bug。
 */

import { cellCoords, circleHexes, hexAxialR, hexDistance, hexIdAt, hexNeighbors } from './hex-grid.js';

export const BIGMAP_LAYOUT_KIND = 'bigmapWorld';
export const BIGMAP_LAYOUT_VERSION = 1;
export const BIGMAP_TERRAINS = Object.freeze(['plain', 'forest', 'rock', 'water']);
export const BIGMAP_POINT_TYPES = Object.freeze([1, 2, 3]);

export class BigmapValidationError extends Error {
    constructor(issues) {
        const normalized = Array.isArray(issues) ? issues : [String(issues)];
        super(normalized.join('; '));
        this.name = 'BigmapValidationError';
        this.issues = normalized;
        this.statusCode = 400;
    }
}

// 几何全部来自 hex-grid.js（与客户端 hexGridNeighborIds 逐格一致），这里只做转出。
export { cellCoords, circleHexes, hexDistance, hexIdAt, hexNeighbors };

/**
 * 在给定格子集合里按**最小间距**撒基地点（离散泊松采样的贪心版）。
 *
 * 用途：策划圈完出生区块后，当场知道「这块地按间距 2 格到底能放几个基地」，
 * 而不是等 1000 个玩家进来才发现挤不下或放不满。
 *
 * 说明：
 * - **确定性**：同一份输入必然同一结果（按固定顺序贪心），所以策划可以复现、可以对比改动的效果；
 * - 贪心不是最优解，但三种固定遍历顺序取最多，比单次贪心更接近上限；
 * - `blocked` 里的格子不参与（障碍/城池/野怪已经占了的自己传进来）。
 *
 * @returns {number[]} 选中的格 id（升序）
 */
export function poissonSpawnPoints(cells, minDistance, rows, columns, blocked = []) {
    const banned = new Set(blocked);
    const candidates = [...new Set(cells)].filter((hexId) => !banned.has(hexId));
    if (candidates.length === 0) return [];
    const gap = Math.max(1, Math.floor(Number(minDistance) || 1));
    if (gap <= 1) return candidates.sort((a, b) => a - b);

    const axes = () => {
        const centerX = candidates.reduce((sum, hexId) => sum + (hexId % columns), 0) / candidates.length;
        const centerY = candidates.reduce((sum, hexId) => sum + Math.floor(hexId / columns), 0) / candidates.length;
        return {
            id: (hexId) => hexId,
            row: (hexId) => Math.floor(hexId / columns),
            column: (hexId) => hexId % columns,
            radial: (hexId) => {
                const dc = (hexId % columns) - centerX;
                const dr = Math.floor(hexId / columns) - centerY;
                return dc * dc + dr * dr;
            },
            radialFar: (hexId) => {
                const dc = (hexId % columns) - centerX;
                const dr = Math.floor(hexId / columns) - centerY;
                return -(dc * dc + dr * dr);
            },
        };
    };

    const greedy = (order) => {
        const chosen = [];
        for (const hexId of order) {
            let ok = true;
            for (const taken of chosen) {
                if (hexDistance(hexId, taken, rows, columns) < gap) { ok = false; break; }
            }
            if (ok) chosen.push(hexId);
        }
        return chosen;
    };

    const axesSet = axes();
    // 六边格是 3-可着色的：`(q - r) mod 3` 同色的格子两两不相邻 ⇒ 同色即一个合法独立集，
    // 而独立集上界就是 n/3。所以「按颜色分组」这一种顺序能直接逼近最优；
    // 只按行/列/半径贪心会差很多（实测 91 格半径 5 的圆只有 16 个，按颜色能到 30 个）。
    const color = (hexId) => {
        const row = Math.floor(hexId / columns);
        const column = hexId % columns;
        return (((column - hexAxialR(row, column)) % 3) + 3) % 3;
    };
    const orders = [
        [...candidates].sort((a, b) => color(a) - color(b) || a - b),
        [...candidates].sort((a, b) => a - b),
        [...candidates].sort((a, b) => axesSet.radial(a) - axesSet.radial(b) || a - b),
        [...candidates].sort((a, b) => axesSet.radialFar(a) - axesSet.radialFar(b) || a - b),
        [...candidates].sort((a, b) => axesSet.row(a) - axesSet.row(b) || axesSet.column(a) - axesSet.column(b)),
    ];

    let best = [];
    for (const order of orders) {
        const chosen = greedy(order);
        if (chosen.length > best.length) best = chosen;
    }
    return best.sort((a, b) => a - b);
}

/**
 * 按势力范围的邻接关系推导 `adjacentCityIds`（双向）。
 *
 * 74 座城手填相邻不现实，所以给一条自动推导：两城的 `rangeHex` 存在邻接格 ⇒ 视为相邻。
 * 没有刷范围的城退回「中心距 ≤ 2 环」兜底，避免整张图连不起来。
 */
export function deriveAdjacentCities(cities, rows, columns) {
    const result = new Map();
    const withRangeHex = cities.filter((city) => city.rangeHex.length > 0);
    const byHex = new Map();
    for (const city of withRangeHex) {
        for (const hexId of city.rangeHex) {
            if (!byHex.has(hexId)) byHex.set(hexId, city.cityId);
        }
    }
    for (const city of cities) result.set(city.cityId, new Set());

    for (const city of withRangeHex) {
        for (const hexId of city.rangeHex) {
            for (const neighbor of hexNeighbors(hexId, rows, columns)) {
                const other = byHex.get(neighbor);
                if (other !== undefined && other !== city.cityId) {
                    result.get(city.cityId).add(other);
                    result.get(other).add(city.cityId);
                }
            }
        }
    }

    // 兜底：范围没刷的城（或整片范围互不接触），用中心距 ≤ 2 环补边。
    const untouched = cities.filter((city) => result.get(city.cityId).size === 0);
    if (untouched.length > 0) {
        const centerOf = (city) => cellCoords(city.anchorHexId, columns);
        for (let i = 0; i < cities.length; i += 1) {
            for (let j = i + 1; j < cities.length; j += 1) {
                const a = centerOf(cities[i]);
                const b = centerOf(cities[j]);
                const distance = Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
                if (distance > 3) continue;
                const needA = result.get(cities[i].cityId).size === 0;
                const needB = result.get(cities[j].cityId).size === 0;
                if (!needA && !needB) continue;
                result.get(cities[i].cityId).add(cities[j].cityId);
                result.get(cities[j].cityId).add(cities[i].cityId);
            }
        }
    }

    return new Map([...result.entries()].map(([cityId, set]) => [cityId, [...set].sort((a, b) => a - b)]));
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, label, issues, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isInteger(value) || value < min || value > max) {
        issues.push(`${label} 必须是 [${min}, ${max}] 内的整数，收到 ${JSON.stringify(value)}`);
    }
    return value;
}

function hexId(value, label, issues, total) {
    integer(value, label, issues, { min: 0, max: total - 1 });
    return value;
}

function hexIdList(value, label, issues, total, { required = false, unique = true } = {}) {
    if (value === undefined || value === null) {
        if (required) issues.push(`${label} 不能为空`);
        return [];
    }
    if (!Array.isArray(value)) {
        issues.push(`${label} 必须是数组`);
        return [];
    }
    if (required && value.length === 0) issues.push(`${label} 不能为空`);
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
        const id = hexId(value[index], `${label}[${index}]`, issues, total);
        if (unique && out.indexOf(id) >= 0) {
            issues.push(`${label} 内有重复格子 ${id}`);
            continue;
        }
        out.push(id);
    }
    return out;
}

/**
 * 归一化 + 校验。全部规则一次判完，`issues` 非空就抛 `BigmapValidationError`。
 *
 * 返回的 `layout` 字段**顺序固定**（序列化可逐字节比对），未知字段一律丢弃。
 */
export function normalizeBigmapLayout(data) {
    const issues = [];
    const warnings = [];
    if (!isRecord(data)) throw new BigmapValidationError('布局顶层必须是对象');

    if (data.kind !== BIGMAP_LAYOUT_KIND) issues.push(`kind 必须是 "${BIGMAP_LAYOUT_KIND}"，收到 ${JSON.stringify(data.kind)}`);
    if (data.version !== BIGMAP_LAYOUT_VERSION) issues.push(`version 必须是 ${BIGMAP_LAYOUT_VERSION}，收到 ${JSON.stringify(data.version)}`);

    const rows = integer(data.rows, 'rows', issues, { min: 1, max: 200 });
    const columns = integer(data.columns, 'columns', issues, { min: 1, max: 200 });
    if (issues.length > 0) throw new BigmapValidationError(issues);
    const total = rows * columns;

    const terrainOverrides = [];
    if (data.terrainOverrides !== undefined && !Array.isArray(data.terrainOverrides)) issues.push('terrainOverrides 必须是数组');
    for (const [index, item] of (data.terrainOverrides ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`terrainOverrides[${index}] 必须是对象`); continue; }
        const terrain = item.terrain;
        if (BIGMAP_TERRAINS.indexOf(terrain) < 0) issues.push(`terrainOverrides[${index}].terrain=${JSON.stringify(terrain)} 不是合法地形`);
        terrainOverrides.push({ hexId: hexId(item.hexId, `terrainOverrides[${index}].hexId`, issues, total), terrain });
    }

    const cities = [];
    const cityIds = new Set();
    for (const [index, item] of (data.cities ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`cities[${index}] 必须是对象`); continue; }
        const cityId = integer(item.cityId, `cities[${index}].cityId`, issues);
        if (cityIds.has(cityId)) issues.push(`城池 ${cityId} 重复`);
        cityIds.add(cityId);
        const hexIds = hexIdList(item.hexIds, `cities[${index}].hexIds`, issues, total, { required: true });
        const anchorHexId = hexId(item.anchorHexId, `cities[${index}].anchorHexId`, issues, total);
        if (hexIds.length > 0 && hexIds.indexOf(anchorHexId) < 0) issues.push(`城池 ${cityId} 的锚点 ${anchorHexId} 不在自己的 hexIds 里`);
        cities.push({
            cityId,
            anchorHexId,
            hexIds,
            ring: integer(item.ring ?? 0, `cities[${index}].ring`, issues),
            rangeHex: hexIdList(item.rangeHex, `cities[${index}].rangeHex`, issues, total),
            // 去重 + 升序：与 TS 侧 `readIntSet` 同口径，`tests/bigmap-format.test.ts` 整对象对拍。
            adjacentCityIds: [...new Set((item.adjacentCityIds ?? []).filter((value) => Number.isInteger(value)))]
                .sort((a, b) => a - b),
            label: typeof item.label === 'string' ? item.label : String(cityId),
        });
    }

    const monsters = [];
    const instanceIds = new Set();
    for (const [index, item] of (data.monsters ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`monsters[${index}] 必须是对象`); continue; }
        const instanceId = integer(item.instanceId, `monsters[${index}].instanceId`, issues, { min: 1 });
        if (instanceIds.has(instanceId)) issues.push(`野怪实例 ${instanceId} 重复`);
        instanceIds.add(instanceId);
        const hexIds = hexIdList(item.hexIds, `monsters[${index}].hexIds`, issues, total, { required: true });
        const anchorHexId = hexId(item.anchorHexId, `monsters[${index}].anchorHexId`, issues, total);
        if (hexIds.length > 0 && hexIds.indexOf(anchorHexId) < 0) issues.push(`野怪 ${instanceId} 的锚点 ${anchorHexId} 不在自己的 hexIds 里`);
        monsters.push({
            instanceId,
            monsterId: integer(item.monsterId, `monsters[${index}].monsterId`, issues, { min: 1 }),
            level: integer(item.level, `monsters[${index}].level`, issues, { min: 1 }),
            anchorHexId,
            hexIds,
        });
    }

    const bases = [];
    const baseIds = new Set();
    for (const [index, item] of (data.bases ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`bases[${index}] 必须是对象`); continue; }
        const baseId = String(item.baseId ?? '');
        if (!baseId) issues.push(`bases[${index}].baseId 不能为空`);
        if (baseIds.has(baseId)) issues.push(`基地 ${baseId} 重复`);
        baseIds.add(baseId);
        bases.push({
            baseId,
            name: typeof item.name === 'string' ? item.name : baseId,
            isPlayer: item.isPlayer === true,
            hexId: hexId(item.hexId, `bases[${index}].hexId`, issues, total),
            ring: integer(item.ring ?? 0, `bases[${index}].ring`, issues),
            power: integer(item.power ?? 0, `bases[${index}].power`, issues),
        });
    }
    if (bases.filter((base) => base.isPlayer).length > 1) issues.push('玩家基地最多 1 个');

    const blocked = hexIdList(data.blocked, 'blocked', issues, total);

    const spawnZones = [];
    const zoneIds = new Set();
    for (const [index, item] of (data.spawnZones ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`spawnZones[${index}] 必须是对象`); continue; }
        const zoneId = integer(item.zoneId, `spawnZones[${index}].zoneId`, issues, { min: 1 });
        if (zoneIds.has(zoneId)) issues.push(`出生区块 ${zoneId} 重复`);
        zoneIds.add(zoneId);
        const cells = hexIdList(item.cells, `spawnZones[${index}].cells`, issues, total, { required: true });
        const capacity = integer(item.capacity ?? 0, `spawnZones[${index}].capacity`, issues);
        if (cells.length > 0 && capacity > Math.floor(cells.length / 4)) {
            warnings.push(`出生区块 ${zoneId} 容量 ${capacity} 偏大：cells ${cells.length} 格按最小间距只能放约 ${Math.floor(cells.length / 4)} 个基地`);
        }
        spawnZones.push({ zoneId, cityId: integer(item.cityId ?? 0, `spawnZones[${index}].cityId`, issues), cells, capacity });
    }

    const points = [];
    const pointIds = new Set();
    for (const [index, item] of (data.points ?? []).entries()) {
        if (!isRecord(item)) { issues.push(`points[${index}] 必须是对象`); continue; }
        const pointId = integer(item.pointId, `points[${index}].pointId`, issues, { min: 1 });
        if (pointIds.has(pointId)) issues.push(`据点 ${pointId} 重复`);
        pointIds.add(pointId);
        const pointType = integer(item.pointType, `points[${index}].pointType`, issues, { min: 1, max: 3 });
        points.push({
            pointId,
            pointType,
            hexIds: hexIdList(item.hexIds, `points[${index}].hexIds`, issues, total, { required: true }),
            openCron: typeof item.openCron === 'string' ? item.openCron : '',
        });
    }

    // 占位互斥（含障碍）：不互斥的话游戏里一格会同时是城又是怪。
    const occupied = new Map();
    const claim = (id, tag) => {
        const previous = occupied.get(id);
        if (previous !== undefined) issues.push(`格 ${id} 被 ${previous} 和 ${tag} 同时占用`);
        else occupied.set(id, tag);
    };
    for (const id of blocked) claim(id, '障碍');
    for (const city of cities) for (const id of city.hexIds) claim(id, `城池${city.cityId}`);
    for (const monster of monsters) for (const id of monster.hexIds) claim(id, `野怪${monster.instanceId}`);
    for (const base of bases) claim(base.hexId, `基地${base.baseId}`);
    for (const point of points) for (const id of point.hexIds) claim(id, `据点${point.pointId}`);

    // 相邻关系只提示不阻断：编辑器允许先单边标着，发布前再补。
    const cityIdSet = new Set(cities.map((city) => city.cityId));
    for (const city of cities) {
        for (const other of city.adjacentCityIds) {
            if (!cityIdSet.has(other)) {
                warnings.push(`城池 ${city.cityId} 的相邻城池 ${other} 不在本图里`);
                continue;
            }
            const back = cities.find((item) => item.cityId === other);
            if (back && back.adjacentCityIds.indexOf(city.cityId) < 0) {
                warnings.push(`相邻关系单向：${city.cityId} → ${other}，反向缺失`);
            }
        }
    }

    if (issues.length > 0) throw new BigmapValidationError(issues);

    return {
        layout: {
            kind: BIGMAP_LAYOUT_KIND,
            version: BIGMAP_LAYOUT_VERSION,
            layoutVersion: integer(data.layoutVersion ?? BIGMAP_LAYOUT_VERSION, 'layoutVersion', issues, { min: 1 }),
            worldId: integer(data.worldId, 'worldId', issues),
            worldName: typeof data.worldName === 'string' ? data.worldName : '',
            rows,
            columns,
            terrainSeed: integer(data.terrainSeed, 'terrainSeed', issues),
            terrainOverrides,
            cities,
            monsters,
            bases,
            blocked,
            spawnZones,
            points,
            background: typeof data.background === 'string' ? data.background : '',
        },
        warnings,
    };
}

/** 一张空白布局（编辑器「新建」用）：只有尺寸与种子，不预置任何占位。 */
export function emptyBigmapLayout({ rows, columns, worldId = 1, worldName = '大地图', terrainSeed = 20261020 }) {
    return {
        kind: BIGMAP_LAYOUT_KIND,
        version: BIGMAP_LAYOUT_VERSION,
        layoutVersion: 1,
        worldId,
        worldName,
        rows,
        columns,
        terrainSeed,
        terrainOverrides: [],
        cities: [],
        monsters: [],
        bases: [],
        blocked: [],
        spawnZones: [],
        points: [],
        background: '',
    };
}
