/**
 * 物品详情（老端 `LayerRolrItemDetail`） + 主界面「10级领取」（老端 `组件_主界面_领取武将`）的单测。
 *
 * ## 盯住哪七类东西（按「错了会不会报错」排序）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `ItemDetailTable` 判定与解析（零 `cc`） | 静默 —— 品质档差 1、三选一按钮不互斥、途径行拿不到跳转 id |
 * | B | `MainTaskTable` 判定与解析（零 `cc`） | 静默 —— `REWARDED` 时角标不隐藏 / 红点该亮不亮 / 进度上限读成 0 |
 * | C | 美术资源存在性 + 九宫名单 ↔ `.meta` 双向对账 | 静默留白 / 九宫图按 SIMPLE 画 ⇒ 拉伸变形 |
 * | D | prefab 结构 + 几何对 **FGUI 原稿** 反解 | 静默 —— 节点搬到屏幕外、底板盖住文字、槽位不居中 |
 * | E | 视图脚本接线（源码文本） | 静默 —— 死按钮（`CLICK` 绑在无 `Button` 的节点上）、闭包捕获旧数据 |
 * | F | 文案（唯一出口 + 与 FGUI `text="…"` 逐字一致） | 有人「顺手修正」就与设计稿分叉 |
 * | G | `ArenaRoot` 上的 HUD 嵌套实例（位置覆写 + **源 prefab** 里的 `cc.Widget`） | 静默 —— HUD 跑到屏幕外 / 不随分辨率贴边 / **挂载组件让 `UITransform` 翻倍** |
 *
 * ## 为什么能直接 `import` 这些源码
 *
 * `ItemDetailTable` / `ItemDetailTexts` / `ItemDetailArt` / `MainTaskTable` / `MainTaskTexts` /
 * `MainTaskArt` 的 import 链上**没有 `cc`**。这是硬约束：一旦哪条链上出现 `import … from 'cc'`，
 * 本文件整片 import 失败 ⇒ 那一刻的报错就是哨兵，别去「从测试里绕开」。
 *
 * ⚠️ `ItemDetailRepository` / `ItemDetailArtLoader` / `GoodsBox` / `ItemDetailRow` /
 * `ItemDetailPage` / `GetHeroEntry` / `MainTaskRepository` **都带 `cc`**
 * ⇒ 本文件**不** import 它们（相关约束走 E 组的源码文本断言）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    QUALITY_FRAME_COUNT,
    QUALITY_NAME_FALLBACK,
    TITLE_ART_STEPS,
    accessRefsOf,
    accessTextsOf,
    canComposOf,
    itemNumberTextOf,
    parseItemCraftRows,
    parseItemRow,
    parseItemRows,
    parseViewTypeRows,
    qualityFrameStepOf,
    qualityFrameSuffixOf,
    qualityNameOf,
    qualityTitleStepOf,
    typeStateOf,
} from '../assets/script/app/itemdetail/ItemDetailTable';
import type { IItemCraftRow, IViewTypeRow } from '../assets/script/app/itemdetail/ItemDetailTable';
import { ITEM_DETAIL_TEXTS, formatText } from '../assets/script/app/itemdetail/ItemDetailTexts';
import {
    ID_ART_DIR,
    ID_ART_NAMES,
    ID_ART_SLICED,
    ID_ART_TILED,
    ID_TITLE_KEYS,
    QUALITY_FRAME_ART_DIR,
    qualityFrameArtPath,
    titleArtPathOf,
} from '../assets/script/app/itemdetail/ItemDetailArt';
import {
    CMD_COMMON_STATE,
    MAIN_TASK_HERO_TARGET_TYPE,
    canClaimOf,
    entryVisibleOf,
    isUndoneOf,
    normalizeTaskState,
    parseMainTaskRow,
    parseMainTaskRows,
    pickHeroTaskRow,
    progressTextOf,
    redDotVisibleOf,
} from '../assets/script/app/maintask/MainTaskTable';
import { GET_HERO_TEXTS } from '../assets/script/app/maintask/MainTaskTexts';
import { MT_ART_NAMES, MT_ART_SLICED, MT_ART_TILED } from '../assets/script/app/maintask/MainTaskArt';

// ============================================================
// 公共小工具
// ============================================================

/** 画布尺寸（`组件_角色_道具详情.xml` 声明 720×1280，与工程一致）。 */
const CANVAS_W = 720;
const CANVAS_H = 1280;

const IMAGE_ROOT = 'assets/resources/image';
const ID_PREFAB = 'assets/resources/ui/ItemDetail/ItemDetail.prefab';
const ID_ROW_PREFAB = 'assets/resources/ui/ItemDetail/ItemDetailRow.prefab';
const MT_PREFAB = 'assets/resources/ui/MainTask/GetHeroEntry.prefab';
const ARENA_PREFAB = 'assets/resources/ui/main/ArenaRoot.prefab';

/** `GetHeroEntry.prefab` 的 uuid（`ArenaRoot` 里那个嵌套实例指向它）。 */
const GET_HERO_PREFAB_UUID = 'aaa14e0a-941b-4175-923b-dc69a0b81a0d';

const PAGE_SRC = readFileSync('assets/script/app/itemdetail/ItemDetailPage.ts', 'utf8');
const BOX_SRC = readFileSync('assets/script/app/itemdetail/GoodsBox.ts', 'utf8');
const ROW_SRC = readFileSync('assets/script/app/itemdetail/ItemDetailRow.ts', 'utf8');
const HUD_SRC = readFileSync('assets/script/app/maintask/GetHeroEntry.ts', 'utf8');

/** 节点上挂的脚本 cid 列表（23 位、非 `cc.` 开头）。 */
function scriptTypes(prefab: any[], nodeId: number): string[] {
    const out: string[] = [];
    for (const c of prefab[nodeId]._components ?? []) {
        const t = byId(prefab, c.__id__)?.__type__;
        if (typeof t === 'string' && t.length === 23 && !t.startsWith('cc.')) out.push(t);
    }
    return out;
}

function loadPrefab(path: string): any[] {
    return JSON.parse(readFileSync(path, 'utf8')) as any[];
}

function byId(o: any[], id: number): any {
    return o[id];
}

/** 一个节点在**根节点坐标系**里的矩形。 */
interface IRect {
    l: number; r: number; b: number; t: number;
}

interface INodeRect extends IRect {
    name: string;
    id: number;
    depth: number;
}

/**
 * 把一棵 prefab 节点树摊平成 `路径 → 根坐标系矩形`。
 *
 * ⚠️ key 是**相对根的路径**（`Goods`、`Goods/Frame`、`ContentBar/Goods1`），不是裸名字：
 * 物品详情里有 **4 个**叫 `Frame` 的节点（主框 + 3 个内容格），用裸名字会互相覆盖 ——
 * 断言全打在最后一个上，看着通过其实一个都没验（典型的「静默假绿」）。
 *
 * ⚠️ 不做缩放补偿：本工程的生成器把缩放**烘进尺寸**（`Frame` 直接用 84×84，
 * 而不是 100×100 + `scale=0.84`），所以沿途 `scale` 恒 1。若哪天变成 `scale` 表达，
 * 这里必须跟着改 —— 否则这条几何断言会**静默失效**（比较的仍是旧口径）。
 */
function collectRects(prefab: any[]): Map<string, INodeRect> {
    const out = new Map<string, INodeRect>();
    const childrenOf = new Map<number, number[]>();
    prefab.forEach((o, id) => {
        if (o?.__type__ !== 'cc.Node' || !o._lpos) return;
        const pid = o._parent?.__id__;
        if (typeof pid === 'number') {
            if (!childrenOf.has(pid)) childrenOf.set(pid, []);
            childrenOf.get(pid)!.push(id);
        }
    });
    const walk = (id: number, ox: number, oy: number, depth: number, prefix: string): void => {
        const o = prefab[id];
        const uit = compOf(prefab, id, 'cc.UITransform');
        const size = uit?._contentSize ?? { width: 0, height: 0 };
        const anchor = uit?._anchorPoint ?? { x: 0.5, y: 0.5 };
        const cx = ox + o._lpos.x;
        const cy = oy + o._lpos.y;
        // 根节点（depth 0）的 key 是它自己的名字；子孙用相对根的路径
        const key = depth === 0 ? o._name : (prefix ? `${prefix}/${o._name}` : o._name);
        out.set(key, {
            name: o._name,
            id,
            depth,
            l: cx - anchor.x * size.width,
            r: cx + (1 - anchor.x) * size.width,
            b: cy - anchor.y * size.height,
            t: cy + (1 - anchor.y) * size.height,
        });
        for (const child of childrenOf.get(id) ?? []) walk(child, cx, cy, depth + 1, depth === 0 ? '' : key);
    };
    walk(1, 0, 0, 0, '');
    return out;
}

/** 取节点上的某类组件对象。 */
function compOf(prefab: any[], nodeId: number, type: string): any | null {
    for (const c of prefab[nodeId]._components ?? []) {
        const comp = byId(prefab, c.__id__);
        if (comp?.__type__ === type) return comp;
    }
    return null;
}

