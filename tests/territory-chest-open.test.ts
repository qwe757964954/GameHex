/**
 * 「领地宝箱开启」奖励页（蓝湖设计稿 720×1610）的单测。
 *
 * ## 盯住什么（按「错了会不会报错」排序）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | 纯口径：卡片栅格 / 缩放兜底 / 图标适配 / 数量文案 / 入场时间轴 | 静默 —— 5 张卡第二行不居中、矮屏压到宝箱、`+4095` 写成 `X4095` |
 * | B | 品质 → 卡框映射（8 档品质并成 4 张切图） | 静默 —— 紫卡画成蓝框，且在编辑器里看不出来 |
 * | C | 切图 ↔ 磁盘 ↔ `.meta` ↔ prefab 三方对账（uuid / 尺寸 / trimType / packable） | 静默 —— prefab 引用一条不存在的 uuid ⇒ 整格白块 |
 * | D | prefab 结构 + 几何（Widget 贴边值、卡内渲染序、脚本引用、**脚本 uuid ↔ 压缩 cid**） | 静默 —— 弹窗缺组件 / 引用指错节点 / 卡片被底条盖反 |
 * | E | 接线：开箱这一路落新页、旧 `settleRewards` 不再弹 `FW.ShowReward`；银币/随机格不动 | 静默 —— 要么二次弹窗，要么奖励页根本不出来 |
 *
 * ## 为什么能直接 import 这几个源码
 *
 * `TerritoryChestOpenLayout` / `TerritoryChestOpenArt` / `ArtPaths` 的 import 链上没有 `cc`。
 * ⚠️ `TerritoryChestOpenPage` / `TerritoryChestOpenCard` **带 `cc`** ⇒ 本文件不 import 它们，
 * 只读源码文本 + 解析 prefab（D / E 组）。
 */

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TERRITORY_CHEST_OPEN_ARTS, TERRITORY_CHEST_OPEN_ART_ROOT } from '../assets/script/app/ArtPaths';
import {
    CHEST_OPEN_BAND_H,
    CHEST_OPEN_BAND_LOCAL_X,
    CHEST_OPEN_BAND_LOCAL_Y,
    CHEST_OPEN_BAND_W,
    CHEST_OPEN_CARD_H,
    CHEST_OPEN_CARD_TOP,
    CHEST_OPEN_CARD_W,
    CHEST_OPEN_CHEST_BOTTOM,
    CHEST_OPEN_CHEST_CENTER_X,
    CHEST_OPEN_CHEST_H,
    CHEST_OPEN_CHEST_W,
    CHEST_OPEN_CLOSE_BOTTOM,
    CHEST_OPEN_CLOSE_H,
    CHEST_OPEN_CLOSE_W,
    CHEST_OPEN_COUNT_FONT_SIZE,
    CHEST_OPEN_COUNT_OUTLINE_WIDTH,
    CHEST_OPEN_GRID_MIN_SCALE,
    CHEST_OPEN_GRID_W,
    CHEST_OPEN_ICON_H,
    CHEST_OPEN_ICON_LOCAL_Y,
    CHEST_OPEN_ICON_W,
    CHEST_OPEN_OUTLINE_WIDTH,
    CHEST_OPEN_SKIP_H,
    CHEST_OPEN_SKIP_LEFT,
    CHEST_OPEN_SKIP_TOP,
    CHEST_OPEN_SKIP_W,
    CHEST_OPEN_TITLE_FONT_FAMILY,
    CHEST_OPEN_TITLE_FONT_SIZE,
    chestOpenBgProgressOf,
    chestOpenCardProgressOf,
    chestOpenCardSlotOf,
    chestOpenCardVisualOf,
    chestOpenChestVisualOf,
    chestOpenCountTextOf,
    chestOpenEaseOutBack,
    chestOpenGridHeightOf,
    chestOpenGridScaleOf,
    chestOpenIconFitOf,
    chestOpenRevealDoneSecondsOf,
    chestOpenRevealSecondsOf,
    chestOpenRowsOf,
    chestOpenSkipAlphaOf,
} from '../assets/script/app/territory/model/TerritoryChestOpenLayout';
import { TERRITORY_TEXTS } from '../assets/script/app/territory/application/TerritoryTexts';
import {
    CHEST_OPEN_FRAME_BLUE,
    CHEST_OPEN_FRAME_GREEN,
    CHEST_OPEN_FRAME_ORANGE,
    CHEST_OPEN_FRAME_PURPLE,
    chestOpenArtPathOf,
    chestOpenCardFrameNameOf,
} from '../assets/script/app/territory/view/TerritoryChestOpenArt';
import { assetPath } from './helpers/asset-paths';

const read = (path: string): string => readFileSync(path, 'utf8');

