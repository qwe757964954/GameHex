import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { toIdString } from '../assets/script/app/net/RequestGuard';
import { BIGMAP_BATTLE_TEXT } from '../assets/script/app/bigmap/model/BigMapBattle';

test('加载配置期间切走页面，取消的世界入口不能稍后弹出覆盖新页', async () => {
    let finishConfig: (config: object) => void = () => undefined;
    const config = new Promise<object>((resolve) => { finishConfig = resolve; });
    let canvasLookups = 0;
    const source = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, console: { warn: () => undefined },
        require: (name: string) => {
            if (name === 'cc') return { director: { getScene: () => { canvasLookups += 1; return null; } } };
            if (name === './BigMapConfigLoader') return { loadBigMapConfig: () => config };
            if (name.endsWith('/MainRoleRow')) return { readRoleRow: () => null };
            return {};
        },
    });
    const Entry = exports.BigMapEntry as new () => { open(config: object): Promise<void>; close(): void };
    const entry = new Entry();
    const opening = entry.open({});
    entry.close();
    finishConfig({});
    await opening;
    assert.equal(canvasLookups, 0);
});

function createOwnerHarness(config: Promise<object> = Promise.resolve({}), layout: Promise<null> = Promise.resolve(null)) {
    let role = { id: '9007199254740993', selectServerId: '1' };
    const owners: unknown[] = [];
    const chapterOwners: unknown[] = [];
    const nodes: FakeNode[] = [];
    const presenters: FakePresenter[] = [];
    const battles: { type: number; params: readonly string[]; isCurrent: () => boolean }[] = [];
    const preloads: { assets: unknown; battle: unknown }[] = [];
    const routes: { route: string; params: Record<string, unknown> }[] = [];
    const settledListeners: ((entered: boolean) => void)[] = [];
    // 冒险章节集合：默认「服务端还没回包」（`current = null`），用例可以 `setChapters` 注入。
    let chapterSnapshot: { idleTime: number; chapters: readonly number[] } | null = null;
    let chapterRequests = 0;
    let manualChapterRefresh = false;
    let chapterRefreshWaiters: (() => void)[] = [];
    const chapterRepo = {
        get current(): { idleTime: number; chapters: readonly number[] } | null { return chapterSnapshot; },
        get availableChapters(): readonly number[] {
            return chapterSnapshot && chapterSnapshot.chapters.length > 0 ? chapterSnapshot.chapters : [1];
        },
        refresh(): Promise<void> {
            chapterRequests += 1;
            if (!manualChapterRefresh) return Promise.resolve();
            return new Promise<void>((resolve) => { chapterRefreshWaiters.push(resolve); });
        },
    };
    let finishBattle: (value: unknown) => void = () => {};
    let finishPage: (() => void) | null = null;
    let pageWait: Promise<void> | null = null;
    let slgWait: Promise<boolean> = Promise.resolve(true);
    let finishSlg: (value: boolean) => void = () => {};
    let slgRequests = 0;
    class Transform { setContentSize(): void {} }
    class Widget {}
    const detailCallbacks: ((open: boolean) => void)[] = [];
    const cancelledEnters: number[] = [];
    class Page {
        async initialize(...args: unknown[]) {
            if (typeof args[6] === 'function') detailCallbacks.push(args[6] as (open: boolean) => void);
            if (pageWait) await pageWait;
        }
        cancelEnteringBattle(): void { cancelledEnters.push(1); }
    }
    class FakeNode {
        isValid = true;
        active = true;
        layer = 0;
        constructor(public name: string) { nodes.push(this); }
        addComponent(type: unknown) { return type === Transform ? new Transform() : type === Widget ? new Widget() : new Page(); }
        setParent(): void {}
        // 世界页会按 `Popup` 名字找常驻弹窗节点再插到它之前；这个 harness 不维护子节点，
        // 给 null 即可（层级顺序由 `bigmap-page-readiness` 那条用例钉）。
        getChildByName(): null { return null; }
        getSiblingIndex(): number { return 0; }
        setSiblingIndex(): void {}
        destroy() { this.isValid = false; }
    }
    let unlockRefreshes = 0;
    class FakePresenter {
        constructor(public deps: { adventureChapter(): number;
            startBattle(type: number, id: number, isCurrent: () => boolean): Promise<{ ok: boolean }> }) { presenters.push(this); }
        initializeSlg(): Promise<boolean> { slgRequests += 1; return slgWait; }
        refreshUnlockContext(): void { unlockRefreshes += 1; }
        dispose(): void {}
    }
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console: { warn() {} }, require(name: string) {
        if (name === 'cc') return { Node: FakeNode, UITransform: Transform, Widget,
            Layers: { Enum: { UI_2D: 33554432 } }, view: { getVisibleSize: () => ({ width: 720, height: 1280 }) },
            director: { getScene: () => ({ getChildByName: () => ({ getChildByName: () => null }) }) } };
        if (name.endsWith('/ZCBattlePreparation')) return { createZCBattlePreload: (assets: unknown, _configs: unknown, battle: unknown) => { const preload = { assets, battle }; preloads.push(preload); return preload; } };
        if (name.endsWith('/MainRoleRow')) return { readRoleRow: () => role };
        // 背包读取链（ItemBag → CacheMgr → … → cc）在沙箱里不打桩会直接 require 'cc' 失败。
        if (name.endsWith('/ItemBag')) return { readItemCounts: () => new Map<string, number>() };
        if (name.endsWith('/RequestGuard')) return { toIdString };
        if (name.endsWith('/BigMapBattle')) return { BIGMAP_BATTLE_TEXT };
        if (name.endsWith('/BattleStartService')) return { startBattle: (type: number, params: readonly string[], _caller: unknown, isCurrent: () => boolean) => {
            battles.push({ type, params, isCurrent });
            return new Promise((resolve) => { finishBattle = resolve; });
        } };
        if (name.endsWith('/GameRoute')) return { GameRoute: { Battle: 'battle' } };
        if (name.endsWith('/ProcedureManager')) return { ProcedureManager: {
            navigate: (route: string, params: Record<string, unknown>) => { routes.push({ route, params }); },
            onSwitchSettled: (listener: (entered: boolean) => void) => {
                settledListeners.push(listener);
                return () => {
                    const index = settledListeners.indexOf(listener);
                    if (index >= 0) settledListeners.splice(index, 1);
                };
            },
        } };
        if (name === './BigMapConfigLoader') return { loadBigMapConfig: () => config };
        if (name === './BigMapLayoutLoader') return { loadBigMapLayout: () => layout };
        if (name === './BigMapStorage') return { createBigMapStorage: (owner: unknown) => { owners.push(owner); return {}; } };
        if (name === './BigMapPresenter') return { BigMapPresenter: FakePresenter };
        if (name.endsWith('/BigMapPage')) return { BigMapPage: Page };
        if (name === './NpcBigMapRankProvider') return { NpcBigMapRankProvider: class {} };
        if (name === './BigMapCampRepository') return { BigMapCampRepository: class {} };
        if (name === './GameNetBigMapCampGateway') return { GameNetBigMapCampGateway: class {} };
        if (name === './BigMapSlgRepository') return { BigMapSlgRepository: class {} };
        if (name === './GameNetBigMapSlgGateway') return { GameNetBigMapSlgGateway: class {} };
        if (name.endsWith('/TerritoryChapterInfoRepository')) return { TerritoryChapterInfoRepository: { instance: chapterRepo } };
        if (name.endsWith('/TerritorySaveStoreAdapter')) return { createTerritorySaveStore: (owner: unknown) => {
            chapterOwners.push(owner); return { loadLastChapter: () => 1 };
        } };
        return {};
    } });
    const Entry = exports.BigMapEntry as new () => {
        open(configs: object): Promise<void>; close(): void; isOpen: boolean; setAssetService(assets: object): void; setSessionAssetService(service: object): void;
    };
    const entry = new Entry();
    return { entry, owners, chapterOwners, presenters, nodes, battles, routes, preloads, detailCallbacks,
        cancelledEnters,
        setChapters(chapters: readonly number[] | null) {
            chapterSnapshot = chapters ? { idleTime: 0, chapters: [...chapters] } : null;
        },
        holdChaptersRefresh() { manualChapterRefresh = true; },
        finishChaptersRefresh() {
            const waiters = chapterRefreshWaiters;
            chapterRefreshWaiters = [];
            for (const resolve of waiters) resolve();
        },
        chapterRequests: () => chapterRequests,
        unlockRefreshes: () => unlockRefreshes,
        settleSwitch(entered: boolean) { for (const listener of [...settledListeners]) listener(entered); },
        finishBattle: (value: unknown) => finishBattle(value),
        switchRole(id: string, serverId = '1') { role = { id, selectServerId: serverId }; },
        waitPage() { pageWait = new Promise<void>((resolve) => { finishPage = resolve; }); },
        finishPage() { finishPage?.(); pageWait = null; },
        waitSlg() { slgWait = new Promise((resolve) => { finishSlg = resolve; }); },
        finishSlg() { finishSlg(true); },
        slgRequests: () => slgRequests,
    };
}

