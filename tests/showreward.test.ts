/**
 * 「获得奖励」弹窗（老端 `LayerShowReward`，FGUI `获得奖励/组件/组件_获得奖励.xml`）的单测。
 *
 * ## 盯住哪六类东西（按「错了会不会报错」排序）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `ShowRewardTable` 的纯口径（网格几何 / 排序 / 图标分流 / 帧换算 / **虚拟窗口公式**） | 静默 —— 4×3 算成 3×4、货币格只剩品质框、错峰时间算错、滚动后空白 + 数据错行 |
 * | B | 美术映射 ↔ 磁盘 ↔ `.meta` border 双向对账 | 静默留白 / 九宫图按 SIMPLE 画 ⇒ 拉伸变形 |
 * | C | prefab 结构 + 几何（12 个槽位坐标 ↔ `slotLocalCenterOf`、5 星静置位 ↔ `SR_STAR_TRACKS.from`、加色混合、`HintLabel` 的 `overflow`） | 静默 —— 整块偏心 / 星点飞散起点错 / 闪光不发光 / 提示文案被压字号 |
 * | D | 视图脚本的**生命周期与账本**（源码文本） | 静默 —— 滑一次重播一遍动画、槽位复用后播放上一格的轨迹、音效不播 |
 * | E | 文案 + 音效 key（与 `mL.json` / `audioConfig.json` / 磁盘 mp3 对账） | 静默 —— 文案与设计稿分叉 / 音效 `null` 静默丢弃 |
 * | F | 全局入口接线 + 反向守卫（`FW` / 组合根 / 两个 Repository / `HeadGridList` 的死回调） | 静默 —— `FW.ShowReward` 空转（20+ 个调用点全不弹）/ 换头像点一格选不中 |
 *
 * ## 为什么能直接 `import` 这些源码
 *
 * `ShowRewardTable` / `ShowRewardTexts` / `ShowRewardArt` 的 import 链上**没有 `cc`**。
 * ⚠️ `ShowRewardPage` / `ShowRewardItem` / `ShowRewardGrid` / `GoodsBox` **都带 `cc`**
 * ⇒ 本文件**不** import 它们（相关约束走 D / F 组的源码文本断言）。
 *
 * ⚠️ 这也是 `windowSlotOf()` 从 `ShowRewardGrid.ts`（带 `cc`）搬到 `ShowRewardTable.ts`
 * 的原因 —— 它正是 `HeadGridList` 当年写错的那条公式，必须能被穷举守卫（规则 78）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { SR_ART_NAMES, SR_ART_SLICED, SR_ART_TILED } from '../assets/script/app/showReward/ShowRewardArt';
import { SHOW_REWARD_SOUNDS, SHOW_REWARD_TEXTS, showRewardSoundKey } from '../assets/script/app/showReward/ShowRewardTexts';
import {
    FGUI_FPS,
    SR_COLUMNS,
    SR_COL_GAP,
    SR_ITEM_SIZE,
    SR_ROWS,
    SR_ROW_GAP,
    SR_SLOT_COUNT,
    SR_STAGGER_MS,
    SR_STAR_COUNT,
    SR_STAR_TRACKS,
    SR_STEP_X,
    SR_STEP_Y,
    SR_VIEW_H,
    SR_VIEW_W,
    contentHeightOf,
    framesToSeconds,
    maxTopRowOf,
    parseCmdGoodsList,
    rewardEntryOf,
    rewardIconPathOf,
    rowsOf,
    columnsOf,
    slotLocalCenterOf,
    sortRewardEntries,
    staggerSecondsOf,
    toCmdGoods,
    windowSlotOf,
} from '../assets/script/app/showReward/ShowRewardTable';
import type { IRewardEntry } from '../assets/script/app/showReward/ShowRewardTable';
import { parseItemRows, parseRolePropertyRows } from '../assets/script/app/activity/LayerActivityTable';

// ============================================================
// 公共小工具
// ============================================================

const CANVAS_W = 720;
const CANVAS_H = 1280;
const IMAGE_ROOT = 'assets/resources/image';
const PREFAB = 'assets/resources/ui/ShowReward/ShowReward.prefab';
const GENERATOR = 'tmp/gen_showreward.mjs';

const PAGE_SRC = readFileSync('assets/script/app/showReward/ShowRewardPage.ts', 'utf8');
const ITEM_SRC = readFileSync('assets/script/app/showReward/ShowRewardItem.ts', 'utf8');
const GRID_SRC = readFileSync('assets/script/app/showReward/ShowRewardGrid.ts', 'utf8');
const HEAD_SRC = readFileSync('assets/script/app/playerinfo/HeadGridList.ts', 'utf8');
const FW_SRC = readFileSync('assets/script/framework/FW.ts', 'utf8');
const BOOTSTRAP_SRC = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
const CELEB_SRC = readFileSync('assets/script/app/celebration/CelebrationRepository.ts', 'utf8');
const FIRST_SRC = readFileSync('assets/script/app/firstRecharge/FirstRechargeRepository.ts', 'utf8');
const GEN_SRC = readFileSync(GENERATOR, 'utf8');

function loadPrefab(): any[] {
    return JSON.parse(readFileSync(PREFAB, 'utf8')) as any[];
}

/**
 * 去掉行注释与块注释。
 *
 * ⚠️ **「不许出现 X」这类反向断言必须在剥掉注释的源码上做** —— 否则注释里提到 X
 * （本项目的注释写得非常啰嗦，专门会写「别用 `Button.EventType.CLICK`」这种）就会让守卫
 * 永远红着，最后被人顺手删掉。正向断言仍用原文（注释里出现不影响）。
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 剥掉注释的几份源码（供反向断言用）。 */
const GRID_CODE = stripComments(GRID_SRC);
const ITEM_CODE = stripComments(ITEM_SRC);
const PAGE_CODE = stripComments(PAGE_SRC);
const HEAD_CODE = stripComments(HEAD_SRC);

/** 每个节点对象 → prefab 内的 `A/B/C` 路径（含根名，与生成器的 `F` 同一口径）。 */
function pathIndex(o: any[]): Map<string, number> {
    const byPath = new Map<string, number>();
    const walk = (index: number, prefix: string) => {
        const node = o[index];
        if (!node || node.__type__ !== 'cc.Node') return;
        const path = prefix ? `${prefix}/${node._name}` : node._name;
        byPath.set(path, index);
        for (const child of node._children ?? []) walk(child.__id__, path);
    };
    o.forEach((node, index) => {
        if (node && node.__type__ === 'cc.Node' && node._parent === null) walk(index, '');
    });
    return byPath;
}

function uitOf(o: any[], nodeIndex: number): any {
    const id = nodeIndex;
    const ref = (o[id]._components as any[]).find((c) => o[c.__id__].__type__ === 'cc.UITransform');
    return o[ref.__id__];
}

function compOf(o: any[], nodeIndex: number, type: string): any {
    const ref = (o[nodeIndex]._components as any[]).find((c) => o[c.__id__].__type__ === type);
    return ref ? o[ref.__id__] : null;
}

function spriteUuidOf(o: any[], nodeIndex: number): string {
    const sprite = compOf(o, nodeIndex, 'cc.Sprite');
    return String(sprite?._spriteFrame?.__uuid__ ?? '').replace('@f9941', '');
}

function prefabUuid(path: string): string {
    return (JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { uuid: string }).uuid;
}

function metaOf(rel: string): { uuid: string; rawW: number; rawH: number; border: number[] } {
    const head = `${IMAGE_ROOT}/${rel}.png.meta`;
    const j = JSON.parse(readFileSync(head, 'utf8')) as any;
    const u = j.subMetas.f9941.userData;
    return {
        uuid: j.uuid,
        rawW: u.rawWidth ?? u.width,
        rawH: u.rawHeight ?? u.height,
        border: [u.borderLeft || 0, u.borderTop || 0, u.borderRight || 0, u.borderBottom || 0],
    };
}

