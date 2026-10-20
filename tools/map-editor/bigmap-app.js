/**
 * 大地图布局编辑器（`/bigmap.html`）。
 *
 * 定位：**只编辑布局**（谁在哪），不碰运行态（归属/积分/快照）。数值仍在 `BigMap-*` 配置表。
 *
 * 三个约束写在这里，改代码前先读：
 * 1. 几何必须与客户端 `core/hex/HexGridLayout` 同口径（36×42、偶列下移 10.5）；
 *    这里是**逻辑坐标**，客户端渲染是 92.25×90 的非等比放大 —— 见 `BIGMAP_EDITOR_TO_VIEW_SCALE`。
 * 2. 校验只有一份权威实现（`formats/bigmap-format.js`，与 TS 的 parseBigMapLayout 对拍过）。
 * 3. 保存走 PUT，发布走 POST（发布才会写 `assets/resources/config/bigmap-maps/` 并做配置表对账）。
 */
import {
  BIGMAP_LAYOUT_KIND,
  BIGMAP_LAYOUT_VERSION,
  circleHexes,
  deriveAdjacentCities,
  hexDistance,
  hexNeighbors,
  normalizeBigmapLayout,
  poissonSpawnPoints,
} from '/formats/bigmap-format.js';
import { bindZoomSlider, setDirtyBadge, syncZoomSlider, zoomPercentLabel } from '/formats/ui-kit.js';

const NS = 'http://www.w3.org/2000/svg';
/** 逻辑网格：与 `HEX_GRID_LOGICAL_*` 一致（36 / 42），别改成 √3R —— 那会与客户端差 1%。 */
const X = 36;
const Y = 42;
const R = 24;
const PHASE = Y / 4;
const PAD = 44;
/** 分块行数：100×100 全量挂 DOM 会卡，按块懒建。 */
const CHUNK_ROWS = 8;

const $ = (id) => document.getElementById(id);
const svg = $('map');
const stage = $('stage');

/**
 * 内嵌到 `<svg>` 里的样式副本。
 *
 * 页面样式在 `<head>`，导出 SVG/截图时**带不走** —— 没有这份，导出的图就是一片没上色的黑块。
 * 与 head 里的规则重复定义无害（同一份值）。
 */
const SVG_STYLE = `
.cell { stroke:#475569; stroke-width:.6 }
.c-plain { fill:#1b2537 } .c-forest { fill:#16301f } .c-rock { fill:#2b2b31 } .c-water { fill:#123047 }
.c-blocked { fill:#3f1d1d }
.range { fill:#38bdf8; fill-opacity:.16; stroke:#38bdf8; stroke-width:.8; stroke-opacity:.6 }
.zone { fill:#f472b6; fill-opacity:.12; stroke:#f472b6; stroke-width:.8; stroke-opacity:.5 }
.sel { fill:none; stroke:#fde047; stroke-width:2.4 }
.poisson { fill:#facc15; fill-opacity:.92; stroke:#111827; stroke-width:.9 }
.ent text { font:700 11px system-ui,sans-serif; text-anchor:middle; paint-order:stroke; stroke:#0b1220; stroke-width:2.5 }
.ent-city { fill:#2563eb; stroke:#93c5fd; stroke-width:1.2 }
.ent-city.locked { fill:#334155; stroke:#64748b }
.ent-monster { fill:#dc2626; stroke:#fca5a5; stroke-width:1.2 }
.ent-base { fill:#0d9488; stroke:#5eead4; stroke-width:1.2 }
.ent-base.me { fill:#facc15; stroke:#fef08a }
.ent-point { fill:#a855f7; stroke:#d8b4fe; stroke-width:1.2 }
`;

let cfg = { world: null, cities: [], monsters: [] };
let map = null;
let selected = null;
let tool = 'select';
let history = [];
let future = [];
let dirty = false;
let chunks = new Map();
let svgW = 0;
let svgH = 0;
let zoom = 100;
let suppressValidate = false;
/** 最近一次「算能放几个」的结果，只画出来，不进布局。 */
let poissonPoints = [];

// ---------------------------------------------------------------- 基础工具

function toast(text) { $('message').textContent = text; }

function setDirty(value) {
  dirty = value === true;
  setDirtyBadge($('dirtyBadge'), dirty);
}

function snapshot() { return JSON.parse(JSON.stringify(map)); }

function commit() {
  history.push(snapshot());
  if (history.length > 60) history.shift();
  future = [];
  setDirty(true);
}

function restore(value) {
  map = value;
  selected = null;
  relayout();
  syncPanel();
  validate(false);
}

const cols = () => Number(map.columns);
const rows = () => Number(map.rows);
const total = () => cols() * rows();

function centerHexId() {
  return Math.floor((rows() - 1) / 2) * cols() + Math.floor((cols() - 1) / 2);
}

/** 环号 = 到中心的六边距离。距离函数用 format 里那份（与客户端 `bigMapHexDistance` 同式、有对拍）。 */
function ringOf(hexId) { return hexDistance(centerHexId(), hexId, rows(), cols()); }

/** 逻辑格心。偶数列下移 PHASE —— 与客户端 `hexGridLogicalPoint` 的相位一致（y 轴翻转后同向）。 */
function cellCenter(row, column) {
  return { x: PAD + column * X, y: PAD + row * Y + (column % 2 === 0 ? PHASE : -PHASE) };
}

function canvasSize() {
  return {
    w: PAD * 2 + (cols() - 1) * X + R,
    h: PAD * 2 + (rows() - 1) * Y + Y,
  };
}

/** flat-top 六边形：横向半径 R、纵向半高 Y/2（压扁，与 130×119 底图同口径）。 */
function hexPath(cx, cy) {
  const hh = Y / 2;
  const q = R / 2;
  return `M${cx - R},${cy} L${cx - q},${cy - hh} L${cx + q},${cy - hh} L${cx + R},${cy} L${cx + q},${cy + hh} L${cx - q},${cy + hh} Z`;
}

function localPoint(event) {
  const rect = svg.getBoundingClientRect();
  const scale = svgW > 0 ? rect.width / svgW : 1;
  return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
}

function cellAtLocal(x, y) {
  const qf = (x - PAD) / X;
  let best = null;
  let bestDistance = Infinity;
  for (let column = Math.floor(qf) - 1; column <= Math.ceil(qf) + 1; column += 1) {
    if (column < 0 || column >= cols()) continue;
    const phase = column % 2 === 0 ? PHASE : -PHASE;
    const rf = (y - PAD - phase) / Y;
    for (let row = Math.floor(rf) - 1; row <= Math.ceil(rf) + 1; row += 1) {
      if (row < 0 || row >= rows()) continue;
      const center = cellCenter(row, column);
      const dx = x - center.x;
      const dy = y - center.y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { bestDistance = distance; best = { row, column }; }
    }
  }
  if (!best) return -1;
  const center = cellCenter(best.row, best.column);
  if (Math.abs(x - center.x) > R || Math.abs(y - center.y) > Y / 2) return -1;
  return best.row * cols() + best.column;
}

