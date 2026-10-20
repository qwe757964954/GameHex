import {
  normalizeTerritoryMap, validateTerritoryMap, cellCoords,
} from './formats/territory-format.js';
import { bindZoomSlider, setDirtyBadge, syncZoomSlider } from './formats/ui-kit.js';
import {
  circleHexes, hexNeighbors as hexNeighborsOf,
  HEX_COLUMN_STEP, HEX_ROW_STEP,
} from './formats/hex-grid.js';
import { issueCells, issuesToCellMarkers } from './formats/territory-issue-cells.js';

const NS = 'http://www.w3.org/2000/svg';
const R = 24;
/** 列距 / 行距：与客户端 `hexGridLogicalPoint`（36 / 42）一致。
 *  原先 `Y = √3R ≈ 41.57` 比客户端差 1%，20 行累计偏 8px —— 编辑器摆的格和游戏里的格
 *  会差一点点，改图时看着对、进游戏偏一线。 */
const X = HEX_COLUMN_STEP;
const Y = HEX_ROW_STEP;
const $ = (id) => document.getElementById(id);
let mode = 'select';
let selectedCell = null;
// `syncForm` 上次回填建筑 ID 时对应的格子。建筑 ID 输入框**只在换格时回填**（见 syncForm 里的说明），
// 所以笔刷 / 格式刷改到当前格的数据后要把它置空，强制下一次 syncForm 重填。
let lastFormCell = null;
// 格式刷：采样到的源格站点配置（深拷贝，应用时重建 id/cellId/footprint）。
let formatSource = null;
let history = [];
let future = [];
let map = createMap();
let dirty = false;
let drag = null, brushRadius = 0, dragRaf = 0;
let viewportDrag = null;
let zoom = 1;
let viewX = 0;
let viewY = 0;
let pendingWarningMarkers = [];
let territoryPresets = [];
// 校验失败的格子标记：[{ cellId, text }]。校验器只给字符串，靠 formats/territory-issue-cells.js
// 反解成格号，再在格子上画红色 error 标签（只写一行「cannot use fixed cell 153」是找不到那格的）。
let errorMarkers = [];
let errorsStale = false;   // 出错之后数据又改过 ⇒ render() 里重算标记（不用手动再点校验）

// ── 渲染缓存：卡片式重建 → 元素复用 + 属性 diff（见 render()）
// 20×20 地图一次全量重建要造 1063 个 SVG 节点，而拖拽时每帧都会 render()。
// 下面这套缓存让 render() 只在**真的变了**的时候碰 DOM。
let ctmCache = null;            // 屏幕→SVG 用户坐标的逆矩阵（getScreenCTM 在脏布局下要 ~1.7ms）
let rectCache = null;           // #map 的 getBoundingClientRect（同样会强制布局）
const layers = { grid: null, links: null, markers: null, errors: null };
const gridCache = { rows: -1, columns: -1, cells: [] };   // cells[id] = { path, label, cx, cy }
const markerCache = new Map();  // markerId -> <g>
const errorCache = new Map();   // cellId -> error 标签 <g>
let linkSignature = '';         // 依赖线指纹，没变就不重画
// 「依赖连线」开关（工具栏 checkbox，纯编辑辅助）上一次**真写进 DOM** 的状态。
// null = 还没应用过（`ensureLayers()` 重建过层，必须无条件重写一次）。
let linksVisible = null;
function invalidateGeometry() { ctmCache = null; rectCache = null; }
// viewBox 变化只影响 CTM（svg 的 CSS 盒子没动）——平移视图时每帧都会走这里，
// 别顺手把 rectCache 也清了，否则每帧白付一次强制布局。
function invalidateCtm() { ctmCache = null; }
function svgRect() {
  if (!rectCache) rectCache = $('map').getBoundingClientRect();
  return rectCache;
}

function createMap() {
  return { version: 1, mapKind: 'territoryChapter', id: 'chapter_01', name: '第一章', chapterId: 1, rows: 20, columns: 20, startCellId: 205, background: '', defaults: { combatPower: 0, silverCost: 10, exploreSeconds: 2, staminaCost: 5 }, sites: [], randomSites: { triggerSilver: 1000, rewardPoolId: 'territory_random_01', candidateCells: [], maxActive: 1 }, decorations: [] };
}

function inferChapterId(id, fallback = 1) {
  const match = String(id || '').trim().match(/^chapter[_-]?(\d+)$/i);
  return match ? Number(match[1]) : fallback;
}

function snapshot() { return JSON.parse(JSON.stringify(map)); }
function setDirty(value) { dirty = value === true; setDirtyBadge($('dirtyBadge'), dirty); }
function commit() { history.push(snapshot()); if (history.length > 80) history.shift(); future = []; setDirty(true); }
function restore(value) { map = value; selectedCell = null; lastFormCell = null; markErrorsStale(); syncForm(); render(); }
function cellId(event) {
  const target = event.target.closest('.cell');
  if (target) return Number(target.dataset.cellId);
  // 点在 error 标签（圆点/红环/字号文本）上不是 .cell ⇒ 按坐标反查最近的格，
  // 否则「按在标签上」这一下会丢掉落笔（标签只在角落，但总有人正好点那儿）
  const local = clientToLocal(event.clientX, event.clientY);
  const hit = cellAtLocal(local.x, local.y);
  return hit ? hit.row * Number(map.columns) + hit.col : -1;
}
function cellCenter(rowOrId, col) {
  let row = rowOrId;
  if (col === undefined) { const c = cellCoords(rowOrId, Number(map.columns)); row = c.row; col = c.column; }
  return { x: R + col * X, y: Y + row * Y + (col % 2 ? -Y / 4 : Y / 4) };
}
function clientToLocal(clientX, clientY) {
  const svg = $('map');
  // ⚠️ getScreenCTM() 会强制同步布局：实测脏树 1746µs / 干净树 0.5µs（3500×）。
  // pointermove 每帧调一次 ⇒ 必须缓存，只在几何变化时失效。
  if (ctmCache === null) {
    const ctm = svg.getScreenCTM ? svg.getScreenCTM() : null;
    ctmCache = ctm && typeof ctm.inverse === 'function' && svg.createSVGPoint ? ctm.inverse() : false;
  }
  if (ctmCache) {
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const local = point.matrixTransform(ctmCache);
    return { x: local.x, y: local.y };
  }
  return { x: clientX, y: clientY };
}
function cellAtLocal(x, y) {
  const cols = Number(map.columns), rows = Number(map.rows);
  const qf = (x - R) / X;
  let best = null, bestDistance = Infinity;
  for (let col = Math.floor(qf) - 1; col <= Math.ceil(qf) + 1; col += 1) {
    if (col < 0 || col >= cols) continue;
    const offset = col % 2 ? -Y / 4 : Y / 4;
    const rf = (y - Y - offset) / Y;
    for (let row = Math.floor(rf) - 1; row <= Math.ceil(rf) + 1; row += 1) {
      if (row < 0 || row >= rows) continue;
      const c = cellCenter(row, col);
      const dx = x - c.x, dy = y - c.y, d = dx * dx + dy * dy;
      if (d < bestDistance) { bestDistance = d; best = { row, col }; }
    }
  }
  if (!best) return null;
  const c = cellCenter(best.row, best.col);
  if (Math.abs(x - c.x) > R || Math.abs(y - c.y) > Y / 2) return null;
  return best;
}
function walkStroke(from, to, emit) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.min(600, Math.ceil(distance / (R / 2))));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const hit = cellAtLocal(from.x + dx * t, from.y + dy * t);
    if (!hit) continue;
    const cells = brushCellsForCell(hit.row * Number(map.columns) + hit.col);
    for (const c of cells) emit(c);
  }
}
function showValidation(kind, text) { const box = $('validation'); box.hidden = !text; box.className = `validation ${kind || ''}`; box.textContent = text || ''; }

