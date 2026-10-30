import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    configureZCMap,
    getZCMapOwner,
    getZCMapSection,
    ZC_HEX_CONFIG,
    ZC_MAP_COLUMNS,
    ZC_MAP_ID,
    ZC_MAP_PLAYER_COUNT,
    ZC_MAP_REGIONS,
    ZC_MAP_HOME_CANDIDATES,
    ZC_MAP_RESOURCE_POINTS,
    ZC_MAP_ROWS,
    ZC_MAP_SPACING,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import type { ZCMatchConfig, ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCSnapshotCodec } from '../assets/script/app/zcds/model/ZCSnapshotCodec';
import {
    resolveZCMapResources,
    resolveZCSpawnMatchConfig,
    ZCSpawnSelection,
} from '../assets/script/app/zcds/model/ZCSpawnSelection';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';
import { assetPath } from './helpers/asset-paths';

installZCNeutralTestCatalog();

const SELECT_LAYOUT: ZCMapLayout = {
    id: 'spawn-selection-test',
    version: 3,
    rows: 8,
    columns: 8,
    playerCount: 2,
    cityMode: 'select',
    ascii: [
        '22222222', '22222202', '22222222', '22222222',
        '11111111', '11111111', '10111111', '11111111',
    ],
    homeCandidates: [
        { section: 1, cells: Array.from({ length: 32 }, (_, index) => index + 32) },
        { section: 2, cells: Array.from({ length: 32 }, (_, index) => index) },
    ],
    // 2026-10-26：点位只写组合 ID —— 第一点走「混合资源」（金币/兵团/充能），第二点走「固定金矿」。
    resourcePoints: [
        { row: 6, column: 1, groupId: 13002 },
        { row: 1, column: 6, groupId: 13005 },
    ],
    spacing: { homeMinDistance: 2, resourceMinDistance: 3 },
};

function makeMap(layout: ZCMapLayout = SELECT_LAYOUT): ZCMatchMap {
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
        homeCandidates: ZC_MAP_HOME_CANDIDATES,
        resourcePoints: ZC_MAP_RESOURCE_POINTS,
        spacing: ZC_MAP_SPACING,
    };
}

function sequence(...values: number[]): () => number {
    return () => values.shift() ?? 0;
}

test('select maps require candidate cells for every player section', () => {
    const partialLayout = { ...SELECT_LAYOUT, homeCandidates: [{ section: 2, cells: [0] }] };
    assert.throws(
        () => configureZCMap(partialLayout),
        /主城候选范围必须覆盖所有分区/,
    );
    assert.throws(
        () => new ZCSpawnSelection({ ...makeMap(), homeCandidates: partialLayout.homeCandidates }, sequence(0)),
        /player 未配置可选主城区域/,
    );
});

test('三张河道自选主城地图都按各自前中后区并集限制游戏内落点', () => {
    for (const file of ['river_custom.json', 'river_custom_new.json', 'select_river.json']) {
        const layout = JSON.parse(readFileSync(assetPath(`config/maps/${file}`), 'utf8')) as ZCMapLayout;
        const selection = new ZCSpawnSelection(makeMap(layout), sequence(0));
        for (const [owner, section] of [['player', 1], ['enemy', 2]] as const) {
            const zoneCells = layout.regions?.filter((region) => region.section === section)
                .flatMap((region) => region.cells) ?? [];
            assert.ok(zoneCells.length, `${file} 缺少 ${section} 区前 / 中 / 后区域`);
            const resourceCells = new Set((layout.resourcePoints ?? []).map((point) => point.row * layout.columns + point.column));
            const expected = zoneCells.filter((id) => !resourceCells.has(id)).sort((a, b) => a - b);
            assert.deepEqual(
                selection.legalHexes(owner, false).sort((a, b) => a - b),
                expected,
                `${file} ${section} 区应允许所有未被资源占用的前 / 中 / 后区域格`,
            );
            const selectedHexId = selection.snapshot.selections[owner].selectedHexId;
            if (selectedHexId !== null) {
                assert.ok(expected.includes(selectedHexId), `${file} ${section} 区的预置主城必须落在纵深区域内`);
            }
        }
    }
});

test('配置了前中后区时主城候选范围取区域并集并覆盖旧 homeCandidates 字段', () => {
    const layout: ZCMapLayout = {
        ...SELECT_LAYOUT,
        regions: [
            { section: 1, depth: 'front', cells: [55] },
            { section: 1, depth: 'back', cells: [56] },
            { section: 2, depth: 'mid', cells: [0, 1] },
        ],
        homeCandidates: [
            { section: 1, cells: [56] },
            { section: 2, cells: [0] },
        ],
    };
    const selection = new ZCSpawnSelection(makeMap(layout), sequence(0));

    assert.deepEqual(selection.legalHexes('player', false).sort((a, b) => a - b), [55, 56]);
    assert.match(selection.invalidReason('player', 57) ?? '', /前.?中.?后|区域/);
    assert.equal(selection.select('player', 55).ok, true, '不在旧候选列表里的区域格仍可选');
});

