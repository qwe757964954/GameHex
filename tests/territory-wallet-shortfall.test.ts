import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    territoryCostShort,
    territoryUnlockShortfall,
} from '../assets/script/app/territory/model/TerritoryCostShortfall';

import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 「体力不足或银币不足时，**对应的**数字 UI 显示红色」（用户 2026-11-03，领地截图）。
 *
 * 这份用例分两段：
 *  ① **纯函数**：够不够的边界（刚好够 / 差 1 / 免费 / 余额未知）；
 *  ② **接线守卫**：银币那颗用 `silver`、体力那颗用 `stamina`，
 *     并且「不可开」不再是一刀切的染红依据（体力不足不能把银币染红 —— 那是"对应"的全部意思）。
 */

const MAP_VIEW_PATH = 'assets/script/app/territory/view/TerritoryMapView.ts';
const STATION_VIEW_PATH = 'assets/script/app/territory/view/TerritoryStationView.ts';
const MODEL_PATH = 'assets/script/app/territory/application/TerritoryModel.ts';
const VIEW_STATE_PATH = 'assets/script/app/territory/application/TerritoryViewState.ts';
const PAGE_PATH = 'assets/script/app/main/MainTerritoryMap.ts';

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// ============================================================
// ① 纯函数：够不够
// ============================================================

test('刚好够不算不足；差 1 就是不足', () => {
    assert.equal(territoryCostShort(15, 15), false, '刚好够 ⇒ 能开，不该红');
    assert.equal(territoryCostShort(14, 15), true, '差 1 ⇒ 红');
    assert.equal(territoryCostShort(0, 1), true, '零余额 + 有消耗 ⇒ 红');
    assert.equal(territoryCostShort(1e9, 15), false);
});

test('免费格 / 脏消耗一律不算不足（否则满屏红）', () => {
    for (const cost of [0, -1, Number.NaN, Number.POSITIVE_INFINITY,
        undefined as unknown as number, null as unknown as number]) {
        assert.equal(territoryCostShort(0, cost), false, `cost=${String(cost)} 不该判红`);
    }
});

test('余额未知（NaN / Infinity / 缺字段）不妄断：红是「确定不够」的断言', () => {
    for (const balance of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
        undefined as unknown as number, null as unknown as number, '15' as unknown as number]) {
        assert.equal(territoryCostShort(balance, 15), false,
            `balance=${String(balance)} 读不出数时不许染红（会误导玩家去攒钱）`);
    }
});

test('两项各判各的：银币够体力不够 / 反之亦然', () => {
    const cost = { silverCost: 15, staminaCost: 1 };
    assert.deepEqual(territoryUnlockShortfall({ silver: 15, stamina: 1 }, cost),
        { silver: false, stamina: false }, '两项都够');
    assert.deepEqual(territoryUnlockShortfall({ silver: 15, stamina: 0 }, cost),
        { silver: false, stamina: true }, '只缺体力');
    assert.deepEqual(territoryUnlockShortfall({ silver: 14, stamina: 5 }, cost),
        { silver: true, stamina: false }, '只缺银币');
    assert.deepEqual(territoryUnlockShortfall({ silver: 0, stamina: 0 }, cost),
        { silver: true, stamina: true }, '两项都缺');
});

test('钱包 / 消耗缺失时退回「都不红」（沙箱输入的宽松场景）', () => {
    const none = { silver: false, stamina: false };
    assert.deepEqual(territoryUnlockShortfall(null, { silverCost: 15, staminaCost: 1 }), none);
    assert.deepEqual(territoryUnlockShortfall(undefined, null), none);
    assert.deepEqual(territoryUnlockShortfall({ silver: 0, stamina: 0 }, null), none,
        '没有消耗就没有"付不起"');
});

test('大额消耗按安全整数比较，不会因为浮点/科学计数法判错', () => {
    const big = Number.MAX_SAFE_INTEGER;
    assert.equal(territoryCostShort(big, big), false);
    assert.equal(territoryCostShort(big - 1, big), true);
    assert.equal(territoryCostShort(1e21, 1e21), false);
});