/**
 * flat-top 六边形（**压扁**：横向半宽 `R`、纵向半高 `Y/2`）。
 *
 * 🔴 不能再用极坐标 `R·cos/R·sin` —— 那只画正六边形（纵横半径都是 R）。
 *   2.5D 顶面 123:90 = 1.367 明显压扁，纵向半径是 `Y/2` 而不是 `R·√3/2`。
 */
function hexPath(cx, cy) {
  const H = Y / 2;
  const points = [[R, 0], [R / 2, H], [-R / 2, H], [-R, 0], [-R / 2, -H], [R / 2, -H]];
  return 'M' + points
    .map(([px, py]) => `${(cx + px).toFixed(2)},${(cy + py).toFixed(2)}`)
    .join(' L ') + ' Z';
}

function baseSize() {
  return {
    width: Math.max(300, Number(map.columns) * X + R * 3),
    height: Math.max(300, Number(map.rows) * Y + Y * 1.5),
  };
}

function clampView() {
  const { width, height } = baseSize();
  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const marginX = width * 0.25;
  const marginY = height * 0.25;
  viewX = Math.max(-marginX, Math.min(width - viewWidth + marginX, viewX));
  viewY = Math.max(-marginY, Math.min(height - viewHeight + marginY, viewY));
}

function applyView() {
  const { width, height } = baseSize();
  clampView();
  const box = `${viewX.toFixed(2)} ${viewY.toFixed(2)} ${(width / zoom).toFixed(2)} ${(height / zoom).toFixed(2)}`;
  const svg = $('map');
  if (svg.getAttribute('viewBox') !== box) {
    svg.setAttribute('viewBox', box);
    invalidateCtm();   // viewBox 变了 ⇒ CTM 也变
  }
  const info = `${Math.round(zoom * 100)}%`;
  if ($('zoomInfo').textContent !== info) $('zoomInfo').textContent = info;
  // 滑块跟着实时走（滚轮 / 适应窗口 / 代码设缩放都要同步，否则滑块会跟画面脱节）
  syncZoomSlider($('zoomSlider'), zoom * 100);
}

function resetView() {
  zoom = 1;
  viewX = 0;
  viewY = 0;
  applyView();
}

function pointerWorld(event) {
  const rect = svgRect();
  const { width, height } = baseSize();
  return {
    x: viewX + ((event.clientX - rect.left) / rect.width) * (width / zoom),
    y: viewY + ((event.clientY - rect.top) / rect.height) * (height / zoom),
  };
}

/**
 * 设到指定缩放。
 *
 * `anchorClient` 为 null 时以**视口中心**为锚（拖滑块用）；给坐标时以该点为锚（滚轮用，
 * 让光标底下的格子不动）。两种锚点混用是这类编辑器最常见的手感问题。
 */
function zoomTo(nextZoom, anchorClient) {
  const rect = svgRect();
  if (!rect.width || !rect.height) return;
  const anchor = anchorClient ?? { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const before = pointerWorld(anchor);
  zoom = Math.max(0.5, Math.min(4, nextZoom));
  const { width, height } = baseSize();
  const rx = (anchor.clientX - rect.left) / rect.width;
  const ry = (anchor.clientY - rect.top) / rect.height;
  viewX = before.x - rx * (width / zoom);
  viewY = before.y - ry * (height / zoom);
  applyView();
}

/** 滚轮：以光标为中心缩放。 */
function zoomAt(event, factor) {
  zoomTo(zoom * factor, { clientX: event.clientX, clientY: event.clientY });
}

function iconColor(type) {
  return ({ stage: '#2563eb', boss: '#dc2626', asyncPvp: '#9333ea', fixedResource: '#ca8a04', bonus: '#0891b2', start: '#16a34a', candidate: '#d97706' })[type] || '#334155';
}

function createMarker({ id, type, cx, cy, label }) {
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('id', id);
  group.setAttribute('class', `siteIcon ${type}`);
  group.dataset.markerId = id;
  // 指纹：类型 + 圆心变了就重建这个 <g>，否则复用（render() 的 diff 依据）
  group.dataset.sig = `${type}|${cx}|${cy}`;
  group.setAttribute('aria-label', label);
  const title = document.createElementNS(NS, 'title'); title.textContent = label; group.appendChild(title);
  const background = document.createElementNS(NS, 'circle');
  background.setAttribute('class', 'icon-bg'); background.setAttribute('cx', String(cx)); background.setAttribute('cy', String(cy - 9)); background.setAttribute('r', '8'); background.setAttribute('fill', iconColor(type)); group.appendChild(background);
  if (type === 'stage') {
    const flag = document.createElementNS(NS, 'path'); flag.setAttribute('class', 'icon-glyph'); flag.setAttribute('fill', 'none'); flag.setAttribute('d', `M${cx - 3},${cy - 14}v10m0,-9h6l-2,2 2,2h-6`); group.appendChild(flag);
  } else if (type === 'boss') {
    const crown = document.createElementNS(NS, 'path'); crown.setAttribute('class', 'icon-glyph'); crown.setAttribute('d', `M${cx - 5},${cy - 11}l2,4 3,-5 3,5 2,-4 1,7h-12z`); group.appendChild(crown);
  } else if (type === 'asyncPvp') {
    const swords = document.createElementNS(NS, 'path'); swords.setAttribute('class', 'icon-glyph'); swords.setAttribute('fill', 'none'); swords.setAttribute('d', `M${cx - 4},${cy - 13}l8,8m-8,-8v3m8,5v3m0,-11l-8,8m8,-8v3m-8,5v3`); group.appendChild(swords);
  } else if (type === 'fixedResource') {
    const coin = document.createElementNS(NS, 'circle'); coin.setAttribute('class', 'icon-glyph'); coin.setAttribute('cx', String(cx)); coin.setAttribute('cy', String(cy - 9)); coin.setAttribute('r', '4'); coin.setAttribute('fill', 'none'); group.appendChild(coin);
    const mark = document.createElementNS(NS, 'text'); mark.textContent = '$'; mark.setAttribute('x', String(cx)); mark.setAttribute('y', String(cy - 9)); group.appendChild(mark);
  } else if (type === 'bonus') {
    const gift = document.createElementNS(NS, 'path'); gift.setAttribute('class', 'icon-glyph'); gift.setAttribute('d', `M${cx - 5},${cy - 10}h10v8h-10zM${cx},${cy - 10}v8m-6,-5h12`); gift.setAttribute('fill', 'none'); group.appendChild(gift);
  } else if (type === 'start') {
    const home = document.createElementNS(NS, 'path'); home.setAttribute('class', 'icon-glyph'); home.setAttribute('d', `M${cx - 5},${cy - 8}l5,-5 5,5v6h-10z`); group.appendChild(home);
  } else {
    const question = document.createElementNS(NS, 'text'); question.textContent = '?'; question.setAttribute('x', String(cx)); question.setAttribute('y', String(cy - 9)); group.appendChild(question);
  }
  return group;
}

function warningMarkersFor(result) {
  const warnings = result.warnings || [];
  const sites = result.map?.sites || map.sites;
  const markers = [];
  for (const warning of warnings) {
    const count = warning.match(/has (\d+) fixed sites; expected (\d+) levels/);
    if (count) {
      const text = `固定站点 ${count[1]}/${count[2]}`;
      const targets = sites.length ? sites : [{ cellId: result.map?.startCellId ?? map.startCellId }];
      targets.forEach((site) => markers.push({ cellId: site.cellId, text }));
      continue;
    }
    if (warning.includes('fixed site occupancy')) {
      sites.forEach((site) => markers.push({ cellId: site.cellId, text: '固定站点过多' }));
    }
  }
  return markers;
}

function appendWarningText(svg, { cellId, text, offset = 0 }) {
  const { x, y } = cellCenter(cellId);
  const node = document.createElementNS(NS, 'text');
  node.classList.add('validationFloat');
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y - 26 - offset));
  node.textContent = text;
  svg.appendChild(node);
  window.setTimeout(() => node.remove(), 2200);
}