// ---------------------------------------------------------------- 占位查询

function occupiedBy() {
  const owner = new Map();
  for (const id of map.blocked ?? []) owner.set(id, { kind: 'blocked', id });
  for (const city of map.cities) for (const id of city.hexIds) owner.set(id, { kind: 'city', id: city.cityId });
  for (const monster of map.monsters) for (const id of monster.hexIds) owner.set(id, { kind: 'monster', id: monster.instanceId });
  for (const base of map.bases) owner.set(base.hexId, { kind: 'base', id: base.baseId });
  for (const point of map.points ?? []) for (const id of point.hexIds) owner.set(id, { kind: 'point', id: point.pointId });
  return owner;
}

/** 撒基地点时不能落脚的格：城/怪/据点/障碍。出生区块本身不算占位。 */
function bannedHexes() {
  const banned = [];
  for (const city of map.cities) banned.push(...city.hexIds);
  for (const monster of map.monsters) banned.push(...monster.hexIds);
  for (const point of map.points) banned.push(...point.hexIds);
  banned.push(...map.blocked);
  return banned;
}

function terrainAt(hexId) {
  const override = (map.terrainOverrides ?? []).find((entry) => entry.hexId === hexId);
  if (override) return override.terrain;
  return seedTerrain(hexId);
}

/** 与 `BigMapWorld.terrainAt` 同式：策划手改之前，编辑器显示的就是游戏里那块地。 */
function seedTerrain(hexId) {
  const ring = ringOf(hexId);
  const roll = random01(hexId);
  if (ring <= 2) return 'plain';
  if (ring <= 6) return roll < 0.72 ? 'plain' : roll < 0.9 ? 'forest' : 'rock';
  return roll < 0.5 ? 'plain' : roll < 0.72 ? 'forest' : roll < 0.9 ? 'rock' : 'water';
}

function random01(hexId) {
  const seed = Number(map.terrainSeed) | 0;
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (hexId | 0), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ 7, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h ^ 0, 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** 从锚点扩出 size 格连通块（BFS，遇到已占格绕开）。与 `claimFootprint` 同口径。 */
function claimFootprint(anchorHexId, size) {
  const occupied = occupiedBy();
  const claimed = [];
  const queue = [anchorHexId];
  const seen = new Set();
  while (queue.length > 0 && claimed.length < size) {
    const hexId = queue.shift();
    if (hexId === undefined || seen.has(hexId)) continue;
    seen.add(hexId);
    if (occupied.has(hexId)) continue;
    claimed.push(hexId);
    for (const neighbor of hexNeighbors(hexId, rows(), cols())) {
      if (!seen.has(neighbor)) queue.push(neighbor);
    }
  }
  return claimed;
}

// ---------------------------------------------------------------- 渲染

function relayout() {
  const size = canvasSize();
  svgW = size.w;
  svgH = size.h;
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  applyZoom();
  chunks.clear();
  svg.replaceChildren();

  // 内嵌样式（截图/导出要带走），然后背景垫底。
  const style = document.createElementNS(NS, 'style');
  style.textContent = SVG_STYLE;
  svg.appendChild(style);
  const bg = document.createElementNS(NS, 'image');
  bg.setAttribute('id', 'bg');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(svgW));
  bg.setAttribute('height', String(svgH));
  bg.setAttribute('preserveAspectRatio', 'none');
  svg.appendChild(bg);

  // 层序：背景 → 格子（chunk 自己插在 ranges 前）→ 范围 → 区块 → 撒点 → 实体 → 选中框。
  for (const id of ['ranges', 'zones', 'poisson', 'entities', 'overlay']) {
    const layer = document.createElementNS(NS, 'g');
    layer.setAttribute('id', id);
    svg.appendChild(layer);
  }
  ensureChunks(true);
  render();
}

function applyZoom() {
  svg.setAttribute('width', String(Math.round(svgW * zoom / 100)));
  svg.setAttribute('height', String(Math.round(svgH * zoom / 100)));
  // 大地图的 zoom 直接就是百分数（30~220），不用换算
  $('zoomInfo').textContent = zoomPercentLabel(zoom);
  syncZoomSlider($('zoom'), zoom);
}

function visibleRowRange() {
  const scale = Math.max(0.05, zoom / 100);
  const top = stage.scrollTop / scale;
  const bottom = top + stage.clientHeight / scale;
  const first = Math.max(0, Math.floor((top - Y) / (CHUNK_ROWS * Y)) - 1);
  const last = Math.min(Math.ceil(rows() / CHUNK_ROWS) - 1, Math.ceil((bottom + Y) / (CHUNK_ROWS * Y)) + 1);
  return { first, last };
}

function ensureChunks(force = false) {
  const chunkCount = Math.ceil(rows() / CHUNK_ROWS);
  const { first, last } = visibleRowRange();
  // 视口外的块保持挂载（滚动回来不用重建），但整图很大时删掉远离视口的块。
  for (const [index, group] of chunks) {
    if (index < first - 2 || index > last + 2) { group.remove(); chunks.delete(index); }
  }
  for (let index = first; index <= last; index += 1) {
    if (index < 0 || index >= chunkCount) continue;
    if (!chunks.has(index)) buildChunk(index);
  }
  void force;
}

function buildChunk(index) {
  const group = document.createElementNS(NS, 'g');
  group.dataset.chunk = String(index);
  const rowStart = index * CHUNK_ROWS;
  const rowEnd = Math.min(rows(), rowStart + CHUNK_ROWS);
  const showGrid = $('showGrid').checked;
  const showRing = $('showRing').checked;
  for (let row = rowStart; row < rowEnd; row += 1) {
    for (let column = 0; column < cols(); column += 1) {
      const hexId = row * cols() + column;
      const center = cellCenter(row, column);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', hexPath(center.x, center.y));
      path.setAttribute('class', `cell c-${terrainAt(hexId)}`);
      path.dataset.hex = String(hexId);
      if (!showGrid) path.style.stroke = 'none';
      group.appendChild(path);
      if (showRing) {
        const text = document.createElementNS(NS, 'text');
        text.setAttribute('x', String(center.x));
        text.setAttribute('y', String(center.y - 6));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#64748b');
        text.setAttribute('font-size', '9');
        text.textContent = String(ringOf(hexId));
        group.appendChild(text);
      }
    }
  }
  // 块要插在 ranges 之前，但 ranges 是后建的 —— 用 firstChild 之前插入顺序无所谓：
  // 只要 chunk 的 DOM 顺序整体在 ranges 之前即可。
  const ranges = svg.querySelector('#ranges');
  svg.insertBefore(group, ranges);
  chunks.set(index, group);
}

