import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CardUnitPreviewAssets } from '../assets/script/app/card/CardUnitPreviewAssets';

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

const settle = () => new Promise<void>(done => setImmediate(done));
type Card = { id: string; unitId: string; unitPrefabPath: string };
const card = (id: string): Card => ({ id, unitId: id, unitPrefabPath: `skel/${id}` });

/** 执行真实 Page 的备图、提交与调度；仅替换引擎和外部 I/O。 */
function fixture(loadPrefab: (path: string) => Promise<unknown>, loadArt = async () => ({}),
    previewAssetsOverride?: unknown) {
    const scheduled = new Set<() => void>();
    const renders: string[] = [];
    const previews: unknown[] = [];
    class Component {
        isValid = true;
        schedule(callback: () => void) { scheduled.add(callback); }
        unschedule(callback: () => void) { scheduled.delete(callback); }
    }
    const moduleExports: Record<string, unknown> = {};
    const dependencies: Record<string, unknown> = {
        cc: { Component, _decorator: { ccclass: () => (target: unknown) => target, property: () => () => {} } },
        './CardArtProvider': { cardArtProvider: { loadLineupSlot: loadArt } },
        './CardUnitPreviewAssets': { CardUnitPreviewAssets: previewAssetsOverride ?? CardUnitPreviewAssets },
        './CardLineupTypes': { visibleIconTallies: () => [], activeBondTitle: () => '', bondPercentTotal: () => 0 },
        '../../framework/event/EventMgr': { EventMgr: { instance: { offTarget() {}, emit() {} } } },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, {
        exports: moduleExports,
        require: (id: string) => dependencies[id] ?? {},
        performance,
        console: { log() {}, warn() {} },
    });
    interface Page {
        isValid: boolean;
        initialize(resources: unknown): void;
        presentLineup(data: unknown): Promise<void>;
        onDestroy(): void;
    }
    const PageClass = moduleExports.CardLineupPage as new () => Page;
    const page = new PageClass();
    page.initialize({ scope: {}, assets: { load: loadPrefab } });
    Object.assign(page, {
        arenaSlotCache: Array.from({ length: 8 }, () => ({
            node: { active: false },
            render(value: Card) { renders.push(value.id); },
            setEmpty() {},
            applyPreview(prefab: unknown) { previews.push(prefab); },
        })),
        iconList: { refreshList() {} },
        bondTitleLabel: { string: '' },
        bondValueLabel: { string: '' },
    });
    const present = (deck: Card[]) => page.presentLineup({
        deck, catalog: [], heroListKnown: true, heroLevels: new Map(), bonuses: {},
    });
    const flush = () => { for (const callback of scheduled) callback(); };
    return { page, present, flush, renders, previews, scheduled };
}

test('静态图片与单位模型并行加载，首屏提交不等待模型', async () => {
    const art = deferred<object>();
    const model = deferred<object>();
    const requests: string[] = [];
    const f = fixture(path => { requests.push(path); return model.promise; }, () => art.promise);
    let committed = false;
    const rendering = f.present([card('a')]).then(() => { committed = true; });
    await settle();
    assert.deepEqual(requests, ['skel/a'], '静态图尚未就绪时就应开始加载模型');
    assert.equal(committed, false, '静态图未到仍须等待');
    art.resolve({});
    await settle();
    assert.equal(committed, true, '模型未到也应提交首屏');
    assert.deepEqual(f.renders, ['a']);
    assert.equal(f.scheduled.size, 0);
    const prefab = { name: 'a' };
    model.resolve(prefab);
    await rendering;
    await settle();
    assert.equal(f.scheduled.size, 1);
    f.flush();
    assert.deepEqual(f.previews, [prefab]);
    assert.equal(f.scheduled.size, 0);
});

test('权威阵容提交后，快照的迟到模型不能覆盖新阵容', async () => {
    const oldModel = deferred<object>();
    const newModel = deferred<object>();
    const f = fixture(path => path === 'skel/old' ? oldModel.promise : newModel.promise);
    void f.present([card('old')]);
    await settle();
    void f.present([card('new')]);
    await settle();
    oldModel.resolve({ name: 'old' });
    newModel.resolve({ name: 'new' });
    await settle();
    f.flush();
    assert.deepEqual(f.renders, ['old', 'new']);
    assert.deepEqual(f.previews, [{ name: 'new' }]);
});

test('页面销毁后，迟到模型不再注册调度或操作站台', async () => {
    const model = deferred<object>();
    const f = fixture(() => model.promise);
    void f.present([card('a')]);
    await settle();
    f.page.isValid = false;
    f.page.onDestroy();
    model.resolve({});
    await settle();
    assert.equal(f.scheduled.size, 0);
    assert.deepEqual(f.previews, []);
});

test('模型加载失败保留静态展示，不阻止首屏或启动空调度', async () => {
    const f = fixture(async () => { throw new Error('missing prefab'); });
    await f.present([card('a')]);
    await settle();
    assert.deepEqual(f.renders, ['a']);
    assert.equal(f.scheduled.size, 0);
    assert.deepEqual(f.previews, []);
});

test('模型全部就绪后依然分帧补齐，每帧最多两个', async () => {
    const models = deferred<object>();
    const f = fixture(() => models.promise);
    void f.present(Array.from({ length: 8 }, (_, index) => card(String(index))));
    await settle();
    assert.equal(f.renders.length, 8);
    models.resolve({});
    await settle();
    for (let frame = 1; frame <= 4; frame += 1) {
        f.flush();
        assert.equal(f.previews.length, frame * 2);
    }
    assert.equal(f.scheduled.size, 0);
});

test('新一轮提交要解除上一轮尚未消费的分帧调度', async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    const f = fixture(path => path === 'skel/a' ? first.promise : second.promise);
    void f.present([card('a')]);
    await settle();
    first.resolve({ name: 'a' });
    await settle();
    assert.equal(f.scheduled.size, 1, '第一轮模型已注册分帧调度');

    // 权威阵容回来：队列清空的同时必须把旧计时器一并作废，否则新模型会被
    // `previewFlushScheduled` 这个「仍为 true」的标志挡住，永远等不到重新注册。
    void f.present([card('b')]);
    await settle();
    assert.equal(f.scheduled.size, 0, '新一轮提交必须解除上一轮的调度');

    second.resolve({ name: 'b' });
    await settle();
    assert.equal(f.scheduled.size, 1, '新模型要重新注册自己的调度');
    f.flush();
    assert.deepEqual(f.previews, [{ name: 'b' }], '旧阵容模型不得被补到新站台');
});

test('模型 Promise 拒绝时保留静态图，且不泄漏未处理的拒绝', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
        // 换掉 loader：跨模块契约是 Promise<Prefab|null>，任何实现都可能 reject，
        // Page 这一层不能假设对方永远不会失败。
        class RejectingAssets {
            load() { return Promise.reject(new Error('loader boom')); }
        }
        const f = fixture(async () => ({}), async () => ({}), RejectingAssets);
        await f.present([card('a')]);
        await settle();
        await settle();
        assert.deepEqual(f.renders, ['a'], '静态图必须照常提交');
        assert.equal(f.scheduled.size, 0, '失败模型不得启动空调度');
        assert.deepEqual(unhandled, [], 'reject 必须被 commitSlots 兜住，不能泄漏到全局');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});