// ============================================================
// ② 接线：哪颗数字用哪一项
// ============================================================

test('★★★未解锁格的银币数字：只看银币（体力不足不许染红）', () => {
    const source = read(MAP_VIEW_PATH);
    const start = source.indexOf('const short = territoryUnlockShortfall(input.wallet, site.unlock);');
    assert.ok(start > 0, '条件格没接 `territoryUnlockShortfall` ⇒ 需求未落地');
    const body = source.slice(start, source.indexOf('conditionTextColor:', start));
    assert.match(body, /short\.silver/, '银币数字必须看 `short.silver`');
    assert.ok(!/short\.stamina(?!\s*\|\|)/.test(body.replace(/!\s*short\.stamina/g, '')),
        '银币数字不得由「体力不足」直接染红');
    // 🔴 旧的 `isOpenable && !unclaimedFixedPrereq` 必须被换掉：它把「不可开」整体算红，
    //    体力不足时银币也跟着红 ⇒ 与用户要的"对应"相反。
    const render = source.slice(source.indexOf('private stationRenderOf('),
        source.indexOf('if (site.type === TERRITORY_SITE_TYPE.fixedResource)'));
    assert.ok(!/conditionTextColor: isOpenable &&/.test(render),
        '条件格颜色不许再只由 `isOpenable` 决定');
    assert.match(render, /!isOpenable && !short\.stamina/,
        '「不可开」仍然染红，但必须排除「原因就是体力不足」那一种');
});

test('★★★宝箱气泡的体力数字：只认 `stamina`', () => {
    const source = read(MAP_VIEW_PATH);
    const start = source.indexOf('levelBubbleTextColor: showHintBubble');
    assert.ok(start > 0, '宝箱气泡没接 `levelBubbleTextColor` ⇒ 体力不足时数字不会变红');
    const tail = source.slice(start, start + 300);
    assert.match(tail, /territoryUnlockShortfall\(input\.wallet, site\.unlock\)\.stamina/,
        '体力那颗必须用 `.stamina`');
    assert.ok(!/\.silver/.test(tail), '体力数字不得被银币影响');
});

test('★★★随机格的银币数字同口径（两条渲染路径不许分裂）', () => {
    const source = read(MAP_VIEW_PATH);
    const start = source.indexOf('const randomShort = territoryUnlockShortfall(');
    assert.ok(start > 0, '随机格没接同一套判据');
    const body = source.slice(start, source.indexOf('const content: ITerritoryStationRender', start));
    assert.match(body, /randomShort\.silver \|\| \(!isOpenable && !randomShort\.stamina\)/,
        '随机格也要「银币不够 / 非体力原因开不了」两路，且排除体力');
    assert.match(body, /triggerSilver/, '银币消耗取自 `randomSites.triggerSilver`');
    assert.match(body, /defaults\?\.staminaCost/, '体力消耗取自 `map.defaults.staminaCost`');
});

test('★★★站点视图：覆盖色必须排在 `themeLevelBubbleLabel` 之后', () => {
    const source = read(STATION_VIEW_PATH);
    assert.match(source, /readonly levelBubbleTextColor\?: Color;/, '接口缺覆盖色字段');
    // ⚠️ 不用跨行字面量：这个文件是 CRLF，`'...;\n  //'` 会一个都匹配不上（Python 读会转 LF，
    //    所以"本地看着没问题"）。改成两次 indexOf，换行符怎么变都不影响。
    const themeAt = source.indexOf('this.themeLevelBubbleLabel(chest);');
    assert.ok(themeAt > 0, '没找到气泡文字样式的唯一写入口');
    const applyAt = source.indexOf('this.badgeLabel.color = bubbleTextColor;', themeAt);
    assert.ok(applyAt > themeAt, '覆盖要写在 `themeLevelBubbleLabel` 之后（写在前面会被它盖掉）');
    assert.match(source, /this\.badgeLabel\.color\.equals\(bubbleTextColor\)/,
        '颜色没变就别写（站点每秒重画一次）');
});