function render() {
  renderTerrainClasses();
  renderBackground();
  renderRanges();
  renderZones();
  renderPoisson();
  renderEntities();
  renderSelection();
}

function renderBackground() {
  const bg = svg.querySelector('#bg');
  if (!bg) return;
  const name = (map.background ?? '').trim();
  if (!name) { bg.removeAttribute('href'); return; }
  bg.setAttribute('href', `/bg/${name}`);
}

function renderPoisson() {
  const layer = svg.querySelector('#poisson');
  if (!layer) return;
  layer.replaceChildren();
  if (!poissonPoints.length || !$('showPoisson').checked) return;
  for (const hexId of poissonPoints) {
    const center = cellCenter(Math.floor(hexId / cols()), hexId % cols());
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(center.x));
    dot.setAttribute('cy', String(center.y));
    dot.setAttribute('r', '5.5');
    dot.setAttribute('class', 'poisson');
    layer.appendChild(dot);
  }
}

function renderTerrainClasses() {
  const blocked = new Set(map.blocked ?? []);
  for (const group of chunks.values()) {
    for (const path of group.children) {
      if (path.tagName !== 'path') continue;
      const hexId = Number(path.dataset.hex);
      path.setAttribute('class', `cell c-${terrainAt(hexId)}${blocked.has(hexId) ? ' c-blocked' : ''}`);
    }
  }
}

function renderRanges() {
  const layer = svg.querySelector('#ranges');
  layer.replaceChildren();
  if (!$('showRange').checked) return;
  const paint = (cells, className) => {
    for (const hexId of cells) {
      const row = Math.floor(hexId / cols());
      const column = hexId % cols();
      const center = cellCenter(row, column);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', hexPath(center.x, center.y));
      path.setAttribute('class', className);
      layer.appendChild(path);
    }
  };
  for (const city of map.cities) {
    if (city.rangeHex?.length) paint(city.rangeHex, 'range');
  }
}

function renderZones() {
  const layer = svg.querySelector('#zones');
  layer.replaceChildren();
  if (!$('showZone').checked) return;
  for (const zone of map.spawnZones ?? []) {
    for (const hexId of zone.cells) {
      const row = Math.floor(hexId / cols());
      const column = hexId % cols();
      const center = cellCenter(row, column);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', hexPath(center.x, center.y));
      path.setAttribute('class', 'zone');
      layer.appendChild(path);
    }
  }
}

function entityLabel(text, center, dy = 0) {
  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', String(center.x));
  label.setAttribute('y', String(center.y + 4 + dy));
  label.textContent = text;
  return label;
}

function renderEntities() {
  const layer = svg.querySelector('#entities');
  layer.replaceChildren();
  const showLabel = $('showLabel').checked;

  for (const city of map.cities) {
    const row = Math.floor(city.anchorHexId / cols());
    const column = city.anchorHexId % cols();
    const center = cellCenter(row, column);
    const def = cityDef(city.cityId);
    const locked = def && Number(def.available) === 0;
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'ent');
    group.dataset.kind = 'city';
    group.dataset.id = String(city.cityId);
    const shape = document.createElementNS(NS, 'rect');
    const size = 17;
    shape.setAttribute('x', String(center.x - size / 2));
    shape.setAttribute('y', String(center.y - size / 2));
    shape.setAttribute('width', String(size));
    shape.setAttribute('height', String(size));
    shape.setAttribute('rx', '3');
    shape.setAttribute('class', `ent-city${locked ? ' locked' : ''}`);
    group.appendChild(shape);
    if (showLabel) group.appendChild(entityLabel(city.label || String(city.cityId), center));
    group.appendChild(entityLabel(`L${def ? def.cityLevel : '?'}`, center, 13));
    layer.appendChild(group);
  }

  for (const monster of map.monsters) {
    const row = Math.floor(monster.anchorHexId / cols());
    const column = monster.anchorHexId % cols();
    const center = cellCenter(row, column);
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'ent');
    group.dataset.kind = 'monster';
    group.dataset.id = String(monster.instanceId);
    const shape = document.createElementNS(NS, 'circle');
    shape.setAttribute('cx', String(center.x));
    shape.setAttribute('cy', String(center.y));
    shape.setAttribute('r', '8');
    shape.setAttribute('class', 'ent-monster');
    group.appendChild(shape);
    if (showLabel) group.appendChild(entityLabel(`M${monster.level}`, center, 14));
    layer.appendChild(group);
  }

  for (const base of map.bases) {
    const row = Math.floor(base.hexId / cols());
    const column = base.hexId % cols();
    const center = cellCenter(row, column);
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'ent');
    group.dataset.kind = 'base';
    group.dataset.id = String(base.baseId);
    const shape = document.createElementNS(NS, 'path');
    const hh = 9;
    shape.setAttribute('d', `M${center.x},${center.y - hh} L${center.x + hh},${center.y + hh * 0.7} L${center.x - hh},${center.y + hh * 0.7} Z`);
    shape.setAttribute('class', `ent-base${base.isPlayer ? ' me' : ''}`);
    group.appendChild(shape);
    if (showLabel) group.appendChild(entityLabel(base.isPlayer ? '我' : 'B', center, 2));
    layer.appendChild(group);
  }

  for (const point of map.points ?? []) {
    const row = Math.floor(point.hexIds[0] / cols());
    const column = point.hexIds[0] % cols();
    const center = cellCenter(row, column);
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'ent');
    group.dataset.kind = 'point';
    group.dataset.id = String(point.pointId);
    const shape = document.createElementNS(NS, 'circle');
    shape.setAttribute('cx', String(center.x));
    shape.setAttribute('cy', String(center.y));
    shape.setAttribute('r', '7');
    shape.setAttribute('class', 'ent-point');
    group.appendChild(shape);
    layer.appendChild(group);
  }
}

function renderSelection() {
  const layer = svg.querySelector('#overlay');
  layer.replaceChildren();
  if (!selected) return;
  const cells = selectedCells();
  for (const hexId of cells) {
    const row = Math.floor(hexId / cols());
    const column = hexId % cols();
    const center = cellCenter(row, column);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', hexPath(center.x, center.y));
    path.setAttribute('class', 'sel');
    layer.appendChild(path);
  }
}

function selectedCells() {
  if (!selected) return [];
  if (selected.kind === 'hex') return [selected.id];
  if (selected.kind === 'city') {
    const city = map.cities.find((item) => item.cityId === selected.id);
    return city ? city.hexIds : [];
  }
  if (selected.kind === 'monster') {
    const monster = map.monsters.find((item) => item.instanceId === selected.id);
    return monster ? monster.hexIds : [];
  }
  if (selected.kind === 'base') {
    const base = map.bases.find((item) => item.baseId === selected.id);
    return base ? [base.hexId] : [];
  }
  if (selected.kind === 'point') {
    const point = (map.points ?? []).find((item) => item.pointId === selected.id);
    return point ? point.hexIds : [];
  }
  if (selected.kind === 'zone') {
    const zone = (map.spawnZones ?? []).find((item) => item.zoneId === selected.id);
    return zone ? zone.cells : [];
  }
  return [];
}

