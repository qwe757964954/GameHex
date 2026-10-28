import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';

function fixture() {
    class Prefab {}
    const paths = ['ui/game/ZCGameHUD', 'units/own/model', 'units/projectiles/effect'];
    const downloads: string[] = [];
    const requests: string[] = [], completions: (() => void)[] = [];
    let active = 0, peak = 0;
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/session/AppSessionAssetService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, Date, setTimeout, clearTimeout, require(name: string) {
        if (name === 'cc') return { Prefab };
        if (name.endsWith('/ScopedAssetCache')) return { ScopedAssetCache };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { bundleForPath: () => 'battle' };
        if (name.endsWith('/ZCGameResourcePlan')) return {
            ZC_BATTLE_DOWNLOAD_PREFABS: [paths[0]], buildZCBattleWarmupPaths: () => paths, buildZCBattleParsePaths: () => paths.slice(0, 2),
        };
        if (name.endsWith('/CardLineupIcons')) return { loadCommonArt: async () => ({}), releaseArtCache() {} };
        throw new Error(`静默解析不能构筑地图或战斗: ${name}`);
    } });
    const Service = exports.AppSessionAssetService as new (...args: unknown[]) => any;
    const service = new Service({ preload: async (path: string) => { downloads.push(path); }, load: async (path: string) => {
        requests.push(path); active++; peak = Math.max(active, peak);
        await new Promise<void>(resolve => completions.push(resolve)); active--; return { path };
    } }, { initialize: async () => {}, getTable: async () => [] });
    return { Prefab, service, requests, downloads, complete() { for (const done of completions.splice(0)) done(); }, get peak() { return peak; } };
}
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 35)); };

test('登录无战斗解析，显示主界面后单通道解析外壳/模型，暂停保留已完成资产', async (t) => {
    const f = fixture(); t.after(() => f.service.clear()); await f.service.prepare(); assert.equal(f.requests.length, 0);
    const task = f.service.warmup(); await flush();
    try {
        assert.deepEqual(f.requests, ['ui/game/ZCGameHUD']);
        f.complete(); await flush();
        assert.deepEqual(f.requests, ['ui/game/ZCGameHUD', 'units/own/model']);
        assert.equal(f.peak, 1);
    } finally { f.service.pauseWarmup(); f.complete(); await task; f.service.clear(); }
});

test('暂停后不派发排队解析，退出登录迟到结果不污染新会话', async (t) => {
    const f = fixture(); t.after(() => f.service.clear()); await f.service.prepare(); const old = f.service.warmup(); await flush();
    try { assert.equal(f.requests.length, 1); }
    finally {
        f.service.clear(); await f.service.prepare(); f.complete(); await old;
        assert.equal(f.requests.length, 1); assert.equal(f.service.reusableAssets.stats.entries, 0);
        f.service.clear();
    }
});


test('跨暂停恢复仍只一项解析在途，完成项直接给正式战斗复用', async (t) => {
    const f = fixture(); t.after(() => f.service.clear()); await f.service.prepare();
    const old = f.service.warmup(); await flush(); f.service.pauseWarmup();
    const resumed = f.service.warmup(); await flush();
    assert.equal(f.requests.length, 1, '旧下载解析未完成时新一轮不能另开解析');
    f.complete(); await flush();
    assert.equal(f.peak, 1);
    f.service.pauseWarmup(); f.complete(); await Promise.all([old, resumed]);
    const scope = new ResourceScope('formal-battle');
    const count = f.requests.length;
    await f.service.reusableAssets.load('ui/game/ZCGameHUD', f.Prefab, { scope, bundle: 'battle' });
    assert.equal(f.requests.length, count, '正式开战复用已解析资源');
    scope.dispose();
});


test('核心外壳在现有缓存内由会话持有，暂停和 TTL 后仍可复用，clear 后重新加载', async (t) => {
    const f = fixture(); t.after(() => f.service.clear()); await f.service.prepare();
    const task = f.service.warmup(); await flush(); f.complete(); await flush();
    f.service.pauseWarmup(); f.complete(); await task;
    assert.equal(f.service.warmupProgress.pinned, 1);
    const previousNow = Date.now;
    try { Date.now = () => previousNow() + 11 * 60 * 1000; f.service.reusableAssets.prune(); }
    finally { Date.now = previousNow; }
    assert.equal(f.service.reusableAssets.stats.entries, 1, '仅核心会话租约保留');
    const scope = new ResourceScope('battle');
    const count = f.requests.length;
    await f.service.reusableAssets.load('ui/game/ZCGameHUD', f.Prefab, { scope, bundle: 'battle' });
    assert.equal(f.requests.length, count); scope.dispose();
    f.service.clear(); assert.equal(f.service.reusableAssets.stats.entries, 0);
});


test('解析慢项不阻塞后续预下载，warmup 等解析链收尾后再释放作用域', async (t) => {
    const f = fixture(); t.after(() => f.service.clear()); await f.service.prepare();
    let settled = false;
    const task = f.service.warmup().then(() => { settled = true; });
    try {
        await flush();
        assert.ok(f.downloads.includes('units/projectiles/effect'), '第一项解析尚未完成，第三项仍应下载');
        assert.equal(settled, false, '下载完不能提前释放正在解析的作用域');
        assert.equal(f.requests.length, 1); assert.equal(f.peak, 1);
        f.complete(); await flush();
        assert.equal(f.requests.length, 2, '解析队列仍保持单通道推进');
    } finally { f.service.pauseWarmup(); f.complete(); await task; }
});
