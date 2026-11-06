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
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import {
    CHAPTER_SELECT_STATE,
    buildChapterSelectRows,
    chapterClearedOf,
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

// 2026-11-05 用户口径：「章节完成度指的是章节内的所有格子已经都是通关状态，
// 计算已通过的格子数和占据总格子数的比例」。
// ⇒ 分子按**格子外观的同一判据**数（自己通了，或同一片战斗区域里有一格通了）。
// 否则地图上每一格都显示"已通关"，完成度却停在 6 成（chapter_01 有 15 组区域、多出 60 格）。

test('★★★chapterPercentOf：同一片战斗区域打一格 ⇒ 整片都算通关（与地图外观同口径）', () => {
    // 一个关卡占多格（chapter_01 的 boss 10005 占 7 格），打任意一格整片都变已通关外观。
    const map: IChapterSelectMapInfo = { name: '第一章', siteCells: [11, 12, 13], areaGroups: [[11, 12, 13]] };
    assert.equal(chapterPercentOf(map, [13]), 100, '一片区域打一格，三格全算通关');
    assert.equal(chapterPercentOf(map, []), 0);

    const pair: IChapterSelectMapInfo = { name: '第一章', siteCells: [11, 12, 13, 14], areaGroups: [[11, 12]] };
    assert.equal(chapterPercentOf(pair, [12]), 50, '组内任一格通 ⇒ 11、12 都算 ⇒ 2/4');
    assert.equal(chapterPercentOf(pair, [12, 13]), 75);
    assert.equal(chapterPercentOf(pair, [13]), 25, '组外格不跟着扩散');
    // 分母仍是**全部**格子：组外那两格永远要单独打通。
    assert.equal(chapterPercentOf({ ...pair, areaGroups: [] }, [12]), 25);
});

test('★★★chapterPercentOf：资源据点的同 configId 多格不参与扩散', () => {
    // chapter_01 的 `fixedResource_173` 占 173/195/174 —— 它们是三个独立据点。
    // 扩散组只由加载器按战斗类型构建（见 `buildAreaGroups`），这里给定空组 = 不扩散。
    const map: IChapterSelectMapInfo = { name: '第一章', siteCells: [173, 195, 174], areaGroups: [] };
    assert.equal(chapterPercentOf(map, [173]), 33, '只占一个资源据点 ⇒ 只算一格');
    assert.equal(chapterPercentOf(map, [173, 195, 174]), 100);
});

// 2026-11-04 用户口径：「章节通关条件，通过该章节的最后 1 个 boss 关卡」（异步据点不参与）
// ⇒ 弹窗的金牌（`cleared`）必须和 HUD 的 `nextEnabled` 同源，不能再按占领率 100% 判。

test('★★★chapterClearedOf：只打通首领就算通关（占领率才 25%）', () => {
    const map: IChapterSelectMapInfo = { name: '第一章', siteCells: [11, 12, 13, 14], finalBossCells: [14] };
    assert.equal(chapterPercentOf(map, [14]), 25);
    assert.equal(chapterClearedOf(map, [14]), true, '首领通了就是通关，别看占领率');
    // 同区域的另一格也算（服务端只下发区域里的某一格时不许判成"没通"）。
    assert.equal(chapterClearedOf({ ...map, finalBossCells: [13, 14] }, [13]), true);
    // 只占了普通关 / 据点 ⇒ 没通。
    assert.equal(chapterClearedOf(map, [11, 12, 13]), false);
    assert.equal(chapterClearedOf(map, []), false);
});

test('★★★chapterClearedOf：判不出首领格时退回「占领率 100%」', () => {
    // 缺数据是"判不出来"，不是"没首领"：宁可晚一格发金牌，也不许把没打完的章标成已通关。
    assert.equal(chapterClearedOf(MAP, [11, 12, 13, 14]), true);
    assert.equal(chapterClearedOf(MAP, [11, 12]), false);
    assert.equal(chapterClearedOf({ ...MAP, finalBossCells: [] }, [11, 12, 13, 14]), true, '空数组等同缺省');
    assert.equal(chapterClearedOf(null, [11]), false);
});

test('★★★buildChapterSelectRows：金牌行可以不是 100%（占领率只喂进度数字）', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([
        [1, { name: '第一章', siteCells: [11, 12, 13, 14], finalBossCells: [14] }],
    ]);
    const rows = buildChapterSelectRows([1], 1, maps, new Map([[1, [14]]]), new Map(), 1);
    assert.equal(rows[0].percent, 25, '进度数字仍是占领率');
    assert.equal(rows[0].state, CHAPTER_SELECT_STATE.cleared, '状态走首领判据');
});

