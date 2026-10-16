/**
 * 全屏弹窗「四边对齐 Widget」的回归网（`assets/resources/ui/**`）。
 *
 * 背景：本工程弹窗统一挂在常驻节点 `Popup` 下，而 `Popup` 自己挂了四边对齐
 * Widget —— 长屏（本机预览 720×**1463.04**）下会被拉到可见高。面板 prefab 若
 * 自身只有静态 720×1280 且无 Widget，就原地居中 ⇒ 上下各留
 * `(1463.04 − 1280) / 2 = 91.52px` 黑边（`login/ServerSelectPanel` 就是这么暴露的）。
 *
 * 这个失效方式**极隐蔽**：不报错、不抛异常、design 分辨率下预览完全正常，
 * 只有长屏真机/预览才看得到缝。所以单靠肉眼验收不住，必须钉成断言。
 *
 * 口径（与批处理脚本 `tmp/_add_popup_fullscreen_widget.py` 一致）：
 *   - **面板** = prefab 根节点上任一组件带 `popupLayer` 字段（`PopupBase` 及其子类）。
 *   - **全屏面板** = 该面板根节点尺寸的**高 === 设计分辨率 1280**（宽不强制，
 *     实际都是 720）。根高 100/200 的联盟子页等不算。
 *   - **全屏直接子节点** = 根的**直接**子节点里 `宽 ≥ 720 且 高 === 1280` 的
 *     （这类通常是 `Bg`/`Mask`/`PageRoot`/`MenuBar` 这类要跟随拉伸的铺底节点），
 *     且**排除嵌套 prefab 实例根**（规则 95：实例根禁外挂组件）。
 *   - **超设计高**（如 `Role/TabMilitiaTalent/Bg` 720×**1610**）是故意越界盖住
 *     任何屏幕的装饰底图，**不要求**对齐 —— 见 C1 反例。
 *   - `uidemo/**` 是演示层（且含手写非 22 位 `cc.PrefabInfo.fileId`），不是业务
 *     弹窗，**整目录排除** —— 见 C2。
 *
 * 断言的参数（`gm/GMPanel` 是全工程既有范本，逐字对齐）：
 *   `_alignFlags=45`(TOP1|BOT4|LEFT8|RIGHT32) / `_alignMode=2`(ON_WINDOW_RESIZE)
 *   / 四边距 `0` / `_isAbs*` 全 `true` / `_lockFlags ∈ {0,45}` / `fileId` 22 位。
 *
 * 纯读 prefab JSON，**零 `cc`**（依赖链上不出现引擎导入）。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// ============================================================
// 口径常量
// ============================================================

/** 设计分辨率高（根高 === 它才算「全屏面板」）。 */
const DESIGN_HEIGHT = 1280;
/** 全屏子节点判定下界（宽）。 */
const FULLSCREEN_MIN_WIDTH = 720;
const UI_DIR = 'assets/resources/ui';
/** 演示层目录：整目录排除（非业务弹窗）。 */
const EXCLUDED_DIR_SEGMENT = '/uidemo/';
/** 四边对齐：TOP(1)|BOT(4)|LEFT(8)|RIGHT(32)。 */
const FLAGS_ALL = 45;
/** `cc.Widget.AlignMode.ON_WINDOW_RESIZE`。 */
const ALIGN_MODE_ON_WINDOW_RESIZE = 2;

// ============================================================
// 最小 prefab JSON 解析（无 cc）
// ============================================================

type Obj = Record<string, any>;

function walkPrefabs(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...walkPrefabs(p));
        else if (e.name.endsWith('.prefab')) out.push(p);
    }
    return out;
}

/** `{__id__: n}` → 对象。 */
function deref(objs: Obj[], ref: unknown): Obj | null {
    if (ref && typeof ref === 'object' && typeof (ref as Obj).__id__ === 'number') {
        return objs[(ref as Obj).__id__] ?? null;
    }
    return null;
}

function rootNodeOf(objs: Obj[]): Obj | null {
    // 优先走 `cc.Prefab.data`（真源），退化到「_parent 为 null 的 cc.Node」。
    const prefab = objs[0];
    if (prefab?.__type__ === 'cc.Prefab') {
        const r = deref(objs, prefab.data);
        if (r) return r;
    }
    for (const o of objs) {
        if (o && o.__type__ === 'cc.Node' && o._parent === null) return o;
    }
    return null;
}

function componentOf(objs: Obj[], node: Obj, type: string): Obj | null {
    for (const c of node._components ?? []) {
        const k = deref(objs, c);
        if (k && k.__type__ === type) return k;
    }
    return null;
}

function hasPopupLayer(objs: Obj[], root: Obj): boolean {
    for (const c of root._components ?? []) {
        const k = deref(objs, c);
        if (k && 'popupLayer' in k) return true;
    }
    return false;
}

