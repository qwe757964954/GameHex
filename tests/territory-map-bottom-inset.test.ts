/**
 * 地图**拖拽上下限**：滚到头时「地块边缘」停在 UI 框旁边的固定间距内。
 *
 * | 边 | 用户原话 | 基准（关键） | 公式 |
 * | --- | --- | --- | --- |
 * | 底部 | 「地图最底部的地块限制拖动距离，最大只能间距 50px」 | **底部挂件（任务 / 快速寻敌）上沿** | `pad = inset + 50` |
 * | 顶部 | 「顶部的格子还是无法拖动到个人信息框的下方」 | **顶部 HUD 底边** | `padTop = hudBottom + 15 + 45 + 60` |
 *
 * ## 现状与口径
 *
 * 拖拽由 `cc.ScrollView` 承担，而它的可滚范围只由「内容层高 − 视口高」决定 ⇒
 * **留白就是硬上限**（`elastic = false`，松手前也拖不过去）。所以「上限」这件事
 * 完全落在 `paddingBottom` / `paddingTop` 一个数上：
 *
 * ```text
 * 滚到最底 ⇒ 内容层底边贴视口底边 ⇒ 地图底边在视口底部上方 pad
 *         ⇒ 地图底边距视口顶部 = 视口高 − pad
 * 要让「地图底边 → 挂件上沿」= GAP，而挂件上沿本身离视口底部 inset：
 *   pad = inset + GAP
 * ```
 *
 * 🔴 2026-10-28 换了基准：底部原来拿**顶部 HUD** 反算（`pad = 视口高 − hudBottom − 15`，
 * 720×1280 上 `pad` 高达 951），效果是把地图底边一直送到个人信息框下方 —— 拖到最底时
 * 地图下面留 951px 纯云，用户截图原话「距离太高」。现在基准换成底部挂件上沿。
 *
 * 本文件钉五件事：
 *  1. 两条反算公式（含边界：量不到挂件 / 挂件比视口还高 / 非有限值）；
 *  2. **不变量**：用真实布局复算「滚到最底时地图底边」= 挂件上沿 + 50；
 *  3. 内容层偏移与留白同源（偏移 = (bottom − top)/2，写漏就滚到顶露半格空、云洞层整层漂）；
 *  4. 接线：页面量**两条不同的基准线** → 注入视图 → 视图两处都吃这个值 → `scrollToCell` 用同一个值；
 *  5. 顶部留白那半边（第一排地块要能被拖到个人信息框下方）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildHexGridLayout } from '../assets/script/core/hex/HexGridLayout';
import {
    TERRITORY_MAP_BOTTOM_GAP,
    TERRITORY_MAP_BOTTOM_INSET,
    TERRITORY_MAP_HUD_GAP,
    TERRITORY_MAP_TOP_BREATH,
    TERRITORY_MAP_TOP_FACE_RISE,
    territoryMapContentPaddingBottom,
    territoryMapContentPaddingTop,
    territoryMapContentShiftY,
    territoryMapContentSize,
    territoryMapOffsetForCell,
} from '../assets/script/app/territory/model/TerritoryMapLayout';

const LAYOUT_SRC = readFileSync('assets/script/app/territory/model/TerritoryMapLayout.ts', 'utf8');
const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const PAGE_SRC = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');

const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

/** 剥注释后再判源码（反向断言必须剥 —— 说明注释里就写着被禁的写法）。 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 第一章：18 行 15 列（`buildTerritoryMapLayout` 的真实输出 1421.5 × 1694）。 */
const LAYOUT = buildHexGridLayout(18, 15);
/** `MapViewport` 的尺寸（`MainTerritoryMap.prefab`：720×1112，底边离屏幕底还有 168）。 */
const VIEWPORT = { width: 720, height: 1112 };
/** 顶部 HUD 底边到视口顶部的距离（`ArenaRoot/TopHud`：顶对齐 16 + 高 130，长屏会更大）。 */
const HUD_BOTTOM = 146;
/**
 * 底部挂件上沿到**视口底边**的距离（720×1280 实测）。
 *
 * `MainTaskEntry` 页面 y −215、高 96 ⇒ 上沿 −167；`MapViewport` 底 = −472 ⇒ 305。
 * 它比快速寻敌（184）和宝箱栏（301）都高 ⇒ 用户红框画的就是「地块底边 ↔ 任务上沿」这条空当。
 */
