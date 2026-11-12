/**
 * 快速寻敌的开启条件（`open` 表 `refId = 702`）。
 *
 * 需求（2026-11-09）：*「快速寻敌按钮在激活第 1 章第 4 关的地块后才解锁该功能，
 * 解锁后所有章节都常驻」* + *「同步到【功能开启表中】，新增 id 702」*。
 *
 * 钉三件事：
 *  ① 表里真的有 702，且条件是**激活**（`territoryLevelActivated`）不是通关；
 *  ② 「激活」与「通关」两个判据不串台（串了就会晚一整场战斗 / 或提前放行）；
 *  ③ 跨章节常驻靠账号级落盘，`MainPage` 的接线顺序对（先记账再判）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    QUICK_FIND_OPEN_REF_ID,
    findQuickFindRow,
    isQuickFindUnlocked,
    resolveQuickFindGate,
} from '../assets/script/app/main/QuickFindGate';
import {
    activatedTerritoryLevelIds,
    isTerritoryLevelActivatedInTerritory,
    isTerritoryLevelPassedInTerritory,
} from '../assets/script/app/main/ChestEntryGate';
import { EMPTY_ENTRANCE_PLAYER_STATE, evaluateEntranceCondition } from '../assets/script/app/main/MainEntranceVisible';
import type { EntrancePlayerState, EntranceVisibleRow } from '../assets/script/app/main/MainEntranceVisible';

const READ_PATH = 'assets/script/app/main/MainPage.ts';

/** 把注释剥掉再扫源码：注释里写着「不许写 xxx」时别被自己绊倒。 */
function codeOnly(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function openRows(): EntranceVisibleRow[] {
    return JSON.parse(readFileSync('assets/remoteRef/open.json', 'utf8')) as EntranceVisibleRow[];
}

/** 「第 1 章」：10004 在这张图上占 cell 252（见 chapter_01.json 的 `stage_19`）。 */
const CHAPTER_ONE = new Map<number, { levelId: number }>([
    [327, { levelId: 10001 }],
    [252, { levelId: 10004 }],
    [213, { levelId: 10005 }],
]);

/** 「第 2 章」：没有 10004 —— 切章之后只能靠账号级落盘认出来。 */
const CHAPTER_TWO = new Map<number, { levelId: number }>([
    [100, { levelId: 10011 }],
    [140, { levelId: 20001 }],
]);

function state(overrides: Partial<EntrancePlayerState> = {}): EntrancePlayerState {
    return { ...EMPTY_ENTRANCE_PLAYER_STATE, hasRole: true, roleLevel: 1, ...overrides };
}

// ============================================================
// ① 表
// ============================================================

test('功能开启表里有 702「快速寻敌」：belond=0 / type=2 / 条件是 territoryLevelActivated(10004)', () => {
    assert.equal(QUICK_FIND_OPEN_REF_ID, 702, '用户指定新增 id 702');

    const row = openRows().find((entry) => Number(entry.refId) === 702);
    assert.ok(row, 'assets/remoteRef/open.json 里没有 702');
    assert.equal(row!.name, '快速寻敌');
    assert.equal(row!.belond, 0, 'belond 必须是 0：底部按钮不是两侧活动入口列，别让它多长一颗图标');
    assert.equal(row!.type, 2, '「表里有、逻辑不用」的列最容易被漏 —— 701 就漏过一次');
    assert.equal(row!.tipShow, '激活第1章第4关地块后解锁', '未解锁提示要跟条件同口径');
    assert.equal(row!.preResId, undefined, '没有前置系统');

    const conditions = row!.visibleCondition ?? [];
    assert.equal(conditions.length, 1, `只挂一条条件，实际 ${conditions.length} 条`);
    assert.equal(conditions[0].type, 'territoryLevelActivated',
        '必须是「激活」：用 territoryLevel（通关）会晚一整场战斗');
    assert.equal(conditions[0].param?.resId, 10004, '第 1 章第 4 关 = levelInfo 里 chapterStage=4 的 10004');
});

test('运行时真正读的那份表（refSmallAll.json 的 open 块）也有 702 —— 只改 open.json 不生效', () => {
    const small = JSON.parse(readFileSync('assets/remoteRef/refSmallAll.json', 'utf8')) as {
        open?: { k: string[]; v: unknown[][] };
    };
    const block = small.open;
    assert.ok(block?.k, 'refSmallAll.json 里没有 open 表');
    const rows = block!.v.map((values) => Object.fromEntries(block!.k.map((key, index) => [key, values[index]])));
    const row = rows.find((entry) => Number(entry.refId) === 702);
    assert.ok(row, 'refSmallAll 的 open 里没有 702 —— 改完表得重跑 tools/ref/ref_compress_json.py');
    assert.equal(row!.name, '快速寻敌');
    assert.equal((row!.visibleCondition as Array<{ type: string; param: { resId: number } }>)[0].type,
        'territoryLevelActivated');
    assert.equal(rows.length, openRows().length,
        `refSmallAll(${rows.length}) 与 open.json(${openRows().length}) 行数不一致`);
});

// ============================================================
// ② 两个判据不串台
// ============================================================

test('activated 条件只认「激活」：通关了但调用方说没激活 ⇒ 仍然 fail', () => {
    const condition = { type: 'territoryLevelActivated', param: { resId: 10004 } };
    assert.equal(evaluateEntranceCondition(condition, state({ isTerritoryLevelActivated: () => false })), 'fail');
    assert.equal(evaluateEntranceCondition(condition, state({ isTerritoryLevelActivated: (id) => id === 10004 })), 'pass');
    assert.equal(evaluateEntranceCondition(condition, state({ isTerritoryLevelActivated: (id) => id === 10005 })), 'fail',
        '关卡号要原样透传，别把 10004 当成「随便哪一关」');
});

test('territoryLevel（通关）不会被 activated 顺手带过 —— 两条条件各判各的', () => {
    const passed = { type: 'territoryLevel', param: { resId: 20001 } };
    // 只有激活、没有通关：战斗宝箱那条门槛仍然不许过
    const activatedOnly = state({
        isTerritoryLevelPassed: () => false,
        isTerritoryLevelActivated: () => true,
    });
    assert.equal(evaluateEntranceCondition(passed, activatedOnly), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'territoryLevelActivated', param: { resId: 20001 } }, activatedOnly), 'pass',
        '激活了就够 —— 这正是快速寻敌要的口径');
});

