/**
 * 领地装饰建筑「**底部对齐格子中心点**」的护栏（2026-10-27，用户需求口径）。
 *
 * ## 为什么要这一档
 *
 * 对齐的**始终是透明包围盒（trim）中心** —— `applyIconPlacement` 把可见区中心压到格心，
 * 残差恒 0（见 `tests/territory-cell-center-align.test.ts` 第二层）。但装饰物（树 / 树桩 / 小屋）
 * 是"站在地上"的：等高物体的**像素重心**偏向底部，按包围盒居中摆，高的树就有近一半探到
 * 台面前沿以外，读作"浮在格子上、没站住"。
 *
 * ⇒ 这 8 个 id 改成「**可见底边**压格心」：可见中心不再在格心，而是在格心正上方半个可见高。
 *
 * 🔴 **别再走「让美术把内容往下平移」那条路**：trim 会自动裁到 alpha bbox，内容平移后
 *    bbox 跟着走，代码照 bbox 中心对齐 ⇒ 屏幕上一个像素都不会变（上一轮踩过）。
 *
 * ## 四层断言
 *
 *  1. **白名单本身**：恰好 69008~69015，边界外的 id / 非有限值一律 `false`；
 *  2. **抬升量公式**：`可见高 × scale ÷ 2`，且 `scale` 里含 `buildSize` ⇒ 小体量的树抬得少；
 *  3. **池化复用**：同一节点先 `bottomAnchor: true` 再 `false`，抬升必须被完整清掉；
 *  4. **接线**：`render` 里必须在 `applyIconPlacement()` **之前**写入，
 *     `TerritoryMapView` 的站点与随机格两条路都要传。
 *
 * 白名单与判定函数都从**真实模块**取（`loadTerritoryStationModule`），不把 69008~69015
 * 抄进本文件 —— 抄一遍就等于两边各改一半也能一起绿。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    FakeColor,
    loadTerritoryStationModule,
    makeStationView,
    type StationRenderContent,
} from './helpers/territory-station-fixtures';

const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');

const stationModule = loadTerritoryStationModule() as unknown as {
    TERRITORY_BOTTOM_ANCHOR_BUILD_IDS: readonly number[];
    TERRITORY_BOTTOM_ANCHOR_DROP_PX: number;
    territoryUsesBottomAnchor: (buildId: number) => boolean;
};

const {
    TERRITORY_BOTTOM_ANCHOR_BUILD_IDS,
    TERRITORY_BOTTOM_ANCHOR_DROP_PX,
    territoryUsesBottomAnchor,
} = stationModule;

/**
 * 底部对齐那一档的「往下修」像素（用户 2026-10-27 逐图验收：树干下的落地影子也算进了包围盒）。
 *
 * 手抄一份是**故意的**：实现改了而这里没改，下面所有数值断言会一起红 —— 这正是想要的。
 */
const DROP = 4;

const near = (actual: number, expected: number, tolerance = 1e-9): boolean =>
    Math.abs(actual - expected) <= tolerance;

/** 剥注释后再判源码（反向断言必须剥 —— 说明注释里就写着被禁的写法）。 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 一张**带留白**的帧：128×128 画布、可见区 100×60、偏移 (0, 0)。
 *
 * 用非方形 + 有 trim 的帧（而不是 128×128 无留白）是刻意的：抬升量依赖
 * `trimmed.height × canvasScaleY`，方形无留白的帧会让「用错宽还是高」这类错法
 * 恰好算出相同数字（宽高都是 128）而静默通过。
 */
function frameOf(trimWidth: number, trimHeight: number, offsetX = 0, offsetY = 0): unknown {
    return {
        originalSize: { width: 128, height: 128 },
        rect: { width: trimWidth, height: trimHeight },
        offset: { x: offsetX, y: offsetY },
    };
}

/** 一张站点 render 内容（只覆盖本文件关心的字段）。 */
function contentOf(icon: unknown, extra: Partial<StationRenderContent> = {}): StationRenderContent {
    return {
        site: {},
        icon,
        caption: '',
        tint: new FakeColor(0, 0, 0, 255),
        badge: '',
        interactive: false,
        ...extra,
    };
}

/** 画一段帧并返回 `Icon` 节点的位置。 */
function iconYOf(view: ReturnType<typeof makeStationView>['view'], icon: unknown,
    extra: Partial<StationRenderContent> = {}): { x: number; y: number } {
    view.render(contentOf(icon, extra));
    const position = view.iconSprite.node.position;
    return { x: position.x, y: position.y };
}

// ============================================================
// 一、白名单（真实模块，不抄字面量）
// ============================================================

