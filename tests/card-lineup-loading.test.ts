import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CardUnitPreviewAssets } from '../assets/script/app/card/CardUnitPreviewAssets';
import { sortLineupCards, visibleLineupCards } from '../assets/script/app/card/CardLineupTypes';
import { ZCCardType } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import { CardLineupUiEvent } from '../assets/script/app/card/CardLineupEvents';
import { cardArtConfig } from './helpers/card-art-config';

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

const settle = () => new Promise<void>(done => setImmediate(done));
type Card = { id: string; unitId: string; unitPrefabPath: string; type: number; rarity: string };
const card = (id: string): Card => ({ id, unitId: id, unitPrefabPath: `skel/${id}`, type: ZCCardType.Barracks, rarity: 'green' });

/** 执行真实 Page 的备图、提交与调度；仅替换引擎和外部 I/O。 */
function fixture(loadPrefab: (path: string) => Promise<unknown>,
    loadArt: (card: Card) => Promise<unknown> = async () => ({}),
    previewAssetsOverride?: unknown, loadUpgradeStatus = async (_id: string) => ({ requirements: [], maxed: false, configured: true }),
    loadCardArt: (card: Card) => Promise<unknown> = loadArt) {
    const scheduled = new Set<() => void>();
    const scheduledOnce = new Set<() => void>();
    const renders: string[] = [];
    const previews: unknown[] = [];
    const poolRenders: string[] = [];
    /** 卡库条目每次 `render` 的**完整实参**（帧是否为空、有没有拿到自取图的 loader）。 */
    const poolCalls: unknown[][] = [];
    let refreshCalls = 0;
    /** 图晚到时 `fillSlotArt` 补到哪个站台、补了什么。 */
    const staticArt: Array<{ index: number; frames: unknown }> = [];
    const upgrades: string[] = [];
    const cardGrid = {
        renderItemFn: (_node: unknown, _index: number) => {},
        onItemClickFn: (_node: unknown, _index: number) => {},
        refreshList(count: number) {
            refreshCalls += 1;
            poolRenders.length = 0;
            poolCalls.length = 0;
            for (let index = 0; index < count; index++) {
                this.renderItemFn({
                    getComponent: () => ({
                        render(...args: unknown[]) {
                            poolRenders.push((args[0] as Card).id);
                            poolCalls.push(args);
                        },
                    }),
                }, index);
            }
        },
    };
    class Component {
        isValid = true;
        schedule(callback: () => void) { scheduled.add(callback); }
        scheduleOnce(callback: () => void) { scheduledOnce.add(callback); }
        unschedule(callback: () => void) { scheduled.delete(callback); scheduledOnce.delete(callback); }
    }
    const moduleExports: Record<string, unknown> = {};
    const dependencies: Record<string, unknown> = {
        cc: { Component, _decorator: { ccclass: () => (target: unknown) => target, property: () => () => {} } },
        './CardArtProvider': { cardArtProvider: {
            loadLineupSlot: loadArt, loadLineupCard: loadCardArt, loadTallyFrames: async () => null,
        } },
        './CardRepository': { cardRepository: { loadUpgradeStatus } },
        './CardLineupEvents': { CardLineupUiEvent },
        './CardUnitPreviewAssets': { CardUnitPreviewAssets: previewAssetsOverride ?? CardUnitPreviewAssets },
        './CardLineupTypes': { visibleIconTallies: () => [], activeBondTitle: () => '', bondPercentTotal: () => 0,
            sortLineupCards, visibleLineupCards },
        '../../framework/event/EventMgr': { EventMgr: { instance: { offTarget() {}, emit(_event: string, payload: { kind?: string; card?: Card }) {
            if (payload.kind === 'upgrade' && payload.card) upgrades.push(payload.card.id);
        } } } },
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
        arenaSlotCache: Array.from({ length: 8 }, (_, index) => ({
            node: { active: false },
            render(value: Card) { renders.push(value.id); },
            setEmpty() {},
            applyStaticArt(frames: unknown) { staticArt.push({ index, frames }); },
            applyPreview(prefab: unknown) { previews.push(prefab); },
        })),
        iconList: { refreshList() {} },
        cardGrid,
        bondTitleLabel: { string: '' },
        bondValueLabel: { string: '' },
    });
    const present = (deck: Card[], catalog: Card[] = [], heroLevels = new Map<string, number>()) => page.presentLineup({
        deck, catalog, heroListKnown: true, heroLevels, bonuses: {}, art: cardArtConfig,
    });
    const flush = () => { for (const callback of scheduled) callback(); };
    const startModels = () => {
        for (const callback of Array.from(scheduledOnce)) { scheduledOnce.delete(callback); callback(); }
    };
    return { page, present, flush, startModels, renders, previews, staticArt, scheduled, scheduledOnce,
        poolRenders, poolCalls, refreshCalls: () => refreshCalls, cardGrid, upgrades };
}

