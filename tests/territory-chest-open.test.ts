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
    chestLegendHeroesOf,
    chestOpenBgProgressOf,
    chestOpenCardProgressOf,
    chestOpenCardVisualOf,
    chestOpenChestVisualOf,
    chestOpenCountTextOf,
    chestOpenEaseOutBack,
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

/**
 * 设计稿期望值（测试夹具）。
 *
 * 生产代码里的布局常量已经迁到 prefab；这里保留一份「期望值」用于对账 prefab，
 * 不从生产 model 反向读取，否则等于用实现给自己出题。
 */
const CHEST_OPEN_CARD_W = 139;
const CHEST_OPEN_CARD_H = 185;
const CHEST_OPEN_CARD_TOP = 432;
const CHEST_OPEN_GRID_W = 580;
const CHEST_OPEN_ICON_W = 112;
const CHEST_OPEN_ICON_H = 147;
const CHEST_OPEN_ICON_LOCAL_Y = -3;
const CHEST_OPEN_BAND_W = 122;
const CHEST_OPEN_BAND_H = 29;
const CHEST_OPEN_BAND_LOCAL_X = -0.5;
const CHEST_OPEN_BAND_LOCAL_Y = -70;
const CHEST_OPEN_CHEST_W = 282;
const CHEST_OPEN_CHEST_H = 277;
const CHEST_OPEN_CHEST_BOTTOM = 199;
const CHEST_OPEN_CHEST_CENTER_X = -6.5;
const CHEST_OPEN_SKIP_LEFT = 31;
const CHEST_OPEN_SKIP_TOP = 102;
const CHEST_OPEN_SKIP_W = 123;
const CHEST_OPEN_SKIP_H = 64;
const CHEST_OPEN_CLOSE_BOTTOM = 126;
const CHEST_OPEN_CLOSE_W = 148;
const CHEST_OPEN_CLOSE_H = 64;
const CHEST_OPEN_TITLE_FONT_SIZE = 37;
const CHEST_OPEN_TITLE_FONT_FAMILY = 'Microsoft YaHei';
const CHEST_OPEN_COUNT_FONT_SIZE = 22;
const CHEST_OPEN_OUTLINE_WIDTH = 2;
const CHEST_OPEN_COUNT_OUTLINE_WIDTH = 2;
const CHEST_OPEN_GRID_MIN_SCALE = 0.7;
const CHEST_OPEN_CARD_COLS = 4;

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

test('A1｜行数：4 列一行，5~8 两张，0 张不建行', () => {
    assert.deepEqual([0, 1, 4, 5, 8, 9].map((total) => chestOpenRowsOf(total, CHEST_OPEN_CARD_COLS)), [0, 1, 1, 2, 2, 3]);
    assert.equal(chestOpenRowsOf(4, 0), 0, '列数非法不建行');
});

test('A2｜缩放兜底：1610/1485 不缩，1280 缩到 356/401，再矮压到 0.7 下限', () => {
    assert.equal(chestOpenGridScaleOf(401, 686, CHEST_OPEN_GRID_MIN_SCALE), 1, '设计稿高度下与效果图逐像素一致');
    assert.equal(chestOpenGridScaleOf(401, 561, CHEST_OPEN_GRID_MIN_SCALE), 1, '长屏机（实测可见高 1485）两行仍放得下');
    const ratio1280 = chestOpenGridScaleOf(401, 356, CHEST_OPEN_GRID_MIN_SCALE);
    assert.ok(Math.abs(ratio1280 - 356 / 401) < 1e-9, `1280 时取 356/401，实际 ${ratio1280}`);
    assert.ok(ratio1280 < 1 && ratio1280 > CHEST_OPEN_GRID_MIN_SCALE);
    assert.equal(chestOpenGridScaleOf(617, 356, CHEST_OPEN_GRID_MIN_SCALE), CHEST_OPEN_GRID_MIN_SCALE, '三行以上触底');
    assert.equal(chestOpenGridScaleOf(0, 356, CHEST_OPEN_GRID_MIN_SCALE), 1, '没有卡就不缩');
});