/** 从生成器源码读一个 `const X = <number>;`。 */
function genConst(name: string): number {
    const m = GEN_SRC.match(new RegExp(`const ${name} = (-?[\\d.]+);`));
    assert.ok(m, `生成器里读不到 const ${name}`);
    return Number(m![1]);
}

// ============================================================
// A. 纯口径
// ============================================================

test('A1｜网格几何：4 列 × 3 行 = 12 格，且是 flow_hz 的「放得下就放」口径', () => {
    // 468 宽放得下 4×100 + 3×20 = 460，放不下第 5 个 ⇒ 4 列
    assert.equal(columnsOf(SR_VIEW_W), 4);
    // 330 高放得下 3×100 + 2×12 = 324，放不下第 4 行 ⇒ 3 行
    assert.equal(rowsOf(SR_VIEW_H), 3);
    assert.equal(SR_COLUMNS, 4);
    assert.equal(SR_ROWS, 3);
    assert.equal(SR_SLOT_COUNT, 12);
    assert.equal(SR_ITEM_SIZE + SR_COL_GAP, SR_STEP_X);
    assert.equal(SR_ITEM_SIZE + SR_ROW_GAP, SR_STEP_Y);

    // ⚠️ 口径是 `⌊(视口 + gap) / (格 + gap)⌋`，**不是** `⌊(视口 − gap) / step⌋ + 1`：
    //    后者在整除时（例如 440 宽 / 100+10）会少算一个。
    assert.equal(columnsOf(440, 100, 10), 4);
    assert.equal(columnsOf(439.9, 100, 10), 4);
    assert.equal(columnsOf(460, 100, 20), 4);
});

test('A2｜槽位中心：每行各自水平居中 + 整块垂直居中（不是整块左上对齐）', () => {
    // 12 格（满 3 行）：行内块宽 460 ⇒ 左边距 (468−460)/2 = 4；块高 324 ⇒ 上边距 (330−324)/2 = 3
    assert.deepEqual(slotLocalCenterOf(0), { x: 54, y: 53 });
    assert.deepEqual(slotLocalCenterOf(1), { x: 174, y: 53 });
    assert.deepEqual(slotLocalCenterOf(3), { x: 414, y: 53 });
    assert.deepEqual(slotLocalCenterOf(4), { x: 54, y: 165 });
    assert.deepEqual(slotLocalCenterOf(11), { x: 414, y: 277 });

    // 末行不满时**那一行也要居中**：5 格 ⇒ 第 2 行只有 1 格，x = (468−100)/2 + 50 = 234；
    // 而整块高 212 ⇒ 上边距 (330−212)/2 = 59 ⇒ y = 59 + 112 + 50 = 221
    assert.deepEqual(slotLocalCenterOf(4, 5), { x: 234, y: 221 });
    // 总数为 0 / 负数时不许炸（`Math.max(1, …)` 兜底）
    assert.ok(Number.isFinite(slotLocalCenterOf(0, 0).x));
});

test('A3｜虚拟窗口公式 windowSlotOf：槽位位置固定、只换数据窗口', () => {
    // topRow = 0 时槽位 i ↔ 数据 i
    for (let slot = 0; slot < SR_SLOT_COUNT; slot += 1) {
        assert.equal(windowSlotOf(slot, 0), slot, `topRow=0 槽位 ${slot}`);
    }
    // topRow = 1 时整块下移一行：槽位 0..3 → 4..7（槽位 0 **仍然可见**，这正是旧模型的病灶）
    assert.deepEqual(
        Array.from({ length: SR_SLOT_COUNT }, (_u, i) => windowSlotOf(i, 1)),
        [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    );
    assert.deepEqual(
        Array.from({ length: SR_SLOT_COUNT }, (_u, i) => windowSlotOf(i, 2)),
        [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
    // 行内列号在换窗口时**不变**（槽位 0 永远是最左列）
    for (let slot = 0; slot < SR_SLOT_COUNT; slot += 1) {
        assert.equal(windowSlotOf(slot, 3) % SR_COLUMNS, slot % SR_COLUMNS);
    }
});

test('A4｜内容高 / 最大顶行：内容不够高就不可滚（maxTopRow = 0）', () => {
    assert.equal(contentHeightOf(0), SR_ITEM_SIZE);
    assert.equal(contentHeightOf(4), 100);
    assert.equal(contentHeightOf(5), 100 + SR_ROW_GAP + 100);
    assert.equal(contentHeightOf(8), 2 * SR_STEP_Y - SR_ROW_GAP);
    // 12 格（3 行）刚好填满 324 < 330 ⇒ 不可滚
    assert.equal(contentHeightOf(12), 324);
    assert.equal(maxTopRowOf(12), 0);
    // 15 格（原稿预摆的 15 个 `<item/>`）= 4 行 436 ⇒ 可滚 1 行
    assert.equal(contentHeightOf(15), 436);
    assert.equal(maxTopRowOf(15), 1);
    // 19 格 → 5 行 548，(548−330)/112 = 1.946 ⇒ ceil = 2
    assert.equal(maxTopRowOf(19), 2);
    assert.equal(maxTopRowOf(19), Math.ceil((contentHeightOf(19) - SR_VIEW_H) / SR_STEP_Y));
});

test('A5｜数量归一化：uint64 是 Long，`toCount` 必须吃 number / string / Long，且丢掉 resId<=0', () => {
    assert.deepEqual(toCmdGoods({ resId: 10, number: 3 }), { resId: 10, number: 3 });
    assert.deepEqual(toCmdGoods({ resId: '10', number: '3' }), { resId: 10, number: 3 });
    // protobufjs 的 Long（有 low/high）—— 直接当 number 用会得到 `[object Object]`
    assert.deepEqual(toCmdGoods({ resId: { low: 10, high: 0 }, number: { low: 5, high: 0 } }), { resId: 10, number: 5 });
    assert.equal(toCmdGoods({ resId: 0, number: 1 }), null);
    assert.equal(toCmdGoods({ resId: -3, number: 1 }), null);
    assert.equal(toCmdGoods(null), null);
    assert.equal(toCmdGoods('10'), null);
    assert.equal(toCmdGoods(undefined), null);

    assert.deepEqual(parseCmdGoodsList([{ resId: 1 }, { resId: 0 }, null, { resId: 2, number: 4 }]),
        [{ resId: 1, number: 0 }, { resId: 2, number: 4 }]);
    // 非数组一律空（老端 `UpdateList()` 里 `length <= 0` ⇒ 关窗）
    assert.deepEqual(parseCmdGoodsList(undefined), []);
    assert.deepEqual(parseCmdGoodsList({ resId: 1 }), []);
    assert.deepEqual(parseCmdGoodsList([]), []);
});

test('A6｜奖励排序：品质降序，品质相同时按 resId 升序（不是数量）', () => {
    const of = (resId: number, quality: number, number = 1): IRewardEntry =>
        ({ resId, quality, number, iconPath: '' });
    const sorted = sortRewardEntries([of(7, 1), of(9, 5), of(3, 5), of(4, 2), of(1, 5, 999)]);
    assert.deepEqual(sorted.map((e) => [e.resId, e.quality]), [[1, 5], [3, 5], [9, 5], [4, 2], [7, 1]]);
    // 不改原数组
    const src = [of(7, 1), of(9, 5)];
    sortRewardEntries(src);
    assert.deepEqual(src.map((e) => e.resId), [7, 9]);
});

test('A7｜图标分流：`item` 表直通、`roleProperty` 表落 icons/resource（只走一支就整格没图）', () => {
    // item：`icon` 是相对 resources 的路径
    assert.ok(rewardIconPathOf({ name: '图纸', quality: 3, icon: 'icons/item/icon_zhitu', iconIsPath: true })
        .startsWith('icons/'));
    // roleProperty：`icon` 是 FGUI 组件名 ⇒ 必须落到 icons/resource/<name>
    assert.equal(rewardIconPathOf({ name: '金币', quality: 3, icon: '图标_幻灵玉', iconIsPath: false }),
        'icons/resource/图标_幻灵玉');
    assert.equal(rewardIconPathOf(null), '');

    // 两张表的真源解析（`parseItemRows` / `parseRolePropertyRows` 的 `iconIsPath` 分流）
    const items = parseItemRows([{ resId: 101, name: '图纸', quality: 3, icon: 'icons/item/icon_zhitu' }]);
    const resources = parseRolePropertyRows([{ resId: 10, name: '金币', quality: 4, icon: '图标_幻灵玉' }]);
    assert.equal(items.get(101)?.iconIsPath, true);
    assert.equal(resources.get(10)?.iconIsPath, false);

    const fromItem = rewardEntryOf({ resId: 101, number: 2 }, items, resources);
    assert.equal(fromItem.quality, 3);
    assert.ok(fromItem.iconPath.startsWith('icons/'));
    const fromResource = rewardEntryOf({ resId: 10, number: 0 }, items, resources);
    assert.equal(fromResource.quality, 4);
    assert.equal(fromResource.iconPath, 'icons/resource/图标_幻灵玉');
    // 两张表都查不到 ⇒ 安全降级（品质 1 + 无图标），不是抛错
    const miss = rewardEntryOf({ resId: 999999, number: 1 }, items, resources);
    assert.deepEqual([miss.quality, miss.iconPath], [1, '']);
});

test('A8｜动画时间轴：FGUI 帧率 60，错峰是 100×(index+1) ms', () => {
    assert.equal(FGUI_FPS, 60);
    assert.equal(framesToSeconds(5), 5 / 60);
    assert.equal(framesToSeconds(0), 0);
    assert.equal(framesToSeconds(13), 13 / 60);
    assert.equal(SR_STAGGER_MS, 100);
    assert.equal(staggerSecondsOf(0), 0.1);
    assert.equal(staggerSecondsOf(1), 0.2);
    assert.equal(staggerSecondsOf(11), 1.2);
    // 负数 / 小数下标不许算出负延迟
    assert.equal(staggerSecondsOf(-5), 0.1);
    assert.equal(staggerSecondsOf(2.7), 0.3);
});

test('A9｜5 星轨迹：个数、顺序、与 prefab 用的静置位三处一致', () => {
    assert.equal(SR_STAR_COUNT, 5);
    assert.equal(SR_STAR_TRACKS.length, SR_STAR_COUNT);
    // `from` 出自原稿 `xy`（设计位），`mid`/`to` 出自 transition 的 `t=5` 帧
    assert.deepEqual(SR_STAR_TRACKS.map((t) => t.from), [
        [27.5, 23.5], [-30, -23], [-13, 12], [23, -26], [-26.5, 32.5],
    ]);
    assert.deepEqual(SR_STAR_TRACKS.map((t) => t.mid), [
        [11.5, 8.5], [-25, -28], [-13, 12], [6.5, -12.5], [-8, 15],
    ]);
    assert.deepEqual(SR_STAR_TRACKS.map((t) => t.to), [
        [58.5, 41.5], [-49, -40], [-68, 25], [35.5, -34.5], [-27, 56],
    ]);
    // 每个轨迹的三帧都必须是有限数（NaN 会让 tween 静默不动）
    for (const track of SR_STAR_TRACKS) {
        for (const p of [track.from, track.mid, track.to]) {
            assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]), `轨迹出现非有限数 ${p}`);
        }
    }
});