/** 源码文本断言一律先剥注释：注释里提到 `FW.ShowReward` / `settleRewards` 是解释，不是接线。 */
const stripComments = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const PAGE_TS = 'assets/script/app/territory/view/TerritoryChestOpenPage.ts';
const CARD_TS = 'assets/script/app/territory/view/TerritoryChestOpenCard.ts';
const MAIN_TS = 'assets/script/app/main/MainTerritoryMap.ts';
const PREFAB_REL = 'ui/territory/TerritoryChestOpen.prefab';
const ART_REL = 'image/territory/chest_open';

// ============================================================
// A. 纯口径
// ============================================================

test('A1｜卡片栅格：4 列步进 147、行步进 216、满行居中 580', () => {
    assert.equal(CHEST_OPEN_CARD_TOP, 432, '设计稿首行 y=432');
    assert.equal(CHEST_OPEN_CARD_W, 139);
    assert.equal(CHEST_OPEN_CARD_H, 185);
    assert.equal(CHEST_OPEN_GRID_W, 580, '4×139 + 3×8 = 580（设计稿整行宽）');

    // 设计稿 x = 72 / 217 / 364 / 511，换算到「容器顶部中心」原点：-220.5 / -73.5 / 73.5 / 220.5
    assert.deepEqual(
        [0, 1, 2, 3].map((index) => chestOpenCardSlotOf(index, 4).x),
        [-220.5, -73.5, 73.5, 220.5],
    );
    assert.deepEqual(
        [0, 1, 2, 3].map((index) => chestOpenCardSlotOf(index, 4).y),
        [-92.5, -92.5, -92.5, -92.5],
    );

    // 设计稿 4+1：第 5 张在第二行、整行居中（x=0）、y = -(216+92.5)
    assert.deepEqual(chestOpenCardSlotOf(4, 5), { x: 0, y: -308.5, inRow: 1 });
    assert.equal(chestOpenCardSlotOf(1, 3).inRow, 3, '3 张时是一整行（不是 3+0 的假两行）');
    assert.deepEqual([0, 1, 2].map((index) => chestOpenCardSlotOf(index, 3).x), [-147, 0, 147]);
});

test('A2｜行数 / 总高：1~4 张一行、5~8 两张', () => {
    assert.deepEqual([0, 1, 4, 5, 8, 9].map(chestOpenRowsOf), [0, 1, 1, 2, 2, 3]);
    assert.equal(chestOpenGridHeightOf(0), 0);
    assert.equal(chestOpenGridHeightOf(4), 185);
    assert.equal(chestOpenGridHeightOf(5), 401, '185×2 + 31 = 401');
    assert.equal(chestOpenGridHeightOf(9), 617);
});

test('A3｜缩放兜底：1610/1485 不缩，1280 缩到 0.888，再矮压到 0.7 下限', () => {
    assert.equal(chestOpenGridScaleOf(5, 1610), 1, '设计稿高度下与效果图逐像素一致');
    assert.equal(chestOpenGridScaleOf(5, 1485), 1, '长屏机（实测可见高 1485）两行仍放得下');
    const ratio1280 = chestOpenGridScaleOf(5, 1280);
    assert.ok(Math.abs(ratio1280 - 356 / 401) < 1e-9, `1280 时取 356/401，实际 ${ratio1280}`);
    assert.ok(ratio1280 < 1 && ratio1280 > CHEST_OPEN_GRID_MIN_SCALE);
    assert.equal(chestOpenGridScaleOf(9, 1280), CHEST_OPEN_GRID_MIN_SCALE, '三行以上触底');
    assert.equal(chestOpenGridScaleOf(0, 1280), 1, '没有卡就不缩');
});

test('A4｜图标适配：等比、居中、最多放大 2 倍（道具图标 100×100 要铺满 112）', () => {
    assert.deepEqual(chestOpenIconFitOf(112, 112), { width: 112, height: 112 });
    assert.deepEqual(chestOpenIconFitOf(100, 100), { width: 112, height: 112 }, '工程道具/货币的真实尺寸');
    assert.deepEqual(chestOpenIconFitOf(200, 200), { width: 112, height: 112 }, '大图缩进 112×147');
    assert.deepEqual(chestOpenIconFitOf(224, 448), { width: 73.5, height: 147 }, '高窄图按高卡边');
    assert.deepEqual(chestOpenIconFitOf(60, 60), { width: 112, height: 112 }, '小图放大到铺满，不是留白');
    assert.deepEqual(chestOpenIconFitOf(20, 20), { width: 40, height: 40 }, '太小就封顶 2 倍，不硬拉');
    assert.deepEqual(chestOpenIconFitOf(0, 0), { width: CHEST_OPEN_ICON_W, height: CHEST_OPEN_ICON_H });
    assert.deepEqual(chestOpenIconFitOf(-8, 20), { width: CHEST_OPEN_ICON_W, height: CHEST_OPEN_ICON_H });
});