test('★★★白名单必须恰好是 69010~69013（逐图验收通过的四张）', () => {
    // ⚠️ `Array.from` 转成本 realm 的数组：vm 上下文里建出来的数组原型不同，
    //    `deepEqual` 会因原型不等而假红。
    assert.deepEqual(Array.from(TERRITORY_BOTTOM_ANCHOR_BUILD_IDS),
        [69010, 69011, 69012, 69013],
        '只有这四张走底部对齐；69008 / 69009（屋子）/ 69014 / 69015（树桩）已按用户验收退回居中');
});

test('★★★判定函数只认白名单内的 id，边界外与非有限值一律 false', () => {
    for (let id = 69010; id <= 69013; id += 1) {
        assert.equal(territoryUsesBottomAnchor(id), true, `${id} 应走底部对齐`);
    }
    // 被用户打叉的四个 + 边界外：多认一个 = 把居中档的建筑也抬起来，整排会浮。
    for (const id of [69008, 69009, 69014, 69015, 69007, 69016, 69000, 0, -1, 69010.5]) {
        assert.equal(territoryUsesBottomAnchor(id), false, `${id} 不许走底部对齐`);
    }
    // 🔴 非有限值：`TerritoryMapView` 的随机格分支可能拿到 `NaN`（格子没有 buildingId），
    //    若这里返 true，整批"没建筑的格子"都会被抬半个可见高。
    for (const id of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(territoryUsesBottomAnchor(id), false, `${String(id)} 不许走底部对齐`);
    }
});

// ============================================================
// 二、抬升量公式：可见高 × scale ÷ 2 − 4px
// ============================================================

test('★★★抬升量 = 半个可见高 − 4px（落地影子占了包围盒底部）', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    // 128×128 画布 / 可见区 100×60 ⇒ canvasScale = 1、visibleWidth = 100、visibleHeight = 60
    // ⇒ scale = BUILDING_VISIBLE_WIDTH(84) / 100 = 0.84 ⇒ 抬升 = 60 × 0.84 ÷ 2 − 4 = 21.2。
    const frame = frameOf(100, 60);
    const centered = iconYOf(view, frame);
    const bottom = iconYOf(view, frame, { bottomAnchor: true });

    assert.ok(near(bottom.y - centered.y, 21.2),
        `抬升量应为 60 × 0.84 ÷ 2 − 4 = 21.2，实际 ${bottom.y - centered.y}`);
    // 横向不许动：底部对齐只改纵向落点。
    assert.ok(near(bottom.x, centered.x), '底部对齐不许改变横向落点');
});

test('★★★「往下偏 4px」是常量，不跟 buildSize 一起缩', () => {
    // 用户口径是按**屏幕像素**给的（「往下偏移 4px」），所以 0.8 倍体量的树也只偏 4px。
    // 若有人把它乘进 scale，这条会红（会算成 3.2）。
    assert.equal(TERRITORY_BOTTOM_ANCHOR_DROP_PX, DROP);
    assert.equal(DROP, 4);
});

test('★★★抬升量随可见高变化（不同建筑的 trim 高不同）', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    // 同一宽度、可见高 40 ⇒ 抬升 = 40 × 0.84 ÷ 2 − 4 = 12.8（不是与 21.2 同值）。
    const short = frameOf(100, 40);
    const delta = iconYOf(view, short, { bottomAnchor: true }).y - iconYOf(view, short).y;
    assert.ok(near(delta, 12.8), `可见高 40 时应抬 12.8，实际 ${delta}`);
});

test('★★★buildSize 参与抬升量（小体量的树抬得少，否则底边会离格心）', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    // 69010~69013 这四棵树 `buildSize = 0.8` ⇒ 半个可见高那项 ×0.8，但 **−4px 不缩**：
    // 60 × 0.84 × 0.8 ÷ 2 − 4 = 16.16（若把 4 也乘进去会得到 12.16，这条会红）。
    const frame = frameOf(100, 60);
    const delta = iconYOf(view, frame, { bottomAnchor: true, iconScale: 0.8 }).y
        - iconYOf(view, frame, { iconScale: 0.8 }).y;
    assert.ok(near(delta, 16.16), `buildSize 0.8 时应抬 16.16，实际 ${delta}`);
});

test('★★trim 偏移与底部对齐互不干扰（两者是相加的两项）', () => {
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    // 同样的可见尺寸、但美术留白偏上（offsetY = −5）⇒ 抬升量必须仍是 21.2。
    // 若把 `anchorLiftY` 误写进 `shiftY`（或反过来），这条会红。
    const shifted = frameOf(100, 60, 0, -5);
    const delta = iconYOf(view, shifted, { bottomAnchor: true }).y - iconYOf(view, shifted).y;
    assert.ok(near(delta, 21.2), `trim 偏移不参与抬升量，应仍为 21.2，实际 ${delta}`);
});

// ============================================================
// 三、池化复用：抬升必须被完整清掉
// ============================================================