// ---------------------------------------------------------------- 交互

function cityDef(cityId) {
  return cfg.cities.find((item) => Number(item.cityId) === Number(cityId)) || null;
}

function monsterDef(monsterId) {
  return cfg.monsters.find((item) => Number(item.monsterId) === Number(monsterId)) || null;
}

function occupiedMessage(hexId) {
  const owner = occupiedBy().get(hexId);
  if (!owner) return '';
  if (owner.kind === 'city') return `该格属于城池 ${owner.id}`;
  if (owner.kind === 'monster') return `该格属于野怪 ${owner.id}`;
  if (owner.kind === 'base') return `该格是基地 ${owner.id}`;
  if (owner.kind === 'point') return `该格是据点 ${owner.id}`;
  return '该格是障碍';
}

function mutate(fn) {
  commit();
  const message = fn();
  if (message) toast(message);
  render();
  syncPanel();
}

function onCellClick(hexId) {
  if (tool === 'select') {
    const owner = occupiedBy().get(hexId);
    selected = owner && owner.kind !== 'blocked' ? { kind: owner.kind, id: owner.id } : { kind: 'hex', id: hexId };
    renderSelection();
    syncPanel();
    return;
  }
  if (tool === 'city') { placeCity(hexId); return; }
  if (tool === 'monster') { placeMonster(hexId); return; }
  if (tool === 'base') { placeBase(hexId); return; }
  if (tool === 'point') { placePoint(hexId); return; }
  if (tool === 'zone') { addToZone(hexId); return; }
  if (tool === 'blocked') { toggleBlocked(hexId); return; }
  if (tool === 'terrain') { paintTerrain(hexId); return; }
  if (tool === 'range') { paintRange(hexId); return; }
  if (tool === 'erase') { eraseAt(hexId); }
}

function placeCity(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker) { toast(blocker); return; }
  const cityId = Number($('cityPick').value);
  if (!cityId) { toast('没有可放置的城池（配置里的城都已放完）'); return; }
  const def = cityDef(cityId);
  const size = Number(def?.layer) === 4 ? 6 : 4;
  const footprint = claimFootprint(hexId, size);
  if (footprint.length < size) { toast(`空间不足：城池要占 ${size} 格，只找到 ${footprint.length} 格`); return; }
  mutate(() => {
    map.cities.push({
      cityId,
      anchorHexId: hexId,
      hexIds: footprint,
      ring: ringOf(hexId),
      rangeHex: [],
      adjacentCityIds: [],
      label: String(cityId),
    });
    selected = { kind: 'city', id: cityId };
    fillPickers();
  });
}

function placeMonster(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker) { toast(blocker); return; }
  const monsterId = Number($('monsterPick').value);
  if (!monsterId) { toast('先选一个野怪配置'); return; }
  const def = monsterDef(monsterId);
  const size = Math.max(1, Number(def?.occupyHex ?? 1));
  const footprint = claimFootprint(hexId, size);
  if (footprint.length < size) { toast(`空间不足：这只野怪要占 ${size} 格`); return; }
  const instanceId = nextInstanceId();
  mutate(() => {
    map.monsters.push({
      instanceId,
      monsterId,
      level: Number(def?.monsterLevel ?? 1),
      anchorHexId: hexId,
      hexIds: footprint,
    });
    selected = { kind: 'monster', id: instanceId };
  });
}

function nextInstanceId() {
  const used = new Set(map.monsters.map((item) => item.instanceId));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function placeBase(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker) { toast(blocker); return; }
  const used = new Set(map.bases.map((item) => item.baseId));
  let index = 1;
  while (used.has(`npc-${String(index).padStart(2, '0')}`)) index += 1;
  const baseId = `npc-${String(index).padStart(2, '0')}`;
  mutate(() => {
    map.bases.push({ baseId, name: `NPC ${index}`, isPlayer: false, hexId, ring: ringOf(hexId), power: 600 + index * 180 });
    selected = { kind: 'base', id: baseId };
  });
}

function placePoint(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker) { toast(blocker); return; }
  const pointType = Number($('pointPick').value);
  const used = new Set((map.points ?? []).map((item) => item.pointId));
  let pointId = 1;
  while (used.has(pointId)) pointId += 1;
  mutate(() => {
    map.points.push({ pointId, pointType, hexIds: [hexId], openCron: '' });
    selected = { kind: 'point', id: pointId };
  });
}

/**
 * 出生区块：没选中区块时新建一个，选中了就继续往里加格。
 *
 * 区块里的格子不能有占位物（城/怪/基地/据点/障碍）—— 区块是"基地可以落在这里"的面积，
 * 不是占地物本身，所以它不进 `occupiedBy`。
 */
function addToZone(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker) { toast(`出生区块里不能有占位物：${blocker}`); return; }
  mutate(() => {
    let zone = selected && selected.kind === 'zone'
      ? map.spawnZones.find((item) => item.zoneId === selected.id)
      : null;
    if (!zone) {
      const used = new Set(map.spawnZones.map((item) => item.zoneId));
      let zoneId = 1;
      while (used.has(zoneId)) zoneId += 1;
      zone = { zoneId, cityId: 0, cells: [], capacity: 0 };
      map.spawnZones.push(zone);
      selected = { kind: 'zone', id: zoneId };
    }
    if (zone.cells.indexOf(hexId) < 0) zone.cells.push(hexId);
    // 容量先按「4 格一个基地」粗估，策划可手改。
    if (zone.capacity < 1) zone.capacity = Math.floor(zone.cells.length / 4);
    poissonPoints = [];
  });
}

/** 旧布局 / 导入的裸 JSON 可能缺字段，统一补齐再交给渲染与校验。 */
function ensureShape(target) {
  target.terrainOverrides = target.terrainOverrides ?? [];
  target.blocked = target.blocked ?? [];
  target.spawnZones = target.spawnZones ?? [];
  target.points = target.points ?? [];
  target.background = target.background ?? '';
  target.bases = target.bases ?? [];
  for (const city of target.cities ?? []) {
    city.rangeHex = city.rangeHex ?? [];
    city.adjacentCityIds = city.adjacentCityIds ?? [];
    city.label = city.label ?? String(city.cityId);
  }
  return target;
}

function toggleBlocked(hexId) {
  const blocker = occupiedMessage(hexId);
  if (blocker && blocker !== '该格是障碍') { toast(blocker); return; }
  mutate(() => {
    const index = map.blocked.indexOf(hexId);
    if (index >= 0) map.blocked.splice(index, 1);
    else map.blocked.push(hexId);
  });
}