// ── 校验失败的「格子 error 标签」
// 右侧面板只写一行 `randomSites.candidateCells cannot use fixed cell 153`，那个 153 是没法
// 在 20×20 图上找的。所以：红环描出格子 + 右上角红点「!」（一个格子多条时显示条数），
// 完整原因挂在 <title> 里（悬停可见），面板里也给每条加 `[格 N]` 前缀。
const ERROR_BADGE_DX = 14;
const ERROR_BADGE_DY = -14;
const ERROR_BADGE_R = 7;

function createErrorMarker({ cellId, cx, cy, ring, texts }) {
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'cellError');
  group.dataset.cellId = String(cellId);
  // 指纹：位置或原因变了就重建这个 <g>，否则复用（对齐 markerCache 的 diff 口径）
  group.dataset.sig = `${cx}|${cy}|${texts.join('\u0001')}`;
  const title = document.createElementNS(NS, 'title');
  title.textContent = texts.join('\n');
  group.appendChild(title);
  const outline = document.createElementNS(NS, 'path');
  outline.setAttribute('class', 'error-ring');
  outline.setAttribute('d', ring);
  group.appendChild(outline);
  const bx = cx + ERROR_BADGE_DX;
  const by = cy + ERROR_BADGE_DY;
  const background = document.createElementNS(NS, 'circle');
  background.setAttribute('class', 'error-bg');
  background.setAttribute('cx', String(bx));
  background.setAttribute('cy', String(by));
  background.setAttribute('r', String(ERROR_BADGE_R));
  group.appendChild(background);
  const glyph = document.createElementNS(NS, 'text');
  glyph.setAttribute('class', 'error-glyph');
  glyph.setAttribute('x', String(bx));
  glyph.setAttribute('y', String(by));
  glyph.textContent = texts.length > 1 ? String(texts.length) : '!';
  group.appendChild(glyph);
  return group;
}

// 数据改过之后重算标记；没问题就返回空数组（沿用校验器的判定，不另写一套规则）
function collectErrorMarkers() {
  const data = buildJSON();
  try {
    validateTerritoryMap(data);
    return [];
  } catch (error) {
    const issues = Array.isArray(error.issues) ? error.issues : [String(error.message ?? error)];
    return issuesToCellMarkers(issues, data);
  }
}

// 只在「当前有标记」时才标脏：没有错误时编辑不额外付一次校验
function markErrorsStale() {
  if (errorMarkers.length) errorsStale = true;
}

// 换图（加载预设 / 导入）时旧标记一律作废 —— 格号对应的已经不是同一张图了
function clearErrorMarkers() {
  errorMarkers = [];
  errorsStale = false;
}

// 面板文本：给不带格号的 issue 补 `[格 N]` 前缀（带格号的别加，免得看着像两个格）
function errorIssuesText(issues, data, markers) {
  const lines = issues.map((issue) => {
    const text = String(issue);
    const cells = issueCells(text, data);
    return cells.length && !/cell(?:Id)?\s+\d+\b/.test(text) ? `[格 ${cells.join('/')}] ${text}` : text;
  });
  const marked = new Set(markers.map((marker) => marker.cellId)).size;
  return marked ? `${lines.join('\n')}\n\n已在 ${marked} 个格子上画出 error 标签（悬停标签看完整原因）。` : lines.join('\n');
}

function renderErrors() {
  if (!layers.errors) return;
  const wanted = new Map();
  for (const marker of errorMarkers) {
    const cell = gridCache.cells[marker.cellId];
    if (!cell) continue;   // 越界 / 已不在图上的格号：没有六边形可标
    const entry = wanted.get(marker.cellId) || { cellId: marker.cellId, cx: cell.cx, cy: cell.cy, ring: cell.path.getAttribute('d'), texts: [] };
    if (!entry.texts.includes(marker.text)) entry.texts.push(marker.text);
    wanted.set(marker.cellId, entry);
  }
  let errorsDirty = false;
  for (const [key, group] of errorCache) {
    if (!wanted.has(key)) { group.remove(); errorCache.delete(key); errorsDirty = true; }
  }
  for (const [key, spec] of wanted) {
    const sig = `${spec.cx}|${spec.cy}|${spec.texts.join('\u0001')}`;
    const existing = errorCache.get(key);
    if (existing && existing.dataset.sig === sig) continue;
    if (existing) existing.remove();
    const group = createErrorMarker(spec);
    layers.errors.appendChild(group);
    errorCache.set(key, group);
    errorsDirty = true;
  }
  if (errorsDirty) {
    for (const key of wanted.keys()) layers.errors.appendChild(errorCache.get(key));
  }
}

// 四层容器只建一次：格子骨架 / 依赖线 / 站点图标 / 校验错误标签。
// 老实现是每次 render() 把整棵 SVG replaceChildren() 再重建 1063 个节点，
// 而拖拽时每帧都会 render() —— 那就是卡顿的来源。
function ensureLayers(svg) {
  if (layers.grid && layers.grid.parentNode === svg) return;
  layers.grid = document.createElementNS(NS, 'g');
  layers.grid.setAttribute('class', 'layer-grid');
  layers.links = document.createElementNS(NS, 'g');
  layers.links.setAttribute('class', 'layer-links');
  layers.markers = document.createElementNS(NS, 'g');
  layers.markers.setAttribute('class', 'layer-markers');
  layers.errors = document.createElementNS(NS, 'g');
  layers.errors.setAttribute('class', 'layer-errors');
  svg.replaceChildren(layers.grid, layers.links, layers.markers, layers.errors);
  markerCache.clear();
  errorCache.clear();            // 旧 <g> 随旧层一起被摘掉，缓存必须一起清（否则新层永远拿不到节点）
  gridCache.rows = -1;           // 强制重建格子骨架
  gridCache.columns = -1;
  gridCache.cells = [];
  linkSignature = '';
  linksVisible = null;           // 新层没有样式，开关状态必须重新写一遍（见 applyLinkVisibility）
}

// 「依赖连线」开关：只切 layers.links 这一层的显隐。
//
// 与 `linkSignature` 分工明确 —— 指纹管「**要不要重画**」，本开关管「画完**要不要露出来**」，
// 所以状态落在层的 `style.display` 上，重画链路（render 里那段 replaceChildren）完全不必知道开关。
// 值没变就绝不碰 DOM：render() 在拖拽时每个 rAF 都会调到，无脑写 style 会白白触发样式重算。
function applyLinkVisibility() {
  if (!layers.links) return;
  const next = $('showLinks').checked;
  if (next === linksVisible) return;
  linksVisible = next;
  layers.links.style.display = next ? '' : 'none';
}