const BOTTOM_INSET = 305;

// ============================================================
// 一、反算公式
// ============================================================

test('★★★底部间隙常量必须是 50px（用户 2026-10-28 口径）', () => {
    assert.equal(TERRITORY_MAP_BOTTOM_GAP, 50);
    assert.match(LAYOUT_SRC, /export const TERRITORY_MAP_BOTTOM_GAP = 50;/,
        '常量要能一眼被找到（页面与视图两侧都靠它对齐口径）');
    // 与顶部那条（15）必须分开：两条基准线不同，数值也就不同，合成一个常数迟早有人改错一边。
    assert.notEqual(TERRITORY_MAP_BOTTOM_GAP, TERRITORY_MAP_HUD_GAP,
        '底部 50（到挂件上沿）与顶部 15（到 HUD 底边）是两件事，不许共用一个常量');
});

test('★★★留白 = 底部挂件咬入高度 + 50', () => {
    assert.equal(territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET),
        BOTTOM_INSET + TERRITORY_MAP_BOTTOM_GAP);
    assert.equal(territoryMapContentPaddingBottom(1112, 305), 355);
    // 量不到挂件（0）⇒ 只剩那 50px 的呼吸位，不会变成 0（0 = 底排被挂件压住）。
    assert.equal(territoryMapContentPaddingBottom(1112, 0), TERRITORY_MAP_BOTTOM_GAP);
    // 🔴 与视口高**无关**：视口再高，挂件也不会更矮 ⇒ 不许再出现 `视口高 − …` 那种反算。
    assert.equal(territoryMapContentPaddingBottom(1280, BOTTOM_INSET),
        territoryMapContentPaddingBottom(720, BOTTOM_INSET),
        '底部留白只跟挂件咬入高度有关（旧公式 `视口高 − hudBottom − 15` 就是这么把 951 算出来的）');
});

test('★★★兜底常数 = 300（量不到挂件时用），且不等于 0', () => {
    assert.equal(TERRITORY_MAP_BOTTOM_INSET, 300);
    // 缺省参数就用它 ⇒ `territoryMapContentPaddingBottom(h)` 已经是可用值。
    assert.equal(territoryMapContentPaddingBottom(VIEWPORT.height),
        TERRITORY_MAP_BOTTOM_INSET + TERRITORY_MAP_BOTTOM_GAP);
    assert.ok(TERRITORY_MAP_BOTTOM_INSET > 0,
        '兜底必须是正数 —— 0 等于「没有挂件」，底排会被任务入口压住');
});

test('★★★边界：挂件比视口还高 / 非有限值都不许算出非法留白', () => {
    // 挂件咬入 900 + 50 = 950 > 视口 600 ⇒ 夹到视口高：内容层不缩水，地图最多贴视口底部。
    assert.equal(territoryMapContentPaddingBottom(600, 900), 600);
    // 视口高为 0（预制体还没撑开）：谈不上夹取，直接给 pad。
    assert.equal(territoryMapContentPaddingBottom(0, 0), TERRITORY_MAP_BOTTOM_GAP);
    for (const [h, b] of [[Number.NaN, 305], [1112, Number.NaN], [Number.POSITIVE_INFINITY, 100],
        [1112, Number.NEGATIVE_INFINITY], [1112, -50]]) {
        const pad = territoryMapContentPaddingBottom(h as number, b as number);
        assert.ok(Number.isFinite(pad) && pad >= 0, `${h}/${b} 算出了非法留白 ${pad}`);
    }
});

// ============================================================
// 二、不变量：滚到最底时，地图底边正好在挂件上沿上方 50px
// ============================================================

