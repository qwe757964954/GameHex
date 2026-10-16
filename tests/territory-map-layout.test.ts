import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    buildHexGridLayout,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
    HEX_GRID_VIEW_COLUMN_PHASE,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../assets/script/core/hex/HexGridLayout';
import { buildTerritoryMapLayout, territoryMapOffsetForCell } from '../assets/script/app/territory/model/TerritoryMapLayout';
import { configureTerritoryMap, territoryCellCoords } from '../assets/script/app/territory/model/TerritoryMapConfig';

const MAP_PATH = 'assets/resources/config/territory-maps/chapter_01.json';

const readMap = () => configureTerritoryMap(JSON.parse(readFileSync(MAP_PATH, 'utf8')));

test('领地布局完整复用共享格心、包围盒与绘制顺序', () => {
    const map = readMap();
    const shared = buildHexGridLayout(map.rows, map.columns);
    const territory = buildTerritoryMapLayout(map);
    assert.deepEqual(territory.points, shared.points);
    assert.equal(territory.width, shared.width);
    assert.equal(territory.height, shared.height);
    assert.deepEqual(territory.paintOrder, shared.paintOrder);
});

/**
 * 领地地图布局换算（从 `TerritoryPage.layoutPoints()` 抽出来的纯函数）。
 *
 *  抽出来的直接动机：这套换算是「页面」与「地图渲染」之间唯一的数据契约，
 *  以前它埋在 1001 行的页面里、只能靠跑真引擎才能验；现在零 `cc` 依赖，可以直接算给断言看。
 */
test('布局换算：格子数与行×列一致，坐标以包围盒中心为原点', () => {
    const map = readMap();
    assert.ok(map.rows > 0 && map.columns > 0, `地图行列非法：${map.rows}×${map.columns}`);
    const layout = buildTerritoryMapLayout(map);

    assert.equal(layout.points.size, map.rows * map.columns, '每个格子都要有一个坐标');
    assert.ok(layout.width > 0 && layout.height > 0);

    // 包围盒 = 点集范围 + 一格图，所以最外侧格心到边缘恒为半格。
    // ⚠️ 2.5D 地块图**非正方形**（130×119），宽高半值不同 —— 用一个 `half` 会算错纵向。
    const xs = [...layout.points.values()].map((point) => point.x);
    const ys = [...layout.points.values()].map((point) => point.y);
    const halfW = HEX_GRID_IMAGE_WIDTH / 2;
    const halfH = HEX_GRID_IMAGE_HEIGHT / 2;
    assert.equal(Math.min(...xs), -layout.width / 2 + halfW);
    assert.equal(Math.max(...xs), layout.width / 2 - halfW);
    assert.equal(Math.min(...ys), -layout.height / 2 + halfH);
    assert.equal(Math.max(...ys), layout.height / 2 - halfH);

    // 平移后仍然对称（中心在 0）：旧实现是「减点集中心」，两者必须一致。
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 1e-9, 'x 没有居中');
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2) < 1e-9, 'y 没有居中');
});

test('布局换算：列距 92.25 / 行距 90（2.5D 地块），蜂窝错位在 y 上（奇偶列 ±22.5）', () => {
    const map = readMap();
    const layout = buildTerritoryMapLayout(map);
    const pointOf = (row: number, column: number) => {
        const { row: r, column: c } = territoryCellCoords(row * map.columns + column, map.columns);
        assert.equal(r, row);
        assert.equal(c, column);
        return layout.points.get(row * map.columns + column)!;
    };
    // 同行相邻列：x 步长恒为列距。
    assert.equal(pointOf(0, 1).x - pointOf(0, 0).x, HEX_GRID_VIEW_COLUMN_SPACING);
    // 同列相邻行：y 步长恒为 -行距。
    assert.equal(pointOf(1, 0).y - pointOf(0, 0).y, -HEX_GRID_VIEW_ROW_SPACING);
    // 蜂窝错位在 **y** 上（`hexGridViewPoint` 里 `column % 2` 决定 ±PHASE），
    // 一行内的两个相邻列差 2×PHASE —— 写反成"错在 x 上"会得到 0。
    assert.equal(
        pointOf(0, 1).y - pointOf(0, 0).y,
        2 * HEX_GRID_VIEW_COLUMN_PHASE,
        '相邻列的 y 必须错开半个相位',
    );
    assert.equal(pointOf(0, 1).y - pointOf(0, 0).y, HEX_GRID_VIEW_ROW_SPACING / 2);
    assert.ok(HEX_GRID_VIEW_COLUMN_PHASE > 0);
});

test('布局换算：空地图返回空布局，绝不产生 NaN', () => {
    const map = readMap();
    // ⚠️ 旧实现只判了「有没有地图」，没判「有没有格子」：`Math.min(...[])` 得到 Infinity，
    // 一路算下去 width = NaN —— 写进 `UITransform.setContentSize` 后布局整个失效且**不报错**。
    for (const rows of [0, -1]) {
        const layout = buildTerritoryMapLayout({ ...map, rows, columns: 0 });
        assert.equal(layout.points.size, 0);
        assert.equal(layout.width, 0);
        assert.equal(layout.height, 0);
        assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height), '不能是 NaN');
    }
});

test('布局换算是纯函数：同一份地图算两次结果完全一致（可缓存、可复现）', () => {
    const map = readMap();
    const a = buildTerritoryMapLayout(map);
    const b = buildTerritoryMapLayout(readMap());
    assert.equal(a.width, b.width);
    assert.equal(a.height, b.height);
    for (const [cellId, point] of a.points) {
        const other = b.points.get(cellId);
        assert.ok(other, `第二次少了格子 ${cellId}`);
        assert.equal(point.x, other.x);
        assert.equal(point.y, other.y);
    }
});

test('首次滚动到随机点时，第一章起始格附近目标落在视口内', () => {
    const layout = buildTerritoryMapLayout(readMap());
    const viewport = { width: 720, height: 1280 };
    const cellId = 366;
    const target = layout.points.get(cellId)!;
    const offset = territoryMapOffsetForCell(layout, cellId, viewport);
    assert.ok(offset.x > 0 && offset.y > 0, '不能继续停在地图左上角');
    assert.ok(offset.x <= layout.width - viewport.width);
    assert.ok(offset.y <= layout.height - viewport.height);
    const centerX = -layout.width / 2 + viewport.width / 2 + offset.x;
    const centerY = layout.height / 2 - viewport.height / 2 - offset.y;
    assert.ok(Math.abs(target.x - centerX) <= viewport.width / 2);
    assert.ok(Math.abs(target.y - centerY) <= viewport.height / 2);
    assert.deepEqual(territoryMapOffsetForCell(layout, -1, viewport), { x: 0, y: 0 });
});