test('缺 resId 的两条据点条件都按 fail（fail-closed，不猜关卡号）', () => {
    const base = state({ isTerritoryLevelPassed: () => true, isTerritoryLevelActivated: () => true });
    assert.equal(evaluateEntranceCondition({ type: 'territoryLevelActivated', param: {} }, base), 'fail');
    assert.equal(evaluateEntranceCondition({ type: 'territoryLevel', param: {} }, base), 'fail');
});

// ============================================================
// ③ 跨章节常驻
// ============================================================

test('第 1 章激活了 10004 ⇒ 判已激活；没激活 ⇒ 判未激活', () => {
    const withCell = (activated: number[]) => ({
        stageByCell: CHAPTER_ONE,
        isCellActivated: (cellId: number) => activated.includes(cellId),
    });
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, withCell([252]), null), true);
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, withCell([]), null), false);
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, withCell([327]), null), false,
        '别的格的激活不能算到 10004 头上');
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, { stageByCell: null, isCellActivated: () => true }, null),
        false, '快照没到 ⇒ 按未激活，宁可晚一点显示');
});

test('🔴 切到第 2 章：只靠当前章会丢，靠账号级落盘才「常驻」', () => {
    const chapterTwo = { stageByCell: CHAPTER_TWO, isCellActivated: () => true };
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, chapterTwo, null), false,
        '第 2 章里没有 10004 —— 这一条就是「不落盘就消失」的证据');
    assert.equal(isTerritoryLevelActivatedInTerritory(10004, chapterTwo, new Set([10004])), true,
        '落盘命中 ⇒ 切到哪一章都算解锁过');
    assert.equal(isTerritoryLevelActivatedInTerritory(10005, chapterTwo, new Set([10004])), false,
        '落盘只认记过的关卡，别把整章都当成已激活');
});