test('buildChapterSelectRows：展示全部章节，未解锁一律锁定', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([
        [1, { name: '第一章', siteCells: [1, 2] }],
        [2, { name: '笑脸章', siteCells: [3, 4] }],
        [3, { name: '飞机章', siteCells: [5, 6] }],
    ]);
    const owned = new Map<number, readonly number[]>([[1, [1, 2]], [2, [3]]]);
    // 配表定义 4 章全集：1、2 可切，3、4 未解锁也占行并锁定。
    const rows = buildChapterSelectRows([1, 2], 2, maps, owned, new Map(), 4);

    assert.equal(rows.length, 4, '全部章节都占行');
    assert.deepEqual(rows.map((row) => row.chapterId), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((row) => row.index), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((row) => row.title), ['第一章', '笑脸章', '飞机章', '第 4 章']);
    assert.deepEqual(rows.map((row) => row.percent), [100, 50, 0, 0]);
    assert.deepEqual(rows.map((row) => row.state), [
        CHAPTER_SELECT_STATE.cleared,
        CHAPTER_SELECT_STATE.progress,
        CHAPTER_SELECT_STATE.locked,
        CHAPTER_SELECT_STATE.locked,
    ]);
    assert.deepEqual(rows.map((row) => row.current), [false, true, false, false]);
});

test('buildChapterSelectRows：没有地图的未解锁章节仍占行（锁定）', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([[1, { name: '第一章', siteCells: [1] }]]);
    // 第 2、3 章没有地图也没解锁：不再跳过，显示为锁定行。
    const rows = buildChapterSelectRows([1], 1, maps, new Map([[1, [1]]]), new Map(), 3);
    assert.equal(rows.length, 3, '没有地图的未解锁章节也占行');
    assert.deepEqual(rows.map((row) => row.state), [
        CHAPTER_SELECT_STATE.cleared,
        CHAPTER_SELECT_STATE.locked,
        CHAPTER_SELECT_STATE.locked,
    ]);
});

test('buildChapterSelectRows：服务端空列表也至少给第 1 章', () => {
    const rows = buildChapterSelectRows([], 0, new Map(), new Map());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].chapterId, 1);
    assert.equal(rows[0].title, '第 1 章', '没有地图时用兜底标题');
    assert.equal(rows[0].state, CHAPTER_SELECT_STATE.locked);
});

test('buildChapterSelectRows：按章节 ID 使用配表名称，保留进度、锁定和缺项兜底', () => {
    const maps = new Map<number, IChapterSelectMapInfo>([[1, MAP], [2, MAP], [3, MAP]]);
    const names = new Map([[2, '僵笑面具'], [1, '枯菌穹顶'], [4, '尚未开放']]);
    const rows = buildChapterSelectRows([1], 1, maps, new Map([[1, [11, 12]]]), names);
    assert.deepEqual(rows.map(row => row.title), ['枯菌穹顶', '僵笑面具']);
    assert.deepEqual(rows.map(row => row.percent), [50, 0]);
    assert.deepEqual(rows.map(row => row.state), ['progress', 'locked']);
    assert.deepEqual(rows.map(row => row.current), [true, false]);
    assert.equal(buildChapterSelectRows([3], 3, maps, new Map(), names)[2].title, MAP.name);
    assert.equal(buildChapterSelectRows([1], 1, new Map(), new Map(), names)[0].title, '枯菌穹顶');
});

/**
 * 在独立 realm 里跑真 `ChapterSelectLoader`（它 `import { JsonAsset } from 'cc'`，
 * 直接在 Node 里 import 会炸）。返回行数据 + 配置表被请求的顺序。
 */
