/**
 * 领地「建筑 / 站点与格子居中对齐」的三层护栏。
 *
 * 🔴 **本文件是被引用的判据，此前在版本库里根本不存在** —— `AGENTS.md` 与
 * `docs/AI架构与代码规范.md` 都写着「判据 `tests/territory-cell-center-align.test.ts`」，
 * 但 `svn list` 里只有 `center-payment.test.ts` ⇒ 那条口径**一直没有 automated 守卫**，
 * 才让「恒等映射导致视觉偏下 12.5px」长期在线上（2026-10-15 才被发现）。
 *
 * 三层分别是：
 *  1. **落点**：建筑 / 站点 / 起始格必须落在 2.5D 地皮的**可见台面中心**，不是节点锚点；
 *  2. **逐图 trim 偏移**：美术留白不对称时，可见区中心不在画布中心 ⇒ 必须按帧补偿；
 *  3. **可见宽度归一**：这批美术画布有 128 与 212 两种规格，`sizeMode=CUSTOM` 会等比缩放
 *     ⇒ 不归一则同屏建筑大小差约 25%。
 *
 * 判据读 `.meta` 的真实数值（`trimX/trimY/width/height/rawWidth/rawHeight/offsetX/offsetY`），
 * 而不是把偏移量抄成字面量 —— 换美术图时判据会如实变红。
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

const MAP_VIEW_SRC = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const STATION_SRC = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const LAYOUT_SRC = readFileSync('assets/script/core/hex/HexGridLayout.ts', 'utf8');

/** 领地建筑图目录（`.png` 与 `.png.meta` 成对）。 */
const BUILDING_DIR = assetPath('image/territory/buildings');

/** `Icon` 节点在 prefab 里写死的尺寸 + `sizeMode`（`CUSTOM(0)`）。 */
const ICON_NODE_SIZE = 128;

/**
 * 代码里的目标可见宽度，与 `TerritoryStationView` 的常量必须一致。
 *
 * 2026-10-19：用户要求「当前尺寸调大 120%」⇒ 70 × 1.2 = **84**。
 */
const TARGET_VISIBLE_WIDTH = 84;

/** 地块可见台面高（`HEX_GRID_FACE_HEIGHT`）。 */
const FACE_HEIGHT = 90;

/** 地块可见台面宽（`HEX_GRID_FACE_WIDTH`）。 */
const FACE_WIDTH = 123;

/**
 * 归一后建筑可见高**不得超过台面高**的比例上限。
 *
 * 🔴 这条护栏是 2026-10-15 补的：早先判据写「不超过台面高的 1.6 倍」，
 * 于是 `TARGET_VISIBLE_WIDTH = 100`（可见高 78~89、几乎与台面等高）**顺利通过**，
 * 而截图上读作「建筑顶满格子 / 偏下」。真正的毛病是尺寸不是居中，判据却没拦住。
 *
 * 取值：`0.75`（2026-10-15，可见宽 70，最高 62.5）→ **0.85**（2026-10-19 放大到 84，
 * 最高的 `async_pvp` 75.0 = 台面高的 83.4%，0.75 会挡住）。
 * ⚠️ 0.85 是**跟着这次放大走的上限**，不是新基准：再往上加尺寸请先看截图，
 * 越过 1.0 就又回到「顶满格子」的老毛病。
 */
const MAX_VISIBLE_HEIGHT_RATIO = 0.85;

interface MetaTrim {
    readonly rawWidth: number;
    readonly rawHeight: number;
    readonly trimX: number;
    readonly trimY: number;
    readonly width: number;
    readonly height: number;
    readonly offsetX: number;
    readonly offsetY: number;
}

/**
 * 剥注释再看源码。
 *
 * ⚠️ **反向断言必须剥**（规则 104）：`syncGrid` 上方的说明注释里就写着
 * `HEX_GRID_CONTENT_LIFT`（解释「为什么格子节点不偏移」），不剥 ⇒ 那条
 * 「syncGrid 里不许出现台面偏移」会被自己的文档绊倒。
 */