test('真实页面在备图前排除金矿，碎片加载完成后按状态排序并能清空纯金矿卡库', async () => {
    const requested: string[] = [];
    const f = fixture(async () => ({}), async () => ({}), undefined, async id => {
        requested.push(id);
        return { requirements: [{ key: 'card', owned: id === 'unlocking' ? 1 : 0, need: 10 }], maxed: false, configured: true };
    });
    const mine = { ...card('mine'), type: ZCCardType.Mine };
    const deployed = card('deployed');
    const deck = [mine, deployed];
    const catalog = [card('missing'), card('unlocking'), card('unlocked'), mine, deployed];
    await f.present(deck, catalog, new Map([['deployed', 1], ['unlocked', 1]]));
    assert.deepEqual(f.renders, ['deployed']);
    assert.deepEqual(f.poolRenders, ['deployed', 'unlocked', 'unlocking', 'missing']);
    f.cardGrid.onItemClickFn({}, 0);
    f.cardGrid.onItemClickFn({}, 2);
    assert.deepEqual(f.upgrades, ['deployed', 'unlocking'], '点击应命中排序后对应的卡');
    assert.equal(requested.includes('mine'), false);
    assert.equal(deck.length, 2, '展示过滤不得改变实际阵型');
    await f.present([mine], [mine]);
    assert.deepEqual(f.poolRenders, [], '过滤后为空的权威卡库也必须清掉旧列表');
});

test('站台图未到也先提交首屏，模型仍延后一帧启动，图到达后只补静态图', async () => {
    const art = deferred<object>();
    const model = deferred<object>();
    const requests: string[] = [];
    const f = fixture(path => { requests.push(path); return model.promise; }, () => art.promise);
    let committed = false;
    const rendering = f.present([card('a')]).then(() => { committed = true; });
    await settle();
    assert.equal(committed, true, '冷启动 8 张站台图没到也要先提交首屏，不能等那 26ms');
    assert.deepEqual(f.renders, ['a'], '空台 + 等级牌先上屏');
    assert.deepEqual(f.staticArt, [], '图没到时不能补图');
    assert.deepEqual(requests, [], '静态提交当帧仍不启动模型加载');
    assert.equal(f.scheduled.size, 0);

    const frames = { disc: 'disc', hero: 'hero', badge: 'badge' };
    art.resolve(frames);
    await settle();
    assert.deepEqual(f.staticArt, [{ index: 0, frames }], '图到了补到对应站台，不动等级牌');

    f.startModels();
    assert.deepEqual(requests, ['skel/a']);
    const prefab = { name: 'a' };
    model.resolve(prefab);
    await rendering;
    await settle();
    assert.equal(f.scheduled.size, 1);
    f.flush();
    assert.deepEqual(f.previews, [prefab]);
    assert.equal(f.scheduled.size, 0);
});