/**
 * FGUI 画布矩形（`x,y,w,h`，**y 向下**、原点左上）→ Cocos 节点局部矩形。
 * 换算依据：画布中心 `(360,640)` 对应本工程的 `(0,0)`，y 轴翻转。
 */
function fguiRect(x: number, y: number, w: number, h: number): IRect {
    return {
        l: x - CANVAS_W / 2,
        r: x + w - CANVAS_W / 2,
        b: CANVAS_H / 2 - (y + h),
        t: CANVAS_H / 2 - y,
    };
}

/** 断言两个矩形相等（容差 0.6 —— prefab 里的坐标保留 1~3 位小数）。 */
function assertRect(actual: IRect | undefined, expected: IRect, label: string): void {
    assert.ok(actual, `${label}：prefab 里没有这个节点`);
    const tol = 0.6;
    for (const key of ['l', 'r', 'b', 't'] as const) {
        assert.ok(
            Math.abs(actual[key] - expected[key]) <= tol,
            `${label}.${key}：期望 ${expected[key]}，实际 ${actual[key]}（容差 ${tol}）`,
        );
    }
}

/** meta 里的九宫 border（Cocos 3.8 放在 `subMetas.<id>.userData`，别写死层级）。 */
function deepBorder(obj: any): any | null {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.borderTop === 'number') return obj;
    for (const v of Object.values(obj)) {
        const hit = deepBorder(v);
        if (hit) return hit;
    }
    return null;
}

/**
 * 解一张 `assets/remoteRef/**.json` 表。
 *
 * 这些表是**列压缩**格式：`{ k: [列名…], v: [[行…]…], c: {…} }`
 * —— 直接当数组会得到 `[]`（`length 0`），然后所有断言都"通过"了，
 * 这是最容易骗过自己的写法。所以这里显式判形状 + 抛错。
 */
function decodeTable(path: string): any[] {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.k) && Array.isArray(raw?.v)) {
        return raw.v.map((row: any[]) => {
            const obj: Record<string, any> = {};
            raw.k.forEach((key: string, index: number) => { obj[key] = row[index]; });
            return obj;
        });
    }
    throw new Error(`${path} 的表形状不认识（既不是数组、也不是 {k,v} 列压缩）—— 先去看一眼再说`);
}

/**
 * 从 protoCompiled.json 里取出**真正的** `MessageId.values`。
 *
 * ⚠️ 全文档里有好几个叫 `MessageId` 的节点（各 package 各一份），`findKey` 会拿到第一个
 * —— 而真正的那个在 `nested.com.xkhy.tafang.cmd` 下、有几百条。取**条目最多**的那个。
 */
function biggestMessageIdValues(root: any): Record<string, number> | null {
    let best: Record<string, number> | null = null;
    const visit = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
            if (key === 'MessageId' && value && typeof value === 'object') {
                const vs = (value as any).values;
                if (vs && typeof vs === 'object' && (!best || Object.keys(vs).length > Object.keys(best).length)) {
                    best = vs as Record<string, number>;
                }
            }
            visit(value);
        }
    };
    visit(root);
    return best;
}

function borderOf(rel: string): { t: number; b: number; l: number; r: number } {
    const metaPath = `${IMAGE_ROOT}/${rel}.png.meta`;
    if (!existsSync(metaPath)) return { t: 0, b: 0, l: 0, r: 0 };
    const hit = deepBorder(JSON.parse(readFileSync(metaPath, 'utf8')));
    return hit
        ? { t: hit.borderTop ?? 0, b: hit.borderBottom ?? 0, l: hit.borderLeft ?? 0, r: hit.borderRight ?? 0 }
        : { t: 0, b: 0, l: 0, r: 0 };
}

