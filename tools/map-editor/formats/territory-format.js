export const TERRITORY_MAP_KIND = 'territoryChapter';
export const TERRITORY_VERSION = 1;
export const TERRITORY_SITE_TYPES = Object.freeze(['stage', 'boss', 'asyncPvp', 'fixedResource', 'bonus']);

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SITE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class TerritoryValidationError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [String(issues)];
    super(normalized.join('; '));
    this.name = 'TerritoryValidationError';
    this.issues = normalized;
    this.statusCode = 400;
  }
}

export function cellCount(rows, columns) {
  return rows * columns;
}

export function cellCoords(cellId, columns) {
  return { row: Math.floor(cellId / columns), column: cellId % columns };
}

export function cellIdAt(row, column, rows, columns) {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= rows || column >= columns) return -1;
  return row * columns + column;
}

// Odd-column offset neighbours. The editor and runtime use flat-top hexes with alternating column Y offsets.
export function hexNeighbors(cellId, rows, columns) {
  const { row, column } = cellCoords(cellId, columns);
  const offsets = column % 2 === 0
    ? [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]]
    : [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]];
  return offsets.map(([dr, dc]) => cellIdAt(row + dr, column + dc, rows, columns)).filter((id) => id >= 0);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, label, issues, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) issues.push(`${label} must be an integer in [${min}, ${max}]`);
  return Number.isInteger(value) ? value : min;
}

function nonNegative(value, label, issues, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) issues.push(`${label} must be a non-negative integer`);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function stringValue(value, label, issues, { required = false, pattern } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) {
    issues.push(`${label} must be a non-empty string`);
    return '';
  }
  if (pattern && !pattern.test(value)) issues.push(`${label} contains unsupported characters`);
  return value;
}

function uniqueIntegers(value, label, total, issues, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return [];
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item >= total) issues.push(`${label} contains an out-of-bounds cell`);
    else if (seen.has(item)) issues.push(`${label} contains duplicate cell ${item}`);
    else { seen.add(item); result.push(item); }
  }
  return result;
}