test('快照站台图迟到时，不得盖到权威阵容的站台上', async () => {
    const oldArt = deferred<object>();
    const f = fixture(async () => ({}), (value: Card) => value.id === 'old' ? oldArt.promise : Promise.resolve({}));
    void f.present([card('old')]);
    await settle();
    void f.present([card('new')]);
    await settle();
    assert.deepEqual(f.renders, ['old', 'new'], '两轮站台都照常提交');
    assert.equal(f.staticArt.length, 1, '新阵容的图后台补上');
    assert.equal(f.staticArt[0].index, 0, '补的是当前阵容所在的站台');

    oldArt.resolve({ disc: 'old' });
    await settle();
    assert.equal(f.staticArt.length, 1, '旧阵容的迟到图必须被 revision 门闩挡下');
});

test('卡库图未就绪也先提交列表；数据未变跳过重绘，数据变了才重绘且同步命中图', async () => {
    const cardArt = deferred<unknown>();
    const loaded: string[] = [];
    // 站台图（loadArt）当场就给，只有卡库图悬着 —— 首屏因此不该被卡库拖住。
    const f = fixture(async () => ({}), async () => ({}), undefined, undefined, (value) => {
        loaded.push(value.id);
        return cardArt.promise;
    });
    await f.present([card('a')], [card('a'), card('b')]);

    assert.deepEqual(f.poolRenders, ['a', 'b'], '卡库图没到也必须先把列表提交出来');
    assert.ok(f.poolCalls.every(args => args[1] === null),
        '图未到的条目要用空占位，不能留着上一张卡的面（虚拟列表槽位复用）');
    assert.equal(typeof f.poolCalls[0][5], 'function', '条目要拿到自取图的 loader');

    const frames = { face: { id: 'face' }, hero: { id: 'hero' }, badge: { id: 'badge' } };
    cardArt.resolve(frames);
    const loader = f.poolCalls[0][5] as (value: Card) => Promise<unknown>;
    await loader(card('a'));
    await loader(card('a'));
    assert.deepEqual(loaded, ['a'], '同 id 的图只取一次（第二次走页面缓存）');

    // 同样的数据再提交一次：`refreshList` 会强制重画所有可见槽位，白跑一趟必须跳过。
    const before = f.refreshCalls();
    await f.present([card('a')], [card('a'), card('b')]);
    assert.equal(f.refreshCalls(), before, '数据指纹未变时不得再调 refreshList');

    // 等级变了 ⇒ 指纹变 ⇒ 必须重绘；此时图已在缓存，条目同步拿得到，不会再空一帧。
    await f.present([card('a')], [card('a'), card('b')], new Map([['a', 2]]));
    assert.equal(f.refreshCalls(), before + 1, '数据变了必须重建列表');
    assert.deepEqual(f.poolCalls[0][1], frames, '已加载过的卡牌图要同步命中');
});

