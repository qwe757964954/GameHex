import assert from 'node:assert/strict';
import test from 'node:test';
import * as layout from '../assets/script/app/bigmap/view/BigMapBackgroundLayout';

test('背景覆盖任意拖动与缩放后的视口，边界始终是纹理整倍数', () => {
    for (const zoom of [0.15, 0.55, 1, 1.6]) {
        for (const x of [-100000, -2048, -1, 0, 1, 2048, 100000]) {
            const y = -x * 1.5;
            const result = layout.bigMapBackgroundLayout(720, 1560, zoom, x, y, 2048, 2048);
            const left = result.x - result.width / 2;
            const bottom = result.y - result.height / 2;
            assert.ok(left <= (-360 - x) / zoom);
            assert.ok(left + result.width >= (360 - x) / zoom);
            assert.ok(bottom <= (-780 - y) / zoom);
            assert.ok(bottom + result.height >= (780 - y) / zoom);
            for (const value of [left, bottom, result.width, result.height]) {
                assert.equal(Math.abs(value % 2048), 0);
            }
            assert.ok(result.width < 720 / zoom + 4096);
            assert.ok(result.height < 1560 / zoom + 4096);
        }
    }
});

test('跨平铺边界移动时世界坐标纹理相位一致，支持非正方形纹理', () => {
    const before = layout.bigMapBackgroundLayout(720, 1560, 1, -361, -100, 2048, 1024);
    const after = layout.bigMapBackgroundLayout(720, 1560, 1, -359, -100, 2048, 1024);
    const beforeLeft = before.x - before.width / 2;
    const afterLeft = after.x - after.width / 2;
    assert.notEqual(beforeLeft, afterLeft);
    assert.equal(Math.abs((beforeLeft - afterLeft) % 2048), 0);
    assert.equal(Math.abs((before.y - before.height / 2) % 1024), 0);
});

test('非法缩放或尺寸在布局边界拒绝，避免无限平铺几何', () => {
    for (const zoom of [0, -1, NaN, Infinity]) {
        assert.throws(() => layout.bigMapBackgroundLayout(720, 1560, zoom, 0, 0, 2048, 2048));
    }
    assert.throws(() => layout.bigMapBackgroundLayout(720, 1560, 1, 0, 0, 0, 2048));
    assert.throws(() => layout.bigMapBackgroundLayout(720, 1560, 1, Infinity, 0, 2048, 2048));
});