// ============================================================
// B. 美术 ↔ 磁盘 ↔ `.meta`
// ============================================================

test('B1｜5 张图全在磁盘上，且尺寸与 `ShowRewardArt` 注释一致', () => {
    assert.deepEqual(Object.keys(SR_ART_NAMES).sort(), ['glow', 'hintBg', 'panelBg', 'star', 'title']);
    for (const [key, rel] of Object.entries(SR_ART_NAMES)) {
        const png = `${IMAGE_ROOT}/${rel}.png`;
        assert.ok(existsSync(png), `${key} → ${png} 不存在`);
        assert.ok(existsSync(`${png}.meta`), `${key} 缺 .png.meta（编辑器没导入）`);
    }
    const expectSize: Record<string, [number, number]> = {
        panelBg: [338, 280],
        title: [388, 97],
        glow: [200, 200],
        hintBg: [310, 32],
        star: [100, 100],
    };
    for (const [key, [w, h]] of Object.entries(expectSize)) {
        const m = metaOf(SR_ART_NAMES[key]);
        assert.deepEqual([m.rawW, m.rawH], [w, h], `${key} 的原尺寸`);
    }
});

test('B2｜九宫名单 ↔ `.meta` border 双向对账（只有弹窗底是九宫）', () => {
    for (const key of SR_ART_SLICED) {
        assert.ok(key in SR_ART_NAMES, `SLICED 名单里的 ${key} 不在 NAMES 里`);
    }
    assert.deepEqual([...SR_ART_SLICED], ['panelBg']);
    assert.equal(SR_ART_TILED.size, 0, '本模块没有平铺图（但常量必须存在：内核要 readArtSet）');

    // FGUI `scale9grid="84,97,168,69"` 是 **Rectangle(x,y,w,h)（中间区域）**，不是 l,t,r,b
    assert.deepEqual(metaOf(SR_ART_NAMES.panelBg).border, [84, 97, 86, 114]);
    // 其余四张 border 必须全 0 —— 有一张非 0 却没进名单 = 内核自检③ 会 fail
    for (const [key, rel] of Object.entries(SR_ART_NAMES)) {
        const hasBorder = metaOf(rel).border.some((v) => v > 0);
        assert.equal(hasBorder, SR_ART_SLICED.has(key),
            `${key}（${rel}）border ${hasBorder ? '非 0' : '全 0'}，而名单里${SR_ART_SLICED.has(key) ? '有' : '没有'}它`);
    }
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

test('C1｜根节点与直接子序：PanelBg → TitleImage → RewardGrid → HintBg → HintLabel', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const root = byPath.get('ShowReward');
    assert.ok(root !== undefined, '找不到根节点 ShowReward');
    assert.equal(o[root!]._parent, null);
    // `cc.Prefab.data` 指向真根
    assert.equal(o[0].__type__, 'cc.Prefab');
    assert.equal(o[0].data.__id__, root);

    const rootUi = uitOf(o, root!);
    assert.deepEqual([rootUi._contentSize.width, rootUi._contentSize.height], [CANVAS_W, CANVAS_H]);
    assert.equal(rootUi._anchorPoint.x, 0.5);
    assert.equal(rootUi._anchorPoint.y, 0.5);

    const childNames = (o[root!]._children as any[]).map((c) => o[c.__id__]._name);
    assert.deepEqual(childNames, ['PanelBg', 'TitleImage', 'RewardGrid', 'HintBg', 'HintLabel']);
    // `com_float`（组件_通用_浮动界面标识，跨包）/ `n13`（group）/ 15 个 `<item/>` 都不该出现
    for (const bad of ['com_float', 'n13', 'item', 'item#1']) {
        assert.equal(byPath.has(`ShowReward/${bad}`), false, `不该迁进来的节点 ${bad}`);
    }
});

test('C2｜全部节点的 layer 恒 33554432、`_lscale` 只允许 ±1（规则 80① / 生成器自检①）', () => {
    const o = loadPrefab();
    const nodes = o.filter((v) => v && v.__type__ === 'cc.Node');
    assert.ok(nodes.length > 100, `节点数异常：${nodes.length}`);
    for (const n of nodes) {
        assert.equal(n._layer, 33554432, `${n._name} 的 layer`);
        assert.ok((n._lscale.x === 1 || n._lscale.x === -1) && (n._lscale.y === 1 || n._lscale.y === -1),
            `${n._name} 的 _lscale=(${n._lscale.x},${n._lscale.y}) —— scale 必须吸进尺寸`);
        assert.ok(Number.isFinite(n._lpos.x) && Number.isFinite(n._lpos.y), `${n._name} 的 _lpos`);
    }
});

test('C3｜四个主元素的盒 + 锚点（锚点 = FGUI `pivot`，缩放/生长原点）', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const at = (path: string) => {
        const i = byPath.get(`ShowReward/${path}`);
        assert.ok(i !== undefined, `找不到 ${path}`);
        const ui = uitOf(o, i!);
        return {
            lpos: [o[i!]._lpos.x, o[i!]._lpos.y] as [number, number],
            anchor: [ui._anchorPoint.x, ui._anchorPoint.y] as [number, number],
            size: [ui._contentSize.width, ui._contentSize.height] as [number, number],
        };
    };

    // 弹窗底 648×402（原稿 338×280 的九宫拉伸）
    assert.equal(byPath.has('ShowReward/PanelBg'), true);
    // 标题图 456×114（原稿 388×97 等比放大）
    assert.equal(byPath.has('ShowReward/TitleImage'), true);
    // 网格视口 = FGUI `list` 的 `xy="122,461" size="468,330"`
    assert.deepEqual(at('RewardGrid').size, [SR_VIEW_W, SR_VIEW_H]);
    assert.deepEqual(at('RewardGrid').anchor, [0, 1]);
    assert.deepEqual(at('HintBg').size, [310, 32]);

    // 🔴 `PanelBg` / `TitleImage` / `HintLabel` 的锚点必须是 (0.5,0.5)：
    //    原稿 `pivot="0.5,0.5"`，而 Cocos 的锚点**同时是缩放原点与 contentSize 生长的原点**。
    //    留生成器默认的 (0,1) 会让 `setScale(1,0.3)` 朝上边缘塌陷（应绕中心），不报错只看图。
    for (const name of ['PanelBg', 'TitleImage', 'HintLabel']) {
        assert.deepEqual(at(name).anchor, [0.5, 0.5], `${name} 的锚点应等于 FGUI pivot (0.5,0.5)`);
    }

    // 视口锚点 (0,1) ⇒ 相对根中心的 `_lpos` = (l − 360, 640 − t)
    assert.deepEqual(at('RewardGrid').lpos, [122 - CANVAS_W / 2, CANVAS_H / 2 - 461]);
    assert.deepEqual(at('HintBg').lpos, [217 - CANVAS_W / 2, CANVAS_H / 2 - 842]);
});