test('★★★滚到最底时，地图底边停在「底部挂件上沿 + 50px」', () => {
    const pad = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    const padTop = territoryMapContentPaddingTop(HUD_BOTTOM);
    const content = territoryMapContentSize(LAYOUT, pad, padTop);
    const maxScroll = Math.max(0, content.height - VIEWPORT.height);
    // 滚动偏移 = 内容层被推上去的距离；地图顶边距内容层顶边还有 padTop
    // （`territoryMapContentShiftY` 保证的就是这件事），所以地图底边 = padTop + 地图高 − 偏移。
    const mapBottomFromViewportTop = padTop + LAYOUT.height - maxScroll;
    const gapToViewportBottom = VIEWPORT.height - mapBottomFromViewportTop;
    // 挂件上沿离视口底 inset ⇒ 地块底边 ↔ 挂件上沿 = 上面的空当 − inset。
    assert.ok(near(gapToViewportBottom - BOTTOM_INSET, TERRITORY_MAP_BOTTOM_GAP),
        `地块底边应停在挂件上沿上方 ${TERRITORY_MAP_BOTTOM_GAP}，实际 ${gapToViewportBottom - BOTTOM_INSET}`);
    // 同一件事的另一种算法：地图底边距视口底 = pad（与 padTop 无关，两边各算各的）。
    assert.ok(near(gapToViewportBottom, pad), `地图底边距视口底应等于留白 ${pad}，实际 ${gapToViewportBottom}`);
});

test('★★★上限必须比 2026-10-27 那版（拿顶部 HUD 反算）松得多（否则这次改动是空转）', () => {
    // 旧口径：`pad = 视口高 − hudBottom − 15` ⇒ 720×1280 上是 951，地图底边停在视口上方 951。
    const legacyPad = VIEWPORT.height - HUD_BOTTOM - TERRITORY_MAP_HUD_GAP;
    assert.equal(legacyPad, 951, '旧公式的实算值（写在这里是为了让"为什么用户说距离太高"有据可查）');
    const pad = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    assert.ok(pad < legacyPad,
        `新留白 ${pad} 必须比旧留白 ${legacyPad} 小 —— 用户要的是"能拖得更低"，不是更高`);
    // 换算成「地图底边距视口顶部」：数值越大 = 画面里地图越靠下 = 能拖得越远。
    assert.ok(VIEWPORT.height - pad > VIEWPORT.height - legacyPad,
        '新上限必须让地图能拖到更下面（否则底排离挂件还是一大片云）');
});

test('★★★`scrollToOffset` 与内容层上限必须同源（可滚上限用同一个 pad）', () => {
    const pad = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    const content = territoryMapContentSize(LAYOUT, pad);
    const maxScroll = Math.max(0, content.height - VIEWPORT.height);

    // 最底下那一格：理想偏移会超过 maxScroll ⇒ 必须被钳到 maxScroll。
    const bottomCellId = [...LAYOUT.points.entries()]
        .reduce((acc, cur) => (cur[1].y < acc[1].y ? cur : acc));
    const offset = territoryMapOffsetForCell(LAYOUT, bottomCellId[0], VIEWPORT, { paddingBottom: pad });
    assert.ok(offset.y <= maxScroll + 1e-9, `偏移 ${offset.y} 超过了内容层上限 ${maxScroll}`);
    // 不带 paddingBottom 时走缺省 300 ⇒ 上限不同；两个值必须不同，否则说明参数没生效。
    const legacyOffset = territoryMapOffsetForCell(LAYOUT, bottomCellId[0], VIEWPORT);
    assert.ok(near(maxScroll, Math.max(0, content.height - VIEWPORT.height)));
    assert.notEqual(offset.y, legacyOffset.y,
        '传入 paddingBottom 必须改变可滚上限（参数没被用上）');
});

// ============================================================
// 三、内容层偏移与留白同源
// ============================================================

test('★★★内容层偏移 = (底部留白 − 顶部留白) / 2（写错就滚到顶露半格空底图）', () => {
    for (const pad of [0, 50, 300, 355, 951]) {
        assert.equal(territoryMapContentShiftY(pad, 0), pad / 2, `pad=${pad} 的偏移应为 pad/2`);
        assert.equal(territoryMapContentSize(LAYOUT, pad, 0).height, LAYOUT.height + pad);
    }
    const padBottom = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    const padTop = territoryMapContentPaddingTop(HUD_BOTTOM);
    assert.equal(territoryMapContentShiftY(padBottom, padTop), (padBottom - padTop) / 2);
    // 缺省仍是「底部 300 / 顶部 0」（不传参数的老调用不受影响）。
    assert.equal(territoryMapContentShiftY(), 150);
    assert.equal(territoryMapContentSize(LAYOUT).height, LAYOUT.height + 300);
});

