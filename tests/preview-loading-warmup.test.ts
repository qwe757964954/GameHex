import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';
import * as resourcePlan from '../assets/script/app/zcds/model/ZCGameResourcePlan';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

function service(preload: (path: string, options?: { bundle?: string }) => Promise<void>) {
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/session/AppSessionAssetService.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, setTimeout, clearTimeout, require(name: string) {
        if (name === 'cc') return { Prefab: class {} };
        if (name.endsWith('/ScopedAssetCache')) return { ScopedAssetCache };
        if (name.endsWith('/ZCGameResourcePlan')) return resourcePlan;
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BundleCatalog')) return { BATTLE_BUNDLE: 'battle' };
        if (name.endsWith('/CardLineupIcons')) return { loadCommonArt: async () => ({}), releaseArtCache() {} };
        throw new Error(`预热不应依赖战斗构筑模块: ${name}`);
    } });
    const Service = exports.AppSessionAssetService as new (assets: object, configs: object) => {
        prepare(): Promise<void>; warmup(): Promise<void>; pauseWarmup(): void; clear(): void; ready: boolean;
    };
    return new Service({ preload, load: () => { throw new Error('预热不得解析资源'); } }, { initialize: async () => {} });
}

test('首屏完成后公共预热只预下载，并发调用共享同一任务', async () => {
    const paths: string[] = [];
    const bundles: (string | undefined)[] = [];
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const s = service(async (path, options) => { paths.push(path); bundles.push(options?.bundle); await pending; });
    await s.prepare();
    assert.deepEqual(paths, []);
    const a = s.warmup(), b = s.warmup();
    assert.equal(a, b);
    assert.ok(paths.length > 0 && paths.length <= 2, '后台任务限制并发');
    finish(); await a;
    assert.equal(new Set(paths).size, paths.length);
    assert.ok(paths.includes('ui/game/ZCGameHUD'));
    assert.ok(bundles.every((b) => b === 'battle'), '战斗公共 Prefab 预下载必须带 battle bundle');
    s.clear();
});

test('前台进入或退出登录后停止派发后台任务，迟到完成不污染新会话', async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let requests = 0;
    const s = service(async () => { requests += 1; await pending; });
    await s.prepare();
    const old = s.warmup();
    s.pauseWarmup(); s.clear();
    await s.prepare();
    finish(); await old;
    assert.equal(requests, 2);
    assert.equal(s.ready, true);
    await s.warmup();
    assert.ok(requests > 2, '新会话仍可预热');
    s.clear();
});
