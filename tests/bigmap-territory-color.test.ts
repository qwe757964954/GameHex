/**
 * 势力配色（`assignTerritoryColorSlots`）的回归测试。
 *
 * 关注点：用户口径是「**相邻的势力用不同的颜色**」，这条一旦静默坏掉，表现层不会报错，
 * 只是地图上两块挨着的势力变成同一个颜色 —— 属于"看着像 bug 但其实没日志"的那一类。
 * 所以这里拿**真实配置生成的世界**去验，而不是手造几个方块。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBigMapWorld, bigMapHexDistance } from '../assets/script/app/bigmap/model/BigMapWorld';
import { assignTerritoryColorSlots, assignTerritoryColorSlotsFromAdjacency } from '../assets/script/app/bigmap/model/BigMapTerritoryColor';
import { buildBigMapWorldFromLayout } from '../assets/script/app/bigmap/model/BigMapLayout';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';
import { loadBigMapConfig, loadBigMapLayout } from './helpers/bigmap-fixtures';

/** 与 `BIGMAP_TERRITORY_COLORS.length` 对齐；这里写死数字是为了不把 `cc` 拉进 node 单测。 */
const PALETTE_SIZE = 8;
/** 与 `BIGMAP_TERRITORY_NEIGHBOR_GAP` 对齐：城池最近也相距 4 格，贴身判定等于全同色。 */
const NEIGHBOR_GAP = 10;

const config = loadBigMapConfig();
const world = buildBigMapWorld(config);
const regions = [...world.cities.values()].map((site) => ({ id: site.cityId, hexIds: site.hexIds }));
const distance = (a: number, b: number): number => bigMapHexDistance(world.rows, world.cols, a, b);

test('色板是够用的：真实世界 25 座城只用 8 色就满足相邻不同色', () => {
    const slots = assignTerritoryColorSlots(regions, distance, PALETTE_SIZE, NEIGHBOR_GAP);
    assert.equal(slots.size, regions.length);
    for (const slot of slots.values()) {
        assert.ok(slot >= 0 && slot < PALETTE_SIZE, `色板下标越界：${slot}`);
    }
    // 相邻（同一屏内看得见）的任意两座城必须不同色 —— 这就是需求本身。
    for (let i = 0; i < regions.length; i += 1) {
        for (let j = i + 1; j < regions.length; j += 1) {
            const gap = minDistance(regions[i].hexIds, regions[j].hexIds);
            if (gap > NEIGHBOR_GAP) continue;
            assert.notEqual(
                slots.get(regions[i].id), slots.get(regions[j].id),
                `城池 ${regions[i].id} 与 ${regions[j].id} 相距 ${gap} 格，不该同色`,
            );
        }
    }
});

/**
 * 防退化：**必须真的用上多种颜色**。
 *
 * 只验「相邻不同色」是不够的 —— 相邻判定距离一旦被调小到没有边，25 座城会全部拿 0 号色，
 * 上面那条断言依然全绿，但地图上看起来像根本没染色（这个坑实际踩过一次）。
 */
test('真的染出了多种颜色（不是全都 0 号色）', () => {
    const slots = assignTerritoryColorSlots(regions, distance, PALETTE_SIZE, NEIGHBOR_GAP);
    const used = new Set(slots.values());
    assert.ok(used.size >= 4, `实际只用到 ${used.size} 种颜色，地图会看不出势力区分`);
});

test('配色是确定的：同输入必得同结果（不能每次进页面换一套颜色）', () => {
    const a = assignTerritoryColorSlots(regions, distance, PALETTE_SIZE, NEIGHBOR_GAP);
    const b = assignTerritoryColorSlots(regions, distance, PALETTE_SIZE, NEIGHBOR_GAP);
    assert.deepEqual([...a.entries()], [...b.entries()]);
});

test('放宽到隔 12 格也算相邻时仍然不撞色（色板够）', () => {
    const slots = assignTerritoryColorSlots(regions, distance, PALETTE_SIZE, 12);
    for (let i = 0; i < regions.length; i += 1) {
        for (let j = i + 1; j < regions.length; j += 1) {
            if (minDistance(regions[i].hexIds, regions[j].hexIds) > 12) continue;
            assert.notEqual(slots.get(regions[i].id), slots.get(regions[j].id));
        }
    }
});

