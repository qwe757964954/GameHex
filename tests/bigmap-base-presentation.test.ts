import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

test('查看基地升级详情不扣资源、不启动队列，实际升级仍由既有规则执行', () => {
    const storage = createMemoryBigMapStorage();
    const presenter = new BigMapPresenter({
        config: loadBigMapConfig(), storage, saveKey: 'base-art-test',
        adventureChapter: () => 3, now: () => 1000,
    });
    assert.equal(typeof presenter.plotDetail, 'function');
    const main = presenter.plotCells().find((cell) => cell.buildingId === presenter.mainBuildingId)!;
    const before = JSON.stringify(presenter.base);
    const detail = presenter.plotDetail(main.hexId)!;
    assert.equal(detail.instanceId, main.instanceId);
    assert.equal(detail.name, main.name);
    assert.equal(detail.targetLevel, 2);
    assert.equal(detail.canUpgrade, true);
    assert.ok(detail.costWood > 0);
    assert.equal(detail.queueSlotIndex, -1);
    assert.equal(JSON.stringify(presenter.base), before);
    assert.equal(presenter.startUpgrade(detail.instanceId).ok, true);
    const busy = presenter.plotDetail(main.hexId)!;
    assert.equal(busy.canUpgrade, false);
    assert.ok(busy.queueSlotIndex >= 0);
    assert.ok(busy.remainSeconds > 0);
    assert.equal(presenter.plotDetail(-1), null);
});

test('新号升级详情显示真实章节限制，不因加载美术而解锁建筑', () => {
    const presenter = new BigMapPresenter({
        config: loadBigMapConfig(), storage: createMemoryBigMapStorage(), saveKey: 'base-locked-test',
        adventureChapter: () => 1, now: () => 1000,
    });
    assert.equal(typeof presenter.plotDetail, 'function');
    const main = presenter.plotCells().find((cell) => cell.buildingId === presenter.mainBuildingId)!;
    const detail = presenter.plotDetail(main.hexId)!;
    assert.equal(detail.canUpgrade, false);
    assert.match(detail.reason, /章/);
});

test('基地矩形地块自适应竖屏，绘制与拾取共用坐标且拒绝场地外点击', async () => {
    const modulePath = '../assets/script/app/bigmap/view/BigMapBasePresentation';
    assert.ok(existsSync(new URL(`${modulePath}.ts`, import.meta.url)), '缺少基地表现几何');
    const { buildBigMapBaseLayout, pickBigMapBasePlot } = await import(modulePath);
    for (const [rows, columns, width, height] of [[5, 5, 720, 900], [3, 7, 390, 600], [1, 1, 320, 420]]) {
        const cells = Array.from({ length: rows * columns }, (_, hexId) => ({
            hexId, row: Math.floor(hexId / columns), column: hexId % columns,
        }));
        const layout = buildBigMapBaseLayout(cells, width, height);
        assert.equal(layout.points.size, cells.length);
        for (const [hexId, point] of layout.points) {
            assert.equal(pickBigMapBasePlot(layout, point.x, point.y), hexId);
            assert.ok(Math.abs(point.x) + layout.tileWidth / 2 <= width / 2);
            assert.ok(Math.abs(point.y) + layout.tileHeight / 2 <= height / 2);
        }
        assert.equal(pickBigMapBasePlot(layout, width, height), -1);
        assert.equal(pickBigMapBasePlot(layout, Number.NaN, 0), -1);
    }
});

test('基地相邻六边格按大地图比例共边，列错位恒为半格且同列没有行缝', async () => {
    const { buildBigMapBaseLayout } = await import('../assets/script/app/bigmap/view/BigMapBasePresentation');
    const cells = Array.from({ length: 4 }, (_, hexId) => ({
        hexId, row: Math.floor(hexId / 2), column: hexId % 2,
    }));
    for (const [width, height] of [[720, 900], [390, 600]]) {
        const layout = buildBigMapBaseLayout(cells, width, height);
        const first = layout.points.get(0)!;
        const nextColumn = layout.points.get(1)!;
        const nextRow = layout.points.get(2)!;
        assert.ok(Math.abs(layout.tileWidth / layout.tileHeight - 147 / 96) < 1e-9);
        assert.ok(Math.abs(nextColumn.x - first.x - layout.tileWidth * 0.75) < 1e-9);
        assert.ok(Math.abs(Math.abs(nextColumn.y - first.y) - layout.tileHeight * 0.5) < 1e-9);
        assert.ok(Math.abs(Math.abs(nextRow.y - first.y) - layout.tileHeight) < 1e-9);
    }
});
