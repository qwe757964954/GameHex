import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildHexGridLayout,
    HEX_GRID_VIEW_COLUMN_PHASE,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
    hexGridNeighborIds,
    hexGridViewPoint,
} from '../assets/script/core/hex/HexGridLayout';

test('shared hex layout returns centered bounds and back-to-front paint order', () => {
    const layout = buildHexGridLayout(2, 2);
    assert.equal(layout.width, 222.25);
    assert.equal(layout.height, 254);
    assert.deepEqual(layout.points.get(0), { x: -46.125, y: 22.5 });
    assert.deepEqual(layout.points.get(3), { x: 46.125, y: -22.5 });
    assert.deepEqual(layout.paintOrder, [1, 0, 3, 2]);
    assert.deepEqual(buildHexGridLayout(1, 3).paintOrder, [1, 0, 2]);
});

test('shared hex layout rejects empty and invalid dimensions without NaN', () => {
    for (const [rows, columns] of [[0, 3], [-1, 3], [2, 0], [Number.NaN, 2]]) {
        const layout = buildHexGridLayout(rows, columns);
        assert.equal(layout.points.size, 0);
        assert.equal(layout.width, 0);
        assert.equal(layout.height, 0);
        assert.deepEqual(layout.paintOrder, []);
    }
});

test('battle and territory hex coordinates share the flat-top staggered layout', () => {
    const evenColumn = hexGridViewPoint(2, 2, 6, 7);
    const oddColumn = hexGridViewPoint(2, 3, 6, 7);

    assert.equal(oddColumn.x - evenColumn.x, HEX_GRID_VIEW_COLUMN_SPACING);
    assert.equal(oddColumn.y - evenColumn.y, HEX_GRID_VIEW_COLUMN_PHASE * 2);
    assert.equal(hexGridViewPoint(3, 2, 6, 7).y - evenColumn.y, -HEX_GRID_VIEW_ROW_SPACING);
});

test('hexGridNeighborIds must match the visual layout: every neighbor is exactly one hex away', () => {
    const ROWS = 20;
    const COLS = 20;
    // 相邻格中心距有两种：**同列上下** = 行距；**斜向** = √(列距² + (行距/2)²)。
    // ⚠️ 压扁六边形（2.5D 地块 92.25/90）下斜距 102.6 **大于** 行距 90 ——
    // 所以阈值必须取**斜距**，取行距会把合法的斜邻居判成"不相邻"
    //（2026-10-12 换成 2.5D 地块时就踩了这条）。1.7 格仍远大于阈值，判据不失效。
    const ONE_HEX = Math.hypot(HEX_GRID_VIEW_COLUMN_SPACING, HEX_GRID_VIEW_ROW_SPACING / 2);
    const pointOf = (cellId: number) =>
        hexGridViewPoint(Math.floor(cellId / COLS), cellId % COLS, ROWS, COLS);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.hypot(a.x - b.x, a.y - b.y);
    for (let cellId = 0; cellId < ROWS * COLS; cellId++) {
        const center = pointOf(cellId);
        const neighbors = hexGridNeighborIds(cellId, ROWS, COLS);
        const row = Math.floor(cellId / COLS);
        const column = cellId % COLS;
        if (row >= 1 && row <= ROWS - 2 && column >= 1 && column <= COLS - 2) {
            assert.equal(neighbors.length, 6, `内部格 cell ${cellId} 应有 6 个邻居`);
        }
        for (const neighbor of neighbors) {
            const d = distance(center, pointOf(neighbor));
            assert.ok(d <= ONE_HEX + 1e-6,
                `cell ${cellId} 的邻居 ${neighbor} 中心距 ${d.toFixed(1)}px，视觉上不是相邻格`);
        }
    }
    // 回归锚点：主城 367 的第一圈邻居必须是视觉贴合的六格。
    assert.deepEqual(hexGridNeighborIds(367, ROWS, COLS).sort((a, b) => a - b),
        [346, 347, 348, 366, 368, 387].sort((a, b) => a - b));
});
