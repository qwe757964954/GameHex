/**
 * 「章节选择弹窗」的回归网（2026-11-02 新增）。
 *
 * 两层：
 * 1. **纯逻辑** `buildChapterSelectRows` / `chapterPercentOf` —— 行数、锁定态、完成度口径；
 * 2. **prefab 结构** —— 尺寸 / layer / 脚本挂载 / `@property` 引用形态。
 *
 * 为什么结构也要守：这个 prefab 是走「MCP 建结构 + 定点补属性」造出来的
 * （`tmp/patch_chapter_select.py`），一旦脚本改了 `@property` 名或 prefab 被编辑器重存，
 * 绑错的字段会**静默变成 null / Node**，运行时只表现为「列表不显示」「点了没反应」。
 * 判据都是机械事实（读 JSON），不起引擎。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    CHAPTER_SELECT_STATE,
    buildChapterSelectRows,
    chapterPercentOf,
} from '../assets/script/app/territory/model/ChapterSelectRows';
import type { IChapterSelectMapInfo } from '../assets/script/app/territory/model/ChapterSelectRows';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREFAB = path.join(ROOT, 'assets/resources/ui/main/ChapterSelectPanel.prefab');

interface PrefabObject {
    __type__?: string;
    _name?: string;
    _children?: Array<{ __id__: number }>;
    _components?: Array<{ __id__: number }>;
    _prefab?: { __id__: number };
    _layer?: number;
    _active?: boolean;
    _lpos?: { x: number; y: number };
    _contentSize?: { width: number; height: number };
    _anchorPoint?: { x: number; y: number };
    _spriteFrame?: { __uuid__: string } | null;
    _content?: { __id__: number } | null;
    fileId?: string;
    asset?: { __id__: number } | null;
    data?: { __id__: number };
    [key: string]: unknown;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 与引擎 `compressUuid` 同算法：前 5 个 hex 原样 + 每 3 个 hex（12bit）编 2 个 base64 字符。 */
function compressUuid(uuid: string): string {
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 0; i < 9; i++) {
        const value = parseInt(hex.slice(5 + i * 3, 8 + i * 3), 16);
        out += ALPHABET[value >> 6] + ALPHABET[value & 0x3f];
    }
    return out;
}

function scriptCid(relative: string): string {
    const meta = JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

function loadPrefab(): PrefabObject[] {
    return JSON.parse(readFileSync(PREFAB, 'utf8')) as PrefabObject[];
}

function nodeIndexOf(data: PrefabObject[], name: string): number {
    const index = data.findIndex((item) => item.__type__ === 'cc.Node' && item._name === name);
    assert.notEqual(index, -1, `prefab 里找不到节点 ${name}`);
    return index;
}

function componentOf(data: PrefabObject[], name: string, type: string): PrefabObject {
    const node = data[nodeIndexOf(data, name)];
    for (const ref of node._components ?? []) {
        const component = data[ref.__id__];
        if (component.__type__ === type) return component;
    }
    throw new Error(`${name} 上没有 ${type}`);
}

// ============================================================
// 纯逻辑
// ============================================================

const MAP: IChapterSelectMapInfo = { name: '第一章', siteCells: [11, 12, 13, 14] };

test('chapterPercentOf：只数站点格，非站点格不算', () => {
    assert.equal(chapterPercentOf(MAP, []), 0);
    assert.equal(chapterPercentOf(MAP, [11, 12]), 50);
    assert.equal(chapterPercentOf(MAP, [11, 12, 13, 14]), 100);
    // 99 / 100 不是站点格（资源点扩散、旧档残留），不该把完成度推到 100%
    assert.equal(chapterPercentOf(MAP, [11, 99, 100]), 25);
});

test('chapterPercentOf：没有地图 / 空站点时给 0，不给 NaN', () => {
    assert.equal(chapterPercentOf(null, [11]), 0);
    assert.equal(chapterPercentOf({ name: 'x', siteCells: [] }, [11]), 0);
});

test('buildChapterSelectRows：可切章节 + 下一章预告（锁定）', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([
        [1, { name: '第一章', siteCells: [1, 2] }],
        [2, { name: '笑脸章', siteCells: [3, 4] }],
        [3, { name: '飞机章', siteCells: [5, 6] }],
    ]);
    const owned = new Map<number, readonly number[]>([[1, [1, 2]], [2, [3]]]);
    const rows = buildChapterSelectRows([1, 2], 2, maps, owned);

    assert.equal(rows.length, 3, '服务端给 1、2 ⇒ 列表 1、2 + 预告的 3');
    assert.deepEqual(rows.map((row) => row.chapterId), [1, 2, 3]);
    assert.deepEqual(rows.map((row) => row.index), [1, 2, 3]);
    assert.deepEqual(rows.map((row) => row.title), ['第一章', '笑脸章', '飞机章']);
    assert.deepEqual(rows.map((row) => row.percent), [100, 50, 0]);
    assert.deepEqual(rows.map((row) => row.state), [
        CHAPTER_SELECT_STATE.cleared,
        CHAPTER_SELECT_STATE.progress,
        CHAPTER_SELECT_STATE.locked,
    ]);
    assert.deepEqual(rows.map((row) => row.current), [false, true, false]);
});

