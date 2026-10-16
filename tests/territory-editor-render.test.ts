// 零旗标写法：用命名导入，别 default import（`tests/` 没开 allowSyntheticDefaultImports，
// default 导入会带一串 TS1259/TS1343 噪声错误 —— 同 tests/server-select-panel.test.ts）。
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// 章节地图编辑器（tools/map-editor/territory-app.js）的渲染架构守卫。
//
// 背景（2026-09-29）：20×20 的地图一次 render() 要造 1063 个 SVG 节点，而拖拽绘制时
// 每个 rAF 都会 render() —— 实测单次 3.1ms + 强制布局，60 步拖拽主线程占用 22%。
// 重构成「元素复用 + 属性 diff」后：单次 0.2ms，拖拽主线程占用 10%，getScreenCTM
// 从每帧 1 次（脏布局下 ~2.3ms）降为每次拖拽 1 次。
// 这些断言盯住那几条「一旦被改回去就会静默变回卡顿」的实现要点 —— 纯源码形状，
// 因为编辑器逻辑全在闭包 + DOM 里，Node 测不到运行时。
const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

test('render() 不再清空整棵 SVG 重建（改成分层容器）', () => {
    assert.doesNotMatch(source, /svg\.replaceChildren\(\)/);   // 禁「空参数 svg.replaceChildren()」
    // 第四层 errors 是校验失败的格子标签（2026-09-29 加），同样只建一次
    assert.match(source, /svg\.replaceChildren\(layers\.grid, layers\.links, layers\.markers, layers\.errors\)/);
    assert.match(source, /function ensureLayers\(svg\)/);
});

