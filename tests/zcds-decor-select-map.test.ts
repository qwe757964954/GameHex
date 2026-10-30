import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap } from '../assets/script/app/zcds/model/ZCMapConfig';
import {
    ZC_MAP_ART,
    ZC_MAP_CITY_MODE,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';
import { assetPath } from './helpers/asset-paths';

const GAME_SRC = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const layout = JSON.parse(
    readFileSync(assetPath('config/maps/select_river.json'), 'utf8'),
) as ZCMapLayout;
layout.art = {
    ...(layout.art ?? {}),
    freeDecor: [{
        id: 'select-map-rock',
        art: 'image/decor/rock/large',
        x: 125,
        y: -48,
        width: 260,
        height: 130,
        rotation: 8,
        flipX: false,
        flipY: true,
    }],
};
configureZCMap(layout);

/** `ZCGame.installMapDecor` 的方法体（从声明到同缩进的收尾大括号）。 */
function installMapDecorBody(): string {
    const start = GAME_SRC.indexOf('private installMapDecor');
    assert.ok(start >= 0, 'ZCGame 里找不到 installMapDecor');
    const end = GAME_SRC.indexOf('\n    }\n', start);
    assert.ok(end > start, 'installMapDecor 的方法体没解析出来');
    return GAME_SRC.slice(start, end);
}

test('自选主城图在建模前也能从地图配置生成自由装饰', () => {
    assert.equal(ZC_MAP_CITY_MODE, 'select', '夹具失效：这张图已经不是自选主城图');
    const { load } = loadViews();
    const { buildDecorPlacements } = load('./ZCGameViewUtil');
    const placements = buildDecorPlacements(
        ZC_MAP_ART.freeDecor,
        () => ({ width: 512, height: 256 }),
    );

    assert.equal(placements.length, 1);
    assert.equal(placements[0].id, 'free-select-map-rock');
    assert.equal(placements[0].x, 125);
    assert.equal(placements[0].y, -48);
});

test('installMapDecor 只从本局地图读取 freeDecor，不依赖 model', () => {
    const body = installMapDecorBody();
    assert.match(body, /installMapDecor\(\s*map: ZCMatchMap\s*,/, '入参必须是本局地图配置');
    assert.match(body, /buildDecorPlacements\(map\.art\?\.freeDecor/);
    assert.doesNotMatch(body, /map\.art\?\.tiles/, '旧按格装饰不再参与运行时渲染');
    assert.doesNotMatch(body, /this\.model/, '自选主城阶段还没有 model，装饰取数不能依赖它');

    assert.match(
        GAME_SRC,
        /this\.installMapDecor\(setupConfig\.map,\s*prepared\.decorFrames\)/,
        'createGame 必须把 setupConfig.map 传给 installMapDecor',
    );
});
