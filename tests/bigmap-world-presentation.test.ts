import assert from 'node:assert/strict';
import test from 'node:test';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';

test('原稿地块按 147×96 等比铺合，邻列共边且点击落在新台面内', () => {
    assert.equal(typeof geometry.buildBigMapWorldLayout, 'function');
    const layout = geometry.buildBigMapWorldLayout(3, 3);
    const center = layout.points.get(4)!;
    const right = layout.points.get(5)!;
    assert.equal(right.x - center.x, 110.25);
    assert.equal(Math.abs(right.y - center.y), 48);
    assert.equal(layout.width, 367.5);
    assert.equal(geometry.pickBigMapHex(layout, 3, 3, center.x + 65, center.y), 4);
});

test('六张沙地纹理由种子稳定选择，覆盖全部变体且不使用随机源', () => {
    assert.equal(typeof geometry.bigMapGroundIndex, 'function');
    const first = Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(20261017, id, 6));
    assert.deepEqual(Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(20261017, id, 6)), first);
    assert.equal(new Set(first).size, 6);
    assert.notDeepEqual(Array.from({ length: 200 }, (_, id) => geometry.bigMapGroundIndex(123, id, 6)), first);
    assert.equal(geometry.bigMapGroundIndex(1, 1, 0), -1);
});

test('居中地图每个地块的台面中心都拾取到自身，包含左右边界和单列图', () => {
    assert.equal(typeof geometry.pickBigMapHex, 'function');
    for (const [rows, columns] of [[40, 40], [3, 5], [4, 1], [1, 4]]) {
        const layout = geometry.buildBigMapWorldLayout(rows, columns);
        for (const [id, point] of layout.points) {
            assert.equal(geometry.pickBigMapHex(layout, rows, columns, point.x, point.y), id);
        }
    }
});

test('地图外部与六边形四角留白不误选边缘地块', () => {
    assert.equal(typeof geometry.pickBigMapHex, 'function');
    const layout = geometry.buildBigMapWorldLayout(1, 1);
    for (const [x, y] of [[1000, 0], [0, -1000], [60, 55], [-60, 55]]) {
        assert.equal(geometry.pickBigMapHex(layout, 1, 1, x, y), -1);
    }
});

test('视口裁剪只返回可见地块，大图不会为远处格子建节点', () => {
    assert.equal(typeof geometry.visibleBigMapHexes, 'function');
    const layout = geometry.buildBigMapWorldLayout(100, 100);
    const visible = geometry.visibleBigMapHexes(layout, 100, 100, { left: -360, right: 360, bottom: -400, top: 400 });
    assert.ok(visible.length > 0 && visible.length < 120);
    for (const id of visible) {
        const point = layout.points.get(id)!;
        assert.ok(Math.abs(point.x) < 430 && Math.abs(point.y) < 470);
    }
    assert.deepEqual(geometry.visibleBigMapHexes(layout, 100, 100, { left: 100000, right: 100720, bottom: 0, top: 800 }), []);
});

test('点击高于地块的建筑标签时优先选建筑，重叠时选最后绘制的建筑', () => {
    assert.equal(typeof geometry.pickBigMapMarker, 'function');
    const layout = geometry.buildBigMapWorldLayout(3, 3);
    const point = layout.points.get(4)!;
    const x = point.x;
    const y = point.y + 70;
    assert.notEqual(geometry.pickBigMapHex(layout, 3, 3, x, y), 4);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 4, width: 100, height: 100 }], x, y), 4);
    assert.equal(geometry.pickBigMapMarker(layout, [{ hexId: 4, width: 100, height: 100 }], x, y + 200), -1);
    assert.equal(geometry.pickBigMapMarker(layout, [
        { hexId: 4, width: 100, height: 100 }, { hexId: 7, width: 100, height: 300 },
    ], x, point.y), 7);
});