test('A5｜数量文案：道具 X1、货币 +N（设计稿两种形态是两类奖励）', () => {
    assert.equal(chestOpenCountTextOf(1, false), 'X1');
    assert.equal(chestOpenCountTextOf(4095, true), '+4095');
    assert.equal(chestOpenCountTextOf(3, true), '+3');
    assert.equal(chestOpenCountTextOf(1.6, false), 'X1', '数量取整（不出现 X1.6）');
    assert.equal(chestOpenCountTextOf(-5, true), '+0', '负数不写负号');
});

test('A6｜入场时间轴：5 张 0.66s 铺完（跳过常驻，不再多算淡出）', () => {
    assert.equal(chestOpenRevealSecondsOf(5), 0.66);
    assert.equal(chestOpenRevealDoneSecondsOf(5), 0.66, '整段入场 = 最后一张卡到位');
    assert.equal(chestOpenRevealSecondsOf(4), 0.585);
    assert.equal(chestOpenRevealSecondsOf(0), 0.1, '没有卡时只等第一张的延迟量');

    assert.equal(chestOpenCardProgressOf(0, 0), 0);
    assert.equal(chestOpenCardProgressOf(0.1, 0), 0, '0.1s 才启动第一张');
    assert.equal(chestOpenCardProgressOf(0.36, 0), 1);
    assert.ok(Math.abs(chestOpenCardProgressOf(0.325, 3)) < 1e-9, '第 4 张 0.325s 才启动');
    assert.ok(chestOpenCardProgressOf(0.36, 3) < chestOpenCardProgressOf(0.36, 0), '错峰：越靠后越慢');
    assert.equal(chestOpenBgProgressOf(0), 0);
    assert.ok(chestOpenBgProgressOf(0.05) > 0 && chestOpenBgProgressOf(0.05) < 1);
    assert.equal(chestOpenBgProgressOf(1), 1, '底图 0.16s 就亮完');
});

test('A7｜入场视觉量：卡从 0.72 弹到 1（有过冲），跳过淡入后常驻', () => {
    assert.ok(Math.abs(chestOpenEaseOutBack(0)) < 1e-9, 't=0 必须恰好是 0（不然第一帧就弹一下）');
    assert.equal(chestOpenEaseOutBack(1), 1);

    const start = chestOpenCardVisualOf(0, 0);
    assert.equal(start.scale, 0.72);
    assert.equal(start.opacity, 0);
    assert.equal(start.rise, 16);

    const end = chestOpenCardVisualOf(10, 0);
    assert.equal(end.scale, 1);
    assert.equal(end.opacity, 255);
    assert.equal(end.rise, 0);
    assert.equal(end.done, true);

    const mid = chestOpenCardVisualOf(0.25, 0);
    assert.ok(mid.scale > 1, `回弹过冲（实际 ${mid.scale}）`);
    const fade = chestOpenCardVisualOf(0.13, 0);
    assert.ok(fade.opacity > 0 && fade.opacity < 255, '不透明度比缩放先到位');

    assert.equal(chestOpenChestVisualOf(0).opacity, 0);
    assert.ok(Math.abs(chestOpenChestVisualOf(10).scale - 1) < 1e-9);

    assert.equal(chestOpenSkipAlphaOf(0), 0, '第一帧还没淡入');
    assert.ok(chestOpenSkipAlphaOf(0.05) > 0 && chestOpenSkipAlphaOf(0.05) < 1);
    assert.equal(chestOpenSkipAlphaOf(0.16), 1, '0.16s 淡入完成');
    assert.equal(chestOpenSkipAlphaOf(0.5), 1, '入场后常驻（设计稿静止态就有「跳过>>」）');
    assert.equal(chestOpenSkipAlphaOf(10), 1, '不会随时间消失');
});

// ============================================================
// B. 品质 → 卡框
// ============================================================

test('B1｜品质映射：q≥5 橙、4 紫、3 蓝、≤2 绿（白档降级绿框）', () => {
    assert.equal(chestOpenCardFrameNameOf(5), CHEST_OPEN_FRAME_ORANGE);
    assert.equal(chestOpenCardFrameNameOf(6), CHEST_OPEN_FRAME_ORANGE, '红档并进橙');
    assert.equal(chestOpenCardFrameNameOf(8), CHEST_OPEN_FRAME_ORANGE, '将档并进橙');
    assert.equal(chestOpenCardFrameNameOf(4), CHEST_OPEN_FRAME_PURPLE);
    assert.equal(chestOpenCardFrameNameOf(3), CHEST_OPEN_FRAME_BLUE);
    assert.equal(chestOpenCardFrameNameOf(2), CHEST_OPEN_FRAME_GREEN);
    assert.equal(chestOpenCardFrameNameOf(1), CHEST_OPEN_FRAME_GREEN, '白框切图不存在 ⇒ 降级绿');
    assert.equal(chestOpenCardFrameNameOf(0), CHEST_OPEN_FRAME_GREEN, '解析不出品质也降级，不抛错');
});