test('C4｜`Content` 层：与 `list` 同盒同锚点、`_lpos` 恒 (0,0)（不存在则 `viewHeight` 会被覆写）', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const grid = byPath.get('ShowReward/RewardGrid')!;
    const content = byPath.get('ShowReward/RewardGrid/Content');
    assert.ok(content !== undefined, '缺少 Content 层');
    assert.equal(o[content!]._parent.__id__, grid);
    assert.deepEqual([o[content!]._lpos.x, o[content!]._lpos.y], [0, 0]);
    const ui = uitOf(o, content!);
    assert.deepEqual([ui._contentSize.width, ui._contentSize.height], [SR_VIEW_W, SR_VIEW_H]);
    assert.deepEqual([ui._anchorPoint.x, ui._anchorPoint.y], [0, 1]);
    // 槽位全部挂在 Content 下（`ShowRewardGrid.slots` = `content.children`）
    assert.equal((o[content!]._children as any[]).length, SR_SLOT_COUNT);
});

test('C5｜12 个槽位：坐标 = `slotLocalCenterOf(i)`、兄弟序 = 槽位序、锚点 (0.5,0.5)', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    for (let i = 0; i < SR_SLOT_COUNT; i += 1) {
        const path = `ShowReward/RewardGrid/Content/Slot${i + 1}`;
        const idx = byPath.get(path);
        assert.ok(idx !== undefined, `缺槽位 ${path}`);
        const c = slotLocalCenterOf(i);
        // Content 的锚点 = 视口左上角 ⇒ 槽位 `_lpos` = (视口内 x, −视口内 y)
        assert.deepEqual([o[idx!]._lpos.x, o[idx!]._lpos.y], [c.x, -c.y], `Slot${i + 1} 的坐标`);
        const ui = uitOf(o, idx!);
        assert.deepEqual([ui._contentSize.width, ui._contentSize.height], [SR_ITEM_SIZE, SR_ITEM_SIZE]);
        assert.deepEqual([ui._anchorPoint.x, ui._anchorPoint.y], [0.5, 0.5]);
        assert.equal(o[idx!]._active, true, `Slot${i + 1} 必须烘 _active=true（规则 86）`);
    }
    // 槽位兄弟序必须与 `slots[slot]` 一致（`windowSlotOf` 的 slot 参数就是它）
    const content = byPath.get('ShowReward/RewardGrid/Content')!;
    const names = (o[content]._children as any[]).map((c) => o[c.__id__]._name);
    assert.deepEqual(names, Array.from({ length: SR_SLOT_COUNT }, (_u, i) => `Slot${i + 1}`));
});

test('C6｜每格的兄弟序 = 原稿 displayList 序：Goods → Glow → Star1..Star5', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const slot = byPath.get('ShowReward/RewardGrid/Content/Slot7')!;
    assert.deepEqual((o[slot]._children as any[]).map((c) => o[c.__id__]._name),
        ['Goods', 'Glow', 'Star1', 'Star2', 'Star3', 'Star4', 'Star5']);
    const goods = byPath.get('ShowReward/RewardGrid/Content/Slot7/Goods')!;
    assert.deepEqual((o[goods]._children as any[]).map((c) => o[c.__id__]._name), ['Frame', 'Icon', 'Num']);
});

test('C7｜物品框三件套：尺寸 / 锚点 / `Num` 的 overflow 与字号（照 `gen_maintask` 的同一套折算）', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const base = 'ShowReward/RewardGrid/Content/Slot1/Goods';
    const frame = byPath.get(`${base}/Frame`)!;
    const icon = byPath.get(`${base}/Icon`)!;
    const num = byPath.get(`${base}/Num`)!;
    assert.deepEqual(uitOf(o, frame)._contentSize.width, 100);
    assert.deepEqual(uitOf(o, icon)._contentSize.width, 80, 'Icon = 0.8 全盒');
    assert.deepEqual([o[icon]._lpos.x, o[icon]._lpos.y], [0, 0], 'Icon 居中');
    // ⚠️ `Num` 锚点必须是 (1,0.5)：老端 `text_number` 宽 13 是**单字符**宽，
    //    实际数量靠 `overflow=NONE` 回写实测宽度 ⇒ 右对齐只能靠锚点（写 (0,1) 会右溢出）
    assert.deepEqual([uitOf(o, num)._anchorPoint.x, uitOf(o, num)._anchorPoint.y], [1, 0.5]);
    assert.equal(compOf(o, num, 'cc.Label')._overflow, 0);
    assert.equal(compOf(o, num, 'cc.Label')._enableWrapText, false);
    assert.equal(compOf(o, num, 'cc.Label')._fontSize, 24);
    // `Goods` 自己不该有 Sprite（三件套在**子节点**上）
    assert.equal(compOf(o, byPath.get('ShowReward/RewardGrid/Content/Slot1/Goods')!, 'cc.Sprite'), null);
});