test('格子骨架（400 个 path + 400 个 text）只在行列数变化时重建', () => {
    assert.match(source, /function ensureGrid\(rows, columns\)/);
    assert.match(source, /if \(gridCache\.rows === rows && gridCache\.columns === columns/);
    assert.match(source, /const cell = gridCache\.cells\[id\]/);
});

test('逐格属性 diff：值没变就不碰 DOM', () => {
    assert.match(source, /if \(cell\.path\.getAttribute\('class'\) !== nextClass\)/);
    assert.match(source, /if \(cell\.label\.textContent !== nextText\)/);
    assert.match(source, /if \(cell\.path\.style\.stroke !== nextStroke\)/);
    assert.match(source, /if \(cell\.path\.getAttribute\('class'\) !== nextClass\) cell\.path\.setAttribute\('class', nextClass\)/);
});

test('SVG width/height 值没变就不写（写属性会把整棵树弄脏）', () => {
    assert.match(source, /if \(svg\.getAttribute\('width'\) !== width\)/);
    assert.match(source, /if \(svg\.getAttribute\('height'\) !== height\)/);
});

test('站点图标的 diff key 用 cellId，不用 site.id（addSite 的编号会撞号）', () => {
    // addSite() 发的 id 是 `${type}_${sites.length + 1}`，擦掉再画会撞号
    // ⇒ 实测 75 个站点只有 68 个唯一 id。老实现按格子逐个 append 不去重，
    //    若用 site.id 当 Map key 会把重叠的图标悄悄吞掉（75 → 68）。
    assert.match(source, /wanted\.set\(`site-\$\{id\}`, \{ id: site\.id/);
    assert.doesNotMatch(source, /wanted\.set\(site\.id,/);
});

test('图标层增删后按 cellId 顺序重排（对齐老实现的 DOM 顺序）', () => {
    assert.match(source, /if \(markersDirty\) \{/);
    assert.match(source, /for \(const key of wanted\.keys\(\)\) layers\.markers\.appendChild\(markerCache\.get\(key\)\)/);
});

test('依赖线有指纹，没变就整层跳过', () => {
    assert.match(source, /if \(signature !== linkSignature\)/);
    assert.match(source, /linkSignature = signature;/);
});

test('pointermove 热路径缓存 getScreenCTM / getBoundingClientRect', () => {
    assert.match(source, /if \(ctmCache === null\)/);
    assert.match(source, /function svgRect\(\)/);
    assert.match(source, /function invalidateCtm\(\)/);
    // 失效点必须齐全，否则会画出错位的格子
    assert.match(source, /svg\.setAttribute\('viewBox', box\);[\s\S]{0,80}invalidateCtm\(\)/);
    assert.match(source, /window\.addEventListener\('resize', invalidateGeometry\)/);
    assert.match(source, /window\.addEventListener\('scroll', invalidateGeometry, true\)/);
    assert.match(source, /function beginDrag\(event\) \{\s*\n\s*invalidateGeometry\(\);/);
});

test('syncForm 逐字段比对再写（拖拽时每个 rAF 都会调到 render）', () => {
    assert.match(source, /if \(el\.value !== next\) el\.value = next/);
});

test('图标 <g> 仍以站点 id 命名、仍带类型 class（渲染重构没动对外可辨识属性）', () => {
    assert.match(source, /group\.setAttribute\('id', id\)/);
    assert.match(source, /group\.setAttribute\('class', `siteIcon \$\{type\}`\)/);
    assert.match(source, /group\.dataset\.sig = `\$\{type\}\|\$\{cx\}\|\$\{cy\}`/);
});

// ── 笔刷身份互斥（2026-09-29 山猫报「随机候选点别的笔刷不会覆盖」）
// 症状：候选笔刷画过的格子，切关卡/BOSS 再画，黄框（.cell.candidate 只改 stroke）和站点底色
//       （.cell.site-* 只改 fill）会**同时**留在同一个 <path> 上 ⇒ 看着就是没覆盖。
// 危害：territory-format.js:185 `randomSites.candidateCells cannot use fixed cell N`
//       ⇒ 手绘出来的存档必然校验红。原版 paint() 每个分支只写自己那份数据、从不摘旧身份。
test('笔刷落格时摘掉旧身份（候选 ↔ 站点 ↔ 初始格的互斥）', () => {
    assert.match(source, /function releaseCell\(cell\)/);
    // 站点也按 footprint 摘，不只是 cellId 相同的那条
    assert.match(source, /map\.sites = \(map\.sites \|\| \[\]\)\.filter\(\(site\) => !\(site\.footprint \|\| \[site\.cellId\]\)\.includes\(cell\)\)/);
    assert.match(source, /map\.randomSites\.candidateCells = \(map\.randomSites\.candidateCells \|\| \[\]\)\.filter\(\(item\) => item !== cell\)/);
    // 四条会「占格」的分支都必须先摘
    assert.match(source, /if \(mode === 'start'\) \{ releaseCell\(c\); map\.startCellId = c; \}/);
    assert.match(source, /else \{ releaseCell\(c\); values\.add\(c\); \}/);
    assert.match(source, /if \(mode === 'erase'\) \{ releaseCell\(c\);/);
    assert.match(source, /else if \(mode !== 'select'\) \{ if \(c === map\.startCellId\) continue; releaseCell\(c\); addSite\(c, mode\); \}/);
    // 候选是唯一 toggle 的笔刷：已在候选集里再点一次 = 取消，不能顺手清掉别的身份
    assert.match(source, /const values = new Set\(map\.randomSites\.candidateCells \|\| \[\]\);/);
    assert.match(source, /if \(values\.has\(c\)\) \{/);
    assert.match(source, /values\.delete\(c\);/);
});

// ── 逐格建筑 ID 与随机候选身份同生共死（2026-10-10）
// 症状：一格从「随机候选」改成固定站点 / 被擦掉后，`randomSites.buildingIds.N` 残留。
// 危害：`territory-format.js` 报 `randomSites.buildingIds.N is not a candidate cell`
//       ⇒ 策划只想改个格子类型，却被迫手工删 JSON，存档卡在红态过不了发布。
test('取消随机候选 / 被其它笔刷覆盖时，逐格建筑 ID 一起摘掉', () => {
    // releaseCell：候选身份被摘（画站点 / 画起点 / 擦除）时连带删 key
    assert.match(source, /if \(map\.randomSites\?\.buildingIds\) delete map\.randomSites\.buildingIds\[cell\];/);
    // paint 的 candidate 分支是 toggle，**不走** releaseCell，取消时必须自己删
    const candidateBranch = source.match(/else if \(mode === 'candidate'\) \{[\s\S]*?\n {4}\}/);
    assert.ok(candidateBranch, 'candidate 分支应存在');
    assert.match(candidateBranch[0], /delete map\.randomSites\.buildingIds\[c\]/);
    // 落笔前先把表单暂存的值写回（否则用户填完直接点别的格子会丢）
    assert.match(source, /if \(!applyRewardIdFromForm\(\)\) return;\r?\n {2}applyRandomBuildingIdFromForm\(\);/);
    // 格式刷复制随机候选时要连该格的建筑 ID 一起带走
    assert.match(source, /candidateBuildingId: map\.randomSites\?\.buildingIds\?\.\[cell\] \?\? '',/);
    assert.match(source, /if \(source\.candidateBuildingId\) \{/);
});

test('随机据点编辑区只在选中候选格时出现，且回填该格的建筑 ID', () => {
    assert.match(html, /<section id="randomSiteEditor" hidden>/);
    assert.match(source, /const isCandidate = selectedCell != null && \(map\.randomSites\?\.candidateCells \|\| \[\]\)\.includes\(selectedCell\);/);
    assert.match(source, /if \(randomEditor\.hidden !== !isCandidate\) randomEditor\.hidden = !isCandidate;/);
});

// 🔴 「保存没把随机据点建筑 ID 存进 json」的根因守卫（2026-10-10 山猫报）。
// 症状：填完建筑 ID 点保存，产物里没有 / 还是旧值。
// 根因：`render()`（拖拽 / hover / 保存后的重绘都会调）里 `syncForm()` **每次都回填**输入框，
//       用 `map` 里的旧值盖掉玩家刚敲的字 ⇒ 落盘的是旧值。
// 判据：建筑 ID 输入框**只在换格时**回填；改数据的入口（paint / applyFormatToCell / restore）
//       必须把 `lastFormCell` 置空强制重填，否则笔刷改了当前格也刷不出来。
test('建筑 ID 输入框只在换格时回填，不被每次 render 抹掉（保存丢值的根因守卫）', () => {
    assert.match(source, /if \(lastFormCell !== selectedCell\) \{\r?\n {4}lastFormCell = selectedCell;/,
        'syncForm 里的回填必须被 lastFormCell !== selectedCell 门控');
    // 三条改数据的路径都要强制失效，否则「笔刷改了当前格却刷不出来」
    assert.match(source, /function paint\(cell[\s\S]*?lastFormCell = null;\r?\n {2}if \(!skipRender\) render\(\);/);
    assert.match(source, /function applyFormatToCell\(cell, source\) \{[\s\S]*?lastFormCell = null;/);
    assert.match(source, /function restore\(value\) \{ map = value; selectedCell = null; lastFormCell = null;/);
    // 落盘前必须先从表单写回（表单是暂存区，数据在 map 上）
    assert.match(source, /function buildJSON\(\) \{\r?\n {2}applyRandomBuildingIdFromForm\(\);/);
});

test('decor 是叠加层，不参与身份互斥（校验器的 fixedCells 不含 decorations）', () => {
    const decorBranch = source.match(/if \(mode === 'decor'\) \{[^}]*\}/);
    assert.ok(decorBranch, 'decor 分支应存在');
    assert.doesNotMatch(decorBranch[0], /releaseCell/);
    // releaseCell 只摘 sites + candidateCells，绝不碰 decorations（否则会误删叠加层）
    const release = source.match(/function releaseCell\(cell\) \{[\s\S]*?\n\}/);
    assert.ok(release, 'releaseCell 函数体应存在');
    assert.doesNotMatch(release[0], /decorations/);
});

// ── 「依赖连线」显示开关（2026-10-01）
// 运行时（TerritoryMapView）已不再画站点解锁连线，查看职责落到编辑器这个开关上。
// 它必须满足两条：① 只切 SVG 那一层的显隐，不进地图 JSON；② 值没变不碰 DOM（render 每帧都跑）。
test('「依赖连线」开关：只切 layers.links 的显隐，且值没变不碰 DOM', () => {
    const apply = source.match(/function applyLinkVisibility\(\) \{[\s\S]*?\n\}/);
    assert.ok(apply, 'applyLinkVisibility 应存在');
    assert.match(apply[0], /if \(!layers\.links\) return;/);
    assert.match(apply[0], /const next = \$\('showLinks'\)\.checked;/);
    assert.match(apply[0], /if \(next === linksVisible\) return;/);
    assert.match(apply[0], /layers\.links\.style\.display = next \? '' : 'none';/);
    assert.match(source, /let linksVisible = null;/);
    // 层被重建（换地图 / 行列变化）后没有样式，必须强制重写一次
    const ensure = source.match(/function ensureLayers\(svg\) \{[\s\S]*?\n\}/);
    assert.ok(ensure, 'ensureLayers 应存在');
    assert.match(ensure[0], /linksVisible = null;/);
    // render() 里紧跟在 ensureLayers 之后同步；拖动勾选框直连
    const head = source.match(/function render\(\) \{[\s\S]*?ensureGrid\(rows, columns\);/);
    assert.ok(head, 'render 开头应存在');
    assert.match(head[0], /applyLinkVisibility\(\);/);
    assert.match(source, /\$\('showLinks'\)\.addEventListener\('change', applyLinkVisibility\);/);
});

test('「依赖连线」开关留在编辑器里：不污染地图 JSON 的数据层', () => {
    const html = readFileSync('tools/map-editor/territory.html', 'utf8');
    assert.match(html, /<input type="checkbox" id="showLinks" checked>/, '工具栏应有默认勾上的「依赖连线」');
    // formats/ 是「地图 JSON ⇄ 编辑器」的唯一转写层，开关绝不能出现在那里
    const format = readFileSync('tools/map-editor/formats/territory-format.js', 'utf8');
    assert.doesNotMatch(format, /showLinks|linksVisible/);
});