test('自选主城地图没有纵深区域或旧候选配置时拒绝进入选点', () => {
    const map = makeMap();
    assert.throws(
        () => new ZCSpawnSelection({ ...map, regions: [], homeCandidates: [] }, sequence(0)),
        /player 未配置可选主城区域/,
    );
});

test('玩家确认会把全局窗口压到 3 秒，AI 在 1 秒后跟随确认', () => {
    const selection = new ZCSpawnSelection(makeMap(), sequence(0.9, 0.25, 0.8, 0));
    const resourceHex = 6 * 8 + 1;
    const playerHex = 7 * 8;

    assert.equal(selection.select('player', resourceHex).ok, false, '资源点所在格不可选');
    assert.equal(selection.select('player', playerHex).ok, true);
    assert.equal(selection.confirm('player').ok, true);
    assert.equal(selection.snapshot.remainingSeconds, 3);

    selection.tick(0.99);
    assert.equal(selection.snapshot.finished, false);
    selection.tick(0.01);
    assert.equal(selection.snapshot.finished, true);
    assert.equal(selection.result?.homes.player, playerHex);
    assert.ok(selection.result?.homes.enemy !== undefined);
    assert.equal(selection.result?.resolvedResources.length, 2);
    // 第一个点位引用「混合资源」组（13002）⇒ 抽到的必然是组内三项之一；
    // 第二个点位引用「固定金矿」（13005）⇒ 唯一项，恒为金矿项。
    const mixedItems = [ZC_TEST_ITEM.MixedGold, ZC_TEST_ITEM.MixedUnit, ZC_TEST_ITEM.MixedCharge];
    assert.ok(mixedItems.includes(selection.result!.resolvedResources[0].itemId),
        `混合资源组抽到了组外资源项：${selection.result?.resolvedResources[0].itemId}`);
    assert.equal(selection.result?.resolvedResources[1].itemId, ZC_TEST_ITEM.Mine);
});

test('后确认方必须与已确认主城之间留下至少 N 个空格', () => {
    // AI 的第一个随机数令其在 4 秒确认；先**显式**给 AI 选好落点（对方半区里紧贴玩家那一格），
    // tick 到 4 秒时 `autoConfirm` 会确认它 —— 不再靠 `0.87 × 合法格数` 的取整去撞一格，
    // 那样候选集一变（例如按半区收窄）就会因为"撞不到"而假红/假绿。
    const selection = new ZCSpawnSelection(makeMap(), sequence(0));
    const playerBoundaryHex = 4 * 8 + 4;
    const enemyAdjacentHex = 3 * 8 + 3;
    assert.equal(selection.select('player', playerBoundaryHex).ok, true);
    assert.equal(selection.select('enemy', enemyAdjacentHex).ok, true);

    selection.tick(4);
    assert.equal(selection.snapshot.selections.enemy.confirmedHexId, enemyAdjacentHex);
    assert.match(selection.snapshot.selections.player.invalidReason ?? '', /距离过近/);
    assert.equal(selection.confirm('player').ok, false);
});

test('倒计时结束时会自动为未选择方随机合法落点并生成可开局配置', () => {
    const selection = new ZCSpawnSelection(makeMap(), sequence(0.99, 0.1, 0.9, 0.2, 0.4));
    selection.tick(10);

    assert.equal(selection.snapshot.finished, true);
    assert.equal(selection.snapshot.remainingSeconds, 0);
    const result = selection.result!;
    assert.ok(Number.isInteger(result.homes.player));
    assert.ok(Number.isInteger(result.homes.enemy));

    const source = { map: makeMap() } as ZCMatchConfig;
    const resolved = resolveZCSpawnMatchConfig(source, result);
    assert.equal(resolved.map.cityMode, 'fixed');
    assert.deepEqual(resolved.map.homes, [result.homes.player, result.homes.enemy]);
    assert.deepEqual(resolved.map.resolvedResources, result.resolvedResources);
});