/** 规则 95：`cc.PrefabInfo.instance != null` ⇒ 嵌套 prefab 实例根，禁外挂组件。 */
function isInstanceRoot(objs: Obj[], node: Obj): boolean {
    const pi = deref(objs, node._prefab);
    return !!(pi && pi.instance);
}

function sizeOf(objs: Obj[], node: Obj): { width: number; height: number } | null {
    const tf = componentOf(objs, node, 'cc.UITransform');
    return tf?._contentSize ?? null;
}

// ============================================================
// 断言：一个节点必须是「四边对齐全屏 Widget」
// ============================================================

function assertFullscreenWidget(objs: Obj[], node: Obj, label: string): void {
    const w = componentOf(objs, node, 'cc.Widget');
    assert.ok(w, `${label}：缺 cc.Widget —— 长屏下会原地居中、上下留缝`);

    assert.equal(w._alignFlags, FLAGS_ALL, `${label}：_alignFlags 必须是 45(TOP|BOT|LEFT|RIGHT)`);
    assert.equal(w._alignMode, ALIGN_MODE_ON_WINDOW_RESIZE, `${label}：_alignMode 必须是 2(ON_WINDOW_RESIZE)`);
    assert.equal(w._left, 0, `${label}：_left 必须是 0`);
    assert.equal(w._right, 0, `${label}：_right 必须是 0`);
    assert.equal(w._top, 0, `${label}：_top 必须是 0`);
    assert.equal(w._bottom, 0, `${label}：_bottom 必须是 0`);
    assert.equal(w._isAbsLeft, true, `${label}：_isAbsLeft 必须是 true（绝对边距）`);
    assert.equal(w._isAbsRight, true, `${label}：_isAbsRight 必须是 true`);
    assert.equal(w._isAbsTop, true, `${label}：_isAbsTop 必须是 true`);
    assert.equal(w._isAbsBottom, true, `${label}：_isAbsBottom 必须是 true`);
    // `_lockFlags` 只影响编辑器里能否拖动边距数值，**不影响运行期对齐**：
    // 既有范本 `gm/GMPanel` 是 45（锁四边），本批新增是 0（不锁）。两者都合法。
    assert.ok(
        w._lockFlags === 0 || w._lockFlags === 45,
        `${label}：_lockFlags 只能是 0（不锁）或 45（锁四边），实际 ${w._lockFlags}`,
    );

    // `_originalWidth/_originalHeight` 应记录节点声明尺寸（设计分辨率）。
    const s = sizeOf(objs, node);
    assert.ok(s, `${label}：缺 cc.UITransform`);
    assert.equal(w._originalWidth, s!.width, `${label}：_originalWidth 应 === 节点声明宽`);
    assert.equal(w._originalHeight, s!.height, `${label}：_originalHeight 应 === 节点声明高`);

    // 防手写非法 fileId（`uidemo` 那两个 26 位就是反例）。
    const cpi = deref(objs, w.__prefab);
    assert.ok(cpi && cpi.__type__ === 'cc.CompPrefabInfo', `${label}：缺 cc.CompPrefabInfo`);
    assert.equal(typeof cpi!.fileId, 'string', `${label}：fileId 必须是字符串`);
    assert.equal(cpi!.fileId.length, 22, `${label}：fileId 必须是 22 位（引擎格式）`);
}

// ============================================================
// 采集：全屏面板 + 全屏直接子节点
// ============================================================

interface PanelRow { rel: string; root: Obj; objs: Obj[]; }
interface ChildRow { rel: string; child: Obj; objs: Obj[]; name: string; }