function connected(footprint, rows, columns) {
  if (footprint.length <= 1) return true;
  const target = new Set(footprint);
  const seen = new Set([footprint[0]]);
  const queue = [footprint[0]];
  while (queue.length) {
    const current = queue.shift();
    for (const next of hexNeighbors(current, rows, columns)) {
      if (target.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === target.size;
}

function normalizeUnlock(unlock, siteLabel, issues, defaults) {
  if (unlock === undefined) unlock = {};
  if (!isRecord(unlock)) { issues.push(`${siteLabel}.unlock must be an object`); unlock = {}; }
  const requiredCells = uniqueIntegers(unlock.requiredCells ?? [], `${siteLabel}.unlock.requiredCells`, defaults.total, issues);
  return {
    requiredCells,
    combatPower: nonNegative(unlock.combatPower, `${siteLabel}.unlock.combatPower`, issues, defaults.combatPower),
    silverCost: nonNegative(unlock.silverCost, `${siteLabel}.unlock.silverCost`, issues, defaults.silverCost),
    exploreSeconds: nonNegative(unlock.exploreSeconds, `${siteLabel}.unlock.exploreSeconds`, issues, defaults.exploreSeconds),
    staminaCost: nonNegative(unlock.staminaCost, `${siteLabel}.unlock.staminaCost`, issues, defaults.staminaCost),
  };
}

export function normalizeTerritoryMap(data, fallbackId) {
  const issues = [];
  if (!isRecord(data)) throw new TerritoryValidationError('territory map must be an object');
  const id = stringValue(data.id ?? fallbackId, 'id', issues, { required: true, pattern: ID_PATTERN });
  if (data.mapKind !== TERRITORY_MAP_KIND) issues.push(`mapKind must be ${TERRITORY_MAP_KIND}`);
  if (data.version !== TERRITORY_VERSION) issues.push(`version must be ${TERRITORY_VERSION}`);
  const rows = integer(data.rows, 'rows', issues, { min: 4, max: 60 });
  const columns = integer(data.columns, 'columns', issues, { min: 4, max: 60 });
  const total = rows * columns;
  const startCellId = integer(data.startCellId, 'startCellId', issues, { min: 0, max: Math.max(0, total - 1) });
  const chapterId = integer(data.chapterId, 'chapterId', issues, { min: 1, max: 9999 });
  const defaultsInput = isRecord(data.defaults) ? data.defaults : {};
  if (!isRecord(data.defaults)) issues.push('defaults must be an object');
  const defaults = {
    combatPower: nonNegative(defaultsInput.combatPower, 'defaults.combatPower', issues),
    silverCost: nonNegative(defaultsInput.silverCost, 'defaults.silverCost', issues, 10),
    exploreSeconds: nonNegative(defaultsInput.exploreSeconds, 'defaults.exploreSeconds', issues, 2),
    staminaCost: nonNegative(defaultsInput.staminaCost, 'defaults.staminaCost', issues, 5),
  };
  defaults.total = total;
  const background = stringValue(data.background, 'background', issues) ?? '';
  if (!Array.isArray(data.sites)) issues.push('sites must be an array');
  const sites = [];
  const siteIds = new Set();
  const occupied = new Map();
  for (const [index, raw] of (Array.isArray(data.sites) ? data.sites : []).entries()) {
    const label = `sites[${index}]`;
    if (!isRecord(raw)) { issues.push(`${label} must be an object`); continue; }
    const siteId = stringValue(raw.id, `${label}.id`, issues, { required: true, pattern: SITE_ID_PATTERN });
    if (siteIds.has(siteId)) issues.push(`duplicate site id ${siteId}`); else siteIds.add(siteId);
    const type = raw.type;
    if (!TERRITORY_SITE_TYPES.includes(type)) issues.push(`${label}.type must be one of ${TERRITORY_SITE_TYPES.join(', ')}`);
    const cellId = integer(raw.cellId, `${label}.cellId`, issues, { min: 0, max: Math.max(0, total - 1) });
    const footprint = uniqueIntegers(raw.footprint ?? [cellId], `${label}.footprint`, total, issues, { required: true });
    if (!footprint.includes(cellId)) issues.push(`${label}.footprint must include cellId`);
    if (!connected(footprint, rows, columns)) issues.push(`${label}.footprint must be contiguous`);
    for (const occupiedCell of footprint) {
      if (occupied.has(occupiedCell)) issues.push(`site ${siteId} overlaps site ${occupied.get(occupiedCell)}`);
      occupied.set(occupiedCell, siteId);
      if (occupiedCell === startCellId) issues.push(`site ${siteId} cannot occupy startCellId`);
    }
    const unlock = normalizeUnlock(raw.unlock, label, issues, defaults);
    if (unlock.requiredCells.includes(cellId)) issues.push(`${label}.unlock.requiredCells cannot contain its own cellId`);
    const hasRewardId = raw.rewardId !== undefined;
    if (hasRewardId && type !== 'fixedResource') issues.push(`${label}.rewardId is only valid for fixedResource sites`);
    if (hasRewardId && (!Number.isInteger(raw.rewardId) || raw.rewardId <= 0)) {
      issues.push(`${label}.rewardId must be a positive integer`);
    }
    sites.push({
      id: siteId,
      type,
      cellId,
      footprint,
      ...(stringValue(raw.configId, `${label}.configId`, issues) !== undefined ? { configId: raw.configId } : {}),
      ...(stringValue(raw.buildingId, `${label}.buildingId`, issues) !== undefined ? { buildingId: raw.buildingId } : {}),
      ...(hasRewardId && type === 'fixedResource' && Number.isInteger(raw.rewardId) && raw.rewardId > 0 ? { rewardId: raw.rewardId } : {}),
      unlock,
    });
  }
  const fixedCells = new Set([startCellId, ...occupied.keys()]);
  const siteByCell = new Map(sites.map((site) => [site.cellId, site]));
  const dependencyState = new Map();
  const visitSite = (site) => {
    const state = dependencyState.get(site.id) || 0;
    if (state === 1) { issues.push(`unlock dependency cycle at ${site.id}`); return false; }
    if (state === 2) return true;
    dependencyState.set(site.id, 1);
    for (const requiredCell of site.unlock.requiredCells) {
      if (requiredCell === startCellId) continue;
      const dependency = siteByCell.get(requiredCell);
      if (!dependency) issues.push(`site ${site.id} requires cell ${requiredCell}, but no fixed site owns it`);
      else visitSite(dependency);
    }
    dependencyState.set(site.id, 2);
    return true;
  };
  for (const site of sites) visitSite(site);
  const randomInput = data.randomSites;
  let randomSites;
  if (randomInput !== undefined) {
    if (!isRecord(randomInput)) issues.push('randomSites must be an object');
    const random = isRecord(randomInput) ? randomInput : {};
    const candidates = uniqueIntegers(random.candidateCells ?? [], 'randomSites.candidateCells', total, issues, { required: true });
    for (const cell of candidates) if (fixedCells.has(cell)) issues.push(`randomSites.candidateCells cannot use fixed cell ${cell}`);
    const maxActive = integer(random.maxActive ?? 1, 'randomSites.maxActive', issues, { min: 1, max: 999 });
    const rewardPoolId = stringValue(random.rewardPoolId, 'randomSites.rewardPoolId', issues, { required: true });
    // 可选：逐格建筑 ID —— `buildingIds: { "<cellId>": "<建筑 ID>" }`。
    // ⚠️ 建筑 ID 是**针对单个随机据点**的（不是整张图一个），所以是 cellId → 建筑 的映射，
    // key 必须是候选格之一，否则那一格永远不会出现、这条配置等于静默失效。
    // 空串/纯空格 =「这一格没指定」，不写进产物（与 Python 侧 `strip()` 后再判的口径一致）。
    const buildingIds = {};
    const rawBuildingIds = random.buildingIds;
    if (rawBuildingIds !== undefined) {
      if (!isRecord(rawBuildingIds)) issues.push('randomSites.buildingIds must be an object');
      else {
        for (const key of Object.keys(rawBuildingIds)) {
          // ⚠️ `Number('')` 是 0、`Number(' 12 ')` 是 12、`Number('1.5')` 非整数 ——
          // 只接受十进制非负整数字符串（与 Python 侧 `str.isdigit()` 同一口径）。
          if (!/^\d+$/.test(key)) {
            issues.push(`randomSites.buildingIds.${key} must be a cell in [0, ${total - 1}]`);
            continue;
          }
          const cell = Number(key);
          if (cell >= total) {
            issues.push(`randomSites.buildingIds.${key} must be a cell in [0, ${total - 1}]`);
            continue;
          }
          if (!candidates.includes(cell)) {
            issues.push(`randomSites.buildingIds.${key} is not a candidate cell`);
            continue;
          }
          const value = rawBuildingIds[key];
          if (typeof value !== 'string') {
            issues.push(`randomSites.buildingIds.${key} must be a string`);
            continue;
          }
          const trimmed = value.trim();
          if (trimmed !== '') buildingIds[String(cell)] = trimmed;
        }
      }
    }
    randomSites = {
      triggerSilver: nonNegative(random.triggerSilver, 'randomSites.triggerSilver', issues),
      rewardPoolId,
      candidateCells: candidates,
      maxActive,
      // 按 cellId 升序输出，让同一份配置在不同机器上产物字节一致。
      ...(Object.keys(buildingIds).length
        ? { buildingIds: Object.fromEntries(Object.keys(buildingIds).sort((a, b) => Number(a) - Number(b)).map((k) => [k, buildingIds[k]])) }
        : {}),
    };
  }
  const decorations = [];
  if (data.decorations !== undefined) {
    if (!Array.isArray(data.decorations)) issues.push('decorations must be an array');
    else for (const [index, raw] of data.decorations.entries()) {
      const label = `decorations[${index}]`;
      if (!isRecord(raw)) { issues.push(`${label} must be an object`); continue; }
      const cellId = integer(raw.cellId, `${label}.cellId`, issues, { min: 0, max: Math.max(0, total - 1) });
      const artId = stringValue(raw.artId, `${label}.artId`, issues, { required: true });
      decorations.push({ cellId, artId });
    }
  }
  const name = stringValue(data.name, 'name', issues) ?? id;
  const warnings = [];
  if (issues.length) throw new TerritoryValidationError(issues);
  if (sites.length !== 10) warnings.push(`chapter ${chapterId} has ${sites.length} fixed sites; expected 10 levels`);
  if (sites.length > Math.floor(total * 0.5)) warnings.push('fixed site occupancy exceeds half of the chapter map');
  const normalized = {
    version: TERRITORY_VERSION,
    mapKind: TERRITORY_MAP_KIND,
    id,
    name,
    chapterId,
    rows,
    columns,
    startCellId,
    background,
    defaults: { ...defaults, total: undefined },
    sites,
    ...(randomSites ? { randomSites } : {}),
    ...(decorations.length ? { decorations } : {}),
  };
  delete normalized.defaults.total;
  return { map: normalized, warnings };
}

export function validateTerritoryMap(data, fallbackId) {
  return normalizeTerritoryMap(data, fallbackId);
}
