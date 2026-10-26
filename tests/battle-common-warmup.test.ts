import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';

function fixture() {
    const requests: string[] = []; let finish: (() => void) | null = null;
    const exports: Record<string, any> = {};
    const names = ['ui/game/ZCGameHUD', 'ui/game/ZCGameBoard'];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/session/AppSessionAssetService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, setTimeout, clearTimeout, require(name: string) {
        if (name === 'cc') return { Prefab: class {} };
        if (name.endsWith('/ScopedAssetCache')) return { ScopedAssetCache };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { BATTLE_BUNDLE: 'battle' };
        if (name.endsWith('/ZCGameResourcePlan')) return { ZC_BATTLE_COMMON_PREFABS: names, ZC_BATTLE_DOWNLOAD_PREFABS: names };
        if (name.endsWith('/CardLineupIcons')) return { loadCommonArt: async () => ({}), releaseArtCache() {} };
        throw new Error(`公共预热不许构筑战斗或读地图：${name}`);
    } });
    const service = new exports.AppSessionAssetService({
        has: async () => true, loadDir: async () => { throw new Error('不许读地图'); },
        load: async (path: string) => { requests.push(path); await new Promise<void>(resolve => { finish = resolve; }); return { path }; },
    }, { initialize: async () => {} });
    return { service, requests, complete() { finish?.(); } };
}

test('登录不解析战斗，详情预热解析公共资产且重复触发合并', async () => {
    const f = fixture(); await f.service.prepare(); assert.deepEqual(f.requests, []);
    assert.equal(typeof f.service.warmupBattle, 'function');
    const a = f.service.warmupBattle(), b = f.service.warmupBattle(); assert.equal(a, b);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 1);
    f.service.pauseWarmup(); f.complete(); await a;
    assert.equal(f.requests.length, 1, '暂停后不再派发下一项');
    assert.equal(f.service.reusableAssets.stats.entries, 1, '已解析资源留给正式开战复用');
    f.service.clear(); assert.equal(f.service.reusableAssets.stats.entries, 0);
});

test('退出登录与迟到解析交错，新会话仍可预热且旧结果不入缓存', async () => {
    const f = fixture(); await f.service.prepare();
    assert.equal(typeof f.service.warmupBattle, 'function');
    const old = f.service.warmupBattle(); await new Promise(resolve => setImmediate(resolve));
    f.service.clear(); await f.service.prepare(); f.complete(); await old;
    assert.equal(f.service.reusableAssets.stats.entries, 0);
    const fresh = f.service.warmupBattle(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests.length, 2); f.service.pauseWarmup(); f.complete(); await fresh; f.service.clear();
});