test('B2｜装配路径都拼 `/spriteFrame`；底图在 image 根、其余在 chest_open', () => {
    for (const name of Object.values(TERRITORY_CHEST_OPEN_ARTS)) {
        const root = name === TERRITORY_CHEST_OPEN_ARTS.bg ? 'image' : TERRITORY_CHEST_OPEN_ART_ROOT;
        assert.equal(chestOpenArtPathOf(name), `${root}/${name}/spriteFrame`);
    }
    assert.ok(chestOpenArtPathOf(CHEST_OPEN_FRAME_ORANGE).startsWith('image/territory/chest_open/'));
    assert.equal(chestOpenArtPathOf(TERRITORY_CHEST_OPEN_ARTS.bg), 'image/bg_chest_open/spriteFrame');
});

// ============================================================
// C. 切图 ↔ 磁盘 ↔ meta ↔ prefab
// ============================================================

interface ImageMeta {
    readonly uuid: string;
    readonly subMetas: Record<string, { uuid: string; userData: Record<string, unknown> }>;
    readonly userData: { type: string; hasAlpha: boolean };
}

/** 底图在 `image/` 根（720×1610 超出 territory 图集 1024 页高，见 ArtPaths 注释）。 */
const BG_FILE = `${TERRITORY_CHEST_OPEN_ARTS.bg}.png`;

/** 图集目录里的 6 张：随 `image/territory` 的 auto-atlas 合批。 */
const ATLAS_FILES: Record<string, [number, number]> = {
    'chest_open_chest.png': [282, 277],
    'chest_open_card_01.png': [139, 185],
    'chest_open_card_02.png': [139, 185],
    'chest_open_card_03.png': [139, 185],
    'chest_open_card_04.png': [139, 185],
    'chest_open_card_band.png': [122, 29],
};

/** 文件 → 资源相对路径（不带 `.meta`）。 */
const relOf = (file: string): string => (file === BG_FILE ? `image/${file}` : `${ART_REL}/${file}`);

const imageMeta = (file: string): ImageMeta => JSON.parse(read(assetPath(`${relOf(file)}.meta`)));

test('C1｜7 张切图落点正确（底图在 image 根、其余在图集目录），尺寸与设计稿一致', () => {
    assert.equal(Object.keys(ATLAS_FILES).length + 1, 7, '设计稿正好 7 张切图');
    const sizes: Record<string, [number, number]> = { [BG_FILE]: [720, 1610], ...ATLAS_FILES };
    for (const [file, [width, height]] of Object.entries(sizes)) {
        const meta = imageMeta(file);
        const frame = meta.subMetas.f9941.userData as Record<string, number>;
        assert.equal(frame.width, width, `${file} 宽`);
        assert.equal(frame.height, height, `${file} 高`);
        assert.equal(frame.rawWidth, width);
        assert.equal(frame.rawHeight, height);
    }
    // 反证：底图若留在图集目录，会被 1024 页高切成两半（构建期才暴露）
    assert.ok(!existsSync(`assets/resources/${ART_REL}/${BG_FILE}`), '底图不许留在 image/territory 树里');
});

test('C2｜meta：子资源 id 固定 6c48a/f9941、trimType=none、底图不进图集', () => {
    for (const file of [BG_FILE, ...Object.keys(ATLAS_FILES)]) {
        const meta = imageMeta(file);
        assert.ok(meta.uuid.length === 36, `${file} uuid 形状`);
        assert.equal(meta.subMetas['6c48a'].uuid, `${meta.uuid}@6c48a`);
        assert.equal(meta.subMetas.f9941.uuid, `${meta.uuid}@f9941`);
        assert.equal(meta.subMetas.f9941.userData.trimType, 'none', '卡框是整图，裁一刀就歪');
        assert.equal(meta.userData.type, 'sprite-frame');
        assert.equal(meta.userData.hasAlpha, true);
        if (file === BG_FILE) {
            assert.equal(meta.subMetas.f9941.userData.packable, false, '720×1610 不许塞进自动图集');
        } else {
            assert.equal(meta.subMetas.f9941.userData.packable, true, '小图合批');
        }
    }
});

test('C3｜prefab 引用的 SpriteFrame uuid 与磁盘 meta 一一对应', () => {
    const items = prefabItems();
    const expectations: [string, string][] = [
        ['Bg', BG_FILE],
        ['Chest', 'chest_open_chest.png'],
        ['Band', 'chest_open_card_band.png'],
        ['Frame', 'chest_open_card_04.png'],
    ];
    for (const [nodeName, file] of expectations) {
        const sprite = compOf(items, nodeByName(items, nodeName), 'cc.Sprite');
        assert.equal(sprite._spriteFrame.__uuid__, imageMeta(file).uuid + '@f9941', `${nodeName} 指错图`);
    }
    const frameSprite = compOf(items, nodeByName(items, 'Frame'), 'cc.Sprite');
    assert.equal(frameSprite._sizeMode, 0, 'CUSTOM 尺寸（139×185 不许被原图尺寸带跑）');
    assert.equal(frameSprite._isTrimmedMode, false);
    assert.equal(frameSprite._type, 0, 'SIMPLE（卡框不是九宫格）');
});