function paintTerrain(hexId) {
  const terrain = $('terrainPick').value;
  mutate(() => {
    const overrides = map.terrainOverrides;
    const index = overrides.findIndex((entry) => entry.hexId === hexId);
    if (index >= 0) overrides.splice(index, 1);
    // 与种子值相同的覆盖没有意义，别让它占存档体积。
    if (terrain !== seedTerrain(hexId)) overrides.push({ hexId, terrain });
  });
  rebuildChunksSoft();
}

function paintRange(hexId) {
  if (!selected || selected.kind !== 'city') { toast('先用「选择」工具选一座城，再刷它的势力范围'); return; }
  mutate(() => {
    const city = map.cities.find((item) => item.cityId === selected.id);
    if (!city) return;
    if (city.rangeHex.indexOf(hexId) < 0) city.rangeHex.push(hexId);
  });
}

function eraseAt(hexId) {
  const owner = occupiedBy().get(hexId);
  if (!owner) {
    // 空格上可能挂着出生区块或地形覆盖。
    const zone = map.spawnZones.find((item) => item.cells.indexOf(hexId) >= 0);
    if (zone) {
      mutate(() => {
        zone.cells = zone.cells.filter((id) => id !== hexId);
        poissonPoints = [];
      });
      return;
    }
    if ((map.terrainOverrides ?? []).some((entry) => entry.hexId === hexId)) {
      mutate(() => { map.terrainOverrides = map.terrainOverrides.filter((entry) => entry.hexId !== hexId); });
      rebuildChunksSoft();
      return;
    }
    toast('这一格没有可擦的东西');
    return;
  }
  mutate(() => {
    if (owner.kind === 'city') map.cities = map.cities.filter((item) => item.cityId !== owner.id);
    else if (owner.kind === 'monster') map.monsters = map.monsters.filter((item) => item.instanceId !== owner.id);
    else if (owner.kind === 'base') map.bases = map.bases.filter((item) => item.baseId !== owner.id);
    else if (owner.kind === 'point') map.points = map.points.filter((item) => item.pointId !== owner.id);
    else if (owner.kind === 'blocked') map.blocked = map.blocked.filter((id) => id !== hexId);
    selected = null;
    fillPickers();
  });
}

/** 地形改了只需重刷 class，不用重建 chunk（重建会闪）。 */
function rebuildChunksSoft() {
  renderTerrainClasses();
}

// ---------------------------------------------------------------- 面板

function syncPanel() {
  $('cityPanel').hidden = !selected || selected.kind !== 'city';
  $('monsterPanel').hidden = !selected || selected.kind !== 'monster';
  $('basePanel').hidden = !selected || selected.kind !== 'base';
  $('zonePanel').hidden = !selected || selected.kind !== 'zone';

  if (!selected) {
    $('cellInfo').textContent = '点击地图格子或实体';
    return;
  }

  if (selected.kind === 'hex') {
    const hexId = selected.id;
    const owner = occupiedBy().get(hexId);
    $('cellInfo').innerHTML = `格 ${hexId}（行 ${Math.floor(hexId / cols())} / 列 ${hexId % cols()}）<br>`
      + `环 ${ringOf(hexId)} · 地形 ${terrainAt(hexId)} · ${owner ? `占用：${owner.kind}` : '空'}`;
    return;
  }

  if (selected.kind === 'city') {
    const city = map.cities.find((item) => item.cityId === selected.id);
    if (!city) { selected = null; syncPanel(); return; }
    const def = cityDef(city.cityId);
    $('cellInfo').textContent = `城池 ${city.cityId}`;
    $('cityInfo').innerHTML = `<b>配置</b><span>${def ? `${def.cityName} / L${def.cityLevel} / layer ${def.layer}${Number(def.available) === 0 ? '（本期不开放）' : ''}` : '不在配置表里'}</span>`
      + `<b>锚点</b><span>${city.anchorHexId}（环 ${city.ring}）</span>`
      + `<b>占格</b><span>${city.hexIds.length} 格：${city.hexIds.join(',')}</span>`
      + `<b>范围</b><span>${city.rangeHex.length} 格</span>`
      + `<b>相邻</b><span>${city.adjacentCityIds.length ? city.adjacentCityIds.join(',') : '（未设置）'}</span>`;
    $('cityLabel').value = city.label ?? '';
    return;
  }

  if (selected.kind === 'monster') {
    const monster = map.monsters.find((item) => item.instanceId === selected.id);
    if (!monster) { selected = null; syncPanel(); return; }
    const def = monsterDef(monster.monsterId);
    $('cellInfo').textContent = `野怪实例 ${monster.instanceId}`;
    $('monsterInfo').innerHTML = `<b>配置</b><span>${def ? `${def.monsterName} / L${def.monsterLevel}` : '不在配置表里'}</span>`
      + `<b>锚点</b><span>${monster.anchorHexId}（环 ${ringOf(monster.anchorHexId)}）</span>`
      + `<b>占格</b><span>${monster.hexIds.length} 格</span>`;
    return;
  }

  if (selected.kind === 'base') {
    const base = map.bases.find((item) => item.baseId === selected.id);
    if (!base) { selected = null; syncPanel(); return; }
    $('cellInfo').textContent = `基地 ${base.baseId}`;
    $('baseInfo').innerHTML = `<b>坐标</b><span>${base.hexId}（环 ${base.ring}）</span>`
      + `<b>玩家</b><span>${base.isPlayer ? '是' : '否'}</span>`;
    $('baseName').value = base.name ?? '';
    return;
  }

  if (selected.kind === 'point') {
    const point = (map.points ?? []).find((item) => item.pointId === selected.id);
    $('cellInfo').textContent = point ? `据点 ${point.pointId}（类型 ${point.pointType}）` : '据点';
    return;
  }

  if (selected.kind === 'zone') {
    const zone = map.spawnZones.find((item) => item.zoneId === selected.id);
    if (!zone) { selected = null; syncPanel(); return; }
    $('cellInfo').textContent = `出生区块 ${zone.zoneId}`;
    // 同屏给出「计划容量 vs 实测能放几个」，免得策划填了个放不下的数。
    const gap = Math.max(1, Number($('zoneGap').value) || 2);
    const actual = poissonSpawnPoints(zone.cells, gap, rows(), cols()).length;
    $('zoneInfo').innerHTML = `<b>格数</b><span>${zone.cells.length} 格</span>`
      + `<b>计划容量</b><span>${zone.capacity} 个基地</span>`
      + `<b>实测（间距 ${gap}）</b><span style="color:${actual >= zone.capacity ? '#86efac' : '#fca5a5'}">${actual} 个</span>`
      + (actual < zone.capacity ? '<b></b><span style="color:#fca5a5">容量填大了：按这个间距放不下</span>' : '');
    $('zoneCity').value = String(zone.cityId ?? 0);
    $('zoneCapacity').value = String(zone.capacity ?? 0);
  }
}

