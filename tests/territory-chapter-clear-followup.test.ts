/**
 * 「章节首次通关 ⇒ 先播章节通过动画，再播切换动画」的编排回归（2026-11-11）。
 *
 * 用户口径：
 *
 * > 「svn 合并后，章节通关动画丢失了，只有章节切换动画，章节首次通关需要播放章节通过
 * >   动画后，再播放切换」
 *
 * 两段演出原本各有一条独立入口：
 *  · **章节通过动画** = `TerritoryCloudView` 的整章云散（拉远 1.1s → 逐朵淡 2s → 拉回 0.7s），
 *    由 `chapterClearPending` 边沿起演；
 *  · **章节切换动画** = `TerritoryChapterSwitch` 的 lead / cover / wait / reveal，由模型
 *    `chapterSwitch` 命令起演（旧口径：只有玩家点章节按钮才发）。
 *
 * 合并后第一条边沿可能被冲掉、且首通自动推进**没有**切换动画 ⇒ 本用例把页面里那条
 * 「首通边沿 → 压住换图 → 云散演完 → 起切换 → 云盖满再画新章」的状态机整个跑一遍。
 *
 * ## 为什么要 VM 真跑而不是只 grep 源码
 *
 * 这段时序错一帧就只表现为「动画没了」，零报错：早画一帧新图 = `syncGrid` 把云散 `reset` 掉，
 * 晚起一帧切换 = 通关动画演完直接切图。所以用 `runInNewContext` + `cc` 空壳把页面类实例化，
 * 桩掉 `mapView`，按帧推 `update`，验**事件顺序**与终态。曲线仍用真模块（零 `cc`）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

import * as chapterSwitch from '../assets/script/app/territory/model/TerritoryChapterSwitch';
import * as battleIntro from '../assets/script/app/territory/model/TerritoryBattleIntro';

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const MODEL = 'assets/script/app/territory/application/TerritoryModel.ts';
const CLOUD_VIEW = 'assets/script/app/territory/view/TerritoryCloudView.ts';
const MAP_VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';

function read(path: string): string {
    return readFileSync(path, 'utf8');
}

/** 页面类在 VM 里跑：只把两条真曲线模块与 EventMgr 接上，其余依赖全给空壳。 */
function loadPageClass(): any {
    const code = ts.transpileModule(read(PAGE), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    const empty = new Proxy({}, {
        get: (_target, key) => key === '__esModule' ? false : () => {},
    });
    const cc = new Proxy({}, {
        get: (_target, key) => {
            // `_decorator.ccclass/property` 都退成空装饰器；`Component` 退成空基类。
            if (key === '_decorator') return new Proxy({}, { get: () => () => () => {} });
            return class {};
        },
    });
    const exports: Record<string, any> = {};
    runInNewContext(code, {
        exports,
        console,
        module: { exports },
        require: (name: string) => {
            if (name === 'cc') return cc;
            if (name === '../territory/model/TerritoryChapterSwitch') return chapterSwitch;
            if (name === '../territory/model/TerritoryBattleIntro') return battleIntro;
            if (name === '../../framework/event/EventMgr') {
                return { EventMgr: { instance: { emit() {}, on() {}, offTarget() {} } } };
            }
            return empty;
        },
    });
    return exports.MainTerritoryMap;
}

let pageClassCache: any = null;
function PageClass(): any {
    if (!pageClassCache) pageClassCache = loadPageClass();
    return pageClassCache;
}

interface IHarness {
    page: any;
    mapView: any;
    /** 依次记下「画了哪一章 / 起转场 / 收转场」。 */
    log: string[];
    /** 最近一次 `renderMap` 的入参。 */
    renders: any[];
    state(chapterId: number, chapterCleared: boolean, chapterClearPending: boolean): any;
    setState(state: any): void;
    frame(dt?: number): void;
}

function harness(switchBuildable = true): IHarness {
    const page = new (PageClass())();
    const log: string[] = [];
    const renders: any[] = [];
    page.isValid = true;
    const mapView: any = {
        isValid: true,
        chapterClearPlaying: false,
        renderMap(input: any) {
            renders.push(input);
            log.push(`draw:${input.chapterCleared ? 'cleared' : 'playing'}:${String(input.chapterClearPending)}`);
        },
        beginChapterSwitch() {
            if (!switchBuildable) return false;
            log.push('switchBegin');
            return true;
        },
        applyChapterSwitchCover() {},
        setChapterSwitchOffset() {},
        stepChapterSwitchCover() {},
        endChapterSwitch() { log.push('switchEnd'); },
    };
    page.mapView = mapView;
    page.scrollToCell = () => {};
    page.renderDetail = () => {};
    page.battleIntroViewport = () => [720, 1280];
    const state = (chapterId: number, chapterCleared: boolean, chapterClearPending: boolean) => ({
        ready: true,
        chapterId,
        chapterCleared,
        chapterClearPending,
        map: {}, layout: {}, art: {}, progress: {},
        revealedCells: [], previewCells: [],
    });
    return {
        page, mapView, log, renders, state,
        setState(value: any) { page.state = value; },
        frame(dt = 0.05) { page.update(dt); },
    };
}

/** 把整条首通链路铺到「新章刚换上、转场刚收工」。 */
function walkFirstClear(h: IHarness): void {
    h.setState(h.state(1, false, false));
    h.page.renderAll();
    h.setState(h.state(1, true, false));   // 故意不给 chapterClearPending（模拟合并把边沿冲掉）
    h.page.renderAll();
    h.setState(h.state(2, false, false));
    h.page.renderAll();
    h.mapView.chapterClearPlaying = true;
    h.frame(0.016);
    h.mapView.chapterClearPlaying = false;
    h.frame(0.016);
}

// ============================================================
// ① 通关动画不许丢：边沿被冲掉还有电平兜底
// ============================================================

test('★★★首通边沿丢了也认：同章 chapterCleared false→true 照样让地图起通关动画', () => {
    const h = harness();
    h.setState(h.state(1, false, false));
    h.page.renderAll();
    assert.equal(h.page.chapterClearFollowup, false, '没通关不许预支编排');

    h.setState(h.state(1, true, false));
    h.page.renderAll();
    assert.equal(h.page.chapterClearFollowup, true, '首通意图必须记下');
    assert.equal(h.renders.at(-1).chapterClearPending, true,
        'mapView 收到的必须是 true —— 否则 setChapterCleared 走 instant，通关动画就没了');
    assert.equal(h.log.at(-1), 'draw:cleared:true');
});

test('★★★切回早已通关的章节不许重演通关动画（旧口径不能破）', () => {
    const h = harness();
    h.setState(h.state(1, false, false));
    h.page.renderAll();
    // 换章进来的第一帧就是 `cleared = true`：这是"切回旧章"，不是"刚打通"。
    h.setState(h.state(5, true, false));
    h.page.renderAll();
    assert.equal(h.page.chapterClearFollowup, false, '换章那一帧的 true 不算首通');
    assert.equal(h.renders.at(-1).chapterClearPending, false,
        '必须走 instant（雾本来就该是散的），不能演一遍散场');
});

test('★★★首通自动推进：换图被压住，直到整章云散演完', () => {
    const h = harness();
    h.setState(h.state(1, false, false));
    h.page.renderAll();
    h.setState(h.state(1, true, false));
    h.page.renderAll();
    const before = h.renders.length;

    h.setState(h.state(2, false, false));
    h.page.renderAll();
    assert.equal(h.renders.length, before, '这一帧不许画新章（syncGrid 会把云散掐掉）');
    assert.equal(h.page.chapterSwapPending, true);
    // 跨 VM realm 的对象不能按原型比，按值拍平（与既有跨 realm 用例同一口径）。
    assert.deepEqual(JSON.parse(JSON.stringify(h.page.chapterClearSwitch)), { from: 1, to: 2 });
    assert.equal(h.page.lastRenderedChapter, 1, '记住的章号不能提前翻到新章');

    h.mapView.chapterClearPlaying = true;
    const beforeFrame = h.log.length;
    h.frame(0.016);
    assert.equal(h.log.length, beforeFrame, '云散还在演 ⇒ 不许起切换、不许换图');
    assert.equal(h.page.chapterSwitch, null);
    assert.equal(h.page.lastRenderedChapter, 1);
});

// ============================================================
// ② 通关动画演完 ⇒ 再播切换动画；新章等云盖满才画
// ============================================================

test('★★★顺序：通关动画 → 切换转场 → 云盖满后画新章 → 揭幕收工', () => {
    const h = harness();
    walkFirstClear(h);

    // 云散演完那一帧：切换转场起手，但新章**仍不许画**。
    assert.ok(h.page.chapterSwitch, '通关动画演完必须起切换转场');
    assert.equal(h.page.chapterSwitch.from, 1);
    assert.equal(h.page.chapterSwitch.to, 2);
    assert.equal(h.page.chapterSwitch.phase, 'lead');
    assert.equal(h.page.chapterSwitch.deferRender, true, '新章已加载完 ⇒ 必须等云盖满再画');
    assert.equal(h.page.lastRenderedChapter, 1, 'lead 段露新图就白演了');

    // 推到 cover 结束（0.1 + 0.32s）：这一帧才补画新章。
    for (let i = 0; i < 20 && h.page.lastRenderedChapter === 1; i += 1) h.frame(0.05);
    assert.equal(h.page.lastRenderedChapter, 2, '云盖满之后必须补画新章');

    const start = h.log.indexOf('switchBegin');
    const drawAt = h.log.findIndex((item, index) => index > start && item.startsWith('draw:'));
    assert.ok(start >= 0, '切换转场必须真的起演');
    assert.ok(drawAt > start, '新章必须画在切换转场**之后**（用户：先通过动画，再播放切换）');
    assert.equal(h.page.chapterSwapPending, false);

    // 推到 reveal 结束：转场收工，状态全部归零。
    for (let i = 0; i < 40 && h.page.chapterSwitch; i += 1) h.frame(0.05);
    assert.equal(h.page.chapterSwitch, null);
    assert.equal(h.page.chapterSwapPending, false, '不许留下永远补不完的 pending');
    assert.ok(h.log.includes('switchEnd'), '收工要真的把云盖层收掉');
});

test('★★★切换转场演不了（云美术没加载）⇒ 直接换章，绝不卡在旧图', () => {
    const h = harness(false);
    h.setState(h.state(1, false, false));
    h.page.renderAll();
    h.setState(h.state(1, true, false));
    h.page.renderAll();
    h.setState(h.state(2, false, false));
    h.page.renderAll();
    h.frame(0.016);   // chapterClearPlaying = false
    assert.equal(h.page.chapterSwitch, null);
    assert.equal(h.page.chapterSwapPending, false);
    assert.equal(h.page.lastRenderedChapter, 2, '降级路径也必须把新章画上来');
});

test('★★★转场中途被打断/超时收掉，压住的新章仍要补画（兜底）', () => {
    const h = harness();
    walkFirstClear(h);
    assert.equal(h.page.chapterSwapPending, true);
    // 模拟 `mapView.endChapterSwitch()` 被外部流程提前收掉。
    h.page.endChapterSwitch();
    h.frame(0.016);
    assert.equal(h.page.chapterSwapPending, false);
    assert.equal(h.page.lastRenderedChapter, 2, '兜底不能让页面永远停在第 1 章');
});

// ============================================================
// ③ 口径与接线守卫
// ============================================================

test('★★★模型仍然只在玩家点章节按钮时发 chapterSwitch：切换动画是页面侧补起的', () => {
    const model = read(MODEL);
    const calls = model.match(/this\.announceChapterSwitch\(/g) ?? [];
    assert.equal(calls.length, 2, '发命令的位置不能变多（switchChapter / selectChapter）');
    const advance = model.slice(model.indexOf('    private advanceCompletedChapter(): void {'));
    assert.ok(!advance.slice(0, advance.indexOf('\n    }')).includes('announceChapterSwitch'),
        '自动推进不发命令；首通后的切换由页面在云散演完那一刻补起同一段转场');
});

test('★★★页面源码：电平边沿兜底 / 压画 / deferRender 三道闸一根都不能少', () => {
    const page = read(PAGE);
    const render = page.slice(page.indexOf('    private renderAll(): void {'));
    const renderBody = render.slice(0, render.indexOf('\n    }\n'));
    assert.match(renderBody, /const firstClearEdge = state\.chapterCleared && !this\.lastRenderedChapterCleared\s*&& !chapterChanged;/);
    assert.match(renderBody, /chapterClearPending: clearSignal,/);
    assert.match(renderBody, /this\.chapterClearSwitch = \{ from: this\.lastRenderedChapter, to: state\.chapterId \};/);
    assert.match(renderBody, /this\.chapterSwitch\.phase === 'lead' \|\| this\.chapterSwitch\.phase === 'cover'/);
    assert.ok(renderBody.indexOf('this.chapterSwapPending = true;') < renderBody.indexOf('this.lastRenderedChapter = state.chapterId;'),
        '压画判定必须排在章号落定之前');

    const update = page.slice(page.indexOf('    update(dt: number): void {'));
    const updateBody = update.slice(0, update.indexOf('\n        const prelude = this.battlePrelude;'));
    assert.match(updateBody, /if \(this\.mapView\?\.chapterClearPlaying\) return;/);
    assert.match(updateBody, /this\.beginChapterSwitch\(followup\.from, followup\.to, true\);/);
    assert.match(updateBody, /running\.phase === 'wait' \|\| running\.phase === 'reveal'/);
    assert.ok(updateBody.indexOf('chapterClearPlaying') < updateBody.indexOf('beginChapterSwitch(followup'),
        '必须先等通关动画演完，才允许起切换');
    assert.ok(updateBody.indexOf('beginChapterSwitch(followup') < updateBody.indexOf('stepChapterSwitch(step)'),
        '转场必须先起手再推进');
});

test('★★★第 2 章云层间隔：地图视图把全量格心喂给挡云遮罩', () => {
    const view = read(MAP_VIEW);
    assert.match(view, /this\.clouds\.setKeepOutPoints\(input\.layout\.points\);/,
        '少了这一句，遮罩只认 cloudCells，预告 footprint 格就描不出 15px 间隔');
    const sync = view.slice(view.indexOf('    private syncClouds('));
    const syncBody = sync.slice(0, sync.indexOf('\n    }\n'));
    const injectAt = syncBody.indexOf('this.clouds.setKeepOutPoints');
    // 注释里也出现过 `setChapterCleared`，必须按调用语句找。
    const clearedAt = syncBody.indexOf('this.clouds.setChapterCleared(');
    assert.ok(injectAt > 0 && injectAt < clearedAt, '格心要在 sync 之前注入');

    const cloud = read(CLOUD_VIEW);
    assert.match(cloud, /private forEachKeepOutCell\(visit: \(cell: ITerritoryCloudCell\) => void\): void \{/);
    const loop = cloud.slice(cloud.indexOf('    private forEachKeepOutCell('));
    const loopBody = loop.slice(0, loop.indexOf('\n    }\n'));
    assert.match(loopBody, /for \(const cellId of this\.keepOutIds\)/,
        '遍历的必须是「已揭示格」全集，不是只有内容的云格');
    assert.match(loopBody, /source\.get\(cellId\)/);
    const rebuild = cloud.slice(cloud.indexOf('    private rebuildKeepOut(): void {'));
    assert.match(rebuild.slice(0, rebuild.indexOf('\n    }\n')), /this\.forEachKeepOutCell\(/);
    const dissolve = cloud.slice(cloud.indexOf('    private syncDissolveKeepOut(): void {'));
    assert.match(dissolve.slice(0, dissolve.indexOf('\n    }\n')), /this\.forEachKeepOutCell\(/,
        '消散层那张「擦邻居」的遮罩也要用同一份格心');
});