// ============================================================
// D. prefab 结构与几何
// ============================================================

interface PrefabNode {
    __type__: string;
    _name: string;
    _active: boolean;
    _parent: { __id__: number } | null;
    _children: { __id__: number }[];
    _components: { __id__: number }[];
    _lpos: { x: number; y: number };
}

function prefabItems(): any[] {
    return JSON.parse(read(assetPath(PREFAB_REL)));
}

function nodeByName(items: any[], name: string): PrefabNode {
    const node = items.find((item: any) => item?.__type__ === 'cc.Node' && item._name === name);
    assert.ok(node, `prefab 缺节点 ${name}`);
    return node;
}

function compOf(items: any[], node: PrefabNode, type: string): any {
    const comp = node._components
        .map((ref) => items[ref.__id__])
        .find((candidate: any) => typeof candidate.__type__ === 'string' && candidate.__type__.startsWith(type));
    assert.ok(comp, `${node._name} 缺 ${type}`);
    return comp;
}

function sizeOf(items: any[], node: PrefabNode): { width: number; height: number } {
    const comp = compOf(items, node, 'cc.UITransform');
    return { width: comp._contentSize.width, height: comp._contentSize.height };
}

test('D1｜根节点 720×1610 + 四边拉伸 Widget（长屏靠 Widget 适配）', () => {
    const items = prefabItems();
    const root = nodeByName(items, 'TerritoryChestOpen');
    assert.deepEqual(sizeOf(items, root), { width: 720, height: 1610 });
    const widget = compOf(items, root, 'cc.Widget');
    assert.equal(widget._alignFlags, 45, 'LEFT|RIGHT|TOP|BOTTOM');
    assert.equal(widget._alignMode, 2, 'ALWAYS（换分辨率也重算）');
    assert.equal(items[0].__type__, 'cc.Prefab');
    assert.deepEqual(items[0].data, { __id__: items.indexOf(root) });
});

test('D2｜卡片容器：锚点顶部中心 + Widget top=432 / hCenter，尺寸 580', () => {
    const items = prefabItems();
    const cards = nodeByName(items, 'Cards');
    const ui = compOf(items, cards, 'cc.UITransform');
    assert.deepEqual(sizeOf(items, cards), { width: CHEST_OPEN_GRID_W, height: 401 });
    assert.deepEqual(ui._anchorPoint, { __type__: 'cc.Vec2', x: 0.5, y: 1 });
    const widget = compOf(items, cards, 'cc.Widget');
    assert.equal(widget._alignFlags, 17, 'TOP|CENTER');
    assert.equal(widget._top, CHEST_OPEN_CARD_TOP);
    assert.equal(widget._horizontalCenter, 0);
    assert.equal(widget._bottom, 0, '底部不贴边（否则会和宝箱互相拉扯）');
});

test('D3｜卡片模板：139×185、inactive、渲染序 Frame→Icon→Band→Count', () => {
    const items = prefabItems();
    const card = nodeByName(items, 'CardTemplate');
    assert.deepEqual(sizeOf(items, card), { width: CHEST_OPEN_CARD_W, height: CHEST_OPEN_CARD_H });
    assert.equal(card._active, false, '模板必须 inactive（否则预览里多一张空卡）');
    assert.deepEqual(
        card._children.map((ref) => items[ref.__id__]._name),
        ['Frame', 'Icon', 'Band', 'Count'],
        '底条要盖住图标下沿 ⇒ Band 在 Icon 之后',
    );

    assert.deepEqual(sizeOf(items, nodeByName(items, 'Frame')), { width: 139, height: 185 });
    const icon = nodeByName(items, 'Icon');
    assert.deepEqual(sizeOf(items, icon), { width: 112, height: 147 });
    assert.equal(icon._lpos.y, CHEST_OPEN_ICON_LOCAL_Y, '图标位顶边距卡顶 22');

    for (const name of ['Band', 'Count']) {
        const node = nodeByName(items, name);
        assert.deepEqual(sizeOf(items, node), { width: CHEST_OPEN_BAND_W, height: CHEST_OPEN_BAND_H });
        assert.equal(node._lpos.x, CHEST_OPEN_BAND_LOCAL_X, '底条左内缩 8 / 右 9 ⇒ 中心 -0.5');
        assert.equal(node._lpos.y, CHEST_OPEN_BAND_LOCAL_Y, '底条顶边距卡顶 148');
    }

    const count = compOf(items, nodeByName(items, 'Count'), 'cc.Label');
    assert.equal(count._fontSize, CHEST_OPEN_COUNT_FONT_SIZE);
    assert.equal(count._enableOutline, true);
    assert.equal(count._outlineWidth, CHEST_OPEN_COUNT_OUTLINE_WIDTH);
    assert.equal(count._isBold, true);
    assert.deepEqual(count._color, { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }, '白字 + 黑描边');
    assert.equal(count._horizontalAlign, 1, '居中');
});