function collect(): { panels: PanelRow[]; children: ChildRow[]; skippedOverHeight: string[] } {
    const panels: PanelRow[] = [];
    const children: ChildRow[] = [];
    const skippedOverHeight: string[] = [];

    for (const p of walkPrefabs(UI_DIR)) {
        const rel = p.replace(/\\/g, '/');
        if (rel.includes(EXCLUDED_DIR_SEGMENT)) continue; // uidemo/ 演示层
        let objs: Obj[];
        try { objs = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
        if (!Array.isArray(objs)) continue;

        const root = rootNodeOf(objs);
        if (!root || !hasPopupLayer(objs, root)) continue;

        const s = sizeOf(objs, root);
        if (!s || s.height !== DESIGN_HEIGHT) continue; // 只收「全屏」面板

        panels.push({ rel, root, objs });

        for (const ch of root._children ?? []) {
            const n = deref(objs, ch);
            if (!n) continue;
            const cs = sizeOf(objs, n);
            if (!cs) continue;
            if (cs.width >= FULLSCREEN_MIN_WIDTH && cs.height === DESIGN_HEIGHT) {
                if (isInstanceRoot(objs, n)) continue; // 规则 95
                children.push({ rel, child: n, objs, name: n._name ?? '(未命名)' });
            } else if (cs.height > DESIGN_HEIGHT) {
                skippedOverHeight.push(`${rel}::${n._name ?? '(未命名)'} ${cs.width}x${cs.height}`);
            }
        }
    }
    return { panels, children, skippedOverHeight };
}

const { panels, children: fullscreenChildren, skippedOverHeight } = collect();

/** 断言存在某成员（按「相对路径以它结尾」）—— 防口径被改坏后守卫空转。 */
function assertHas(rows: { rel: string }[], suffix: string): void {
    assert.ok(
        rows.some((r) => r.rel.endsWith(suffix)),
        `清单里必须包含 ${suffix}（口径可能被改坏了）`,
    );
}

// ============================================================
// A. 口径完备性
// ============================================================

test('A1 全屏业务弹窗清单非空且规模达标（口径退化时会直接暴露）', () => {
    // 实测 2026-09-29：26 个（25 个本次新增 + gm/GMPanel 既有范本）。
    // 取 >= 26 而非 ==，允许新增面板；低于它说明 filter 条件被改坏了。
    assert.ok(panels.length >= 26, `全屏业务弹窗应 >= 26 个，实际 ${panels.length}（口径可能被改坏）`);
});

test('A2 清单必须包含关键代表面板（防 filter 被改坏导致空转）', () => {
    for (const suf of [
        'login/ServerSelectPanel.prefab',   // 本轮暴露问题的那个
        'common/LoadingPopup.prefab',
        'Chat/Chat.prefab',
        'BattleToken/BattleToken.prefab',
        'Gift/Gift.prefab',
        'Role/TabMilitiaTalent.prefab',
        'gm/GMPanel.prefab',                // 既有范本
    ]) {
        assertHas(panels, suf);
    }
});

test('A3 全屏直接子节点清单规模达标且包含关键成员', () => {
    // 实测 2026-09-29：8 个（7 个本次新增 + gm/GMPanel/Bg 既有）。
    assert.ok(fullscreenChildren.length >= 8, `全屏直接子节点应 >= 8 个，实际 ${fullscreenChildren.length}`);
    for (const [panelSuffix, childName] of [
        ['login/ServerSelectPanel.prefab', 'Bg'],
        ['common/LoadingPopup.prefab', 'Mask'],
        ['Chat/Chat.prefab', 'Mask'],
        ['BattleToken/BattleToken.prefab', 'PageRoot'],
        ['Gift/Gift.prefab', 'PageRoot'],
        ['Role/TabMilitiaTalent.prefab', 'Mask'],
        ['Role/TabMilitiaTalent.prefab', 'MenuBar'],
    ] as const) {
        assert.ok(
            fullscreenChildren.some((r) => r.rel.endsWith(panelSuffix) && r.name === childName),
            `${panelSuffix} 的全屏子节点 ${childName} 必须在清单里`,
        );
    }
});

// ============================================================
// B. 每个全屏面板根节点都必须是四边对齐 Widget
// ============================================================

test('B1 每个全屏业务弹窗的根节点都有四边对齐 Widget', () => {
    for (const { rel, root, objs } of panels) {
        assertFullscreenWidget(objs, root, `${rel} 根节点`);
    }
});

// ============================================================
// C. 每个全屏直接子节点都必须是四边对齐 Widget
// ============================================================

test('C1 每个全屏直接子节点都有四边对齐 Widget', () => {
    for (const { rel, child, objs, name } of fullscreenChildren) {
        assertFullscreenWidget(objs, child, `${rel} :: ${name}`);
    }
});

// ============================================================
// D. 反例守卫：口径不能过宽
// ============================================================

test('D1 超设计高（720×1610）的装饰底图不要求对齐（故意越界盖满屏）', () => {
    // `Role/TabMilitiaTalent/Bg` 是 720×1610：越出设计尺寸反而能盖住任何屏幕，
    // 给它套四边对齐（会把高改成 1280）反而露馅。
    assert.ok(
        skippedOverHeight.some((s) => s.includes('Role/TabMilitiaTalent.prefab') && s.includes('Bg')),
        `Role/TabMilitiaTalent/Bg 应被识别为「超设计高」而跳过，实际被跳过的：${JSON.stringify(skippedOverHeight)}`,
    );
    assert.ok(
        !fullscreenChildren.some((r) => r.rel.endsWith('Role/TabMilitiaTalent.prefab') && r.name === 'Bg'),
        'Role/TabMilitiaTalent/Bg 不能出现在「全屏直接子节点」清单里',
    );
});

test('D2 uidemo 演示层不在清单内（整目录排除）', () => {
    assert.ok(!panels.some((r) => r.rel.includes(EXCLUDED_DIR_SEGMENT)), 'uidemo/ 不该被当成业务弹窗');
    assert.ok(!fullscreenChildren.some((r) => r.rel.includes(EXCLUDED_DIR_SEGMENT)));
});

test('D3 清单里每个面板的根高都必须 === 设计分辨率（口径边界不被放宽）', () => {
    for (const { rel, root, objs } of panels) {
        const s = sizeOf(objs, root);
        assert.equal(s?.height, DESIGN_HEIGHT, `${rel} 根高应 === ${DESIGN_HEIGHT}，否则不该进清单`);
    }
});