async function runChapterSelectLoader(options: {
    chapterConfigs: readonly Record<string, unknown>[];
    levelRows?: readonly Record<string, unknown>[];
    sites?: ReadonlyArray<{ cellId: number; configId?: string; type?: string }>;
    ownedCells?: readonly number[];
    availableChapters?: readonly number[];
    currentChapterId?: number;
}): Promise<{ rows: any[]; requested: string[] }> {
    const requested: string[] = [];
    const dependencies: Record<string, unknown> = {
        cc: { JsonAsset: class {} },
        '../../main/MainRoleRow': { readRoleRow: () => null },
        '../../net/RequestGuard': { toIdString: String },
        '../model/TerritoryMapConfig': {
            configureTerritoryMap: (value: unknown) => value,
            // 加载器靠它认「战斗区域」（区域关占多格 ⇒ 完成度整片算），必须与真实常量同值。
            TERRITORY_SITE_TYPE: {
                stage: 'stage', boss: 'boss', asyncPvp: 'asyncPvp', fixedResource: 'fixedResource', bonus: 'bonus',
            },
        },
        '../model/TerritorySaveStore': { TerritorySaveStore: class {
            load() { return { progress: { ownedCells: options.ownedCells ?? [11] } }; }
        } },
        '../model/ChapterSelectRows': { buildChapterSelectRows },
        './TerritoryChapterInfoRepository': {
            TerritoryChapterInfoRepository: { instance: { availableChapters: options.availableChapters ?? [1] } },
        },
        './TerritoryPageAssets': { territoryMapPath: (id: number) => `chapter_${id}` },
    };
    const exports: Record<string, Function> = {};
    const source = readFileSync(path.join(ROOT, 'assets/script/app/territory/application/ChapterSelectLoader.ts'), 'utf8');
    runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, console });
    const rows = await exports.loadChapterSelectRows({
        assets: {
            has: async () => true,
            load: async () => ({
                json: { name: '旧地图标题', sites: options.sites ?? [{ cellId: 11 }, { cellId: 12 }] },
            }),
        },
        // 除 chapterName / levelInfo 之外的配表一律给空表。
        configs: {
            getTable: async (name: string) => {
                requested.push(name);
                if (name === 'chapterName') return options.chapterConfigs;
                if (name === 'levelInfo') return options.levelRows ?? [];
                return [];
            },
        },
    }, options.currentChapterId ?? 1);
    return { rows, requested };
}

test('loadChapterSelectRows：通过配置入口读取导出的 chapterName，而非地图名', async () => {
    const table = JSON.parse(readFileSync(path.join(ROOT, 'assets/remoteRef/chapterName.json'), 'utf8'));
    const chapterConfigs = table.v.map((values: unknown[]) => Object.fromEntries(
        table.k.map((key: string, index: number) => [key, values[index]]),
    ));
    assert.deepEqual(chapterConfigs.map((row: { chapterId: number }) => row.chapterId), [1, 2, 3, 4, 5, 6, 7]);
    // levelInfo 给空表 ⇒ `finalBossCells` 判不出来，本用例专心守
    // 「标题取配表、未解锁占行锁定、完成度按占领率」这三件事（首领判据见下一条）。
    const { rows, requested } = await runChapterSelectLoader({ chapterConfigs });
    assert.deepEqual(requested, ['chapterName', 'levelInfo'],
        'chapterName 给标题、levelInfo 认首领关卡 —— 两张表都要走配置入口');
    // 配表 chapterName 定义 7 章全集：全部占行，未解锁（2..7）显示为锁定。
    assert.equal(rows.length, 7, '配表定义的全部章节都展示');
    assert.deepEqual(Array.from(rows, (row: { title: string }) => row.title),
        ['枯菌穹顶', '僵笑面具', '坠机残港', '钢骨十字', '铁壁盾堡', '棱晶裂谷', '熔岩之心']);
    assert.equal(rows[0].percent, 50);
    assert.equal(rows[1].state, 'locked');
    assert.deepEqual(Array.from(rows, (row: { state: string }) => row.state),
        ['progress', 'locked', 'locked', 'locked', 'locked', 'locked', 'locked']);
});