test('卡库条目迟到图不能贴到复用了槽位的另一张卡上，且相同输入不重复重绘', async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    const painted: Array<unknown> = [];
    const moduleExports: Record<string, unknown> = {};
    class Component { isValid = true; }
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardLineupCard.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, {
        exports: moduleExports,
        require: (id: string) => id === 'cc'
            ? { Component, _decorator: { ccclass: () => (target: unknown) => target, property: () => () => {} } }
            : id === './CardHeroView'
                ? { applyCardHeroArt: (_hero: unknown, _t: unknown, frame: unknown) => { painted.push(frame); } }
                : { CARD_LINEUP_TEXTS: { onField: '出战中', upgradeMaxed: '已满级', progressSeparator: '/' } },
        console: { log() {}, warn() {} },
    });
    const View = moduleExports.CardLineupCard as new () => Record<string, any>;
    const view = new View();
    Object.assign(view, {
        face: { spriteFrame: 'stale' },
        badge: { spriteFrame: 'stale' },
        hero: {},
        heroTransform: {},
        levelPlate: { active: true },
        levelLabel: { string: '' },
        onField: { active: true },
        onFieldLabel: { string: '' },
        progressBar: { progress: 0 },
        cardFragmentLabel: { string: '' },
    });

    // 槽位先画卡 A，A 的图还悬着；列表复用它画卡 B。
    view.render(card('a'), null, false, 1, undefined, () => first.promise);
    assert.equal(view.face.spriteFrame, null, '图没到必须先清空，不能留着上一张的卡面');
    view.render(card('b'), null, false, 1, undefined, () => second.promise);

    first.resolve({ face: 'A', hero: 'A', badge: 'A' });
    await settle();
    assert.equal(view.face.spriteFrame, null, '卡 A 的迟到图不得盖到正在画卡 B 的槽位上');

    second.resolve({ face: 'B', hero: 'B', badge: 'B' });
    await settle();
    assert.equal(view.face.spriteFrame, 'B');
    assert.equal(view.badge.spriteFrame, 'B');
    assert.deepEqual(painted[painted.length - 1], 'B');

    // `refreshList` 会把所有可见槽位同步重画一遍：输入没变时一个属性都不该再写
    // （Sprite/Label/ProgressBar 赋同值也标脏）。短路又不能把 loader 刚补上的图清掉。
    const paintedAfter = painted.length;
    view.render(card('b'), null, false, 1, undefined, () => second.promise);
    assert.equal(painted.length, paintedAfter, '相同输入不得重复标脏');
    assert.equal(view.face.spriteFrame, 'B', '短路后已补上的图要留在槽位上');

    // 池图缓存到位 ⇒ frames 换成另一份对象，必须重画（不能因为指纹相同就吃掉）。
    const ready = { face: 'B2', hero: 'B2', badge: 'B2' };
    view.render(card('b'), ready, false, 1);
    assert.equal(view.face.spriteFrame, 'B2', '图引用变了必须重画');
});

test('权威阵容提交后，快照的迟到模型不能覆盖新阵容', async () => {
    const oldModel = deferred<object>();
    const newModel = deferred<object>();
    const f = fixture(path => path === 'skel/old' ? oldModel.promise : newModel.promise);
    void f.present([card('old')]);
    await settle();
    f.startModels();
    void f.present([card('new')]);
    await settle();
    f.startModels();
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
    f.startModels();
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
    f.startModels();
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
    f.startModels();
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
    f.startModels();
    first.resolve({ name: 'a' });
    await settle();
    assert.equal(f.scheduled.size, 1, '第一轮模型已注册分帧调度');

    // 权威阵容回来：队列清空的同时必须把旧计时器一并作废，否则新模型会被
    // `previewFlushScheduled` 这个「仍为 true」的标志挡住，永远等不到重新注册。
    void f.present([card('b')]);
    await settle();
    assert.equal(f.scheduled.size, 0, '新一轮提交必须解除上一轮的调度');

    f.startModels();
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
        f.startModels();
        await settle();
        await settle();
        assert.deepEqual(f.renders, ['a'], '静态图必须照常提交');
        assert.equal(f.scheduled.size, 0, '失败模型不得启动空调度');
        assert.deepEqual(unhandled, [], 'reject 必须被 commitSlots 兜住，不能泄漏到全局');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('首屏提交后立刻销毁，取消尚未启动的模型加载', async () => {
    const requests: string[] = [];
    const f = fixture(async path => { requests.push(path); return {}; });
    await f.present([card('a')]);
    f.page.isValid = false;
    f.page.onDestroy();
    f.startModels();
    await settle();
    assert.deepEqual(requests, []);
    assert.deepEqual(f.previews, []);
});

test('权威阵容开始备图时，取消快照尚未启动的模型加载', async () => {
    const requests: string[] = [];
    const art = deferred<object>();
    let latest = false;
    const f = fixture(async path => { requests.push(path); return {}; }, () => latest ? art.promise : Promise.resolve({}));
    await f.present([card('old')]);
    latest = true;
    const rendering = f.present([card('new')]);
    f.startModels();
    assert.deepEqual(requests, [], '权威静态图加载期间，旧快照不能再启动模型');
    art.resolve({});
    await rendering;
    f.startModels();
    assert.deepEqual(requests, ['skel/new']);
});
