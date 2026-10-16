// 章节领地地图：把校验 issue 文本映射到「出问题的格子」。
//
// 为什么是「按文本反解」而不是让校验器直接给结构化定位：
// `validateTerritoryMap()` 只抛字符串数组（`TerritoryValidationError.issues`），
// 没有带 cellId 的结构化信息，而 issue 文本是编辑器唯一能拿到的线索。
// 所以这里按校验器**实际产出的格式**反解 —— 格式一旦变了测试就红：
// tests/territory-issue-cells.test.ts 用**真跑校验器**产生的 issue 喂断言，不手写样本。
//
// 解析分两步，结果取并集：
//   1) 结构化定位：按 issue 前缀（`sites[i].` / `decorations[i].` / `site X overlaps site Y` …）
//      回 data 里查出对应 cellId；
//   2) 兜底扫格号：文本里所有 `cell N` / `cellId N` 都算（如 `cannot use fixed cell 153`）。
// 这样即使漏了某个新格式，只要消息里带格号就不会漏标。
//
// 只读、纯函数（零 DOM / 零 cc）—— 编辑器拿它给格子打 error 标签，Node 单测直接 import。

const SITE_FIELD = /^sites\[(\d+)\]/;
const DECOR_FIELD = /^decorations\[(\d+)\]/;
const SITE_OVERLAP = /^site (.*?) overlaps site (.*)$/;
const SITE_ON_START = /^site (.*?) cannot occupy startCellId$/;
const SITE_REQUIRES = /^site (.*?) requires cell (\d+), but no fixed site owns it$/;
const DEPENDENCY_CYCLE = /^unlock dependency cycle at (.*)$/;
const DUPLICATE_SITE_ID = /^duplicate site id (.*)$/;
const START_CELL = /^startCellId\b/;
// `cannot use fixed cell 153` / `contains duplicate cell 88` / `requires cell 303`
const CELL_NUMBER = /cell(?:Id)?\s+(\d+)\b/g;
// 这两条说的是「整块 footprint 有问题」，只标 cellId 会漏掉离群的那一格
const WHOLE_FOOTPRINT = /\.footprint must be contiguous$|\.footprint contains an out-of-bounds cell$/;

function sitesOf(data) {
  return Array.isArray(data?.sites) ? data.sites : [];
}

function decorationsOf(data) {
  return Array.isArray(data?.decorations) ? data.decorations : [];
}

// 格子上界：优先用调用方给的 total，其次 rows×columns，都没有就不做范围过滤
// （越界的格号本来也没法在图上画出来）
function cellBound(data, total) {
  if (Number.isInteger(total) && total > 0) return total;
  const rows = data?.rows, columns = data?.columns;
  if (Number.isInteger(rows) && rows > 0 && Number.isInteger(columns) && columns > 0) return rows * columns;
  return Number.MAX_SAFE_INTEGER;
}

function footprintOf(site) {
  if (!site || typeof site !== 'object') return [];
  const source = Array.isArray(site.footprint) && site.footprint.length ? site.footprint : [site.cellId];
  return source.filter((cell) => Number.isInteger(cell));
}

function anchorOf(site) {
  if (Number.isInteger(site?.cellId)) return site.cellId;
  const footprint = footprintOf(site);
  return footprint.length ? footprint[0] : undefined;
}

/**
 * 单个 issue 关联的格子号（升序去重）。
 * @param {string} issue 校验器产出的 issue 文本
 * @param {object} data 编辑器当前数据（sites / decorations / startCellId / rows / columns）
 * @param {number} [total] 可选的总格数；不传就按 rows×columns 推
 * @returns {number[]}
 */
export function issueCells(issue, data, total) {
  const text = String(issue ?? '');
  const bound = cellBound(data, total);
  const inside = (cell) => Number.isInteger(cell) && cell >= 0 && cell < bound;
  const cells = new Set();
  const add = (value) => {
    for (const cell of Array.isArray(value) ? value : [value]) if (inside(cell)) cells.add(cell);
  };

  const sites = sitesOf(data);
  const byId = (id) => sites.filter((site) => site && typeof site === 'object' && String(site.id ?? '') === id);

  const siteField = text.match(SITE_FIELD);
  const decorField = text.match(DECOR_FIELD);
  const overlap = text.match(SITE_OVERLAP);
  const onStart = text.match(SITE_ON_START);
  const requires = text.match(SITE_REQUIRES);
  const cycle = text.match(DEPENDENCY_CYCLE);
  const duplicateId = text.match(DUPLICATE_SITE_ID);

  if (siteField) {
    const site = sites[Number(siteField[1])];
    add(WHOLE_FOOTPRINT.test(text) ? footprintOf(site) : anchorOf(site));
  } else if (decorField) {
    const decoration = decorationsOf(data)[Number(decorField[1])];
    if (decoration && Number.isInteger(decoration.cellId)) add(decoration.cellId);
  } else if (overlap) {
    const left = byId(overlap[1].trim());
    const right = byId(overlap[2].trim());
    const shared = [];
    for (const a of left) for (const b of right) for (const cell of footprintOf(a)) if (footprintOf(b).includes(cell)) shared.push(cell);
    // 交集为空说明 footprint 数据本身坏了 ⇒ 退一步把两个站点都标出来
    add(shared.length ? shared : [...left, ...right].flatMap(footprintOf));
  } else if (onStart) {
    add(data?.startCellId);                              // 被占的初始格
    add(byId(onStart[1].trim()).flatMap(footprintOf));    // 占上去的那个站点
  } else if (requires) {
    add(Number(requires[2]));                            // 悬空依赖指向的那一格
    add(byId(requires[1].trim()).flatMap(footprintOf));   // 报错的站点本身
  } else if (cycle) {
    add(byId(cycle[1].trim()).flatMap(footprintOf));
  } else if (duplicateId) {
    add(byId(duplicateId[1].trim()).flatMap(footprintOf));
  } else if (START_CELL.test(text)) {
    add(data?.startCellId);
  }

  for (const match of text.matchAll(CELL_NUMBER)) add(Number(match[1]));
  return [...cells].sort((a, b) => a - b);
}

/**
 * issue 列表 → 格子标记（一个格子可能多条）。
 * @returns {{cellId: number, text: string}[]}
 */
export function issuesToCellMarkers(issues, data, total) {
  const markers = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    const text = String(issue);
    for (const cellId of issueCells(text, data, total)) markers.push({ cellId, text });
  }
  return markers;
}
