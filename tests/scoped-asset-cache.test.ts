import type { AssetService } from '../assets/script/core/asset/AssetService';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { ScopedAssetCache } from '../assets/script/core/asset/ScopedAssetCache';

class Item {}
const adapter = (value: unknown): AssetService => value as AssetService;
function fixture(maxEntries = 2) {
    let now = 0, calls = 0, releases = 0;
    const cache = new ScopedAssetCache(adapter({
        load: async (path: string, _type: unknown, options?: { scope?: ResourceScope }) => {
            calls++; options?.scope?.defer(() => releases++); return { path };
        },
        loadDir: async (path: string, _type: unknown, options?: { scope?: ResourceScope }) => {
            calls++; options?.scope?.defer(() => releases++); return [{ path }];
        }, has: async () => true,
    }), { maxEntries, idleMs: 120000 }, () => now);
    return { cache, clock(value: number) { now = value; }, get calls() { return calls; }, get releases() { return releases; } };
}

test('解析资产跨战斗复用，TTL 从最后租约释放开始计算', async () => {
    const f = fixture(); const first = new ResourceScope('first');
    const a = await f.cache.load('ui/game/HUD', Item, { scope: first }); first.dispose();
    f.clock(100000); const second = new ResourceScope('second');
    assert.equal(await f.cache.load('ui/game/HUD', Item, { scope: second }), a);
    assert.equal(f.calls, 1); f.clock(300000); f.cache.prune(); assert.equal(f.releases, 0);
    second.dispose(); f.clock(419999); f.cache.prune(); assert.equal(f.releases, 0);
    f.clock(420000); f.cache.prune(); assert.equal(f.releases, 1); assert.equal(f.cache.stats.entries, 0);
});

test('合并在途请求，一个调用方取消不取消其他调用方', async () => {
    let finish!: (value: Item) => void; let calls = 0;
    const cache = new ScopedAssetCache(adapter({ load: (_p, _t, o) => { calls++; return new Promise<Item>(resolve => { finish = resolve; }); }, loadDir: async () => [], has: async () => true }),
        { maxEntries: 2, idleMs: 100 }, () => 0);
    const one = new ResourceScope('one'), two = new ResourceScope('two');
    const a = cache.load('unit', Item, { scope: one }), b = cache.load('unit', Item, { scope: two });
    const cancelled = assert.rejects(a, /取消/); one.dispose(); await Promise.resolve(); finish(new Item());
    await cancelled; assert.ok(await b); assert.equal(calls, 1); two.dispose(); cache.clear();
});

test('clear 立即断开旧缓存，活跃租约不失效，迟到完成不污染新会话', async () => {
    let calls = 0, releases = 0; const completions: ((value: Item) => void)[] = [];
    const cache = new ScopedAssetCache(adapter({ load: (_p, _t, o) => { calls++; o?.scope?.defer(() => releases++); return new Promise<Item>(resolve => completions.push(resolve)); }, loadDir: async () => [], has: async () => true }),
        { maxEntries: 2, idleMs: 100 }, () => 0);
    const oldScope = new ResourceScope('old'), freshScope = new ResourceScope('fresh');
    const old = cache.load('unit', Item, { scope: oldScope }); cache.clear();
    const fresh = cache.load('unit', Item, { scope: freshScope });
    await Promise.resolve(); completions[0](new Item()); await old; assert.equal(releases, 0);
    oldScope.dispose(); assert.equal(releases, 1);
    completions[1](new Item()); await fresh; assert.equal(calls, 2); assert.equal(cache.stats.entries, 1);
    freshScope.dispose(); cache.clear(); assert.equal(releases, 2);
});

test('容量不足先淘汰空闲项，全部活跃时透传，不扩大缓存或释放在用资源', async () => {
    const f = fixture(1); const a = new ResourceScope('a'), b = new ResourceScope('b');
    await f.cache.load('a', Item, { scope: a }); await f.cache.load('b', Item, { scope: b });
    assert.equal(f.cache.stats.entries, 1); assert.equal(f.releases, 0); b.dispose(); assert.equal(f.releases, 1);
    a.dispose(); const c = new ResourceScope('c'); await f.cache.load('c', Item, { scope: c });
    assert.equal(f.cache.stats.entries, 1); assert.equal(f.releases, 2); c.dispose(); f.cache.clear();
});

test('失败可重试，目录/单资源/bundle/构造器分开缓存，已取消请求不派发', async () => {
    let calls = 0; let fail = true;
    const cache = new ScopedAssetCache(adapter({ load: async () => { calls++; if (fail) throw new Error('offline'); return new Item(); }, loadDir: async () => { calls++; return []; }, has: async () => true }),
        { maxEntries: 8, idleMs: 100 }, () => 0);
    const scope = new ResourceScope('caller');
    await assert.rejects(cache.load('same', Item, { scope }), /offline/); fail = false;
    await cache.load('same', Item, { scope }); await cache.load('same', Item, { scope });
    await cache.loadDir('same', Item, { scope }); await cache.load('same', Item, { scope, bundle: 'other' });
    await cache.load('same', class Other {}, { scope }); assert.equal(calls, 5);
    scope.dispose(); await assert.rejects(cache.load('late', Item, { scope }), /取消/); assert.equal(calls, 5); cache.clear();
});

