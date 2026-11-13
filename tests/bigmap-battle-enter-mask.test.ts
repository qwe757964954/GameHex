import { bigMapViewStateFixture } from './helpers/bigmap-view-state-fixture';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import * as mvcEvents from '../assets/script/app/bigmap/application/BigMapEvents';
/**
 * 开战到进战斗之间的「界面交接」回归。
 *
 * ## 被钉住的那个 bug（2026-10-26 用户反馈）
 *
 * 「大地图战斗，会到领地那边再进入游戏」。根因不是战斗参数发错，而是**界面提前关了**：
 *
 * 1. `ProcedureManager.changeProcedure` 是「预加载 → 进入」两阶段，战斗资源没就绪前
 *    `onLeave` / `onEnter` 都不会跑，**当前界面一直不动**；
 * 2. `BigMapEntry.startBattle` 却在 `navigate` 之后立刻 `close()`；
 * 3. 世界页挂 Canvas、不在 Main 节点下，`ProcedureMain.onLeave` 销毁不到它 ⇒ 必须自己关，
 *    但关早了露出来的就是主界面的 `currentTab`，而 `defaultTab = MainTab.Territory`。
 *
 * 所以这条链要同时满足两件事：**世界页留到流程真正切走**（`onSwitchSettled`），
 * 期间盖遮罩锁住输入；预加载失败时遮罩要能撤掉，让玩家重试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';
import { readSource } from './helpers/source-text';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as BigMapPresentationText from '../assets/script/app/bigmap/view/BigMapPresentationText';

/**
 * 装载 `ProcedureManager` 并记录「桩表没命中」的模块。
 *
 * 原来这里是内联的 `runInNewContext` + `return {}` 兜底：桩漏了不会报错，只会静默拿到
 * 空对象。改成 `loadTsModule` 后兜底行为不变，但 `unresolved` 把漏桩变成可断言的清单。
 */
function loadManager(): {
    Manager: new () => {
        registerRoute(route: string, type: unknown): { className: string };
        navigate(route: string, params?: unknown): void;
        subscribeSwitchSettled(listener: (entered: boolean) => void): () => void;
        onLoad(): void;
    };
    unresolved: string[];
} {
    const loaded = loadTsModule<{ ProcedureManager: new () => any }>(
        'assets/script/framework/procedure/ProcedureManager.ts',
        {
            modules: {
                cc: ccStub(),
                '/EventMgr': { EventMgr },
                '/BigMapEvents': mvcEvents,
                '/ResourceScope': { ResourceScope },
                '/UpdateBeat': { UpdateBeat: { loop: () => undefined } },
            },
        },
    );
    return { Manager: loaded.exports.ProcedureManager, unresolved: loaded.unresolved };
}

function loadManagerClass() {
    return loadManager().Manager;
}

test('沙箱桩表完整：`ProcedureManager` 的依赖一个都不缺', () => {
    // `ProcedureBase` 只被当类型用（转译时擦除），所以不会出现在 unresolved 里；
    // 出现任何 id 都意味着真有一条依赖在空转 → 用例可能只测了一半。
    assert.deepEqual(loadManager().unresolved, [], '桩表漏了模块会静默拿到 {}，用例开始测空气');
});

function fakeProcedure(preload: () => Promise<void>): new () => object {
    return class {
        static __cname = 'Fake';
        readonly className = 'Fake';
        onInit(): void { /* 桩 */ }
        onEnter(): void { /* 桩 */ }
        onLeave(): void { /* 桩 */ }
        destroy(): void { /* 桩 */ }
        _adoptResourceScope(): void { /* 桩：流程管理器切换成功后移交资源作用域 */ }
        onPreload = preload;
    };
}

const settle = async (): Promise<void> => { await new Promise((resolve) => setImmediate(resolve)); };

test('流程切换落定：成功进战回调 true，且排在 onLeave 之前', async () => {
    const events: string[] = [];
    const Manager = loadManagerClass();
    const manager = new Manager();
    manager.onLoad();
    const make = (tag: string) => class {
        static __cname = tag;
        readonly className = tag;
        onInit(): void { /* 桩 */ }
        onEnter(): void { events.push(`${tag}:enter`); }
        onLeave(): void { events.push(`${tag}:leave`); }
        destroy(): void { /* 桩 */ }
        _adoptResourceScope(): void { /* 桩 */ }
        async onPreload(): Promise<void> { events.push(`${tag}:preload`); }
    };
    manager.registerRoute('first', make('first'));
    manager.registerRoute('second', make('second'));
    manager.subscribeSwitchSettled((entered) => events.push(`settled:${entered}`));
    manager.navigate('first');
    await settle();
    manager.navigate('second');
    await settle();
    // 第二次切换才有 `onLeave`：落定回调必须排在它**前面** ——
    // 覆盖页关闭时会回调宿主刷底栏，那时宿主还不能被销毁。
    assert.deepEqual(events, [
        'first:preload', 'settled:true', 'first:enter',
        'second:preload', 'settled:true', 'first:leave', 'second:enter',
    ]);
});

test('流程切换落定：预加载失败回调 false，界面留在原地', async () => {
    const entered: boolean[] = [];
    const Manager = loadManagerClass();
    const manager = new Manager();
    manager.onLoad();
    manager.registerRoute('battle', fakeProcedure(async () => { throw new Error('资源缺失'); }));
    manager.subscribeSwitchSettled((value) => entered.push(value));
    manager.navigate('battle');
    await settle();
    assert.deepEqual(entered, [false]);
});