// 400 个格子骨架（path + 标签）只在行列数变化时重建。
// 原来这部分每帧都要跑：400 次 hexPath() 字符串拼接 + 800 次 createElementNS。
function ensureGrid(rows, columns) {
  if (gridCache.rows === rows && gridCache.columns === columns && gridCache.cells.length === rows * columns) return;
  layers.grid.replaceChildren();
  const cells = new Array(rows * columns);
  for (let id = 0; id < rows * columns; id += 1) {
    const { row, column } = cellCoords(id, columns);
    const cx = R + column * X;
    const cy = Y + row * Y + (column % 2 ? -Y / 4 : Y / 4);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', hexPath(cx, cy));
    path.dataset.cellId = String(id);
    path.setAttribute('class', 'cell');
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(cx)); label.setAttribute('y', String(cy + 4)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '9');
    layers.grid.appendChild(path);
    layers.grid.appendChild(label);
    cells[id] = { path, label, cx, cy };
  }
  gridCache.cells = cells;
  gridCache.rows = rows;
  gridCache.columns = columns;
  invalidateCtm();
}

function render() {
  const rows = Number(map.rows), columns = Number(map.columns);
  const svg = $('map');
  const warningMarkers = pendingWarningMarkers;
  pendingWarningMarkers = [];
  const dimensions = baseSize();
  const width = String(dimensions.width), height = String(dimensions.height);
  // 值没变就别写：改属性会把整棵树弄脏，下一次 getScreenCTM() 要付 ~1.7ms 强制布局
  if (svg.getAttribute('width') !== width) { svg.setAttribute('width', width); invalidateCtm(); }
  if (svg.getAttribute('height') !== height) { svg.setAttribute('height', height); invalidateCtm(); }
  ensureLayers(svg);
  applyLinkVisibility();   // 开关状态与层的显隐同步（重建过层时强制重写一次）
  ensureGrid(rows, columns);
  // 校验失败后继续编辑：标记跟着数据走（不用每次手动再点「校验」）。
  // 没有错误在显示时 errorsStale 恒为 false ⇒ 常态零开销。
  if (errorsStale) {
    errorsStale = false;
    const previous = errorMarkers.length;
    errorMarkers = collectErrorMarkers();
    if (previous && !errorMarkers.length) showValidation('ok', '格子上的 error 标签已全部消除。');
  }
  const siteByCell = new Map();
  for (const site of map.sites) {
    for (const id of site.footprint || [site.cellId]) siteByCell.set(id, site);
  }
  // 同一战斗 id 的分组（选中任意一格 ⇒ 整组框出来）
  const groupCells = new Set(selectedCell == null ? [] : siteGroupCells(selectedCell));
  const candidates = new Set(map.randomSites?.candidateCells || []);
  const decorations = new Set((map.decorations || []).map((item) => item.cellId));
  // ① 格子：只改真的变了的属性（拖拽时每帧通常只有 1~2 格变，其余 399 次是字符串比较）
  for (let id = 0; id < rows * columns; id += 1) {
    const cell = gridCache.cells[id];
    if (!cell) continue;
    const site = siteByCell.get(id);
    const classes = ['cell'];
    if (id === map.startCellId) classes.push('start');
    if (site) classes.push(`site-${site.type}`);
    if (candidates.has(id)) classes.push('candidate');
    if (decorations.has(id)) classes.push('decor');
    if (groupCells.has(id)) classes.push('site-group');
    const nextClass = classes.join(' ');
    if (cell.path.getAttribute('class') !== nextClass) cell.path.setAttribute('class', nextClass);
    // 描边走内联（class 里的 stroke 会被它盖掉），所以分组色也只能在这里定。
    const nextStroke = id === selectedCell ? '#fff' : groupCells.has(id) ? '#22d3ee' : '';
    if (cell.path.style.stroke !== nextStroke) cell.path.style.stroke = nextStroke;
    const nextText = site ? site.id.replace(/^(stage_|boss_)/, '') : String(id);
    if (cell.label.textContent !== nextText) cell.label.textContent = nextText;
  }

  // ② 站点 / 初始格 / 候选格图标：按 id 求差集，只增删变的那个 <g>
  // ⚠️ key 必须用 **cellId**，不能用 site.id —— addSite() 发的编号是 `${type}_${sites.length + 1}`，
  //    擦掉再画会撞号（实测 75 个站点里只有 68 个唯一 id）。老实现按格子逐个 append 不去重，
  //    用 site.id 当 key 会把重叠的站点图标悄悄吞掉。
  let markersDirty = false;
  const wanted = new Map();
  for (let id = 0; id < rows * columns; id += 1) {
    const cell = gridCache.cells[id];
    if (!cell) continue;
    const site = siteByCell.get(id);
    if (site) wanted.set(`site-${id}`, { id: site.id, type: site.type, cx: cell.cx, cy: cell.cy, label: `${site.id} · ${site.type}` });
    else if (id === map.startCellId) wanted.set(`start-${id}`, { id: `start-${id}`, type: 'start', cx: cell.cx, cy: cell.cy, label: `初始格 ${id}` });
    else if (candidates.has(id)) wanted.set(`candidate-${id}`, { id: `candidate-${id}`, type: 'candidate', cx: cell.cx, cy: cell.cy, label: `随机候选格 ${id}` });
  }
  for (const [key, group] of markerCache) {
    if (!wanted.has(key)) { group.remove(); markerCache.delete(key); markersDirty = true; }
  }
  for (const [key, spec] of wanted) {
    const sig = `${spec.type}|${spec.cx}|${spec.cy}`;
    const existing = markerCache.get(key);
    if (existing && existing.dataset.sig === sig) continue;
    if (existing) existing.remove();
    const group = createMarker(spec);
    layers.markers.appendChild(group);
    markerCache.set(key, group);
    markersDirty = true;
  }
  // 层内顺序对齐老实现（按 cellId 递增）：新建的图标会落到末尾，不重排 DOM 顺序就与原版不同。
  // appendChild 对已在文档里的节点是 move（不重建），且只在真有增删的帧付这个钱。
  if (markersDirty) {
    for (const key of wanted.keys()) layers.markers.appendChild(markerCache.get(key));
  }
  // ③ 依赖线：算一遍指纹，没变就整层跳过（拖拽画格时新增站点会改指纹，正常重画）
  const pairs = [];
  for (const site of map.sites) {
    const from = cellCenter(site.cellId);
    for (const requiredCell of site.unlock.requiredCells) {
      const to = requiredCell === map.startCellId || siteByCell.has(requiredCell) ? cellCenter(requiredCell) : null;
      if (!to) continue;
      pairs.push([from.x, from.y, to.x, to.y]);
    }
  }
  const signature = pairs.map((pair) => pair.join(',')).join(';');
  if (signature !== linkSignature) {
    linkSignature = signature;
    layers.links.replaceChildren();
    for (const [x1, y1, x2, y2] of pairs) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
      line.classList.add('dependency');
      layers.links.appendChild(line);
    }
  }
  const buildingIdCount = Object.keys(map.randomSites?.buildingIds || {}).length;
  const status = `${rows}×${columns}，站点 ${map.sites.length}，随机候选 ${(map.randomSites?.candidateCells || []).length}`
    + `${buildingIdCount ? `（已配建筑 ${buildingIdCount}）` : ''}${dirty ? ' · 未保存' : ' · 已保存'}`;
  if ($('status').textContent !== status) $('status').textContent = status;
  renderErrors();   // ④ 校验错误标签（最后一层，压在所有东西上面）
  warningMarkers.forEach((marker, index) => appendWarningText(svg, { ...marker, offset: (index % 2) * 13 }));
  syncForm();
  applyView();
}