test('★★★loadChapterSelectRows：从 levelInfo 认出「本章最后一个首领」，只打通它就算通关', async () => {
    const chapterConfigs = [{ chapterId: 1, chapterName: '枯菌穹顶' }];
    // 第 1 章配了三个关：1-1(普通) / 1-4(普通) / 1-9(首领，levelMod=2)。
    // 🔴 顺序故意打乱：判据不许依赖配表行序。
    const levelRows = [
        { levelId: 10009, levelChapter: 1, chapterStage: 9, levelMod: 2 },
        { levelId: 10001, levelChapter: 1, chapterStage: 1, levelMod: 1 },
        { levelId: 10004, levelChapter: 1, chapterStage: 4, levelMod: 1 },
        // 别的章的首领不许串台
        { levelId: 20009, levelChapter: 2, chapterStage: 9, levelMod: 2 },
    ];
    const sites = [
        { cellId: 11, configId: '10001' },
        { cellId: 12, configId: '10004' },
        { cellId: 13, configId: '10009' },
        { cellId: 14, configId: '10009' }, // 同一关占两格（整片区域）
    ];
    // 只占了一格（占领率 25%），但占的正是首领那一片 ⇒ 金牌。
    const bossOnly = await runChapterSelectLoader({ chapterConfigs, levelRows, sites, ownedCells: [14] });
    assert.equal(bossOnly.rows[0].percent, 25);
    assert.equal(bossOnly.rows[0].state, CHAPTER_SELECT_STATE.cleared,
        '通关 = 通过最后一个首领关卡，占领率只有 25% 也算');
    // 普通关占满、首领没打 ⇒ 不算通关。
    const noBoss = await runChapterSelectLoader({ chapterConfigs, levelRows, sites, ownedCells: [11, 12] });
    assert.equal(noBoss.rows[0].percent, 50);
    assert.equal(noBoss.rows[0].state, CHAPTER_SELECT_STATE.progress,
        '没打首领就不发金牌（哪怕占了别的格）');
});

