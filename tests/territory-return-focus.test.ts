import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 通关返回章节页：相机要**居中到刚打的那一格**。
 *
 * 🔴 2026-10-29 用户：「通过关卡是回到章节页面，相机不会停在初始位置，需要将地块居中
 *    观看关卡地块的通关翻转效果」。
 *
 * 现状：`ZCGame.returnToMain` 只带 `initialTab: 'territory'`，页面是**整页新建**的
 * （`ProcedureMain.onPreload` 才发现 `mainNode` 为空 ⇒ 重新实例化），于是
 * `lastRenderedChapter === -1` ⇒ `resetScroll` 为真 ⇒ 相机滚到 `startCellId`。
 * 而这一格远在天边，服务端紧接着推来的「通关格子」广播（`CmdCityChapterPassCellBroMsg`）
 * 就在屏幕外把那颗格子翻掉了 —— 玩家什么都看不见。
 *
 * 口令链路（单次消费，全程不落全局变量）：
 *   `ZCGame`（`pveContext.territoryCellId`）→ `ProcedureMain` 入口参数
 *   → `MainTabHost.focusCellId`（`setParent` 之前交给页面）→ `MainTerritoryMap.setFocusCell`
 *   → 首屏 `renderAll` 居中后立刻清空。
 */

const read = (p: string): string => readFileSync(new URL(`../assets/script/app/${p}`, import.meta.url), 'utf8');

const game = (): string => read('zcds/ZCGame.ts');
const procedure = (): string => read('procedure/ProcedureMain.ts');
const host = (): string => read('main/MainTabHost.ts');
const page = (): string => read('main/MainTerritoryMap.ts');

test('结算回主界面：领地分支必须带上「刚打的格子 + 章节」', () => {
    const source = game();
    const at = source.indexOf('private returnToMain(');
    assert.ok(at > 0, '要有 returnToMain');
    const body = source.slice(at, source.indexOf('\n    private ', at + 10));
    // 领地分支（pveContext）必须把两样都写进 entry params。
    assert.match(body, /initialTab: 'territory'/);
    assert.match(body, /focusCellId: this\.pveContext\.territoryCellId/,
        '不带格子 id ⇒ 页面只能滚回初始点位，翻转在屏幕外播');
    assert.match(body, /focusChapterId: this\.pveContext\.chapterId/,
        '带上章节才能校验「这颗格子属于当前渲染的章」，否则跨章存局会把相机甩到角落');
    // 世界（SLG）分支不该被顺手套上领地焦点。
    const worldBranch = body.slice(body.indexOf("initialTab: 'world'"), body.indexOf("initialTab: 'territory'"));
    assert.doesNotMatch(worldBranch, /focusCellId/, '大地图返回不经过领地图，别塞焦点格');
});

test('ProcedureMain：入口参数转发到宿主，且早于 setParent', () => {
    const source = procedure();
    assert.match(source, /readonly focusChapterId\?: number;/);
    assert.match(source, /readonly focusCellId\?: number;/);
    assert.match(source, /tabHost\.focusCellId = \{/, '要写进宿主字段，别自己存一份');
    const assignAt = source.indexOf('tabHost.focusCellId = {');
    const parentAt = source.indexOf('node.setParent(this.host)');
    assert.ok(assignAt > 0 && parentAt > 0 && assignAt < parentAt,
        '晚于 setParent 就晚了：领地页首屏 renderAll 在挂载时就消费这份焦点');
});

test('MainTabHost：焦点格交页面前取走并清空（单次消费）', () => {
    const source = host();
    assert.match(source, /focusCellId: \{ readonly chapterId: number; readonly cellId: number \} \| null = null;/);
    const showPage = source.slice(source.indexOf('private showPage('));
    const take = showPage.indexOf('const focus = this.focusCellId;');
    const clear = showPage.indexOf('this.focusCellId = null;');
    const push = showPage.indexOf('mainTerritoryMap.setFocusCell(focus.chapterId, focus.cellId)');
    const parentAt = showPage.indexOf('page.setParent(this.content)');
    assert.ok(take > 0 && clear > take, '取走之后必须置空，否则切 tab 回来又跳一次');
    assert.ok(push > clear && parentAt > push, '注入要早于 setParent（页面 onLoad 之前）');
});

test('首屏 renderAll：有焦点格就居中它，否则回初始点位；读完即清', () => {
    const source = page();
    const at = source.indexOf('private renderAll(');
    const body = source.slice(at, source.indexOf('\n    private ', at + 10));
    assert.match(body, /const focus = this\.focusCell;/);
    assert.match(body, /this\.focusCell = null;/,
        '单次消费：不清的话之后每次章节刷新都会被拽回那颗格子');
    assert.match(body, /focus\.chapterId === state\.chapterId/,
        '章节对不上就别用 —— 拿别的章的地图算坐标只会把相机甩到角落');
    assert.match(body, /state\.map\.startCellId/,
        '没有焦点格（普通进页 / 切章）仍旧回初始点位');
    // 顺序：先 renderMap（内容层尺寸在里面落定）再滚，否则算偏移用的还是旧尺寸。
    assert.ok(body.indexOf('this.mapView.renderMap(') < body.indexOf('this.scrollToCell('),
        '滚动必须排在 renderMap 之后');
});

test('scrollToCell：视口没撑开时先滚一次、再补滚修正，重试有上限', () => {
    const source = page();
    const at = source.indexOf('private scrollToCell(');
    assert.ok(at > 0, '要有 scrollToCell');
    const body = source.slice(at, source.indexOf('\n    private ', at + 10));
    // 首屏（尤其刚返回那一趟）Widget 还没把视口撑开 ⇒ contentSize 为 0 ⇒ 偏移被钳成 0。
    assert.match(body, /size\.width <= 0 \|\| size\.height <= 0/);
    assert.match(body, /retry < 3/, '重试要有上限，别在布局真没就绪时无限重排');
    assert.match(body, /this\.scrollToCell\(cellId, layout, retry \+ 1\)/);
    // 🔴 关键：**先滚再补**，不是「尺寸为 0 就直接 return」——
    //    有尺寸的那次调用必须照常落到 `scrollToOffset`（快速寻敌 / 切章都靠它），
    //    早退会让这些路径一次都不滚（`main-quick-find` 就是这么挂了）。
    const firstScroll = body.indexOf('this.mapScrollView.scrollToOffset(');
    const retryAt = body.indexOf('retry < 3');
    assert.ok(firstScroll > 0 && retryAt > firstScroll, '先滚一次，再决定要不要补滚');
    // 两份留白都要传（`territory-map-bottom-inset` 里那条守卫）。
    assert.match(body, /paddingBottom: this\.mapView\?\.contentPaddingBottom/);
    assert.match(body, /paddingTop: this\.mapView\?\.contentPaddingTop/);
});
