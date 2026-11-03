import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TERRITORY_EVENTS } from '../assets/script/app/territory/view/TerritoryEvents';
import { TerritoryUiEvent } from '../assets/script/app/territory/application/TerritoryEvents';
import { makeStationView, stationEmitLog } from './helpers/territory-station-fixtures';

/**
 * 需求 2026-11-03（两张截图 + 两句话）：
 *
 * 1. *「章节弹窗对应的打开按钮是章节建筑（包括气泡部分」*
 *    ⇒ 地图起始格那颗**章节建筑**、以及它头上那颗「章节」**气泡**，点了都要打开「章节选择」。
 * 2. *「关闭快速寻敌的左右侧的三角形按钮 UI」*
 *    ⇒ 快速寻敌两侧那两颗 `PreviousChapter` / `NextChapter` 三角永久隐藏（它们原来就是章节选择入口）。
 *
 * 这两条是同一件事的两半：**入口从三角搬到地图上的建筑**。所以放在一个文件里，
 * 否则只改一半就会出现「弹窗没有入口」或「两个入口同时存在」。
 */

const MAP_VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const STATION_VIEW_PATH = 'assets/script/app/territory/view/TerritoryStationView.ts';
const MAIN_PAGE_PATH = 'assets/script/app/main/MainPage.ts';

const read = (path: string): string => readFileSync(path, 'utf8');

// ============================================================
// 一、视图：章节建筑 / 气泡点了发「章节入口」事件
// ============================================================

test('★★★起始格内容带 `chapterEntry`，点建筑发 ChapterSelect（不是 STATION_TAP）', () => {
    const { view, root, iconSprite } = makeStationView();
    view.render({
        site: null,
        icon: null,
        caption: '',
        tint: iconSprite.color,
        badge: '',
        chapterEntry: true,
        interactive: true,
    });
    stationEmitLog.length = 0;
    root.emit('click');
    assert.deepEqual(stationEmitLog, [TerritoryUiEvent.ChapterSelect],
        '章节建筑必须发「打开章节选择」；STATION_TAP 那条链要真站点，拿 null 会空转');
    assert.equal(stationEmitLog.includes(TERRITORY_EVENTS.STATION_TAP), false);
});

test('★★★`chapterEntry` 是**每帧**从内容写的（池化复用不能带上一格的身份）', () => {
    const { view, root, iconSprite } = makeStationView();
    const base = { icon: null, caption: '', tint: iconSprite.color, badge: '', interactive: true } as const;
    // 先当章节入口
    view.render({ ...base, site: null, chapterEntry: true });
    // 再变回普通站点（同一具视图，模拟节点被复用）
    view.render({ ...base, site: { kind: 'randomResource', cellId: 5 }, chapterEntry: false });
    stationEmitLog.length = 0;
    root.emit('click');
    assert.deepEqual(stationEmitLog, [TERRITORY_EVENTS.STATION_TAP],
        '复用后必须回到「站点」语义，不能还往章节弹窗发');
});

test('★★★`interactive` 同时管住建筑与气泡两处点击', () => {
    const { view, iconSprite } = makeStationView();
    const render = (interactive: boolean): any => {
        view.render({
            site: null,
            icon: null,
            caption: '',
            tint: iconSprite.color,
            badge: '',
            chapterEntry: true,
            interactive,
        });
        return view;
    };
    assert.equal(render(true).button.interactable, true, '建筑那颗 Button 要能点');
    assert.equal(render(false).button.interactable, false, '关掉后建筑不能点（气泡同理，见下）');
    // 气泡的 `interactable` 与建筑共用同一个 `interactive`（`visible && content.interactive`），
    // 所以「包括气泡部分」不需要再单独一个开关 —— 这里钉住那份共用关系。
    const source = read(STATION_VIEW_PATH);
    assert.match(source, /bubble\.button\.interactable = visible && content\.interactive;/);
});

