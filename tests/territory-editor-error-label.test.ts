// 章节地图编辑器「校验失败 → 格子上画 error 标签」的接线守卫。
//
// 背景（2026-09-29 山猫报）：面板里只有一行 `randomSites.candidateCells cannot use fixed cell 153`，
// 20×20 的图上看不出 153 在哪 ⇒ 要在格子上标出来。定位算法本身在
// tools/map-editor/formats/territory-issue-cells.js，由 tests/territory-issue-cells.test.ts
// 用真校验器产出喂断言；这里只盯**编辑器侧的接线**（哪一步把标记算出来、画进哪一层、
// 改数据后会不会重算）—— 这条链任何一环断了都会静默退回「只在面板写一行字」。
//
// 零旗标命名导入（tests/ 没开 allowSyntheticDefaultImports）
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

test('错误标签独占一层（压在所有东西上面），且随层一起清缓存', () => {
    assert.match(source, /const layers = \{ grid: null, links: null, markers: null, errors: null \}/);
    assert.match(source, /layers\.errors = document\.createElementNS\(NS, 'g'\)/);
    assert.match(source, /layers\.errors\.setAttribute\('class', 'layer-errors'\)/);
    // 老 <g> 随旧层被摘掉 ⇒ 缓存必须一起清，否则新层永远拿不到节点
    const ensure = source.match(/function ensureLayers\(svg\) \{[\s\S]*?\n\}/);
    assert.ok(ensure, 'ensureLayers 应存在');
    assert.match(ensure[0], /errorCache\.clear\(\)/);
});

test('render() 里画错误标签，且只在最后一层动过时重排', () => {
    assert.match(source, /function renderErrors\(\) \{/);
    assert.match(source, /renderErrors\(\);\s*\/\/ ④/);
    const body = source.match(/function renderErrors\(\) \{[\s\S]*?\n\}/);
    assert.ok(body, 'renderErrors 应存在');
    // 逐格 diff：位置或原因没变就复用（对齐站点图标那套口径，别每帧重建）
    assert.match(body[0], /existing\.dataset\.sig === sig/);
    assert.match(body[0], /if \(errorsDirty\) \{/);
    assert.match(body[0], /for \(const key of wanted\.keys\(\)\) layers\.errors\.appendChild\(errorCache\.get\(key\)\)/);
});

test('标签本体：红环描格 + 角标，原因是 <title>（悬停可见）', () => {
    assert.match(source, /function createErrorMarker\(\{ cellId, cx, cy, ring, texts \}\)/);
    assert.match(source, /group\.dataset\.cellId = String\(cellId\)/);
    assert.match(source, /group\.dataset\.sig = `\$\{cx\}\|\$\{cy\}\|\$\{texts\.join\('\\u0001'\)\}`/);
    // 红环直接用格子自己的 d —— 别另算一份六边形（算两遍迟早对不齐）
    assert.match(source, /outline\.setAttribute\('d', ring\)/);
    assert.match(source, /entry = wanted\.get\(marker\.cellId\) \|\| \{ cellId: marker\.cellId, cx: cell\.cx, cy: cell\.cy, ring: cell\.path\.getAttribute\('d'\)/);
    // 一个格子多条错误时角标显示条数，一条显示 `!`
    assert.match(source, /glyph\.textContent = texts\.length > 1 \? String\(texts\.length\) : '!'/);
    // 越界 / 已不在图上的格号没有六边形，必须跳过
    assert.match(source, /const cell = gridCache\.cells\[marker\.cellId\];\s*\n\s*if \(!cell\) continue;/);
});

test('校验失败时算标记 + 立刻 render（老实现只写面板文本）', () => {
    const body = source.match(/function validateCurrent\(\) \{[\s\S]*?\n\}/);
    assert.ok(body, 'validateCurrent 应存在');
    assert.match(body[0], /errorMarkers = issuesToCellMarkers\(issues, data\);/);
    assert.match(body[0], /render\(\);\s+\/\/ ← 让格子上的 error 标签立刻出现/);
    // 通过时要把上一轮的标签清掉
    assert.match(body[0], /errorMarkers = \[\];\s+\/\/ 通过 ⇒ 把上一轮的格子 error 标签清掉/);
    // 文本要带格号前缀（issue 里自带格号的别加，免得像是两个格）
    assert.match(source, /function errorIssuesText\(issues, data, markers\)/);
    assert.match(source, /\? `\[格 \$\{cells\.join\('\/'\)\}\] \$\{text\}` : text;/);
    assert.match(source, /!\s*\/cell\(\?:Id\)\?\\s\+\\d\+\\b\/\.test\(text\)/);
});

test('出错之后继续编辑会重算标记（不用每次手动再点校验）', () => {
    assert.match(source, /function collectErrorMarkers\(\) \{/);
    assert.match(source, /function markErrorsStale\(\) \{\s*\n\s*if \(errorMarkers\.length\) errorsStale = true;/);
    // render() 里消费：只在有标记时才会被标脏 ⇒ 常态零开销
    assert.match(source, /if \(errorsStale\) \{\s*\n\s*errorsStale = false;/);
    assert.match(source, /errorMarkers = collectErrorMarkers\(\);/);
    assert.match(source, /showValidation\('ok', '格子上的 error 标签已全部消除。'\)/);
    // 数据改动点齐全：落笔 / 撤销重做 / 应用站点 / 删站点 / 改地图字段
    assert.match(source, /markErrorsStale\(\);\s+\/\/ 改完数据让格子上的 error 标签跟着重算/);
    assert.match(source, /function restore\(value\) \{ map = value; selectedCell = null;[^}]*markErrorsStale\(\);/);
    assert.match(source, /staminaCost: Number\(\$\('staminaCost'\)\.value\) \};\s*markErrorsStale\(\);\s*render\(\);/);
    assert.match(source, /map\.sites = map\.sites\.filter\(\(site\) => site\.cellId !== selectedCell\); selectedCell = null; markErrorsStale\(\); render\(\); \}\)/);
    assert.match(source, /setDirty\(true\);\s*\n\s*markErrorsStale\(\);\s*\n\s*render\(\);/);
    // 换图时旧格号作废
    assert.match(source, /function clearErrorMarkers\(\)/);
    assert.equal((source.match(/clearErrorMarkers\(\)/g) || []).length, 4, '定义 1 处 + 加载预设 2 处 + 导入 1 处');
});

test('点在 error 角标上也要落格（角标吃指针事件是为了 <title> 悬停，不能顺手吞掉落笔）', () => {
    assert.match(source, /const local = clientToLocal\(event\.clientX, event\.clientY\);/);
    assert.match(source, /const hit = cellAtLocal\(local\.x, local\.y\);/);
    assert.match(source, /return hit \? hit\.row \* Number\(map\.columns\) \+ hit\.col : -1;/);
});

test('territory.html 的样式：红环不吃指针事件、角标吃（否则 <title> 悬停不出）', () => {
    assert.match(html, /\.error-ring \{ fill:none; stroke:#ef4444[^}]*pointer-events:none \}/);
    assert.match(html, /\.error-bg, \.error-glyph \{ pointer-events:auto \}/);
    assert.match(html, /\.error-bg \{ fill:#ef4444/);
    assert.match(html, /\.error-glyph \{ fill:#fff; font:700 9px/);
});