test('★★★留白是运行时值：视图两处尺寸计算都必须带上**上下两份**', () => {
    const code = stripComments(MAP_VIEW_SRC);
    const calls = code.match(/territoryMapContentSize\([^)]*\)/g) ?? [];
    assert.ok(calls.length >= 2, `内容层尺寸至少在两处算（内容层 / 底图 cover），实际 ${calls.length} 处`);
    for (const call of calls) {
        assert.match(call, /this\.contentPaddingBottom/,
            `${call} 少了 contentPaddingBottom —— 底图与内容层会用两个不同高度，滚到底露白边`);
        assert.match(call, /this\.contentPaddingTop/,
            `${call} 少了 contentPaddingTop —— 滚到顶时第一排地块拖不出个人信息框`);
    }
    // 偏移也必须是同一来源（两份留白一起进 `(bottom − top)/2`）。
    assert.match(code, /territoryMapContentShiftY\(\s*this\.contentPaddingBottom,\s*this\.contentPaddingTop\s*,?\s*\)/,
        'applyContentShift 必须用注入的**两份**留白算偏移');
    // 🔴 云洞层（`TerritoryCloudPocket`）是**页面根**的孩子（要压在 UI 之上），不在
    //    `MapLayer` 的子树里 ⇒ 吃不到上面这个偏移，必须显式注入。
    //    没注入它就只能拿 `territoryMapContentShiftY()` 的缺省值（+150）对齐，
    //    留白一变成真实值就整层漂（2026-10-28 用户截图：云压到上面那排地块上）。
    const shiftAt = code.indexOf('private applyContentShift(');
    assert.ok(shiftAt > 0, '要有 applyContentShift');
    const shiftBody = code.slice(shiftAt, code.indexOf('\n    }', shiftAt));
    assert.match(shiftBody, /this\.clouds\.setContentShiftY\(shift\)/,
        '内容层偏移必须同时注入云层 —— 云洞层不在 MapLayer 的子树里，自己算会算成缺省值');
});

test('★★★改留白必须走 setter（偏移要同步重写）', () => {
    for (const [name, field] of [
        ['setContentPaddingBottom(', 'this.contentPaddingBottom = value;'],
        ['setContentPaddingTop(', 'this.contentPaddingTop = value;'],
    ]) {
        const at = MAP_VIEW_SRC.indexOf(name);
        assert.ok(at > 0, `要有 ${name}`);
        const body = MAP_VIEW_SRC.slice(at, MAP_VIEW_SRC.indexOf('\n    }', at));
        assert.match(body, new RegExp(field.replace(/[.$(){}]/g, (m) => `\\${m}`)), 'setter 要真的写字段');
        assert.match(body, /this\.applyContentShift\(\);/,
            `${name} 必须顺手重写内容层偏移（(bottom − top)/2 变了）`);
    }
    // 内容层尺寸每次 render 都会重算 ⇒ 不需要在 setter 里写，但 syncContentSize 里要补一次偏移，
    // 否则「先 setPadding 再首次 sync」这一帧的偏移还是旧的。
    const syncAt = MAP_VIEW_SRC.indexOf('private syncContentSize(');
    assert.ok(syncAt > 0, '要有 syncContentSize');
    const syncBody = MAP_VIEW_SRC.slice(syncAt, MAP_VIEW_SRC.indexOf('\n    private ', syncAt + 10));
    assert.match(syncBody, /this\.applyContentShift\(\);/, 'syncContentSize 写完尺寸要同步偏移');
});

// ============================================================
// 四、接线：页面量「顶部 HUD 底边」+「底部挂件上沿」→ 注入视图 → 跳转用同一个值
// ============================================================

