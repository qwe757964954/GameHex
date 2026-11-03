import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as layoutModel from '../assets/script/app/bigmap/model/BigMapLayout';
import * as campWorld from '../assets/script/app/bigmap/model/BigMapCampWorld';
import { loadBigMapConfig, loadBigMapLayout } from './helpers/bigmap-fixtures';
import type { IBigMapConfig } from '../assets/script/app/bigmap/model/BigMapTypes';
import type { IBigMapLayout } from '../assets/script/app/bigmap/model/BigMapLayout';

function loadLoader() {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync('assets/script/app/bigmap/application/BigMapLayoutLoader.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, console, require: (name: string) => {
        if (name === 'cc') return { JsonAsset: class {} };
        if (name === '../model/BigMapLayout') return layoutModel;
        if (name === '../model/BigMapCampWorld') return campWorld;
        throw new Error(`Unexpected dependency: ${name}`);
    } });
    return module.exports as {
        bigMapLayoutPath(worldId: number): string;
        loadBigMapLayout(assets: { has(path: string): Promise<boolean>; load(path: string): Promise<{ json: unknown }> },
            config: IBigMapConfig): Promise<IBigMapLayout | null>;
    };
}

const config = campWorld.withBigMapCampCities(loadBigMapConfig());
const raw = JSON.parse(readFileSync('assets/resources/config/bigmap-maps/bigMap.json', 'utf8'));
const original = loadBigMapLayout('bigMap');

test('世界 1 加载 bigMap，其他世界继续使用 world_XX', () => {
    const loader = loadLoader();
    assert.equal(loader.bigMapLayoutPath(1), 'config/bigmap-maps/bigMap');
    assert.equal(loader.bigMapLayoutPath(2), 'config/bigmap-maps/world_02');
});

test('真实 bigMap 加载链路保留 81 城锚点、占格与势力范围，并对齐 campId', async () => {
    const paths: string[] = [];
    const loader = loadLoader();
    const layout = await loader.loadBigMapLayout({
        has: async (path) => { paths.push(path); return true; },
        load: async (path) => { paths.push(path); return { json: raw }; },
    }, config);
    assert.ok(layout);
    assert.deepEqual(paths, ['config/bigmap-maps/bigMap', 'config/bigmap-maps/bigMap']);
    assert.equal(layout.rows, 100);
    assert.equal(layout.columns, 100);
    assert.equal(layout.cities.length, 81);
    for (const city of original.cities) {
        const campId = Number(city.label);
        const mapped = layout.cities.find((site) => site.cityId === campId);
        assert.ok(config.camps.has(campId));
        assert.ok(mapped);
        assert.equal(mapped.anchorHexId, city.anchorHexId);
        assert.deepEqual(mapped.hexIds, city.hexIds);
        assert.deepEqual(mapped.rangeHex, city.rangeHex);
        assert.deepEqual(mapped.adjacentCityIds, city.adjacentCityIds.map((id) => Number(original.cities.find((site) => site.cityId === id)?.label)));
    }
    assert.deepEqual(layout.monsters, original.monsters);
    const worldConfig = { ...config, world: { ...config.world, rows: layout.rows, cols: layout.columns } };
    const world = layoutModel.buildBigMapWorldFromLayout(worldConfig, layout);
    assert.equal(world.tiles.length, 10000);
    assert.equal(world.cities.get(801)?.anchorHexId, original.cities[0].anchorHexId);
    assert.equal(config.world.rows, 40, '加载布局不修改共享配置表快照');
    assert.equal(raw.cities[0].cityId, 2001, '不修改编辑器源数据');
});

test('映射出生区的城池引用，重复 campId 标签当场报错', () => {
    const mapped = campWorld.completeBigMapCampLayout(config, { ...original,
        spawnZones: [{ zoneId: 1, cityId: original.cities[0].cityId, cells: [0], capacity: 1 }],
    });
    assert.equal(mapped.spawnZones[0].cityId, Number(original.cities[0].label));
    assert.throws(() => campWorld.completeBigMapCampLayout(config, { ...original,
        cities: original.cities.map((city, index) => index === 1 ? { ...city, label: original.cities[0].label } : city),
    }), /重复 campId/);
});

test('缺失、非法和世界 ID 不匹配的布局返回 null，继续允许种子回退', async () => {
    const loader = loadLoader();
    assert.equal(await loader.loadBigMapLayout({ has: async () => false,
        load: async () => { throw new Error('不应加载'); } }, config), null);
    for (const json of [{}, { ...raw, worldId: 2 }]) {
        assert.equal(await loader.loadBigMapLayout({ has: async () => true, load: async () => ({ json }) }, config), null);
    }
});