/** 去掉注释（保留行内 `://` 之类的冒号后斜杠）。 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e]/;

function truthy(v: number | undefined | null): boolean {
    return typeof v === 'number' && Number.isFinite(v);
}

// ============================================================
// A. 物品详情判定与解析（ItemDetailTable）
// ============================================================

test('物品 A1｜qualityNameOf 是 1 基查 0 基表（差 1 是最经典的静默错）', () => {
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 1), '普通');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 2), '精良');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 7), '神话');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 8), '', '越界返回空串，不抛');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, 0), '普通', '0 钳到第 1 档（老端 Math.max(x,0)）');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, -3), '普通');
    assert.equal(qualityNameOf('', 3), '优秀', 'CSV 空 ⇒ 走兜底表');
    assert.equal(qualityNameOf(null, 3), '优秀');
    assert.equal(qualityNameOf('甲,乙', 2), '乙', '自定义 CSV 生效');
    assert.equal(qualityNameOf(QUALITY_NAME_FALLBACK, NaN), '普通', 'NaN 也安全');
});

test('物品 A2｜qualityTitleStepOf：品质 1..7 → gray..caise，越界钳 gray', () => {
    assert.equal(qualityTitleStepOf(1), 'gray');
    assert.equal(qualityTitleStepOf(2), 'green');
    assert.equal(qualityTitleStepOf(3), 'blue');
    assert.equal(qualityTitleStepOf(4), 'purple');
    assert.equal(qualityTitleStepOf(5), 'yellow');
    assert.equal(qualityTitleStepOf(6), 'red');
    assert.equal(qualityTitleStepOf(7), 'caise');
    assert.equal(qualityTitleStepOf(8), 'gray', '第 8 档缎带**不存在** ⇒ 回灰，别去借品质框那一档');
    assert.equal(qualityTitleStepOf(0), 'gray');
    assert.equal(TITLE_ART_STEPS.length, 7);
});

test('物品 A3｜qualityFrameStepOf / qualityFrameSuffixOf：8 档、两位补零', () => {
    assert.equal(QUALITY_FRAME_COUNT, 8, '物品框有第 8 档「将」，比缎带多一档');
    assert.equal(qualityFrameStepOf(1), 1);
    assert.equal(qualityFrameStepOf(8), 8);
    assert.equal(qualityFrameStepOf(9), 8, '越界钳到 8');
    assert.equal(qualityFrameStepOf(0), 1);
    assert.equal(qualityFrameStepOf(NaN), 1);
    assert.equal(qualityFrameSuffixOf(1), '01');
    assert.equal(qualityFrameSuffixOf(8), '08');
    assert.equal(qualityFrameSuffixOf(7), '07');
});

test('物品 A4｜itemNumberTextOf：0 ⇒ 空串，其余纯整数不缩写', () => {
    assert.equal(itemNumberTextOf(0), '');
    assert.equal(itemNumberTextOf(1), '1');
    assert.equal(itemNumberTextOf(999999), '999999', '不缩写（与庆典奖励格同一口径）');
    assert.equal(itemNumberTextOf(12.9), '12', 'floor 不四舍五入');
    assert.equal(itemNumberTextOf(NaN), '');
    assert.equal(itemNumberTextOf(-5), '-5', '负数照原样（老端也不管）');
});

test('物品 A5｜parseItemRow：字段缺失给安全默认，resId ≤ 0 直接丢行', () => {
    assert.equal(parseItemRow(null), null);
    assert.equal(parseItemRow('x'), null);
    assert.equal(parseItemRow({}), null, '没 resId');
    assert.equal(parseItemRow({ resId: 0 }), null);
    assert.equal(parseItemRow({ resId: -1 }), null);

    const row = parseItemRow({
        resId: 18014,
        name: '猎头者',
        desc: '一片碎片',
        type: 2,
        useType: 1,
        quality: 4,
        icon: 'icons/item/图鉴_帽子',
        access: [1, 0, 2, 'x', null, 3],
        itemBox: [11, 12],
        useJump: 5,
    })!;
    assert.equal(row.resId, 18014);
    assert.equal(row.quality, 4);
    assert.deepEqual(row.access, [1, 2, 3], '非法 id（0 / 非数字）被剔掉，顺序保持');
    assert.deepEqual(row.itemBox, [11, 12]);
    assert.equal(row.useJump, 5);

    const bare = parseItemRow({ resId: 7 })!;
    assert.equal(bare.quality, 1, 'quality 缺省 1（不是 0 —— 0 会落到第 1 档兜底，语义上等价但默认值要明确）');
    assert.equal(bare.access.length, 0);
    assert.equal(bare.itemBox.length, 0);
    assert.equal(bare.useJump, 0);
});

test('物品 A6｜parseItemRows：后来的同 resId 覆盖前面的（表序靠后为准）', () => {
    const rows = parseItemRows([{ resId: 1, name: 'A' }, { resId: 2 }, { resId: 1, name: 'B' }, { resId: 0 }]);
    assert.equal(rows.size, 2);
    assert.equal(rows.get(1)!.name, 'B');
});

test('物品 A7｜typeStateOf 三选一**互斥**（有意偏离：老端能与「前往」同时为真）', () => {
    // 有内容 + 可使用（类型 1）
    assert.deepEqual(typeStateOf(true, 1, false), { showContent: true, showCompos: false, showGo: true, showGo1: false });
    // 无内容 + 可使用（类型 3）
    assert.deepEqual(typeStateOf(false, 9, false), { showContent: false, showCompos: false, showGo: false, showGo1: true });
    // 有内容 + 不可使用（类型 0）
    assert.deepEqual(typeStateOf(true, 0, false), { showContent: true, showCompos: false, showGo: false, showGo1: false });
    // 无内容 + 不可使用（类型 2）⇒ 四个全 false
    assert.deepEqual(typeStateOf(false, 0, false), { showContent: false, showCompos: false, showGo: false, showGo1: false });

    // 可以合成 ⇒ 前往两个都让位
    const compos = typeStateOf(true, 1, true);
    assert.equal(compos.showCompos, true);
    assert.equal(compos.showGo, false, '合成优先：不能让「前往」和「合成」同时可点');
    assert.equal(compos.showGo1, false);
    assert.equal(compos.showContent, true, '「内容」不受合成影响');

    // 互斥不变式：任一组状态下，三个按钮最多亮一个
    for (const hasBox of [true, false]) {
        for (const jump of [0, 3]) {
            for (const compos of [true, false]) {
                const s = typeStateOf(hasBox, jump, compos);
                const lit = [s.showGo, s.showGo1, s.showCompos].filter(Boolean).length;
                assert.ok(lit <= 1, `按钮同时亮了 ${lit} 个：${JSON.stringify(s)}`);
            }
        }
    }
});

test('物品 A8｜accessRefsOf 保留 id（老端 render 与 onClick 用的是**同一个** id）', () => {
    const viewTypes = new Map<number, IViewTypeRow>([
        [1, { resId: 1, value: '冒险关卡' }],
        [2, { resId: 2, value: '' }],
        [3, { resId: 3, value: '商店' }],
    ]);
    const refs = accessRefsOf(viewTypes, [1, 2, 3, 4]);
    assert.deepEqual(refs, [
        { resId: 1, text: '冒险关卡' },
        { resId: 3, text: '商店' },
    ], 'id 2 文案为空 ⇒ 不产行；id 4 查不到 ⇒ 不产行');
    assert.deepEqual(accessTextsOf(viewTypes, [1, 3]), ['冒险关卡', '商店']);
    assert.deepEqual(accessRefsOf(viewTypes, []), []);
    // 顺序 = access 的顺序（老端逐行渲染）
    assert.deepEqual(accessTextsOf(viewTypes, [3, 1]), ['商店', '冒险关卡']);
});

test('物品 A9｜canComposOf：表缺 / number ≤ 0 / 数量不够 ⇒ 都不显示', () => {
    const craft: IItemCraftRow = { id: 18014, number: 10, reward: { resId: 18015, number: 1 } };
    assert.equal(canComposOf(undefined, 99), false, 'itemCraft 是异步表，没预热到这里恒 false');
    assert.equal(canComposOf(null, 99), false);
    assert.equal(canComposOf(craft, 9), false);
    assert.equal(canComposOf(craft, 10), true, '`>=` 不是 `>`');
    assert.equal(canComposOf(craft, 11), true);
    assert.equal(canComposOf({ id: 1, number: 0, reward: null }, 99), false, 'number=0 ⇒ 恒 false');
    assert.equal(canComposOf({ id: 1, number: NaN, reward: null }, 99), false);
});

test('物品 A10｜parseViewTypeRows / parseItemCraftRows 的坏行剔除', () => {
    const vt = parseViewTypeRows([{ resId: 5, value: '商店' }, { resId: 0 }, 'x', null, { value: '无 id' }]);
    assert.equal(vt.size, 1);
    assert.equal(vt.get(5)!.value, '商店');

    const craft = parseItemCraftRows([
        { id: 10, number: 3, reward: { resId: 20, number: 2 } },
        { id: 11, number: 4 },
        { id: 0 },
        { id: 12, number: 5, reward: { resId: 0 } },
    ]);
    assert.equal(craft.size, 3);
    assert.deepEqual(craft.get(10)!.reward, { resId: 20, number: 2 });
    assert.equal(craft.get(11)!.reward, null, '没 reward 字段 ⇒ null（不是造一个 {resId:0}）');
    assert.equal(craft.get(12)!.reward!.number, 1, 'reward.number 缺省 1');
});

// ============================================================
// B. 主线任务 / 「10级领取」判定（MainTaskTable）
// ============================================================

test('物品 B1｜常量钉死：哨兵 99 + CmdCommonState 三值', () => {
    assert.equal(MAIN_TASK_HERO_TARGET_TYPE, 99, '老端 VOMainTaskBag.SpecialTaskForHeroId');
    assert.equal(CMD_COMMON_STATE.UNDONE, 0);
    assert.equal(CMD_COMMON_STATE.FINISH, 1);
    assert.equal(CMD_COMMON_STATE.REWARDED, 2);
});

test('物品 B2｜parseMainTaskRow：进度上限取自 param.count（不是顶层字段）', () => {
    const row = parseMainTaskRow({
        resId: 500099,
        preResId: 0,
        targetType: 99,
        param: { count: 10 },
        reward: [{ number: 1, resId: 18014 }],
        name: '10级获取英雄',
        goto: null,
    })!;
    assert.equal(row.resId, 500099);
    assert.equal(row.targetType, 99);
    assert.equal(row.maxCount, 10, 'param.count');
    assert.equal(row.goto, 0, 'goto 是 null ⇒ 0，不是 NaN');
    assert.deepEqual(row.reward, [{ resId: 18014, number: 1 }]);
    assert.equal(row.name, '10级获取英雄');

    assert.equal(parseMainTaskRow({ resId: 1 }).maxCount, 0, '没有 param ⇒ 0');
    assert.equal(parseMainTaskRow({ resId: 1 }).targetType, 0);
    assert.equal(parseMainTaskRow({ resId: 0 }), null);
    assert.equal(parseMainTaskRow(undefined), null);
});

test('物品 B3｜pickHeroTaskRow：只认 99；多行时取 resId 最小（不靠 Map 迭代序）', () => {
    assert.equal(pickHeroTaskRow(new Map()), null);
    const rows = parseMainTaskRows([
        { resId: 500101, targetType: 99, param: { count: 20 } },
        { resId: 1, targetType: 1, param: { count: 5 } },
        { resId: 500099, targetType: 99, param: { count: 10 } },
        { resId: 500100, targetType: 2 },
    ]);
    const hero = pickHeroTaskRow(rows)!;
    assert.equal(hero.resId, 500099, '取最小的那行');
    assert.equal(hero.maxCount, 10);
});

test('物品 B4｜progressTextOf：`(7/10)`；负数钳 0；非数退 0', () => {
    assert.equal(progressTextOf(7, 10), '(7/10)');
    assert.equal(progressTextOf(0, 10), '(0/10)');
    assert.equal(progressTextOf(-3, 10), '(0/10)');
    assert.equal(progressTextOf(11, 10), '(11/10)', '超额照显示，不钳到上限（老端原样）');
    assert.equal(progressTextOf(NaN, 10), '(0/10)');
    assert.equal(progressTextOf(3, NaN), '(3/0)');
    assert.equal(progressTextOf(3.9, 10.7), '(3/10)');
});

test('物品 B5｜canClaimOf / isUndoneOf 是状态**相等**判定', () => {
    assert.equal(canClaimOf(1), true);
    assert.equal(canClaimOf(0), false);
    assert.equal(canClaimOf(2), false);
    assert.equal(canClaimOf(1.9), true, 'floor 后比较（Long 收敛成整数后不会走到这里）');
    assert.equal(isUndoneOf(0), true);
    assert.equal(isUndoneOf(1), false);
    assert.equal(isUndoneOf(2), false);
});

test('物品 B6｜entryVisibleOf：**已领取整块隐藏**（别「优化」成常显）', () => {
    assert.equal(entryVisibleOf(false, 0), false, '表没配 ⇒ 隐藏');
    assert.equal(entryVisibleOf(false, 1), false);
    assert.equal(entryVisibleOf(true, 0), true, '未完成 ⇒ 显示（给玩家看到进度）');
    assert.equal(entryVisibleOf(true, 1), true, '可领 ⇒ 显示');
    assert.equal(entryVisibleOf(true, 2), false, '★ 已领取 ⇒ 隐藏（老端原样）');
});

test('物品 B7｜redDotVisibleOf：只有 FINISH 亮', () => {
    assert.equal(redDotVisibleOf(1), true);
    assert.equal(redDotVisibleOf(0), false, '未完成不亮');
    assert.equal(redDotVisibleOf(2), false, '已领取不亮');
});

test('物品 B8｜normalizeTaskState：Long / 缺字段都收敛成 number', () => {
    assert.deepEqual(normalizeTaskState({ count: 7, rewardState: 1 }), { count: 7, rewardState: 1 });
    assert.deepEqual(normalizeTaskState({ count: '7', rewardState: '1' }), { count: 7, rewardState: 1 }, '压缩表可能是字符串');
    assert.deepEqual(normalizeTaskState(null), { count: 0, rewardState: 0 }, '未登录 / 缓存缺表');
    assert.deepEqual(normalizeTaskState({}), { count: 0, rewardState: 0 });
    assert.deepEqual(normalizeTaskState({ count: NaN }), { count: 0, rewardState: 0 });
    // uint64 超出 2^53 时不炸、不做错误截断以外的处理（只保证是有限数）
    const big = normalizeTaskState({ count: 1.8e19, rewardState: 1 });
    assert.ok(Number.isFinite(big.count));
});

// ============================================================
// C. 美术：磁盘存在性 + 九宫名单 ↔ .meta 双向对账
// ============================================================

test('物品 C1｜每张图的 .png 与 .png.meta 都在盘上', () => {
    const all = [...Object.entries(ID_ART_NAMES), ...Object.entries(MT_ART_NAMES)];
    assert.ok(all.length >= 18, `图数量太少（${all.length}）—— 是不是漏迁了`);
    for (const [key, rel] of all) {
        assert.ok(existsSync(`${IMAGE_ROOT}/${rel}.png`), `缺图：${key} → ${rel}.png`);
        assert.ok(existsSync(`${IMAGE_ROOT}/${rel}.png.meta`), `缺 meta：${key} → ${rel}.png.meta（编辑器没导入）`);
    }
});

test('物品 C2｜SLICED 名单 ↔ .meta border **双向**对账（漏一项 = 静默拉伸变形）', () => {
    const check = (label: string, names: Readonly<Record<string, string>>, sliced: ReadonlySet<string>) => {
        for (const [key, rel] of Object.entries(names)) {
            const b = borderOf(rel);
            const hasBorder = b.t + b.b + b.l + b.r > 0;
            assert.equal(
                sliced.has(key), hasBorder,
                `${label}「${key}」(${rel})：SLICED 名单=${sliced.has(key)}，但 meta border=${JSON.stringify(b)}`,
            );
        }
    };
    check('物品详情', ID_ART_NAMES, ID_ART_SLICED);
    check('10级领取', MT_ART_NAMES, MT_ART_SLICED);
    // 名单里不许有拼错的 key（`check` 只从 NAMES 出发，多出来的 key 不会被发现）
    for (const key of ID_ART_SLICED) assert.ok(key in ID_ART_NAMES, `ID_ART_SLICED 里的「${key}」不是合法 key`);
    for (const key of MT_ART_SLICED) assert.ok(key in MT_ART_NAMES, `MT_ART_SLICED 里的「${key}」不是合法 key`);
});

test('物品 C3｜三张美术表都能通过生成器内核的读表正则', () => {
    assert.equal(ID_ART_TILED.size, 0, '本模块没有平铺图');
    assert.equal(MT_ART_TILED.size, 0);
    const artFile = 'assets/script/app/itemdetail/ItemDetailArt.ts';
    const mtArtFile = 'assets/script/app/maintask/MainTaskArt.ts';
    /**
     * 复刻 `tmp/_fguilib.mjs` 的两个读表函数（**不是**在源码里搜字符串 ——
     * 内核是用 `new RegExp` 拼的，搜字符串只会搜到自己）：
     *
     * ```js
     * readArtMap: new RegExp(`export const ${NAMES}[^{]*\\{([\\s\\S]*?)\\n\\};?`)
     * readArtSet: new RegExp(`export const ${SET}[^=]*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`)
     * ```
     * 后者对**空集**也要求写成 `new Set<string>([])`：写成无参 `new Set<string>()` 匹配不上 ⇒ 内核 throw。
     */
    const readArtMap = (file: string, constName: string): Map<string, string> => {
        const re = new RegExp(`export const ${constName}[^{]*\\{([\\s\\S]*?)\\n\\};?`);
        const block = readFileSync(file, 'utf8').match(re);
        assert.ok(block, `${file} 里读不到 ${constName}`);
        const map = new Map<string, string>();
        for (const m of block![1].matchAll(/(\w+):\s*'([^']+)'/g)) map.set(m[1], m[2]);
        return map;
    };
    const readArtSet = (file: string, constName: string): string[] => {
        const re = new RegExp(`export const ${constName}[^=]*=\\s*new Set<string>\\(\\[([\\s\\S]*?)\\]\\)`);
        const block = readFileSync(file, 'utf8').match(re);
        assert.ok(block, `${file} 里读不到 ${constName}（必须写成 new Set<string>([...]) 或 new Set<string>([])）`);
        return [...block![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    };

    // 内核的 `minArt` 闸门：解析出的图少于这个数就直接 throw
    const idNames = readArtMap(artFile, 'ID_ART_NAMES');
    const mtNames = readArtMap(mtArtFile, 'MT_ART_NAMES');
    assert.ok(idNames.size >= 8, `ID_ART_NAMES 只解析出 ${idNames.size} 项（内核 minArt 闸门会 throw）`);
    assert.ok(mtNames.size >= 5, `MT_ART_NAMES 只解析出 ${mtNames.size} 项`);
    // 内核的另一道闸门：SLICED/TILED 里的 key 必须在 NAMES 里
    for (const key of [...readArtSet(artFile, 'ID_ART_SLICED'), ...readArtSet(artFile, 'ID_ART_TILED')]) {
        assert.ok(idNames.has(key), `ID_ART_SLICED/TILED 引用了不存在的 key: ${key}`);
    }
    for (const key of [...readArtSet(mtArtFile, 'MT_ART_SLICED'), ...readArtSet(mtArtFile, 'MT_ART_TILED')]) {
        assert.ok(mtNames.has(key), `MT_ART_SLICED/TILED 引用了不存在的 key: ${key}`);
    }
    // 解析结果必须与运行时的常量一致（内核读到的 = 编译后 import 的）
    assert.deepEqual([...idNames.entries()].sort(), Object.entries(ID_ART_NAMES).sort());
    assert.deepEqual([...mtNames.entries()].sort(), Object.entries(MT_ART_NAMES).sort());
});