function codeOf(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function readTrim(name: string): MetaTrim {
    const raw = JSON.parse(readFileSync(`${BUILDING_DIR}/${name}.png.meta`, 'utf8')) as {
        subMetas: Record<string, { userData: Record<string, unknown> }>;
    };
    const spriteFrame = Object.values(raw.subMetas).find((meta) => meta.userData?.trimX !== undefined);
    assert.ok(spriteFrame, `${name}.meta 找不到 spriteFrame 子元数据`);
    const d = spriteFrame.userData as unknown as MetaTrim;
    return d;
}

/**
 * 按引擎 `simple.ts` / `updateVertexData`（`trim === false` 分支）复算一遍渲染结果。
 *
 * 引擎把**整块画布**居中于节点，可见区因此偏 `offset * canvasScale`：
 * `canvasScale = nodeSize / originalSize`，`可见宽 = rect.width * canvasScale`。
 */
function visiblePlacement(meta: MetaTrim): {
    readonly visibleWidth: number;
    readonly visibleHeight: number;
    readonly shiftX: number;
    readonly shiftY: number;
} {
    const canvasScaleX = ICON_NODE_SIZE / meta.rawWidth;
    const canvasScaleY = ICON_NODE_SIZE / meta.rawHeight;
    return {
        visibleWidth: meta.width * canvasScaleX,
        visibleHeight: meta.height * canvasScaleY,
        shiftX: meta.offsetX * canvasScaleX,
        shiftY: meta.offsetY * canvasScaleY,
    };
}

const buildingNames = readdirSync(BUILDING_DIR)
    .filter((file) => file.endsWith('.png'))
    .map((file) => file.slice(0, -4))
    .sort();

// ============================================================
// 第一层：落点 —— 建筑必须贴在可见台面中心，不是节点锚点
// ============================================================

test('★★★cellCenter 必须上移 HEX_GRID_CONTENT_LIFT（2.5D 台面中心 ≠ 锚点）', () => {
    // 台面在图内 y=2~91（中心 46.5），整图 0~118（中心 59）⇒ 差 12.5。
    // 恒等映射会让所有建筑恒偏下 12.5 美术px —— 这正是本次修的现象。
    assert.match(LAYOUT_SRC, /export const HEX_GRID_CONTENT_LIFT = 12\.5;/,
        '台面偏移常量必须是 12.5（由地块底图逐行扫描得出，改它要先重量美术图）');

    const at = MAP_VIEW_SRC.indexOf('private cellCenter(');
    assert.ok(at > 0, 'TerritoryMapView 要有 cellCenter');
    const body = MAP_VIEW_SRC.slice(at, MAP_VIEW_SRC.indexOf('\n    private ', at + 10));
    assert.match(body, /y:\s*point\.y \+ HEX_GRID_CONTENT_LIFT/,
        'cellCenter 必须把内容上移到台面中心；恒等映射会让建筑恒偏下 12.5px');
    assert.ok(!/return \{ x: point\.x, y: point\.y \};\s*$/.test(body.trimEnd() + '\n'),
        '反向守卫：cellCenter 不许退回恒等映射');
});

test('★★格子节点本身的位置不许跟着偏移（那是蜂窝几何）', () => {
    // 行距 90 / 列距 92.25 都以「节点在锚点」为前提；节点一动，整张地图的错位就全乱了。
    const at = MAP_VIEW_SRC.indexOf('private syncGrid(');
    assert.ok(at > 0, 'TerritoryMapView 要有 syncGrid');
    const raw = MAP_VIEW_SRC.slice(at, MAP_VIEW_SRC.indexOf('\n    private ', at + 10));
    assert.match(raw, /node\.setPosition\(point\.x, point\.y, 0\)/,
        '格子节点必须仍摆在 layout 的格心上（偏移的只有格内内容）');
    // ⚠️ 剥注释后再判反向：`syncGrid` 的说明注释里就写着这个常量名（解释为何不偏移）。
    assert.ok(!/HEX_GRID_CONTENT_LIFT/.test(codeOf(raw)),
        'syncGrid 的**代码**里不许出现台面偏移 —— 格子节点偏移会破坏蜂窝几何与画家顺序');
});

test('★★落点必须覆盖起始格与全部站点类型（不能只改一处）', () => {
    // 起始格（主城）与普通站点各有一处 setMapPosition 调用，漏一处就有格子没对齐。
    const calls = MAP_VIEW_SRC.match(/setMapPosition\(/g) ?? [];
    assert.ok(calls.length >= 3,
        `syncStations 里应有起始格 + 站点 + 随机格三处 setMapPosition，实际 ${calls.length} 处`);
    // 三处都吃 cellCenter 的返回值。
    assert.equal((MAP_VIEW_SRC.match(/this\.cellCenter\(/g) ?? []).length, 3,
        'cellCenter 必须被起始格 / 站点 / 随机格三处各调一次');
});

// ============================================================
// 第二层：逐图 trim 偏移 —— 美术留白不对称必须被补偿
// ============================================================

test('★★★applyIconPlacement 必须同时做「可见宽度归一」与「trim 偏移补偿」', () => {
    assert.match(STATION_SRC, /private applyIconPlacement\(\)/,
        '要有 applyIconPlacement 作为图标落点/缩放的唯一写入口');
    const at = STATION_SRC.indexOf('private applyIconPlacement(');
    const body = STATION_SRC.slice(at, STATION_SRC.indexOf('\n    private ', at + 10));
    // 缩放：按 trim 后可见宽反算。
    assert.match(body, /const visibleWidth = trimmed\.width \* canvasScaleX;/,
        '必须用 trim 后的可见宽算缩放（用画布宽会把留白算进尺寸）');
    assert.match(body, /BUILDING_VISIBLE_WIDTH \/ visibleWidth/,
        '缩放必须归一到目标可见宽度');
    // 偏移：抵消 trim 造成的可见区偏离。
    assert.match(body, /const shiftX = frame\.offset\.x \* canvasScaleX \* scale;/,
        '必须按 frame.offset 补偿 trim 偏移（否则同类建筑高低不齐）');
    assert.match(body, /const shiftY = frame\.offset\.y \* canvasScaleY \* scale;/,
        '纵向 trim 偏移同样要补偿');
    // 🔴 反向：不能出现「无视帧差异的固定缩放」—— 那正是本条要修的病症。
    assert.ok(!/node\.setScale\(BUILDING_VISIBLE_WIDTH/.test(body),
        '不许用固定缩放冒充归一（不同帧画布尺寸不同，必须逐帧算）');
});

test('★★★换帧后必须重算落点（否则残留上一张建筑的缩放与偏移）', () => {
    // 站点节点是池化复用的（`TerritoryMapView` 按 cellId 借还），同一节点会先后挂不同建筑。
    // 只在 setMapPosition 里算一次 ⇒ render 换帧后不重算 ⇒ 缩放/偏移全是上一张的。
    // ⚠️ 用 `render(` 而不是 `public render(` —— 实现没写 `public` 修饰符，
    // 写死修饰符会让这条判据对格式改动过敏（假红）。
    const renderAt = STATION_SRC.indexOf('render(content:');
    assert.ok(renderAt > 0, 'TerritoryStationView 要有 render');
    const body = STATION_SRC.slice(renderAt, STATION_SRC.indexOf('\n    private ', renderAt));
    assert.match(body, /this\.setIcon\(content\.icon\);[\s\S]*?this\.applyIconPlacement\(\);/,
        'render 里换帧后必须紧接着重算落点（setIcon 与 applyIconPlacement 的顺序不能反）');
});

test('★★帧缺失 / 尺寸非法时必须退回「不缩放」而不是产出 NaN', () => {
    const at = STATION_SRC.indexOf('private applyIconPlacement(');
    const body = STATION_SRC.slice(at, STATION_SRC.indexOf('\n    private applyIconScale(', at));
    assert.match(body, /if \(!frame \|\| !canvas \|\| !trimmed \|\| !\(canvas\.width > 0\) \|\| !\(trimmed\.width > 0\)\)/,
        '必须显式挡掉帧缺失 / 画布宽 0 / trim 宽 0 —— 除零会得到 NaN 或 Infinity 并静默污染整批节点');
    assert.match(body, /this\.applyIconScale\(1\);/,
        '兜底分支要把缩放复位为 1（否则复用时会带着上一张的缩放）');
});

// ============================================================
// 第三层：数值护栏 —— 直接拿真实 meta 复算渲染结果
// ============================================================

test('★★★所有建筑按代码算出的可见宽度必须相等（对齐到目标值）', () => {
    assert.ok(buildingNames.length > 0, '建筑图目录不能为空');
    const rows = buildingNames.map((name) => {
        const meta = readTrim(name);
        const placement = visiblePlacement(meta);
        const scale = TARGET_VISIBLE_WIDTH / placement.visibleWidth;
        return {
            name,
            canvas: `${meta.rawWidth}x${meta.rawHeight}`,
            rawVisible: placement.visibleWidth,
            normalizedWidth: placement.visibleWidth * scale,
            normalizedHeight: placement.visibleHeight * scale,
            shiftX: placement.shiftX * scale,
            shiftY: placement.shiftY * scale,
        };
    });
    const console_ = console;
    console_.log('建筑归一后（目标可见宽 ' + TARGET_VISIBLE_WIDTH + '）:');
    for (const row of rows) {
        console_.log(
            `  ${row.name.padEnd(32)} 画布${row.canvas.padEnd(9)}`
            + ` 归一前可见宽 ${row.rawVisible.toFixed(1).padStart(6)}`
            + ` → ${row.normalizedWidth.toFixed(2)} x ${row.normalizedHeight.toFixed(1)}`
            + `  trim 补偿(${row.shiftX.toFixed(2)}, ${row.shiftY.toFixed(2)})`,
        );
    }
    for (const row of rows) {
        assert.ok(Math.abs(row.normalizedWidth - TARGET_VISIBLE_WIDTH) < 0.01,
            `${row.name} 归一后可见宽应为 ${TARGET_VISIBLE_WIDTH}，实际 ${row.normalizedWidth}`);
    }
});

test('★★★代码里的目标可见宽必须与判据一致（防两边各改一边）', () => {
    // 判据顶部写死了 TARGET_VISIBLE_WIDTH；若实现改了常量而判据没同步，
    // 下面所有数值护栏都会在「错误的尺寸」上判绿 ⇒ 这条专门钉住两个数字一致。
    const at = STATION_SRC.indexOf('const BUILDING_VISIBLE_WIDTH =');
    assert.ok(at > 0, 'TerritoryStationView 要有 BUILDING_VISIBLE_WIDTH 常量');
    const line = STATION_SRC.slice(at, STATION_SRC.indexOf('\n', at));
    const value = Number(line.split('=')[1].replace(';', '').trim());
    assert.equal(value, TARGET_VISIBLE_WIDTH,
        `实现的 BUILDING_VISIBLE_WIDTH=${value} 与判据的 TARGET_VISIBLE_WIDTH=${TARGET_VISIBLE_WIDTH} 不一致`);
    // 台面常量也要对上（判据里 FACE_WIDTH/FACE_HEIGHT 是手抄的）。
    assert.match(LAYOUT_SRC, /export const HEX_GRID_FACE_WIDTH = 123;/, '台面宽常量必须是 123');
    assert.match(LAYOUT_SRC, /export const HEX_GRID_FACE_HEIGHT = 90;/, '台面高常量必须是 90');
});

test('★★归一后建筑必须明显小于台面（不许「顶满格子」）', () => {
    // 🔴 这条是 2026-10-15 看截图后补的：建筑可见高若接近台面高 90，视觉上就是「撑满格子」，
    // 会被读成「偏下」，但根因是尺寸。横向与纵向都要留出呼吸空间。
    for (const name of buildingNames) {
        const meta = readTrim(name);
        const placement = visiblePlacement(meta);
        const scale = TARGET_VISIBLE_WIDTH / placement.visibleWidth;
        const width = placement.visibleWidth * scale;
        const height = placement.visibleHeight * scale;
        assert.ok(width <= FACE_WIDTH * 0.95,
            `${name} 归一后可见宽 ${width.toFixed(1)} 超出台面宽 123 的九成五，会压到邻格`);
        assert.ok(height <= FACE_HEIGHT * MAX_VISIBLE_HEIGHT_RATIO,
            `${name} 归一后可见高 ${height.toFixed(1)} 超过台面高 ${FACE_HEIGHT} 的 `
            + `${MAX_VISIBLE_HEIGHT_RATIO * 100}%（截图上会读成「顶满格子 / 偏下」）`);
    }
});

test('★★trim 偏移补偿量必须与 meta 实测一致（防止公式被改坏却看不出来）', () => {
    // 这批图里 `outpost_v1` 与 `bonus_v1` 的留白明显偏上（offsetY 分别 -5 / -9），
    // 是第二层存在的理由。判据钉住「补偿量 = offset × canvasScale × scale」这个关系，
    // 而不是钉死某个字面量 —— 换图后只要公式仍成立就应通过。
    for (const name of buildingNames) {
        const meta = readTrim(name);
        const placement = visiblePlacement(meta);
        const scale = TARGET_VISIBLE_WIDTH / placement.visibleWidth;
        const expectedShiftY = meta.offsetY * (ICON_NODE_SIZE / meta.rawHeight) * scale;
        assert.ok(Number.isFinite(expectedShiftY),
            `${name} 的 trim 补偿量算出非有限值（公式或 meta 有问题）`);
        // 补偿后可见区中心必须落在节点上 ⇒ 偏移被完全抵消。
        const residual = placement.shiftY * scale - expectedShiftY;
        assert.ok(Math.abs(residual) < 1e-9,
            `${name} 补偿后仍有 ${residual} 的纵向残差`);
    }
});

// ============================================================
// 第四层：`buildSize`（表「模型大小」）作为体量倍率
// ============================================================
//
//  表里的 `buildSize` 一度是死字段（r2 端标记为空 ⇒ 根本没导进 build.json）。
//  2026-10-22 接通后它必须是**乘在归一系数之上**的倍率，而不是替换归一 ——
//  前者保持「所有建筑等宽」的对齐前提，后者会让同一格里的建筑忽大忽小。

test('★★★buildSize 必须乘进缩放（不是替换归一系数）', () => {
    const at = STATION_SRC.indexOf('private applyIconPlacement(');
    const body = STATION_SRC.slice(at, STATION_SRC.indexOf('\n    private applyIconScale(', at));
    assert.match(body, /BUILDING_VISIBLE_WIDTH \/ visibleWidth : 1\) \* this\.iconSizeScale/,
        'scale 必须是「归一系数 × iconSizeScale」—— 少了乘号，表里的 buildSize 就不生效');
});

test('★★★体量倍率必须在算落点之前写入（否则池化复用时用上一格的倍率）', () => {
    const renderAt = STATION_SRC.indexOf('render(content:');
    assert.ok(renderAt > 0, 'TerritoryStationView 要有 render');
    const body = STATION_SRC.slice(renderAt, STATION_SRC.indexOf('\n    private ', renderAt));
    const assignAt = body.indexOf('this.iconSizeScale =');
    const applyAt = body.indexOf('this.applyIconPlacement()');
    assert.ok(assignAt > 0, 'render 里要写 this.iconSizeScale');
    assert.ok(applyAt > 0, 'render 里要调 applyIconPlacement');
    assert.ok(assignAt < applyAt, '先写倍率再算落点 —— 顺序反了会拿上一格的倍率画这一帧');
    // 倍率字段本身也要有默认 1（否则首次 render 之前就是 undefined，乘出来 NaN）。
    assert.match(STATION_SRC, /private iconSizeScale = 1;/,
        'iconSizeScale 初值必须是 1');
});
