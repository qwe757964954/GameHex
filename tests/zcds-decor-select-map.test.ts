import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import {
    ZC_HEX_CONFIG,
    ZC_MAP_ART,
    ZC_MAP_CITY_MODE,
    ZC_MAP_COLUMNS,
    ZC_MAP_ROWS,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

const GAME_SRC = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');

// 自选主城图（`cityMode = 'select'`）：开局先选点、**这一阶段还没有 ZCGameModel**，
// 而固定主城图一进来就建模。装饰此前从 `this.model.mapConfig` 取数 ⇒ 自选图一条都铺不出来。
configureZCMap(JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout);

/** 地图 JSON 里所有装饰键（`"行,列"`），只要按格键、不要分区键。art 名兼容字符串与多格对象。 */
function decorEntries(): Array<[string, string | { art: string }]> {
    const tiles = ZC_MAP_ART.tiles ?? {};
    return Object.entries(tiles).filter(([key]) => /^\d+,\d+$/.test(key)) as Array<[string, string | { art: string }]>;
}

/** `ZCGame.installMapDecor` 的方法体（从声明到同缩进的收尾大括号）。 */
function installMapDecorBody(): string {
    const start = GAME_SRC.indexOf('private installMapDecor');
    assert.ok(start >= 0, 'ZCGame 里找不到 installMapDecor');
    const end = GAME_SRC.indexOf('\n    }\n', start);
    assert.ok(end > start, 'installMapDecor 的方法体没解析出来');
    return GAME_SRC.slice(start, end);
}

test('自选主城图本身带装饰：数据侧不是「没摆装饰」，所以症状只能出在取数口径上', () => {
    assert.equal(ZC_MAP_CITY_MODE, 'select', '夹具失效：这张图已经不是自选主城图');
    const entries = decorEntries();
    assert.ok(entries.length > 0, 'select_river.json 里没有装饰键，夹具失效');
    // 与固定主城图（corset 的 50 条）同一量级 —— 不是「自选图天生画得少」。
    assert.ok(entries.length >= 30, `自选图只有 ${entries.length} 条装饰，量级对不上`);
    // 装饰键全部落在虚空格上（与 corset 同一条硬约束）。
    for (const [key] of entries) {
        const [row, column] = key.split(',').map(Number);
        assert.ok(row >= 0 && row < ZC_MAP_ROWS && column >= 0 && column < ZC_MAP_COLUMNS, `${key} 越界`);
        const hex = ZC_HEX_CONFIG.find((item) => item.row === row && item.column === column)!;
        assert.ok(hex, `${key} 在地图里找不到对应格`);
        assert.equal(hex.playable, false, `${key} 不是虚空格，装饰不该出现在这里`);
    }
});

test('自选主城阶段没有 model，装饰照样铺得出来：取数只认地图配置', () => {
    const { load } = loadViews();
    const { buildDecorPlacements } = load('./ZCGameViewUtil');

    // 模拟 `ZCGame.createGame` 的自选分支：手上只有 `setupConfig.map`（ZCMatchMap），
    // 没有也不该有 ZCGameModel —— 这正是自选主城阶段的真实状态。
    const map = { hexes: ZC_HEX_CONFIG, art: ZC_MAP_ART };
    const entries = decorEntries();
    const frames = new Map(entries.map(([, art]) => [art, { originalSize: { width: 128, height: 128 } }]));
    const placements = buildDecorPlacements(map.hexes, map.art?.tiles, (art) => {
        const frame = frames.get(art);
        return frame ? frame.originalSize : null;
    });

    assert.equal(placements.length, entries.length, '每条装饰都该算出落点');
    assert.ok(placements.length > 0);
});

test('判据钉死取数口径：installMapDecor 不得从 this.model 取地图数据', () => {
    const body = installMapDecorBody();
    assert.match(body, /installMapDecor\(\s*map: ZCMatchMap\s*,/, '入参必须是本局地图配置');
    // 装饰坐标只由 `hexes` 的 x/y 决定，与主城/分区无关 ⇒ 选点前后铺一次就够，
    // 不需要「等 model 建好再补铺一次」（`finishSpawnSelection` 里也确实没有补铺）。
    assert.match(body, /map\.art\?\.tiles/);
    assert.match(body, /buildDecorPlacements\(map\.hexes/);
    assert.doesNotMatch(body, /this\.model/, '从 this.model 取数会让自选主城图（无 model）一条装饰都铺不出来');

    // 调用点必须传地图配置：两个分支共用同一张 `setupConfig.map`，自选分支才有数据可铺。
    assert.match(
        GAME_SRC,
        /this\.installMapDecor\(setupConfig\.map,\s*prepared\.decorFrames\)/,
        'createGame 必须把 setupConfig.map 传给 installMapDecor',
    );
    // 反向：自选分支不建 model，所以「等 model 建好再铺」这条路在自选图上根本不存在。
    const spawnStart = GAME_SRC.indexOf('if (selectingSpawn) {');
    const elseStart = GAME_SRC.indexOf('} else {', spawnStart);
    assert.ok(elseStart > spawnStart, 'createGame 的自选/正式分支没解析出来');
    const spawnBranch = GAME_SRC.slice(spawnStart, elseStart);
    assert.doesNotMatch(spawnBranch, /new ZCGameModel\(/, '自选分支不该建模（判据前提）');
    assert.doesNotMatch(spawnBranch, /installMapDecor\(/, '自选分支里不能再单独铺一次装饰');
});