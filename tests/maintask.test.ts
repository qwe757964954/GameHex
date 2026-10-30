/**
 * 主线任务详情弹窗（老端 `LayerMainTaskDetail`）+ 主界面「主线任务」入口
 * （老端 `组件_战斗_章节选择` 里的 `组件_主线任务`）的单测。
 *
 * ## 盯住哪七类东西（按「错了会不会报错」排序）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `MainTaskTable.pickFirstTaskRow` 选行判定（零 `cc`） | 静默 —— 选中「10级领取」那条 / 选中已领完的 / 顺序按 `resId` 而不是 `preResId` |
 * | B | 文案拼接（`{count}` 替换、详情 vs 入口的间距与换行） | 静默 —— 标题少一个空格 / 入口挤成一行 |
 * | C | 美术资源存在性 + 九宫名单 ↔ `.meta` border 双向对账 | 静默留白 / 九宫图按 SIMPLE 画 ⇒ 拉伸变形 |
 * | D | prefab 结构 + 几何对 **FGUI 原稿**反解 | 静默 —— 弹窗底图只有 260 高、按钮文字偏右、奖励格不居中 |
 * | E | 视图脚本接线（源码文本） | 静默 —— 死按钮（`CLICK` 绑在无 `Button` 的节点上）、闭包捕获旧数据、点「前往」把窗关了 |
 * | F | 文案（唯一出口 + 与 FGUI `title` 逐字一致） | 有人「顺手修正」就与设计稿分叉 |
 * | G | `ArenaRoot` 上的嵌套实例（子序守卫 + **源 prefab** 里的 `cc.Widget`） | 静默 —— HUD 跑到屏幕外 / 不随分辨率贴边 / 顶掉 `HangEntry` 的「最后一个子节点」守卫 |
 *
 * ## 为什么能直接 `import` 这些源码
 *
 * `MainTaskTable` / `MainTaskTexts` / `MainTaskArt` 的 import 链上**没有 `cc`**。
 * ⚠️ `MainTaskRepository` / `MainTaskDetailPage` / `MainTaskEntry` / `GoodsBox`
 * **都带 `cc`** ⇒ 本文件**不** import 它们（相关约束走 E 组的源码文本断言）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    CMD_COMMON_STATE,
    EMPTY_TASK_STATE,
    MAIN_TASK_HERO_TARGET_TYPE,
    canClaimOf,
    pickFirstTaskRow,
    taskDetailTitleOf,
    taskEntryLabelOf,
    taskTitleOf,
} from '../assets/script/app/maintask/MainTaskTable';
import type { IMainTaskRow, IMainTaskState } from '../assets/script/app/maintask/MainTaskTable';
import { GET_HERO_TEXTS, MAIN_TASK_TEXTS } from '../assets/script/app/maintask/MainTaskTexts';
import { MT_ART_NAMES, MT_ART_SLICED, MT_ART_TILED } from '../assets/script/app/maintask/MainTaskArt';
import { assetExists, assetPath } from './helpers/asset-paths';

// ============================================================
// 公共小工具
// ============================================================

/** 画布尺寸（`组件_战斗_主线任务详情.xml` 声明 720×1280，与工程一致）。 */
const CANVAS_W = 720;
const CANVAS_H = 1280;

const DETAIL_PREFAB = assetPath('ui/MainTask/MainTaskDetail.prefab');
const ENTRY_PREFAB = assetPath('ui/MainTask/MainTaskEntry.prefab');
const ARENA_PREFAB = assetPath('ui/main/ArenaRoot.prefab');

const DETAIL_SRC = readFileSync('assets/script/app/maintask/MainTaskDetailPage.ts', 'utf8');
const ENTRY_SRC = readFileSync('assets/script/app/maintask/MainTaskEntry.ts', 'utf8');

/** prefab 的 uuid —— 从 `.meta` 读，不硬编码（改名 / 重新生成都不会静默失配）。 */
function prefabUuid(path: string): string {
    return (JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { uuid: string }).uuid;
}

function loadPrefab(path: string): any[] {
    return JSON.parse(readFileSync(path, 'utf8')) as any[];
}

function byId(o: any[], id: number): any {
    return o[id];
}

/** 取节点上的某类组件对象（返回**第一个**匹配）。 */
function compOf(prefab: any[], nodeId: number, type: string): any | null {
    for (const c of prefab[nodeId]._components ?? []) {
        const comp = byId(prefab, c.__id__);
        if (comp?.__type__ === type) return comp;
    }
    return null;
}

/** 节点上挂的脚本 cid 列表（23 位、非 `cc.` 开头）。 */
function scriptTypes(prefab: any[], nodeId: number): string[] {
    const out: string[] = [];
    for (const c of prefab[nodeId]._components ?? []) {
        const t = byId(prefab, c.__id__)?.__type__;
        if (typeof t === 'string' && t.length === 23 && !t.startsWith('cc.')) out.push(t);
    }
    return out;
}

/** 某节点上某个 cid 的脚本组件对象。 */
function scriptOf(prefab: any[], nodeId: number, cid: string): any | null {
    for (const c of prefab[nodeId]._components ?? []) {
        const comp = byId(prefab, c.__id__);
        if (comp?.__type__ === cid) return comp;
    }
    return null;
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
 * ⚠️ key 是**相对根的路径**（`BtnGo`、`BtnGo/GoLabel`）：物品详情那轮就吃过亏 ——
 * 有 4 个叫 `Frame` 的节点，用裸名字会互相覆盖，断言全打在最后一个上（静默假绿）。
 *
 * ⚠️ 不做缩放补偿：本工程的生成器把缩放**烘进尺寸**（`DecoBar` 直接用 444×48，
 * 而不是 233×31 + `scale=1.5`），所以沿途 `scale` 恒 1。
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

/**
 * FGUI 画布矩形（`x,y,w,h`，**y 向下**、原点左上）→ Cocos 节点局部矩形。
 * 换算依据：画布中心 `(360,640)` 对应本工程的 `(0,0)`，y 轴翻转。
 *
 * ⚠️ 只对**偶数边长**的页面级 prefab（720×1280）精确：奇宽（`MainTaskEntry` 的 231×84）
 * 会在「中心 = 115.5」上留半像素，所以那一组改用**相对偏移**断言（见 G/D2）。
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

/** 剥掉注释（E 组要判「代码里有没有中文字面量」，注释里当然有中文）。 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/([^:'"\\])\/\/[^\n]*$/gm, '$1')
        // `@property({ tooltip: '…' })` 是**字符串**不是注释，但它是给人看的说明、不是展示文案，
        // 不该被 E11 判成「视图里写死了中文」。
        .replace(/tooltip:\s*'[^']*'/g, "tooltip: ''");
}

/**
 * 取一个类方法的源码体（从 `name(` 那行起，到**同缩进**的 `}` 结束）。
 *
 * ⚠️ 修饰符之间可以有空格（`private async claim()`），`\w*` 那种写法会漏掉带 `async` 的方法。
 */
function methodBody(src: string, name: string): string {
    const mods = '(?:private |protected |public )?(?:static )?(?:async )?';
    const start = src.search(new RegExp(`\\n\\s*${mods}${name}\\s*\\(`));
    assert.ok(start >= 0, `源码里找不到方法 ${name}`);
    const from = src.slice(start);
    const end = from.search(/\n {4}\}/);
    return end >= 0 ? from.slice(0, end) : from;
}