test('SLG 同步与页面准备并行，缺少服务端回包不阻塞世界显示或再次进入', async () => {
    const h = createOwnerHarness();
    for (let attempt = 0; attempt < 2; attempt += 1) {
        h.waitPage();
        h.waitSlg();
        let finished = false;
        const opening = h.entry.open({}).then(() => { finished = true; });
        await new Promise((resolve) => setImmediate(resolve));
        try {
            assert.equal(h.slgRequests(), attempt + 1, '资源未就绪时已经启动数据同步');
            h.finishPage();
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(finished, true, '显示地图不等待 SLG 回包或超时');
            assert.equal(h.nodes[h.nodes.length - 1]?.active, true);
            h.entry.close();
            assert.equal(h.nodes[h.nodes.length - 1]?.isValid, false);
        } finally {
            h.finishPage();
            h.finishSlg();
            await opening;
            h.entry.close();
        }
    }
});

test('入口把精确角色与区服交给存储，冒险章节使用同一份身份快照', async () => {
    const h = createOwnerHarness();
    await h.entry.open({});
    assert.equal(JSON.stringify(h.owners[0]), JSON.stringify({ roleId: '9007199254740993', serverId: '1' }));
    h.switchRole('B', '2');
    h.presenters[0].deps.adventureChapter();
    assert.equal(JSON.stringify(h.chapterOwners[0]), JSON.stringify({ roleId: '9007199254740993', serverId: '1' }));
    await h.entry.open({});
    assert.equal(h.nodes[0].isValid, false, '换号重开时关闭旧角色页面');
    assert.equal(JSON.stringify(h.owners[1]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    h.entry.close();
});

test('世界入口把城池配置 ID 字符串交给现有服务，成功后进入战斗，流程落定才关闭覆盖页', async () => {
    const h = createOwnerHarness();
    await h.entry.open({});
    const result = h.presenters[0].deps.startBattle(1004, 205, () => true);
    assert.equal(h.battles[0].type, 1004);
    assert.equal(h.battles[0].params[0], '205');
    assert.equal(h.routes.length, 0, '开战成功前不导航');
    const battle = { battleId: 'server-1', units: [], seed: '123' };
    h.finishBattle(battle);
    await result;
    assert.equal(h.routes[0].route, 'battle');
    assert.equal(h.routes[0].params.battle, battle);
    assert.equal(h.routes[0].params.slgBattleType, 1004);
    assert.equal(h.routes[0].params.selfRoleId, '9007199254740993');
    // 🔴 不能在这里就关：`navigate` 只是开始预加载，关早了露出来的是主界面的领地 tab
    // （「点攻打先跑回领地再进战斗」，2026-10-26 用户反馈）。
    assert.equal(h.entry.isOpen, true, '战斗预加载期间世界页必须留着');
    h.settleSwitch(true);
    assert.equal(h.entry.isOpen, false, '流程真正切走后才关覆盖页');
});

test('战斗预加载失败时世界页保留，并撤掉「正在进入」遮罩让玩家重试', async () => {
    const h = createOwnerHarness();
    await h.entry.open({});
    const attacking = h.presenters[0].deps.startBattle(1003, 8013, () => true);
    h.finishBattle({ battleId: 'server-2', units: [], seed: '1' });
    assert.equal((await attacking).ok, true);
    assert.equal(h.routes.length, 1);
    h.settleSwitch(false);
    assert.equal(h.entry.isOpen, true, '没进战斗就不该关页面');
    assert.equal(h.cancelledEnters.length, 1, '遮罩要撤掉，否则玩家卡死在「正在进入」');
    h.entry.close();
});

test('SLG 开战失败或等待期间关页/换服，旧回包不能导航或影响新角色', async () => {
    for (const interrupt of ['failed', 'close', 'switch'] as const) {
        const h = createOwnerHarness();
        await h.entry.open({});
        const result = h.presenters[0].deps.startBattle(1004, 205, () => true);
        if (interrupt === 'close') h.entry.close();
        if (interrupt === 'switch') h.switchRole('B', '2');
        if (interrupt !== 'failed') assert.equal(h.battles[0].isCurrent(), false);
        h.finishBattle(interrupt === 'failed' ? null : { battleId: 'late' });
        assert.equal((await result).ok, false);
        assert.equal(h.routes.length, 0);
        h.entry.close();
    }
});

test('配置加载期间切号，旧入口不创建页面和存档适配器', async () => {
    let finish: (value: object) => void = () => {};
    const h = createOwnerHarness(new Promise((resolve) => { finish = resolve; }));
    const opening = h.entry.open({});
    h.switchRole('B');
    finish({});
    await opening;
    assert.equal(h.nodes.length, 0);
    assert.equal(h.owners.length, 0);
});

test('页面加载期间切号，旧页面不能在加载完成后显示', async () => {
    const h = createOwnerHarness();
    h.waitPage();
    const opening = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.nodes.length, 1);
    h.switchRole('B');
    h.finishPage();
    await opening;
    assert.equal(h.nodes[0].isValid, false);
    assert.equal(h.entry.isOpen, false);
});

test('旧入口仍在加载时新角色重新打开，旧回调不会取消新入口', async () => {
    let finish: (value: object) => void = () => {};
    const h = createOwnerHarness(new Promise((resolve) => { finish = resolve; }));
    const first = h.entry.open({});
    h.switchRole('B', '2');
    const second = h.entry.open({});
    finish({});
    await Promise.all([first, second]);
    assert.equal(h.owners.length, 1);
    assert.equal(JSON.stringify(h.owners[0]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    assert.equal(h.entry.isOpen, true);
    h.entry.close();
});

test('布局加载期间换服，旧入口不创建页面和存档适配器', async () => {
    let finish: (value: null) => void = () => {};
    const h = createOwnerHarness(Promise.resolve({}), new Promise((resolve) => { finish = resolve; }));
    h.entry.setAssetService({});
    const opening = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    h.switchRole('9007199254740993', '2');
    finish(null);
    await opening;
    assert.equal(h.nodes.length, 0);
    assert.equal(h.owners.length, 0);
});

test('大地图按服务端章节集合的最高章算冒险进度，不受本地「上次所在章节」影响', async () => {
    const h = createOwnerHarness();
    // 用户现场：`ChapterInfo.chapters = [3,2,1]`（归一化后 [1,2,3]），本地从没进过冒险页。
    h.setChapters([3, 2, 1]);
    await h.entry.open({});
    assert.equal(h.presenters[0].deps.adventureChapter(), 3,
        '服务端章节集合才是解锁真源；否则通关了粮食田（第 2 章）还是灰的');
    h.entry.close();
});

test('服务端章节还没回包时退回本地上次所在章节，且不低于第 1 章', async () => {
    const h = createOwnerHarness();
    await h.entry.open({});
    assert.equal(h.presenters[0].deps.adventureChapter(), 1);
    h.entry.close();
});

test('章节集合晚到：回包后补一次刷新，否则建筑要等重进页面才亮', async () => {
    const h = createOwnerHarness();
    h.holdChaptersRefresh();
    await h.entry.open({});
    assert.equal(h.chapterRequests(), 1, '快照为空时入口自己拉一次');
    assert.equal(h.unlockRefreshes(), 0, '回包前不刷新');
    h.setChapters([1, 2, 3]);
    h.finishChaptersRefresh();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.unlockRefreshes(), 1, '回包到达后必须叫一声，让页面重算建造列表');
    assert.equal(h.presenters[0].deps.adventureChapter(), 3);
    h.entry.close();
});

test('旧角色页面初始化期间新角色重开，旧初始化完成不关闭新页', async () => {
    const h = createOwnerHarness();
    h.waitPage();
    const first = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    h.switchRole('B', '2');
    const second = h.entry.open({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.nodes[0].isValid, false);
    h.finishPage();
    await Promise.all([first, second]);
    assert.equal(h.nodes[1].isValid, true);
    assert.equal(h.nodes[1].active, true);
    assert.equal(h.entry.isOpen, true);
    assert.equal(JSON.stringify(h.owners[1]), JSON.stringify({ roleId: 'B', serverId: '2' }));
    h.entry.close();
});


test('世界开页不主动解析战斗资源，预下载由主界面绘制时机统一调度', async () => {
    const h = createOwnerHarness(); let warmed = 0, paused = 0;
    h.entry.setSessionAssetService({ warmupBattle: async () => { warmed++; }, pauseWarmup: () => { paused++; } });
    await h.entry.open({});
    assert.equal(warmed, 0);
    assert.equal(h.detailCallbacks.length, 0);
    h.entry.close(); assert.equal(paused, 1);
});

test('大地图回包后把统一预加载与会话资产一并移交战斗入口', async () => {
    const h = createOwnerHarness(); const sharedAssets = {};
    h.entry.setAssetService({}); h.entry.setSessionAssetService({ reusableAssets: sharedAssets, warmupBattle: async () => {} });
    await h.entry.open({});
    const attacking = h.presenters[0].deps.startBattle(1004, 205, () => true);
    const battle = { battleId: 'actual', seed: '1', units: [] };
    h.finishBattle(battle); assert.equal((await attacking).ok, true);
    assert.equal(h.preloads.length, 1); assert.equal(h.preloads[0].assets, sharedAssets);
    assert.equal(await h.preloads[0].battle, battle);
    assert.equal(h.routes[0].params.preload, h.preloads[0]);
});