test('物品 C4｜缎带 key ↔ TITLE_ART_STEPS 1:1；品质框图路径 8 档齐全', () => {
    assert.equal(ID_TITLE_KEYS.length, TITLE_ART_STEPS.length);
    for (let i = 0; i < TITLE_ART_STEPS.length; i++) {
        const path = titleArtPathOf(TITLE_ART_STEPS[i]);
        assert.equal(path, ID_ART_NAMES[ID_TITLE_KEYS[i]], `第 ${i + 1} 档缎带 key 与 steps 不同步`);
    }
    assert.equal(titleArtPathOf('不存在'), ID_ART_NAMES.titleGray, '未知档位回灰');
    assert.equal(ID_ART_DIR, 'itemdetail');
    assert.equal(QUALITY_FRAME_ART_DIR, 'common', '品质框跨模块共用 ⇒ 放 common');

    for (let quality = 1; quality <= QUALITY_FRAME_COUNT; quality++) {
        const rel = qualityFrameArtPath(qualityFrameSuffixOf(quality));
        assert.equal(rel, `common/cu_quality_${qualityFrameSuffixOf(quality)}`);
        assert.ok(existsSync(`${IMAGE_ROOT}/${rel}.png`), `缺品质框图：${rel}.png`);
        assert.ok(existsSync(`${IMAGE_ROOT}/${rel}.png.meta`), `缺品质框图 meta：${rel}.png.meta`);
    }
});

// ============================================================
// D. prefab 结构 + 几何对 FGUI 原稿反解
// ============================================================

test('物品 D1｜ItemDetail 根是 720×1280，挂了页面脚本，且没有 `CloseBtn`', () => {
    const prefab = loadPrefab(ID_PREFAB);
    const root = prefab[1];
    assert.equal(root._name, 'ItemDetail');
    const size = compOf(prefab, 1, 'cc.UITransform')._contentSize;
    assert.equal(size.width, CANVAS_W);
    assert.equal(size.height, CANVAS_H);
    assert.ok(scriptTypes(prefab, 1).length > 0, '根上没有 23 位脚本 cid —— 打开时会是一个空弹窗');
    const rects = collectRects(prefab);
    assert.ok(
        !rects.has('CloseBtn'),
        'FGUI 原稿没有关闭按钮 —— 加了就与设计稿分叉（关闭靠点空白，见 PopupBase.closeOnBlank）',
    );
    // 同理：`ItemDetailPage.closeButton` 允许未绑（`bindButton` 首行 `if (!node) return;`）
    assert.ok(/if \(!node\) return;/.test(stripComments(PAGE_SRC)), 'bindButton 必须能接住未绑定的节点');
});