// ============================================================
// 夹具：造表行 / 缓存状态
// ============================================================

function rowOf(over: Partial<IMainTaskRow> & { resId: number }): IMainTaskRow {
    return {
        preResId: 0,
        targetType: 8,
        maxCount: 10,
        reward: [{ resId: 200, number: 7 }],
        name: '累计讨伐精英{count}个',
        goto: 0,
        ...over,
    };
}

function mapOf(rows: readonly IMainTaskRow[]): Map<number, IMainTaskRow> {
    return new Map(rows.map((r) => [r.resId, r]));
}

function stateOf(count: number, rewardState: number): IMainTaskState {
    return { count, rewardState };
}

/** 全部候选（含「10级领取」与非候选）的一个通用表。 */
const ROWS = mapOf([
    rowOf({ resId: 500004, preResId: 3, targetType: 20, name: '升到{count}级', maxCount: 12 }),
    rowOf({ resId: 500001, preResId: 1, targetType: 8, name: '升到{count}级', maxCount: 2 }),
    rowOf({ resId: 500002, preResId: 2, targetType: 6, name: '通关{count}次', maxCount: 5 }),
    rowOf({ resId: 990001, preResId: 0, targetType: MAIN_TASK_HERO_TARGET_TYPE, name: '10级领取', maxCount: 10 }),
]);

// ============================================================
// A 组：选行判定（零 cc）
// ============================================================

