import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';

function fixture(now: () => number = Date.now) {
    const requests: string[] = []; const finishes: (() => void)[] = [];
    const exports: Record<string, any> = {};
    const names = ['ui/game/ZCGameHUD', 'ui/game/ZCGameBoard'];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/session/AppSessionAssetService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, Date: { now }, setTimeout, clearTimeout, require(name: string) {
        if (name === 'cc') return { Prefab: class {} };
        if (name.endsWith('/ScopedAssetCache')) return { ScopedAssetCache };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { bundleForPath: () => 'battle' };
        if (name.endsWith('/ZCGameResourcePlan')) return { buildZCBattleWarmupPaths: () => names, buildZCBattleParsePaths: () => names };
        if (name.endsWith('/CardLineupIcons')) return { loadCommonArt: async () => ({}), releaseArtCache() {} };
        throw new Error(`公共预热不许构筑战斗或读地图：${name}`);
    } });
    const service = new exports.AppSessionAssetService({
        preload: async (path: string) => { requests.push(path); await new Promise<void>(resolve => { finishes.push(resolve); }); },
        has: async () => true, loadDir: async () => { throw new Error('不许读地图'); },
        load: async (path: string) => { requests.push(path); await new Promise<void>(resolve => { finishes.push(resolve); }); return { path }; },
    }, { initialize: async () => {}, getTable: async () => [] });
    return { service, requests, complete() { for (const finish of finishes.splice(0)) finish(); } };
}

test('登录不解析战斗，兼容预热入口只下载文件且重复触发合并', async () => {
    const f = fixture(); await f.service.prepare(); assert.deepEqual(f.requests, []);
    assert.equal(typeof f.service.warmupBattle, 'function');
    const a = f.service.warmupBattle(), b = f.service.warmupBattle(); assert.equal(a, b);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 2);
    f.service.pauseWarmup(); f.complete(); await a;
    assert.equal(f.requests.length, 2, '暂停后不再派发下一项');
    assert.equal(f.service.reusableAssets.stats.entries, 0, '后台不占用解析资产缓存');
    f.service.clear(); assert.equal(f.service.reusableAssets.stats.entries, 0);
});

test('短期缓存跨过两分钟浏览间隔仍可复用，十分钟空闲后释放', async (t) => {
    let now = 0;
    const f = fixture(() => now); t.after(() => f.service.clear()); await f.service.prepare();
    const scope = new ResourceScope('match');
    const loaded = f.service.reusableAssets.load('unit', class {}, { scope });
    await new Promise(resolve => setImmediate(resolve)); f.complete(); await loaded; scope.dispose();
    now = 180000; f.service.reusableAssets.prune();
    assert.equal(f.service.reusableAssets.stats.entries, 1, '正常浏览三分钟后不能又冷加载');
    now = 600000; f.service.reusableAssets.prune();
    assert.equal(f.service.reusableAssets.stats.entries, 0, '保留期有限，仍受64条容量约束');
    f.service.clear();
});

test('退出登录与迟到解析交错，新会话仍可预热且旧结果不入缓存', async () => {
    const f = fixture(); await f.service.prepare();
    assert.equal(typeof f.service.warmupBattle, 'function');
    const old = f.service.warmupBattle(); await new Promise(resolve => setImmediate(resolve));
    f.service.clear(); await f.service.prepare(); f.complete(); await old;
    assert.equal(f.service.reusableAssets.stats.entries, 0);
    const fresh = f.service.warmupBattle(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 4); f.service.pauseWarmup(); f.complete(); await fresh; f.service.clear();
});