test('物品 D2｜ItemDetail 每个节点的矩形 == FGUI 原稿逐像素换算', () => {
    const rects = collectRects(loadPrefab(ID_PREFAB));
    // 表 = FGUI XML 的 `xy`+`size`（画布 720×1280）。**禁抄 XML 的 xy 当屏坐标** ——
    // 这里的数字全部来自 `tmp/_probe_itemdetail_xml.mjs` 的布局引擎输出（已折入 relation / group）。
    const cases: [string, [number, number, number, number]][] = [
        ['PanelBg',    [102, 278, 515, 709]],  // n34  tybg
        ['TitleBg',    [75, 275, 570, 81]],    // n35  title_gray
        ['Goods',      [129, 363, 84, 84]],    // com_goods  120×120 的 物品框 × 0.7
        ['QualityText', [278, 388, 88, 34]],   // quality「精良」
        ['QualityLabel', [204, 389, 70, 34]],  // n9「品质:」
        ['CountText',  [288, 420, 88, 34]],    // lab_count
        ['CountLabel', [207, 419, 70, 34]],    // n11「数量:」
        ['NameText',   [204, 284, 311, 44]],   // lab_name
        ['BtnGo',      [280, 883, 160, 60]],
        ['BtnGo1',     [280, 885, 160, 60]],
        ['DescTitle',  [260, 456, 199, 39]],   // n13
        ['DescBg',     [127, 495, 466, 61]],   // n16  tycb_pt
        ['DescText',   [149, 509, 418, 29]],   // lab_desc
        ['ContentTitle', [267, 556, 199, 34]], // n31「内容」
        ['ContentBar', [125, 590, 469, 117]],  // list_ctx  flow_vt + vAlign=middle
        ['AccessTitle', [260, 707, 199, 44]],  // n23「获取途径」
        ['AccessList', [125, 751, 469, 253]],  // list  overflow=scroll, lineGap 17
        ['BtnCompos',  [280, 885, 160, 60]],
    ];
    for (const [name, rect] of cases) {
        assertRect(rects.get(name), fguiRect(...rect), name);
    }
});

test('物品 D3｜ItemDetail 的物品框三件套尺寸对 100×100 原稿 × 0.84', () => {
    const rects = collectRects(loadPrefab(ID_PREFAB));
    const goods = rects.get('Goods')!;
    assert.equal(+(goods.r - goods.l).toFixed(1), 84, 'com_goods 84×84');
    assert.equal(+(goods.t - goods.b).toFixed(1), 84);

    // `组件_公用_道具`（100×100）× 0.84
    assertRect(rects.get('Goods/Frame'), { l: goods.l, r: goods.r, b: goods.b, t: goods.t }, 'Goods/Frame（整格）');
    assertRect(
        rects.get('Goods/Icon'),
        { l: goods.l + 10 * 0.84, r: goods.l + 90 * 0.84, b: goods.b + 10 * 0.84, t: goods.t - 10 * 0.84 },
        'Goods/Icon（icon 10,10 80×80 × 0.84）',
    );
    const num = rects.get('Goods/Num')!;
    assert.ok(num, 'Goods/Num 不存在');
    assert.ok(Math.abs(num.r - goods.r) <= 0.6, `Num 必须**右对齐**到格右沿：Num.r=${num.r} Goods.r=${goods.r}`);
    assert.ok(num.b < goods.b + 1, 'Num 在底部（text_number y=66..100）');
    // 4 个 Frame 必须逐个点名（裸名字会被覆盖，见 collectRects 的注释）
    for (const key of ['Goods/Frame', 'ContentBar/Goods1/Frame', 'ContentBar/Goods2/Frame', 'ContentBar/Goods3/Frame']) {
        assert.ok(rects.has(key), `缺少 ${key} —— 物品框三件套不齐`);
    }
});

test('物品 D4｜「内容」三格：84×84、间距 4、**整体居中**（flow_vt + vAlign=middle）', () => {
    const rects = collectRects(loadPrefab(ID_PREFAB));
    const bar = rects.get('ContentBar')!;
    const slots = ['ContentBar/Goods1', 'ContentBar/Goods2', 'ContentBar/Goods3'].map((n) => rects.get(n));
    for (const s of slots) assert.ok(s, '内容槽位缺一个');
    for (const s of slots as INodeRect[]) {
        assert.equal(+(s.r - s.l).toFixed(1), 84, '槽位 84×84');
        assert.equal(+(s.t - s.b).toFixed(1), 84);
    }
    const [a, b, c] = slots as INodeRect[];
    assert.equal(+(b.l - a.r).toFixed(1), 4, 'colGap 4');
    assert.equal(+(c.l - b.r).toFixed(1), 4, 'colGap 4');
    // 居中：三段总宽 260，容器中心 (-235+234)/2 = -0.5
    const totalW = 84 * 3 + 4 * 2;
    const barCenterX = (bar.l + bar.r) / 2;
    assert.ok(Math.abs((a.l + c.r) / 2 - barCenterX) <= 0.6, '整体必须左右居中（align=center）');
    assert.equal(+(bar.r - bar.l).toFixed(0), 469, `容器 469 宽，装得下 ${totalW}`);
    // 垂直居中：vAlign=middle
    const barCenterY = (bar.b + bar.t) / 2;
    assert.ok(Math.abs((a.b + a.t) / 2 - barCenterY) <= 0.6, '垂直居中（vAlign=middle）');
    // 三个槽位必须**真的是** GoodsBox
    const prefab = loadPrefab(ID_PREFAB);
    for (const s of slots as INodeRect[]) {
        const script = (prefab[s.id]._components ?? [])
            .map((c: any) => prefab[c.__id__])
            .find((c: any) => typeof c?.__type__ === 'string' && c.__type__.length === 23);
        assert.ok(script, `${s.name} 上没挂 GoodsBox`);
    }
});

test('物品 D5｜三个按钮的底图统一换成 `cu_ty_btn21`（FGUI 控制器覆写 `颜色=1`）', () => {
    const prefab = loadPrefab(ID_PREFAB);
    const rects = collectRects(prefab);
    // `.meta.uuid + '@f9941'` 才是 SpriteFrame 的 uuid（图片资源本体是 `.meta.uuid`）
    const green = `${JSON.parse(readFileSync(`${IMAGE_ROOT}/${ID_ART_NAMES.btn2Green}.png.meta`, 'utf8')).uuid}@f9941`;
    const plateOf = (nodeName: string): string | undefined => {
        const node = prefab[rects.get(nodeName)!.id];
        for (const cid of node._children ?? []) {
            const child = prefab[cid.__id__];
            if (!child?._name?.startsWith('Plate')) continue;
            return compOf(prefab, cid.__id__, 'cc.Sprite')?._spriteFrame?.__uuid__;
        }
        return undefined;
    };
    for (const name of ['BtnGo', 'BtnGo1', 'BtnCompos']) {
        assert.equal(plateOf(name), green, `${name} 的底板不是 btn2Green（FGUI 三个按钮都用「颜色=1」绿档）`);
    }
    // 按钮上必须有 cc.Button（决定 `bindButton` 走 CLICK 还是 TOUCH_END）
    for (const name of ['BtnGo', 'BtnGo1', 'BtnCompos']) {
        assert.ok(compOf(prefab, rects.get(name)!.id, 'cc.Button'), `${name} 上没有 cc.Button`);
    }
});

test('物品 D6｜AccessList 是虚拟列表；`content` 子节点名**必须**是 `content`（小写）', () => {
    const prefab = loadPrefab(ID_PREFAB);
    const rects = collectRects(prefab);
    const list = compOf(prefab, rects.get('AccessList')!.id, '544earF5qRLB4JTuTnSr11+');
    assert.ok(list, 'AccessList 上没挂 VirtualScrollView');
    assert.ok(list.itemPrefab?.__uuid__, 'itemPrefab 没绑（列表会渲染成空白，且不报错）');
    const itemUuid = JSON.parse(readFileSync(`${ID_ROW_PREFAB}.meta`, 'utf8')).uuid;
    assert.equal(list.itemPrefab.__uuid__, itemUuid, 'itemPrefab 必须指向 ItemDetailRow.prefab');
    assert.equal(list.spacing, 17, 'FGUI list 的 lineGap=17');
    assert.equal(list.useVirtualList, true);

    // ⚠️ `content` 故意**不绑**（与 `Celebration/OSRank.prefab` 同一口径）：
    //   `VScrollView._getContentNode()` 会回落 `this.node.getChildByName('content')`
    //   —— **大小写敏感**，子节点叫 `Content` 就永远取不到（列表静默不滚、不渲染）。
    assert.equal(list.content, null, '按项目口径 content 不显式绑定；绑了也行，但这行会提醒你复核回落路径');
    assert.ok(rects.has('AccessList/content'), 'AccessList 下没有名为 `content`（全小写）的子节点 —— VScrollView 的回落取不到它');
    const content = rects.get('AccessList/content')!;
    const widget = compOf(prefab, content.id, 'cc.Widget');
    assert.ok(widget, 'content 上没有 cc.Widget —— 列表滚不起来');
    assert.equal(widget._alignFlags, 40, 'LEFT|RIGHT|TOP|BOTTOM 全贴');
});

test('物品 D7｜ItemDetailRow 469×70，含行底 Sprite + 文案 Label', () => {
    const prefab = loadPrefab(ID_ROW_PREFAB);
    const root = prefab[1];
    assert.equal(root._name, 'ItemDetailRow');
    const rects = collectRects(prefab);
    const r = rects.get('ItemDetailRow')!;
    assert.equal(+(r.r - r.l).toFixed(0), 469, 'FGUI 组件_角色_道具详情_项.xml 是 469×70');
    assert.equal(+(r.t - r.b).toFixed(0), 70);
    const bg = rects.get('Background');
    assert.ok(bg, '没有行底节点');
    assert.ok(compOf(prefab, bg.id, 'cc.Sprite'), '行底不是 Sprite');
    const label = rects.get('Label');
    assert.ok(label, '没有文案节点');
    assert.ok(compOf(prefab, label.id, 'cc.Label'));
    // 行底铺满整行
    assertRect(bg, r, 'Background');
});

