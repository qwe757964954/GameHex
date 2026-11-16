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
import { assetPath } from './helpers/asset-paths';

const hexView = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
const renderWorld = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
const game = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
const hintOverlay = readFileSync('assets/script/app/zcds/view/ZCSpawnRegionHintOverlay.ts', 'utf8');
const boardPrefab = JSON.parse(readFileSync(assetPath('ui/game/ZCGameBoard.prefab'), 'utf8')) as any[];
const hintPrefab = JSON.parse(readFileSync(assetPath('ui/game/SpawnRegionHint.prefab'), 'utf8')) as any[];

/** 与 SpawnRegionHint.prefab 同构的最小桩：根 Sprite(SLICED) + Label 子节点。 */
function hintPrefabFixture(FakeNode: any, cc: any) {
    return {
        make: () => {
            const root = new FakeNode('SpawnRegionHint');
            const rootTransform = root.addComponent(cc.UITransform);
            rootTransform.setContentSize(150, 42);
            const sprite = root.addComponent(cc.Sprite);
            sprite.node = root;
            sprite.type = cc.Sprite.Type.SLICED;
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            sprite.trim = false;
            const labelNode = new FakeNode('Label');
            labelNode.setPosition(0, 5, 0);
            const labelTransform = labelNode.addComponent(cc.UITransform);
            labelTransform.setContentSize(138, 42);
            const label = labelNode.addComponent(cc.Label);
            label.string = '';
            label.overflow = cc.Label.Overflow.SHRINK;
            label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
            label.verticalAlign = cc.Label.VerticalAlign.CENTER;
            labelNode.setParent(root);
            return root;
        },
    };
}