test('色板不够时退回取模：不崩、不返回负数、不留未上色', () => {
    const slots = assignTerritoryColorSlots(regions, distance, 2, NEIGHBOR_GAP);
    assert.equal(slots.size, regions.length);
    for (const slot of slots.values()) assert.ok(slot === 0 || slot === 1);
});

test('空输入与非法色板长度直接给空表', () => {
    assert.equal(assignTerritoryColorSlots([], distance, PALETTE_SIZE).size, 0);
    assert.equal(assignTerritoryColorSlots(regions, distance, 0).size, 0);
});

function minDistance(a: readonly number[], b: readonly number[]): number {
    let best = Number.POSITIVE_INFINITY;
    for (const from of a) {
        for (const to of b) best = Math.min(best, distance(from, to));
    }
    return best;
}

// ---------------------------------------------------------------------------
// 真布局（线上 `world_01`）：染色铺满势力范围 `rangeHex`，邻接走 `adjacentCityIds`
// ---------------------------------------------------------------------------

const layout = loadBigMapLayout();
const layoutWorld = buildBigMapWorldFromLayout(config, layout);

/** 染色区域 = 势力范围（`rangeHex`），不是城池站的那几格；守卫这个口径本身就是一条用例。 */
const rangeRegions = [...layoutWorld.cities.values()].map((site) => ({
    id: site.cityId,
    hexIds: site.rangeHex ?? site.hexIds,
}));
const layoutDistance = (a: number, b: number): number => bigMapHexDistance(layoutWorld.rows, layoutWorld.cols, a, b);
const neighborsOf = (id: number): readonly number[] => layoutWorld.cities.get(id)?.adjacentCityIds ?? [];

test('真布局：每座城的染色区域是整片势力范围，而不是城池站的那几格', () => {
    assert.ok(rangeRegions.length >= 25, `只读到 ${rangeRegions.length} 座城，布局没加载上`);
    for (const site of layoutWorld.cities.values()) {
        const range = site.rangeHex ?? [];
        const footprint = site.hexIds;
        // 历史坑：`rangeHex` 曾经只等于「城池本体 + 半圈」（7 格），改代码也看不出变化。
        // 这里给个下限：范围至少是本体面积的 3 倍，且不少于 20 格。
        assert.ok(
            range.length >= Math.max(20, footprint.length * 3),
            `城池 ${site.cityId} 的势力范围只有 ${range.length} 格（本体 ${footprint.length} 格），染色会只染城池本身`,
        );
        for (const hexId of footprint) {
            assert.ok(range.includes(hexId), `城池 ${site.cityId} 的占格 ${hexId} 不在自己的势力范围里`);
        }
    }
});

test('真布局：势力范围铺满地图绝大部分（不是零散几片小色块）', () => {
    const total = layoutWorld.rows * layoutWorld.cols;
    const claimed = rangeRegions.reduce((sum, region) => sum + region.hexIds.length, 0);
    assert.ok(
        claimed >= total * 0.8,
        `势力范围只铺了 ${claimed}/${total}（${(claimed / total * 100).toFixed(1)}%），地图会大片留白`,
    );
    assert.ok(claimed < total, '整张图都被城池吃光了，边界荒野没了');
});

test('真布局：领接表能覆盖到每一座城，且是对称的', () => {
    for (const site of layoutWorld.cities.values()) {
        const neighbors = neighborsOf(site.cityId);
        assert.ok(neighbors.length > 0, `城池 ${site.cityId} 没有邻接城，染色必然退化成单色`);
        for (const other of neighbors) {
            assert.ok(layoutWorld.cities.has(other), `城池 ${site.cityId} 的邻接 ${other} 不存在`);
            assert.ok(
                neighborsOf(other).includes(site.cityId),
                `邻接不对称：${site.cityId} → ${other}，但 ${other} 的邻接里没有 ${site.cityId}`,
            );
        }
    }
});

test('真布局：按邻接表染色后，任意一对相邻势力都不同色', () => {
    const slots = assignTerritoryColorSlotsFromAdjacency(rangeRegions, neighborsOf, PALETTE_SIZE);
    assert.equal(slots.size, rangeRegions.length);
    for (const site of layoutWorld.cities.values()) {
        for (const other of neighborsOf(site.cityId)) {
            assert.notEqual(
                slots.get(site.cityId), slots.get(other),
                `相邻的 ${site.cityId} 与 ${other} 同色了，地图上两片势力会连成一片`,
            );
        }
    }
});