// 逐字段比对再写：render() 现在会被拖拽每帧调到，无脑写 15 个 input 会白白触发样式/布局检查。
function setField(id, value) {
  const el = $(id);
  const next = String(value);
  if (el.value !== next) el.value = next;
}

function syncRewardField(type) {
  $('fixedResourceRewardField').hidden = type !== 'fixedResource';
}

function applyRewardIdFromForm() {
  const site = siteAtCell(selectedCell);
  if (!site || site.type !== 'fixedResource') return true;
  const rewardText = $('rewardId').value.trim();
  const rewardId = rewardText === '' ? null : Number(rewardText);
  if (rewardId !== null && (!Number.isInteger(rewardId) || rewardId <= 0)) {
    message('固定资源奖励 ID 必须是正整数');
    $('rewardId').focus();
    return false;
  }
  if ((site.rewardId ?? null) === rewardId) return true;
  commit();
  if (rewardId === null) delete site.rewardId;
  else site.rewardId = rewardId;
  markErrorsStale();
  return true;
}

function applyBatchRewardId() {
  const rewardText = $('batchRewardId').value.trim();
  const rewardId = Number(rewardText);
  if (!rewardText || !Number.isInteger(rewardId) || rewardId <= 0) {
    message('批量奖励 ID 必须是正整数');
    $('batchRewardId').focus();
    return false;
  }
  const sites = map.sites.filter((site) => site.type === 'fixedResource');
  if (!sites.length) {
    message('当前地图没有固定资源格');
    return false;
  }
  const changed = sites.filter((site) => site.rewardId !== rewardId);
  if (changed.length) {
    commit();
    for (const site of changed) site.rewardId = rewardId;
    markErrorsStale();
    render();
  }
  message(`已批量设置 ${sites.length} 个固定资源格的奖励 ID 为 ${rewardId}，按 Ctrl+S 保存`);
  return true;
}

// 随机据点的建筑 ID：写回**当前选中那一格**（与 applyRewardIdFromForm 同一口径 —— 表单是暂存，
// 数据在 map 上，校验/保存前才落一次）。
function applyRandomBuildingIdFromForm() {
  const cell = selectedCell;
  const random = map.randomSites;
  if (cell == null || !random || !(random.candidateCells || []).includes(cell)) return true;
  const buildingId = $('randomBuildingId').value.trim();
  const current = random.buildingIds?.[cell] ?? '';
  if (current === buildingId) return true;
  commit();
  if (!buildingId) {
    if (random.buildingIds) delete random.buildingIds[cell];
  } else {
    random.buildingIds = { ...(random.buildingIds || {}), [cell]: buildingId };
  }
  markErrorsStale();
  return true;
}

/** 按索引切工具（1~9 快捷键），点一下左侧按钮复用同一份状态。 */
function pickTool(index) {
  const button = [...document.querySelectorAll('#tools button')][index];
  if (button) button.click();
}

/** Delete：删掉选中格上的站点；没站点就走「擦除」工具那一套（候选格 / 装饰）。 */
function deleteSelected() {
  if (selectedCell == null) return;
  if (siteAtCell(selectedCell)) { $('removeSite').click(); return; }
  const saved = mode;
  mode = 'erase';
  paint(selectedCell, {});
  mode = saved;
}

/** 按 cellId 找站点：**含 footprint** —— 多格站点被点到非锚点格子时也要认得。 */
function siteAtCell(cell) {
  if (cell == null) return null;
  return (map.sites || []).find((item) => (item.footprint || [item.cellId]).includes(cell)) || null;
}

/**
 * 同一「战斗 id」的全部格子。
 *
 * 地图数据是**每格一条 site 记录**，同一关卡用相同的 `configId` 串起来
 * （chapter_01 里 `configId=10005` 就有 7 条）。所以「这个关卡占了哪几格」
 * = 同 configId 的所有 footprint 并集 —— 只亮被点的那一格是看不出形状的。
 *
 * `configId` 为空时退回 `site.id`（组里只有自己，行为与以前一致）。
 */
function siteGroupCells(cell) {
  const site = siteAtCell(cell);
  if (!site) return [];
  const key = site.configId || site.id;
  const cells = new Set();
  for (const item of map.sites || []) {
    if ((item.configId || item.id) !== key) continue;
    for (const id of item.footprint || [item.cellId]) cells.add(id);
  }
  return [...cells];
}

function syncForm() {
  const presetSelect = $('presetSelect');
  if (presetSelect && map.id && ![...presetSelect.options].some((option) => option.value === map.id)) presetSelect.appendChild(new Option(`${map.id} · ${map.name || map.id} · ${map.sites?.length || 0} 站点`, map.id));
  if (presetSelect && presetSelect.value !== map.id) presetSelect.value = map.id;
  setField('mapId', map.id); setField('chapterId', map.chapterId); setField('mapName', map.name); setField('rows', map.rows); setField('columns', map.columns); setField('background', map.background || '');
  const random = map.randomSites || { triggerSilver: 1000, rewardPoolId: 'territory_random_01', candidateCells: [], maxActive: 1 };
  setField('triggerSilver', random.triggerSilver); setField('rewardPoolId', random.rewardPoolId); setField('maxActive', random.maxActive);
  const site = siteAtCell(selectedCell);
  const editor = $('siteEditor');
  if (editor.hidden !== !site) editor.hidden = !site;
  // 随机据点编辑区只在「选中的确实是候选格」时出现（与 siteEditor 互斥：一格只能有一个功能身份）。
  const randomEditor = $('randomSiteEditor');
  const isCandidate = selectedCell != null && (map.randomSites?.candidateCells || []).includes(selectedCell);
  if (randomEditor.hidden !== !isCandidate) randomEditor.hidden = !isCandidate;
  // 🔴 建筑 ID 输入框**只在换格时回填**，不是每次 render 都回填。
  // render() 被拖拽 / hover / 保存后的重绘调到，无脑回填会用 map 里的旧值盖掉玩家刚敲的字 ——
  // 表现为「填了保存不进去」（实测：填 69005 → syncForm 覆写成旧值 → PUT 出去的还是旧的）。
  // 表单是暂存区，`applyRandomBuildingIdFromForm` 在 paint/校验/保存前落盘，所以不急着重填。
  if (lastFormCell !== selectedCell) {
    lastFormCell = selectedCell;
    setField('randomBuildingId', isCandidate ? (map.randomSites?.buildingIds?.[selectedCell] ?? '') : '');
  }
  const groupSize = site ? siteGroupCells(selectedCell).length : 0;
  const info = selectedCell == null ? '点击地图格子'
    : `cellId ${selectedCell}${site ? ` · ${site.id}${groupSize > 1 ? ` · 同战斗 id 共 ${groupSize} 格` : ''}` : isCandidate ? ' · 随机据点' : ''}`;
  if ($('cellInfo').textContent !== info) $('cellInfo').textContent = info;
  if (!site) return;
  setField('siteId', site.id); setField('siteType', site.type); setField('configId', site.configId || ''); setField('buildingId', site.buildingId || '');
  setField('rewardId', site.rewardId ?? '');
  syncRewardField(site.type);
  setField('requiredCells', site.unlock.requiredCells.join(',')); setField('unlockType', site.unlock.unlockType || 'combatPower'); setField('unlockValue', site.unlock.unlockValue ?? site.unlock.combatPower ?? 0); setField('silverCost', site.unlock.silverCost); setField('exploreSeconds', site.unlock.exploreSeconds); setField('staminaCost', site.unlock.staminaCost);
}