test('spawn region hints render in a dedicated non-interactive overlay', () => {
    assert.match(renderWorld, /spawnRegionHintOverlay = new ZCSpawnRegionHintOverlay\(/);
    assert.match(renderWorld, /this\.boardLayer\('CooldownOverlay'\)/);
    assert.match(renderWorld, /this\.options\.spawnRegionFrames \?\? null/);
    assert.match(renderWorld, /spawnRegionHintOverlay\.render\([^;]*hintsVisible/s);
    // 缩放值在整盘重算入口算一次（`mapScale`），提示气泡直接复用同一个数。
    assert.match(renderWorld, /const mapScale = Math\.abs\(this\.options\.mapLayer\.scale\.x\) \|\| 1;/);
    assert.match(renderWorld, /spawnRegionHintOverlay\.render\(\s*this\.spawnRegionHints,\s*hintsVisible,\s*mapScale,/);
    assert.doesNotMatch(renderWorld.replace(/\/\/[^\n]*/g, ''), /regionText/);

    assert.match(hintOverlay, /class ZCSpawnRegionHintOverlay/);
    assert.match(hintOverlay, /UITransform/);
    assert.doesNotMatch(hintOverlay, /Graphics/, '气泡底由 prefab 的九宫格 Sprite 负责，不再有 Graphics 兜底');
    assert.match(hintOverlay, /Label/);
    const hintRoot = hintPrefab.find((entry) => entry?.__type__ === 'cc.UITransform' && entry._contentSize?.width === 150);
    assert.ok(hintRoot, 'SpawnRegionHint.prefab 根节点必须是 150×42');
    const hintSprite = hintPrefab.find((entry) => entry?.__type__ === 'cc.Sprite');
    assert.equal(hintSprite?._type, 1, '气泡底必须在 prefab 里设为九宫格 SLICED');
    assert.match(hintOverlay, /SPAWN_REGION_HINT_PREFAB/);
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
    cc.Label.Overflow = { NONE: 0, SHRINK: 1, CLAMP: 2, RESIZE_HEIGHT: 3 };
    const { ZCSpawnRegionHintOverlay } = load('./ZCSpawnRegionHintOverlay');
    const parent = new FakeNode('CooldownOverlay');
    const overlay = new ZCSpawnRegionHintOverlay(parent, null, hintPrefabFixture(FakeNode, cc));
    const initial = [{ depth: 'front', label: '速攻', x: 17, y: 32 }];

    overlay.render(initial, true, 0.5);
    const root = parent.children[0];
    const bubble = root.children[0];
    const label = bubble.getChildByName('Label').getComponent(cc.Label);
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
    assert.ok(bubble.getComponent(cc.Sprite), '气泡底来自 prefab 的 Sprite');

    overlay.render([{ ...initial[0], x: -24, y: 8, label: '控场' }], true, 0.25);
    assert.equal(root.children.length, 1, 're-render should reuse the existing bubble');
    assert.equal(root.children[0], bubble);
    assert.deepEqual([bubble.position.x, bubble.position.y], [-24, 8]);
    assert.deepEqual([bubble.scale.x, bubble.scale.y], [4, 4], 'bubble size remains constant as the map zooms out');
    assert.equal(label.string, '\u524d\u533a \u00b7 \u63a7\u573a');
    assert.equal(labelWrites, 1, 'only changed label text should be written');

    overlay.render([{ ...initial[0], x: -24, y: 8, label: '控场' }], true, 0.25);
    assert.equal(labelWrites, 1, 'unchanged label text should not be written again');

    overlay.render([{ ...initial[0], x: 100, y: 200, label: '隐藏更新' }], false, 0.1);
    assert.equal(root.active, false);
    assert.deepEqual([bubble.position.x, bubble.position.y], [-24, 8], 'hidden frames should not update anchors');
    assert.equal(labelWrites, 1, 'hidden frames should not write labels');
    overlay.clear();
    assert.equal(parent.children.length, 0);
    assert.equal(root.isValid, false);
});

test('region bubbles use frame_02 red for front and frame_01 green for mid/back when frames are provided', () => {
    const { load, FakeNode, cc } = loadViews();
    cc.UITransform = class { setContentSize() {} };
    cc.Label.HorizontalAlign = { CENTER: 'center' };
    cc.Label.VerticalAlign = { CENTER: 'center' };
    cc.Label.Overflow = { NONE: 0, SHRINK: 1, CLAMP: 2, RESIZE_HEIGHT: 3 };
    const { ZCSpawnRegionHintOverlay } = load('./ZCSpawnRegionHintOverlay');
    const parent = new FakeNode('CooldownOverlay');
    const frame01 = new cc.SpriteFrame();
    const frame02 = new cc.SpriteFrame();
    const overlay = new ZCSpawnRegionHintOverlay(parent, { front: frame02, mid: frame01, back: frame01 }, hintPrefabFixture(FakeNode, cc));
    const hints = [
        { depth: 'front', label: '速攻', x: 10, y: 20 },
        { depth: 'mid', label: '控场', x: -10, y: 40 },
        { depth: 'back', label: '发育', x: 30, y: -5 },
    ];

    overlay.render(hints, true, 0.5);
    const root = parent.children[0];
    const frontSprite = root.children[0].getComponent(cc.Sprite);
    const midSprite = root.children[1].getComponent(cc.Sprite);
    const backSprite = root.children[2].getComponent(cc.Sprite);
    assert.ok(frontSprite && midSprite && backSprite, '气泡底应为 prefab 的 Sprite（九宫格）');
    assert.equal(root.children[0].getComponent(cc.Graphics), null, 'prefab 不含 Graphics');
    assert.equal(frontSprite.spriteFrame, frame02, '前区（速攻）用红色 frame_02');
    assert.equal(midSprite.spriteFrame, frame01, '中区（控场）用绿色 frame_01');
    assert.equal(backSprite.spriteFrame, frame01, '后区（发育）用绿色 frame_01');
    for (const sprite of [frontSprite, midSprite, backSprite]) {
        assert.equal(sprite.type, cc.Sprite.Type.SLICED, '九宫格拉伸');
        assert.equal(sprite.sizeMode, cc.Sprite.SizeMode.CUSTOM);
        assert.equal(sprite.trim, false);
    }
    const label = root.children[0].getChildByName('Label').getComponent(cc.Label);
    assert.equal(label.overflow, cc.Label.Overflow.SHRINK, '文字必须走对齐框（NONE 时 verticalAlign 不生效）');
    assert.equal(root.children[0].getChildByName('Label').position.y, 5, '文字中心上移对齐气泡主体（补偿右下角尾巴占高）');

    // 顺序 / 文案变化时复用节点，只按 depth 换帧。
    overlay.render([{ ...hints[2], x: 1, y: 2 }, { ...hints[0], x: 3, y: 4 }, { ...hints[1], x: 5, y: 6 }], true, 0.25);
    assert.equal(root.children.length, 3, 're-render should reuse existing bubbles');
    assert.equal(root.children[0].getComponent(cc.Sprite).spriteFrame, frame01);
    assert.equal(root.children[1].getComponent(cc.Sprite).spriteFrame, frame02);
    assert.equal(root.children[2].getComponent(cc.Sprite).spriteFrame, frame01);
});

test('spawn region hint frames tolerate partial / missing frames while keeping the prefab bubble', () => {
    const { load, FakeNode, cc } = loadViews();
    cc.UITransform = class { setContentSize() {} };
    cc.Label.HorizontalAlign = { CENTER: 'center' };
    cc.Label.VerticalAlign = { CENTER: 'center' };
    cc.Label.Overflow = { NONE: 0, SHRINK: 1, CLAMP: 2, RESIZE_HEIGHT: 3 };
    const { ZCSpawnRegionHintOverlay } = load('./ZCSpawnRegionHintOverlay');
    const parent = new FakeNode('CooldownOverlay');
    const overlay = new ZCSpawnRegionHintOverlay(parent, { front: null, mid: null, back: null }, hintPrefabFixture(FakeNode, cc));
    overlay.render([{ depth: 'front', label: '速攻', x: 5, y: 6 }], true, 0.5);
    const bubble = parent.children[0].children[0];
    const sprite = bubble.getComponent(cc.Sprite);
    assert.ok(sprite, '缺帧时仍保留 prefab 的气泡节点');
    assert.equal(sprite.spriteFrame, null, '缺帧只清空 spriteFrame，不用运行期 Graphics 兜底');
});

test('spawn region hint overlay clears after selection and on render-world teardown', () => {
    assert.match(renderWorld, /clearSpawnRegionHints\(\): void/);
    assert.match(renderWorld, /spawnRegionHintOverlay\?\.clear\(\)/);
    assert.match(renderWorld, /destroy\(\): void[\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(game, /startPlaying\([\s\S]*?clearSpawnRegionHints\(\)/);
    assert.match(hintOverlay, /render\(hints: readonly IZCSpawnRegionHint\[\], visible: boolean, mapScale: number\): void/);
    assert.match(hintOverlay, /clear\(\): void/);
});

test('自选主城地图不在正式战斗地块上显示金币等资源文字', () => {
  assert.match(hexView, /hideNeutralResourceLabel\?: boolean/);
  assert.match(hexView, /resourceVisual && !hideNeutralResourceLabel/);
  assert.match(renderWorld, /hideNeutralResourceLabel: frame\.mapConfig\.cityMode === 'select'/);
});

/**
 * 选点阶段棋盘上那行小字 = **区域名标签**（`前区·速攻` 这种），画在 `map.regions` 的锚点格上，
 * 受「显示提示 / 收起提示」开关控制（默认开）。
 *
 * 2026-10-10 修的这一版：`river_custom_new.json` 的 6 个 region 原本自带 `"text": "???"`，
 * 而 `ZCMapConfig` 的归一化是
 *   `text: typeof region.text === 'string' ? region.text : ZC_TENDENCY_TEXT[tendency]`
 * —— **只要 JSON 给了字符串就用它**，好好的兜底文案被顶掉，界面上就是一团「前区·???」。
 * 这条用例同时钉住两侧：地图数据不许再带占位 text，且归一化后的文案必须是兜底表里的正经词。
 */
test('★河道自选图的区域文案由 tendency 推导，落盘的 "???" 占位必须清掉', () => {
    const layout = JSON.parse(readFileSync(assetPath('config/maps/river_custom_new.json'), 'utf8')) as ZCMapLayout;
    assert.ok(Array.isArray(layout.regions) && layout.regions.length > 0, '河道自选图必须圈了区域（选点阶段靠它出区域提示）');
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
    const rootTransform = hintPrefab.find((entry) => entry?.__type__ === 'cc.UITransform'
        && entry._contentSize?.width === 150 && entry._contentSize?.height === 42);
    assert.ok(rootTransform, '气泡根 150×42');
    const labelNode = hintPrefab.find((entry) => entry?.__type__ === 'cc.Node' && entry._name === 'Label');
    assert.ok(labelNode, 'prefab 必须有 Label 子节点');
    const labelTransform = hintPrefab.find((entry) => entry?.__type__ === 'cc.UITransform'
        && entry._contentSize?.width === 138 && entry._contentSize?.height === 42);
    assert.ok(labelTransform, '文字框 138×42（左右各留 6px）');
    const label = hintPrefab.find((entry) => entry?.__type__ === 'cc.Label');
    assert.equal(label?._fontSize, 18);
    assert.equal(label?._lineHeight, 22);
    assert.equal(label?._overflow, 2, 'SHRINK 才能让 verticalAlign 生效');
});