test('真布局：配色不退化（真的用了多种颜色）', () => {
    const slots = assignTerritoryColorSlotsFromAdjacency(rangeRegions, neighborsOf, PALETTE_SIZE);
    const used = new Set(slots.values());
    // 4 色是这个规模下的理论下限（平面图四色定理），DSATUR 取「最小可用下标」，
    // 所以正好停在 4 种 —— 断言「≥4」既挡住退化（全 0 号色），也不会因为贪心换序而误报。
    assert.ok(used.size >= 4, `实际只用到 ${used.size} 种颜色，地图上分不出势力`);
});

test('真布局：按几何距离兜底也要满足相邻不同色（丢掉邻接表时不能崩成单色）', () => {
    const slots = assignTerritoryColorSlots(rangeRegions, layoutDistance, PALETTE_SIZE, NEIGHBOR_GAP);
    assert.equal(slots.size, rangeRegions.length);
    for (let i = 0; i < rangeRegions.length; i += 1) {
        for (let j = i + 1; j < rangeRegions.length; j += 1) {
            if (minDistance(rangeRegions[i].hexIds, rangeRegions[j].hexIds) > NEIGHBOR_GAP) continue;
            assert.notEqual(slots.get(rangeRegions[i].id), slots.get(rangeRegions[j].id));
        }
    }
    assert.ok(new Set(slots.values()).size >= 4, '兜底路径退化成了单色');
});

test('真布局：势力范围互不重叠（重叠会让后画的城吃掉前一座的染色）', () => {
    const owner = new Map<number, number>();
    for (const site of layoutWorld.cities.values()) {
        for (const hexId of site.rangeHex ?? []) {
            const previous = owner.get(hexId);
            assert.equal(previous, undefined, `格 ${hexId} 同时属于城池 ${previous} 与 ${site.cityId}`);
            owner.set(hexId, site.cityId);
        }
    }
});

test('真布局：每片势力范围是连通的（有飞地会出现"别人地盘里一块自己的颜色"）', () => {
    const ownerOf = new Map<number, number>();
    for (const site of layoutWorld.cities.values()) {
        for (const hexId of site.rangeHex ?? []) ownerOf.set(hexId, site.cityId);
    }
    for (const site of layoutWorld.cities.values()) {
        const cells = site.rangeHex ?? [];
        const seen = new Set<number>([cells[0]]);
        const queue = [cells[0]];
        while (queue.length > 0) {
            const current = queue.pop()!;
            for (const neighbor of hexGridNeighborIds(current, layoutWorld.rows, layoutWorld.cols)) {
                if (seen.has(neighbor) || ownerOf.get(neighbor) !== site.cityId) continue;
                seen.add(neighbor);
                queue.push(neighbor);
            }
        }
        assert.equal(seen.size, cells.length, `城池 ${site.cityId} 的势力范围有 ${cells.length - seen.size} 格飞地`);
    }
});

// ---------------------------------------------------------------------------
// 设计稿 `dadi_tuchugao`（100×100，81 座城）：它是「范围该长什么样」的参照物。
// 尺寸与 40×40 的线上配置不同，所以只做**纯布局层**断言，不建世界。
// ---------------------------------------------------------------------------

const draftLayout = loadBigMapLayout('dadi_tuchugao');

test('设计稿：势力范围规模与邻接都成体系（逐座城都有范围、都有邻居）', () => {
    assert.ok(draftLayout.cities.length >= 81, `只读到 ${draftLayout.cities.length} 座城`);
    for (const city of draftLayout.cities) {
        assert.ok(city.rangeHex.length >= 40, `城池 ${city.cityId} 只有 ${city.rangeHex.length} 格`);
        assert.ok(city.adjacentCityIds.length > 0, `城池 ${city.cityId} 没有邻接`);
    }
});

test('设计稿：邻接对称、范围不重叠', () => {
    const byId = new Map(draftLayout.cities.map((city) => [city.cityId, city]));
    const owner = new Map<number, number>();
    for (const city of draftLayout.cities) {
        for (const other of city.adjacentCityIds) {
            assert.ok(byId.has(other), `城池 ${city.cityId} 的邻接 ${other} 不存在`);
            assert.ok(byId.get(other)!.adjacentCityIds.includes(city.cityId), `邻接不对称：${city.cityId} ↔ ${other}`);
        }
        for (const hexId of city.rangeHex) {
            const previous = owner.get(hexId);
            assert.equal(previous, undefined, `格 ${hexId} 同时属于 ${previous} 与 ${city.cityId}`);
            owner.set(hexId, city.cityId);
        }
    }
});
