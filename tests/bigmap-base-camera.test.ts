import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bigMapNearestPlot, buildBigMapBaseLayout, clampBigMapBaseCamera, pickBigMapBasePlot, zoomBigMapBaseCamera,
} from '../assets/script/app/bigmap/view/BigMapBasePresentation';
import { BIGMAP_TILE_HEIGHT, BIGMAP_TILE_WIDTH } from '../assets/script/app/bigmap/view/BigMapWorldLayout';

const cells = (rows: number, cols: number) => Array.from({ length: rows * cols }, (_, id) => ({
    hexId: id + 1000, row: Math.floor(id / cols), column: id % cols,
}));

test('20×20全部格心可拾取，位置ID原样保留，背景中央留出建筑区', () => {
    const layout = buildBigMapBaseLayout(cells(20, 20));
    assert.equal(layout.points.size, 400);
    // 2026-11-02：地块按城池宽度对齐（山猫「地块没跟上」），格宽 = 建筑宽 235。
    assert.equal(layout.tileWidth, BIGMAP_TILE_WIDTH);
    assert.equal(layout.tileHeight, BIGMAP_TILE_HEIGHT);
    for (const [id, point] of layout.points) {
        assert.equal(pickBigMapBasePlot(layout, point.x, point.y), id);
        assert.ok(Math.abs(point.x) + layout.tileWidth / 2 <= layout.mapSize * 0.27);
        assert.ok(Math.abs(point.y) + layout.tileHeight / 2 + 140 <= layout.mapSize * 0.27);
    }
});

test('不同屏幕和平移缩放极值都不会露出背景外部', () => {
    const layout = buildBigMapBaseLayout(cells(20, 20));
    for (const [w, h] of [[390, 600], [720, 900], [1600, 600]]) {
        for (const zoom of [0.01, 0.5, 1, 10]) {
            for (const sign of [-1, 1]) {
                const camera = clampBigMapBaseCamera(layout, w, h, { zoom, x: sign * 1e6, y: -sign * 1e6 });
                const half = layout.mapSize * camera.zoom / 2;
                assert.ok(camera.x - half <= -w / 2 + 1e-8);
                assert.ok(camera.x + half >= w / 2 - 1e-8);
                assert.ok(camera.y - half <= -h / 2 + 1e-8);
                assert.ok(camera.y + half >= h / 2 - 1e-8);
            }
        }
    }
});

test('缩放保持手指锚点的地图坐标，变换后格心仍能准确拾取', () => {
    const layout = buildBigMapBaseLayout(cells(20, 20));
    const before = { zoom: 0.8, x: 30, y: -20 };
    const anchor = { x: 120, y: 80 };
    const after = zoomBigMapBaseCamera(layout, 720, 900, before, 1.2, anchor);
    assert.ok(Math.abs((anchor.x - before.x) / before.zoom - (anchor.x - after.x) / after.zoom) < 1e-8);
    assert.ok(Math.abs((anchor.y - before.y) / before.zoom - (anchor.y - after.y) / after.zoom) < 1e-8);
    const point = layout.points.get(1210)!;
    const screen = { x: point.x * after.zoom + after.x, y: point.y * after.zoom + after.y };
    assert.equal(pickBigMapBasePlot(layout, (screen.x - after.x) / after.zoom, (screen.y - after.y) / after.zoom), 1210);
});

test('摆放吸附：六边形缝隙里也能吸到最近格，图外仍然返回 -1', () => {
    const layout = buildBigMapBaseLayout(cells(3, 3));
    const center = layout.points.get(1004);
    assert.ok(center, '夹具第 5 格必须存在');
    // 正中心：精确命中与吸附给同一格。
    assert.equal(pickBigMapBasePlot(layout, center!.x, center!.y), 1004);
    assert.equal(bigMapNearestPlot(layout, center!.x, center!.y, layout.tileHeight), 1004);
    // 靠近另一格心 ⇒ 吸附到那一格（而不是靠得很近还判成 1004）。
    // ⚠️ 六边形是**密铺**，格与格之间没有缝：精确拾取本身不会"点偏就 miss"，
    // 吸附的价值在「手指精度不够时仍落在意图上的那一格」，以及贴图边界外仍能取最近格。
    const neighbour = layout.points.get(1005);
    assert.ok(neighbour);
    assert.equal(bigMapNearestPlot(layout, neighbour!.x - 1, neighbour!.y - 1, layout.tileHeight), 1005);
    // 整张图外不吸附，避免「点屏幕角落也放建筑」。
    assert.equal(bigMapNearestPlot(layout, center!.x + 5000, center!.y, layout.tileHeight), -1);
});
