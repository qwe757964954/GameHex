import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path: string, dependencies: Record<string, unknown>) {
    const context = { exports: {} as any, console, require: (name: string) => {
        assert.ok(name in dependencies, name); return dependencies[name];
    } };
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText, context); return context.exports;
}

/** 真实 BundleCatalog（core 纯 TS）：icons/card → main-pages、image/store → main-pages、config/x → resources。 */
const BundleCatalog = load('assets/script/core/asset/BundleCatalog.ts', {});

type BundleLike = { name: string; load: (p: string, t: unknown, cb: (e: Error | null, a?: unknown) => void) => void; loadDir?: (p: string, t: unknown, cb: (e: Error | null, a?: unknown[]) => void) => void };

function makeEnv() {
    const calls: string[] = [];
    const bundles = new Map<string, BundleLike>();
    const resources: BundleLike = {
        name: 'resources',
        load: (p, t, cb) => { calls.push(`resources.load:${p}`); cb(null, { path: p }); },
        loadDir: (p, t, cb) => { calls.push(`resources.loadDir:${p}`); cb(null, []); },
    };
    bundles.set('resources', resources);
    const assetManager = {
        getBundle: (name: string) => { calls.push(`getBundle:${name}`); return bundles.get(name); },
        loadBundle: (name: string, cb: (e: Error | null, b?: BundleLike) => void) => {
            calls.push(`loadBundle:${name}`);
            if (name === 'broken') { cb(new Error('loadBundle broken')); return; }
            const b: BundleLike = {
                name,
                load: (p, t, done) => { calls.push(`bundle.load:${name}:${p}`); done(null, { path: p }); },
                loadDir: (p, t, done) => { calls.push(`bundle.loadDir:${name}:${p}`); done(null, []); },
            };
            bundles.set(name, b);
            cb(null, b);
        },
    };
    const deps = {
        cc: { assetManager, resources, AssetManager: class {} },
        '../../core/asset/AssetService': { AssetType: class {} },
        '../../core/asset/BundleCatalog': BundleCatalog,
    };
    return { calls, deps, bundles };
}

test('routedLoad：未命中归属表路径走首包 resources（回调透传）', async () => {
    const { calls, deps } = makeEnv();
    const { routedLoad } = load('assets/script/app/common/RoutedResource.ts', deps);
    const result = await new Promise((resolve) => routedLoad('config/item', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls, ['resources.load:config/item']);
    assert.equal(result.e, null); assert.equal(result.a.path, 'config/item');
});

test('routedLoad：命中分包且 bundle 已加载 → 直接走 bundle.load，不重复 loadBundle', async () => {
    const { calls, deps, bundles } = makeEnv();
    bundles.set('main-pages', {
        name: 'main-pages',
        load: (p, t, cb) => { calls.push(`bundle.load:main-pages:${p}`); cb(null, { path: p }); },
    });
    const { routedLoad } = load('assets/script/app/common/RoutedResource.ts', deps);
    const result = await new Promise((resolve) => routedLoad('icons/card/camp_archer/spriteFrame', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls, ['getBundle:main-pages', 'bundle.load:main-pages:icons/card/camp_archer/spriteFrame']);
    assert.equal(result.e, null); assert.equal(result.a.path, 'icons/card/camp_archer/spriteFrame');
});

test('routedLoad：命中分包且 bundle 未加载 → loadBundle 成功后加载；已加载后走缓存', async () => {
    const { calls, deps } = makeEnv();
    const { routedLoad } = load('assets/script/app/common/RoutedResource.ts', deps);
    const first = await new Promise((resolve) => routedLoad('image/store/公用_图标_红宝箱01/spriteFrame', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls.slice(0, 2), ['getBundle:main-pages', 'loadBundle:main-pages']);
    assert.deepEqual(calls.slice(2), ['bundle.load:main-pages:image/store/公用_图标_红宝箱01/spriteFrame']);
    assert.equal(first.e, null);
    const second = await new Promise((resolve) => routedLoad('image/store/公用_图标_红宝箱01/spriteFrame', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls.slice(3), ['getBundle:main-pages', 'bundle.load:main-pages:image/store/公用_图标_红宝箱01/spriteFrame']);
    assert.equal(second.e, null);
});

test('routedLoad：bundle 加载失败 → 回调错误且 asset 为 null（不抛异常）', async () => {
    const { calls, deps } = makeEnv();
    deps['../../core/asset/BundleCatalog'] = { bundleForPath: (p: string) => (p.startsWith('image/never') ? 'broken' : undefined) };
    const { routedLoad } = load('assets/script/app/common/RoutedResource.ts', deps);
    const result = await new Promise((resolve) => routedLoad('image/never/x/spriteFrame', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls, ['getBundle:broken', 'loadBundle:broken']);
    assert.match(result.e.message, /loadBundle broken/);
    assert.equal(result.a, null);
});

test('routedLoadDir：命中分包目录走 bundle.loadDir，未命中走 resources.loadDir', async () => {
    const { calls, deps } = makeEnv();
    const { routedLoadDir } = load('assets/script/app/common/RoutedResource.ts', deps);
    const list = await new Promise((resolve) => routedLoadDir('icons/card', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls.slice(0, 2), ['getBundle:main-pages', 'loadBundle:main-pages']);
    assert.deepEqual(calls.slice(2), ['bundle.loadDir:main-pages:icons/card']);
    assert.deepEqual(list.a, []);
    const list2 = await new Promise((resolve) => routedLoadDir('config/ref', class {}, (e, a) => resolve({ e, a })));
    assert.deepEqual(calls.slice(3), ['resources.loadDir:config/ref']);
    assert.deepEqual(list2.a, []);
});
