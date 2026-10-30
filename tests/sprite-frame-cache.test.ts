import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { AssetService } from '../assets/script/core/asset/AssetService';
import type { SpriteFrame } from 'cc';
import { loadSpriteFrameCache, TestSpriteFrame } from './helpers/sprite-frame-cache';

const frame = () => new TestSpriteFrame() as unknown as SpriteFrame;

test('同图路径和 SpriteFrame 路径共用请求，不同目录独立', async () => {
    const { SpriteFrameCache } = loadSpriteFrameCache();
    const paths: string[] = [];
    const cache = new SpriteFrameCache(async (path) => { paths.push(path); return frame(); });
    const [first, same, other] = await Promise.all([
        cache.loadNamed('icon', 'a'), cache.load('a/icon/spriteFrame'), cache.loadNamed('icon', 'b'),
    ]);
    assert.equal(first, same);
    assert.notEqual(first, other);
    assert.deepEqual(paths, ['a/icon/spriteFrame', 'b/icon/spriteFrame']);
    assert.equal(await cache.load(''), null);
    assert.equal(await cache.loadNamed('icon', ''), null);
    assert.equal(cache.peek('a/icon'), first);
});

test('同步异常、空结果和异步失败均可重试，失效帧会重载', async () => {
    const { SpriteFrameCache } = loadSpriteFrameCache();
    let calls = 0;
    const cache = new SpriteFrameCache(() => {
        calls++;
        if (calls === 1) throw new Error('sync');
        if (calls === 2) return Promise.reject(new Error('async'));
        return Promise.resolve(calls === 3 ? null : frame());
    });
    for (let i = 0; i < 3; i++) assert.equal(await cache.load('icon'), null);
    const first = await cache.load('icon');
    assert.ok(first);
    first.destroy();
    assert.equal(cache.peek('icon'), null);
    assert.notEqual(await cache.load('icon'), first);
    assert.equal(calls, 5);
});

test('clear 释放引用，迟到旧请求不覆盖新请求也不清除其在途记录', async () => {
    const { SpriteFrameCache } = loadSpriteFrameCache();
    const resolvers: Array<(value: SpriteFrame) => void> = [];
    const cache = new SpriteFrameCache(() => new Promise((resolve) => resolvers.push(resolve)));
    const old = cache.load('icon');
    await Promise.resolve();
    cache.clear();
    const fresh = cache.load('icon');
    await Promise.resolve();
    const staleFrame = frame();
    resolvers[0](staleFrame);
    assert.equal(await old, null);
    const same = cache.load('icon');
    assert.equal(fresh, same);
    assert.equal((staleFrame as unknown as TestSpriteFrame).refs, 0);
    const current = frame();
    resolvers[1](current);
    assert.equal(await fresh, current);
    assert.equal((current as unknown as TestSpriteFrame).refs, 1);
    cache.clear(); cache.clear();
    assert.equal((current as unknown as TestSpriteFrame).refs, 0);
    assert.equal(cache.peek('icon'), null);
});

test('作用域实例不额外持引用，释放后缓存和迟到结果均为空', async () => {
    const { SpriteFrameCache } = loadSpriteFrameCache();
    const scope = new ResourceScope('icons');
    const ready = frame();
    let finish: (value: SpriteFrame) => void = () => {};
    let calls = 0;
    const cache = new SpriteFrameCache((path) => {
        calls++;
        return path.startsWith('ready') ? Promise.resolve(ready) : new Promise((resolve) => { finish = resolve; });
    }, 'test', scope);
    assert.equal(await cache.load('ready'), ready);
    const pending = cache.load('later');
    await Promise.resolve();
    scope.dispose();
    finish(frame());
    assert.equal(await pending, null);
    assert.equal(await cache.load('ready'), null);
    assert.equal(await cache.load('new'), null);
    assert.equal((ready as unknown as TestSpriteFrame).refs, 0);
    assert.equal(calls, 2);
});

test('流程图标加载经 AssetService 传递原作用域和分包归属', async () => {
    const { createIconLoader } = loadSpriteFrameCache();
    const scope = new ResourceScope('match');
    const requests: Array<{ path: string; options: unknown }> = [];
    const assets = { load: async (path: string, _type: unknown, options: unknown) => {
        requests.push({ path, options }); return frame();
    } } as unknown as AssetService;
    const load = createIconLoader(assets, scope);
    await load('icon', 'icons/item');
    assert.equal(requests[0].path, 'icons/item/icon/spriteFrame');
    assert.equal((requests[0].options as { scope: ResourceScope }).scope, scope);
    assert.equal((requests[0].options as { bundle: string }).bundle, 'main-pages');
    scope.dispose();
    assert.equal(await load('icon', 'icons/item'), null);
});

test('旧入口适配路由加载并对缓存引用统一释放', async () => {
    const result = frame();
    let calls = 0;
    const { createRoutedSpriteFrameCache } = loadSpriteFrameCache(
        (_path: string, _type: unknown, done: (error: Error | null, frame: SpriteFrame) => void) => {
            calls++; done(null, result);
        },
    );
    const cache = createRoutedSpriteFrameCache('legacy');
    assert.equal(await cache.load('icon'), result);
    assert.equal(await cache.load('icon/spriteFrame'), result);
    assert.equal(calls, 1);
    assert.equal((result as unknown as TestSpriteFrame).refs, 1);
    cache.clear();
    assert.equal((result as unknown as TestSpriteFrame).refs, 0);
});