test('物品 D8｜GetHeroEntry 每个节点的矩形 == FGUI `组件_主界面_领取武将.xml` 换算', () => {
    const rects = collectRects(loadPrefab(MT_PREFAB));
    const cases: [string, [number, number, number, number]][] = [
        ['Pic03',      [15, 78, 89, 34]],   // n2  jllq_pic03
        ['Pic04',      [3, 19, 139, 79]],   // n3  jllq_pic04
        ['Goods',      [-26, -28, 70, 70]], // com_goods pivot=0.5,0.5 xy(9,7)=中心 → 左上(-26,-28)，70×70
        ['Pic02',      [1, -17, 98, 54]],   // n4  jllq_pic02（故意高出上沿）
        ['EntryLabel', [7, -7, 75, 27]],    // n5「10级领取」
        ['ValueBg',    [19, 112, 80, 20]],  // n6  frame_02_3gong
        ['ValueLabel', [20, 108, 80, 26]],  // lab_value「(7/10)」
        ['RedDot',     [71, 20, 30, 30]],   // com_rd
    ];
    for (const [name, rect] of cases) {
        // ⚠️ 画布换算差异：本组是模块内嵌组件，参照系是 120×120 的组件框（原点左上）
        const expected = {
            l: rect[0] - 60,
            r: rect[0] + rect[2] - 60,
            b: 60 - (rect[1] + rect[3]),
            t: 60 - rect[1],
        };
        assertRect(rects.get(name), expected, name);
    }
});