test('★★地图：起始格渲染 `chapterEntry: true` + `interactive: true`，且不再禁止点击', () => {
    const source = read(MAP_VIEW_PATH);
    const start = source.indexOf("levelBubble: TERRITORY_START_BUBBLE_TEXT,");
    assert.ok(start > 0, '没找到起始格渲染');
    const block = source.slice(source.lastIndexOf('view.render({', start), start);
    assert.match(block, /chapterEntry: true,/, '起始格没标成章节入口 ⇒ 点了没反应');
    assert.match(block, /interactive: true,/, '未放开交互 ⇒ 建筑与气泡都点不动');
    assert.ok(!/interactive: false,\s*$/m.test(block), '起始格不许再写 `interactive: false`');
    // `ensureStartView` 原来传 `false`（不可点）⇒ 现在必须走默认值。
    const ensure = source.slice(source.indexOf('private ensureStartView()'), source.indexOf('private getStationLayers()'));
    assert.match(ensure, /view\.initialize\(this\.getStationLayers\(\)\);/, '起始格仍被初始化成「不可点」');
    assert.ok(!ensure.includes('false),'), '`initialize(layers, false)` 会关掉 clickable，点不出事件');
});

test('★事件常量只此一份：view 发、application 定义', () => {
    assert.equal(TerritoryUiEvent.ChapterSelect, 'territory:chapter-select');
    assert.notEqual(TERRITORY_EVENTS.STATION_TAP, TerritoryUiEvent.ChapterSelect,
        '两条事件不能撞名：一条带站点、一条开弹窗');
    const station = read(STATION_VIEW_PATH);
    assert.match(station, /EventMgr\.instance\.emit\(TerritoryUiEvent\.ChapterSelect\)/,
        '站点视图没发 ChapterSelect');
});

// ============================================================
// 二、宿主页：三角关闭 + 订阅章节入口
// ============================================================

test('★★★快速寻敌两侧的三角永久隐藏（不再跟着 ready 显隐）', () => {
    const page = read(MAIN_PAGE_PATH);
    const onLoad = page.slice(page.indexOf('onLoad(): void {'), page.indexOf('start(): void {'));
    assert.match(onLoad, /this\.previousChapterButton\.active = false;/);
    assert.match(onLoad, /this\.nextChapterButton\.active = false;/);
    // 🔴 真正让它们"回来"的是渲染回调里那两行 —— 必须没了。
    const render = page.slice(page.indexOf('private onTerritoryRender('));
    const body = render.slice(0, render.indexOf('\n    }'));
    assert.ok(!body.includes('previousChapterButton.active'),
        '`onTerritoryRender` 里又把它显示出来了（三角会重新出现在快速寻敌两侧）');
    assert.ok(!body.includes('nextChapterButton.active'), '同上');
});

test('★★★宿主页订阅「章节入口」事件并复用同一个打开方法', () => {
    const page = read(MAIN_PAGE_PATH);
    const onLoad = page.slice(page.indexOf('onLoad(): void {'), page.indexOf('start(): void {'));
    assert.match(onLoad, /EventMgr\.instance\.on\(TerritoryUiEvent\.ChapterSelect, this\.onOpenChapterSelect, this\);/,
        '没订阅 ⇒ 点章节建筑没反应');
    // 三角与建筑必须开**同一个**弹窗（同一个方法），否则两套 open 迟早不一致。
    assert.match(onLoad, /this\.previousChapterButton\.on\(Button\.EventType\.CLICK, this\.onOpenChapterSelect, this\);/);
    assert.match(page, /popup\.?open|ChapterSelectPanel\.open\(\{ userData: \{ rows, currentIndex \} \}\)/,
        '打开弹窗的入口没变');
    // 退出时必须解绑（页面复用 / 重进会叠监听）。
    assert.match(page, /EventMgr\.instance\.offTarget\(this\);/, '`onDestroy` 没解绑事件');
});

test('★章节入口与「快速寻敌」互不干扰：开始按钮仍发 focusLevel', () => {
    const page = read(MAIN_PAGE_PATH);
    const start = page.slice(page.indexOf('private onStartGame(): void {'), page.indexOf('private onTerritoryRender('));
    assert.match(start, /kind: 'focusLevel'/, '快速寻敌的行为不该被这次改动碰到');
    assert.ok(!start.includes('ChapterSelect'), '快速寻敌不该去开章节弹窗');
});