test('★★★页面必须量底部挂件上沿（不是顶部 HUD）当底部基准', () => {
    const code = stripComments(PAGE_SRC);
    // 三块挂件的位置不同（任务入口是 BottomHud 的孩子），只能按名字递归找。
    assert.match(code, /const BOTTOM_HUD_NODE_NAMES = \['MainTaskEntry', 'BeginGame', 'ChestBar'\] as const;/,
        '要按名字列出三块底部挂件（任务入口 / 快速寻敌 / 宝箱栏）');
    assert.match(code, /for \(const child of root\.children\)/,
        '要递归找 —— 任务入口挂在 BottomHud 下面，`getChildByName` 一级找不到');
    const insetAt = code.indexOf('private bottomHudInset(');
    assert.ok(insetAt > 0, '要有 bottomHudInset');
    const body = code.slice(insetAt, code.indexOf('\n    }', insetAt));
    assert.match(body, /getBoundingBoxToWorld\(\)/,
        '必须量世界包围盒 —— 挂件挂 Widget + 安全区适配，抄死 prefab 数字在长屏上会差几十像素');
    assert.match(body, /top - viewportBox\.yMin/,
        '底部量的是「挂件上沿 − **视口**底边」（视口底离屏幕底还有 168，拿屏幕底量会多算 168）');
    assert.match(body, /Math\.max\(top, box\.yMax\)/,
        '取上沿里**最高**的那块 —— 地图要让开的是最高那个挂件，不是平均线');
    assert.match(body, /return null;/, '一个都量不到必须返回 null（让调用方用兜底，不能当成 0）');
    // 注入：底部吃 inset，顶部吃 hudBottom，两条线不许串。
    assert.match(code, /const bottomInset = this\.bottomHudInset\(viewport\) \?\? TERRITORY_MAP_BOTTOM_INSET;/,
        '量不到时退到兜底常数（照抄 prefab 数字是同一件事的另一种写法）');
    assert.match(code, /territoryMapContentPaddingBottom\(viewport\.height, bottomInset\)/,
        '底部留白必须由「视口高 + 挂件咬入高度」反算');
    assert.doesNotMatch(code, /territoryMapContentPaddingBottom\(viewport\.height, hudBottom\)/,
        '🔴 底部基准不许再拿顶部 HUD 反算 —— 就是它把留白算到 951 的（用户截图「距离太高」）');
    assert.match(code, /territoryMapContentPaddingTop\(hudBottom\)/,
        '顶部留白仍由顶部 HUD 底边反算（那一侧的口径没变）');
    assert.match(code, /const hudBottom = this\.topHudBottom\(viewport\);/, '顶部 HUD 底边只量一次');
    // 视图侧不许自己去翻页面的挂件（反向依赖页面结构，同 scrollLock 的理由）。
    assert.doesNotMatch(stripComments(MAP_VIEW_SRC), /TopHud|MainTaskEntry|BeginGame/,
        'TerritoryMapView 不许知道宿主页 UI —— 基准线只有页面知道');
});

test('★★★页面必须从宿主页找 TopHud 并量世界包围盒（不抄 prefab 数字）', () => {
    const code = stripComments(PAGE_SRC);
    assert.match(code, /getChildByName\(TOP_HUD_NODE_NAME\)/,
        'TopHud 要按名字从宿主页找（它与地图页同级，不在地图 prefab 里）');
    assert.match(code, /getBoundingBoxToWorld\(\)/,
        '必须量世界包围盒 —— TopHud 挂 Widget + 长屏适配，抄死尺寸在长屏上会差几十像素');
});

test('★★★注入必须发生在 initialize 之前，并跟屏幕变化重算', () => {
    const code = stripComments(PAGE_SRC);
    const insetAt = code.indexOf('this.syncMapInsets();');
    const initAt = code.indexOf('this.mapView.initialize();');
    assert.ok(insetAt > 0, 'onLoad 要调 syncMapInsets');
    assert.ok(initAt > 0, 'onLoad 要调 mapView.initialize');
    assert.ok(insetAt < initAt,
        '留白要在 initialize 之前注入 —— 内容层偏移（(bottom − top)/2）在那里面写第一次');
    assert.ok(code.indexOf('this.bindMapInsetResize();') < initAt, '监听也要在 initialize 之前绑好');
    // 长屏 / 安全区变化会改两条基准线 ⇒ 必须跟着重量。
    assert.match(code, /view\?\.on\?\.\('canvas-resize', this\.onCanvasResize, this\)/,
        '要订阅 canvas-resize（HUD 与底部挂件的 Widget / 安全区都会因此改变）');
    assert.match(code, /view\?\.off\?\.\('canvas-resize', this\.onCanvasResize, this\)/,
        '`view` 是全局单例，不摘会随页面复用累积回调');
    // 回调必须推迟一帧：`MainHudLayout` 也在 canvas-resize 里排 TopHud，同帧量到的可能是旧底边。
    assert.match(code, /this\.scheduleOnce\(this\.remapMapInsets, 0\)/,
        '重量要延到下一帧（Widget 对齐完再量）');
    // 注册要幂等，且缺滚动容器 / 地图时直接跳过（极简引擎桩里这两样都没有）。
    const bindAt = code.indexOf('private bindMapInsetResize(');
    assert.ok(bindAt > 0, '要有 bindMapInsetResize');
    const bindBody = code.slice(bindAt, code.indexOf('\n    private ', bindAt + 10));
    assert.match(bindBody, /if \(this\.mapInsetResizeBound\) return;/, '注册必须幂等');
    assert.match(bindBody, /if \(!this\.mapScrollView\?\.isValid \|\| !this\.mapView\?\.isValid\) return;/,
        '缺滚动容器 / 地图时要跳过，别让整个页面上不来');
});

