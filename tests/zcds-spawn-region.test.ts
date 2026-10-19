import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap,
    defaultZCSectionAt,
    getZCMapOwner,
    getZCMapSection,
    ZC_HEX_CONFIG,
    ZC_MAP_COLUMNS,
    ZC_MAP_ID,
    ZC_MAP_PLAYER_COUNT,
    ZC_MAP_REGIONS,
    ZC_MAP_RESOURCE_POINTS,
    ZC_MAP_ROWS,
    ZC_MAP_SPACING,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCSpawnSelection } from '../assets/script/app/zcds/model/ZCSpawnSelection';

/**
 * 自选主城阶段的「半区」守卫（《自选出生点-需求文档》3.2 / 4.1）。
 *
 * 需求：地图按玩家归属划成 1 区 / 2 区（4 人再加 3 / 4 区），**玩家只能在自己所属的半区内**
 * 选主城；半区在选点阶段要一眼看得出来（己方 / 对方不同色）。
 *
 * 工程里两张自选图（`select_river` / `river_custom`）的 `sections` 全是 0 —— 编辑器切到自选
 * 主城会收回主城盘、不铺分区色，所以「半区」只能按布局推导（`defaultZCSectionAt`，与编辑器
 * `sectionAt()` 同口径）。这里的夹具就用这种「全中立格」形态；自带分区的图另有一条用例。
 */
const NEUTRAL_LAYOUT: ZCMapLayout = {
    id: 'spawn-region-neutral-test',
    version: 3,
    rows: 8,
    columns: 8,
    playerCount: 2,
    cityMode: 'select',
    // 全中立格：上半场（行 0~3）应当推成 2 区、下半场（行 4~7）推成 1 区。
    ascii: [
        '00000000', '00000000', '00000000', '00000000',
        '00000000', '00000000', '00000000', '00000000',
    ],
    resourcePoints: [
        { row: 6, column: 1, pool: { wood: 1, ore: 3 } },
        { row: 1, column: 6, pool: { food: 2 } },
    ],
    spacing: { homeMinDistance: 2, resourceMinDistance: 3 },
};

/** 与推导结果**反着画**的自选图：地图自己画了分区就该以地图为准。 */
const PAINTED_LAYOUT: ZCMapLayout = {
    id: 'spawn-region-painted-test',
    version: 3,
    rows: 8,
    columns: 8,
    playerCount: 2,
    cityMode: 'select',
    ascii: [
        '11111111', '11111111', '11111111', '11111111',
        '22222222', '22222222', '22222222', '22222222',
    ],
};

function makeMap(layout: ZCMapLayout): ZCMatchMap {
    configureZCMap(layout);
    return {
        id: ZC_MAP_ID,
        rows: ZC_MAP_ROWS,
        columns: ZC_MAP_COLUMNS,
        playerHomeId: -1,
        enemyHomeId: -1,
        playerCount: ZC_MAP_PLAYER_COUNT,
        cityMode: 'select',
        homes: [],
        hexes: ZC_HEX_CONFIG,
        owners: ZC_HEX_CONFIG.map((hex) => getZCMapOwner(hex.id)),
        sections: ZC_HEX_CONFIG.map((hex) => getZCMapSection(hex.id)),
        regions: ZC_MAP_REGIONS,
        resourcePoints: ZC_MAP_RESOURCE_POINTS,
        spacing: ZC_MAP_SPACING,
    };
}

function sequence(...values: number[]): () => number {
    return () => values.shift() ?? 0;
}

const hexId = (row: number, column: number): number => row * 8 + column;

test('默认半区划分与地图编辑器同口径：2 人上下二分、4 人四象限、3 人上带 1/3 + 左右', () => {
    // 2 人：上半场 2 区、下半场 1 区（与编辑器 `defaultMirror` 的「1 区在下、2 区在上」一致）。
    assert.equal(defaultZCSectionAt(2, 8, 8, 0, 0), 2);
    assert.equal(defaultZCSectionAt(2, 8, 8, 3, 7), 2);
    assert.equal(defaultZCSectionAt(2, 8, 8, 4, 0), 1);
    assert.equal(defaultZCSectionAt(2, 8, 8, 7, 7), 1);
    // 奇数行时不出现"没人管"的中线：`rows - ceil(rows/2)` 恒等于 `floor(rows/2)`。
    assert.equal(defaultZCSectionAt(2, 9, 9, 3, 0), 2);
    assert.equal(defaultZCSectionAt(2, 9, 9, 4, 0), 1);
    // 4 人：四象限（1 下左 / 2 上左 / 3 下右 / 4 上右）。
    assert.equal(defaultZCSectionAt(4, 8, 8, 5, 1), 1);
    assert.equal(defaultZCSectionAt(4, 8, 8, 2, 1), 2);
    assert.equal(defaultZCSectionAt(4, 8, 8, 5, 6), 3);
    assert.equal(defaultZCSectionAt(4, 8, 8, 2, 6), 4);
    // 3 人：上带 1/3 归 2 区，其余按列平分给 1 区（左）/ 3 区（右）。
    const band = Math.max(1, Math.round(8 / 3));
    assert.equal(defaultZCSectionAt(3, 8, 8, 0, 0), 2);
    assert.equal(defaultZCSectionAt(3, 8, 8, band, 0), 1);
    assert.equal(defaultZCSectionAt(3, 8, 8, band, 7), 3);
});

