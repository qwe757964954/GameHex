import { bundleForPath } from '../assets/script/core/asset/BundleCatalog';
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
        if (name.endsWith('/BundleCatalog')) return { bundleForPath };
        if (name.endsWith('/CardLineupIcons')) return { loadCommonArt: async () => ({}), releaseArtCache() {} };
        throw new Error(`预热不应依赖战斗构筑模块: ${name}`);
    } });
    const Service = exports.AppSessionAssetService as new (assets: object, configs: object) => {
        prepare(): Promise<void>; warmup(): Promise<void>; pauseWarmup(): void; clear(): void; ready: boolean;
    };
    return new Service({ preload, load: async () => ({}) }, { initialize: async () => {}, getTable: async () => [] });
}

test('首屏完成后静默准备合并任务，文件下载限制并发二', async (t) => {
    const paths: string[] = [];
    const bundles: (string | undefined)[] = [];
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const s = service(async (path, options) => { paths.push(path); bundles.push(options?.bundle); await pending; });
    t.after(() => s.clear());
    await s.prepare();
    assert.deepEqual(paths, []);
    const a = s.warmup(), b = s.warmup();
    assert.equal(a, b);
    await new Promise(resolve => setImmediate(resolve));
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
    await new Promise(resolve => setImmediate(resolve));
    s.pauseWarmup(); s.clear();
    await s.prepare();
    finish(); await old;
    assert.equal(requests, 2);
    assert.equal(s.ready, true);
    await s.warmup();
    assert.ok(requests > 2, '新会话仍可预热');
    s.clear();
});


test('静默清单覆盖启用单位、弹道和模型覆盖，过滤脏数据并去重', () => {
    const paths = resourcePlan.buildZCBattleWarmupPaths([
        { enabled: 1, unitPrefabPath: 'units/a' }, { enabled: 0, unitPrefabPath: 'units/disabled' },
        { enabled: 1, unitPrefabPath: 'units/a' }, null,
    ], [{ effectPrefabPath: 'units/projectiles/b' }, { effectPrefabPath: '' }], [
        { enabled: 1, statId: 'model', value: 'skel/alternate' },
        { enabled: 0, statId: 'model', value: 'skel/disabled' },
        { enabled: 1, statId: 'attack', value: 8 },
    ]);
    assert.ok(paths.includes('units/a'));
    assert.ok(paths.includes('units/projectiles/b'));
    assert.ok(paths.includes('skel/alternate'));
    assert.ok(!paths.includes('units/disabled') && !paths.includes('skel/disabled'));
    assert.equal(paths.filter(path => path === 'units/a').length, 1);
    assert.ok(paths.includes(resourcePlan.ZC_BATTLE_SHELL_PATHS.spawnSelection));
});


test('暂停后恢复合并未完成下载，完成路径跳过，失败路径下次重试', async (t) => {
    const counts = new Map<string, number>();
    let finish: () => void = () => {};
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const s = service(async path => {
        const count = (counts.get(path) ?? 0) + 1; counts.set(path, count);
        await gate;
        if (path === 'ui/game/ZCGameHUD' && count === 1) throw new Error('offline');
    });
    t.after(() => s.clear()); await s.prepare();
    const first = s.warmup(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(counts.size, 2);
    s.pauseWarmup(); const second = s.warmup();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok([...counts.values()].every(count => count === 1));
    finish(); await Promise.all([first, second]);
    await s.warmup();
    assert.equal(counts.get('ui/game/ZCGameHUD'), 2);
    assert.equal(counts.get('ui/game/ZCGameBoard'), 1);
});


test('已有失败项与两个后续下载在途时，恢复仍保持全队列并发上限二', async () => {
    const pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
    let active = 0, peak = 0;
    const s = service(path => {
        active++; peak = Math.max(peak, active);
        return new Promise<void>((resolve, reject) => {
            pending.set(path, { resolve, reject });
        }).finally(() => { active--; pending.delete(path); });
    });
    await s.prepare(); const first = s.warmup();
    const flush = async () => { await new Promise(resolve => setTimeout(resolve, 35)); };
    await flush();
    pending.get(resourcePlan.buildZCBattleWarmupPaths([], [], [])[0])!.reject(new Error('offline'));
    await flush(); pending.get(resourcePlan.buildZCBattleWarmupPaths([], [], [])[1])!.resolve(); await flush();
    assert.equal(active, 2);
    s.pauseWarmup(); const second = s.warmup(); await flush();
    try { assert.equal(peak, 2, '恢复不能在两项仍在途时额外开失败项重试'); }
    finally {
        s.pauseWarmup(); for (const request of [...pending.values()]) request.resolve();
        await Promise.all([first, second]); s.clear();
    }
});


test('解析计划只含公共外壳与启用单位模型，不构筑或解析完整技能弹道', () => {
    const paths = resourcePlan.buildZCBattleParsePaths([
        { enabled: 1, unitPrefabPath: 'units/own/model' },
        { enabled: 0, unitPrefabPath: 'units/disabled/model' },
    ]);
    assert.ok(paths.includes('ui/game/ZCGameHUD'));
    assert.ok(paths.includes('units/own/model'));
    assert.ok(!paths.includes('units/disabled/model'));
    assert.ok(paths.every(path => !path.startsWith('units/projectiles/')));
});


test('静默窗口先保留八个核心外壳，单位先于可后补特效', () => {
    const paths = resourcePlan.buildZCBattleWarmupPaths([{ enabled: 1, unitPrefabPath: 'units/player/model' }], [], []);
    assert.deepEqual(paths.slice(0, 8), [...resourcePlan.ZC_BATTLE_DOWNLOAD_PREFABS]);
    assert.ok(paths.indexOf('units/player/model') < paths.indexOf(resourcePlan.ZC_BATTLE_FX_PATHS.death));
    assert.equal(new Set(paths).size, paths.length);
    for (const path of resourcePlan.ZC_BATTLE_COMMON_PREFABS) assert.ok(paths.includes(path));
});