test('★★★loadChapterSelectRows：区域关占多格 ⇒ 完成度按整片算，地图全通才 100%', async () => {
    const chapterConfigs = [{ chapterId: 1, chapterName: '枯菌穹顶' }];
    const sites = [
        // 同一关占两格（整片区域一起变已通关外观）
        { cellId: 11, configId: '10001', type: 'stage' },
        { cellId: 12, configId: '10001', type: 'stage' },
        { cellId: 13, configId: '10002', type: 'stage' },
        // 资源据点的同 configId 多格是**各自独立**的据点，不扩散
        { cellId: 14, configId: 'fixedResource_9', type: 'fixedResource' },
    ];
    // 只打了 12（整片 {11,12} 都变通）⇒ 2/4，不是 1/4。
    const partial = await runChapterSelectLoader({ chapterConfigs, sites, ownedCells: [12] });
    assert.equal(partial.rows[0].percent, 50, '同区域打一格 ⇒ 11、12 都算通关');
    // 每一格（含资源据点）都通了 ⇒ 才是 100%。
    const all = await runChapterSelectLoader({ chapterConfigs, sites, ownedCells: [11, 13, 14] });
    assert.equal(all.rows[0].percent, 100);
    assert.equal(all.rows[0].state, CHAPTER_SELECT_STATE.cleared);
    // 资源据点没占 ⇒ 差一格，不许四舍五入成 100%。
    const missingResource = await runChapterSelectLoader({ chapterConfigs, sites, ownedCells: [11, 13] });
    assert.equal(missingResource.rows[0].percent, 75);
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
 * 选中行的「底框」其实是那圈金色高亮环，**不是** `RowBg`。
 *
 * `row_current_ring.png` 是 744×233，描边厚 14px，中间的洞只占 art 的
 * x=14..729 / y=14..207；换算到 553×147 的节点上洞只有 532×122 高，
 * 比行底板本体（552×140，可见 130）还小一圈。所以序号块 / 状态块压到金边上，
 * 就是截图里「数字框顶出底框」的样子。洞的视觉中心比节点中心高 3.8
 * （art 中心 116.5 vs 洞中心 110.5）。
 *
 * ⚠️ 这个换算是**整体等比**模型（洞 122 高）。引擎实际走九宫格、边框按 1:1 画，
 * 渲染出来和模型有几像素差 —— 用户 2026-11-03/04 两轮都是照实机目视定的基线，
 * 最后定在 `BLOCK_BASELINE_Y = 12`（见下）。模型只用来算「有没有扎出洞」，不用来定位置。
 */
const RING_ART = {
    width: 744,
    height: 233,
    holeLeft: 14,
    holeRight: 729,
    holeTop: 14,
    holeBottom: 207,
} as const;
const RING_HOLE_CENTER_Y = 3.8;
/**
 * 序号块 / 状态块 / 挂锁 共用的垂直基线 —— 少写一个就会出现「锁飘在状态块下沿」。
 *
 * ⚠️ 2026-11-04 用户实机定稿：从 4.8 上抬到 **12**（洞中心 3.8 + 8.2），
 * 并缩到 **0.9**。这是用户对着实机明暗分界调的，**不是**「数学上居中」——
 * 所以下面不再要求上下留白相等，只要求「整体不扎进金边」。
 * 换这条基线时必须三块一起改（挂锁与状态块同列）。
 */
const BLOCK_BASELINE_Y = 12;
/** 序号块 /「完成度」整块缩到 90%：两块 112 高、洞里约 122，不缩就是顶天立地。 */
const BLOCK_SCALE = 0.9;

test('ChapterSelectPanel.prefab：行内区块落在金色描边的洞里、四周留白均匀', () => {
    const data = loadPrefab();
    const lpos = (name: string): { x: number; y: number } =>
        data[nodeIndexOf(data, name)]._lpos as { x: number; y: number };
    const boxOf = (name: string): { width: number; height: number } =>
        componentOf(data, name, 'cc.UITransform')._contentSize as { width: number; height: number };
    const scaleOf = (name: string): number => {
        const value = (data[nodeIndexOf(data, name)] as { _lscale?: { x: number } })._lscale;
        assert.ok(value, `${name} 没有 _lscale`);
        return value.x;
    };
    /** 实际渲染尺寸 = 节点尺寸 × 缩放（`_lscale` 会连同子节点一起放大缩小）。 */
    const renderedOf = (name: string): { width: number; height: number } => {
        const box = boxOf(name);
        const scale = scaleOf(name);
        return { width: box.width * scale, height: box.height * scale };
    };

    // 三块共用同一套垂直对齐：挂锁和状态块同列，错开就会「锁飘在中间偏下」
    for (const name of ['NumBlock', 'StatusBlock', 'LockIcon']) {
        assert.equal(lpos(name).y, BLOCK_BASELINE_Y, `${name} 没对齐金边的视觉中心`);
    }

    // 从环的节点尺寸 + 素材里洞的位置，反推洞的半宽 / 半高 / 中心
    const ring = boxOf('CurrentRing');
    const scaleX = ring.width / RING_ART.width;
    const scaleY = ring.height / RING_ART.height;
    const halfW = ((RING_ART.holeRight - RING_ART.holeLeft) / 2) * scaleX;
    const halfH = ((RING_ART.holeBottom - RING_ART.holeTop) / 2) * scaleY;
    const centerY = (RING_ART.height / 2 - (RING_ART.holeTop + RING_ART.holeBottom) / 2) * scaleY;
    assert.ok(Math.abs(centerY - RING_HOLE_CENTER_Y) < 0.05, `洞中心算出来是 ${centerY.toFixed(2)}`);

    // 上下：整块必须落在洞里 —— 上沿尤其不能扎进金边（用户把块刻意上抬，上留白天生比下留白小）
    for (const name of ['NumBlock', 'StatusBlock']) {
        const box = renderedOf(name);
        const pos = lpos(name);
        const top = centerY + halfH - (pos.y + box.height / 2);
        const bottom = pos.y - box.height / 2 - (centerY - halfH);
        assert.ok(top >= 1 && bottom >= 1,
            `${name} 扎进金边了（上 ${top.toFixed(1)}px / 下 ${bottom.toFixed(1)}px）`);
        // 偏心是用户在实机上定过的，不判「相等」；只防「偏到另一侧去了」
        assert.ok(top < bottom, `${name} 变成偏下了，基线该往上调（上 ${top.toFixed(1)} / 下 ${bottom.toFixed(1)}）`);
    }

    // 再兜一层：不能溢出到行底板的节点矩形（140 高，±70）—— 否则会压到相邻行
    for (const name of ['NumBlock', 'StatusBlock']) {
        const box = renderedOf(name);
        const pos = lpos(name);
        assert.ok(pos.y + box.height / 2 <= 70 && pos.y - box.height / 2 >= -70,
            `${name} 超出 RowBg 的 140 高节点矩形`);
    }

    // 左右：序号块贴左、状态块贴右，两侧留白要一样宽
    // （0.9 缩放会把原始 x 上那 1.2px 的差放大到 2.3px，容差取 3）
    const num = renderedOf('NumBlock');
    const st = renderedOf('StatusBlock');
    const leftGap = lpos('NumBlock').x - num.width / 2 + halfW;
    const rightGap = halfW - (lpos('StatusBlock').x + st.width / 2);
    assert.ok(leftGap >= 4 && rightGap >= 4,
        `左右贴到金边了（左 ${leftGap.toFixed(1)}px / 右 ${rightGap.toFixed(1)}px）`);
    assert.ok(Math.abs(leftGap - rightGap) <= 3,
        `左右留白不均（左 ${leftGap.toFixed(1)}px / 右 ${rightGap.toFixed(1)}px）`);

    // 只允许为「塞进洞里」轻微压扁，超过 10% 木纹和「完成度」小字就开始变形
    const ratio = (name: string) => boxOf(name).width / boxOf(name).height;
    assert.ok(Math.abs(ratio('NumBlock') / (139 / 167) - 1) < 0.1, `NumBlock 变形了：比例 ${ratio('NumBlock')}`);
    assert.ok(Math.abs(ratio('StatusBlock') / (200 / 167) - 1) < 0.1, `StatusBlock 变形了：比例 ${ratio('StatusBlock')}`);

    // 挂锁比效果图略大（美术要求：在 62×70 基础上放大到 130%）
    assert.deepEqual([boxOf('LockIcon').width, boxOf('LockIcon').height],
        [Math.round(62 * 1.3), Math.round(70 * 1.3)]);
});

test('ChapterSelectPanel.prefab：序号块与完成度块缩到 90%、章节名居中（2026-11-03）', () => {
    const data = loadPrefab();
    const scaleOf = (name: string) => {
        const value = (data[nodeIndexOf(data, name)] as { _lscale?: { x: number; y: number } })._lscale;
        assert.ok(value, `${name} 没有 _lscale`);
        return value;
    };

    // 「缩小成 95%」：两块等比缩，不缩宽度只缩宽度会拧坏木纹和「完成度」两行
    for (const name of ['NumBlock', 'StatusBlock']) {
        const scale = scaleOf(name);
        assert.equal(scale.x, BLOCK_SCALE, `${name} 没缩到 95%`);
        assert.equal(scale.y, BLOCK_SCALE, `${name} 横向纵向必须等比缩`);
    }
    // 挂锁是字形不是底板，不跟着缩（只在锁定时出现，缩了会比序号块小一圈）
    assert.equal(scaleOf('LockIcon').x, 1);

    // 「章节名称也需要居中对齐」：`_horizontalAlign` 0 = LEFT / 1 = CENTER
    assert.equal(componentOf(data, 'NameLabel', 'cc.Label')._horizontalAlign, 1,
        '章节名还是左对齐（文字会贴着序号块，看着像没居中）');

    // 状态块里的两行字跟着父节点一起缩，不能再单独改它们的字号
    assert.equal(scaleOf('PercentLabel').x, 1);
    assert.equal(scaleOf('CompleteLabel').x, 1);
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