test('物品 D9｜ArenaRoot 里的 GetHeroEntry 是**嵌套 prefab 实例** + `RIGHT|BOTTOM` Widget', () => {
    const prefab = loadPrefab(ARENA_PREFAB);
    // 找指向 GetHeroEntry.prefab 的那个 PrefabInfo
    const infoId = prefab.findIndex(
        (o) => o?.__type__ === 'cc.PrefabInfo' && o.asset?.__uuid__ === GET_HERO_PREFAB_UUID,
    );
    assert.ok(infoId > 0, 'ArenaRoot 里没有 GetHeroEntry 的嵌套实例');
    const info = prefab[infoId];
    const rootId = info.root.__id__;
    assert.equal(info.fileId, 'XplT2vExiVV2y8K452ndXp');
    assert.ok(info.instance?.__id__ >= 0, '不是实例化的（是原地展开的节点）—— 与 OSRankEntry 的做法不同，这里是有意的');

    // 位置：走 CCPropertyOverrideInfo（嵌套实例的节点本体不落盘）
    // ⚠️ 必须只取**本实例**的覆写名单 —— 文件里还有 LeftList/RightList 的两个实例，
    //    全表扫会拿到它们的 `_name` / `_lpos`（那才是典型的「看着对其实没验」）。
    const overrides = new Map<string, any>();
    for (const ref of prefab[info.instance.__id__].propertyOverrides ?? []) {
        const o = prefab[ref.__id__];
        overrides.set(o.propertyPath.join('.'), o.value);
    }
    assert.deepEqual([...overrides.keys()].sort(), ['_euler', '_lpos', '_lrot', '_name'],
        '本实例只该覆写名字 + 变换');
    assert.equal(overrides.get('_name'), 'GetHeroEntry');
    const pos = overrides.get('_lpos');
    assert.ok(pos, '没有位置覆写');
    assert.equal(pos.x, 263, '节点中心 x（视觉右边缘 345，与 OSRankEntry 同一条右边线）');
    assert.equal(pos.y, -196, '节点中心 y');
    assert.equal(prefab[rootId]._active, undefined, '实例根节点的 _active 由源 prefab 决定（规则 86），这里不该有覆写');

    // 🔴 规则 95：**嵌套实例根上不许外挂组件**。
    //
    //    `applyMountedComponents()` 的实现是
    //      `target.getWritableComponents().push(comp)`
    //    （引擎 `cocos/scene-graph/prefab/utils.ts:231`）——源 prefab 自带的
    //    `cc.UITransform` **已经在** `_components` 里，编辑器再挂一个就变成两个。
    //    2026-09-25 实测：给这个实例根加 `cc.Widget` 后，该节点上出现
    //    `[UITransform(源), 脚本, Widget, UITransform(挂载), Widget(挂载)]` 共 5 个组件。
    //    ⇒ `cc.Widget` 必须烘进 `GetHeroEntry.prefab` **自己的根节点**，
    //    实例这一侧一个挂载组件都不许有。
    const inst = prefab[info.instance.__id__];
    assert.deepEqual(inst.removedComponents, []);
    assert.deepEqual(inst.mountedComponents, [], '实例根上不许挂任何组件（否则 UITransform 会翻倍）');
    assert.deepEqual(inst.mountedChildren, [], '实例根上也不许挂子节点');

    // 反向守卫：`cc.Widget` 必须在**源 prefab**的根上，而不是靠实例挂载
    const src = loadPrefab(MT_PREFAB);
    const srcComps = (src[1]._components as Array<{ __id__: number }>).map((r) => src[r.__id__]);
    assert.equal(srcComps.length, 3, '源 prefab 根：UITransform + GetHeroEntry 脚本 + Widget');
    assert.equal(srcComps[0].__type__, 'cc.UITransform');
    assert.equal(srcComps[1].__type__, 'b9dcfjMNeRBarPItmRKHgwT', '中间是 GetHeroEntry 脚本');
    assert.equal(srcComps[2].__type__, 'cc.Widget');
    assert.equal(
        srcComps.filter((c) => c.__type__ === 'cc.UITransform').length,
        1,
        '源 prefab 根只能有 1 个 cc.UITransform',
    );
    const widget = srcComps[2];
    assert.equal(widget._alignFlags, 36, '36 = BOT(4) + RIGHT(32)，与 ChatEntry / OSRankEntry 同一口径');
    assert.equal(widget._right, 37);
    assert.equal(widget._bottom, 384);
    assert.equal(widget._alignMode, 2, 'ON_WINDOW_RESIZE（与既有两个 HUD 一致）');

    // `_lpos` 是**覆写**（源 prefab 里是 0,0），运行期由上面那个 Widget 接管
    assert.deepEqual(src[1]._lpos, { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, '源 prefab 不写死屏幕坐标');
});

test('物品 D10｜ArenaRoot 的 GetHeroEntry 与既有 HUD **不重叠**（右侧一列）', () => {
    const prefab = loadPrefab(ARENA_PREFAB);
    const rects = collectRects(prefab);
    // 既有右列 HUD（普通节点，直接可读）
    const osRank = rects.get('OSRankEntry')!;
    // 新 HUD：节点 120×120；视觉外扩（FGUI 子节点超出组件框）
    const cx = 263;
    const cy = -196;
    const visual = { l: cx - 60, r: cx + 82, b: cy - 74, t: cy + 77 };
    assert.ok(Math.abs(visual.r - osRank.r) <= 1, `视觉右边缘应贴同一列：${visual.r} vs ${osRank.r}`);
    assert.ok(visual.b > osRank.t + 4, `与 OSRankEntry 至少留 4px：视觉底 ${visual.b}，OSRank 顶 ${osRank.t}`);
    const rightList = rects.get('EntranceLayer/RightList')!;
    assert.ok(visual.t < rightList.b - 8, `不能顶到右上入口列：视觉顶 ${visual.t}，RightList 底 ${rightList.b}`);
    // 也不能压到左下角的 HangEntry
    const hang = rects.get('HangEntry')!;
    assert.ok(visual.l > hang.r, '与左下角 HangEntry 分居两侧');
});

// ============================================================
// E. 视图脚本接线（源码文本）
// ============================================================

const HUD_PREFAB = loadPrefab(MT_PREFAB);
const ID_PREFAB_OBJ = loadPrefab(ID_PREFAB);

test('物品 E1｜三个按钮走「有 `cc.Button` 用 CLICK，否则 TOUCH_END」分流（规则 81b）', () => {
    assert.ok(/getComponent\(Button\)/.test(PAGE_SRC), 'bindButton 没有做 Button 存在性判定');
    assert.ok(/Button\.EventType\.CLICK/.test(PAGE_SRC));
    assert.ok(/Node\.EventType\.TOUCH_END/.test(PAGE_SRC));

    // 反向守卫：prefab 里凡是被 `Button.EventType.CLICK` 绑的节点，必须真有 cc.Button。
    // 三个按钮在 prefab 上都挂了 cc.Button ⇒ 走 CLICK 是对的。
    const rects = collectRects(ID_PREFAB_OBJ);
    for (const name of ['BtnGo', 'BtnGo1', 'BtnCompos']) {
        assert.ok(
            compOf(ID_PREFAB_OBJ, rects.get(name)!.id, 'cc.Button'),
            `${name} 没有 cc.Button —— bindButton 会退化成 TOUCH_END（灰态也能点）`,
        );
    }
    // `GoodsBox` 自己监听 TOUCH_END：它上面**没有** cc.Button，写 CLICK 就是死按钮
    const goodsRect = rects.get('Goods')!;
    assert.equal(compOf(ID_PREFAB_OBJ, goodsRect.id, 'cc.Button'), null, 'Goods 上不该有 cc.Button');
    assert.ok(/Node\.EventType\.TOUCH_END/.test(BOX_SRC), 'GoodsBox 必须用 TOUCH_END');
    // ⚠️ 判断「有没有真的绑 CLICK」必须先剥注释 —— 这两个文件的注释里都**故意**写了
    //   `Button.EventType.CLICK` 来解释「为什么不能用它」，直接正则搜源码会把自己吓到。
    assert.ok(!/Button\.EventType\.CLICK/.test(stripComments(BOX_SRC)),
        'GoodsBox 的**代码**里出现 CLICK 就是死按钮（节点上没有 cc.Button）');
    assert.ok(!/Button\.EventType\.CLICK/.test(stripComments(ROW_SRC)),
        'ItemDetailRow 不该绑任何点击（跳转由列表统一处理）');
});

test('物品 E2｜`onDestroy` 里不写 off（规则 71：会中断销毁链）', () => {
    for (const [name, src] of [['GoodsBox', BOX_SRC], ['GetHeroEntry', HUD_SRC]] as const) {
        const body = stripComments(src);
        assert.ok(body.indexOf('.off(') < 0, name + ' 里出现了 .off( —— 见规则 71（组件按 _components 序析构，Component.node 已置 null）');
    }
});

test('物品 E3｜`GoodsBox.render` 的 `spriteFrame` 是**无条件写**（规则 82）', () => {
    const body = stripComments(BOX_SRC);
    assert.ok(/this\.frame\.spriteFrame = qualityFrame \?\? this\.defaultFrame;/.test(body),
        '品质框必须「有回退值的无条件赋值」—— 条件式赋值会让上一格的品质颜色留下来');
    assert.ok(/this\.icon\.node\.active = iconFrame != null;/.test(body));
    assert.ok(/this\.num\.string = numberText;/.test(body));
    assert.ok(/this\.num\.node\.active = showNumber && numberText\.length > 0;/.test(body));
    assert.ok(/this\.defaultFrame = this\.frame\?\.spriteFrame \?\? null;/.test(body),
        'onLoad 里要先把 prefab 的静态帧记下来');
});

test('物品 E4｜`ItemDetailPage` 缎带与四个按钮也是无条件写', () => {
    const body = stripComments(PAGE_SRC);
    assert.ok(/this\.titleBg\.spriteFrame = this\.frames\.title \?\? this\.defaultTitleFrame;/.test(body),
        '缎带必须有回退值 —— 它是品质的**颜色**语义');
    assert.ok(/this\.defaultTitleFrame = this\.titleBg\?\.spriteFrame \?\? null;/.test(body));
    assert.ok(/this\.nameText\.string = row && row\.name \? row\.name : texts\.unknownName;/.test(body));
    assert.ok(/this\.setActive\(this\.btnGo1, buttons\.showGo1\);/.test(body));
    assert.ok(/this\.setActive\(this\.btnCompos, buttons\.showCompos\);/.test(body));
});

test('物品 E5｜`renderItemFn` / `onItemClickFn` **只绑一次**，数据按 index 现取（规则 55）', () => {
    const body = stripComments(PAGE_SRC);
    assert.ok(/if \(!this\.accessRendererBound\)/.test(body), '没有只绑一次的守卫 —— 每次 refresh 重绑会叠加监听');
    assert.ok(/list\.renderItemFn = \(node, index\) => this\.renderAccessRow\(node, index\);/.test(body),
        'renderItemFn 必须转发到按 index 现取的方法，不能闭包捕获 snapshot');
    assert.ok(/list\.onItemClickFn = \(_node, index\) => this\.onAccessClick\(index\);/.test(body));
    assert.ok(/const ref = this\.accessRefs\[index\];/.test(body), '行渲染必须现取 this.accessRefs[index]');
    // 槽位的点击回调也必须现取（不能闭包捕获 resId）
    assert.ok(/slot\.onClick = \(\) => this\.openItemDetail\(this\.contentResIds\[index\]\);/.test(body),
        '内容槽位的回调必须按 index 现取，捕获 resId 会让点第 3 格开第 1 格的物品');
});

test('物品 E6｜`openItemDetail` 必须 `allowMultiple: true`（否则点内容格子什么都不发生）', () => {
    const body = stripComments(PAGE_SRC);
    const m = body.match(/ItemDetailPage\.open\(\{[\s\S]*?\}\)/);
    assert.ok(m, '找不到 openItemDetail 里的 open 调用');
    assert.ok(/allowMultiple:\s*true/.test(m[0]), 'PopupManager 默认「同类已打开则复用」，不放开就等于点了没反应');
});

test('物品 E7｜`jumpTo` 只提示「未接入」，不假装跳成功', () => {
    const body = stripComments(PAGE_SRC);
    const m = body.match(/private jumpTo\([\s\S]*?\n {4}\}/);
    assert.ok(m, '找不到 jumpTo');
    assert.ok(/Toast\.show\(ITEM_DETAIL_TEXTS\.jumpNotWired\)/.test(m[0]), '跳转未接线时必须给可见反馈（静默无反应会让联调分不清病因）');
    assert.ok(/console\.log/.test(m[0]), '同时要留一条日志（带上 id）');
});

test('物品 E8｜`GetHeroEntry` 不在 `onEnable` 里 refresh（会与 `applySnapshot` 互相触发）', () => {
    const body = stripComments(HUD_SRC);
    assert.ok(!/onEnable/.test(body), '组件自己写 node.active ⇒ 禁在 onEnable 里再 refresh');
    assert.ok(/protected onLoad\(\): void \{[\s\S]*?void this\.refresh\(\);/.test(body), 'onLoad 里必须自刷一次');
    assert.ok(/this\.node\.active = snapshot\.visible;/.test(body), '显隐必须无条件写（规则 82/86）');
    assert.ok(/this\.goods\?\.render\(this\.qualityFrame, this\.iconFrame, '', false\);/.test(body),
        'HUD 的奖励格不显示数量（老端 com_hero.UpdateByGoods 不带数量）');
    assert.ok(/this\.goods\.onClick = \(\) => \{ void this\.onGoodsClick\(\); \};/.test(body),
        '物品框的点击回调由宿主铺一次');
});

test('物品 E9｜`busy` 防连点 + 三态结果分开提示', () => {
    const body = stripComments(HUD_SRC);
    assert.ok(/if \(!snapshot \|\| this\.busy\) return;/.test(body), '领奖必须防连点');
    assert.ok(/result === 'offline' \? texts\.offlineWarn : texts\.claimFailed/.test(body),
        '「一个包都没发」和「服务端拒了」必须给不同提示');
    assert.ok(/finally \{\s*this\.busy = false;/.test(body), 'busy 必须在 finally 里放掉（异常路径也要放）');
});

test('物品 E10｜页面脚本里的 `Label.string` 只喂文案常量，不写字面量', () => {
    for (const file of [
        'assets/script/app/itemdetail/ItemDetailPage.ts',
        'assets/script/app/itemdetail/GoodsBox.ts',
        'assets/script/app/itemdetail/ItemDetailRow.ts',
        'assets/script/app/maintask/GetHeroEntry.ts',
    ]) {
        const body = stripComments(readFileSync(file, 'utf8'));
        const assigns = body.match(/\.string\s*=\s*[^;]+;/g) ?? [];
        assert.ok(assigns.length > 0, `${file} 里没有 Label.string 赋值？是不是改了写法`);
        for (const a of assigns) {
            assert.ok(!CJK.test(a), `${file} 里把中文写进了 Label：${a}`);
        }
    }
});

test('物品 E11｜产物脚本 `setRepository` 存在（单测/探针的注入点）', () => {
    assert.ok(/setRepository\(repository: IItemDetailRepository\)/.test(PAGE_SRC));
    assert.ok(/setRepository\(repository: IMainTaskRepository\)/.test(HUD_SRC));
});

// ============================================================
// F. 文案
// ============================================================

test('物品 F1｜物品详情文案与 FGUI XML 的 `text="…"` 逐字一致', () => {
    const t = ITEM_DETAIL_TEXTS;
    assert.equal(t.qualityLabel, '品质:');
    assert.equal(t.countLabel, '数量:');
    assert.equal(t.descTitle, '道具说明');
    assert.equal(t.contentTitle, '内容');
    assert.equal(t.accessTitle, '获取途径');
    assert.equal(t.goBtn, '前往');
    assert.equal(t.goBtn1, '前往');
    assert.equal(t.composBtn, '合成');
    assert.equal(t.noAccess, '暂无获取途径');
    assert.ok(t.jumpNotWired.length > 0);
    assert.ok(t.composNotWired.length > 0);
    // 兜底文案不许为空（空串会让界面留白且不报错）
    for (const [key, value] of Object.entries(t)) {
        assert.ok(typeof value === 'string' && value.length > 0, `ITEM_DETAIL_TEXTS.${key} 是空的`);
    }
});

test('物品 F2｜「10级领取」文案 + offlineWarn 必须与 claimFailed 区分', () => {
    const t = GET_HERO_TEXTS;
    assert.equal(t.entryLabel, '10级领取');
    assert.equal(t.progress, '({0}/{1})');
    assert.equal(t.claimed, '领取成功');
    assert.equal(t.claimFailed, '领取失败');
    assert.equal(t.offlineWarn, '尚未连接服务器');
    assert.notEqual(t.offlineWarn, t.claimFailed, '未连接 ≠ 服务端拒绝');
    for (const [key, value] of Object.entries(t)) {
        assert.ok(typeof value === 'string' && value.length > 0, `GET_HERO_TEXTS.${key} 是空的`);
    }
});

test('物品 F3｜`formatText` 顺序替换', () => {
    assert.equal(formatText('({0}/{1})', 7, 10), '(7/10)');
    assert.equal(formatText('a{0}b{1}c{0}', 'X', 'Y'), 'aXbYcX');
    assert.equal(formatText('没有占位符', 1), '没有占位符');
});

// ============================================================
// G. 数据接线（源码文本）—— 判定逻辑与「数据源」必须真的连上
// ============================================================

test('物品 G1｜Repository 走的是真缓存与新协议（不是占位实现）', () => {
    const mt = stripComments(readFileSync('assets/script/app/maintask/MainTaskRepository.ts', 'utf8'));
    assert.ok(/getTlCmdTask\(/.test(mt), '必须读 CmdTask 缓存');
    assert.ok(/getRefAllAsync\('taskMain'\)|'taskMain'/.test(mt), '必须读 taskMain 表');
    assert.ok(/RequestTakeMainTaskReward/.test(mt), '领奖必须发真协议');
    assert.ok(/GameNet/.test(mt) && /isConnected/.test(mt), '离线必须早退（否则要等超时 5s 才报错）');
    assert.ok(/withTimeout/.test(mt), '写请求必须带超时');

    const id = stripComments(readFileSync('assets/script/app/itemdetail/ItemDetailRepository.ts', 'utf8'));
    for (const table of ['item', 'viewtype', 'itemCraft']) {
        assert.ok(id.includes(`'${table}'`), `ItemDetailRepository 没读 ${table} 表`);
    }
    assert.ok(/accessRefsOf/.test(id), '途径必须走「文案 + id 成对」的转换');
    assert.ok(/qualityNameOf/.test(id) || /readQualityNameCsv/.test(id), '品质名要走 gameConfig.qualityname');
});

test('物品 G2｜领奖协议在**三份产物**里都登记了（规则 40：少一份就静默发不出去）', () => {
    const decl = readFileSync('assets/script/app/generated/netProto/Cmd.d.ts', 'utf8');
    assert.ok(/CmdTakeMainTaskRewardReqMsg/.test(decl), 'Cmd.d.ts 里没有 CmdTakeMainTaskRewardReqMsg');
    assert.ok(/CmdTakeMainTaskRewardRspMsg/.test(decl), 'Cmd.d.ts 里没有对应的 RspMsg（不代表 MessageId 登记了）');

    // ① protoCompiled.json：真源在 `nested.com.xkhy.tafang.cmd.MessageId.values`
    //    ⚠️ 别用 `proto.nested.cmd` 猜路径 —— 全文档里有好几个叫 MessageId 的节点，
    //       必须取**条目最多**的那个（真正的 MessageId 枚举有几百条）。
    const proto = JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8'));
    const values = biggestMessageIdValues(proto);
    assert.ok(values, 'protoCompiled.json 里找不到 MessageId.values');
    assert.equal(values!.CmdTakeMainTaskRewardRspMsg, 189258127,
        'MessageId 里的号与实测登记值不一致（老端是 189258127）');
    assert.ok(Object.keys(values!).length > 100, `MessageId 只找到 ${Object.keys(values!).length} 条 —— 取错了节点`);

    // ② 运行时真用的 static 模块（`build_proto.bat` **不产**它）—— 规则 40 最贵的那条
    const stat = readFileSync('assets/script/lib/protobuf/protoCompiledStatic.ts', 'utf8');
    assert.ok(
        stat.includes('valuesById[189258127] = "CmdTakeMainTaskRewardRspMsg"'),
        'protoCompiledStatic.ts 里没登记 189258127 ⇒ 运行时 getMessageId 返回 undefined，包发不出去（规则 40）',
    );
    // ③ `*ReqMsg` 是客户端→服务端，必须能按名字查到号（否则 `sendMsg` 拿不到 id）
    assert.ok(/CmdTakeMainTaskRewardRspMsg/.test(stat), 'static 里没有 Rsp 名字 ⇒ decodeDataById 查不到回包');
});

test('物品 G3｜`item` 表口径对得上（389 行 / itemBox 最长 3 —— 「内容」固定 3 槽的依据）', () => {
    const rows = decodeTable('assets/remoteRef/item.json');
    assert.ok(rows.length > 300, `item 表才 ${rows.length} 行？`);
    assert.ok(rows.some((r) => Array.isArray(r.access) && r.access.length > 0), 'item 表里没有一行有 access —— 「获取途径」永远空态');
    const maxBox = rows.reduce((m: number, r: any) => Math.max(m, Array.isArray(r.itemBox) ? r.itemBox.length : 0), 0);
    assert.equal(maxBox, 3, `itemBox 最长 ${maxBox} ≠ 3 —— 单测 D4 的「固定 3 槽」假设失效了，prefab 要跟着改`);
    // 主键是 `resId`（不是 `id`）—— `assets/resources/config/item.json` 是另一张旧表（键是 id、没有 access），别拿错
    assert.ok(typeof rows[0].resId === 'number' && rows[0].id === undefined, 'item 表主键应当是 resId');
});

test('物品 G4｜「10级领取」那一行真在 taskMain 表里（resId / count / 奖励对齐）', () => {
    const parsed = parseMainTaskRows(decodeTable('assets/remoteRef/taskMain.json'));
    const hero = pickHeroTaskRow(parsed);
    assert.ok(hero, 'taskMain 表里没有 targetType = 99 的行');
    assert.equal(hero!.resId, 500099);
    assert.equal(hero!.maxCount, 10, '角标文案「10级领取」的 10');
    assert.equal(hero!.name, '10级获取英雄');
    assert.equal(hero!.reward.length, 1);
    assert.equal(hero!.reward[0].resId, 18014);
    // 只准有一行 99（多行说明策划改了语义 ⇒ 角标取谁就没人知道）
    const count99 = [...parsed.values()].filter((r) => r.targetType === MAIN_TASK_HERO_TARGET_TYPE).length;
    assert.equal(count99, 1, `taskMain 里有 ${count99} 行 targetType = 99 —— 「唯一那行」的假设失效`);
    assert.ok(hero!.maxCount > 0, '上限为 0 会让进度恒 `(0/0)` 且永远不可能 FINISH');
});

test('物品 G5｜奖励物 18014 在 item 表里有名字 / 品质 / 图标，且图标文件真在盘上', () => {
    const items = parseItemRows(decodeTable('assets/remoteRef/item.json'));
    const reward = items.get(18014);
    assert.ok(reward, 'item 表里没有 18014（HUD 会显示成空框）');
    assert.ok(reward!.name.length > 0, '18014 没名字');
    assert.equal(reward!.name, '猎头者');
    assert.ok(truthy(reward!.quality), '18014 没品质 → 品质框会落到第 1 档');
    assert.ok(reward!.icon.length > 0, '18014 没有 icon');
    // `icon` 是**相对 assets/resources/** 的路径，漏了只会静默留白
    assert.ok(
        existsSync(`assets/resources/${reward!.icon}.png`),
        `18014 的 icon 文件不存在：assets/resources/${reward!.icon}.png`,
    );
    // 途径表也要有：18014 的 access 里 8 = 商店（viewtype）
    const viewTypes = parseViewTypeRows(decodeTable('assets/remoteRef/viewtype.json'));
    assert.ok(reward!.access.length > 0, '18014 没有 access');
    const texts = accessTextsOf(viewTypes, reward!.access);
    assert.equal(texts.length, reward!.access.length, 'viewtype 表里应当每条 access 都能查到文案');
    assert.ok(texts.includes('商店'), `18014 的途径文案里应当有「商店」，实际 ${JSON.stringify(texts)}`);
});

test('物品 G6｜HUD 的图与物品详情**同源**（同一份缓存，不开第二套）', () => {
    const art = readFileSync('assets/script/app/maintask/MainTaskArt.ts', 'utf8');
    assert.ok(/ItemDetailArtLoader\.loadIdArtByRel|同源/.test(art), 'MainTaskArt 的注释里应当说明与 ItemDetail 同源');
    const hud = stripComments(HUD_SRC);
    assert.ok(/loadQualityFrameArt\(/.test(hud) && /loadItemIconArt\(/.test(hud));
    assert.ok(!/resources\.load\(/.test(hud), 'HUD 不该自己 resources.load —— 图必须走 ItemDetailArtLoader 的缓存（规则 81）');
});
