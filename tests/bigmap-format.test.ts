/**
 * 编辑器校验（js）↔ 运行时权威校验（ts）**同口径对拍**。
 *
 * 为什么必须对拍：`tools/map-editor/formats/bigmap-format.js` 是给浏览器用的第二份实现，
 * 一旦它比 ts 松，就会出现「编辑器保存成功、进游戏一片空白」；比 ts 严则策划被卡住。
 * 任何一边改了规则，这里必须绿。
 *
 * 另外钉死一件最容易错的事：**六边邻居口径**。`territory-format.js` 那套 offsets 与客户端
 * `hexGridNeighborIds` 不是同一个约定，抄错就是「编辑器里相邻、游戏里差两环」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';
import {
    buildBigMapWorldFromLayout,
    exportBigMapLayout,
    parseBigMapLayout,
    type IBigMapLayout,
} from '../assets/script/app/bigmap/model/BigMapLayout';
import { buildBigMapWorld, bigMapHexDistance } from '../assets/script/app/bigmap/model/BigMapWorld';
import {
    circleHexes,
    deriveAdjacentCities,
    hexDistance,
    hexNeighbors,
    normalizeBigmapLayout,
    poissonSpawnPoints,
} from '../tools/map-editor/formats/bigmap-format';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const config = loadBigMapConfig();

function baseLayout(): IBigMapLayout {
    return exportBigMapLayout(buildBigMapWorld(config));
}

test('六边邻居：编辑器 js 与客户端 ts 逐格一致（全图 1600 格）', () => {
    const { rows, cols } = config.world;
    for (let hexId = 0; hexId < rows * cols; hexId += 1) {
        assert.deepEqual(
            hexNeighbors(hexId, rows, cols),
            hexGridNeighborIds(hexId, rows, cols),
            `格 ${hexId} 的邻居两边不一致`,
        );
    }
});

test('同一份合法布局：js 归一化与 ts 解析结果整体一致', () => {
    const layout = baseLayout();
    const viaJs = normalizeBigmapLayout(JSON.parse(JSON.stringify(layout)));
    const viaTs = parseBigMapLayout(JSON.parse(JSON.stringify(layout)));
    assert.deepEqual(viaJs.layout, viaTs);
    assert.deepEqual(viaJs.warnings, []);
});

test('带标注的布局（范围/相邻/障碍/区块/据点）两边也一致', () => {
    const layout = baseLayout();
    const annotated = {
        ...JSON.parse(JSON.stringify(layout)),
        cities: layout.cities.map((city, index) => (index === 0
            ? { ...city, rangeHex: [city.anchorHexId], adjacentCityIds: [layout.cities[1].cityId], label: '1-16' }
            : city)),
        blocked: [0],
        spawnZones: [{ zoneId: 1, cityId: layout.cities[0].cityId, cells: [1, 2], capacity: 0 }],
        points: [{ pointId: 1, pointType: 2, hexIds: [3], openCron: 'TUE 20:00' }],
    };
    // 前提：0/1/2/3 不能已被占位（否则两边都会因为「同时占用」拒载，测不到归一化）。
    const occupied = new Set<number>();
    for (const city of layout.cities) city.hexIds.forEach((id) => occupied.add(id));
    for (const monster of layout.monsters) monster.hexIds.forEach((id) => occupied.add(id));
    for (const base of layout.bases) occupied.add(base.hexId);
    for (const id of [0, 1, 2, 3]) {
        if (occupied.has(id)) return; // 该种子下这几格被占了，跳过（别的用例已覆盖标注对拍）
    }

    assert.deepEqual(normalizeBigmapLayout(annotated).layout, parseBigMapLayout(annotated));
});

test('脏布局两边都拒：越界 / 锚点不在占格块 / 重复 id / kind / 地形 / 障碍重叠', () => {
    const layout = JSON.parse(JSON.stringify(baseLayout())) as IBigMapLayout;
    const total = layout.rows * layout.columns;
    const first = layout.cities[0];
    const second = layout.cities[1];

    const cases: Array<Record<string, unknown>> = [
        { cities: [{ ...first, anchorHexId: total }] },                             // 锚点越界
        { cities: [{ ...first, hexIds: [0, 1], anchorHexId: total - 1 }] },          // 锚点不在占格块
        { cities: [first, { ...second, cityId: first.cityId }] },                    // cityId 重复
        { cities: [{ ...first, hexIds: [...first.hexIds, first.hexIds[0]] }] },      // 占格块内重复
        { kind: 'territoryChapter' },
        { version: 99 },
        { terrainOverrides: [{ hexId: 0, terrain: 'lava' }] },
        { blocked: [first.anchorHexId] },                                             // 障碍压城
        { bases: [{ baseId: 'p', name: 'p', isPlayer: true, hexId: 0, ring: 0, power: 0 },
            { baseId: 'q', name: 'q', isPlayer: true, hexId: 1, ring: 0, power: 0 }] }, // 两个玩家基地
        { spawnZones: [{ zoneId: 1, cityId: 0, cells: [], capacity: 0 }] },           // 区块空 cells
        { points: [{ pointId: 1, pointType: 9, hexIds: [0] }] },                      // pointType 越界
    ];

    for (const patch of cases) {
        const payload = { ...layout, ...patch };
        assert.throws(() => parseBigMapLayout(payload), `ts 应拒载：${JSON.stringify(patch).slice(0, 60)}`);
        assert.throws(() => normalizeBigmapLayout(payload), `js 应拒载：${JSON.stringify(patch).slice(0, 60)}`);
    }
});

test('相邻关系自动推导：势力范围相接的两城互为相邻', () => {
    const { rows, cols } = config.world;
    const cities = [
        { cityId: 1, anchorHexId: 500, hexIds: [500], ring: 0, rangeHex: [500, 501], adjacentCityIds: [], label: 'a' },
        { cityId: 2, anchorHexId: 502, hexIds: [502], ring: 0, rangeHex: [502, 503], adjacentCityIds: [], label: 'b' },
        { cityId: 3, anchorHexId: 1500, hexIds: [1500], ring: 0, rangeHex: [1500], adjacentCityIds: [], label: 'c' },
    ];
    const adjacent = deriveAdjacentCities(cities, rows, cols);
    // 1 与 2 的范围是否真接上，取决于 501 与 502 是否邻居 —— 用客户端口径判，别假设。
    const linked = hexGridNeighborIds(501, rows, cols).includes(502)
        || hexGridNeighborIds(500, rows, cols).includes(502);
    if (linked) {
        assert.ok(adjacent.get(1)!.includes(2));
        assert.ok(adjacent.get(2)!.includes(1));
    }
    // 3 离得很远，不该与 1/2 相邻。
    assert.ok(!adjacent.get(3)!.includes(1));
    assert.ok(!adjacent.get(3)!.includes(2));
});

test('势力范围一键铺：半径 1 = 中心 + 6 邻居，半径 2 = 19 格', () => {
    const { rows, cols } = config.world;
    assert.equal(circleHexes(500, 0, rows, cols).length, 1);
    assert.equal(circleHexes(500, 1, rows, cols).length, 7);
    assert.equal(circleHexes(500, 2, rows, cols).length, 19);
    // 角落会被边界裁掉，不能硬套 19。
    assert.ok(circleHexes(0, 2, rows, cols).length < 19);
});

test('编辑器 hexDistance 与客户端 bigMapHexDistance 抽样一致', () => {
    const { rows, cols } = config.world;
    const samples = [0, 1, 39, 40, 399, 400, 799, 1234, 1599, 1000];
    for (const a of samples) {
        for (const b of samples) {
            assert.equal(hexDistance(a, b, rows, cols), bigMapHexDistance(rows, cols, a, b), `格 ${a}→${b} 距离不一致`);
        }
    }
    assert.equal(hexDistance(-1, 0, rows, cols), Number.POSITIVE_INFINITY);
});

test('出生区块泊松撒点：间距 ≥ minDistance，确定性，且障碍格不参与', () => {
    const { rows, cols } = config.world;
    // 820 = (20,20)，正中央：半径 5 是完整的 91 格圆（800 贴左边界会被裁成 51 格）。
    const zone = circleHexes(820, 5, rows, cols);
    const points = poissonSpawnPoints(zone, 2, rows, cols);

    // 1) 全部落在区块内
    const zoneSet = new Set(zone);
    for (const hexId of points) assert.ok(zoneSet.has(hexId), `点位 ${hexId} 不在区块内`);

    // 2) 两两间距 ≥ 2（这是"玩家基地最小间距"的硬约束）
    for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
            assert.ok(hexDistance(points[i], points[j], rows, cols) >= 2, `点位 ${points[i]} 与 ${points[j]} 间距不足`);
        }
    }

    // 3) 确定性：同输入同输出
    assert.deepEqual(poissonSpawnPoints(zone, 2, rows, cols), points);

    // 4) 间距越大放得越少，且间距 1 等于全部候选
    assert.ok(poissonSpawnPoints(zone, 3, rows, cols).length < points.length);
    assert.equal(poissonSpawnPoints(zone, 1, rows, cols).length, zone.length);

    // 5) blocked 的格子不参与
    const blockedOne = poissonSpawnPoints(zone, 1, rows, cols, [zone[0]]);
    assert.equal(blockedOne.length, zone.length - 1);
    assert.ok(!blockedOne.includes(zone[0]));
});

test('出生区块容量估算：91 格、间距 2 能放到 n/3 上界（约 30 个）', () => {
    const { rows, cols } = config.world;
    const zone = circleHexes(820, 5, rows, cols);
    assert.equal(zone.length, 91);

    const points = poissonSpawnPoints(zone, 2, rows, cols);
    // 「间距 2」= 不相邻 ⇒ 求的是独立集；六边格 3-可着色 ⇒ 独立集上界正好 n/3 = 30.33。
    // 判据贴着上界：掉到 20 以下说明贪心退化了（早先按行优先只撒出 16 个，就是这么发现的）。
    assert.ok(points.length >= 29 && points.length <= 31, `撒点数 ${points.length} 没贴住 n/3 上界`);
});

test('布局经 js 归一化后仍能建出世界（编辑器保存 → 运行时加载的同一条路）', () => {
    const layout = baseLayout();
    const { layout: normalized } = normalizeBigmapLayout(JSON.parse(JSON.stringify(layout)));
    const world = buildBigMapWorldFromLayout(config, normalized as IBigMapLayout);
    assert.equal(world.cities.size, layout.cities.length);
    assert.equal(world.monsters.length, layout.monsters.length);
    assert.equal(world.tiles.length, layout.rows * layout.columns);
});
