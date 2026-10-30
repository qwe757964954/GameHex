import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildBigMapBaseLayout, clampBigMapBaseCamera, pickBigMapBasePlot, zoomBigMapBaseCamera,
} from '../assets/script/app/bigmap/view/BigMapBasePresentation';

const cells = (rows: number, cols: number) => Array.from({ length: rows * cols }, (_, id) => ({
    hexId: id + 1000, row: Math.floor(id / cols), column: id % cols,
}));

test('20×20全部格心可拾取，位置ID原样保留，背景中央留出建筑区', () => {
    const layout = buildBigMapBaseLayout(cells(20, 20));
    assert.equal(layout.points.size, 400);
    assert.equal(layout.tileWidth, 147);
    assert.equal(layout.tileHeight, 96);
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