test('D4｜宝箱：282×277、Widget 底 199 / hCenter -6.5（可见 art 重心）', () => {
    const items = prefabItems();
    const chest = nodeByName(items, 'Chest');
    assert.deepEqual(sizeOf(items, chest), { width: CHEST_OPEN_CHEST_W, height: CHEST_OPEN_CHEST_H });
    const widget = compOf(items, chest, 'cc.Widget');
    assert.equal(widget._alignFlags, 20, 'BOTTOM|CENTER');
    assert.equal(widget._bottom, CHEST_OPEN_CHEST_BOTTOM);
    assert.equal(widget._horizontalCenter, CHEST_OPEN_CHEST_CENTER_X);
    assert.equal(widget._alignMode, 1, 'ALWAYS：Sprite onLoad 会先把高度改成裁切值，一次性对齐会停在错的 y');
    assert.ok(Math.abs(chest._lpos.y - (-467.5)) < 1e-9, '1610 画布下先按设计稿摆（Widget 运行时接管）');
    assert.ok(componentsOf(items, chest).some((type) => type === 'cc.UIOpacity'), '宝箱要有 UIOpacity');
});

test('D5｜跳过 / 关闭：设计稿文字位置，触摸框加高到 64', () => {
    const items = prefabItems();
    const skip = nodeByName(items, 'Skip');
    assert.deepEqual(sizeOf(items, skip), { width: CHEST_OPEN_SKIP_W, height: CHEST_OPEN_SKIP_H });
    const skipWidget = compOf(items, skip, 'cc.Widget');
    assert.equal(skipWidget._alignFlags, 9, 'LEFT|TOP');
    assert.equal(skipWidget._left, CHEST_OPEN_SKIP_LEFT, '设计稿 x=31');
    assert.equal(skipWidget._top, CHEST_OPEN_SKIP_TOP, '设计稿 y=116 的文字中心 ⇒ 触摸框顶 102');
    const skipLabel = compOf(items, skip, 'cc.Label');
    assert.equal(skipLabel._fontSize, CHEST_OPEN_TITLE_FONT_SIZE);
    assert.equal(skipLabel._outlineWidth, CHEST_OPEN_OUTLINE_WIDTH);
    assert.equal(skipLabel._fontFamily, CHEST_OPEN_TITLE_FONT_FAMILY, '设计稿是雅黑 Bold，换 Arial 字宽会窄 6/9px');
    assert.equal(skipLabel._string, TERRITORY_TEXTS.chestOpenSkip, 'prefab 文案与真源一致');

    const close = nodeByName(items, 'Close');
    assert.deepEqual(sizeOf(items, close), { width: CHEST_OPEN_CLOSE_W, height: CHEST_OPEN_CLOSE_H });
    const closeWidget = compOf(items, close, 'cc.Widget');
    assert.equal(closeWidget._bottom, CHEST_OPEN_CLOSE_BOTTOM, '1610-1470=140 的文字底 ⇒ 触摸框 126');
    assert.equal(closeWidget._horizontalCenter, 0);
    const closeLabel = compOf(items, close, 'cc.Label');
    assert.equal(closeLabel._string, TERRITORY_TEXTS.chestOpenClose);

    for (const node of [skip, close]) {
        const button = compOf(items, node, 'cc.Button');
        assert.equal(button._transition, 0, 'NONE（视觉状态由动画自己管）');
        assert.equal(button._target, null, 'target=null（Cocos 3.8 该字段已不生效，留空最安全）');
        assert.deepEqual(button.clickEvents, [], '不在 prefab 里配点击事件：代码绑 CLICK');
    }
    assert.ok(componentsOf(items, skip).includes('cc.UIOpacity'), '「跳过」要淡出');
    assert.ok(!componentsOf(items, close).includes('cc.UIOpacity'), '「点击关闭」常驻，不需要透明度');
});