test('流程切换落定：被新的切换顶掉回调 false，新的那次再回调 true', async () => {
    const entered: boolean[] = [];
    const Manager = loadManagerClass();
    const manager = new Manager();
    manager.onLoad();
    manager.registerRoute('slow', fakeProcedure(() => new Promise((resolve) => setTimeout(resolve, 5))));
    manager.registerRoute('fast', fakeProcedure(async () => undefined));
    manager.subscribeSwitchSettled((value) => entered.push(value));
    manager.navigate('slow');
    manager.navigate('fast');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 旧的那次被取消 → false；新的那次成功 → true。顺序即发生顺序。
    assert.deepEqual(entered, [false, true]);
});

/**
 * `BigMapPage` 依赖远多于本用例真正走到的分支，桩表只覆盖被触达的那几个。
 * 这里**故意不断言 `unresolved` 为空** —— 它非空是事实（页面大部分逻辑不在本用例射程内），
 * 断成空只会逼着往下补一堆用不上的桩。需要的分支跑起来时再补桩。
 */
function loadPageClass(): new () => Record<string, unknown> {
    const { exports } = loadTsModule<{ BigMapPage: new () => Record<string, unknown> }>(
        'assets/script/app/bigmap/view/BigMapPage.ts',
        {
            modules: {
                cc: ccStub(),
                '/EventMgr': { EventMgr },
                '/BigMapEvents': mvcEvents,
                '/ResourceScope': { ResourceScope },
                '/BigMapPresentationText': BigMapPresentationText,
            },
        },
    );
    return exports.BigMapPage;
}

function pageFixture() {
    const page = new (loadPageClass())() as any;
    const taps: number[] = [];
    page.layout = { node: { children: [] }, renderPlotCard: () => {} };
    page.node = { children: new Array(3).fill(null) };
    page.worldView = { occupantAt: (hexId: number) => { taps.push(hexId); return { kind: 'empty' }; } };
    page.data = bigMapViewStateFixture();
    page.ready = true;
    page.applyMode = () => {};
    page.setBuildMenuVisible = () => {};
    page.refreshAll = () => {};
    EventMgr.instance.on(mvcEvents.BigMapUiEvent.Intent, (event: mvcEvents.IBigMapIntentEvent) => { if (event.intent.kind === 'worldTap') taps.push(event.intent.hexId); }, page);
    page.baseView = { select: () => undefined, setPendingBuilding: () => undefined };
    page.buildPanel = { active: false };
    page.feedback = () => undefined;
    page.refreshInfo = () => undefined;
    page.clearSelection = () => undefined;
    return { page, taps };
}

test('开战成功后锁输入，预加载失败后允许重新点击', () => {
    const { page, taps } = pageFixture();
    page.render({ ...page.data, ui: { ...page.data?.ui, enteringBattle: true } });
    page.onWorldTap(42);
    page.onPlotTap(42);
    assert.deepEqual(taps, [], '遮罩期间不该再走选中/开战');
    // 预加载失败时撤掉，玩家可以重新点。
    page.render({ ...page.data, ui: { ...page.data?.ui, enteringBattle: false } });
    page.onWorldTap(42);
    assert.deepEqual(taps, [42]);
    EventMgr.instance.offTarget(page);
});

test('开战入口不再立刻关世界页：源码上必须走落定钩子', () => {
    const source = readSource('assets/script/app/bigmap/application/BigMapEntry.ts');
    assert.match(source, /ProcedureManager\.onSwitchSettled\(/, '开战后必须订阅流程落定');
    const navigateAt = source.indexOf('ProcedureManager.navigate(GameRoute.Battle');
    assert.ok(navigateAt > 0);
    const afterNavigate = source.slice(navigateAt);
    const tail = afterNavigate.slice(0, afterNavigate.indexOf("return { ok: true, message: '' };"));
    assert.doesNotMatch(tail, /this\.close\(\)/, 'navigate 之后不能再无条件 close —— 会露出领地主界面');
});


test('移除独立入战遮罩，等待期间关闭两类详情弹窗', () => {
    const source = readSource('assets/script/app/bigmap/view/BigMapPage.ts');
    const prefab = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8'));
    assert.equal(prefab.some((item: any) => item._name === 'EnteringBattleMask'), false);
    assert.doesNotMatch(source, /enterMask/);
    const refresh = source.slice(source.indexOf('private refreshInfo('), source.indexOf('private showCityPopup'));
    assert.match(refresh, /this.enteringBattle/);
    assert.match(refresh, /this.closeInfoPopup\(\)/);
    assert.match(refresh, /this.closeCityPopup\(\)/);
});

test('等待时隐藏详情，取消后重新渲染选中目标且恢复模态', () => {
    const Page = loadPageClass();
    const page = new Page() as any;
    let visible = true, refreshed = 0;
    page.closeInfoPopup = () => { visible = false; };
    page.closeCityPopup = () => {};
    page.refreshInfoContent = () => { visible = true; refreshed++; };
    page.layout = { node: { children: [] }, renderPlotCard: () => {} };
    page.node = { children: [] };
    page.data = bigMapViewStateFixture();
    page.applyMode = () => {};
    page.setBuildMenuVisible = () => {};
    page.refreshAll = () => page.refreshInfo(page.data);
    page.render({ ...page.data, ui: { ...page.data?.ui, enteringBattle: true } }); page.refreshInfo(page.data);
    assert.equal(visible, false); assert.equal(refreshed, 0);
    page.render({ ...page.data, ui: { ...page.data?.ui, enteringBattle: false } });
    assert.equal(visible, true); assert.equal(refreshed, 1);
});