test('★全中立格的自选图：半区按布局推导，双方都只能落在自己那一半', () => {
    const selection = new ZCSpawnSelection(makeMap(NEUTRAL_LAYOUT), sequence(0));
    const rivalHex = hexId(1, 2);
    const ownHex = hexId(5, 2);

    assert.equal(selection.regionOwnerOf(rivalHex), 'enemy', '上半场应推成 2 区 = 对方半区');
    assert.equal(selection.regionOwnerOf(ownHex), 'player', '下半场应推成 1 区 = 己方半区');

    const refused = selection.select('player', rivalHex);
    assert.equal(refused.ok, false, '★不能放置到对方的区域');
    assert.equal(refused.message, '不能放置到对方的区域');
    assert.equal(selection.select('player', ownHex).ok, true, '己方半区里应当可选');

    // 反向同样成立：AI 也不能跑到我方半区里落点。
    assert.equal(selection.select('enemy', ownHex).ok, false);
    assert.equal(selection.select('enemy', rivalHex).ok, true);
});

test('★地图自己画了分区时以地图为准，不被布局推导覆盖', () => {
    const selection = new ZCSpawnSelection(makeMap(PAINTED_LAYOUT), sequence(0));
    // 这张图故意画成「1 区在上、2 区在下」，与默认推导相反。
    assert.equal(selection.regionOwnerOf(hexId(0, 0)), 'player');
    assert.equal(selection.regionOwnerOf(hexId(7, 0)), 'enemy');
    assert.equal(selection.select('player', hexId(0, 1)).ok, true);
    assert.equal(selection.select('player', hexId(7, 1)).ok, false);
});

test('★AI 的候选集锁在自己半区：超时自动落点不会跑到对方半区', () => {
    const selection = new ZCSpawnSelection(makeMap(NEUTRAL_LAYOUT), sequence(0.99, 0.1, 0.9, 0.2, 0.4));
    // 候选集是 AI 与「超时兜底」的共同入口，必须逐格确定地守半区 ——
    // 只断言"随机抽到的那一格在对的半区"会靠运气假绿（`legalHexes` 放开也能蒙对）。
    for (const hex of selection.legalHexes('player')) {
        assert.equal(selection.regionOwnerOf(hex), 'player', `player 的候选集混进了半区外的 ${hex}`);
    }
    for (const hex of selection.legalHexes('enemy')) {
        assert.equal(selection.regionOwnerOf(hex), 'enemy', `enemy 的候选集混进了半区外的 ${hex}`);
    }
    selection.tick(10);
    assert.equal(selection.snapshot.finished, true);
    const homes = selection.result!.homes;
    assert.equal(selection.regionOwnerOf(homes.player), 'player');
    assert.equal(selection.regionOwnerOf(homes.enemy), 'enemy');
});

test('选点渲染的半区着色必须走 ZCSpawnSelection.regionOwnerOf（不许渲染层自己拼）', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    // 切片必须按**方法签名**取：`renderStatic` 在 `render()` 里先被调用过一次，
    // 用 `indexOf('renderStatic')` 会切出空串 ⇒ 断言恒绿（这正是要防的假绿）。
    const start = source.indexOf('renderSpawnSelection(selection: ZCSpawnSelection');
    //  end 标记用**方法签名**：形参早就从 `model: ZCGameModel` 换成 `frame: ZCGameRenderFrame` 了。
    //  切片过期会让边界取不到 ⇒ 这条恒红，而真口径（半区着色走 regionOwnerOf）反而没人守。
    const end = source.indexOf('renderStatic(frame: ZCGameRenderFrame)');
    assert.ok(start > 0 && end > start, `切片边界没取到（start=${start} end=${end}）`);
    const body = source.slice(start, end);
    assert.match(body, /selection\.regionOwnerOf\(config\.id\)/,
        '★半区归属只能由选点模型给出（地图画了用地图的、没画按布局推导）；渲染层自己拼一份会与禁用判定漂移');
    // 反向断言先剥注释（规则 104）：注释里提到老写法不算违规。
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /selection\.map\.owners\[/,
        '★别再回去读 `map.owners` 当半区 —— 自选图全是中立格，那样算出来永远是 neutral');
});