test('A3｜图标适配：等比、居中、按 prefab 的图标位与最大放大倍数', () => {
    assert.deepEqual(chestOpenIconFitOf(112, 112, 112, 147, 2), { width: 112, height: 112 });
    assert.deepEqual(chestOpenIconFitOf(100, 100, 112, 147, 2), { width: 112, height: 112 }, '工程道具/货币的真实尺寸');
    assert.deepEqual(chestOpenIconFitOf(200, 200, 112, 147, 2), { width: 112, height: 112 }, '大图缩进图标位');
    assert.deepEqual(chestOpenIconFitOf(224, 448, 112, 147, 2), { width: 73.5, height: 147 }, '高窄图按高卡边');
    assert.deepEqual(chestOpenIconFitOf(60, 60, 112, 147, 2), { width: 112, height: 112 }, '小图放大到铺满，不是留白');
    assert.deepEqual(chestOpenIconFitOf(20, 20, 112, 147, 2), { width: 40, height: 40 }, '太小就封顶 2 倍，不硬拉');
    assert.deepEqual(chestOpenIconFitOf(0, 0, 112, 147, 2), { width: 112, height: 147 });
    assert.deepEqual(chestOpenIconFitOf(-8, 20, 112, 147, 2), { width: 112, height: 147 });
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

test('D2｜卡片容器：锚点顶部中心 + Widget top=432 / hCenter，Layout 纵向排布', () => {
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

    // 栅格已经迁到 cc.Layout：页面不再按 4 列/间距自己算 x/y。
    const layout = compOf(items, cards, 'cc.Layout');
    assert.equal(layout._layoutType, 2, 'VERTICAL');
    assert.equal(layout._resizeMode, 1, 'CONTAINER：按行数收高');
    assert.equal(layout._spacingX, 8);
    assert.equal(layout._spacingY, 31);
    assert.deepEqual(
        [layout._paddingLeft, layout._paddingRight, layout._paddingTop, layout._paddingBottom],
        [0, 0, 0, 0],
    );
    assert.equal(layout._verticalDirection, 1, 'TOP_TO_BOTTOM');

    const row = nodeByName(items, 'RowTemplate');
    assert.equal(row._active, false, '行模板必须 inactive');
    assert.deepEqual(sizeOf(items, row), { width: CHEST_OPEN_GRID_W, height: CHEST_OPEN_CARD_H });
    const rowLayout = compOf(items, row, 'cc.Layout');
    assert.equal(rowLayout._layoutType, 1, 'HORIZONTAL');
    assert.equal(rowLayout._resizeMode, 1, 'CONTAINER：按卡数收窄，不足一行由容器居中');
    assert.equal(rowLayout._spacingX, 8);
    assert.equal(rowLayout._spacingY, 0);
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

test('D6｜脚本引用：页面 Inspector 引用 / 栅格配置全部来自 prefab', () => {
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
    assert.equal(refName(page.rowTemplate), 'RowTemplate');
    assert.equal(refName(page.cardTemplate), 'CardTemplate');
    assert.equal(refName(page.chestNode), 'Chest');
    assert.equal(page.gridColumns, 4, '列数属于 prefab 配置，不在页面写 4');
    assert.equal(page.gridMinScale, CHEST_OPEN_GRID_MIN_SCALE);
    assert.equal(page.gridBottomGap, 16);
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
    assert.equal(cardComp.iconMaxUpscale, 2, '图标最大放大倍数属于 prefab 默认值');
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

test('E1｜领地宝箱：先播地图开箱动画，奖励不再走「宝箱开启页」', () => {
    const main = read(MAIN_TS);
    // 2026-11-17 用户口径 ①：点开宝箱继续播**原有的奖励粒子动画**，页面那条入口整体让位。
    assert.doesNotMatch(main, /TerritoryChestOpenPage/,
        '领地宝箱链里不该再有「宝箱开启页」（宝箱栏 / 巡逻入口仍由组合层直连）');

    const at = main.indexOf('const tier = cellId !== null');
    assert.ok(at > 0, '宝箱档位判定不见了');
    const body = main.slice(at, main.indexOf('private presentChestRewards(', at));
    assert.match(body, /this\.presentChestRewards\(rewards, cellId, tier\)/, '档位齐了才进开箱链（要传给 chest_seq_*）');

    // 没有档位 = 不是宝石/碎片宝箱 ⇒ 仍旧当场结算
    const head = body.slice(0, body.indexOf('this.presentChestRewards(rewards, cellId, tier);'));
    assert.match(head, /if \(!tier\) \{\s*this\.settleRewards\(rewards, cellId\);/,
        '无档位（纯货币/杂项）继续走旧结算');

    // 进了开箱链就不该再结算：否则动画还没演完奖励窗就弹上来了
    const tail = body.slice(body.indexOf('this.presentChestRewards(rewards, cellId, tier);'));
    assert.doesNotMatch(tail, /settleRewards\(/, '开箱链之后不许再走旧结算（会二次弹 `FW.ShowReward`）');

    // 旧前置表演整条链路仍不复存在
    assert.doesNotMatch(main, /playChestThenSettle|wireRewardCatch/);
    assert.doesNotMatch(main, /settleRewards\([^)]*,\s*true\)/, 'suppressGain 这个口子已经删了');
});

test('E2｜`runChestOpening`：先演 `chest_seq_*`，演完发 ChestRewardsReady；起播失败立刻交棒', () => {
    const main = read(MAIN_TS);
    const at = main.indexOf('private presentChestRewards(');
    assert.ok(at > 0);
    const body = main.slice(at, main.indexOf('private findHeroTabHost(', at));
    assert.match(body, /if \(!rewards\.length\) return;/, '空奖励不弹');

    // ① 图标先取齐再起播（`chest_seq` 的飞行图标/光柱用的就是这一批 frame）
    const iconAt = body.indexOf('entries = await this.collectRewardIcons(rewards);');
    const playAt = body.indexOf('this.mapView.playChestOpen(');
    // 演出窗口从「点开箱子」那一刻就要开（取图是异步的，晚开就会抢台词）
    assert.match(body.slice(0, body.indexOf('entries = await this.collectRewardIcons')),
        /ChestPresentation, \{ playing: true \}/);
    assert.ok(iconAt > 0 && playAt > iconAt, '必须先取图再起播，否则喷空图');
    assert.match(body,
        /try \{\s*entries = await this\.collectRewardIcons\(rewards\);\s*\} catch \(error\) \{[\s\S]{0,240}?\}\s*if \(!this\.isValid\) \{/,
        '取图失败只是没图标，不许拦着开箱（catch 之后照常起播）');

    // ② 动画演完 → 发事件交棒组合层（英雄页 / 统一奖励窗由组合层决定）
    assert.match(body, /const goods = rewards\.map\(\(reward\) => \(\{ resId: Number\(reward\.resId\), number: Number\(reward\.amount\) \|\| 0 \}\)\);/);
    assert.match(body, /EventMgr\.instance\.emit\(TerritoryUiEvent\.ChestRewardsReady, \{ rewards: goods \}\)/);
    // ②' 动画最后一帧到交棒之间要留一拍缓冲（用户 2026-11-17 第 13 条 ④）：
    //     粒子动画结束 → 0.1s → 才接奖励窗 / 下一段台词，硬接会显得很急。
    assert.match(body, /this\.chestHandOffTimer = setTimeout\(/, '交棒必须延时，不能和动画最后一帧硬接');
    assert.match(body, /CHEST_HANDOFF_SETTLE_MS/, '缓冲时长要落常量，别写字面量');
    // ④ 取图是异步的：起播前必须再判一次页面是否还在
    const isValidAt = body.indexOf('if (!this.isValid) {', iconAt);
    assert.ok(isValidAt > 0 && isValidAt < playAt, '取图期间页面可能已销毁，起播前要判一次');
    // 页面先塔时要把演出窗口关掉，否则引导层会一直等下去（2-3 的台词就再也不播了）
    assert.match(body.slice(isValidAt, isValidAt + 240), /ChestPresentation[^;]*playing: false/);

    // ③ 起播失败也要交棒：表现失败不能把整箱奖励吞掉
    assert.match(body, /if \(this\.mapView\.playChestOpen\(cellId, tier, entries, handOff\)\) return;\s*handOff\(\);/,
        '`playChestOpen` 返回 false 时直接 handOff');

    // 这一路不许再按钱包/道具分流，也不许自己弹奖励窗
    assert.doesNotMatch(body, /splitTerritoryRewards|isTerritoryWalletResId|FW\.ShowReward|settleRewards/,
        '奖励怎么给玩家看由组合层统一决定（英雄页 → 统一奖励弹窗）');
});

test('点开宝箱那一下就关遮罩：等奖励回包才关会慢一个往返', () => {
    const main = read(MAIN_TS);
    const body = stripComments(main);
    // ① 按意图开窗口：只认「已翻出、还没领」的 siteTap
    assert.match(body, /EventMgr\.instance\.on\(TerritoryUiEvent\.Intent, this\.onChestTapIntent, this\)/);
    const at = body.indexOf('onChestTapIntent = (');
    assert.ok(at > 0, '缺少 onChestTapIntent');
    const tap = body.slice(at, body.indexOf('private openChestPresentation(', at));
    assert.match(tap, /intent\.kind !== 'siteTap'/, '随机格是喷资源那一路，不归它管');
    assert.match(tap, /progress\.isCellUnlocked\(intent\.cellId\)/, '只在第二步（已翻出）开窗口');
    assert.match(tap, /\|\| progress\.isOwned\(intent\.cellId\)/, '已领过的格子不开');
    // 开卡格 / 已打通的资源格也是「已解锁未拥有」：不限定在宝箱上会把 5-1 点关卡格也当成开箱
    assert.match(tap, /isTerritoryChestActionable\(state, intent\.cellId\)/, '必须用宝箱同源判据限定');
    assert.match(tap, /this\.openChestPresentation\(\)/);

    // ② 开窗口：先发 playing:true，并挂兜底计时器
    const open = body.slice(body.indexOf('private openChestPresentation('), body.indexOf('private cancelChestPresentationWatchdog('));
    assert.match(open, /ChestPresentation, \{ playing: true \}/);
    assert.match(open, /setTimeout\(/, '回包丢了也要把引导层还回去');
    assert.match(open, /CHEST_PRESENTATION_WATCHDOG_MS/);

    // ③ 奖励到达后每条不开箱的分支都自己关（否则引导层一直藏着）
    const present = body.slice(body.indexOf('private presentRewards('), body.indexOf('private onChestTapIntent'));
    const closeCount = (present.match(/this\.endChestPresentation\(\)/g) ?? []).length;
    assert.ok(closeCount >= 4, `关窗口的分支只写了 ${closeCount} 处（弹窗/随机/银币/无档位/空奖励都要关）`);
    assert.doesNotMatch(present, /this\.endChestPresentation\(\);\s*\/\/[^\n]*\n\s*this\.presentChestRewards/,
        '开箱那一路不能在这里关（动画/英雄页/奖励窗都还在窗口里）');
});

test('挂机征收那一支：先开演出窗口再弹奖励窗，收尾交给奖励窗自己的生命周期', () => {
    const main = read(MAIN_TS);
    const at = main.indexOf("if (presentation?.popup === true) {");
    assert.ok(at > 0, '挂机征收分支不见了');
    const body = main.slice(at, main.indexOf('if (presentation?.chest === false) {', at));

    // 🔴 `FW.ShowReward` 到弹窗 `enabled` 之间隔着几帧 prefab 加载。这期间若窗口已关，
    //    引导层会立刻拿回 2-3 的 `Dim` + 铺满屏 `Blocker`，奖励弹窗弹在它**下面**，
    //    收下按钮永远点不动（用户 2026-11-17 第 13 条 ②「点开宝箱弹出奖励弹窗卡死」）。
    const openAt = body.indexOf('this.openChestPresentation()');
    const showAt = body.indexOf('FW.ShowReward(');
    assert.ok(openAt > 0 && showAt > openAt, '必须先开窗口再弹窗');
    assert.doesNotMatch(body, /this\.endChestPresentation\(\)/,
        '这一支不许自己关窗：关窗要等奖励窗真的关掉（弹窗没起来由兜底计时器收）');
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


test('橙卡按**卡牌品级**识别：碎片查升级表拿英雄，再查 pvpCard.rarity===4；按卡牌 id 升序去重', () => {
    const rows = [{ id: '68005', costCardID: '18003' }, { id: '68007', costCardID: '18007' }];
    // 品级表：68005 史诗(3)、68007 金(4)。**碎片自己**的品质不参与判定 ——
    // 18003 在 item 表里是 quality 2，按道具品质筛永远命中不了（老实现就是这个问题）。
    const rarityOf = (id: string) => ({ '68005': 3, '68007': 4 } as Record<string, number>)[id] ?? 0;
    assert.deepEqual(chestLegendHeroesOf([
        { resId: 18003, number: 2 },
        { resId: 18007, number: 1 },
    ], rows, rarityOf), ['68007'], '只有金卡进英雄页');
    // 多个橙卡：**卡牌 id 升序**，与奖励数组顺序无关。
    const twoLegends = (id: string) => (id === '68001' || id === '68007' ? 4 : 0);
    const rows2 = [{ id: '68007', costCardID: '18007' }, { id: '68001', costCardID: '18003' }];
    assert.deepEqual(chestLegendHeroesOf([
        { resId: 18007, number: 1 },
        { resId: 18003, number: 1 },
        { resId: 18007, number: 1 },
    ], rows2, twoLegends), ['68001', '68007'], '按 id 升序、同英雄只展示一次');
    // 数量 0 / 表里没有这张碎片 ⇒ 不算获得。
    assert.deepEqual(chestLegendHeroesOf([{ resId: 18007, number: 0 }], rows, rarityOf), []);
    assert.deepEqual(chestLegendHeroesOf([{ resId: 99999, number: 1 }], rows, rarityOf), []);
});

test('待开启先显示闭箱，点击后才揭晓；跳过和重复点击只通知一次', async () => {
    const { ccStub, loadTsModule } = await import('./helpers/cc-sandbox');
    const layout = await import('../assets/script/app/territory/model/TerritoryChestOpenLayout');
    const entries = await import('../assets/script/app/common/RewardEntries');
    const emitted: unknown[] = [];
    const lifecycle: Array<{ phase: string }> = [];
    let now = 0;
    class PopupBase {
        isValid = true;
        closes = 0;
        closeByButton() { this.closes++; }
    }
    const { exports, unresolved } = loadTsModule<{ TerritoryChestOpenPage: new () => any }>(PAGE_TS, {
        globals: { performance: { now: () => now } },
        modules: {
            cc: ccStub({ Button: { EventType: { CLICK: 'click' } } }),
            '/PopupBase': { PopupBase }, '/BundleCatalog': {}, '/ArtPaths': {},
            '/RewardFrames': { loadRewardGoodsTables: async () => ({ items: new Map(), resources: new Map() }) },
            '/RewardEntries': entries, '/TerritoryTexts': { TERRITORY_TEXTS },
            '/TerritoryChestOpenLayout': layout, '/TerritoryChestOpenCard': {}, '/TerritoryChestOpenArt': {},
            '/ViewLifecycle': { VIEW_LIFECYCLE: 'view-lifecycle' },
            '/EventMgr': { EventMgr: { instance: { emit: (name: string, payload: any) => {
                // 只收「开箱揭晓」；生命周期事件单独记，免得搅乱 emitted.length 的断言。
                if (name === 'revealed') emitted.push([name, payload]);
                else if (name === 'view-lifecycle') lifecycle.push(payload);
            } } } },
            '/TerritoryEvents': { TerritoryUiEvent: { ChestRevealed: 'revealed' } },
        },
    });
    assert.deepEqual(unresolved, []);
    for (const skip of [false, true]) {
        const page = new exports.TerritoryChestOpenPage();
        page.cardsRoot = { active: true, setScale() {} };
        page.chestNode = { active: false, setScale() {} };
        page.cardTemplate = {}; page.rowTemplate = {};
        page.bgOpacity = {}; page.chestOpacity = {}; page.skipOpacity = {};
        page.skipButton = { node: {} }; page.closeButton = { node: {} }; page.closeLabel = {};
        page.closedChestFrame = { kind: 'closed' }; page.openedChestFrame = { kind: 'opened' };
        page.chestSprite = {};
        page.applyChestFrame = (frame: unknown) => { page.chestSprite.spriteFrame = frame; };
        page.loadCardFrames = async () => new Map(); page.loadIcon = async () => null;
        page.presentCards = () => {};
        assert.equal(page.canCloseOnBlank(), false, '加载期间点击不提前揭晓');
        assert.equal(emitted.length, skip ? 1 : 0);
        await page.onOpen({ goods: [{ resId: 18003, number: 1 }] }, { cancelled: false });
        assert.equal(lifecycle[lifecycle.length - 1].phase, 'enabled',
            '一进 onOpen 就报 enabled：引导层要立刻让位，否则放奖励对话会盖在这一页上');
        assert.equal(page._waitingToOpen, false, '首帧对齐就绪前先不展示开箱');
        page.onViewReady();
        assert.equal(page.cardsRoot.active, false);
        assert.equal(page.chestSprite.spriteFrame, page.closedChestFrame);
        assert.equal(page.closeLabel.string, TERRITORY_TEXTS.chestOpenClaim);
        const before = emitted.length;
        if (skip) page.onSkipClick();
        else {
            page.onCloseClick();
            assert.equal(page.cardsRoot.active, true);
            assert.equal(page.closes, 0);
            now += 2000;
            page.update(0);
        }
        assert.equal(page.chestSprite.spriteFrame, page.openedChestFrame);
        assert.equal(emitted.length, before + 1);
        page.finishReveal();
        assert.equal(emitted.length, before + 1);
        page.onCloseClick();
        assert.equal(page.closes, 1);
        page.onClose();
        assert.equal(page._entries.length, 0);
        assert.equal(lifecycle[lifecycle.length - 1].phase, 'disabled',
            '关掉才报 disabled：2-3 的奖励对话就是在这一刻才开始播的');
    }
});


test('橙卡特写逐个播放；关闭前一张才开下一张，退出释放当前弹窗', async () => {
    const { loadTsModule } = await import('./helpers/cc-sandbox');
    const { ResourceScope } = await import('../assets/script/core/asset/ResourceScope');
    const upgrade = await import('../assets/script/app/card/CardUpgradeCost');
    const layout = await import('../assets/script/app/territory/model/TerritoryChestOpenLayout');
    const opened: Array<{ userData: { heroId: string; progressCurrent: number; progressMax: number }; onClose(): void }> = [];
    let closed = 0;
    const chestOpens: unknown[] = [];
    let chestCloses = 0;
    const rewardCalls: unknown[][] = [];
    const events: Array<{ name: string; payload: { playing?: boolean } }> = [];
    const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
    const modules: Record<string, unknown> = {
        '/ResourceScope': { ResourceScope },
        '/ControllerBase': { ControllerBase: class {} },
        '/EventMgr': { EventMgr: { instance: { emit: (name: string, payload: unknown) => { events.push({ name, payload }); } } } },
        '/FW': { FW: { ShowReward: (goods: unknown[]) => { rewardCalls.push(goods); } } },
        '/AudioMgr': { AudioMgr: { instance: { playSound: async () => true } } },
        '/ResConst': { GAME_AUDIO: { goldFragment: '金卡碎片展示' }, GAME_AUDIO_ROOT: 'resources://塔防/音效' },
        '/ChestEvents': { CHEST_EVENTS: { REWARDS: 'chest:rewards' } },
        '/TerritoryEvents': {
            TerritoryUiEvent: {
                ChestRevealed: 'territory:chest-revealed',
                ChestRewardsReady: 'territory:chest-rewards-ready',
                ChestPresentation: 'territory:chest-presentation',
                Disposed: 'territory:view-disposed',
            },
        },
        '/TerritoryChestOpenPage': {
            TerritoryChestOpenPage: {
                open: async (params: { scope?: InstanceType<typeof ResourceScope> }) => {
                    if (params.scope?.disposed) return null;
                    chestOpens.push(params);
                    let closed = false;
                    const popup = {
                        close: () => {
                            if (closed) return;
                            closed = true;
                            chestCloses++;
                        },
                    };
                    params.scope?.defer(() => popup.close());
                    return popup;
                },
            },
        },
        '/TerritoryChestOpenLayout': layout,
        '/HeroObtainPage': {
            HeroObtainPage: {
                open: async (params: typeof opened[number] & { scope?: InstanceType<typeof ResourceScope> }) => {
                    if (params.scope?.disposed) return null;
                    let heroClosed = false;
                    let detach = () => {};
                    const origOnClose = params.onClose;
                    const wrappedParams = {
                        ...params,
                        onClose: () => {
                            if (heroClosed) return;
                            heroClosed = true;
                            detach();
                            origOnClose();
                        },
                    };
                    opened.push(wrappedParams);
                    const popup = {
                        close: () => {
                            if (heroClosed) return;
                            heroClosed = true;
                            detach();
                            closed++;
                            origOnClose();
                        },
                    };
                    detach = params.scope?.defer(() => popup.close()) ?? (() => {});
                    return popup;
                },
            },
        },
        // 3 张卡：18001 / 18002 是橙卡（rarity 4），18003 是紫卡 ⇒ 只该弹前两张。
        '/CardLineupDecks': {
            loadCardLevelUpRows: async () => [1, 2, 3].map(id => ({
                id: String(68000 + id), name: 'hero', level: 1, costCardID: String(18000 + id), costCardNum: 10,
                costArmyLevelID: '16001', costGeneralLevelID: '16000', costArmyLevelNum: 0,
            })),
            loadPvpCardRarities: async () => new Map([['68001', 4], ['68002', 4], ['68003', 2]]),
        },
        '/CardUpgradeCost': upgrade,
        '/ItemBag': { createItemCounter: () => () => 4 },
        '/CardRepository': { cardRepository: { loadHeroLevelsOnly: async () => new Map() } },
    };
    const loaded = loadTsModule<{ MainChestRewardCoordinator: new (...args: unknown[]) => any }>(
        'assets/script/app/bootstrap/main/MainChestRewardCoordinator.ts', { modules });
    assert.deepEqual(loaded.unresolved, []);
    const coordinator = Object.create(loaded.exports.MainChestRewardCoordinator.prototype);
    coordinator.scope = new ResourceScope('test');
    coordinator.isDisposed = false;
    // 奖励故意倒序 + 掺一张紫卡：出去必须是「橙卡、卡牌 id 升序」。
    const entries = [{ resId: 18002, number: 1 }, { resId: 18003, number: 1 }, { resId: 18001, number: 1 }];
    const owner = { isValid: true };
    const task = coordinator.presentChestHeroes(entries, () => !owner.isValid);
    await tick();
    assert.equal(opened.length, 1);
    assert.deepEqual({ ...opened[0].userData }, { heroId: '68001', progressCurrent: 4, progressMax: 10 },
        '先弹 id 最小的橙卡（紫卡 68003 不弹）');
    opened[0].onClose();
    await tick();
    assert.equal(opened.length, 2, '关掉前一张才开下一张');
    assert.equal(opened[1].userData.heroId, '68002');
    coordinator.isDisposed = true;
    coordinator.scope.dispose();
    await task;
    assert.equal(closed, 1);
    assert.equal(opened.length, 2);

    const stale = Object.create(loaded.exports.MainChestRewardCoordinator.prototype);
    stale.scope = new ResourceScope('stale'); stale.isDisposed = false;
    const staleOwner = { isValid: false };
    await stale.presentChestHeroes(entries, () => !staleOwner.isValid);
    assert.equal(opened.length, 2, '回包前已失效时不再弹英雄');

    // 整条链：英雄页全部关掉之后才是统一「获得奖励」弹窗，且拿到的是**整批**奖励。
    const chain = Object.create(loaded.exports.MainChestRewardCoordinator.prototype);
    chain.scope = new ResourceScope('chain'); chain.isDisposed = false;
    const chainOwner = { isValid: true };
    const rewards = [{ resId: 18002, number: 1 }, { resId: 18001, number: 1 }, { resId: 7, number: 300 }];
    const chainTask = chain.runChestRewardChain(rewards, () => !chainOwner.isValid);
    await tick();
    assert.equal(opened.length, 3);
    assert.equal(rewardCalls.length, 0, '英雄页没关完不许弹统一奖励窗');
    opened[2].onClose();
    await tick();
    assert.equal(opened.length, 4);
    opened[3].onClose();
    await tick();
    await chainTask;
    // 沙箱里 new 出来的对象原型与宿主不同，deepStrictEqual 会假红 ⇒ 先重建成宿主对象再比。
    assert.deepEqual(
        rewardCalls.map(call => call.map(one => ({ ...(one as { resId: number; number: number }) }))),
        [[{ resId: 18002, number: 1 }, { resId: 18001, number: 1 }, { resId: 7, number: 300 }]],
        '统一奖励窗拿到整批（含货币），且只弹一次');
    // 有统一奖励弹窗接棒时协调器**不**关窗口：弹窗要等 prefab 加载完才 enabled，
    // 这里抢先关会让 2-3 的对话框闪一下再被盖住。窗口由引导层在奖励窗关闭时收。
    assert.deepEqual(events.map(one => [one.name, one.payload.playing]), []);
    // 没有弹窗可等（空奖励 / 页面已毁掉）时必须自己关，否则引导层永远让位
    await chain.runChestRewardChain([], () => false);
    assert.deepEqual(events.map(one => [one.name, one.payload.playing]),
        [['territory:chest-presentation', false]]);

    const treasureHost = Object.create(loaded.exports.MainChestRewardCoordinator.prototype);
    treasureHost.scope = new ResourceScope('treasure');
    treasureHost.isDisposed = false;
    const goods = [{ resId: 18001, number: 2 }];
    treasureHost.onTreasureRewards({ goods: [] });
    assert.equal(chestOpens.length, 0, '忽略空奖励');
    treasureHost.onTreasureRewards({ goods });
    await tick();
    assert.equal(chestOpens.length, 1);
    assert.equal((chestOpens[0] as { userData: { goods: unknown } }).userData.goods, goods);
    treasureHost.onTreasureRewards({ goods });
    treasureHost.isDisposed = true;
    treasureHost.scope.dispose();
    await tick();
    assert.equal(chestCloses, 2, '退出时关闭已开及加载中的开箱弹窗');
});


test('铺奖励前激活父节点，使卡片 onLoad 与 Layout 先于填图、动画基准采样执行', () => {
    const page = read(PAGE_TS);
    const body = page.slice(page.indexOf('    private presentCards('), page.indexOf('    private availableGridHeight('));
    const activeAt = body.indexOf('this.cardsRoot.active = true;');
    assert.ok(activeAt >= 0, '隐藏的父节点会阻止卡片 onLoad，render 无法赋图');
    assert.ok(activeAt < body.indexOf('instantiate(this.rowTemplate)'), '必须在创建行与卡片之前激活');
    assert.ok(activeAt < body.indexOf('updateLayout()'), 'Layout 排版后才能采样动画基准');
});