test('D6｜脚本引用：页面 10 个 Inspector 引用全部指向对的节点/组件', () => {
    const items = prefabItems();
    const page = items.find((item: any) => item?.bgOpacity && item.cardsRoot && item.skipLabel);
    assert.ok(page, 'prefab 里找不到 TerritoryChestOpenPage 组件（用 bgOpacity 特征找）');

    const ownerName = (ref: { __id__: number }): string | null => {
        const comp = items[ref.__id__];
        return comp.node ? items[comp.node.__id__]._name : null;
    };
    const refType = (ref: { __id__: number }): string => items[ref.__id__].__type__;
    const refName = (ref: { __id__: number }): string => items[ref.__id__]._name;

    assert.equal(refType(page.bgOpacity), 'cc.UIOpacity');
    assert.equal(ownerName(page.bgOpacity), 'Bg');
    assert.equal(refType(page.chestOpacity), 'cc.UIOpacity');
    assert.equal(ownerName(page.chestOpacity), 'Chest');
    assert.equal(refType(page.skipOpacity), 'cc.UIOpacity');
    assert.equal(ownerName(page.skipOpacity), 'Skip');
    assert.equal(refType(page.skipButton), 'cc.Button');
    assert.equal(ownerName(page.skipButton), 'Skip');
    assert.equal(refType(page.closeButton), 'cc.Button');
    assert.equal(ownerName(page.closeButton), 'Close');
    assert.equal(refType(page.skipLabel), 'cc.Label');
    assert.equal(ownerName(page.skipLabel), 'Skip');
    assert.equal(refType(page.closeLabel), 'cc.Label');
    assert.equal(ownerName(page.closeLabel), 'Close');
    assert.equal(refName(page.cardsRoot), 'Cards');
    assert.equal(refName(page.cardTemplate), 'CardTemplate');
    assert.equal(refName(page.chestNode), 'Chest');
    assert.equal(page.popupLayer, 0, 'NORMAL 层（Popup 节点已是 Canvas 最上层）');
    assert.equal(page.closeOnBlank, true, '点空白关闭（入场期间先收尾动画）');
    assert.deepEqual(page.contentNodes, []);
});

test('D7｜卡片脚本引用：frame / icon / count / opacity 都绑在同一张模板上', () => {
    const items = prefabItems();
    const cardComp = items.find((item: any) => item?.frame && item.icon && item.count && item.opacity);
    assert.ok(cardComp, 'prefab 里找不到 TerritoryChestOpenCard 组件');

    const ownerName = (ref: { __id__: number }): string => {
        const comp = items[ref.__id__];
        return items[comp.node.__id__]._name;
    };
    assert.equal(ownerName(cardComp.frame), 'Frame', 'frame 引用指错');
    assert.equal(ownerName(cardComp.icon), 'Icon', 'icon 引用指错');
    assert.equal(ownerName(cardComp.count), 'Count', 'count 引用指错');
    assert.equal(items[cardComp.opacity.__id__].__type__, 'cc.UIOpacity');
    assert.equal(ownerName(cardComp.opacity), 'CardTemplate', '整卡透明度必须挂模板根上');
});

test('D8｜脚本 uuid ↔ prefab 里的压缩 cid（错一个字符 = 运行时"组件缺失"）', () => {
    const items = prefabItems();
    const pageMeta = JSON.parse(read(PAGE_TS + '.meta'));
    const cardMeta = JSON.parse(read(CARD_TS + '.meta'));
    const page = items.find((item: any) => item?.bgOpacity && item.skipLabel);
    const cardComp = items.find((item: any) => item?.frame && item.count && item.opacity);
    assert.equal(page.__type__, compressUuid(pageMeta.uuid), '页面 cid 与 .ts.meta 不匹配');
    assert.equal(cardComp.__type__, compressUuid(cardMeta.uuid), '卡片 cid 与 .ts.meta 不匹配');
});

/** Cocos 的压缩 uuid：前 5 个 hex 原样，其余 27 个 hex（108 bit）按 6 bit 查表（与生成脚本同算法）。 */
function compressUuid(uuid: string): string {
    const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const raw = uuid.replace(/-/g, '');
    const head = raw.slice(0, 5);
    const rest = raw.slice(5);
    let bits = BigInt('0x' + rest).toString(2).padStart(rest.length * 4, '0');
    let out = '';
    for (let index = 0; index < bits.length; index += 6) {
        out += base64[parseInt(bits.slice(index, index + 6), 2)];
    }
    assert.equal(out.length, rest.length * 4 / 6, '位宽应是 108');
    return head + out;
}

function componentsOf(items: any[], node: PrefabNode): string[] {
    return node._components.map((ref) => items[ref.__id__].__type__ as string);
}

// ============================================================
// E. 接线
// ============================================================

test('E1｜领地宝箱「进流程先弹页」：不再前置地图开箱表演', () => {
    const main = read(MAIN_TS);
    assert.match(main, /import \{ TerritoryChestOpenPage \} from '\.\.\/territory\/view\/TerritoryChestOpenPage';/);

    const at = main.indexOf('const tier = cellId !== null');
    assert.ok(at > 0, '宝箱档位判定不见了');
    const body = main.slice(at, main.indexOf('private presentChestRewards(', at));
    assert.match(body, /this\.presentChestRewards\(rewards\)/, '进开箱流程先把「宝箱开启」页弹出来');

    // 弹页之后不该再有结算（会二次弹 `FW.ShowReward`）
    const tail = body.slice(body.indexOf('this.presentChestRewards(rewards);'));
    assert.doesNotMatch(tail, /settleRewards\(/, '弹页之后不许再走旧结算');

    // 旧前置表演整条链路已下线：先播 `chest_seq_*`、再回调弹页的写法不复存在
    assert.doesNotMatch(main, /playChestThenSettle|wireRewardCatch/,
        '地图内开箱表演不再前置（页面本身就是开箱表现）');
    assert.doesNotMatch(main, /settleRewards\([^)]*,\s*true\)/, 'suppressGain 这个口子已经删了');
});

