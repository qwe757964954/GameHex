import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    MAP_MARKER_BADGE_BOLD,
    MAP_MARKER_BADGE_FONT_SIZE,
    MAP_MARKER_BADGE_HEIGHT,
    MAP_MARKER_BADGE_LINE_HEIGHT,
    MAP_MARKER_BADGE_OUTLINE_WIDTH,
    MAP_MARKER_BADGE_SPACING_X,
    MAP_MARKER_BADGE_TEXT_Y,
    MAP_MARKER_BADGE_WIDTH,
} from '../assets/script/app/common/MapMarkerBadge';

/**
 * 关卡编号气泡（`1-1`）的文字样式，2026-10-28 按美术效果图对齐。
 *
 * 美术稿和当时线上实拍差在两处，**都不是字号**：
 *   ① 笔画：美术稿笔画约占字高 25%，常规体只有 14% ⇒ 必须 `isBold`；
 *   ② 字距：美术稿是 `1-1` 三字紧贴，线上是 `1 - 1`（字符串里塞了空格）。
 * 字号（`MAP_MARKER_BADGE_FONT_SIZE = 17`，2026-10-28 用户「调大 15%」：15 → 17.25 取整 17），
 * 字高/气泡高 ≈ 0.57 vs 美术 0.53，略偏大但仍在 88 宽内。这里**不钉字号数值**，
 * 只钉字重、字距、描边厚度，以及「间距不许写进字符串」。
 */

const stationView = (): string =>
    readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const mapView = (): string =>
    readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');

/**
 * 从源码里取 `export const X = '…';` 的字面量。
 *
 * `TerritoryMapView` 顶部 `import ... from 'cc'` ⇒ node 里**不能直接 import**（没有引擎），
 * 所以气泡文案这类纯字符串常量只能读文本比对。
 */
function textConst(source: string, name: string): string {
    const hit = source.match(new RegExp(`export const ${name} = '([^']*)';`));
    return hit ? hit[1] : '';
}

test('编号气泡必须加粗：美术稿笔画约占字高 25%，常规体只有 14%', () => {
    assert.equal(MAP_MARKER_BADGE_BOLD, true, '`1-1` 在美术稿上是超粗体，不加粗怎么调字号都不像');
    assert.match(stationView(), /this\.badgeLabel\.isBold = MAP_MARKER_BADGE_BOLD;/);
    // 反向：不能再有写死的 `isBold = false`
    assert.doesNotMatch(stationView(), /this\.badgeLabel\.isBold = false/,
        '气泡样式必须整组覆盖，不能回落到 prefab 的旧角标口径（12/16/常规体）');
});

test('加粗到顶后靠描边补厚度：outlineWidth 必须由代码覆盖', () => {
    // 系统字体只有常规 / 加粗两档，`isBold` 已是上限；17 号字沿用旧角标的 2px 描边仍偏细。
    assert.ok(MAP_MARKER_BADGE_OUTLINE_WIDTH > 2, '「调粗」落在描边上，必须大于旧角标的 2');
    assert.ok(MAP_MARKER_BADGE_OUTLINE_WIDTH <= MAP_MARKER_BADGE_FONT_SIZE / 4,
        '描边超过字号的 1/4 会把 `1-1` 的连字符糊成一坨');
    // prefab 里写的是旧口径，运行时被这里盖掉 ⇒ 两处一起改，且代码这行不许删。
    assert.match(stationView(), /this\.badgeLabel\.enableOutline = true;/);
    assert.match(stationView(), /this\.badgeLabel\.outlineWidth = MAP_MARKER_BADGE_OUTLINE_WIDTH;/);
});

test('字距走 spacingX，不许靠字符串里的空格凑', () => {
    assert.ok(MAP_MARKER_BADGE_SPACING_X < 0,
        'Arial 数字侧边距偏大，`1-1` 会显得松，要用负字距收紧');
    const source = mapView();
    assert.ok(source.includes('`${stage.chapterId}-${stage.stage}`'),
        '美术稿是 `1-1`，连字符两侧不留空格');
    assert.ok(!source.includes('`${stage.chapterId} - ${stage.stage}`'),
        '⛔ 空格宽度跟字号绑定，塞进字符串后换字号 / 换字体就会漂 —— 间距只能交给 spacingX');
});

test('renderLevelBubble 必须把字重 / 字距 / 行高 / 抬升真的写进 Label', () => {
    const source = stationView();
    assert.match(source, /this\.badgeLabel\.spacingX = MAP_MARKER_BADGE_SPACING_X;/);
    assert.match(source, /this\.badgeLabel\.lineHeight = MAP_MARKER_BADGE_LINE_HEIGHT;/);
    assert.match(source, /this\.badgeLabel\.node\.setPosition\(0, MAP_MARKER_BADGE_TEXT_Y, 0\);/);
    // 只剩字号一处硬编码是允许的，但要经常量出口
    assert.match(source, /this\.badgeLabel\.fontSize = MAP_MARKER_BADGE_FONT_SIZE;/);
});