test('A1 排除 targetType = 99（那是「10级领取」那条独立支线）', () => {
    const states = new Map<number, IMainTaskState>([
        [990001, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        [500001, stateOf(0, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick = pickFirstTaskRow(ROWS, states);
    assert.ok(pick, '应当选出一条');
    assert.notEqual(pick.row.targetType, MAIN_TASK_HERO_TARGET_TYPE, '不能选到 99 那条');
    assert.equal(pick.row.resId, 500001, '99 的 preResId 最小，若没排除就会选它');
});

test('A2 只认 UNDONE / FINISH —— REWARDED（已领）跳过、继续往后找', () => {
    const states = new Map<number, IMainTaskState>([
        [500001, stateOf(2, CMD_COMMON_STATE.REWARDED)],
        [500002, stateOf(0, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick = pickFirstTaskRow(ROWS, states);
    assert.ok(pick);
    assert.equal(pick.row.resId, 500002, '500001 已领完 ⇒ 应顺延到 500002');
});

test('A3 顺序按 preResId 升序（不是 resId）', () => {
    const states = new Map<number, IMainTaskState>([
        [500001, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        [500002, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        [500004, stateOf(0, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick = pickFirstTaskRow(ROWS, states);
    assert.ok(pick);
    // resId 升序会给出 500001；preResId 升序也是 500001 ⇒ 为了真的区分两者，
    // 用一组「preResId 与 resId 相反」的夹具再验一次。
    const rows = mapOf([
        rowOf({ resId: 100, preResId: 9 }),
        rowOf({ resId: 900, preResId: 1 }),
    ]);
    const states2 = new Map<number, IMainTaskState>([
        [100, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        [900, stateOf(0, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick2 = pickFirstTaskRow(rows, states2);
    assert.ok(pick2);
    assert.equal(pick2.row.resId, 900, 'preResId=1 的那条在前（resId=100 的 preResId=9 更靠后）');
});

test('A4 preResId 打平时按 resId 升序 tie-break（不靠 Map 迭代序）', () => {
    const rows = mapOf([
        rowOf({ resId: 700, preResId: 5 }),
        rowOf({ resId: 300, preResId: 5 }),
    ]);
    const states = new Map<number, IMainTaskState>([
        [700, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        [300, stateOf(0, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick = pickFirstTaskRow(rows, states);
    assert.ok(pick);
    assert.equal(pick.row.resId, 300, '打平时取 resId 小的');
});

test('A5 缓存里没有的行直接跳过（老端会对 null 调 GetRef() 崩）', () => {
    const states = new Map<number, IMainTaskState>([
        // 只给 500002 一行缓存；500001 / 500004 没有
        [500002, stateOf(1, CMD_COMMON_STATE.FINISH)],
    ]);
    const pick = pickFirstTaskRow(ROWS, states);
    assert.ok(pick, '有缓存行的那条要能选出来');
    assert.equal(pick.row.resId, 500002);
});

test('A6 一条候选都没有 ⇒ null（缓存全空 / 全领完 / 表为空）', () => {
    assert.equal(pickFirstTaskRow(ROWS, new Map()), null, '缓存全空');
    assert.equal(
        pickFirstTaskRow(ROWS, new Map([
            [500001, stateOf(2, CMD_COMMON_STATE.REWARDED)],
            [500002, stateOf(5, CMD_COMMON_STATE.REWARDED)],
            [500004, stateOf(12, CMD_COMMON_STATE.REWARDED)],
            [990001, stateOf(0, CMD_COMMON_STATE.UNDONE)],
        ])),
        null,
        '常规任务全领完 + 只剩 99 那条 ⇒ null',
    );
    assert.equal(pickFirstTaskRow(new Map(), new Map()), null, '表为空');
});

test('A7 返回的 row 与 state 是同一对（不能错配到别人身上）', () => {
    const states = new Map<number, IMainTaskState>([
        [500001, stateOf(1, CMD_COMMON_STATE.FINISH)],
        [500002, stateOf(4, CMD_COMMON_STATE.UNDONE)],
    ]);
    const pick = pickFirstTaskRow(ROWS, states);
    assert.ok(pick);
    assert.equal(pick.row.resId, 500001);
    assert.equal(pick.state.count, 1, '拿走的是 500001 的 count，不是 500002 的 4');
    assert.ok(canClaimOf(pick.state.rewardState), 'FINISH ⇒ canClaim');
});

test('A8 夹具自检：EMPTY_TASK_STATE 是 UNDONE 且 count=0', () => {
    assert.equal(EMPTY_TASK_STATE.count, 0);
    assert.equal(EMPTY_TASK_STATE.rewardState, CMD_COMMON_STATE.UNDONE);
    assert.equal(CMD_COMMON_STATE.UNDONE, 0);
    assert.equal(CMD_COMMON_STATE.FINISH, 1);
    assert.equal(CMD_COMMON_STATE.REWARDED, 2);
});

// ============================================================
// B 组：文案拼接
// ============================================================

test('B1 taskTitleOf 把 {count} 替换成进度上限（不是当前进度）', () => {
    const row = rowOf({ resId: 1, name: '升到{count}级', maxCount: 12 });
    assert.equal(taskTitleOf(row), '升到12级', '占位值 = param.count（上限）');
    const noPlaceholder = rowOf({ resId: 1, name: '累计讨伐精英10个', maxCount: 12 });
    assert.equal(taskTitleOf(noPlaceholder), '累计讨伐精英10个', '没有占位符时原样输出');
});

test('B2 taskTitleOf 只替换第一处占位（与老端 String.replace(string) 同口径）', () => {
    const row = rowOf({ resId: 1, name: '{count}个{count}', maxCount: 3 });
    assert.equal(taskTitleOf(row), '3个{count}', '`String.replace` 传字符串只换第一处');
});

test('B3 详情标题：`title (x/y)` —— **带一个空格**', () => {
    const row = rowOf({ resId: 1, name: '累计讨伐精英{count}个', maxCount: 10 });
    const state = stateOf(0, CMD_COMMON_STATE.UNDONE);
    const text = taskDetailTitleOf(row, state);
    assert.equal(text, '累计讨伐精英10个 (0/10)');
    // 老端 `LayerMainTaskDetailUI.initView()`：`${vo.GetTitle()} (${vo.GetValue()}/${vo.GetMaxValue()})`
    // ⚠️ FGUI 原稿里那段设计期占位 `玩家等级打到10级(9/10)` 是**没空格**的 —— 别照抄原稿。
    assert.ok(text.includes('个 ('), '任务名与括号之间必须有空格');
    assert.ok(!text.includes('\n'), '详情标题是一行');
});

test('B4 入口文案：`title\\n(x/y)` —— **两行**', () => {
    const row = rowOf({ resId: 1, name: '累计击败精英5个', maxCount: 5 });
    const state = stateOf(0, CMD_COMMON_STATE.UNDONE);
    assert.equal(taskEntryLabelOf(row, state), '累计击败精英5个\n(0/5)');
    // FGUI `lab_task` 的 `size="130,59"` 正是两行高（22 号字 × 2 + leading）
    assert.equal(taskEntryLabelOf(row, state).split('\n').length, 2);
});

test('B5 详情 / 入口用的是同一份进度与上限（只有换行不同）', () => {
    const row = rowOf({ resId: 1, name: '升到{count}级', maxCount: 12 });
    const state = stateOf(7, CMD_COMMON_STATE.UNDONE);
    const detail = taskDetailTitleOf(row, state);
    const entry = taskEntryLabelOf(row, state);
    assert.equal(detail, '升到12级 (7/12)');
    assert.equal(entry, '升到12级\n(7/12)');
    assert.equal(detail.replace(' (', '\n('), entry, '两者只差「空格 → 换行」');
});

// ============================================================
// C 组：美术
// ============================================================

test('C1 MT_ART_NAMES 每个 key 都在磁盘上（相对 assets/resources/image）', () => {
    const keys = Object.keys(MT_ART_NAMES);
    assert.ok(keys.length >= 12, `至少要 12 个 key（详情 5 + 入口 3 + 10级领取 4）实际 ${keys.length}`);
    const missing: string[] = [];
    for (const [key, rel] of Object.entries(MT_ART_NAMES)) {
        if (!existsSync(assetPath(`image/${rel}.png`))) missing.push(`${key} → ${rel}.png`);
    }
    assert.deepEqual(missing, [], `缺图（静默留白）：\n  ${missing.join('\n  ')}`);
});

test('C2 MT_ART_NAMES 的路径两两不同（同图必须指同一个 key，别拷副本）', () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [key, rel] of Object.entries(MT_ART_NAMES)) {
        const prev = seen.get(rel);
        if (prev) dup.push(`${rel}：${prev} 与 ${key}`);
        seen.set(rel, key);
    }
    assert.deepEqual(dup, [], `同一张图被登记两次：\n  ${dup.join('\n  ')}`);
});

test('C3 MT_ART_SLICED ↔ `.meta` border 双向对账（在名单里 ⇔ border 有非 0）', () => {
    const bad: string[] = [];
    for (const [key, rel] of Object.entries(MT_ART_NAMES)) {
        const metaPath = assetPath(`image/${rel}.png.meta`);
        if (!existsSync(metaPath)) {
            bad.push(`${key}：没有 .meta（${metaPath}）`);
            continue;
        }
        const border = deepBorder(JSON.parse(readFileSync(metaPath, 'utf8')));
        const hasBorder = !!border
            && [border.borderTop, border.borderBottom, border.borderLeft, border.borderRight]
                .some((v) => typeof v === 'number' && v > 0);
        const inList = MT_ART_SLICED.has(key);
        if (hasBorder !== inList) {
            bad.push(`${key}：名单里=${inList}，.meta border=${hasBorder}`
                + `（${rel}）—— 名单有名字但没打九宫 ⇒ 九宫图按 SIMPLE 拉伸会糊`);
        }
    }
    assert.deepEqual(bad, [], `九宫对账失败：\n  ${bad.join('\n  ')}`);
});

test('C4 MT_ART_TILED 为空（本模块一张平铺图都没有）', () => {
    assert.equal(MT_ART_TILED.size, 0);
});

test('C5 本模块自有图都落在 maintask/ 下，共用的指向 common/', () => {
    const wrong: string[] = [];
    for (const [key, rel] of Object.entries(MT_ART_NAMES)) {
        const ok = rel.startsWith('maintask/') || rel.startsWith('common/');
        if (!ok) wrong.push(`${key} → ${rel}`);
    }
    assert.deepEqual(wrong, [], `路径不在约定的两个目录下：\n  ${wrong.join('\n  ')}`);
});

// ============================================================
// D 组：prefab 结构与几何
// ============================================================

const detail = loadPrefab(DETAIL_PREFAB);
const entry = loadPrefab(ENTRY_PREFAB);

test('D1 详情弹窗：根节点 720×1280、锚点 (0.5,0.5)、挂 MainTaskDetailPage', () => {
    const root = detail[1];
    assert.equal(root._name, 'MainTaskDetail');
    const uit = compOf(detail, 1, 'cc.UITransform');
    assert.equal(uit._contentSize.width, 720);
    assert.equal(uit._contentSize.height, 1280);
    assert.deepEqual(uit._anchorPoint, { __type__: 'cc.Vec2', x: 0.5, y: 0.5 });
    assert.equal(root._lpos.x, 0);
    assert.equal(root._lpos.y, 0);
    assert.equal(root._active, true, '根节点必须激活');
    const cids = scriptTypes(detail, 1);
    assert.equal(cids.length, 1, `根上应恰有 1 个脚本，实际 ${cids.length}`);
});

test('D2 详情弹窗：根子序 = PopBg → DecoBar → TaskTitle → RewardList → BtnGo', () => {
    const names = (detail[1]._children ?? []).map((c: any) => byId(detail, c.__id__)._name);
    assert.deepEqual(names, ['PopBg', 'DecoBar', 'TaskTitle', 'RewardList', 'BtnGo']);
});

test('D3 详情弹窗：几何逐项对 FGUI 原稿（`组件_战斗_主线任务详情.xml`）', () => {
    const rects = collectRects(detail);
    // FGUI 原稿值（左上原点、y 向下）：<元素> xy/size
    const cases: [string, [number, number, number, number]][] = [
        ['PopBg', [65, 326, 590, 627]],
        ['PopBg/TitleRibbon', [188, 298, 344, 81]],
        ['PopBg/CloseBtn', [593, 306, 60, 60]],
        ['PopBg/TitleLabel', [240, 315, 240, 42]],
        ['DecoBar', [138, 396, 444, 48]],
        ['TaskTitle', [110, 403, 494, 39]],
        ['RewardList', [139, 481, 442, 266]],
        ['BtnGo', [262, 772, 195, 90]],
    ];
    for (const [path, [x, y, w, h]] of cases) {
        assertRect(rects.get(path), fguiRect(x, y, w, h), path);
    }
});

test('D4 弹窗底图必须**填满**弹窗 —— 引擎把 `topext/bottomext` 当位移了，这里是手工修的', () => {
    const rects = collectRects(detail);
    const pop = rects.get('PopBg');
    const plate = rects.get('PopBg/PanelWindow');
    assert.ok(pop && plate);
    assertRect(plate!, pop!, 'PopBg/PanelWindow');
    // 这条断言的存在理由：引擎的 `applyParentRelations` 把 `TopExt_Top` / `BottomExt_Bottom`
    // 归到 top/bottom 轴做 `__relMove`（**位移**），而 FGUI 真源是
    // `this._owner.height = this._owner._rawHeight ± v`（**改高度**）。
    // 未修的状态是 `[65,693,590,260]` —— 底图被推到弹窗下方、只剩 260 高。
    assert.ok(plate!.t - plate!.b > 600, `底图高度应 ≈ 627，实际 ${plate!.t - plate!.b}`);
});

test('D5 「前往」文字必须居中且铺满按钮宽 —— `autoSize="shrink"` 两条 relation 会被引擎叠加', () => {
    const rects = collectRects(detail);
    const btn = rects.get('BtnGo');
    const label = rects.get('BtnGo/GoLabel');
    assert.ok(btn && label);
    assert.equal(Math.round(btn!.r - btn!.l), 195);
    assert.equal(Math.round(label!.l), Math.round(btn!.l), '左边界必须与按钮齐平（居中 ⇒ 宽=父宽）');
    assert.equal(Math.round(label!.r), Math.round(btn!.r), '右边界同理');
    // 真源语义：`width-width`（宽 = 父宽）**且** `center-center`（中心 = 父中心）。
    // 引擎把两条 relation 线性叠加 ⇒ 算出 `l = 72.5 + 262 = 334.5`（明显偏右，用户截图可证）。
});

test('D6 奖励格：8 个槽位、4 列 2 行、整块在视口内居中、每格挂 GoodsBox', () => {
    const rects = collectRects(detail);
    const view = rects.get('RewardList');
    assert.ok(view, '没有 RewardList');
    const slots: string[] = [];
    for (let i = 1; i <= 8; i += 1) slots.push(`RewardList/Slot${i}`);
    const rectsOfSlots = slots.map((p) => rects.get(p));
    for (const [i, r] of rectsOfSlots.entries()) {
        assert.ok(r, `${slots[i]} 不存在`);
        assert.equal(Math.round(r!.r - r!.l), 100, `${slots[i]} 宽应为 100`);
        assert.equal(Math.round(r!.t - r!.b), 100, `${slots[i]} 高应为 100`);
        assert.ok(r!.l >= view!.l - 0.6 && r!.r <= view!.r + 0.6, `${slots[i]} 横向溢出视口`);
        assert.ok(r!.b >= view!.b - 0.6 && r!.t <= view!.t + 0.6, `${slots[i]} 纵向溢出视口`);
    }
    // 左右内边距相等（内容对内容；槽位节点锚点 (0.5,0.5)、本体 100，运行时按 110 的格子中心摆放
    // ⇒ 静态摆位也该居中 ⇒ 四边内边距应两两相等）
    const leftPad = rectsOfSlots[0]!.l - view!.l;
    const rightPad = view!.r - rectsOfSlots[3]!.r;
    assert.ok(Math.abs(leftPad - rightPad) <= 0.6, `左右内边距不等：${leftPad} vs ${rightPad}`);
    // 上下内边距相等
    const topPad = view!.t - rectsOfSlots[0]!.t;
    const botPad = rectsOfSlots[4]!.b - view!.b;
    assert.ok(Math.abs(topPad - botPad) <= 0.6, `上下内边距不等：${topPad} vs ${botPad}`);
    // 每个槽位都要挂 GoodsBox，且三件套都绑上
    const goodsBoxCid = scriptTypes(detail, rectsOfSlots[0]!.id)[0];
    assert.ok(goodsBoxCid, 'Slot1 上没挂脚本');
    for (const r of rectsOfSlots) {
        const cids = scriptTypes(detail, r!.id);
        assert.deepEqual(cids, [goodsBoxCid], `槽位 ${r!.name} 的脚本不对：${cids.join(',')}`);
        const comp = scriptOf(detail, r!.id, goodsBoxCid);
        for (const prop of ['frame', 'icon', 'num']) {
            assert.equal(
                typeof comp?.[prop]?.__id__, 'number',
                `槽位 ${r!.name} 的 @property \`${prop}\` 没绑上（静默 null ⇒ 空格子）`,
            );
        }
    }
});

test('D7 奖励格槽位必须与 `MainTaskDetailPage.presentRewards` 同一公式（两处差偏移会静默错位）', () => {
    const rects = collectRects(detail);
    const view = rects.get('RewardList')!;
    const s1 = rects.get('RewardList/Slot1')!;
    // 视口 442×266、格子 110、格内 100、2 行 4 列 ⇒
    //   top  = (266 − 2×110)/2 + (110−100)/2 = 23 + 5 = 28
    //   left = (442 − 4×110)/2 + (110−100)/2 = 1 + 5 = 6
    assert.ok(Math.abs((view.t - s1.t) - 28) <= 0.6, `首行上内边距应为 28，实际 ${view.t - s1.t}`);
    assert.ok(Math.abs((s1.l - view.l) - 6) <= 0.6, `首列左内边距应为 6，实际 ${s1.l - view.l}`);
    // 步进必须是 110（= item 本体），不是 100
    const s2 = rects.get('RewardList/Slot2')!;
    assert.ok(Math.abs((s2.l - s1.l) - 110) <= 0.6, `列步进应为 110，实际 ${s2.l - s1.l}`);
    const s5 = rects.get('RewardList/Slot5')!;
    assert.ok(Math.abs((s1.t - s5.t) - 110) <= 0.6, `行步进应为 110，实际 ${s1.t - s5.t}`);
});

test('D8 「前往」按钮底图必须铺满按钮（loader 的 `fill="scaleFree"` = 拉伸填满元素盒）', () => {
    const rects = collectRects(detail);
    const btn = rects.get('BtnGo')!;
    const plate = rects.get('BtnGo/GoPlate')!;
    assert.ok(Math.abs((plate.r - plate.l) - (btn.r - btn.l)) <= 0.6,
        `底图宽 ${plate.r - plate.l} ≠ 按钮宽 ${btn.r - btn.l}`);
    assert.ok(Math.abs((plate.t - plate.b) - (btn.t - btn.b)) <= 0.6,
        `底图高 ${plate.t - plate.b} ≠ 按钮高 ${btn.t - btn.b}`);
    // 出处：`按钮_公共_通用` 的 `icon` 声明 `size="50,50"`，被 `width-width,height-height`
    // relation 拉到 195×90；布局引擎在 relation 改尺寸后没重算「内容盒」⇒ 停在 50×50。
    // 已在 `tmp/_fgui_layout.mjs` 修（relation 改尺寸后同步拉伸型内容盒）。
});

test('D9 九宫图必须 `_type = SLICED(1)`、非九宫图必须 `SIMPLE(0)`（错了会拉伸变形/糊）', () => {
    const rects = collectRects(detail);
    // 九宫：panel_window_01_9gong / title_brown / BB_img03 / TY_btn10
    for (const path of ['PopBg/PanelWindow', 'PopBg/TitleRibbon', 'DecoBar', 'BtnGo/GoPlate']) {
        const r = rects.get(path);
        assert.ok(r, `${path} 不存在`);
        const sprite = compOf(detail, r!.id, 'cc.Sprite');
        assert.ok(sprite, `${path} 上没有 cc.Sprite（会静默留白）`);
        assert.ok(sprite._spriteFrame, `${path} 的 spriteFrame 是 null（图没绑上 ⇒ 静默留白）`);
        assert.equal(sprite._type, 1, `${path} 的 _type 应为 SLICED(1)`);
        assert.equal(sprite._sizeMode, 0, `${path} 的 sizeMode 应为 CUSTOM(0)（规则 87：其他模式会按原图回写 contentSize）`);
    }
    // 非九宫：公用_按钮_关闭01（`scale9grid` 是 null）—— 底图挂在**子节点** `ClosePlate` 上
    const closePlate = rects.get('PopBg/CloseBtn/ClosePlate');
    assert.ok(closePlate, 'CloseBtn 下应有子节点 ClosePlate（`<component extention="Button">` 迁过来底图在子节点上）');
    const closeSprite = compOf(detail, closePlate!.id, 'cc.Sprite');
    assert.ok(closeSprite, 'ClosePlate 上没有 cc.Sprite');
    assert.equal(closeSprite._type, 0, 'ClosePlate 没有九宫 ⇒ 必须是 SIMPLE(0)');
    // 底图必须与按钮等大（`fill` 语义：loader 铺满元素盒）
    const closeBtn = rects.get('PopBg/CloseBtn')!;
    assert.ok(Math.abs((closePlate!.r - closePlate!.l) - (closeBtn.r - closeBtn.l)) <= 0.6,
        `关闭按钮底图宽 ${closePlate!.r - closePlate!.l} ≠ 按钮宽 ${closeBtn.r - closeBtn.l}`);
});

test('D10 关闭按钮必须是真 `cc.Button`（否则 `CLICK` 事件永远不触发）', () => {
    const rects = collectRects(detail);
    for (const path of ['PopBg/CloseBtn', 'BtnGo']) {
        const r = rects.get(path)!;
        assert.ok(compOf(detail, r.id, 'cc.Button'), `${path} 上没有 cc.Button —— 绑 CLICK 会是死按钮`);
    }
});

test('D11 详情弹窗里所有节点都必须 `_active = true`（FGUI 默认页是「显示」）', () => {
    const off: string[] = [];
    const rects = collectRects(detail);
    for (const [path, r] of rects) {
        if (detail[r.id]._active === false) off.push(path);
    }
    assert.deepEqual(off, [], `这些节点被烘成了隐藏（除了红点，本 prefab 一个都不该有）：\n  ${off.join('\n  ')}`);
});

test('D12 入口 HUD：根 231×84、锚点 (0.5,0.5)、`_active = true`、挂 MainTaskEntry', () => {
    const root = entry[1];
    assert.equal(root._name, 'MainTaskEntry');
    const uit = compOf(entry, 1, 'cc.UITransform');
    assert.equal(uit._contentSize.width, 231, '实例尺寸 231（本体 225，被 `组件_战斗_章节选择` 覆写）');
    assert.equal(uit._contentSize.height, 84);
    assert.deepEqual(uit._anchorPoint, { __type__: 'cc.Vec2', x: 0.5, y: 0.5 });
    // 规则 86：`_active` 必须烘 true —— `onLoad` 只在激活时跑，而 `refresh()` 就在 `onLoad` 里
    assert.equal(root._active, true, '烘成 false = 永不刷新的死锁，且一条错都不报');
    assert.equal(scriptTypes(entry, 1).length, 1);
});

test('D13 入口 HUD：根子序 = Bg → Chest → RedDot → Label，且红点烘隐藏', () => {
    const names = (entry[1]._children ?? []).map((c: any) => byId(entry, c.__id__)._name);
    assert.deepEqual(names, ['Bg', 'Chest', 'RedDot', 'Label']);
    const rects = collectRects(entry);
    const redDot = rects.get('RedDot')!;
    assert.equal(entry[redDot.id]._active, false, '红点初始必须隐藏（老端由 OnRDUpdate 驱动，规则 82 每趟无条件写）');
    assert.equal(entry[rects.get('RedDot/DotText')!.id]._active, false, '红点里的数字同样隐藏');
});

test('D14 入口 HUD：几何用**相对偏移**断言（root 宽 231 是奇数，绝对坐标带半像素）', () => {
    const rects = collectRects(entry);
    const bg = rects.get('Bg')!;
    const chest = rects.get('Chest')!;
    const redDot = rects.get('RedDot')!;
    const label = rects.get('Label')!;
    // FGUI 原稿（`组件_战斗_主线任务.xml`，本体 225×84）：
    //   n5(jldb)      xy="1,0"   size="222,84"
    //   n8(lb1)       xy="138,-4" size="80,80" + relation `middle-middle,right-right`
    //   com_rd        xy="193,0"
    //   lab_task      xy="17,10" size="130,59"
    //
    // 实例被 `组件_战斗_章节选择` 覆写成 **231×84** ⇒ delta.w = 6 ⇒ 挂 `right-right` 的
    // `n8` 向右位移 6 ⇒ 相对 `n5` 的 x 偏移 = 138 + 6 − 1 = **143**（不是 137）。
    assert.ok(Math.abs((chest.l - bg.l) - 143) <= 0.6,
        `Chest 相对 Bg 的 x 偏移应为 143（138 + 6 位移 − 1），实际 ${chest.l - bg.l} —— 差了 6 说明 compSize 没传给布局引擎`);
    assert.ok(Math.abs((label.l - bg.l) - 16) <= 0.6, `Label 相对 Bg 的 x 偏移应为 17 − 1 = 16`);
    assert.ok(Math.abs((redDot.l - bg.l) - 192) <= 0.6, `RedDot 相对 Bg 的 x 偏移应为 193 − 1 = 192（无 relation ⇒ 不位移）`);
    // 尺寸：`lb1` 是 100×100 的原图、FGUI 显示 80×80（无九宫 ⇒ 按元素盒铺）
    assert.equal(Math.round(bg.r - bg.l), 222);
    assert.equal(Math.round(chest.r - chest.l), 80);
    assert.equal(Math.round(chest.t - chest.b), 80);
    assert.equal(Math.round(label.r - label.l), 130);
    assert.equal(Math.round(label.t - label.b), 59, 'FGUI `lab_task` 的 size="130,59"（两行高）');
    // 都在 root 内
    const rootRect = rects.get('MainTaskEntry')!;
    const inside: [string, IRect][] = [['Bg', bg], ['Chest', chest], ['RedDot', redDot], ['Label', label]];
    for (const [path, r] of inside) {
        assert.ok(r.l >= rootRect.l - 32 && r.r <= rootRect.r + 32,
            `${path} 横向严重溢出 root（超出 32px 以上）`);
    }
});

test('D15 入口 HUD：Label 是 22 号 `autoSize="shrink"` ⇒ Cocos `SHRINK`、不自动换行', () => {
    const rects = collectRects(entry);
    const label = compOf(entry, rects.get('Label')!.id, 'cc.Label');
    assert.ok(label, 'Label 节点上没有 cc.Label');
    assert.equal(label._fontSize, 22, 'FGUI `lab_task` 的 fontSize="22"');
    // FGUI `autoSize="shrink"` 的语义就是「尺寸不动、内容超了就缩字号」⇒ 与 Cocos 的 SHRINK 同义。
    // ⚠️ 规则 76 记过「SHRINK 没有字号下限」：长任务名会被压小 —— 这是**照抄 FGUI 的行为**，
    //    不是缺陷；真要防的是别把它改成 CLAMP（会裁字）或 NONE（会溢出底图）。
    assert.equal(label._overflow, 2, 'Overflow.SHRINK');
    assert.equal(label._enableWrapText, false, '老端用 `\\n` 硬换行，不靠自动换行');
    // 初始文案必须是**真换行**（FGUI 原稿写的是 `&#xA;`，XML 字符引用要在解析层解码）
    assert.ok(label._string.includes('\n'), `初始文案应有真换行，实际 ${JSON.stringify(label._string)}`);
    assert.ok(!label._string.includes('&#x'), '`&#xA;` 没被解码 —— 会原样显示 6 个字符');
});

// ============================================================
// E 组：视图脚本接线（源码文本）
// ============================================================

test('E1 详情弹窗的 prefabPath 与磁盘目录逐字一致（大小写敏感）', () => {
    const m = DETAIL_SRC.match(/static\s+prefabPath\s*=\s*'([^']+)'/);
    assert.ok(m, 'MainTaskDetailPage 里没有 static prefabPath');
    assert.equal(m![1], 'ui/MainTask/MainTaskDetail');
    assert.ok(assetExists('ui/MainTask/MainTaskDetail.prefab'),
        'prefabPath 指向的文件不存在（真机 resources.load 失败 ⇒ 空弹窗）');
});

test('E2 详情弹窗：两颗按钮统一绑 Node.TOUCH_END（不查 cc.Button、不做分流）', () => {
    const body = methodBody(DETAIL_SRC, 'onInit');
    assert.ok(body.includes('Node.EventType.TOUCH_END'), '必须绑节点触摸');
    assert.ok(body.includes('this.closeButton'), '关闭按钮要绑');
    assert.ok(body.includes('this.btnGo'), '「前往」按钮要绑');
    assert.equal(/bindButton/.test(DETAIL_SRC), false, '不该再有 bindButton 包装方法');
    assert.equal(/Button\.EventType\.CLICK|getComponent\(Button\)/.test(DETAIL_SRC), false,
        '不该再依赖 cc.Button（节点挂不挂都能点）');
});

test('E3 详情弹窗：点「前往」只提示、**不关窗**（老端是跳转后 unload）', () => {
    const body = methodBody(DETAIL_SRC, 'onGoClick');
    assert.ok(body.includes('Toast.show'), 'onGoClick 应当只弹提示');
    assert.ok(!body.includes('this.close('),
        '不能照抄老端的 unload() —— 本工程没接跳转链路，关掉就是「什么都没发生」');
    assert.ok(!body.includes('this.unload('), '老端的 unload 在本工程不存在');
});

test('E4 详情弹窗：奖励格回调按 **index 现取**，不闭包捕获 reward（规则 55）', () => {
    const body = methodBody(DETAIL_SRC, 'presentRewards');
    assert.ok(body.includes('openRewardDetail(index)'), '回调应传 index');
    assert.ok(!/openRewardDetail\(\s*reward\s*\)/.test(body), '不能把 reward 捕进闭包');
    const openBody = methodBody(DETAIL_SRC, 'openRewardDetail');
    assert.ok(openBody.includes('this.snapshot?.rewards[index]'),
        'openRewardDetail 必须从**当前** snapshot 按 index 取');
});

test('E5 详情弹窗：异步回来要查存活 + 修订号（否则关窗后还在写已销毁节点）', () => {
    assert.ok(DETAIL_SRC.includes('loadRevision'), '缺少 loadRevision 护栏');
    assert.ok(DETAIL_SRC.includes('presentRevision'), '缺少 presentRevision 护栏');
    assert.ok(DETAIL_SRC.includes('this.alive'), '缺少存活检查（isValid + isPopupOpen）');
    // 预加载必须先 await 完再铺界面：`presentRewards` 是同步的（规则 60/73 静默留白）
    const present = methodBody(DETAIL_SRC, 'present');
    assert.ok(present.includes('await Promise.all'), 'present 里必须先 await 预加载');
});

test('E6 入口：显隐归属自己（`onLoad` 调 refresh，且**没有** onEnable 再调一次）', () => {
    assert.ok(methodBody(ENTRY_SRC, 'onLoad').includes('refresh()'), 'onLoad 里要 refresh');
    assert.ok(!/\bonEnable\s*\(/.test(ENTRY_SRC),
        '不能加 onEnable + refresh：会互相触发，且隐藏后再也没人点亮它');
});

test('E7 入口：`applySnapshot` 每处都**无条件写**（规则 82，`_active` 烘的是 true）', () => {
    const body = methodBody(ENTRY_SRC, 'applySnapshot');
    assert.ok(body.includes('this.node.active = snapshot.visible'), 'visible 必须无条件写');
    assert.ok(body.includes('this.label.string ='), 'label 必须无条件写');
    assert.ok(body.includes('this.redDot.active = snapshot.showRedDot'), '红点必须无条件写');
    assert.ok(!/if\s*\([^)]*!==\s*this\.\w+/.test(body), '不该出现「只在翻转时写」的短路');
});

test('E8 入口：点击分流（可领 ⇒ 领奖；否则 ⇒ 弹详情），与老端同口径', () => {
    const body = methodBody(ENTRY_SRC, 'onClick');
    assert.ok(body.includes('snapshot.canClaim'), 'onClick 必须按 canClaim 分流');
    assert.ok(body.includes('this.claim()'), '可领 ⇒ 直接领奖');
    assert.ok(body.includes('MainTaskDetailPage.open'), '不可领 ⇒ 弹详情');
});

test('E9 入口：领奖三态提示齐备、有防连点', () => {
    const body = methodBody(ENTRY_SRC, 'claim');
    assert.ok(body.includes('this.busy'), '缺 busy 防连点');
    assert.ok(body.includes("'ok'"), "缺 'ok' 分支");
    assert.ok(body.includes("'offline'") && body.includes('offlineWarn'),
        "'offline' 必须与 'failed' 分开提示（一个包都没发 ≠ 服务端拒绝）");
    assert.ok(body.includes('claimFailed'), "缺 'failed' 分支");
});

test('E10 入口：`bindClick` 与详情弹窗同一分流口径（`<component>` 形态有 cc.Button）', () => {
    const body = methodBody(ENTRY_SRC, 'bindClick');
    assert.ok(body.includes('getComponent(Button)'));
    assert.ok(body.includes('Button.EventType.CLICK'));
    assert.ok(body.includes('Node.EventType.TOUCH_END'));
});

test('E11 两个视图脚本里不出现中文字面量（文案唯一出口 = MainTaskTexts）', () => {
    const cjk = /[\u4e00-\u9fff]/;
    const bad: string[] = [];
    for (const [label, src] of [['MainTaskDetailPage.ts', DETAIL_SRC], ['MainTaskEntry.ts', ENTRY_SRC]] as const) {
        stripComments(src).split('\n').forEach((line, i) => {
            // tooltip 之类也在注释里，剥完注释就不该再有任何中文
            if (cjk.test(line)) bad.push(`${label}:${i + 1}  ${line.trim().slice(0, 80)}`);
        });
    }
    assert.deepEqual(bad, [], `视图脚本里出现中文（应走 MainTaskTexts）：\n  ${bad.join('\n  ')}`);
});

test('E12 详情弹窗的槽位常量与 prefab 几何一致（110 / 4 列 / 442×266）', () => {
    const pick = (name: string): number => {
        const m = DETAIL_SRC.match(new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)`));
        assert.ok(m, `源码里找不到 ${name}`);
        return Number(m![1]);
    };
    assert.equal(pick('SLOT_SIZE'), 110, 'FGUI item 本体 110×110');
    assert.equal(pick('SLOT_COLUMNS'), 4, '视口 442 ÷ 110 = 4.02 ⇒ 4 列');
    assert.equal(pick('VIEW_W'), 442);
    assert.equal(pick('VIEW_H'), 266);
});

// ============================================================
// F 组：文案唯一出口
// ============================================================

test('F1 文案与 FGUI 原稿逐字一致（标题 / 前往）', () => {
    assert.equal(MAIN_TASK_TEXTS.detailTitle, '任务详情', 'FGUI `popBg` 的 title 覆写');
    assert.equal(MAIN_TASK_TEXTS.goBtn, '前往', 'FGUI `btn_go` 的 Button title');
});

test('F2 领奖三态与「10级领取」**共用同一份字面量**（改一处漏一处必分叉）', () => {
    assert.equal(MAIN_TASK_TEXTS.claimed, GET_HERO_TEXTS.claimed);
    assert.equal(MAIN_TASK_TEXTS.claimFailed, GET_HERO_TEXTS.claimFailed);
    assert.equal(MAIN_TASK_TEXTS.offlineWarn, GET_HERO_TEXTS.offlineWarn);
});

test('F3 prefab 里烘的文案与 MainTaskTexts 一致（标题 / 前往按钮）', () => {
    const rects = collectRects(detail);
    const title = compOf(detail, rects.get('PopBg/TitleLabel')!.id, 'cc.Label');
    assert.equal(title._string, MAIN_TASK_TEXTS.detailTitle);
    const go = compOf(detail, rects.get('BtnGo/GoLabel')!.id, 'cc.Label');
    assert.equal(go._string, MAIN_TASK_TEXTS.goBtn);
});

test('F4 「前往」提示语存在且不是空串（点了必须有反馈）', () => {
    assert.ok(MAIN_TASK_TEXTS.jumpNotWired.length > 0);
    assert.ok(DETAIL_SRC.includes('jumpNotWired'), 'onGoClick 必须用这条文案');
});

test('F5 两条 console 日志存在（选不出任务 / 缓存没到，都是静默场景）', () => {
    assert.ok(MAIN_TASK_TEXTS.noTaskWarn.includes('[MainTask]'));
    assert.ok(MAIN_TASK_TEXTS.noCmdWarn.includes('[MainTask]'));
});

// ============================================================
// G 组：ArenaRoot 上的嵌套实例
// ============================================================

const arena = loadPrefab(ARENA_PREFAB);
const ARENA_UUID = prefabUuid(ENTRY_PREFAB);

/** 找引用某个 prefab uuid 的嵌套实例（返回 `{ nodeId, info, inst }`）。 */
function nestedInstanceOf(prefab: any[], uuid: string): { nodeId: number; info: any; inst: any } | null {
    for (let i = 0; i < prefab.length; i += 1) {
        const o = prefab[i];
        if (o?.__type__ !== 'cc.PrefabInfo' || o.asset?.__uuid__ !== uuid || !o.instance) continue;
        return { nodeId: o.root.__id__, info: o, inst: prefab[o.instance.__id__] };
    }
    return null;
}

/** `cc.PrefabInstance` 的 `propertyOverrides` → `{ propertyPath: value }`。 */
function overridesOf(prefab: any[], inst: any): Map<string, any> {
    const out = new Map<string, any>();
    for (const raw of inst.propertyOverrides ?? []) {
        const p = prefab[raw.__id__];
        const path = (p.propertyPath ?? []).join('.');
        out.set(path, p.value);
    }
    return out;
}

test('G1 ArenaRoot 里挂着 MainTaskEntry 的嵌套实例，且只有一处', () => {
    const hits: number[] = [];
    arena.forEach((o, i) => {
        if (o?.__type__ === 'cc.PrefabInfo' && o.asset?.__uuid__ === ARENA_UUID) hits.push(i);
    });
    assert.equal(hits.length, 1, `ArenaRoot 引用 MainTaskEntry 的次数应为 1，实际 ${hits.length}`);
});

test('G2 MainTaskEntry 实例是 ArenaRoot 的**直接子节点**，位置覆写为 (207.5, -84)', () => {
    const found = nestedInstanceOf(arena, ARENA_UUID);
    assert.ok(found, 'ArenaRoot 里没有 MainTaskEntry 的嵌套实例');
    assert.equal(arena[found!.nodeId]._parent.__id__, 1, '必须是根的直接子（与其它 HUD 一致）');
    const ov = overridesOf(arena, found!.inst);
    const pos = ov.get('_lpos');
    assert.ok(pos, '实例没有 _lpos 覆写');
    assert.equal(pos.x, 207.5, `right = 37（父宽 720）⇒ 中心 x = 360 − 37 − 231/2 = 207.5，实际 ${pos.x}`);
    assert.equal(pos.y, -84, `bottom = 514 ⇒ 下边缘 y = −640 + 514 = −126 ⇒ 中心 = −126 + 42 = −84，实际 ${pos.y}`);
});

/** 子节点标签 —— 嵌套实例的根在**父 prefab** 里没有 `_name`（名字来自源 prefab），得靠 uuid 认。 */
const NESTED_LABEL = new Map<string, string>([
    [ARENA_UUID, 'MainTaskEntry'],
    [prefabUuid(assetPath('ui/MainTask/GetHeroEntry.prefab')), 'GetHeroEntry'],
]);

function childLabel(nodeId: number): string {
    const node = arena[nodeId];
    if (typeof node?._name === 'string' && node._name) return node._name;
    for (const [uuid, label] of NESTED_LABEL) {
        const found = nestedInstanceOf(arena, uuid);
        if (found && found.nodeId === nodeId) return label;
    }
    return `<#${nodeId}>`;
}

function childLabels(): string[] {
    return (arena[1]._children ?? []).map((c: any) => childLabel(c.__id__));
}

test('G3 子序守卫：HangEntry 必须仍是**最后一个**子节点', () => {
    const names = childLabels();
    assert.equal(names[names.length - 1], 'HangEntry',
        `最后一个子节点被顶掉了（实际 ${names[names.length - 1]}）——`
        + ' `tests/hang.test.ts` 有这条守卫，且 HangEntry 自己算绝对位置时依赖它');
    const mainIdx = names.indexOf('MainTaskEntry');
    const heroIdx = names.indexOf('GetHeroEntry');
    const hangIdx = names.indexOf('HangEntry');
    assert.ok(mainIdx >= 0 && heroIdx >= 0 && hangIdx >= 0,
        `三个入口都必须存在（实际 ${names.join(' / ')}）`);
    assert.ok(mainIdx > heroIdx && mainIdx < hangIdx,
        `MainTaskEntry 应插在 GetHeroEntry 之后、HangEntry 之前（实际 hero=${heroIdx} main=${mainIdx} hang=${hangIdx}）`);
});

test('G4 `cc.Widget` 必须烘在**源 prefab** 的根上（挂到嵌套实例根上 = 组件翻倍）', () => {
    const widget = compOf(entry, 1, 'cc.Widget');
    assert.ok(widget, 'MainTaskEntry.prefab 的根上没有 cc.Widget（HUD 不随分辨率贴边）');
    assert.equal(widget._alignFlags, 36, '`RIGHT | BOTTOM`（32 | 4）—— 与 GetHeroEntry 同口径');
    assert.equal(widget._right, 37, '右边缘距父右边 37');
    assert.equal(widget._bottom, 514, '`GetHeroEntry` 的 384 + 自身 120 + 间隙 10');
    assert.equal(widget._left, 0);
    assert.equal(widget._top, 0);
    assert.equal(widget._alignMode, 2, 'ALWAYS —— 每帧对齐，不是 ONCE');
    assert.equal(widget._target, null, '目标为 null = 相对父节点');
});

test('G5 实例侧不许有 `mountedComponents` / `mountedChildren`（否则嵌套实例根上外挂 = 组件翻倍）', () => {
    const found = nestedInstanceOf(arena, ARENA_UUID)!;
    const mounted = [
        ...(found.inst.mountedComponents ?? []),
        ...(found.inst.mountedChildren ?? []),
    ];
    assert.equal(mounted.length, 0,
        '嵌套实例根上挂东西会被 `applyMountedComponents()` push 进 `getWritableComponents()`，'
        + '`UITransform` 就翻倍了 —— 正确做法是把组件烘进源 prefab');
});

test('G6 MainTaskEntry 紧贴 GetHeroEntry 上方 10px（同列 HUD 堆叠）', () => {
    const heroUuid = prefabUuid(assetPath('ui/MainTask/GetHeroEntry.prefab'));
    const heroFound = nestedInstanceOf(arena, heroUuid);
    const mainFound = nestedInstanceOf(arena, ARENA_UUID);
    assert.ok(heroFound && mainFound, '两个入口的嵌套实例都要在');
    const heroPos = overridesOf(arena, heroFound!.inst).get('_lpos');
    const mainPos = overridesOf(arena, mainFound!.inst).get('_lpos');
    assert.ok(heroPos && mainPos, '两个实例都要有 _lpos 覆写');
    const heroTop = heroPos.y + 120 / 2;
    const mainBottom = mainPos.y - 84 / 2;
    assert.ok(Math.abs((mainBottom - heroTop) - 10) <= 0.6,
        `MainTaskEntry 下边缘应比 GetHeroEntry 上边缘高 10px（实际 ${mainBottom - heroTop}）`);
});

test('G7 GetHeroEntry（上一轮）的 Widget 也还好好的（没被生成器重跑抹掉）', () => {
    const heroPrefab = loadPrefab(assetPath('ui/MainTask/GetHeroEntry.prefab'));
    const widget = compOf(heroPrefab, 1, 'cc.Widget');
    assert.ok(widget, 'GetHeroEntry.prefab 根上的 cc.Widget 丢了');
    assert.equal(widget._alignFlags, 36);
    assert.equal(widget._right, 37);
    assert.equal(widget._bottom, 384);
});
