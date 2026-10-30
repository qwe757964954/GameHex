import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as catalog from '../assets/script/app/bigmap/application/BigMapArtCatalog';
import * as bundleCatalog from '../assets/script/core/asset/BundleCatalog';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function artLoader() {
    const source = readFileSync('assets/script/app/bigmap/application/BigMapArtLoader.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const moduleExports: Record<string, Function> = {};
    runInNewContext(code, {
        exports: moduleExports, console,
        require: (name: string) => {
            if (name === 'cc') return { SpriteFrame: class {} };
            if (name === './BigMapArtCatalog') return catalog;
            if (name === '../../../core/asset/BundleCatalog') return bundleCatalog;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return (...args: unknown[]) => {
        args[4] ??= loadBigMapConfig().buildings;
        return moduleExports.loadBigMapArt(...args);
    };
}

test('同一作用域中的重复建筑资源仅加载一次，布局指定背景仍优先', async () => {
    const calls: string[] = [];
    const assets = {
        has: async () => true,
        load: async (path: string) => { calls.push(path); return { path }; },
    };
    const art = await artLoader()(assets, { disposed: false }, 'custom/world');
    assert.equal(calls.filter((path) => path.endsWith('/construction/spriteFrame')).length, 1);
    assert.equal(art.background.path, 'custom/world/spriteFrame');
    assert.equal(art.tiledBackground.path, 'image/bigmap/bigMapBG/spriteFrame');
    assert.equal(art.baseBackground.path, 'image/bigmap/base_background/spriteFrame');
    assert.ok(!calls.some((path) => path.includes('/base_ground/')));
    assert.equal(art.buildings.size, 23);
    assert.equal(art.resources.size, 5);
    assert.equal(art.ui.size, 9);
});

test('基础贴图未完成时其他资源组已经发起，不串行等待六批资源', async () => {
    const paths: string[] = [];
    let finish: () => void = () => {};
    const ready = new Promise<void>((resolve) => { finish = resolve; });
    const loading = artLoader()({ has: async () => true, load: async (path: string) => {
        paths.push(path); await ready; return { path };
    } }, { disposed: false });
    await new Promise((resolve) => setImmediate(resolve));
    try {
        for (const path of ['concept/sprites/farm', 'concept/ui/stamina', 'bigmap/base_background', 'main/city/btn_quick_fight']) {
            assert.ok(paths.some((entry) => entry.endsWith(`${path}/spriteFrame`)), `${path} 不应等待其他资源组`);
        }
    } finally { finish(); await loading; }
});

test('页面加载前关闭不会发起资源请求，加载途中关闭不会发布迟到的美术引用', async () => {
    let requests = 0;
    const scope = { disposed: true };
    const assets = {
        has: async () => { requests += 1; return true; },
        load: async () => { scope.disposed = true; return {}; },
    };
    const load = artLoader();
    const closed = await load(assets, scope);
    assert.equal(requests, 0);
    assert.equal(closed.home, null);
    scope.disposed = false;
    const late = await load(assets, scope);
    assert.equal(late.home, null);
    assert.equal(late.baseBackground, null);
    assert.equal(late.tiledBackground, null);
    assert.ok([...late.ui.values()].every((frame) => frame === null));
});

test('连续背景缺失仍保留原布局背景和六张地皮', async () => {
    const art = await artLoader()({
        has: async (path: string) => !path.includes('/bigMapBG/'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, 'custom/world');
    assert.equal(art.tiledBackground, null);
    assert.equal(art.background.path, 'custom/world/spriteFrame');
    assert.equal(art.groundVariants.filter(Boolean).length, 6);
});

test('资源缺失走既有建筑兜底，缺失美术不会改变规则配置', async () => {
    const assets = {
        has: async (path: string) => !path.includes('/concept/'),
        load: async (path: string) => ({ path }),
    };
    const art = await artLoader()(assets, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/hq-base/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/barracks-default/spriteFrame');
    assert.equal(art.baseBackground.path, 'image/bigmap/base_background/spriteFrame');
});

 test('世界标记优先使用现有植物建筑，概念图仅用于基地生产建筑', async () => {
    const art = await artLoader()({ has: async () => true, load: async (path: string) => ({ path }) }, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/hq-base/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/barracks-default/spriteFrame');
    assert.equal(art.monster.path, 'image/territory/buildings/territory_boss_v1/spriteFrame');
    assert.equal(art.buildings.get(71002).path, 'image/bigmap/concept/sprites/farm/spriteFrame');
});

test('23 座基地建筑只使用现有类型图片，不探测或加载未接入的配置图片', async () => {
    const calls: string[] = [];
    const config = loadBigMapConfig();
    const art = await artLoader()({ has: async (path: string) => { calls.push(path); return true; }, load: async (path: string) => {
        calls.push(path); return { path };
    } }, { disposed: false }, '', new Map(), config.buildings);
    assert.equal(config.buildings.get(71014)?.icon, 'ui/bigmap/building/71004');
    assert.equal(config.buildings.get(71023)?.initialCellId, 1023);
    assert.equal(art.buildings.size, 23);
    for (const [id, name] of [[71006, 'farm'], [71011, 'sawmill'], [71012, 'ironworks'], [71015, 'warehouse'], [71016, 'water_tower'], [71023, 'rocks']] as const) {
        assert.equal(art.buildings.get(id).path, `image/bigmap/concept/sprites/${name}/spriteFrame`);
    }
    assert.equal(calls.some((path) => path.startsWith('ui/bigmap/building/')), false);
    assert.equal(calls.filter((path) => path === 'image/bigmap/concept/sprites/farm/spriteFrame').length, 2,
        '同类型图片只探测一次、加载一次');
    assert.equal(art.buildings.get(71017).path, 'image/bigmap/concept/sprites/construction/spriteFrame');
    const own = new Map(config.buildings);
    const field = own.get(71003);
    assert.ok(field);
    own.set(71003, { ...field, icon: 'custom/field' });
    const custom = await artLoader()({ has: async () => true, load: async (path: string) => ({ path }) }, { disposed: false }, '', new Map(), own);
    assert.equal(custom.buildings.get(71003).path, 'image/bigmap/concept/sprites/farm/spriteFrame');
});

test('新表图标尚未入库时每个建筑按类型回退，避免旧 ID 对错图', async () => {
    const art = await artLoader()({ has: async (path: string) => !path.startsWith('ui/bigmap/building/'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, '', new Map(), loadBigMapConfig().buildings);
    for (const [id, name] of [[71003, 'farm'], [71007, 'sawmill'], [71012, 'ironworks'], [71015, 'warehouse'], [71016, 'water_tower'], [71018, 'rocks']] as const) {
        assert.equal(art.buildings.get(id).path, `image/bigmap/concept/sprites/${name}/spriteFrame`);
    }
});

test('城池按 campIcon 加载，共图只请求一次，缺图回退既有城池图片', async () => {
    const config = loadBigMapConfig();
    const calls: string[] = [];
    const art = await artLoader()({ has: async () => true, load: async (path: string) => {
        calls.push(path); return { path };
    } }, { disposed: false }, '', new Map(), config.buildings, config.camps);
    assert.equal(art.camps.size, 81);
    assert.equal(art.camps.get(101).path, 'image/bigmap/concept/sprites/mutant_camp/spriteFrame');
    assert.equal(art.camps.get(201).path, 'image/bigmap/concept/sprites/fortress/spriteFrame');
    assert.equal(art.camps.get(801).path, 'image/bigmap/concept/sprites/headquarters/spriteFrame');
    assert.equal(calls.filter((p) => p.endsWith('/mutant_camp/spriteFrame')).length, 1);
    const camps = new Map(config.camps);
    const camp = camps.get(101);
    assert.ok(camp);
    camps.set(101, { ...camp, iconPath: 'missing/camp' });
    const fallback = await artLoader()({ has: async (path: string) => !path.startsWith('missing/'),
        load: async (path: string) => ({ path }),
    }, { disposed: false }, '', new Map(), config.buildings, camps);
    assert.equal(fallback.camps.get(101), fallback.city);
});