// ---------------------------------------------------------------- 校验 / 保存 / 发布

function validate(showWhenClean = true) {
  if (suppressValidate) return true;
  const box = $('validation');
  try {
    const { layout, warnings } = normalizeBigmapLayout(map);
    void layout;
    if (warnings.length > 0) {
      box.hidden = false;
      box.className = 'validation warn';
      box.textContent = `通过，但有 ${warnings.length} 条提醒：\n- ${warnings.join('\n- ')}`;
    } else if (showWhenClean) {
      box.hidden = false;
      box.className = 'validation ok';
      box.textContent = '校验通过';
    } else {
      box.hidden = true;
    }
    return true;
  } catch (error) {
    box.hidden = false;
    box.className = 'validation error';
    box.textContent = `校验失败：\n- ${(error.issues ?? [String(error.message)]).join('\n- ')}`;
    return false;
  }
}

async function loadPresets() {
  const response = await fetch('/api/bigmap-presets');
  const data = await response.json();
  const select = $('presetSelect');
  const current = select.value;
  select.replaceChildren(new Option('选择预设', ''));
  for (const preset of data.presets ?? []) {
    const label = preset.error ? `${preset.id}（坏档：${preset.error.slice(0, 30)}）` : `${preset.id}（${preset.rows}×${preset.columns}，${(preset.cities ?? []).length} 城）`;
    select.appendChild(new Option(label, preset.id));
  }
  if (current) select.value = current;
}

async function doLoad(id) {
  if (!id) { toast('先选一个预设'); return; }
  if (dirty && !confirm('当前有未保存改动，继续加载会丢掉。继续？')) return;
  const response = await fetch(`/api/bigmap-presets/${encodeURIComponent(id)}`);
  if (!response.ok) { toast(`加载失败：${(await response.json()).error}`); return; }
  const data = await response.json();
  const preset = data.preset;
  delete preset.id;
  delete preset.warnings;
  map = ensureShape(preset);
  $('mapId').value = id;
  $('background').value = map.background ?? '';
  $('spawnGap').value = String(Number($('spawnGap').value) || 2);
  poissonPoints = [];
  selected = null;
  history = [];
  future = [];
  setDirty(false);
  fillPickers();
  relayout();
  syncPanel();
  validate(true);
  toast(`已加载 ${id}`);
}

function undo() {
  if (history.length === 0) return;
  future.push(snapshot());
  restore(history.pop());
}

function redo() {
  if (future.length === 0) return;
  history.push(snapshot());
  restore(future.pop());
}

/** Esc：清掉选中并回到「选择」工具（正在画图时按一下就能停下）。 */
function selectNothing() {
  selected = null;
  if (tool !== 'select') pickTool(0);
  renderSelection();
  syncPanel();
}

/** 按索引切工具（1~9 快捷键），与左侧按钮同一份状态。 */
function pickTool(index) {
  const buttons = [...document.querySelectorAll('#tools button')];
  const button = buttons[index];
  if (!button) return;
  button.click();
}

/** Del：删掉当前选中的实体（城池 / 野怪 / 基地 / 据点 / 出生区块）。 */
function deleteSelected() {
  if (!selected) return;
  if (selected.kind === 'city') $('deleteCity').click();
  else if (selected.kind === 'monster') $('deleteMonster').click();
  else if (selected.kind === 'base') $('deleteBase').click();
  else if (selected.kind === 'zone') $('deleteZone').click();
  else if (selected.kind === 'point') {
    const id = selected.id;
    mutate(() => { map.points = map.points.filter((item) => item.pointId !== id); selected = null; });
  }
}