test('E2｜`presentChestRewards`：整批奖励（含货币）都给新页，空奖励不弹', () => {
    const main = read(MAIN_TS);
    const at = main.indexOf('private presentChestRewards(');
    assert.ok(at > 0);
    const body = main.slice(at, main.indexOf('private findHeroTabHost(', at));
    assert.match(body, /if \(!rewards\.length\) return;/);
    assert.match(body, /TerritoryChestOpenPage\.open\(/);
    assert.match(body, /goods: rewards\.map\(\(reward\) => \(\{ resId: reward\.resId, number: reward\.amount \}\)\)/);
    assert.doesNotMatch(body, /splitTerritoryRewards|isTerritoryWalletResId|FW\.ShowReward/,
        '这一路不许再按钱包/道具分流（设计稿的卡本来就画了货币）');
});

test('E3｜银币宝箱 / 随机格 / 挂机征收三路保持原样', () => {
    const main = read(MAIN_TS);
    const silverAt = main.indexOf('presentation?.silverChest === true');
    assert.ok(silverAt > 0);
    const silver = main.slice(silverAt, main.indexOf('const tier =', silverAt));
    assert.match(silver, /playSilverChestOpen\(cellId\)/);
    assert.match(silver, /settleRewards\(rewards, cellId\)/);
    assert.doesNotMatch(silver, /presentChestRewards|TerritoryChestOpenPage/);

    const randomAt = main.indexOf('if (presentation?.chest === false) {');
    assert.ok(randomAt > 0);
    const random = main.slice(randomAt, randomAt + 200);
    assert.match(random, /playCellGains\(/);
    assert.doesNotMatch(random, /presentChestRewards|TerritoryChestOpenPage/);
});

test('E4｜页面自己不再弹 `FW.ShowReward`，prefabPath 与磁盘一致', () => {
    const page = stripComments(read(PAGE_TS));
    assert.doesNotMatch(page, /FW\.ShowReward/, '奖励页不许再套一层旧奖励窗');
    assert.match(page, /static prefabPath = 'ui\/territory\/TerritoryChestOpen';/);
    assert.ok(assetPath('ui/territory/TerritoryChestOpen.prefab'), 'prefabPath 指向的文件必须存在');

    const card = read(CARD_TS);
    assert.match(card, /@ccclass\('TerritoryChestOpenCard'\)/);
    assert.match(page, /@ccclass\('TerritoryChestOpenPage'\)/);
});

test('E5｜页面只绑 CLICK、模板只克隆不重建、update 只写节点', () => {
    const page = read(PAGE_TS);
    assert.match(page, /this\.skipButton\.node\.on\(Button\.EventType\.CLICK, this\.onSkipClick, this\)/);
    assert.match(page, /this\.closeButton\.node\.on\(Button\.EventType\.CLICK, this\.onCloseClick, this\)/);
    assert.doesNotMatch(page, /TOUCH_END|MOUSE_UP/, '不许用 TOUCH_END 兜底');

    assert.match(page, /instantiate\(this\.cardTemplate\)/);
    assert.match(page, /this\.cardTemplate\.active = false/, '模板铺完要藏起来');
    // update 里不许出现加载/查表/instantiate（会把 0.6 秒的入场拖成掉帧）
    const updateAt = page.indexOf('protected update(dt: number): void {');
    assert.ok(updateAt > 0);
    const updateBody = page.slice(updateAt, page.indexOf('// 数据 → 卡片', updateAt));
    assert.doesNotMatch(updateBody, /\bassets\.load|getTable|instantiate|new Array|\[\]/, 'update 只有写节点');
});

test('E6｜入场期间点空白 = 跳过动画，不是关窗；「跳过」先收尾、静止后等同关闭', () => {
    const page = read(PAGE_TS);
    const canAt = page.indexOf('protected canCloseOnBlank(): boolean {');
    assert.ok(canAt > 0);
    const body = page.slice(canAt, page.indexOf('protected update(dt: number): void {', canAt));
    assert.match(body, /if \(!this\._revealDone\) \{/);
    assert.match(body, /this\.finishReveal\(\);/);
    assert.match(body, /return false;/);
    assert.doesNotMatch(body, /this\.close\(/, '入场中先收尾，不许直接关');

    const skipAt = page.indexOf('private onSkipClick(): void {');
    const skipBody = page.slice(skipAt, page.indexOf('private onCloseClick(): void {', skipAt));
    assert.match(skipBody, /this\.finishReveal\(\)/);
    assert.match(skipBody, /this\.closeByButton\(\)/, '已经静止时再点等同关闭，不留死按钮');
    assert.doesNotMatch(
        page.slice(page.indexOf('private finishReveal(): void {'), skipAt),
        /this\.skipButton\.node\.active = false/,
        '「跳过」常驻：设计稿静止态就带「跳过>>」',
    );
});
