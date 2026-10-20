import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
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
const boardPrefab = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameBoard.prefab', 'utf8')) as any[];

test('spawn region hints render in a dedicated non-interactive overlay', () => {
    assert.match(renderWorld, /spawnRegionHintOverlay = new ZCSpawnRegionHintOverlay\(this\.boardLayer\('CooldownOverlay'\)\)/);
    assert.match(renderWorld, /spawnRegionHintOverlay\.render\([^;]*hintsVisible/s);
    assert.match(renderWorld, /spawnRegionHintOverlay\.render\(\s*this\.spawnRegionHints,\s*hintsVisible,\s*Math\.abs\(this\.options\.mapLayer\.scale\.x\) \|\| 1,/);
    assert.doesNotMatch(renderWorld, /regionText/);
    assert.doesNotMatch(hexView, /regionText/);
    assert.match(hintOverlay, /class ZCSpawnRegionHintOverlay/);
    assert.match(hintOverlay, /UITransform/);
    assert.match(hintOverlay, /Graphics/);
    assert.match(hintOverlay, /Label/);
    assert.doesNotMatch(hintOverlay, /BlockInputEvents|Button|TOUCH_START|TOUCH_END|\.on\(/);
    const root = boardPrefab.find((object) => object?.__type__ === 'cc.Node' && object._name === 'ZCGameBoard');
    assert.ok(root, 'ZCGameBoard root exists');
    const boardLayers = root._children.map((child: { __id__: number }) => boardPrefab[child.__id__]);
    const layers = boardLayers.map((layer: { _name: string }) => layer._name);
    assert.equal(layers.at(-1), 'CooldownOverlay', 'overlay parent is the highest board layer');
    for (const name of ['HexLayer', 'CooldownOverlay']) {
        const layer = boardLayers.find((candidate: { _name: string }) => candidate._name === name);
        assert.deepEqual([layer._lpos.x, layer._lpos.y, layer._lpos.z], [0, 0, 0], `${name} stays at board origin`);
        assert.deepEqual([layer._lscale.x, layer._lscale.y, layer._lscale.z], [1, 1, 1], `${name} keeps board scale`);
    }
});

test('spawn hint descriptors are cached at map setup rather than rebuilt per selection frame', () => {
    const renderSelection = renderWorld.match(/renderSpawnSelection\(selection:[\s\S]*?\n    clearSpawnRegionHints\(\)/)?.[0];
    const initialize = renderWorld.match(/initialize\(mapConfig:[\s\S]*?\n    \}/)?.[0];
    assert.ok(renderSelection, 'selection render method is present');
    assert.ok(initialize, 'map initialization method is present');
    assert.match(initialize, /cacheSpawnRegionHints\(mapConfig\)/);
    assert.match(renderSelection, /spawnRegionHints/);
    assert.doesNotMatch(renderSelection, /resolveZCSpawnRegionHints|new Map<number, \{ x: number; y: number \}>/);
    assert.match(renderWorld, /private cacheSpawnRegionHints\(/);
    assert.match(renderWorld, /clearSpawnRegionHints\(\): void \{[\s\S]*?spawnRegionHints = \[\]/);
});

test('region bubble nodes reuse anchors, follow visibility, draw text, and clear from the board layer', () => {
    const { load, FakeNode, cc } = loadViews();
    cc.UITransform = class { setContentSize() {} };
    cc.Label.HorizontalAlign = { CENTER: 'center' };
    cc.Label.VerticalAlign = { CENTER: 'center' };
    const { ZCSpawnRegionHintOverlay } = load('./ZCSpawnRegionHintOverlay');
    const parent = new FakeNode('CooldownOverlay');
    const overlay = new ZCSpawnRegionHintOverlay(parent);
    const initial = [{ depth: 'front', label: '速攻', x: 17, y: 32 }];

    overlay.render(initial, true, 0.5);
    const root = parent.children[0];
    const bubble = root.children[0];
    const label = bubble.children[0].getComponent(cc.Label);
    const graphics = bubble.getComponent(cc.Graphics);
    const backgroundCommands = graphics.commands;
    let labelText = label.string;
    let labelWrites = 0;
    Object.defineProperty(label, 'string', {
        configurable: true,
        get: () => labelText,
        set: (next: string) => { labelWrites += 1; labelText = next; },
    });
    assert.equal(root.active, true);
    assert.deepEqual([bubble.position.x, bubble.position.y], [17, 32]);
    assert.deepEqual([bubble.scale.x, bubble.scale.y], [2, 2], 'bubble cancels the current map zoom');
    assert.equal(label.string, '\u524d\u533a \u00b7 \u901f\u653b');
    assert.ok(backgroundCommands.some((command: { kind: string }) => command.kind === 'roundRect'));

    overlay.render([{ ...initial[0], x: -24, y: 8, label: '控场' }], true, 0.25);
    assert.equal(root.children.length, 1, 're-render should reuse the existing bubble');
    assert.equal(root.children[0], bubble);
    assert.deepEqual([bubble.position.x, bubble.position.y], [-24, 8]);
    assert.deepEqual([bubble.scale.x, bubble.scale.y], [4, 4], 'bubble size remains constant as the map zooms out');
    assert.equal(label.string, '\u524d\u533a \u00b7 \u63a7\u573a');
    assert.equal(labelWrites, 1, 'only changed label text should be written');
    assert.equal(graphics.commands, backgroundCommands, 'static bubble background should not be redrawn');

    overlay.render([{ ...initial[0], x: -24, y: 8, label: '控场' }], true, 0.25);
    assert.equal(labelWrites, 1, 'unchanged label text should not be written again');
    assert.equal(graphics.commands, backgroundCommands, 'repeated visible frames should reuse the background');

    overlay.render([{ ...initial[0], x: 100, y: 200, label: '隐藏更新' }], false, 0.1);
    assert.equal(root.active, false);
    assert.deepEqual([bubble.position.x, bubble.position.y], [-24, 8], 'hidden frames should not update anchors');
    assert.equal(labelWrites, 1, 'hidden frames should not write labels');
    assert.equal(graphics.commands, backgroundCommands, 'hidden frames should not redraw backgrounds');
    overlay.clear();
    assert.equal(parent.children.length, 0);
    assert.equal(root.isValid, false);
});

test('spawn region hint overlay clears after selection and on render-world teardown', () => {
    assert.match(renderWorld, /clearSpawnRegionHints\(\): void/);
    assert.match(renderWorld, /spawnRegionHintOverlay\?\.clear\(\)/);
    assert.match(renderWorld, /destroy\(\): void[\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(game, /finishSpawnSelection\(\): void[\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(hintOverlay, /render\(hints: readonly IZCSpawnRegionHint\[\], visible: boolean, mapScale: number\): void/);
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
