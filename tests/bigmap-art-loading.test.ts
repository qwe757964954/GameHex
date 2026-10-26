import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as catalog from '../assets/script/app/bigmap/application/BigMapArtCatalog';

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
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return moduleExports.loadBigMapArt;
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
    assert.equal(art.buildings.size, 8);
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
        for (const path of ['concept/sprites/farm', 'concept/ui/stamina', 'concept/base_ground', 'main/city/btn_quick_fight']) {
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
    assert.ok([...late.ui.values()].every((frame) => frame === null));
});

test('资源缺失走既有建筑兜底，缺失美术不会改变规则配置', async () => {
    const assets = {
        has: async (path: string) => !path.includes('/concept/'),
        load: async (path: string) => ({ path }),
    };
    const art = await artLoader()(assets, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/hq-base/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/barracks-default/spriteFrame');
    assert.equal(art.baseBackground, null);
});

 test('世界标记优先使用现有植物建筑，概念图仅用于基地生产建筑', async () => {
    const art = await artLoader()({ has: async () => true, load: async (path: string) => ({ path }) }, { disposed: false });
    assert.equal(art.home.path, 'image/buildings/hq-base/spriteFrame');
    assert.equal(art.city.path, 'image/buildings/barracks-default/spriteFrame');
    assert.equal(art.monster.path, 'image/territory/buildings/territory_boss_v1/spriteFrame');
    assert.equal(art.buildings.get(71002).path, 'image/bigmap/concept/sprites/farm/spriteFrame');
});