test('底层加载有并发预算，命中合并和容量透传均不突破预算', async () => {
    const started: string[] = [];
    const completions: (() => void)[] = [];
    const cache = new ScopedAssetCache(adapter({
        load: (path: string) => new Promise<Item>(resolve => {
            started.push(path); completions.push(() => resolve(new Item()));
        }), has: async () => true,
    }), { maxEntries: 1, idleMs: 100, maxConcurrentLoads: 1 }, () => 0);
    const scope = new ResourceScope('match');
    const first = cache.load('first', Item, { scope });
    const shared = cache.load('first', Item, { scope });
    const next = cache.load('next', Item, { scope });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['first']);
    completions.shift()!();
    assert.equal(await first, await shared);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['first', 'next']);
    completions.shift()!(); await next; scope.dispose(); cache.clear();
});

test('排队加载在取消和清缓存后不再派发，失败后继续后续请求', async () => {
    const started: string[] = [];
    let fail: (reason: Error) => void = () => {};
    const cache = new ScopedAssetCache(adapter({
        load: async (path: string) => {
            started.push(path);
            if (path === 'first') await new Promise((_resolve, reject) => { fail = reject; });
            return new Item();
        }, has: async () => true,
    }), { maxEntries: 4, idleMs: 100, maxConcurrentLoads: 1 }, () => 0);
    const live = new ResourceScope('live'), cancelled = new ResourceScope('cancelled');
    const first = cache.load('first', Item, { scope: live });
    const obsolete = cache.load('obsolete', Item, { scope: cancelled });
    const next = cache.load('next', Item, { scope: live });
    const rejected = Promise.all([assert.rejects(first, /offline/), assert.rejects(obsolete, /取消/)]);
    await new Promise(resolve => setImmediate(resolve));
    cancelled.dispose(); cache.clear(); fail(new Error('offline'));
    await rejected; assert.ok(await next);
    assert.deepEqual(started, ['first', 'next']);
    assert.equal(cache.stats.entries, 0);
    live.dispose();
});

test('低复用资源可绕过会话缓存，避免地图装饰挤掉单位资源', async () => {
    const f = fixture(1);
    const first = new ResourceScope('first');
    const model = await f.cache.load('model', Item, { scope: first }); first.dispose();
    const scene = new ResourceScope('scene');
    await f.cache.load('decor', Item, { scope: scene, cache: false }); scene.dispose();
    const second = new ResourceScope('second');
    assert.equal(await f.cache.load('model', Item, { scope: second }), model);
    assert.equal(f.calls, 2);
    assert.equal(f.cache.stats.entries, 1);
    second.dispose(); f.cache.clear();
});


test('后台解析只填空余容量，不逐出已有缓存，已缓存项仍可复用', async () => {
    let loads = 0;
    const cache = new ScopedAssetCache({ load: async () => { loads++; return {}; } } as AssetService,
        { maxEntries: 1, idleMs: 1000 }, () => 0);
    const foreground = new ResourceScope('foreground'), background = new ResourceScope('idle');
    const Type = class {};
    await cache.load('actual-battle', Type, { scope: foreground }); foreground.dispose();
    assert.equal(await cache.warm('unrelated', Type, { scope: background }), false);
    assert.equal(loads, 1);
    assert.equal(await cache.warm('actual-battle', Type, { scope: background }), true);
    assert.equal(loads, 1); assert.equal(cache.stats.entries, 1);
    background.dispose(); cache.clear();
});


test('前台优先于排队后台，同路径提优合并且保持同优先级 FIFO', async () => {
    const started: string[] = [], completions: (() => void)[] = [];
    const cache = new ScopedAssetCache(adapter({ load: (path: string) => new Promise<Item>(resolve => {
        started.push(path); completions.push(() => resolve(new Item()));
    }) }), { maxEntries: 8, idleMs: 1000, maxConcurrentLoads: 1 }, () => 0);
    const scope = new ResourceScope('caller');
    const first = cache.load('running', Item, { scope });
    const low = cache.load('idle', Item, { scope, priority: -10 });
    const promoted = cache.load('promoted', Item, { scope, priority: -10 });
    const urgent = cache.load('critical', Item, { scope, priority: 100 });
    const shared = cache.load('promoted', Item, { scope, priority: 100 });
    await new Promise(resolve => setImmediate(resolve));
    for (const expected of ['running', 'promoted', 'critical', 'idle']) {
        assert.equal(started.at(-1), expected);
        completions.shift()!(); await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(await promoted, await shared);
    await Promise.all([first, low, urgent]); scope.dispose(); cache.clear();
});