test('资源点生成后固定为中立格且开局一律未消费（相邻自动领取交给模型层）', () => {
    const map = makeMap();
    const playerResourceId = 6 * 8 + 1;
    const enemyResourceId = 1 * 8 + 6;
    const adjacentHome = map.hexes[playerResourceId].neighbors
        .find((id) => map.sections?.[id] === 1 && id !== playerResourceId)!;
    const enemyHome = map.hexes.find((hex) => map.sections?.[hex.id] === 2
        && !map.hexes[enemyResourceId].neighbors.includes(hex.id))!.id;
    const resolvedMap: ZCMatchMap = {
        ...map,
        cityMode: 'fixed',
        homes: [adjacentHome, enemyHome],
        playerHomeId: adjacentHome,
        enemyHomeId: enemyHome,
        resolvedResources: [
            { hexId: playerResourceId, section: 0, itemId: ZC_TEST_ITEM.Gold },
            { hexId: enemyResourceId, section: 0, itemId: ZC_TEST_ITEM.Mine },
        ],
    };
    const config = {
        map: resolvedMap,
        rules: {
            hqMaxHp: 100, wallMaxHp: 10, matchDurationSeconds: 180,
            initialGold: 100, initialGuaranteedMine: 0,
        },
        tiles: { mine: { price: 25 } },
        tileWeights: [{ type: 'mine', weight: 1, initialCountLimit: 0, setCountLimit: 0 }],
        playerDeck: [], enemyDeck: [], units: [], bonds: [], counters: [], goldPity: 0,
    } as unknown as ZCMatchConfig;

    const snapshot = ZCSnapshotCodec.createInitialState(config, () => 0);
    assert.equal(snapshot.hexes[playerResourceId].owner, 'neutral');
    assert.equal(snapshot.hexes[playerResourceId].neutralResourceId, ZC_TEST_ITEM.Gold);
    // ⚠️ 2026-10-08 起**不再**在这里按「与主城相邻」预置解锁。
    // 相邻即自动领取统一由 `ZCGameModel.claimAdjacentNeutralResources` 结算（挂在 refreshTileStates 里）——
    // 放在开局预置会让资源点被标成已消费却**一次奖励都不发**（那正是「翻了没获取」的成因）。
    assert.equal(snapshot.hexes[playerResourceId].developmentResolved, false, '开局一律未消费，交给相邻自动领取');
    assert.equal(snapshot.hexes[playerResourceId].state, 'occupiable', '资源点在自动领取前保持可占据');
    assert.equal(snapshot.hexes[enemyResourceId].owner, 'neutral');
    assert.equal(snapshot.hexes[enemyResourceId].developmentResolved, false, '未相邻资源同样未消费');
});

test('固定主城地图也在开局冻结资源点，不依赖自选主城流程', () => {
    const map = makeMap();
    const resolved = resolveZCMapResources({ ...map, cityMode: 'fixed' }, sequence(0.9, 0));
    // 点位 1 = 混合资源（13002）：roll 0.9 落在充能段 [8000,10000) ⇒ 1300203；
    // 点位 2 = 固定金矿（13005）：唯一项，无论 roll 都出 1300501。
    assert.deepEqual(resolved, [
        { hexId: 6 * 8 + 1, section: 0, itemId: ZC_TEST_ITEM.MixedCharge },
        { hexId: 1 * 8 + 6, section: 0, itemId: ZC_TEST_ITEM.Mine },
    ]);
});

test('configured home candidate cells restrict manual, default, and automatic spawn choices', () => {
    const playerHome = 7 * 8;
    const enemyHome = 0;
    const layout: ZCMapLayout = {
        ...SELECT_LAYOUT,
        homeCandidates: [
            { section: 1, cells: [playerHome] },
            { section: 2, cells: [enemyHome] },
        ],
    };
    const selection = new ZCSpawnSelection(makeMap(layout), sequence(0.99));
    assert.deepEqual(selection['map'].homeCandidates, layout.homeCandidates);
    const disallowedPlayerCell = playerHome + 1;

    assert.equal(selection.snapshot.selections.player.selectedHexId, playerHome);
    assert.match(selection.invalidReason('player', disallowedPlayerCell) ?? '', /候选/);
    assert.equal(selection.select('player', disallowedPlayerCell).ok, false);
    selection.tick(10);
    assert.equal(selection.result?.homes.player, playerHome);
    assert.equal(selection.result?.homes.enemy, enemyHome);
});

test('★资源点位只写组合 ID：组内按权重（万分比）抽一项，权重全 0 的草稿组不出资源', () => {
    // 13002「混合资源」：1300201 金币 5000 / 1300202 兵团 3000 / 1300203 充能 2000。
    const map = makeMap({ ...SELECT_LAYOUT, resourcePoints: [{ row: 6, column: 1, groupId: 13002 }] });
    const draws = [0, 0.45, 0.55, 0.85]
        .map((roll) => resolveZCMapResources(map, () => roll)[0].itemId);
    assert.deepEqual(draws, [
        ZC_TEST_ITEM.MixedGold, ZC_TEST_ITEM.MixedGold, ZC_TEST_ITEM.MixedUnit, ZC_TEST_ITEM.MixedCharge,
    ], '抽签结果按组内累计权重切段：落到 [0,5000) 金币 / [5000,8000) 兵团 / [8000,10000) 充能');

    // 13006「固定兵营」当前 weight = 0（表里标注草稿）⇒ 该点位本局没有资源，不写进快照。
    const draft = makeMap({ ...SELECT_LAYOUT, resourcePoints: [{ row: 6, column: 1, groupId: 13006 }] });
    assert.equal(resolveZCMapResources(draft, () => 0.1).length, 0, '全 0 权重的组合不该产出资源项');

    // 组合 ID 不存在（策划填错号）⇒ 同样不出资源，而不是把报错抛到对局里。
    const missing = makeMap({ ...SELECT_LAYOUT, resourcePoints: [{ row: 6, column: 1, groupId: 99999 }] });
    assert.equal(resolveZCMapResources(missing, () => 0.1).length, 0);
});