async function doSave() {
  const id = $('mapId').value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) { toast('预设 ID 只允许字母/数字/下划线/连字符'); return; }
  if (!validate(true)) { toast('校验没过，先修问题再保存'); return; }
  let payload;
  try { payload = normalizeBigmapLayout(map).layout; }
  catch (error) { toast(`归一化失败：${error.message}`); return; }

  const response = await fetch(`/api/bigmap-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) { toast(`保存失败：${data.error}`); return; }
  map = ensureShape({ ...data.preset });
  delete map.id;
  delete map.warnings;
  setDirty(false);
  await loadPresets();
  $('presetSelect').value = id;
  toast(`已保存 ${id}`);
}

async function doPublish() {
  const id = $('mapId').value.trim();
  if (!id) { toast('先填预设 ID'); return; }
  if (dirty) { toast('先保存再发布'); return; }
  const response = await fetch(`/api/bigmap-publish/${encodeURIComponent(id)}`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok) { toast(`发布失败：${data.error}`); return; }
  toast(`已发布到 ${data.target}/${id}.json${data.warnings?.length ? `（${data.warnings.length} 条提醒）` : ''}`);
}

function doExport() {
  const blob = new Blob([JSON.stringify(map, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${$('mapId').value || 'bigmap'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 导出当前视图 PNG（2×）。
 *
 * 光栅化前**必须移除 `<image>`**：SVG 里引了外部图片，canvas 会被污染（tainted），
 * `toDataURL` 直接抛 SecurityError。背景图就是 `<image href="/bg/...">`，
 * 移除后截图不带背景，但评审看布局足够。
 */
async function doSnapshot() {
  const clone = svg.cloneNode(true);
  for (const node of clone.querySelectorAll('image')) node.remove();
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('width', String(svgW));
  clone.setAttribute('height', String(svgH));
  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG 光栅化失败'));
      image.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(svgW * scale);
    canvas.height = Math.round(svgH * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#0b1220';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const link = document.createElement('a');
    link.download = `${$('mapId').value || 'bigmap'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('已导出 PNG');
  } catch (error) {
    toast(`截图失败：${error.message}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 城池清单 CSV（给策划对表用）。带 BOM，Excel 打开中文不乱码。 */
function doExportCsv() {
  const header = [
    'cityId', 'cityName', 'cityLevel', 'layer', 'available', 'label',
    'anchorHexId', 'row', 'column', 'ring', 'hexCount', 'rangeHexCount', 'adjacentCityIds',
  ];
  const lines = [header.join(',')];
  for (const city of map.cities) {
    const def = cityDef(city.cityId);
    lines.push([
      city.cityId,
      csvCell(def ? def.cityName : '（不在配置表）'),
      def ? def.cityLevel : '',
      def ? def.layer : '',
      def ? def.available : '',
      csvCell(city.label ?? ''),
      city.anchorHexId,
      Math.floor(city.anchorHexId / cols()),
      city.anchorHexId % cols(),
      city.ring,
      city.hexIds.length,
      (city.rangeHex ?? []).length,
      csvCell((city.adjacentCityIds ?? []).join(' ')),
    ].join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${$('mapId').value || 'bigmap'}-cities.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast(`已导出 ${map.cities.length} 座城的清单`);
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      suppressValidate = true;
      map = ensureShape(data);
      suppressValidate = false;
      commit();
      fillPickers();
      relayout();
      syncPanel();
      validate(true);
      toast('已导入（尚未保存）');
    } catch (error) {
      toast(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------- 初始化

function fillPickers() {
  const usedCities = new Set(map.cities.map((item) => Number(item.cityId)));
  const cityPick = $('cityPick');
  cityPick.replaceChildren();
  const candidates = cfg.cities.filter((item) => !usedCities.has(Number(item.cityId)));
  if (candidates.length === 0) cityPick.appendChild(new Option('（配置里的城都放完了）', ''));
  for (const city of candidates) {
    cityPick.appendChild(new Option(`${city.cityId} ${city.cityName}（L${city.cityLevel}）`, String(city.cityId)));
  }

  const monsterPick = $('monsterPick');
  monsterPick.replaceChildren();
  for (const monster of cfg.monsters) {
    monsterPick.appendChild(new Option(`${monster.monsterId} ${monster.monsterName}（L${monster.monsterLevel}，${monster.occupyHex} 格）`, String(monster.monsterId)));
  }
}

function renderMapInfo() {
  $('mapInfo').innerHTML = `<b>worldId</b><span>${map.worldId}</span>`
    + `<b>尺寸</b><span>${map.rows} × ${map.columns}（${total()} 格）</span>`
    + `<b>地形种子</b><span>${map.terrainSeed}</span>`
    + `<b>布局版本</b><span>${map.layoutVersion}</span>`
    + `<b>内容</b><span>城 ${map.cities.length} / 怪 ${map.monsters.length} / 基地 ${map.bases.length}</span>`
    + `<b>生成</b><span>区块 ${map.spawnZones.length} / 据点 ${map.points.length} / 障碍 ${map.blocked.length}</span>`
    + (map.background ? `<b>背景</b><span>${map.background}</span>` : '');
  const world = cfg.world;
  if (world && (Number(world.rows) !== Number(map.rows) || Number(world.cols) !== Number(map.columns))) {
    $('mapInfo').innerHTML += `<b style="color:#fca5a5">注意</b><span style="color:#fca5a5">配置表是 ${world.rows}×${world.cols}，与布局不一致 ⇒ 运行时会拒绝加载</span>`;
  }
}

function bindEvents() {
  const tools = $('tools');
  for (const button of tools.querySelectorAll('button')) {
    button.addEventListener('click', () => {
      tool = button.dataset.mode;
      for (const other of tools.querySelectorAll('button')) other.classList.toggle('active', other === button);
      $('toolStatus').textContent = `当前：${button.textContent}`;
    });
  }

  // 右键：没移动 = 擦除（对齐领地），移动了 = 平移画布（100×100 靠滚动条太难受）。
  // 用 pointerdown/up 的位移判定，而不是 click —— click 拿不到「拖了多远」。
  let rightDrag = null;
  svg.addEventListener('contextmenu', (event) => event.preventDefault());
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 2) return;
    event.preventDefault();
    rightDrag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
    // 合成事件（探针/自动化）没有 active pointer，capture 会抛 NotFoundError；真实鼠标不受影响。
    try { svg.setPointerCapture?.(event.pointerId); } catch { /* 忽略 */ }
  });
  svg.addEventListener('pointermove', (event) => {
    if (!rightDrag) return;
    const dx = event.clientX - rightDrag.x;
    const dy = event.clientY - rightDrag.y;
    if (!rightDrag.moved && Math.hypot(dx, dy) < 4) return;
    rightDrag.moved = true;
    stage.scrollLeft = rightDrag.left - dx;
    stage.scrollTop = rightDrag.top - dy;
  });
  svg.addEventListener('pointerup', (event) => {
    if (!rightDrag) return;
    const moved = rightDrag.moved;
    rightDrag = null;
    try { svg.releasePointerCapture?.(event.pointerId); } catch { /* 忽略 */ }
    if (moved) return;
    const point = localPoint(event);
    const hexId = cellAtLocal(point.x, point.y);
    if (hexId >= 0) eraseAt(hexId);
  });
  svg.addEventListener('click', (event) => {
    const entity = event.target.closest('.ent');
    if (entity) {
      selected = { kind: entity.dataset.kind, id: entity.dataset.kind === 'base' ? entity.dataset.id : Number(entity.dataset.id) };
      renderSelection();
      syncPanel();
      return;
    }
    const cell = event.target.closest('.cell');
    const point = localPoint(event);
    const hexId = cell ? Number(cell.dataset.hex) : cellAtLocal(point.x, point.y);
    if (hexId < 0) return;
    onCellClick(hexId);
  });

  stage.addEventListener('scroll', () => ensureChunks());
  window.addEventListener('resize', () => ensureChunks());

  bindZoomSlider($('zoom'), (percent) => {
    zoom = percent;
    applyZoom();
    ensureChunks();
  });

  for (const id of ['showGrid', 'showRing']) {
    $(id).addEventListener('change', () => relayout());
  }
  for (const id of ['showRange', 'showZone', 'showLabel']) {
    $(id).addEventListener('change', () => render());
  }

  $('load').addEventListener('click', () => doLoad($('presetSelect').value));
  $('save').addEventListener('click', () => doSave());
  $('validate').addEventListener('click', () => validate(true));
  $('validateRight').addEventListener('click', () => validate(true));
  $('publish').addEventListener('click', () => doPublish());
  $('export').addEventListener('click', () => doExport());
  $('snapshot').addEventListener('click', () => doSnapshot());
  $('csv').addEventListener('click', () => doExportCsv());
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) doImport(file); });
  $('undo').addEventListener('click', () => undo());
  $('redo').addEventListener('click', () => redo());

  $('cityLabel').addEventListener('change', () => {
    if (!selected || selected.kind !== 'city') return;
    const city = map.cities.find((item) => item.cityId === selected.id);
    if (city) { commit(); city.label = $('cityLabel').value; render(); }
  });

  $('applyRange').addEventListener('click', () => {
    if (!selected || selected.kind !== 'city') { toast('先选一座城'); return; }
    const radius = Math.max(1, Math.min(12, Number($('rangeRadius').value) || 3));
    mutate(() => {
      const city = map.cities.find((item) => item.cityId === selected.id);
      if (!city) return;
      const cells = circleHexes(city.anchorHexId, radius, rows(), cols());
      const merged = new Set([...city.rangeHex, ...cells]);
      city.rangeHex = [...merged];
    });
  });

  $('clearRange').addEventListener('click', () => {
    if (!selected || selected.kind !== 'city') return;
    mutate(() => {
      const city = map.cities.find((item) => item.cityId === selected.id);
      if (city) city.rangeHex = [];
    });
  });

  $('deleteCity').addEventListener('click', () => {
    if (!selected || selected.kind !== 'city') return;
    const id = selected.id;
    mutate(() => { map.cities = map.cities.filter((item) => item.cityId !== id); selected = null; fillPickers(); });
  });

  $('deleteMonster').addEventListener('click', () => {
    if (!selected || selected.kind !== 'monster') return;
    const id = selected.id;
    mutate(() => { map.monsters = map.monsters.filter((item) => item.instanceId !== id); selected = null; });
  });

  $('deleteBase').addEventListener('click', () => {
    if (!selected || selected.kind !== 'base') return;
    const id = selected.id;
    mutate(() => { map.bases = map.bases.filter((item) => item.baseId !== id); selected = null; });
  });

  $('baseName').addEventListener('change', () => {
    if (!selected || selected.kind !== 'base') return;
    const base = map.bases.find((item) => item.baseId === selected.id);
    if (base) { commit(); base.name = $('baseName').value; render(); }
  });

  $('bulkRange').addEventListener('click', () => {
    const radius = Math.max(1, Math.min(12, Number($('bulkRadius').value) || 3));
    if (!confirm(`给全部 ${map.cities.length} 座城按半径 ${radius} 铺势力范围（会合并进已有范围）？`)) return;
    mutate(() => {
      for (const city of map.cities) {
        const merged = new Set([...city.rangeHex, ...circleHexes(city.anchorHexId, radius, rows(), cols())]);
        city.rangeHex = [...merged];
      }
    });
  });

  $('deriveAdjacent').addEventListener('click', () => {
    mutate(() => {
      const result = deriveAdjacentCities(map.cities, rows(), cols());
      for (const city of map.cities) city.adjacentCityIds = result.get(city.cityId) ?? [];
    });
  });

  $('applyBackground').addEventListener('click', () => {
    mutate(() => { map.background = $('background').value.trim(); });
    renderBackground();
  });

  $('showPoisson').addEventListener('change', () => renderPoisson());
  $('zoneGap').addEventListener('change', () => syncPanel());

  $('zoneCity').addEventListener('change', () => {
    if (!selected || selected.kind !== 'zone') return;
    const zone = map.spawnZones.find((item) => item.zoneId === selected.id);
    if (!zone) return;
    commit();
    zone.cityId = Math.max(0, Number($('zoneCity').value) || 0);
    syncPanel();
  });

  $('zoneCapacity').addEventListener('change', () => {
    if (!selected || selected.kind !== 'zone') return;
    const zone = map.spawnZones.find((item) => item.zoneId === selected.id);
    if (!zone) return;
    commit();
    zone.capacity = Math.max(0, Number($('zoneCapacity').value) || 0);
    syncPanel();
  });

  $('zonePreview').addEventListener('click', () => {
    if (!selected || selected.kind !== 'zone') return;
    const zone = map.spawnZones.find((item) => item.zoneId === selected.id);
    if (!zone) return;
    const gap = Math.max(1, Number($('zoneGap').value) || 2);
    poissonPoints = poissonSpawnPoints(zone.cells, gap, rows(), cols(), bannedHexes());
    renderPoisson();
    syncPanel();
    toast(`区块 ${zone.zoneId}：${zone.cells.length} 格，间距 ${gap} → 能放 ${poissonPoints.length} 个基地`);
  });

  $('deleteZone').addEventListener('click', () => {
    if (!selected || selected.kind !== 'zone') return;
    const id = selected.id;
    mutate(() => {
      map.spawnZones = map.spawnZones.filter((item) => item.zoneId !== id);
      selected = null;
      poissonPoints = [];
    });
  });

  $('bulkPoisson').addEventListener('click', () => {
    const gap = Math.max(1, Number($('spawnGap').value) || 2);
    const banned = bannedHexes();
    poissonPoints = [];
    let planned = 0;
    const lines = [];
    for (const zone of map.spawnZones) {
      const points = poissonSpawnPoints(zone.cells, gap, rows(), cols(), banned);
      poissonPoints.push(...points);
      planned += zone.capacity;
      lines.push(`区块 ${zone.zoneId}：${zone.cells.length} 格 → ${points.length} 个（计划 ${zone.capacity}）`);
    }
    renderPoisson();
    const box = $('validation');
    box.hidden = false;
    box.className = poissonPoints.length >= planned ? 'validation ok' : 'validation warn';
    box.textContent = `出生容量（间距 ${gap}）：实测 ${poissonPoints.length} 个 / 计划 ${planned} 个`
      + (lines.length ? `\n- ${lines.join('\n- ')}` : '\n（还没有出生区块）');
    toast(`全图能放 ${poissonPoints.length} 个基地（计划 ${planned}）`);
  });

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey || event.metaKey;
    // Ctrl 组合与领地编辑器保持一致（同一套肌肉记忆，切编辑器不用重新学）
    if (ctrl && key === 's') { event.preventDefault(); doSave(); return; }
    if (ctrl && key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); return; }
    if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); redo(); return; }
    // 输入框里按 Esc / Delete / 数字不该动编辑器
    const tag = document.activeElement?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === 'Escape') { selectNothing(); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected(); return; }
    if (/^[1-9]$/.test(event.key)) { pickTool(Number(event.key) - 1); }
  });

  window.addEventListener('beforeunload', (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  });
}

async function init() {
  const response = await fetch('/api/bigmap-config');
  const data = await response.json();
  cfg = { world: data.world, cities: data.cities ?? [], monsters: data.monsters ?? [] };
  await loadPresets();

  const first = $('presetSelect').options[1]?.value ?? '';
  if (first) {
    await doLoad(first);
  } else {
    // 一张预设都没有：按配置表尺寸开一张空白图。
    const rowsCount = Number(cfg.world?.rows ?? 40);
    const columns = Number(cfg.world?.cols ?? 40);
    $('mapId').value = 'world_01';
    map = ensureShape({
      kind: BIGMAP_LAYOUT_KIND,
      version: BIGMAP_LAYOUT_VERSION,
      layoutVersion: 1,
      worldId: Number(cfg.world?.worldId ?? 1),
      worldName: '植物大地图',
      rows: rowsCount,
      columns,
      terrainSeed: 20261017,
      terrainOverrides: [],
      cities: [],
      monsters: [],
      bases: [],
      blocked: [],
      spawnZones: [],
      points: [],
      background: '',
    });
    $('background').value = '';
    fillPickers();
    relayout();
    validate(false);
  }
  renderMapInfo();
  bindEvents();
  // 加载会先于 bindEvents 触发，补一次信息面板刷新。
  const refresh = setInterval(() => { if (map) { renderMapInfo(); clearInterval(refresh); } }, 100);
}

init().catch((error) => {
  toast(`初始化失败：${error.message}`);
  console.error(error);
});