test('激活集合按关卡去重，且不与「已通关」共用判据', () => {
    const view = {
        stageByCell: new Map<number, { levelId: number }>([
            [252, { levelId: 10004 }],
            [253, { levelId: 10004 }],
            [327, { levelId: 10001 }],
            [213, { levelId: 10005 }],
        ]),
        isCellActivated: (cellId: number) => cellId === 252 || cellId === 327,
    };
    assert.deepEqual(activatedTerritoryLevelIds(view).sort((a, b) => a - b), [10001, 10004],
        '同一关多格只算一次；没激活的 10005 不许混进来');
    assert.deepEqual(activatedTerritoryLevelIds({ stageByCell: null, isCellActivated: () => true }), [],
        '快照没到 ⇒ 空表（不写盘）');

    // 反过来：通关集合看的是 `isAreaPassed`，与激活无关
    const passedOnly = {
        stageByCell: CHAPTER_ONE,
        isAreaPassed: (cellId: number) => cellId === 252,
    };
    assert.equal(isTerritoryLevelPassedInTerritory(10004, passedOnly, null), true);
});

// ============================================================
// 闸门
// ============================================================

test('闸门：表里有 702 且条件过 ⇒ 开；条件没过 ⇒ 关；表里没这行 ⇒ rowMissing', () => {
    const rows = openRows();
    const on = resolveQuickFindGate(rows, state({ isTerritoryLevelActivated: (id) => id === 10004 }));
    assert.deepEqual(on, { unlocked: true, rowMissing: false });
    assert.equal(isQuickFindUnlocked(rows, state({ isTerritoryLevelActivated: () => false })), false);

    const missing = resolveQuickFindGate(rows.filter((row) => Number(row.refId) !== 702),
        state({ isTerritoryLevelActivated: () => true }));
    assert.deepEqual(missing, { unlocked: false, rowMissing: true },
        '表缺行 ⇒ 按未解锁（fail-closed），并单独报 rowMissing');
    assert.equal(isQuickFindUnlocked(null, state({ isTerritoryLevelActivated: () => true })), false,
        '整张表没拿到也一样');
    assert.equal(findQuickFindRow(rows)?.refId, 702);
});

// ============================================================
// MainPage 接线
// ============================================================

test('MainPage：按钮显隐只由 702 闸门决定，宝箱栏收起不会把它顺手亮出来', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));

    // `start()` 不能再无条件点亮（那会把 onLoad 刚判完的「还没解锁」又亮回来）
    assert.equal(/this\.startButton\.active = true;/.test(code), false,
        'start() 里还有无条件的 active = true —— 会把未解锁的按钮亮出来');
    assert.match(code, /this\.startButton\.active = this\.quickFindUnlocked;/,
        'start() 必须按闸门结果点亮');
    assert.match(code, /this\.startButton\.active = this\.quickFindUnlocked && !open;/,
        '宝箱栏收起时不能绕过闸门');
    assert.match(code, /if \(!this\.quickFindUnlocked\) return;/,
        'onStartGame 要自己再挡一道（事件可能被转发进来）');
    assert.match(code, /private applyQuickFindGate\(rows: readonly EntranceVisibleRow\[\] \| null\): void \{[\s\S]*?resolveQuickFindGate\(rows, this\.entrancePlayerState\(\)\)/,
        '判定要走 QuickFindGate 的闸门，别在页面里自己读 visibleCondition');
});

test('MainPage：先记账再判 + 落盘走 Array.from（release 会降级 [...set]）', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));

    assert.match(code, /this\.rememberPassedTerritoryLevels\(\);[\s\S]{0,120}?this\.rememberActivatedTerritoryLevels\(\);[\s\S]{0,40}?this\.refreshOpenGates\(\);/,
        '领地渲染时先把已激活关卡记下来，再判闸门 —— 顺序反了，切章那一笔会漏');
    assert.match(code, /markLevelsActivated\(Array\.from\(activated\)\)/,
        '落盘必须传 `Array.from(set)`');
    assert.equal(/markLevelsActivated\(\[\.\.\./.test(code), false,
        '别对 Set 用展开：`assets/script` 不许 [...set]（打包后静默失效）');
    assert.match(code, /private activatedTerritoryLevelSet\(\): Set<number> \{[\s\S]*?loadActivatedLevels\(\)/,
        '内存镜像要从 TerritorySaveStore.loadActivatedLevels 起手（账号级、不分章节）');
    assert.match(code, /isCellUnlocked\(cellId\) \|\| progress\.isOwned\(cellId\) \|\| progress\.isAreaPassed\(cellId\)/,
        '「激活」= isCellUnlocked || isOwned || isAreaPassed（与 TerritoryMapView.isCellActivated 同口径）');
    assert.equal(/isCellActivated: \(cellId: number\) => progress\.isAreaPassed\(cellId\)/.test(code), false,
        '别把「激活」退化成 isAreaPassed —— 那就成通关了');
});
