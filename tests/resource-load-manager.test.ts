import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetLoadOptions, AssetService, AssetType } from '../assets/script/core/asset/AssetService';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
import { ResourceLoadManager } from '../assets/script/core/asset/ResourceLoadManager';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

class Item { constructor(readonly path: string) {} }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(limit = 1) {
    const started: string[] = [], released: string[] = [];
    const pending = new Map<string, { resolve: (value: Item) => void; reject: (error: Error) => void }>();
    const load = <T>(path: string, _type: AssetType<T>, options: AssetLoadOptions = {}): Promise<T> => {
        started.push(path);
        return new Promise<Item>((resolve, reject) => pending.set(path, { resolve: value => {
            options.scope?.defer(() => released.push(path)); resolve(value);
        }, reject })) as Promise<T>;
    };
    const delegate: AssetService = {
        load, loadDir: async (path, type, options) => [await load(path, type, options)],
        has: async () => true, preload: async (path, options) => { await load(path, Item, options); },
    };
    const manager = new ResourceLoadManager(delegate, { maxConcurrentLoads: limit });
    return { manager, started, released,
        finish(path: string) { pending.get(path).resolve(new Item(path)); },
        fail(path: string) { pending.get(path).reject(new Error('offline')); } };
}

test('加载、目录、预下载共用预算，前台提优且同优先级 FIFO', async () => {
    const f = fixture(), scope = new ResourceScope('owner');
    const first = f.manager.load('first', Item, { scope });
    const idle = f.manager.preload('idle', { scope });
    const dir = f.manager.loadDir('dir', Item, { scope, priority: 10 });
    const next = f.manager.load('next', Item, { scope, priority: 10 });
    assert.equal(await f.manager.has('index', Item), true);
    for (const path of ['first', 'dir', 'next', 'idle']) {
        assert.equal(f.started[f.started.length - 1], path); f.finish(path); await tick();
    }
    await Promise.all([first, idle, dir, next]);
    assert.deepEqual(f.started, ['first', 'dir', 'next', 'idle']); scope.dispose();
});

test('取消立即落定，排队不派发，在途任务仍占物理并发直到完成', async () => {
    const f = fixture(), cancelled = new ResourceScope('cancelled'), live = new ResourceScope('live');
    const first = f.manager.load('first', Item, { scope: cancelled });
    const queued = f.manager.load('queued', Item, { scope: cancelled });
    const rejected = Promise.all([assert.rejects(first, /取消/), assert.rejects(queued, /取消/)]);
    cancelled.dispose(); await rejected;
    const next = f.manager.load('next', Item, { scope: live });
    assert.deepEqual(f.started, ['first']); f.finish('first'); await tick();
    assert.deepEqual(f.released, ['first']); assert.deepEqual(f.started, ['first', 'next']);
    f.finish('next'); await next; live.dispose();
});

test('批量进度单调，结果保持输入顺序，成功资源由父作用域释放', async () => {
    const f = fixture(2), scope = new ResourceScope('owner');
    const progress: number[] = [];
    const batch = f.manager.loadBatch([{ path: 'a', type: Item }, { path: 'b', type: Item }], {
        scope, onProgress: value => progress.push(value.ratio),
    });
    f.finish('b'); await tick(); f.finish('a');
    const values = await batch.result;
    assert.ok(values); assert.deepEqual(values.map(item => item.path), ['a', 'b']);
    assert.deepEqual(progress, [0, 0.5, 1]); assert.deepEqual(f.released, []);
    batch.cancel(); assert.deepEqual(f.released, []); scope.dispose(); assert.equal(f.released.length, 2);
});

test('批量主动取消和父作用域销毁返回 false，迟到完成不再通知进度', async () => {
    for (const byParent of [false, true]) {
        const f = fixture(), scope = new ResourceScope('owner'), progress: number[] = [];
        const batch = f.manager.loadBatch([{ path: 'a', type: Item }, { path: 'b', type: Item }], {
            scope, onProgress: value => progress.push(value.ratio),
        });
        if (byParent) scope.dispose(); else batch.cancel();
        assert.equal(await batch.result, false); f.finish('a'); await tick();
        assert.deepEqual(f.started, ['a']); assert.deepEqual(progress, [0]);
        assert.deepEqual(f.released, ['a']); scope.dispose();
    }
});