test('★★★自动跳到格心时也要用同一组留白（否则被钳在半路）', () => {
    const at = PAGE_SRC.indexOf('private scrollToCell(');
    assert.ok(at > 0, '要有 scrollToCell');
    const body = PAGE_SRC.slice(at, PAGE_SRC.indexOf('\n    private ', at + 10));
    assert.match(body, /paddingBottom: this\.mapView\?\.contentPaddingBottom/,
        'scrollToOffset 的可滚上限必须与内容层同源（差一截就会停在半路）');
    assert.match(body, /paddingTop: this\.mapView\?\.contentPaddingTop/,
        '顶部留白也要传 —— 少传就等于按「没顶部留白」算偏移，跳过去会偏几格');
});

// ============================================================
// 五、顶部留白：第一排地块要能被拖到个人信息框下方
// ============================================================
//
// 2026-10-27 用户：「顶部的格子还是无法拖动到个人信息框的下方」。
// 根因：顶部留白恒 0 ⇒ 滚到顶时内容层顶边贴视口顶边，第一排格子就在视口最上面，
// 而 `TopHud` 浮在视口之上 146px + `elastic = false` 拖不动 ⇒ 最上面那一两排永久被挡。
//
// 第二轮用户：「顶部留白已经实现，但仍然需要可以下拉多大约 60px」⇒ 在几何必需的那 45 之外
// 再留 `TERRITORY_MAP_TOP_BREATH`（手感余量），见下方第三条断言。

test('★★★顶部留白 = HUD 底边 + 15 + 半个格面高 + 60 手感余量', () => {
    assert.equal(TERRITORY_MAP_TOP_FACE_RISE, 45, '格面高 90，以格心为中心 ⇒ 图往上探 45');
    assert.equal(TERRITORY_MAP_TOP_BREATH, 60, '玩家还要能再往下拖 60px');
    // 两截**分开**：45 是几何（行高变了它跟着变），60 是手感（与几何无关）。
    assert.notEqual(TERRITORY_MAP_TOP_BREATH, TERRITORY_MAP_TOP_FACE_RISE,
        '别把 45 直接改成 105 —— 以后改行高会把那 60 一起带偏');
    assert.equal(territoryMapContentPaddingTop(HUD_BOTTOM),
        HUD_BOTTOM + TERRITORY_MAP_HUD_GAP + 45 + TERRITORY_MAP_TOP_BREATH);
    assert.equal(territoryMapContentPaddingTop(HUD_BOTTOM), 266);
    // 找不到 HUD（单跑地图页）⇒ 只剩 15 + 45 + 60，不会算出负数。
    assert.equal(territoryMapContentPaddingTop(0), 120);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -100]) {
        const pad = territoryMapContentPaddingTop(bad);
        assert.ok(Number.isFinite(pad) && pad >= 0, `hudBottom=${bad} 算出了非法留白 ${pad}`);
    }
});