test('C8｜闪光 + 5 星：尺寸 / 加色混合 / 颜色 / 静置位 = `SR_STAR_TRACKS.from`', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    let additive = 0;
    for (let i = 0; i < SR_SLOT_COUNT; i += 1) {
        const slot = `ShowReward/RewardGrid/Content/Slot${i + 1}`;
        const glow = byPath.get(`${slot}/Glow`)!;
        const glowUi = uitOf(o, glow);
        assert.deepEqual([glowUi._contentSize.width, glowUi._contentSize.height], [200, 200]);
        assert.deepEqual([o[glow]._lpos.x, o[glow]._lpos.y], [0, 0], 'Glow 居中于槽位');
        assert.deepEqual([glowUi._anchorPoint.x, glowUi._anchorPoint.y], [0.5, 0.5]);
        assert.equal(o[glow]._active, false, 'Glow 原稿 visible="false"（忠实用 false；它身上没脚本，不会死锁）');

        for (let s = 0; s < SR_STAR_COUNT; s += 1) {
            const star = byPath.get(`${slot}/Star${s + 1}`)!;
            const track = SR_STAR_TRACKS[s];
            assert.deepEqual([o[star]._lpos.x, o[star]._lpos.y], [track.from[0], track.from[1]],
                `Slot${i + 1}/Star${s + 1} 静置位应等于 SR_STAR_TRACKS[${s}].from`);
            assert.deepEqual([uitOf(o, star)._anchorPoint.x, uitOf(o, star)._anchorPoint.y], [0.5, 0.5],
                '星点锚点必须 (0.5,0.5)（`_lpos` 口径 = 相对槽位中心）');
            assert.equal(o[star]._active, false);
        }

        // 5 张星图尺寸各不相同（原稿 37/46/28/56/27），共用同一张 `common/cu_star_01`
        const sizes = SR_STAR_TRACKS.map((_t, s) => uitOf(o, byPath.get(`${slot}/Star${s + 1}`)!)._contentSize.width);
        assert.deepEqual(sizes, [37, 46, 28, 56, 27]);

        // 加色混合：`blend="add"` ⇒ src=SRC_ALPHA(2) + dst=ONE(1)
        for (const node of [glow, ...SR_STAR_TRACKS.map((_t, s) => byPath.get(`${slot}/Star${s + 1}`)! )]) {
            const sprite = compOf(o, node, 'cc.Sprite');
            assert.equal(sprite._dstBlendFactor, 1, `${o[node]._name} 的 dstBlendFactor 应为 1(ONE)`);
            assert.equal(sprite._srcBlendFactor, 2, 'SRC_ALPHA 不能被改');
            additive += 1;
        }
    }
    assert.equal(additive, SR_SLOT_COUNT * (1 + SR_STAR_COUNT));

    // 颜色：闪光 #ffd077、星点 #ffdf95
    const glowColor = compOf(o, byPath.get('ShowReward/RewardGrid/Content/Slot1/Glow')!, 'cc.Sprite')._color;
    assert.deepEqual([glowColor.r, glowColor.g, glowColor.b], [255, 208, 119]);
    const starColor = compOf(o, byPath.get('ShowReward/RewardGrid/Content/Slot1/Star1')!, 'cc.Sprite')._color;
    assert.deepEqual([starColor.r, starColor.g, starColor.b], [255, 223, 149]);
});

test('C9｜主元素贴图：弹窗底是九宫 SLICED(1)、另外两张 SIMPLE(0)，uuid 指向已迁的图', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const cases: Array<[string, string, number]> = [
        ['PanelBg', 'panelBg', 1],
        ['TitleImage', 'title', 0],
        ['HintBg', 'hintBg', 0],
    ];
    for (const [node, key, type] of cases) {
        const idx = byPath.get(`ShowReward/${node}`)!;
        assert.equal(spriteUuidOf(o, idx), metaOf(SR_ART_NAMES[key]).uuid, `${node} 的图`);
        assert.equal(compOf(o, idx, 'cc.Sprite')._type, type, `${node} 的 _type`);
        assert.equal(compOf(o, idx, 'cc.Sprite')._sizeMode, 0, 'sizeMode 必须 CUSTOM（TRIMMED 会回写尺寸，规则 87）');
    }
    // 槽位里的星图共用同一张
    const starIdx = byPath.get('ShowReward/RewardGrid/Content/Slot1/Star1')!;
    assert.equal(spriteUuidOf(o, starIdx), metaOf(SR_ART_NAMES.star).uuid);
    const glowIdx = byPath.get('ShowReward/RewardGrid/Content/Slot1/Glow')!;
    assert.equal(spriteUuidOf(o, glowIdx), metaOf(SR_ART_NAMES.glow).uuid);
    // 三件套的 Frame/Icon 不烘静态图（运行时由 `GoodsBox.render` 无条件写）
    assert.equal(spriteUuidOf(o, byPath.get('ShowReward/RewardGrid/Content/Slot1/Goods/Frame')!), '');
});

test('C10｜`HintLabel`：文案照原稿、`overflow=NONE`（SHRINK 会把 24 号静默压到 ~21.8）', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const idx = byPath.get('ShowReward/HintLabel')!;
    const label = compOf(o, idx, 'cc.Label');
    assert.equal(label._string, SHOW_REWARD_TEXTS.hint);
    assert.equal(label._string, '点击空白区域继续');
    // 🔴 FGUI `<text>` 没写 `autoSize` ⇒ 默认 Both（按文本重算尺寸）；引擎一律给 SHRINK(2)：
    //    「点击空白区域继续」9 个中日韩字 × 24 号 ≈ 216px > 框宽 196 ⇒ 静默压到 ~21.8 号（规则 76）
    assert.equal(label._overflow, 0, '必须 NONE(0)');
    assert.equal(label._fontSize, 24);
    assert.equal(label._enableWrapText, false);
    assert.deepEqual([label._color.r, label._color.g, label._color.b], [255, 255, 255]);
    assert.deepEqual([uitOf(o, idx)._contentSize.width, uitOf(o, idx)._contentSize.height], [196, 34]);
});

test('C11｜脚本挂载：Page×1 / Grid×1 / Item×12 / GoodsBox×12，且无 MissingScript', () => {
    const o = loadPrefab();
    const cids = new Map<string, number>();
    for (const obj of o) {
        if (!obj || typeof obj.__type__ !== 'string') continue;
        if (obj.__type__ === 'cc.MissingScript') assert.fail('prefab 里出现 cc.MissingScript');
        if (/^[0-9A-Za-z+/]{23}$/.test(obj.__type__)) cids.set(obj.__type__, (cids.get(obj.__type__) ?? 0) + 1);
    }
    assert.equal(cids.size, 4, `脚本类应有 4 种，实际 ${[...cids.keys()].join(',')}`);
    const counts = [...cids.values()].sort((a, b) => a - b);
    assert.deepEqual(counts, [1, 1, 12, 12]);
});

test('C12｜`@property` 绑定：Page 的 5 个 + Grid 的 content + 每格的 goods/glow/stars(5)', () => {
    const o = loadPrefab();
    const byPath = pathIndex(o);
    const scriptOf = (rel: string) => {
        const path = rel === '.' ? 'ShowReward' : `ShowReward/${rel}`;
        const node = byPath.get(path);
        assert.ok(node !== undefined, `找不到 ${path}`);
        const ref = (o[node!]._components as any[]).find((c) => /^[0-9A-Za-z+/]{23}$/.test(o[c.__id__].__type__));
        assert.ok(ref, `${path} 上没有脚本组件`);
        return o[ref.__id__];
    };
    const nameOfRef = (ref: any) => {
        const target = o[ref.__id__];
        // Page 的 5 个 @property 有 **两种** 引用：`Node`（panelBg/titleImage/hintBg）和
        // 组件（`ShowRewardGrid` / `cc.Label`）—— 后者要顺着 `.node` 拿节点名。
        return target.__type__ === 'cc.Node' ? target._name : o[target.node.__id__]._name;
    };

    const page = scriptOf('.');
    assert.deepEqual(
        ['panelBg', 'titleImage', 'grid', 'hintBg', 'hintLabel'].map((k) => nameOfRef(page[k])),
        ['PanelBg', 'TitleImage', 'RewardGrid', 'HintBg', 'HintLabel'],
    );
    // 引用类型也要对：`grid` 必须指到组件（Page 直接调 `grid.renderItem = …`），
    // `hintLabel` 必须指到 `cc.Label`（不是节点）—— 指错类型在编辑器里表现为属性框空着。
    assert.equal(o[page.grid.__id__].__type__, 'b5aeczXSdNCB5eAkMyjp39W', 'grid 应指 ShowRewardGrid 组件');
    assert.equal(o[page.hintLabel.__id__].__type__, 'cc.Label', 'hintLabel 应指 cc.Label 组件');
    // 老端 `LayerOrder.TipsUI` ⇒ 烘 `PopupLayer.SYSTEM(1)`（`PopupManager.openAsync` 读 prefab 上的这个值）
    assert.equal(page.popupLayer, 1);
    // `closeOnBlank` / `contentNodes` 保持默认（留空 = 取全部激活直接子节点）
    assert.equal(page.closeOnBlank, undefined);
    assert.equal(page.contentNodes, undefined);

    const grid = scriptOf('RewardGrid');
    assert.equal(nameOfRef(grid.content), 'Content');

    for (let i = 1; i <= SR_SLOT_COUNT; i += 1) {
        const item = scriptOf(`RewardGrid/Content/Slot${i}`);
        assert.equal(nameOfRef(item.goods), 'Goods');
        assert.equal(nameOfRef(item.glow), 'Glow');
        assert.ok(Array.isArray(item.stars), 'stars 必须是数组引用');
        assert.equal(item.stars.length, SR_STAR_COUNT);
        // 顺序必须与 `SR_STAR_TRACKS` 一一对应（`stars[i]` 配 `track[i]`）
        assert.deepEqual(item.stars.map(nameOfRef), ['Star1', 'Star2', 'Star3', 'Star4', 'Star5']);

        const goods = scriptOf(`RewardGrid/Content/Slot${i}/Goods`);
        assert.deepEqual(['frame', 'icon', 'num'].map((k) => nameOfRef(goods[k])), ['Frame', 'Icon', 'Num']);
    }
});