test('★★钱包从模型一路透到地图：少了任何一跳都会静默不变红', () => {
    // 模型状态
    const model = read(MODEL_PATH);
    assert.match(model, /readonly wallet: Readonly<TerritoryWallet>;/, '`ITerritoryViewState` 缺 wallet');
    assert.match(model, /wallet: \{ silver: wallet\?\.silver \?\? 0, stamina: wallet\?\.stamina \?\? 0 \},/,
        '`buildState` 必须把钱包放进状态');
    // 快照（延迟渲染不能读到已经扣过费的实时钱包）
    const viewState = read(VIEW_STATE_PATH);
    assert.match(viewState, /wallet: Object\.freeze\(\{ silver: state\.wallet\.silver, stamina: state\.wallet\.stamina \}\)/,
        '发布出去的那一帧要拍快照');
    // 页面 → 地图
    const page = read(PAGE_PATH);
    assert.match(page, /wallet: state\.wallet,/, '`renderAll` 没把钱包交给地图');
    // 渲染输入
    assert.match(read(MAP_VIEW_PATH), /readonly wallet: Readonly<TerritoryWallet>;/,
        '`ITerritoryMapRenderInput` 缺 wallet');
});

// ============================================================
// ③ 行为：真跑 `syncStations`（截图里那种「未解锁格 + 银币 15」）
// ============================================================

/**
 * 截图里那几颗「银币 + 15 / 10」是**未解锁站点格**的条件角标，
 * 它们和随机格走的是两条渲染路径 —— 所以这一条必须单独跑一遍真渲染，
 * 不能只靠随机格那份行为用例"顺带证明"。
 */
test('★★★未解锁站点格：银币不够红 / 体力不够但银币够 ⇒ 白 / 两项都够 ⇒ 白', () => {
    const MapView = loadTerritoryMapViewClass() as new () => {
        createStation: (target: unknown) => unknown;
        syncStations: (input: unknown) => void;
    };
    const mapView = new MapView();
    const rendered = new Map<number, Record<string, unknown>>();
    mapView.createStation = (target: { cellId: number }) => ({
        setMapPosition() {},
        render(content: Record<string, unknown>) { rendered.set(target.cellId, content); },
    });
    const silverIcon = { name: 'silver icon' };
    const site = {
        id: 'stage-1',
        cellId: 1,
        type: 'stage',
        footprint: [1],
        // 截图那颗 15 银币 / 1 体力
        unlock: { silverCost: 15, staminaCost: 1, requiredCells: [], combatPower: 0, exploreSeconds: 0 },
    };
    const render = (wallet: { silver: number; stamina: number }, openable: boolean): Record<string, unknown> => {
        rendered.clear();
        mapView.syncStations({
            map: { startCellId: 0, sites: [site], defaults: { staminaCost: 1 } },
            layout: { points: new Map([[1, { x: 10, y: 20 }]]) },
            revealedCells: [1],
            siteOpenableCells: openable ? [1] : [],
            pendingFixedResourceCells: [],
            // `ITerritoryMapRenderInput` 的必填项：起始格/站点的 `interactive` 都要读它。
            pendingRandomResourceCells: [],
            stageByCell: new Map(),
            progress: { isCellUnlocked: () => false, isOwned: () => false },
            art: { randomSilverIcon: silverIcon },
            wallet,
        });
        return rendered.get(1) ?? {};
    };

    const rich = { silver: 100, stamina: 10 };
    assert.equal(render(rich, true).conditionTextColor, 'white', '两项都够 ⇒ 白');
    assert.equal(render(rich, true).caption, '15', '数字本身仍是银币消耗（染色不改数）');
    assert.equal(render({ silver: 14, stamina: 10 }, false).conditionTextColor, 'red',
        '银币差 1 ⇒ 红');
    assert.equal(render({ silver: 99, stamina: 0 }, false).conditionTextColor, 'white',
        '只缺体力 ⇒ 银币那颗保持白（对应性；不可开由底条红表达）');
    assert.equal(render({ silver: 14, stamina: 0 }, false).conditionTextColor, 'red',
        '两项都缺 ⇒ 银币仍然红');
});