test('★★★滚到最顶时，第一排地块的**可见顶边**停在「HUD 底边 + 15 + 60」', () => {
    const padTop = territoryMapContentPaddingTop(HUD_BOTTOM);
    // 滚到顶（offset = 0）⇒ 内容层顶边贴视口顶边 ⇒ 包围盒顶边距视口顶部正好是 padTop。
    const bboxTopFromViewport = padTop;
    // 玩家真正看得见的是**格面**：它比格心高半个格面。
    const visibleTop = bboxTopFromViewport - TERRITORY_MAP_TOP_FACE_RISE;
    assert.ok(near(visibleTop, HUD_BOTTOM + TERRITORY_MAP_HUD_GAP + TERRITORY_MAP_TOP_BREATH),
        `第一排的可见顶边应停在 ${HUD_BOTTOM + TERRITORY_MAP_HUD_GAP + TERRITORY_MAP_TOP_BREATH}，实际 ${visibleTop}`);
    // 🔴 这一条就是第二轮用户口径：可见顶边要**离面板底边还有 60**，不是刚好贴上去。
    assert.ok(near(visibleTop - HUD_BOTTOM, TERRITORY_MAP_HUD_GAP + TERRITORY_MAP_TOP_BREATH),
        '可见顶边到面板底边必须留够 15 + 60（贴上去 = 玩家说的"卡在面板口上"）');
    // 反证：只加 GAP、不算那半个格面 ⇒ 第一排的上半张脸还压在面板后面（用户会再报一次）。
    const naive = HUD_BOTTOM + TERRITORY_MAP_HUD_GAP;
    assert.ok(naive - TERRITORY_MAP_TOP_FACE_RISE < HUD_BOTTOM,
        '只加 GAP 的话可见顶边还在 HUD 里面 —— 这就是必须算 FACE_RISE 的理由');
});

test('★★★两份留白一起决定尺寸与偏移（偏移 = (bottom − top)/2）', () => {
    const padBottom = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    const padTop = territoryMapContentPaddingTop(HUD_BOTTOM);
    assert.equal(territoryMapContentSize(LAYOUT, padBottom, padTop).height,
        LAYOUT.height + padBottom + padTop, '内容层高 = 包围盒 + 两份留白');
    assert.equal(territoryMapContentShiftY(padBottom, padTop), (padBottom - padTop) / 2,
        '偏移必须是两份留白差的一半（写错就滚到顶露半格空）');
    // 缺省仍然「底部 300 / 顶部 0」（不传参数的老调用不受影响）。
    assert.equal(territoryMapContentShiftY(), 150);
    assert.equal(territoryMapContentSize(LAYOUT).height, LAYOUT.height + 300);
});

test('★★★跳转到最上面那一格时，顶部留白要真的把偏移顶到 0', () => {
    const padBottom = territoryMapContentPaddingBottom(VIEWPORT.height, BOTTOM_INSET);
    const padTop = territoryMapContentPaddingTop(HUD_BOTTOM);
    const topCell = [...LAYOUT.points.entries()].reduce((acc, cur) => (cur[1].y > acc[1].y ? cur : acc));
    const withTop = territoryMapOffsetForCell(LAYOUT, topCell[0], VIEWPORT, {
        paddingBottom: padBottom,
        paddingTop: padTop,
    });
    const withoutTop = territoryMapOffsetForCell(LAYOUT, topCell[0], VIEWPORT, {
        paddingBottom: padBottom,
    });
    assert.ok(withTop.y >= 0 && withTop.y <= withoutTop.y + 1e-9,
        `顶部留白只会让最上面那格更容易滚到顶（${withTop.y} vs ${withoutTop.y}）`);
    // 顶部留白把可滚范围撑大了 ⇒ 上限（maxY）也必须跟着变大。
    const content = territoryMapContentSize(LAYOUT, padBottom, padTop);
    assert.ok(content.height - VIEWPORT.height
        > territoryMapContentSize(LAYOUT, padBottom).height - VIEWPORT.height,
        '顶部留白必须进内容层高，否则那一段根本滚不到');
});

test('★★★接线：视图要有 contentPaddingTop 字段 + setter，页面注入两份', () => {
    assert.match(stripComments(MAP_VIEW_SRC),
        /contentPaddingTop: number = TERRITORY_MAP_CONTENT_PADDING_TOP;/,
        '视图要带着顶部留白字段（缺省 0 = 老行为）');
    assert.match(stripComments(MAP_VIEW_SRC), /setContentPaddingTop\(padding: number\): void/,
        '要有 setter（偏移要跟着重写）');
    const code = stripComments(PAGE_SRC);
    assert.match(code, /mapView\.setContentPaddingTop\(territoryMapContentPaddingTop\(hudBottom\)\)/,
        '页面要把顶部留白注进去');
});