test('C13｜网格口径三处相等：`ShowRewardTable` ↔ `gen_showreward.mjs` ↔ prefab 里的槽位坐标', () => {
    // ① 生成器源码里的常量（生成器读不到 `.ts`，只能各写一份）
    assert.equal(genConst('SR_VIEW_W'), SR_VIEW_W);
    assert.equal(genConst('SR_VIEW_H'), SR_VIEW_H);
    assert.equal(genConst('SR_ITEM'), SR_ITEM_SIZE);
    assert.equal(genConst('SR_COL_GAP'), SR_COL_GAP);
    assert.equal(genConst('SR_ROW_GAP'), SR_ROW_GAP);
    // ⚠️ 生成器里 `SR_COLUMNS` / `SR_ROWS` / `SR_STEP_X` / `SR_STEP_Y` 全是**表达式**不是字面量
    //    （`columnsOf(SR_VIEW_W)` 之类）⇒ `genConst` 读不到，只能核它们引用的字面量 + 公式本身。
    assert.ok(/const SR_STEP_X = SR_ITEM \+ SR_COL_GAP;/.test(GEN_SRC), 'SR_STEP_X 应 = 格 + 列距');
    assert.ok(/const SR_STEP_Y = SR_ITEM \+ SR_ROW_GAP;/.test(GEN_SRC), 'SR_STEP_Y 应 = 格 + 行距');
    assert.ok(/const columnsOf = \(viewW, itemSize = SR_ITEM, gap = SR_COL_GAP\) =>/.test(GEN_SRC),
        'columnsOf 的默认参数必须与 Table 层同口径');
    assert.ok(/const rowsOf = \(viewH, itemSize = SR_ITEM, gap = SR_ROW_GAP\) =>/.test(GEN_SRC));
    // ⚠️ 这条同时钉住「列/行数由公式算出」这件事：生成器里**不许**出现写死的 `SR_COLUMNS = 4`
    assert.ok(!/const SR_COLUMNS = \d/.test(GEN_SRC), '列数必须算出来，不许写死');
    assert.ok(!/const SR_ROWS = \d/.test(GEN_SRC), '行数必须算出来，不许写死');
    assert.ok(/const SR_COLUMNS = columnsOf\(SR_VIEW_W\);/.test(GEN_SRC), 'SR_COLUMNS 应由 columnsOf 算出');
    assert.ok(/const SR_ROWS = rowsOf\(SR_VIEW_H\);/.test(GEN_SRC), 'SR_ROWS 应由 rowsOf 算出');
    // 生成器里的 `SR_SLOT_COUNT` 是「两常量相乘」而不是字面量 ⇒ 单独核它引用的两个常量
    assert.ok(/const SR_SLOT_COUNT = SR_COLUMNS \* SR_ROWS;/.test(GEN_SRC), 'SR_SLOT_COUNT 应 = SR_COLUMNS × SR_ROWS');

    // ② 5 星的静态位也必须两边一致（`SR_STARS` 是生成器另写的一份）
    const starBlock = GEN_SRC.match(/const SR_STARS = \[([\s\S]*?)\n\];/);
    assert.ok(starBlock, '生成器里读不到 SR_STARS');
    const l = [...starBlock![1].matchAll(/l:\s*(-?[\d.]+),\s*t:\s*(-?[\d.]+),\s*w:\s*([\d.]+)/g)]
        .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    assert.equal(l.length, SR_STAR_COUNT);
    for (let i = 0; i < SR_STAR_COUNT; i += 1) {
        const [lx, ty, w] = l[i];
        // 换算：中心 = (l + w/2, t + w/2) → lpos = (中心x − 50, 50 − 中心y)
        assert.deepEqual([lx + w / 2 - 50, 50 - (ty + w / 2)], SR_STAR_TRACKS[i].from, `Star${i + 1}`);
    }

    // ③ prefab 实际烘出来的槽位坐标（由 C5 的公式驱动，这里再独立核一遍「与 ① 一致」）
    const o = loadPrefab();
    const byPath = pathIndex(o);
    for (let i = 0; i < SR_SLOT_COUNT; i += 1) {
        const idx = byPath.get(`ShowReward/RewardGrid/Content/Slot${i + 1}`)!;
        const c = slotLocalCenterOf(i);
        assert.deepEqual([o[idx]._lpos.x, o[idx]._lpos.y], [c.x, -c.y]);
    }
});

test('C14｜`_active` 烘焙口径：带脚本的节点恒 true（规则 86），无脚本的效果节点忠于原稿 false', () => {
    const o = loadPrefab();
    const nodes = o.filter((v) => v && v.__type__ === 'cc.Node');
    for (const n of nodes) {
        const hasScript = (n._components as any[]).some((c) => /^[0-9A-Za-z+/]{23}$/.test(o[c.__id__].__type__));
        if (/^Slot\d+$/.test(n._name) || n._name === 'Goods') {
            assert.equal(n._active, true, `${n._name} 带脚本 ⇒ 必须 _active=true（规则 86：烘 false = 死锁）`);
            assert.ok(hasScript);
        }
        // 主元素一律 true（原稿没有 `visible="false"`）
        if (['ShowReward', 'PanelBg', 'TitleImage', 'RewardGrid', 'Content', 'HintBg', 'HintLabel'].includes(n._name)) {
            assert.equal(n._active, true, `${n._name} 应 _active=true`);
        }
    }
});

// ============================================================
// D. 视图脚本的生命周期与账本（源码文本）
// ============================================================

