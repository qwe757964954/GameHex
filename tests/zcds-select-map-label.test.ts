import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    configureZCMap,
    ZC_DEPTH_TENDENCY,
    ZC_MAP_REGIONS,
    ZC_TENDENCY_TEXT,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

const hexView = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
const renderWorld = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
const game = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const hintOverlay = readFileSync('assets/script/app/zcds/view/ZCSpawnRegionHintOverlay.ts', 'utf8');

test('spawn region hints render in a dedicated non-interactive overlay', () => {
    assert.match(renderWorld, /resolveZCSpawnRegionHints\(/);
    assert.match(renderWorld, /spawnRegionHintOverlay\.render\([^;]*hintsVisible/s);
    assert.doesNotMatch(renderWorld, /regionText/);
    assert.doesNotMatch(hexView, /regionText/);
    assert.match(hintOverlay, /class ZCSpawnRegionHintOverlay/);
    assert.match(hintOverlay, /UITransform/);
    assert.match(hintOverlay, /Graphics/);
    assert.match(hintOverlay, /Label/);
    assert.doesNotMatch(hintOverlay, /BlockInputEvents|TOUCH_START|TOUCH_END/);
});

test('spawn region hint overlay clears after selection and on render-world teardown', () => {
    assert.match(renderWorld, /clearSpawnRegionHints\(\): void/);
    assert.match(renderWorld, /spawnRegionHintOverlay\?\.clear\(\)/);
    assert.match(renderWorld, /destroy\(\): void[\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(game, /finishSpawnSelection\(\): void[\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(hintOverlay, /render\(hints: readonly IZCSpawnRegionHint\[\], visible: boolean\): void/);
    assert.match(hintOverlay, /clear\(\): void/);
});

test('自选主城地图不在正式战斗地块上显示金币等资源文字', () => {
  assert.match(hexView, /hideNeutralResourceLabel\?: boolean/);
  assert.match(hexView, /state\.neutralResourceId && !hideNeutralResourceLabel/);
  assert.match(renderWorld, /hideNeutralResourceLabel: model\.mapConfig\.cityMode === 'select'/);
});

/**
 * 选点阶段棋盘上那行小字 = **区域名标签**（`前区·速攻` 这种），画在 `map.regions` 的锚点格上，
 * 受「显示提示 / 收起提示」开关控制（默认开）。
 *
 * 2026-10-10 修的这一版：`select_river.json` 的 6 个 region 原本自带 `"text": "???"`，
 * 而 `ZCMapConfig` 的归一化是
 *   `text: typeof region.text === 'string' ? region.text : ZC_TENDENCY_TEXT[tendency]`
 * —— **只要 JSON 给了字符串就用它**，好好的兜底文案被顶掉，界面上就是一团「前区·???」。
 * 这条用例同时钉住两侧：地图数据不许再带占位 text，且归一化后的文案必须是兜底表里的正经词。
 */
test('★select_river 的区域文案由 tendency 推导，落盘的 "???" 占位必须清掉', () => {
    const layout = JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout;
    assert.ok(Array.isArray(layout.regions) && layout.regions.length > 0, 'select_river 必须圈了区域（选点阶段靠它出区域提示）');
    for (const region of layout.regions!) {
        assert.equal(region.text, undefined,
            `区域 ${region.section}/${region.depth} 不该自带 text（会顶掉 ZC_TENDENCY_TEXT 兜底）`);
    }

    configureZCMap(layout);
    assert.equal(ZC_MAP_REGIONS.length, layout.regions!.length, '归一化后区域数应与地图一致');
    for (const region of ZC_MAP_REGIONS) {
        const tendency = region.tendency ?? ZC_DEPTH_TENDENCY[region.depth];
        assert.equal(region.text, ZC_TENDENCY_TEXT[tendency],
            `区域 ${region.section}/${region.depth} 的文案应取 ZC_TENDENCY_TEXT[${tendency}]`);
        assert.doesNotMatch(String(region.text), /\?/, '区域文案里不许再有问号占位');
    }
});

test('region bubble layout leaves room for the longest label', () => {
    assert.match(hintOverlay, /const BUBBLE_WIDTH = 150/);
    assert.match(hintOverlay, /const BUBBLE_HEIGHT = 42/);
    assert.match(hintOverlay, /setContentSize\(BUBBLE_WIDTH - 12, BUBBLE_HEIGHT\)/);
});