// 一格只能有一个「功能身份」：站点 / 随机候选。校验器明确禁止两者重叠
// （formats/territory-format.js:145 `site X overlaps site Y`、:185 `candidateCells cannot use fixed cell N`），
// 而笔刷落格时若只写自己那份数据、不摘旧身份 ⇒ 手绘出的存档必然校验红；
// 视觉上更直观：`.cell.candidate` 只改 stroke（黄框）、`.cell.site-*` 只改 fill，两个 class 并存在同一个
// <path> 上 ⇒ 黄框和站点底色会**同时**显示，看起来就是「新笔刷没覆盖掉候选」。
// decorations 是叠加层（fixedCells 不含它），不参与互斥。
function releaseCell(cell) {
  map.sites = (map.sites || []).filter((site) => !(site.footprint || [site.cellId]).includes(cell));
  if (map.randomSites) map.randomSites.candidateCells = (map.randomSites.candidateCells || []).filter((item) => item !== cell);
  // 逐格建筑 ID 也必须一起摘：这一格不再是候选格后残留的 key 会让校验报
  // `randomSites.buildingIds.N is not a candidate cell`（那一格永远不会出现，留着等于静默失效配置）。
  if (map.randomSites?.buildingIds) delete map.randomSites.buildingIds[cell];
}

function addSite(cell, type) {
  map.sites = map.sites.filter((site) => site.cellId !== cell);
  map.sites.push({ id: `${type}_${map.sites.length + 1}`, type, cellId: cell, footprint: [cell], configId: `${type}_${cell}`, unlock: { requiredCells: [map.startCellId], unlockType: 'combatPower', unlockValue: map.defaults.combatPower ?? 0, silverCost: map.defaults.silverCost, exploreSeconds: map.defaults.exploreSeconds, staminaCost: map.defaults.staminaCost } });
  selectedCell = cell;
}

// ---- 格式刷 ----------------------------------------------------------------
// 采样一格的"站点配置"：站点完整字段（type/configId/unlock/buildingId/rewardId 等）、
// 是否随机候选、装饰 artId。不复制 startCellId（全局唯一）。
function sampleFormat(cell) {
  const site = (map.sites || []).find((s) => (s.footprint || [s.cellId]).includes(cell));
  const decor = (map.decorations || []).find((d) => d.cellId === cell);
  return {
    site: site ? JSON.parse(JSON.stringify(site)) : null,
    candidate: (map.randomSites?.candidateCells || []).includes(cell),
    candidateBuildingId: map.randomSites?.buildingIds?.[cell] ?? '',
    decorArtId: decor ? decor.artId : null,
  };
}
function applyFormatToCell(cell, source) {
  commit();
  releaseCell(cell);
  if (source.site) {
    const s = source.site;
    map.sites.push({
      ...s,
      id: `${s.type}_${cell}`,
      cellId: cell,
      footprint: [cell],
    });
  }
  if (source.candidate) {
    const values = new Set(map.randomSites?.candidateCells || []);
    values.add(cell);
    map.randomSites.candidateCells = [...values].sort((a, b) => a - b);
    // 逐格建筑 ID 跟随机候选身份同生共死：源格没填就只落候选，不留空串键。
    if (source.candidateBuildingId) {
      map.randomSites.buildingIds = { ...(map.randomSites.buildingIds || {}), [cell]: source.candidateBuildingId };
    }
  }
  if (source.decorArtId) {
    map.decorations = map.decorations || [];
    map.decorations.push({ cellId: cell, artId: source.decorArtId });
  }
  selectedCell = cell;
  lastFormCell = null;
  markErrorsStale();
  render();
  syncForm();
}

/** 六邻居：统一走 `hex-grid.js`（与客户端 `hexGridNeighborIds` 逐格一致）。 */
function hexNeighbors(row, col) {
  const cols = Number(map.columns);
  return hexNeighborsOf(row * cols + col, Number(map.rows), cols)
    .map((id) => ({ row: Math.floor(id / cols), column: id % cols }));
}
function neighborCells(row, col, radius) {
  const cols = Number(map.columns), rows = Number(map.rows);
  const cellId = row * cols + col;
  if (!radius) return [cellId];
  if (radius === 3) {
    // 「上下 3 格」是老笔刷的专门一档，不是圆，保留原义
    const out = [cellId];
    if (row - 1 >= 0) out.push((row - 1) * cols + col);
    if (row + 1 < rows) out.push((row + 1) * cols + col);
    return out;
  }
  return circleHexes(cellId, radius, rows, cols);
}

/**
 * 落笔取格。
 *
 * 「半径环数」优先（与大地图 `circleHexes` 同一口径：半径 2 = 19 格），没填才退回老的四档笔刷
 * （1 / 上下3 / 7 / 19）。两条路都走 `hex-grid.js` —— 编辑器刷出来的格子与游戏里算作相邻的
 * 格子必然是同一批。
 */
function radiusFromInput() {
  return Math.max(0, Math.floor(Number($('rangeRadius')?.value) || 0));
}

/** 半径优先（与大地图 `circleHexes` 同口径），没填才退回老四档笔刷。 */
function brushCellsForCell(cellIdValue) {
  const cols = Number(map.columns);
  const radius = radiusFromInput();
  if (radius > 0) return circleHexes(cellIdValue, radius, Number(map.rows), cols);
  return neighborCells(Math.floor(cellIdValue / cols), cellIdValue % cols, brushRadius);
}
function paint(cell, { skipCommit = false, skipRender = false } = {}) {
  if (cell < 0) return;
  if (!applyRewardIdFromForm()) return;
  applyRandomBuildingIdFromForm();
  const cells = brushRadius > 0 ? neighborCells(Math.floor(cell / map.columns), cell % map.columns, brushRadius) : [cell];
  if (mode === 'select') { selectedCell = cell; if (!skipRender) render(); return; }
  if (!skipCommit) commit();
  for (const c of cells) {
    if (mode === 'start') { releaseCell(c); map.startCellId = c; }
    else if (mode === 'candidate') {
      // 候选 = 「空格」身份：落笔时先把该格的站点身份摘掉（已在候选里的再点一次 = 取消，不动别的）
      const values = new Set(map.randomSites.candidateCells || []);
      if (values.has(c)) {
        values.delete(c);
        // 取消候选 = 这一格不再是随机据点，逐格建筑 ID 一起摘（同 releaseCell 的理由）。
        if (map.randomSites.buildingIds) delete map.randomSites.buildingIds[c];
      } else { releaseCell(c); values.add(c); }
      map.randomSites.candidateCells = [...values].sort((a, b) => a - b);
    }
    else if (mode === 'decor') { const existing = map.decorations.findIndex((item) => item.cellId === c); if (existing >= 0) map.decorations.splice(existing, 1); else map.decorations.push({ cellId: c, artId: 'image/territory/placeholder' }); }
    else if (mode === 'erase') { releaseCell(c); map.decorations = (map.decorations || []).filter((item) => item.cellId !== c); }
    // 初始格不能被站点占用（territory-format.js:148 `site X cannot occupy startCellId`）——
    // 站点搬到哪都没依据，只能跳过这一格；其余格子照常（brushRadius 拖拽时只有这一格被拒）。
    else if (mode !== 'select') { if (c === map.startCellId) continue; releaseCell(c); addSite(c, mode); }
  }
  markErrorsStale();   // 改完数据让格子上的 error 标签跟着重算（只在有标签时付这个钱）
  selectedCell = cell;
  // 笔刷可能改了当前格的候选身份 / 建筑 ID ⇒ 强制 syncForm 重填输入框（否则上面「只在换格时回填」会留下旧值）。
  lastFormCell = null;
  if (!skipRender) render();
}