test('D1｜出现动画账本：`playedAni` 只加一次、错峰用 `scheduleOnce` + 核身份', () => {
    assert.ok(/private readonly playedAni = new Set<number>\(\)/.test(PAGE_SRC), '缺 playedAni 账本');
    assert.ok(/this\.playedAni\.clear\(\)/.test(PAGE_SRC), '每次打开必须清账本');
    // ⚠️ 不能写成 `tween(...).delay(...)`：tween 是**节点级**的，槽位被复用/关窗后照样回调
    assert.ok(/this\.scheduleOnce\(/.test(PAGE_SRC), '错峰必须用 scheduleOnce');
    assert.ok(/staggerSecondsOf\(dataIndex\)/.test(PAGE_SRC), '错峰时间必须来自 staggerSecondsOf');
    // 错峰回调里必须核「槽位现在还是不是这个 dataIndex」+ 账本
    assert.ok(/item\.dataIndex !== dataIndex/.test(PAGE_SRC), '错峰回调要核身份');
    assert.ok(/playedAni\.has\(dataIndex\)/.test(PAGE_SRC), '账本判重');
    // 播放前必须无条件铺数据（规则 82）
    assert.ok(/item\.render\(/.test(PAGE_SRC));
    assert.ok(/item\.resetAppear\(\)/.test(PAGE_SRC));
    assert.ok(/item\.appear\(\)/.test(PAGE_SRC));
});

test('D2｜过期的异步结果要丢掉（`loadRevision`）+ 空奖励直接关窗', () => {
    assert.ok(/this\.loadRevision \+= 1/.test(PAGE_SRC), '缺 loadRevision');
    assert.ok(/revision !== this\.loadRevision/.test(PAGE_SRC), 'onOpen 里没核 revision');
    assert.ok(/goods\.length === 0/.test(PAGE_SRC), '空奖励要早退');
    assert.ok(/this\.close\(PopupCloseReason\.Manual\)/.test(PAGE_SRC), '空奖励应关窗而不是白屏');
    // 排序必须在加载图之前（`frames` 与 `entries` 必须同序）。
    // ⚠️ 2026-10-14：帧加载搬进了共用件 `RewardFrames`（结算页是第二个宿主），
    //    所以这里认的是 `loadRewardFrames(sorted)`，不再有私有的 `this.loadFrames`。
    const sortAt = PAGE_SRC.indexOf('sortRewardEntries(entries)');
    const loadAt = PAGE_SRC.indexOf('loadRewardFrames(sorted)');
    assert.ok(sortAt > 0 && loadAt > 0 && sortAt < loadAt, '排序必须在加载图之前');
});

test('D3｜入场动效：PanelBg / TitleImage 缩放 + Hint 延迟显示，全走 `framesToSeconds`', () => {
    assert.ok(/private playEnterAnimation\(\)/.test(PAGE_SRC));
    assert.ok(/this\.panelBg\.setScale\(1, 0\.3, 1\)/.test(PAGE_SRC), 'PanelBg 起手 (1,0.3)');
    assert.ok(/this\.titleImage\.setScale\(1, 0\.46, 1\)/.test(PAGE_SRC), 'TitleImage 起手 (1,0.46)');
    assert.ok(/framesToSeconds\(3\)/.test(PAGE_SRC), '标题延迟 3 帧');
    assert.ok(/framesToSeconds\(4\)/.test(PAGE_SRC), '提示条延迟 4 帧');
    assert.ok(/framesToSeconds\(5\)/.test(PAGE_SRC), '缩放时长 5 帧');
    // 不许出现手写的秒数（0.083 / 0.05 之类）—— 帧率一变就静默歪掉
    assert.ok(!/to\(0\.0\d+,/.test(PAGE_SRC), '不要手写秒数，请用 framesToSeconds');
});

test('D4｜音效走 `FW.playSound`，key 来自 `showRewardSoundKey(isGold)`', () => {
    assert.ok(/FW\.playSound\(showRewardSoundKey\(this\.isGold\)\)/.test(PAGE_SRC));
    assert.ok(/import \{ FW \}/.test(PAGE_SRC));
});

test('D5｜点一格 → 物品详情：必须传 resId **和 number** + `allowMultiple`（漏 number 就静默无效）', () => {
    assert.ok(/ItemDetailPage\.open\(\{/.test(PAGE_SRC));
    assert.ok(/resId: entry\.resId/.test(PAGE_SRC), 'onItemClick 要传 resId');
    assert.ok(/number: entry\.number/.test(PAGE_SRC), 'onItemClick 要传 number');
    assert.ok(/allowMultiple: true/.test(PAGE_SRC));
});

test('D6｜Grid：槽位用 TOUCH_END（不是 Button.CLICK）、只绑一次、闭包捕获槽位序号', () => {
    assert.ok(/Node\.EventType\.TOUCH_END/.test(GRID_SRC), '槽位点击必须用 TOUCH_END（规则 81b）');
    assert.ok(!/Button\.EventType\.CLICK/.test(GRID_CODE), '槽位没有 cc.Button，绑 CLICK 是静默死按钮');
    assert.ok(/for \(let i = 0; i < slots\.length; i \+= 1\)/.test(GRID_SRC), '槽位监听只绑一次');
    assert.ok(/this\.onSlotTap\(i\)/.test(GRID_SRC), '闭包必须捕获**槽位序号**');
    assert.ok(/this\.renderItem\?\.\(node, where\)/.test(GRID_SRC), '回调按 index 现取（规则 55）');
    assert.ok(/if \(this\._moved\) return;/.test(GRID_SRC), '拖动过就不算点击');
});

test('D7｜Grid：滚动模型是「槽位位置固定 + 换数据窗口」（禁 Content 位移）', () => {
    // 旧模型的两个特征一个都不能有
    assert.ok(!/applyScroll/.test(GRID_CODE), '不该有 applyScroll');
    assert.ok(!/this\.content\.setPosition\(/.test(GRID_CODE), '禁让 Content 位移（槽位会跑出视口 ⇒ 空白 + 错行）');
    assert.ok(/windowSlotOf\(i, this\._topRow\)/.test(GRID_SRC), '必须用 windowSlotOf');
    assert.ok(/_slotDataIndex\[i\] = has \? where : -1;/.test(GRID_SRC), '每个槽位都要无条件写数据下标');
    // `refreshList` 不许重置 `_topRow`（点一格后会再调一次，重置会让列表跳回顶部）
    // ⚠️ 断言必须**只看 refreshList 的方法体** —— `private _topRow = 0;` 这个**字段声明**
    //    是合法的初始值，全局正则会把声明本身当成违规（曾假红一次）。
    const refreshBody = GRID_CODE.match(/refreshList\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n    \}/);
    assert.ok(refreshBody, '读不到 refreshList 方法体');
    assert.ok(!/_topRow = 0/.test(refreshBody![1]), 'refreshList 不该把 _topRow 归零');
    assert.ok(/this\._topRow = Math\.min\(this\._topRow, this\._maxTopRow\)/.test(GRID_SRC));
    // 公式的真源在零 cc 的 Table 层（可被 A3 穷举守卫）
    assert.ok(/export \{ windowSlotOf \} from '\.\/ShowRewardTable'/.test(GRID_SRC), '应转发 Table 层的实现');
});

test('D8｜Item：动画作废用 `animRevision` + `Tween.stopAllByTarget`（复用槽位不会画上一格轨迹）', () => {
    assert.ok(/private animRevision = 0/.test(ITEM_SRC));
    assert.ok(/this\.animRevision \+= 1/.test(ITEM_SRC), 'stopAnim 要作废在途回调');
    assert.ok(/Tween\.stopAllByTarget\(this\.node\)/.test(ITEM_SRC));
    assert.ok(/Tween\.stopAllByTarget\(star\.node\)/.test(ITEM_SRC), '星的 tween 也要停');
    assert.ok(/rev === this\.animRevision/.test(ITEM_SRC), '回调里要核代号');
    assert.ok(/SR_STAR_TRACKS\[i\]/.test(ITEM_SRC), '轨迹必须按序取表');
    // 铺数据必须无条件写四件（规则 82）
    assert.ok(/this\.goods\?\.render\(qualityFrame, iconFrame, numberText, showNumber\)/.test(ITEM_SRC));
    assert.ok(/resetAppear\(\): void \{\n\s+this\.stopAnim\(\);/.test(ITEM_SRC), 'resetAppear 先停动画');
    // `resetAppear` 必须把 5 星摆回 `track.from`（与 C8 的 prefab 静置位是同一组数字）
    assert.ok(/star\.node\.setPosition\(track\.from\[0\], track\.from\[1\], 0\)/.test(ITEM_SRC));
    // 不许写 `off(...)`（规则 71：会中断销毁链）
    assert.ok(!/\.off\s*\(/.test(ITEM_CODE));
    assert.ok(!/\.off\s*\(/.test(GRID_CODE));
    assert.ok(!/\.off\s*\(/.test(PAGE_CODE));
});

// ============================================================
// E. 文案 + 音效
// ============================================================

test('E1｜提示文案 = FGUI 原稿 `<text n11>` 字面量（`mL.json` 里没有这条 ⇒ 不许去表里找）', () => {
    assert.equal(SHOW_REWARD_TEXTS.hint, '点击空白区域继续');
    const ml = JSON.parse(readFileSync('assets/remoteRef/mL.json', 'utf8')) as { k: string[]; v: unknown[][] };
    assert.ok(Array.isArray(ml.v), 'mL.json 应是列式表');
    const hit = JSON.stringify(ml).includes(SHOW_REWARD_TEXTS.hint);
    assert.equal(hit, false, 'FGUI 原稿这句**不在** mL.json 里；哪天进了表，这条守卫就该改成查表');
});

test('E2｜音效 key 必须在 `audioConfig.json` 里，且 mp3 真在磁盘上', () => {
    const cfg = JSON.parse(readFileSync('assets/remoteRef/audioConfig.json', 'utf8')) as Array<{ key: string; value: string }>;
    assert.ok(Array.isArray(cfg), 'audioConfig.json 是 `[{key,value}]` 数组');
    const byKey = new Map(cfg.map((r) => [r.key, r.value]));
    for (const key of Object.values(SHOW_REWARD_SOUNDS)) {
        const value = byKey.get(key);
        assert.ok(value, `audioConfig 里没有音效「${key}」（AudioMgr 会静默 return null）`);
        const rel = value!.replace('resources://', '');
        assert.ok(existsSync(`assets/resources/${rel}.mp3`), `${rel}.mp3 不在磁盘上`);
    }
    assert.equal(showRewardSoundKey(true), SHOW_REWARD_SOUNDS.coin);
    assert.equal(showRewardSoundKey(false), SHOW_REWARD_SOUNDS.reward);
    // 非布尔（服务端可能给 0/1）也要走奖励音效而不是铜钱
    assert.equal(showRewardSoundKey(undefined), SHOW_REWARD_SOUNDS.reward);
    assert.equal(showRewardSoundKey(null), SHOW_REWARD_SOUNDS.reward);
    assert.equal(showRewardSoundKey(0), SHOW_REWARD_SOUNDS.reward);
});

// ============================================================
// F. 全局入口接线 + 反向守卫
// ============================================================

test('F1｜`FW.showReward` 是可注入出口，`FW.ShowReward` 只做转交（框架层不反向依赖 app）', () => {
    assert.ok(/static showReward: \(goods: CmdGoods\[\], isGold: boolean\) => void = \(\) => \{ \};/.test(FW_SRC),
        '缺可注入的 FW.showReward 空实现');
    const body = FW_SRC.slice(FW_SRC.indexOf('static ShowReward('));
    assert.ok(/FW\.showReward\(tlCmdGoods \?\? \[\], !!param\?\.isGold\)/.test(body), 'ShowReward 应转交并归一化参数');
    // 老端 `ModelRole` L599 传的就是 `{ isGold }`
    assert.ok(/param\?: \{ isGold\?: boolean \}/.test(body), 'param 形状应为 { isGold? }');
    // 框架层不许 import app 层
    assert.ok(!/from '\.\.\/app\//.test(FW_SRC), 'framework 层不得反向 import app');
});

test('F2｜组合根把出口接到 `ShowRewardPage.open`', () => {
    assert.ok(/import \{ ShowRewardPage \} from '\.\.\/showReward\/ShowRewardPage';/.test(BOOTSTRAP_SRC));
    assert.ok(/FW\.showReward = \(goods, isGold\) =>/.test(BOOTSTRAP_SRC), '组合根要注入实现');
    assert.ok(/ShowRewardPage\.open\(\{ userData: \{ goods, isGold \} \}\)/.test(BOOTSTRAP_SRC));
    // 注入点必须与 showTip / playSound 同处（都在 onLoad 里、且早于导航）
    const onLoadAt = BOOTSTRAP_SRC.indexOf('onLoad(): void {');
    const bindAt = BOOTSTRAP_SRC.indexOf('FW.showReward =');
    const navAt = BOOTSTRAP_SRC.indexOf('manager.navigate(');
    assert.ok(onLoadAt > 0 && bindAt > onLoadAt && bindAt < navAt, '注入必须在 navigate 之前');
});

test('F3｜两处历史缺口已换成真调用（庆典 `cmdCelebrationGetTargetReward` / 首充领取）', () => {
    assert.ok(/FW\.ShowReward\(rsp\?\.tlCmdGoods \?\? \[\]\)/.test(CELEB_SRC), '庆典领取应弹奖励');
    assert.ok(/import \{ FW \} from '\.\.\/\.\.\/framework\/FW';/.test(CELEB_SRC));
    assert.ok(/FW\.ShowReward\(goods\)/.test(FIRST_SRC), '首充领取应弹奖励');
    assert.ok(/import \{ FW \} from '\.\.\/\.\.\/framework\/FW';/.test(FIRST_SRC));
    // 首充的老端口径是 `if (rsp.tlCmdGoods)`，且只在成功时弹
    assert.ok(/if \(ret && goods\) FW\.ShowReward\(goods\);/.test(FIRST_SRC), '首充应判空 + 判 ret');
    // 两个 Repository 都不许 import 视图类（只走可注入出口）
    for (const [name, src] of [['CelebrationRepository', CELEB_SRC], ['FirstRechargeRepository', FIRST_SRC]] as const) {
        assert.ok(!/from '\.\.\/showReward\//.test(src), `${name} 不该直接 import 视图`);
        assert.ok(!/PopupManager|PopupBase/.test(src), `${name} 不该直接碰弹窗栈`);
    }
    // 「本工程还没做奖励飘字」这类占位注释必须已经消失
    assert.ok(!/本工程还没做奖励飘字/.test(CELEB_SRC));
    assert.ok(!/奖励弹窗后续补/.test(FIRST_SRC));
});

test('F4｜反向守卫：`HeadGridList` 的死回调 + 错误滚动模型都不许回归', () => {
    // ① 死回调：`onItemClick` 必须**真的被调用**（此前只声明不调用 ⇒ 换头像点一格选不中）
    assert.ok(/this\.onItemClick\?\.\(dataIndex\)/.test(HEAD_SRC), 'onItemClick 必须被调用（死回调回归）');
    assert.ok(/private onSlotTap\(slot: number\): void/.test(HEAD_SRC), '缺 onSlotTap');
    assert.ok(/slots\[i\]\.on\(Node\.EventType\.TOUCH_END, \(\) => this\.onSlotTap\(i\), this\)/.test(HEAD_SRC),
        '槽位要绑 TOUCH_END 并捕获槽位序号');
    assert.ok(!/Button\.EventType\.CLICK/.test(HEAD_CODE), '槽位没有 cc.Button（规则 81b）');
    // ② 滚动模型：禁 Content 位移
    assert.ok(!/applyScroll/.test(HEAD_CODE), '不该有 applyScroll（旧模型的病灶）');
    assert.ok(!/this\.content\.setPosition\(/.test(HEAD_CODE), '禁让 Content 位移');
    assert.ok(/Math\.floor\(i \/ HEAD_ITEM_COLUMNS\)/.test(HEAD_SRC), '必须用窗口式公式');
    assert.ok(/_slotDataIndex\[i\] = has \? dataIndex : -1;/.test(HEAD_SRC), '无条件写数据下标');
    assert.ok(!/\.off\s*\(/.test(HEAD_CODE), '禁写 off(...)（规则 71）');
});

test('F5｜反向守卫：`ShowRewardPage.prefabPath` 与磁盘目录大小写一致（真机 resources.load 大小写敏感）', () => {
    const m = PAGE_SRC.match(/static prefabPath = '([^']+)'/);
    assert.ok(m, '缺 static prefabPath');
    assert.equal(m![1], 'ui/ShowReward/ShowReward');
    assert.ok(existsSync(`assets/resources/${m![1]}.prefab`), `磁盘上没有 assets/resources/${m![1]}.prefab`);
    // `.prefab.meta` 的 uuid 也要在（生成器会写，改名后重建不会静默失配）
    assert.ok(prefabUuid(PREFAB).length > 0);
});
