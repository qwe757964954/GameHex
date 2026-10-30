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
    // 策划表里主城升 2 级的前置是 [木材田-1(71007) Lv1, 铁矿田-1(71012) Lv1]；
    // 这个号只有主城 ⇒ 详情里必须是「不可升级」，而且**不能**动存档。
    assert.equal(detail.canUpgrade, false);
    assert.match(detail.reason, /前置|升到 1 级|需先将/);
    assert.equal(detail.queueSlotIndex, -1);
    assert.equal(JSON.stringify(presenter.base), before);
    // 点升级也不会真的排队列（本地规则先拦）。
    assert.equal(presenter.startUpgrade(detail.instanceId).ok, false);
    assert.equal(JSON.stringify(presenter.base), before);
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

test('基地固定格距，不因视口缩小建筑，绘制与拾取共用地图坐标', async () => {
    const modulePath = '../assets/script/app/bigmap/view/BigMapBasePresentation';
    assert.ok(existsSync(new URL(`${modulePath}.ts`, import.meta.url)), '缺少基地表现几何');
    const { buildBigMapBaseLayout, pickBigMapBasePlot } = await import(modulePath);
    for (const [rows, columns, width, height] of [[5, 5, 720, 900], [3, 7, 390, 600], [1, 1, 320, 420]]) {
        const cells = Array.from({ length: rows * columns }, (_, hexId) => ({
            hexId, row: Math.floor(hexId / columns), column: hexId % columns,
        }));
        const layout = buildBigMapBaseLayout(cells);
        assert.equal(layout.points.size, cells.length);
        for (const [hexId, point] of layout.points) {
            assert.equal(pickBigMapBasePlot(layout, point.x, point.y), hexId);
            assert.ok(Math.abs(point.x) + layout.tileWidth / 2 < layout.mapSize / 2);
            assert.ok(Math.abs(point.y) + layout.tileHeight / 2 < layout.mapSize / 2);
        }
        assert.equal(pickBigMapBasePlot(layout, layout.mapSize, layout.mapSize), -1);
        assert.equal(pickBigMapBasePlot(layout, Number.NaN, 0), -1);
    }
});

test('基地相邻六边格按大地图比例共边，列错位恒为半格且同列没有行缝', async () => {
    const { buildBigMapBaseLayout } = await import('../assets/script/app/bigmap/view/BigMapBasePresentation');
    const cells = Array.from({ length: 4 }, (_, hexId) => ({
        hexId, row: Math.floor(hexId / 2), column: hexId % 2,
    }));
    for (const [width, height] of [[720, 900], [390, 600]]) {
        const layout = buildBigMapBaseLayout(cells);
        const first = layout.points.get(0)!;
        const nextColumn = layout.points.get(1)!;
        const nextRow = layout.points.get(2)!;
        assert.ok(Math.abs(layout.tileWidth / layout.tileHeight - 147 / 96) < 1e-9);
        assert.ok(Math.abs(nextColumn.x - first.x - layout.tileWidth * 0.75) < 1e-9);
        assert.ok(Math.abs(Math.abs(nextColumn.y - first.y) - layout.tileHeight * 0.5) < 1e-9);
        assert.ok(Math.abs(Math.abs(nextRow.y - first.y) - layout.tileHeight) < 1e-9);
    }
});
