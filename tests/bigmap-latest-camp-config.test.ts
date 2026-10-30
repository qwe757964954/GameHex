import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapLayout } from './helpers/bigmap-fixtures';
import { buildBigMapWorld } from '../assets/script/app/bigmap/model/BigMapWorld';
import { loadBigMapConfig as loadFromService } from '../assets/script/app/bigmap/application/BigMapConfigLoader';
import { completeBigMapCampLayout } from '../assets/script/app/bigmap/model/BigMapCampWorld';
import { buildBigMapWorldFromLayout } from '../assets/script/app/bigmap/model/BigMapLayout';
import { hexGridNeighborIds } from '../assets/script/core/hex/HexGridLayout';

function tables() {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        decompressBigMapRows(JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))).map((r) => ({ ...r })),
    ]));
}

test('81 条城池参数完整进入配置，图片、尺寸和积分不再丢失', () => {
    const raw = tables();
    const config = parseBigMapConfig(raw);
    assert.equal(config.camps.size, 81);
    for (const row of raw[BIGMAP_TABLE.camp]) {
        const camp = config.camps.get(Number(row.campId));
        assert.ok(camp);
        for (const field of ['chapter', 'gateNo', 'occupyType', 'campSize', 'openDay', 'dailyBattleLimit',
            'rankMinScore', 'warScoreRate', 'singleDamageScoreMax', 'maxScoreConfig', 'occupyScore',
            'minOccupyScore', 'rankResetTime', 'warScoreReset', 'firstRewardId', 'buffConNum', 'buffRate'] as const) {
            assert.equal(camp[field], row[field], `${row.campId}.${field}`);
        }
        assert.equal(camp.rallyOpen, row.rallyOpen === 1);
        assert.equal(camp.iconPath, row.campIcon);
        assert.ok(existsSync(`assets/bundles/bigmap/${camp.iconPath}.png`), camp.iconPath);
        assert.deepEqual(camp.adjacentCampIds, row.adjacentcampIds);
        assert.deepEqual(camp.buffGroupIds, row.buffGroupId);
        assert.deepEqual(camp.buffEffectIds, row.buffEffectId);
    }
});

test('新城池显示改读策划表，所有城池锚点与占格沿用现有布局', () => {
    const raw = tables();
    raw[BIGMAP_TABLE.camp][0].campName = '新营地';
    raw[BIGMAP_TABLE.camp][0].campDesc = '新的城池说明';
    raw[BIGMAP_TABLE.camp][0].minOccupyScore = 9876;
    const config = parseBigMapConfig(raw);
    const layout = loadBigMapLayout();
    const presenter = new BigMapPresenter({ config, layout, storage: createMemoryBigMapStorage(),
        saveKey: 'camp-config', adventureChapter: () => 3, now: () => 957600 });
    assert.equal(presenter.campConfigs, config.camps);
    assert.equal(presenter.cityView(101)?.name, '新营地');
    assert.equal(presenter.cityView(101)?.desc, '新的城池说明');
    assert.equal(presenter.cityView(101)?.campConfig, config.camps.get(101));
    for (const city of layout.cities) {
        assert.equal(presenter.cityView(city.cityId)?.hexId, city.anchorHexId);
        assert.deepEqual(presenter.world.cities.get(city.cityId)?.hexIds, city.hexIds);
    }
});

test('城池必填参数非法或缺失在配置边界报告对应字段', () => {
    for (const [field, value] of [['campSize', 0], ['chapter', undefined], ['occupyType', 5],
        ['warScoreRate', -1], ['buffRate', Infinity], ['rallyOpen', 2],
        ['adjacentcampIds', '[broken'], ['buffGroupId', [-1]]] as const) {
        const raw = tables();
        raw[BIGMAP_TABLE.camp][0][field] = value;
        assert.throws(() => parseBigMapConfig(raw), new RegExp(field));
    }
});

test('未提供布局时仍用原种子摆放算法，城池占格大小取策划表', () => {
    const raw = tables();
    raw[BIGMAP_TABLE.camp][0].campSize = 6;
    const config = parseBigMapConfig(raw);
    const first = buildBigMapWorld(config, 123);
    const second = buildBigMapWorld(config, 123);
    assert.equal(first.cities.get(101)?.hexIds.length, 6);
    assert.deepEqual([...first.cities.values()], [...second.cities.values()]);
    const occupied = [...first.cities.values()].flatMap((city) => [...city.hexIds]);
    assert.equal(new Set(occupied).size, occupied.length);
});

test('正式加载链路以81座城池为准，旧布局保留有效位置并补齐新增城池', async () => {
    const raw = tables();
    const config = await loadFromService({ getTable: async (name: string) => raw[name] ?? [] });
    assert.deepEqual([...config.cities.keys()], [...config.camps.keys()]);
    assert.equal(config.cities.size, 81);
    assert.equal(config.cities.has(200), false);
    assert.equal(buildBigMapWorld(config, 123).cities.size, 81);
    const old = loadBigMapLayout();
    const layout = completeBigMapCampLayout(config, old);
    assert.equal(layout.cities.length, 81);
    assert.deepEqual(layout.monsters, old.monsters);
    assert.deepEqual(layout.bases, old.bases);
    for (const city of old.cities.filter((c) => config.camps.has(c.cityId))) {
        assert.equal(layout.cities.find((c) => c.cityId === city.cityId)?.anchorHexId, city.anchorHexId);
    }
    assert.deepEqual(layout, completeBigMapCampLayout(config, old));
    const world = buildBigMapWorldFromLayout(config, layout);
    assert.equal(world.cities.size, 81);
    const occupied = [...layout.cities.flatMap((c) => [...c.hexIds]),
        ...layout.monsters.flatMap((m) => [...m.hexIds]), ...layout.bases.map((b) => b.hexId), ...layout.blocked,
        ...layout.points.flatMap((p) => [...p.hexIds])];
    assert.equal(new Set(occupied).size, occupied.length);
    const ranges = layout.cities.flatMap((c) => [...c.rangeHex]);
    assert.equal(new Set(ranges).size, ranges.length);
    assert.equal(ranges.length, layout.rows * layout.columns);
    for (const city of layout.cities) {
        const region = new Set(city.rangeHex);
        const seen = new Set([city.anchorHexId]);
        const queue = [city.anchorHexId];
        for (let i = 0; i < queue.length; i++) for (const next of hexGridNeighborIds(queue[i], layout.rows, layout.columns)) {
            if (!region.has(next) || seen.has(next)) continue;
            seen.add(next); queue.push(next);
        }
        assert.equal(seen.size, region.size, `城池 ${city.cityId} 范围必须连通`);
        for (const other of city.adjacentCityIds) {
            assert.ok(layout.cities.find((c) => c.cityId === other)?.adjacentCityIds.includes(city.cityId));
        }
    }
});