test('批量失败释放本批资源、取消排队并拒绝结果，管理器仍可加载', async () => {
    const f = fixture(), scope = new ResourceScope('owner');
    const batch = f.manager.loadBatch(['a', 'b', 'c'].map(path => ({ path, type: Item })), { scope });
    const rejected = assert.rejects(batch.result, /offline/);
    f.finish('a'); await tick(); f.fail('b'); await rejected; await tick();
    assert.deepEqual(f.started, ['a', 'b']); assert.deepEqual(f.released, ['a']);
    const next = f.manager.load('next', Item, { scope }); f.finish('next'); await next; scope.dispose();
});

test('空清单完成，已销毁作用域不加载，dispose 结束等待并拒绝新请求', async () => {
    const f = fixture(), scope = new ResourceScope('owner');
    const progress: number[] = [];
    assert.deepEqual(await f.manager.loadBatch([], { scope, onProgress: p => progress.push(p.ratio) }).result, []);
    assert.deepEqual(progress, [1]); scope.dispose();
    assert.equal(await f.manager.loadBatch([{ path: 'late', type: Item }], { scope }).result, false);
    const first = f.manager.load('a', Item), queued = f.manager.load('b', Item);
    const rejected = Promise.all([assert.rejects(first, /取消/), assert.rejects(queued, /取消/)]);
    f.manager.dispose(); await rejected; await assert.rejects(f.manager.load('c', Item), /取消/);
    f.finish('a'); await tick(); assert.deepEqual(f.started, ['a']);
});

test('同步抛错释放调度名额且无预下载能力时保持兼容', async () => {
    const manager = new ResourceLoadManager({
        load: () => { throw new Error('sync'); }, loadDir: async () => [], has: async () => true,
    }, { maxConcurrentLoads: 1 });
    await assert.rejects(manager.load('a', Item), /sync/);
    assert.deepEqual(await manager.loadDir('dir', Item), []); await manager.preload('optional');
    assert.throws(() => new ResourceLoadManager({} as AssetService, { maxConcurrentLoads: 0 }), /并发/);
});

test('管理器销毁后拒绝索引预检，迟到预检不返回成功', async () => {
    let finish: (value: boolean) => void = () => {};
    const manager = new ResourceLoadManager({
        load: async <T>() => ({} as T), loadDir: async () => [],
        has: () => new Promise<boolean>(resolve => { finish = resolve; }),
    }, { maxConcurrentLoads: 1 });
    const pending = manager.has('index', Item);
    manager.dispose(); finish(true);
    await assert.rejects(pending, /取消/);
    await assert.rejects(manager.has('next', Item), /取消/);
});

test('进度观察者抛错时释放批量资源并停止尚未派发的项', async () => {
    const f = fixture(), scope = new ResourceScope('owner');
    const batch = f.manager.loadBatch(['a', 'b'].map(path => ({ path, type: Item })), {
        scope, onProgress: p => { if (p.completed) throw new Error('observer'); },
    });
    const rejected = assert.rejects(batch.result, /observer/);
    f.finish('a'); await rejected; await tick();
    assert.deepEqual(f.started, ['a']); assert.deepEqual(f.released, ['a']); scope.dispose();
});

test('可解除的释放登记幂等，销毁过程中注销不跳过其他释放动作', () => {
    const scope = new ResourceScope('owner'), released: number[] = [];
    const remove = scope.defer(() => released.push(1)); remove(); remove();
    const removeSecond = scope.defer(() => released.push(2));
    scope.defer(() => { removeSecond(); released.push(3); });
    scope.dispose(); scope.dispose(); assert.deepEqual(released, [3, 2]);
});

test('同一个回调重复登记时只解除指定的那一次', () => {
    const scope = new ResourceScope('owner'), released: string[] = [];
    const release = () => { released.push('asset'); };
    scope.defer(release); scope.defer(() => released.push('middle'));
    const remove = scope.defer(release); remove(); scope.dispose();
    assert.deepEqual(released, ['middle', 'asset']);
});

test('AssetService 注入和页面作用域包装保留批量入口及真实资产归属', async () => {
    const f = fixture(), page = new ResourceScope('page'), battle = new ResourceScope('battle');
    const assets: AssetService = scopeAssetService(f.manager, page);
    assert.ok(assets.loadBatch);
    const batch = assets.loadBatch([{ path: 'battle', type: Item }], { scope: battle });
    f.finish('battle'); assert.ok(await batch.result);
    page.dispose(); assert.deepEqual(f.released, []);
    battle.dispose(); assert.deepEqual(f.released, ['battle']);
});