function buildJSON() {
  applyRandomBuildingIdFromForm();
  const value = snapshot();
  value.id = $('mapId').value.trim(); value.chapterId = Number($('chapterId').value); value.name = $('mapName').value.trim() || value.id; value.rows = Number($('rows').value); value.columns = Number($('columns').value); value.background = $('background').value.trim();
  value.randomSites = { ...value.randomSites, triggerSilver: Number($('triggerSilver').value), rewardPoolId: $('rewardPoolId').value.trim(), maxActive: Number($('maxActive').value) };
  // 逐格建筑 ID 已经是 map 上的数据（表单只是暂存，applyRandomBuildingIdFromForm 落盘），
  // 这里只做两件事：空串剔掉、整表空了就不写这个键。
  const buildingIds = Object.fromEntries(Object.entries(value.randomSites.buildingIds || {}).filter(([, id]) => String(id).trim() !== ''));
  if (Object.keys(buildingIds).length) value.randomSites.buildingIds = buildingIds;
  else delete value.randomSites.buildingIds;
  return value;
}

async function loadPresets() {
  const response = await fetch('/api/territory-presets'); const body = await response.json();
  if (!body.presets?.length) throw new Error('没有领地预设');
  territoryPresets = body.presets;
  const select = $('presetSelect');
  select.replaceChildren(new Option('选择预设', ''));
  for (const preset of territoryPresets) {
    const option = new Option(`${preset.id} · ${preset.name || preset.id} · ${preset.sites?.length || 0} 站点`, preset.id);
    select.appendChild(option);
  }
  const picked = territoryPresets.find((item) => item.id === select.value) || territoryPresets.find((item) => item.id === map.id) || territoryPresets[0];
  select.value = picked.id;
  map = normalizeTerritoryMap(picked).map;
  history = []; future = []; setDirty(false); clearErrorMarkers(); showValidation('', ''); render(); message(`已加载 ${picked.id}`);
}
async function loadSelectedPreset() {
  const id = $('presetSelect').value;
  if (!id) return loadPresets();
  const response = await fetch(`/api/territory-presets/${encodeURIComponent(id)}`); const body = await response.json();
  if (!response.ok) throw new Error(body.error || '预设加载失败');
  map = normalizeTerritoryMap(body.preset).map; history = []; future = []; setDirty(false); clearErrorMarkers(); showValidation('', ''); render(); message(`已加载 ${id}`);
}
function validateCurrent() {
  if (!applyRewardIdFromForm()) throw new Error('固定资源奖励 ID 必须是正整数');
  const data = buildJSON();
  try {
    pendingWarningMarkers = [];
    errorMarkers = [];              // 通过 ⇒ 把上一轮的格子 error 标签清掉
    const result = validateTerritoryMap(data);
    pendingWarningMarkers = warningMarkersFor(result);
    render();
    const warning = result.warnings?.length ? `通过校验，但有提示：\n${result.warnings.join('\n')}` : '校验通过，可以保存或发布。';
    showValidation(result.warnings?.length ? 'warn' : 'ok', warning); message('校验完成'); return result;
  } catch (error) {
    const issues = Array.isArray(error.issues) ? error.issues : [String(error.message ?? error)];
    errorMarkers = issuesToCellMarkers(issues, data);
    render();                      // ← 让格子上的 error 标签立刻出现（老实现只写面板文本）
    const marked = new Set(errorMarkers.map((marker) => marker.cellId)).size;
    showValidation('error', errorIssuesText(issues, data, errorMarkers));
    message(marked ? `校验失败：${marked} 个格子已画出 error 标签` : '校验失败，请按右侧提示修正');
    throw error;
  }
}
async function save() { let result; try { result = validateCurrent(); } catch { return false; } const value = result.map; const response = await fetch(`/api/territory-presets/${encodeURIComponent(value.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); map = result.map; setDirty(false); render(); message(`已保存 ${value.id}`); return true; }
async function publish() { if (!await save()) return; const response = await fetch(`/api/territory-publish/${encodeURIComponent(map.id)}`, { method: 'POST' }); const body = await response.json(); if (!response.ok) throw new Error(body.error); message(`已发布到 ${body.target}`); }
function message(text) { $('message').textContent = text; }

function beginDrag(event) {
  invalidateGeometry();   // 上一次交互之后视口/滚动可能变了，重建坐标缓存
  if (event.button === 1) {
    viewportDrag = { x: event.clientX, y: event.clientY, viewX, viewY, pointerId: event.pointerId };
    $('map').setPointerCapture?.(event.pointerId);
    $('map').parentElement.classList.add('dragging');
    event.preventDefault();
    return;
  }
  const erase = event.button === 2;
  if (event.button !== 0 && !erase) return;
  const cell = cellId(event); if (cell < 0) return;
  // 格式刷模式：左键采样/套用，右键取消。不走普通笔画。
  if (mode === 'format') {
    if (event.button === 2) { formatSource = null; message('格式刷已取消'); render(); return; }
    if (!formatSource) {
      formatSource = sampleFormat(cell);
      const what = formatSource.site ? `站点(${formatSource.site.type})` : formatSource.candidate ? '随机候选' : formatSource.decorArtId ? '装饰' : '空格';
      message(`已采样${what}配置，点击目标格套用`);
    } else {
      applyFormatToCell(cell, formatSource);
      message('已套用（继续点格套用，右键/Esc 退出）');
    }
    render();
    event.preventDefault();
    return;
  }
  if (!erase && mode === 'select') { paint(cell); return; }
  drag = { visited: new Set(), pointerId: event.pointerId, erase, last: clientToLocal(event.clientX, event.clientY) };
  commit();
  drag.visited.add(cell);
  // 填了「半径环数」时，**单点**也铺一片（与大地图一致）；没填保持原行为（单点 1 格）。
  const firstCells = radiusFromInput() > 0 ? brushCellsForCell(cell) : [cell];
  if (erase) {
    const saved = mode; mode = 'erase';
    for (const id of firstCells) { drag.visited.add(id); paint(id, { skipCommit: true, skipRender: true }); }
    mode = saved;
  } else {
    for (const id of firstCells) { drag.visited.add(id); paint(id, { skipCommit: true, skipRender: true }); }
  }
  render();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
function flushStroke() {
  if (!drag) { dragRaf = 0; return; }
  const local = drag.pending;
  drag.pending = null;
  dragRaf = 0;
  const savedMode = mode;
  if (drag.erase) mode = 'erase';
  let dirty = false;
  walkStroke(drag.last, local, (c) => {
    if (drag.visited.has(c)) return;
    drag.visited.add(c);
    paint(c, { skipCommit: true, skipRender: true });
    dirty = true;
  });
  if (drag.erase) mode = savedMode;
  drag.last = local;
  if (dirty) render();
}
function continueDrag(event) {
  if (viewportDrag) {
    const rect = svgRect();
    if (!rect.width || !rect.height) return;
    const { width, height } = baseSize();
    viewX = viewportDrag.viewX - (event.clientX - viewportDrag.x) * (width / zoom) / rect.width;
    viewY = viewportDrag.viewY - (event.clientY - viewportDrag.y) * (height / zoom) / rect.height;
    applyView();
    event.preventDefault();
    return;
  }
  if (!drag) return;
  drag.pending = clientToLocal(event.clientX, event.clientY);
  if (!dragRaf) dragRaf = requestAnimationFrame(flushStroke);
}
function endDrag() {
  if (drag && drag.pending) flushStroke();
  if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
  drag = null;
  viewportDrag = null;
  $('map').parentElement.classList.remove('dragging');
}
$('map').addEventListener('pointerdown', beginDrag);
$('map').addEventListener('pointermove', continueDrag);
$('map').addEventListener('pointerup', endDrag);
$('map').addEventListener('pointercancel', endDrag);
$('map').addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event, event.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
$('fit').addEventListener('click', resetView);
bindZoomSlider($('zoomSlider'), (percent) => zoomTo(percent / 100));
document.querySelectorAll('input[name="brushRadius"]').forEach((radio) => radio.addEventListener('change', () => { brushRadius = Number(radio.value); }));
    $('tools').addEventListener('click', (event) => { const button = event.target.closest('button'); if (!button) return; mode = button.dataset.mode; if (mode !== 'format') formatSource = null; document.querySelectorAll('#tools button').forEach((item) => item.classList.toggle('active', item === button)); $('toolStatus').textContent = `当前工具：${button.textContent}`; });
$('siteType').addEventListener('change', () => syncRewardField($('siteType').value));
$('rewardId').addEventListener('change', applyRewardIdFromForm);
$('randomBuildingId').addEventListener('change', () => { if (applyRandomBuildingIdFromForm()) { render(); message(selectedCell == null ? '' : `已设置格子 ${selectedCell} 的建筑 ID，按 Ctrl+S 保存`); } });
$('applyBatchRewardId').addEventListener('click', applyBatchRewardId);
$('applySite').addEventListener('click', () => {
  const site = siteAtCell(selectedCell);
  if (!site) return;
  const type = $('siteType').value;
  const rewardText = $('rewardId').value.trim();
  const rewardId = rewardText === '' ? null : Number(rewardText);
  if (type === 'fixedResource' && rewardId !== null && (!Number.isInteger(rewardId) || rewardId <= 0)) {
    message('固定资源奖励 ID 必须是正整数');
    $('rewardId').focus();
    return;
  }
  commit();
  site.id = $('siteId').value.trim();
  site.type = type;
  site.configId = $('configId').value.trim();
  site.buildingId = $('buildingId').value.trim();
  if (type === 'fixedResource' && rewardId !== null) site.rewardId = rewardId;
  else delete site.rewardId;
  site.unlock = { requiredCells: $('requiredCells').value.split(',').map((value) => Number(value.trim())).filter(Number.isInteger), unlockType: $('unlockType').value, unlockValue: Number($('unlockValue').value), silverCost: Number($('silverCost').value), exploreSeconds: Number($('exploreSeconds').value), staminaCost: Number($('staminaCost').value) };
  markErrorsStale();
  render();
});
$('removeSite').addEventListener('click', () => {
  if (selectedCell == null) return;
  commit();
  // 按 footprint 删：多格站点被点到的可能不是锚点格
  map.sites = map.sites.filter((site) => !(site.footprint || [site.cellId]).includes(selectedCell));
  selectedCell = null;
  markErrorsStale();
  render();
});
function updateMapField(id) {
  if (id === 'mapId') {
    map.id = $(id).value.trim();
    if (/^chapter[_-]?\d+$/i.test(map.id)) {
      map.chapterId = inferChapterId(map.id, map.chapterId);
      $('chapterId').value = map.chapterId;
    }
  } else if (id === 'chapterId') map.chapterId = Number($(id).value);
  else if (id === 'rows' || id === 'columns') map[id] = Number($(id).value);
  else map[id] = $(id).value;
  setDirty(true);
  markErrorsStale();
  render();
}
['mapId', 'chapterId', 'mapName', 'rows', 'columns', 'background'].forEach((id) => $(id).addEventListener('change', () => updateMapField(id)));
$('load').addEventListener('click', () => loadPresets().catch((error) => message(error.message)));
$('presetSelect').addEventListener('change', () => loadSelectedPreset().catch((error) => message(error.message)));
$('save').addEventListener('click', () => save().catch((error) => message(error.message)));
$('validate').addEventListener('click', () => { try { validateCurrent(); } catch { /* details are shown in the validation panel */ } });
$('publish').addEventListener('click', () => publish().catch((error) => message(error.message)));
$('export').addEventListener('click', () => { if (!applyRewardIdFromForm()) return; const blob = new Blob([JSON.stringify(buildJSON(), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${map.id}.json`; link.click(); URL.revokeObjectURL(link.href); });
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => { const file = $('file').files[0]; if (!file) return; try { map = normalizeTerritoryMap(JSON.parse(await file.text())).map; setDirty(true); clearErrorMarkers(); render(); message(`已导入 ${map.id}`); } catch (error) { message(error.message); } });
$('map').addEventListener('contextmenu', (e) => e.preventDefault());
$('showLinks').addEventListener('change', applyLinkVisibility);
window.addEventListener('pointerup', endDrag);
// 几何缓存失效：窗口尺寸变化 / 任意容器滚动都会让「屏幕↔SVG 用户坐标」的映射失效
window.addEventListener('resize', invalidateGeometry);
window.addEventListener('scroll', invalidateGeometry, true);
$('undo').addEventListener('click', () => { if (!history.length) return; future.push(snapshot()); restore(history.pop()); setDirty(true); });
$('redo').addEventListener('click', () => { if (!future.length) return; history.push(snapshot()); restore(future.pop()); setDirty(true); });

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  // Esc 三级退出：格式刷 → 清选中 → 回「选择」工具
  if (event.key === 'Escape') {
    if (mode === 'format') { formatSource = null; message('格式刷已取消'); render(); return; }
    if (selectedCell != null) { selectedCell = null; syncForm(); render(); return; }
    if (mode !== 'select') { pickTool(0); return; }
    return;
  }
  // 输入框里按数字/删除不该动编辑器
  const tag = document.activeElement?.tagName ?? '';
  if (!ctrl && (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')) return;
  if (!ctrl && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); deleteSelected(); return; }
  if (!ctrl && /^[1-9]$/.test(event.key)) { pickTool(Number(event.key) - 1); return; }
  if (!ctrl) return;
  if (key === 's') { event.preventDefault(); save().catch((error) => message(error.message)); }
  else if (key === 'z' && !event.shiftKey) { event.preventDefault(); if (!history.length) return; future.push(snapshot()); restore(history.pop()); setDirty(true); }
  else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); if (!future.length) return; history.push(snapshot()); restore(future.pop()); setDirty(true); }
});
window.addEventListener('beforeunload', (event) => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; });
window.__territoryEditor = { state: () => snapshot(), viewport: () => ({ zoom, viewX, viewY }), buildJSON, validate: () => validateTerritoryMap(buildJSON()), paint: (row, column, nextMode) => { mode = nextMode || mode; paint(row * map.columns + column); }, load: (value) => { map = normalizeTerritoryMap(value).map; setDirty(false); render(); }, zoomAt: (factor) => { const rect = $('map').getBoundingClientRect(); zoomAt({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, factor); }, resetView, hitAt: (clientX, clientY) => { const local = clientToLocal(clientX, clientY); const hit = cellAtLocal(local.x, local.y); return { local, hit, cellId: hit ? hit.row * map.columns + hit.col : -1 }; }, debug: () => ({ mode, selectedCell, errorMarkers: errorMarkers.map((marker) => marker.cellId) }) };
render();