test('行高要装得进文字节点，否则 SHRINK 会把刚调好的字号又缩回去', () => {
    assert.ok(MAP_MARKER_BADGE_LINE_HEIGHT >= MAP_MARKER_BADGE_FONT_SIZE,
        '行高小于字号会把字裁掉');
    assert.ok(MAP_MARKER_BADGE_HEIGHT >= MAP_MARKER_BADGE_LINE_HEIGHT,
        '文字节点只有 30 高，行高再大就会触发 Overflow.SHRINK 反缩字号');
});

test('文字抬升不能把自己顶出气泡框', () => {
    assert.ok(MAP_MARKER_BADGE_TEXT_Y > 0, '气泡底部有小尾巴，居中会被尾巴吃掉一截');
    assert.ok(MAP_MARKER_BADGE_TEXT_Y < MAP_MARKER_BADGE_HEIGHT / 2,
        '抬太多文字会顶到框上沿');
});

// ============================================================
// 气泡**文案**：初始点位「章节」、异步据点「PVP」（2026-10-28 山猫）
// ============================================================

test('初始点位必须挂「章节」气泡，且与站点气泡同一套底图', () => {
    const source = mapView();
    // 2026-10-28 二次：四字「章节选择」→ 两字「章节」（四字在 88 宽里顶格，两字留白更像美术稿）。
    assert.equal(textConst(source, 'TERRITORY_START_BUBBLE_TEXT'), '章节',
        '初始点位的提示文案固定为「章节」两字');
    // 起始格走 `ensureStartView` 那条路（`site: null`），气泡必须在那里注入。
    const at = source.indexOf('const view = this.ensureStartView();');
    assert.ok(at > 0, '要有 `ensureStartView` 的渲染段');
    const block = source.slice(at, source.indexOf('const seen = new Set<number>();', at));
    assert.match(block, /levelBubble: TERRITORY_START_BUBBLE_TEXT/,
        '初始点位不注入气泡文案 ⇒ `renderLevelBubble` 的 `text !== \'\'` 直接判假，气泡不会出现');
    // 底色复用「已通关」那张蓝：初始点开局就属于玩家，红底会读成"这里还有个关卡没打"。
    assert.match(block, /levelBubbleFrame: input\.art\.levelBubbleFrame/,
        '初始点位的气泡底图必须复用已通关那张（蓝），别跟着未通关一起变红');
    // 文案不许带空格 / 换行：气泡内宽 88、17 号字，「章节」两字正好 34 宽，塞空格纯属浪费预算。
    assert.doesNotMatch(source, /'章节\s*选择'/);
    assert.doesNotMatch(source, /'章节\s+'/);
});

test('异步据点的气泡文案必须是 PVP，不许再显示章节-关卡编号', () => {
    const source = mapView();
    assert.equal(textConst(source, 'TERRITORY_ASYNC_PVP_BUBBLE_TEXT'), 'PVP');
    // 判据必须在**编号之前**：异步据点也绑了 `stage`（configId 2000x），
    // 先算编号的话只有"没绑关卡"的异步据点才会变 —— 看起来像没改。
    const at = source.indexOf('levelBubble: isAsyncPvp');
    assert.ok(at > 0, '异步据点的判定要排在章节-关卡的模板串之前');
    assert.ok(at < source.indexOf('`${stage.chapterId}-${stage.stage}`'),
        '一旦把 `isAsyncPvp` 挪到编号后面，线上还是显示 `1-4`');
    // 反向：`isAsyncPvp` 那一支不许再拼编号。
    const branch = source.slice(at, source.indexOf('? TERRITORY_ASYNC_PVP_BUBBLE_TEXT', at));
    assert.doesNotMatch(branch, /chapterId/);
});

test('「章节」两字必须装得进气泡（不触发 SHRINK 缩字）', () => {
    const start = textConst(mapView(), 'TERRITORY_START_BUBBLE_TEXT');
    // 汉字宽度 ≈ 字号（17），两字 34；气泡内宽 88 ⇒ 富余 54。
    const textWidth = start.length * MAP_MARKER_BADGE_FONT_SIZE;
    assert.ok(start.length > 0 && textWidth <= MAP_MARKER_BADGE_WIDTH,
        `「${start}」${textWidth}px 装不进 ${MAP_MARKER_BADGE_WIDTH}px 的气泡，会被 SHRINK 缩成小字`);
    assert.ok('PVP'.length * MAP_MARKER_BADGE_FONT_SIZE <= MAP_MARKER_BADGE_WIDTH);
});