test('buildChapterSelectRows：没有地图的未解锁章节不占行', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([[1, { name: '第一章', siteCells: [1] }]]);
    const rows = buildChapterSelectRows([1], 1, maps, new Map([[1, [1]]]));
    assert.equal(rows.length, 1, '第 2 章没有地图（还没做内容）⇒ 不显示');
    assert.equal(rows[0].state, CHAPTER_SELECT_STATE.cleared);
});

test('buildChapterSelectRows：服务端空列表也至少给第 1 章', () => {
    const rows = buildChapterSelectRows([], 0, new Map(), new Map());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].chapterId, 1);
    assert.equal(rows[0].title, '第 1 章', '没有地图时用兜底标题');
    assert.equal(rows[0].state, CHAPTER_SELECT_STATE.locked);
});

// ============================================================
// prefab 结构
// ============================================================

test('ChapterSelectPanel.prefab：27 节点、layer 全 UI_2D、fileId 22 位唯一', () => {
    const data = loadPrefab();
    const nodes = data.filter((item) => item.__type__ === 'cc.Node');
    // 26 = 弹窗本体；+1 = 状态块里的「完成度」小字
    assert.equal(nodes.length, 27);
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} 的 layer 不是 UI_2D`);
    }
    const fileIds = data
        .map((item) => item.fileId)
        .filter((value): value is string => typeof value === 'string');
    assert.equal(new Set(fileIds).size, fileIds.length, 'fileId 有重复');
    for (const fileId of fileIds) assert.equal(fileId.length, 22, `fileId 长度不是 22：${fileId}`);
});

test('ChapterSelectPanel.prefab：关键节点尺寸与位置', () => {
    const data = loadPrefab();
    // ⚠️ 序列化对象带 __type__，逐字段比（deepEqual 会红）
    const size = (name: string) => {
        const transform = componentOf(data, name, 'cc.UITransform');
        const value = transform._contentSize as { width: number; height: number };
        return [value.width, value.height];
    };
    assert.deepEqual(size('Panel'), [672, 825]);
    assert.deepEqual(size('Parchment'), [599, 752]);
    assert.deepEqual(size('List'), [560, 720]);
    assert.deepEqual(size('Item'), [552, 140]);
    // 金色高亮环只比行大 1px（外描边，收得太紧会切进行内、放太松会和行分离）
    assert.deepEqual(size('CurrentRing'), [553, 147]);

    // List 的视窗锚点是默认中心；Content 锚点必须是 (0.5, 1)，否则列表整体下移半个视口
    const content = componentOf(data, 'Content', 'cc.UITransform');
    const anchor = content._anchorPoint as { x: number; y: number };
    assert.deepEqual([anchor.x, anchor.y], [0.5, 1]);
    assert.equal((content._contentSize as { height: number }).height, 720);
});

/**
 * `row_base.png`（742×221）底下烘了一圈投影，可见实体只占 art 的 y=1..206，
 * 因此它的**视觉中心比节点中心高 4.4 设计像素**（(110.5−103.5)×140/221）。
 * 序号块 / 状态块 / 挂锁都按这个中心对齐 —— 按节点中心摆会看着偏低，
 * 底部压到行底板的内边线（截图上的表现就是「数字框顶出底框」）。
 */
const ROW_BODY_CENTER_Y = 4.4;

test('ChapterSelectPanel.prefab：行内区块对齐底板视觉中心、且都不越出底板', () => {
    const data = loadPrefab();
    const lpos = (name: string): { x: number; y: number } =>
        data[nodeIndexOf(data, name)]._lpos as { x: number; y: number };
    const boxOf = (name: string): { width: number; height: number } =>
        componentOf(data, name, 'cc.UITransform')._contentSize as { width: number; height: number };

    // 三块共用同一套垂直对齐：挂锁和状态块同列，错开就会「锁飘在中间偏下」
    for (const name of ['NumBlock', 'StatusBlock', 'LockIcon']) {
        assert.equal(lpos(name).y, ROW_BODY_CENTER_Y, `${name} 没对齐底板的视觉中心`);
    }

    // 底板可见高度 = 140 × (205/221) ≈ 129.9；块高必须留出内边距，不能顶到底板内边线
    const bodyHeight = 140 * (205 / 221);
    for (const name of ['NumBlock', 'StatusBlock']) {
        const margin = (bodyHeight - boxOf(name).height) / 2;
        assert.ok(margin >= 4 && margin <= 8,
            `${name} 与底板的内边距 ${margin.toFixed(1)}px 不在 4~8 之间（会顶出底板或缩成一条缝）`);
    }

    // 序号块 / 状态块按素材原比例摆放，压扁会让木纹和「完成度」小字变形
    const ratio = (name: string) => boxOf(name).width / boxOf(name).height;
    assert.ok(Math.abs(ratio('NumBlock') - 139 / 167) < 0.01, `NumBlock 变形了：比例 ${ratio('NumBlock')}`);
    assert.ok(Math.abs(ratio('StatusBlock') - 200 / 167) < 0.01, `StatusBlock 变形了：比例 ${ratio('StatusBlock')}`);

    // 挂锁比效果图略大（美术要求：在 62×70 基础上放大到 130%）
    assert.deepEqual([boxOf('LockIcon').width, boxOf('LockIcon').height],
        [Math.round(62 * 1.3), Math.round(70 * 1.3)]);
});

test('ChapterSelectPanel.prefab：行模板默认隐藏，避免复制前闪一行', () => {
    const data = loadPrefab();
    assert.equal(data[nodeIndexOf(data, 'Item')]._active, false);
    assert.equal(data[nodeIndexOf(data, 'CurrentRing')]._active, false);
    assert.equal(data[nodeIndexOf(data, 'LockIcon')]._active, false);
});

test('ChapterSelectPanel.prefab：弹窗与行脚本都挂在正确节点上', () => {
    const data = loadPrefab();
    const panelCid = scriptCid('assets/script/app/main/ChapterSelectPanel.ts.meta');
    const itemCid = scriptCid('assets/script/app/main/ChapterSelectItem.ts.meta');
    const types = (name: string) => (data[nodeIndexOf(data, name)]._components ?? [])
        .map((ref) => data[ref.__id__].__type__);
    assert.ok(types('ChapterSelectPanel').includes(panelCid), '根节点缺 ChapterSelectPanel');
    assert.ok(types('Item').includes(itemCid), 'Item 缺 ChapterSelectItem');
});

test('ChapterSelectPanel.prefab：@property 引用形态正确（组件引用不能存成 Node）', () => {
    const data = loadPrefab();
    const panelCid = scriptCid('assets/script/app/main/ChapterSelectPanel.ts.meta');
    const itemCid = scriptCid('assets/script/app/main/ChapterSelectItem.ts.meta');
    const vsvCid = scriptCid('assets/script/vscrollview/VScrollView.ts.meta');
    const compOf = (from: string, cid: string): PrefabObject => {
        const node = data[nodeIndexOf(data, from)];
        for (const ref of node._components ?? []) {
            const component = data[ref.__id__];
            if (component.__type__ === cid) return component;
        }
        throw new Error(`${from} 上没挂 ${cid}`);
    };
    const targetType = (value: unknown): string | undefined => {
        const ref = value as { __id__?: number } | null;
        return ref && typeof ref.__id__ === 'number' ? data[ref.__id__].__type__ : undefined;
    };

    const panel = compOf('ChapterSelectPanel', panelCid);
    assert.equal(targetType(panel.list), vsvCid, 'list 必须是 VirtualScrollView，不是 cc.Node');
    assert.equal(targetType(panel.titleLabel), 'cc.Label');

    const item = compOf('Item', itemCid);
    const spriteFields = ['rowBg', 'currentRing', 'numBlock', 'statusBg'];
    for (const field of spriteFields) assert.equal(targetType(item[field]), 'cc.Sprite', `item.${field}`);
    const labelFields = ['indexLabel', 'titleLabel', 'percentLabel', 'completeLabel'];
    for (const field of labelFields) assert.equal(targetType(item[field]), 'cc.Label', `item.${field}`);
    assert.equal(targetType(item.statusBlock), 'cc.Node');
    assert.equal(targetType(item.lockIcon), 'cc.Node');
    // 六张美术帧都必须是真实资源引用（拖空 = 行底板空白）
    const frameFields = ['rowBaseFrame', 'rowLockedFrame', 'numBlockFrame', 'numBlockLockFrame',
        'statusGreenFrame', 'statusGoldFrame'];
    for (const field of frameFields) {
        const value = item[field] as { __uuid__?: string } | null;
        assert.ok(value && typeof value.__uuid__ === 'string' && value.__uuid__.includes('@f9941'),
            `item.${field} 不是 SpriteFrame 引用`);
    }
});

test('ChapterSelectPanel.prefab：List 是虚拟列表（NODE 模式、模板取自 Content 第一个子节点）', () => {
    const data = loadPrefab();
    const vsvCid = scriptCid('assets/script/vscrollview/VScrollView.ts.meta');
    const list = data[nodeIndexOf(data, 'List')];
    const types = (list._components ?? []).map((ref) => data[ref.__id__].__type__);
    assert.ok(types.includes(vsvCid), 'List 没挂 VirtualScrollView');
    assert.ok(!types.includes('cc.ScrollView'), 'List 上不能留 cc.ScrollView（会和虚拟列表抢触摸）');

    const view = componentOf(data, 'List', vsvCid);
    assert.equal(view.useVirtualList, true);
    assert.equal(view.direction, 0, 'VERTICAL');
    assert.equal(view.itemCreationMode, 0, 'NODE 模式');
    // NODE 模式下模板 = content 第一个子节点；itemNode/itemPrefab 填了会走别的分支
    assert.equal(view.itemNode, null);
    assert.equal(view.itemPrefab, null);
    assert.equal(view.gridCount, 1);
    assert.equal(view.spacing, 31);
    assert.equal(view.useDynamicSize, false, '行高固定 161，走等大小模式');

    const content = view.content as { __id__: number } | null;
    assert.ok(content && typeof content.__id__ === 'number', 'content 没绑');
    assert.equal(data[content.__id__]._name, 'Content');
    // 序列化名是 `content`（普通 @property），不是 `cc.ScrollView` 那种 `_content`
    assert.equal('_content' in view, false);
});

test('ChapterSelectPanel.prefab：Content 不许挂 cc.Layout（会每帧覆盖虚拟列表坐标）', () => {
    const data = loadPrefab();
    const content = data[nodeIndexOf(data, 'Content')];
    const types = (content._components ?? []).map((ref) => data[ref.__id__].__type__);
    assert.ok(!types.includes('cc.Layout'));
    // 虚拟列表 `start()` 会把 content 第一个子节点收作模板
    const children = (content._children ?? []).map((ref) => data[ref.__id__]._name);
    assert.deepEqual(children, ['Item']);
});
