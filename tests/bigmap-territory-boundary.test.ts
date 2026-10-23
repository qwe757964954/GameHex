import assert from 'node:assert/strict';
import test from 'node:test';
import * as geometry from '../assets/script/app/bigmap/view/BigMapWorldLayout';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { exportBigMapLayout } from '../assets/script/app/bigmap/model/BigMapLayout';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

test('势力外轮廓剔除内部共享边，同时保留凹口、孔洞和分离区域', () => {
    assert.equal(typeof geometry.buildBigMapTerritoryEdges, 'function');
    const layout = geometry.buildBigMapWorldLayout(7, 7);
    const center = 24;
    const ring = hexGridNeighborIds(center, 7, 7);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, [center]).length, 6);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, [center, ring[0]]).length, 10);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, [center, ...ring]).length, 18);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, ring).length, 24);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, [0, 48]).length, 12);
    assert.equal(geometry.buildBigMapTerritoryEdges(layout, [center, center, -1]).length, 6);
    assert.deepEqual(geometry.buildBigMapTerritoryEdges(layout, [...ring, center]),
        geometry.buildBigMapTerritoryEdges(layout, [center, ...ring].reverse()));
});

test('地图配置的 rangeHex 进入表现数据，范围覆盖城池占地且不修改规则与存档', () => {
    const config = loadBigMapConfig();
    const world = buildBigMapWorld(config);
    const layout = exportBigMapLayout(world);
    const city = layout.cities[0];
    const extraHex = world.tiles.find((tile) => !city.hexIds.includes(tile.id))!.id;
    const annotated = { ...layout, cities: layout.cities.map((site) => site.cityId === city.cityId
        ? { ...site, rangeHex: [extraHex] } : site) };
    const before = JSON.stringify(annotated);
    const presenter = new BigMapPresenter({ config, layout: annotated,
        storage: createMemoryBigMapStorage(), saveKey: 'territory-presentation',
        now: () => 1000, adventureChapter: () => 3 });
    assert.equal(typeof presenter.territoryRegions, 'function');
    const region = presenter.territoryRegions().find((entry) => entry.id === city.cityId)!;
    assert.deepEqual(new Set(region.hexIds), new Set([...city.hexIds, extraHex]));
    assert.equal(JSON.stringify(annotated), before);
    assert.deepEqual(presenter.world.cities.get(city.cityId)!.hexIds, city.hexIds);
    const plain = presenter.territoryRegions().find((entry) => entry.id === layout.cities[1].cityId)!;
    assert.deepEqual(new Set(plain.hexIds), new Set(layout.cities[1].hexIds));
});
