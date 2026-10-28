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
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as BigMapPresentationText from '../assets/script/app/bigmap/view/BigMapPresentationText';

function loadManagerClass(): new () => {
    registerRoute(route: string, type: unknown): { className: string };
    navigate(route: string, params?: unknown): void;
    subscribeSwitchSettled(listener: (entered: boolean) => void): () => void;
    onLoad(): void;
} {
    const source = readFileSync('assets/script/framework/procedure/ProcedureManager.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value, property: () => () => undefined }, Component: class {} };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/UpdateBeat')) return { UpdateBeat: { loop: () => undefined } };
        return {};
    } });
    return exports.ProcedureManager as new () => ReturnType<typeof loadManagerClass> extends never ? never : any;
}

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

function loadPageClass(): new () => Record<string, unknown> {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
    } }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return { _decorator: { ccclass: () => (value: unknown) => value }, Component: class {} };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
        if (name.endsWith('/BigMapPresentationText')) return BigMapPresentationText;
        return {};
    } });
    return exports.BigMapPage as new () => Record<string, unknown>;
}

function pageFixture() {
    const page = new (loadPageClass())() as any;
    const taps: number[] = [];
    page.enterMask = { active: false, setSiblingIndex: () => undefined, isValid: true };
    page.node = { children: new Array(3).fill(null) };
    page.worldView = { occupantAt: (hexId: number) => { taps.push(hexId); return { kind: 'empty' }; } };
    page.presenter = { emit: () => undefined };
    page.baseView = { select: () => undefined, setPendingBuilding: () => undefined };
    page.buildPanel = { active: false };
    page.feedback = () => undefined;
    page.refreshInfo = () => undefined;
    page.clearSelection = () => undefined;
    return { page, taps };
}

test('开战成功后盖遮罩，并拦掉地图点击（避免预加载期间再发请求）', () => {
    const { page, taps } = pageFixture();
    page.showEnteringBattle();
    assert.equal(page.enterMask.active, true);
    page.onWorldTap(42);
    page.onPlotTap(42);
    assert.deepEqual(taps, [], '遮罩期间不该再走选中/开战');
    // 预加载失败时撤掉，玩家可以重新点。
    page.cancelEnteringBattle();
    assert.equal(page.enterMask.active, false);
    page.onWorldTap(42);
    assert.deepEqual(taps, [42]);
});

test('开战入口不再立刻关世界页：源码上必须走落定钩子', () => {
    const source = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    assert.match(source, /ProcedureManager\.onSwitchSettled\(/, '开战后必须订阅流程落定');
    const navigateAt = source.indexOf('ProcedureManager.navigate(GameRoute.Battle');
    assert.ok(navigateAt > 0);
    const afterNavigate = source.slice(navigateAt);
    const tail = afterNavigate.slice(0, afterNavigate.indexOf("return { ok: true, message: '' };"));
    assert.doesNotMatch(tail, /this\.close\(\)/, 'navigate 之后不能再无条件 close —— 会露出领地主界面');
});


test('开战输入层透明，后台更新不能重新盖上详情暗底', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    const build = source.slice(source.indexOf('private buildEnteringBattleMask('), source.indexOf('showEnteringBattle():'));
    assert.ok(!build.includes('addComponent(Graphics)') && !build.includes('drawPanel('));
    assert.ok(build.includes('addComponent(BlockInputEvents)'));
    const refresh = source.slice(source.indexOf('private refreshInfo():'), source.indexOf('private refreshTargetPanel():'));
    assert.match(refresh, /this.enteringBattle/);
    assert.match(refresh, /panel.hide\(\)/);
});


test('等待时隐藏详情，取消后重新渲染选中目标且恢复模态', () => {
    const Page = loadPageClass();
    const page = new Page() as any;
    let visible = true, hidden = 0, refreshed = 0;
    page.setInfoVisible = (value: boolean) => { visible = value; };
    page.targetPanels = new Map([['level', { hide() { hidden++; } }]]);
    page.refreshInfoContent = () => { visible = true; refreshed++; };
    page.applyInfoLayout = () => undefined;
    page.refreshTargetPanel = () => undefined;
    page.enterMask = { active: false, isValid: true, setSiblingIndex() {} };
    page.node = { children: [] };
    page.showEnteringBattle(); page.refreshInfo();
    assert.equal(visible, false); assert.equal(hidden, 2); assert.equal(refreshed, 0);
    page.cancelEnteringBattle();
    assert.equal(visible, true); assert.equal(refreshed, 1); assert.equal(page.enterMask.active, false);
});