test('★★★池化复用：上一格是底部对齐、这一格是居中，节点不许残留抬升', () => {
    // 站点节点按 cellId 借还（见 `TerritoryMapView` 的站点池）⇒ 同一个 `TerritoryStationView`
    // 会先后挂「树（底部对齐）」和「关卡（居中）」两种建筑。
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    const frame = frameOf(100, 60);
    // 先拿一份"纯净"的居中落点当基准。
    const baseline = iconYOf(view, frame);

    const lifted = iconYOf(view, frame, { bottomAnchor: true });
    // 先确认这一帧**真的抬过** —— 否则下面那条「复用后回到基准」会被"两帧都没抬"蒙过去
    // （漏写 `this.bottomAnchored` 时正是这种巧合）。
    assert.ok(near(lifted.y - baseline.y, 21.2), `底部对齐那一帧应抬 21.2，实际 ${lifted.y - baseline.y}`);
    const afterReuse = iconYOf(view, frame, { bottomAnchor: false });
    assert.ok(near(afterReuse.y, baseline.y),
        `复用后居中的落点必须与基准一致（实际 ${afterReuse.y} vs ${baseline.y}）—— `
        + '`render` 里漏写 `bottomAnchored` 就会把上一格的抬升带过来');
});

test('★★★`bottomAnchor` 缺省与显式 false 必须逐像素等价', () => {
    // `ITerritoryStationRender.bottomAnchor` 是可选的；缺省语义必须是"居中"，
    // 不能因为 `undefined === true` 判假之外的写法（如 `?? this.bottomAnchored`）而带记忆。
    const { view } = makeStationView();
    view.setMapPosition(0, 0, 0);
    const frame = frameOf(100, 60);
    iconYOf(view, frame, { bottomAnchor: true });
    const omitted = iconYOf(view, frame);
    const explicitFalse = iconYOf(view, frame, { bottomAnchor: false });
    assert.ok(near(omitted.y, explicitFalse.y),
        `缺省 ${omitted.y} 与显式 false ${explicitFalse.y} 必须一致`);
    assert.ok(omitted.y < iconYOf(view, frame, { bottomAnchor: true }).y,
        '缺省必须是"居中"，不能退化成底部对齐');
});

// ============================================================
// 四、接线：写入时机与两条渲染路径
// ============================================================

test('★★★`bottomAnchored` 必须在 `applyIconPlacement()` 之前写入', () => {
    const renderAt = STATION_SRC.indexOf('render(content:');
    assert.ok(renderAt > 0, 'TerritoryStationView 要有 render');
    const body = STATION_SRC.slice(renderAt, STATION_SRC.indexOf('\n    private ', renderAt));
    const assignAt = body.indexOf('this.bottomAnchored =');
    const applyAt = body.indexOf('this.applyIconPlacement()');
    assert.ok(assignAt > 0, 'render 里必须写 this.bottomAnchored（每帧重写，否则池化复用带上一格的口径）');
    assert.ok(applyAt > 0, 'render 里要调 applyIconPlacement');
    assert.ok(assignAt < applyAt, '先写口径再算落点 —— 顺序反了这一帧用的就是上一格的口径');
    // 字段默认值必须是 false（居中），否则首次 render 之前 undefined 会被当假，行为看不出差异但语义脏。
    assert.match(STATION_SRC, /private bottomAnchored = false;/,
        'bottomAnchored 初值必须是 false（默认居中）');
});

test('★★★`TerritoryMapView` 的站点与随机格两条路都必须传 `bottomAnchor`', () => {
    const wiring = stripComments(MAP_VIEW_SRC);
    assert.match(wiring, /import \{[^}]*territoryUsesBottomAnchor[^}]*\} from '\.\/TerritoryStationView'/,
        'MapView 必须 import 判定函数（判定口径只留一份，别在渲染层再抄白名单）');
    // 站点路：`site.buildingId` 是字符串，必须 `Number(...)` 后再判。
    assert.match(wiring, /bottomAnchor:\s*territoryUsesBottomAnchor\(Number\(site\.buildingId\)\)/,
        '站点循环必须按 `Number(site.buildingId)` 判定');
    // 随机格路：`randomSites.buildingIds[cellId]` 可能是 `undefined` ⇒ 先挡非有限值。
    assert.match(wiring, /bottomAnchor:\s*Number\.isFinite\(buildingId\)\s*&&\s*territoryUsesBottomAnchor\(buildingId\)/,
        '随机格循环必须先挡非有限值再判定（否则 `undefined` 会走到白名单里）');
    // 反向：渲染层不许自己抄 id 列表（口径分裂的典型写法）。
    assert.doesNotMatch(wiring, /69008/,
        'TerritoryMapView 不许出现装饰 id 字面量 —— 白名单只在 TerritoryStationView 里');
});
