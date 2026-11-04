import { buildZCBattleReturnParams } from '../assets/script/app/zcds/application/ZCBattleEntryBuilder';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** 返回参数由入口构筑函数生成，经主界面宿主在激活前单次交给领地图。 */

const read = (p: string): string => readFileSync(new URL(`../assets/script/app/${p}`, import.meta.url), 'utf8');

const procedure = (): string => read('procedure/ProcedureMain.ts');
const host = (): string => read('main/MainTabHost.ts');
const page = (): string => read('main/MainTerritoryMap.ts');

test('结算回主界面：领地分支必须带上「刚打的格子 + 章节」', () => {
    assert.deepEqual(buildZCBattleReturnParams({ slgBattleType: undefined,
        pveContext: { chapterId: 2, territoryCellId: 7 } as Parameters<typeof buildZCBattleReturnParams>[0]['pveContext'],
    }), { initialTab: 'territory', focusChapterId: 2, focusCellId: 7 });
    assert.deepEqual(buildZCBattleReturnParams({ slgBattleType: 1003, pveContext: null }), { initialTab: 'world' });
    assert.equal(buildZCBattleReturnParams({ slgBattleType: undefined, pveContext: null }), undefined);
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
    const composition = readFileSync('assets/script/app/bootstrap/main/MainTabsComposition.ts', 'utf8');
    const showPage = composition.slice(composition.indexOf('private showPage('));
    const take = showPage.indexOf('const focus = this.host.focusCellId;');
    const clear = showPage.indexOf('this.host.focusCellId = null;');
    const push = showPage.indexOf('map.setFocusCell(focus.chapterId, focus.cellId)');
    const parentAt = showPage.indexOf('this.host.mountPage(node)');
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
