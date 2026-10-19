import { hexGridNeighborIds } from '../../../core/hex/HexGridLayout';

/** 章节领地静态地图协议；运行时进度不在这里。 */
export const TERRITORY_MAP_KIND = 'territoryChapter' as const;
export const TERRITORY_MAP_VERSION = 1 as const;

/**
 * 站点类型**命名常量**（**唯一事实源**：`TerritorySiteType` 与 `TERRITORY_SITE_TYPES` 都由它推导）。
 *
 * ⚠️ 禁止在别处写 `'stage'` / `['stage', …] as const` 这类第二份字面量——
 * 业务代码一律 `site.type === TERRITORY_SITE_TYPE.fixedResource` 判定（改名/拼错编译期即暴露）。
 */
export const TERRITORY_SITE_TYPE = {
    stage: 'stage',
    boss: 'boss',
    asyncPvp: 'asyncPvp',
    fixedResource: 'fixedResource',
    bonus: 'bonus',
} as const;

export type TerritorySiteType = typeof TERRITORY_SITE_TYPE[keyof typeof TERRITORY_SITE_TYPE];

/** 全量类型数组（配表解析校验用；顺序 = 表内声明顺序，由常量表推导，不是第二份字面量）。 */
export const TERRITORY_SITE_TYPES: readonly TerritorySiteType[] = Object.values(TERRITORY_SITE_TYPE);

/** 编译期守卫：每个键必须是合法类型值（防 `stage: 'boss'` 这类键值错位静默通过）。 */
type Assert<T extends true> = T;
type AssertSiteTypeKeysAreValues = Assert<
    keyof typeof TERRITORY_SITE_TYPE extends TerritorySiteType ? true : false
>;

/**
 * 🔴 历史口径（**已废弃，2026-10-15**）：早先「先解锁、再点一下就打」的关卡是**按格子 id
 * 硬编码**的（`TERRITORY_TWO_STEP_CELL_IDS = [327, 328]`，只有 `configId=10001` 这一片），
 * 于是出现了「关卡 1 点建筑就开战、关卡 2 只能弹详情面板」的分裂。
 *
 * 现在改由**站点类型**判定：`TerritoryPresenter.selectSite` 与
 * `TerritoryMapView.stationRenderOf` 按可开战站点类型处理 `stage` / `boss` / `asyncPvp`
 * ⇒ 两份硬编码名单连同 `isTerritoryTwoStepCell()` 一起删掉了。
 *
 * ⚠️ 别再往回加「按 cellId 名单」这类判定 —— 每加一关就要改一次代码，且漏改的症状是
 * **零报错**（类型/数据都对，只是点了没反应，或反过来外观说能打、点了没反应）。
 * 关卡的准入条件只有一条：**站点有受支持的战斗类型和有效 configId**。
 */

export interface TerritoryUnlock {
    requiredCells: number[];
    combatPower: number;
    silverCost: number;
    exploreSeconds: number;
    staminaCost: number;
}

export interface TerritorySite {
    id: string;
    type: TerritorySiteType;
    cellId: number;
    footprint: number[];
    configId?: string;
    buildingId?: string;
    /** `PVP-关卡` 的关卡地图格子奖励表 ID，仅固定资源点使用。 */
    rewardId?: number;
    unlock: TerritoryUnlock;
}

export interface TerritoryRandomSites {
    triggerSilver: number;
    rewardPoolId: string;
    candidateCells: number[];
    maxActive: number;
    /**
     * 逐格建筑 ID：`cellId → 建筑 ID`。
     *
     *  与 `TerritorySite.buildingId` 同名同义（地图配置里指认「这一格最终长成哪栋建筑」），
     *  但**粒度是单个随机据点**而不是整张图 —— 一张图里的不同随机格可以指向不同建筑。
     *  键是 JSON 对象的字符串形态（`'69004'` 对应 `cellId=69004`）；未列出的候选格留空即
     *  完全交给 `rewardPoolId` 抽签。
     */
    buildingIds?: Readonly<Record<number, string>>;
}

export interface TerritoryDecoration {
    cellId: number;
    artId: string;
}

export interface TerritoryMapConfig {
    version: typeof TERRITORY_MAP_VERSION;
    mapKind: typeof TERRITORY_MAP_KIND;
    id: string;
    name: string;
    chapterId: number;
    rows: number;
    columns: number;
    startCellId: number;
    background: string;
    defaults: TerritoryUnlock;
    sites: TerritorySite[];
    randomSites?: TerritoryRandomSites;
    decorations?: TerritoryDecoration[];
}

export function territoryCellId(
    row: number,
    column: number,
    config: Pick<TerritoryMapConfig, 'rows' | 'columns'>,
): number {
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0
        || row >= config.rows || column >= config.columns) return -1;
    return row * config.columns + column;
}

export function territoryCellCoords(cellId: number, columns: number): { row: number; column: number } {
    return { row: Math.floor(cellId / columns), column: cellId % columns };
}

export function territoryNeighbors(
    cellId: number,
    config: Pick<TerritoryMapConfig, 'rows' | 'columns'>,
): number[] {
    return hexGridNeighborIds(cellId, config.rows, config.columns);
}

// ============================================================
// 归一化（configureTerritoryMap 的内部解析器）
// ============================================================

/** 地图行列数允许范围。 */
const TERRITORY_MAP_MIN_SIDE = 4;
const TERRITORY_MAP_MAX_SIDE = 60;
/** 站点未提供 unlock 时的默认报价（旧实现硬编码的 10/2/5）。 */
const TERRITORY_DEFAULT_UNLOCK: TerritoryUnlock = {
    requiredCells: [],
    combatPower: 0,
    silverCost: 10,
    exploreSeconds: 2,
    staminaCost: 5,
};

interface TerritoryMapHeader {
    readonly id: string;
    readonly chapterId: number;
    readonly rows: number;
    readonly columns: number;
    readonly total: number;
    readonly startCellId: number;
}

/** 解析站点时持续累积的上下文：站点 id / 占用格去重。 */
interface TerritoryMapContext {
    readonly total: number;
    readonly startCellId: number;
    readonly occupied: Set<number>;
    readonly ids: Set<string>;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`[TerritoryMapConfig] ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
}

function nonNegative(value: unknown, label: string): number {
    const num = asInt(value);
    assert(Number.isFinite(num) && num >= 0, `${label} must be a non-negative integer`);
    return num;
}

/**
 * 严格的整数数组：元素非整数直接 throw（带 label/index）。
 * 旧实现把非法元素映射成 NaN 再由调用方 filter 吞掉，坏配置会静默漏到运行时。
 */
function cellList(value: unknown, label: string): number[] {
    assert(Array.isArray(value), `${label} must be an array`);
    return (value as unknown[]).map((item, index) => {
        const cell = asInt(item);
        assert(Number.isFinite(cell), `${label}[${index}] must be an integer`);
        return cell;
    });
}

/** 单个格子，必须落在 [0, total)。 */
function cellInRange(value: unknown, total: number, label: string): number {
    const cell = asInt(value);
    assert(Number.isFinite(cell) && cell >= 0 && cell < total,
        `${label} must be a cell in [0, ${total})`);
    return cell;
}

/** 整数数组且每格落在 [0, total)。 */
function cellsInRange(value: unknown, total: number, label: string): number[] {
    return cellList(value, label).map((cell, index) => {
        assert(cell >= 0 && cell < total, `${label}[${index}] is out of bounds`);
        return cell;
    });
}

function parseHeader(data: Record<string, unknown>): TerritoryMapHeader {
    assert(data.version === TERRITORY_MAP_VERSION, `version must be ${TERRITORY_MAP_VERSION}`);
    assert(data.mapKind === TERRITORY_MAP_KIND, `mapKind must be ${TERRITORY_MAP_KIND}`);
    assert(
        typeof data.id === 'string' && /^[A-Za-z0-9_-]+$/.test(data.id),
        'id is invalid',
    );
    const rows = nonNegative(data.rows, 'rows');
    const columns = nonNegative(data.columns, 'columns');
    assert(
        rows >= TERRITORY_MAP_MIN_SIDE && rows <= TERRITORY_MAP_MAX_SIDE,
        `rows must be in [${TERRITORY_MAP_MIN_SIDE}, ${TERRITORY_MAP_MAX_SIDE}]`,
    );
    assert(
        columns >= TERRITORY_MAP_MIN_SIDE && columns <= TERRITORY_MAP_MAX_SIDE,
        `columns must be in [${TERRITORY_MAP_MIN_SIDE}, ${TERRITORY_MAP_MAX_SIDE}]`,
    );
    const total = rows * columns;
    const startCellId = cellInRange(data.startCellId, total, 'startCellId');
    const chapterId = nonNegative(data.chapterId, 'chapterId');
    assert(chapterId >= 1, 'chapterId is invalid');
    return { id: data.id, chapterId, rows, columns, total, startCellId };
}

/**
 * 章节默认报价。
 * ⚠️ requiredCells 恒为 []（旧实现不读 defaults.requiredCells）—— 默认报价的前置格没有意义，
 * 否则没写 unlock 的站点会被强制要求默认前置。
 */
function parseDefaults(raw: unknown): TerritoryUnlock {
    const d = isRecord(raw) ? raw : {};
    return {
        requiredCells: [],
        combatPower: nonNegative(d.combatPower ?? TERRITORY_DEFAULT_UNLOCK.combatPower,
            'defaults.combatPower'),
        silverCost: nonNegative(d.silverCost ?? TERRITORY_DEFAULT_UNLOCK.silverCost,
            'defaults.silverCost'),
        exploreSeconds: nonNegative(d.exploreSeconds ?? TERRITORY_DEFAULT_UNLOCK.exploreSeconds,
            'defaults.exploreSeconds'),
        staminaCost: nonNegative(d.staminaCost ?? TERRITORY_DEFAULT_UNLOCK.staminaCost,
            'defaults.staminaCost'),
    };
}

/** 站点级 unlock：缺省字段回落到章节 defaults，requiredCells 去重。 */
function parseSiteUnlock(
    raw: unknown,
    fallback: TerritoryUnlock,
    total: number,
    label: string,
): TerritoryUnlock {
    const unlock = isRecord(raw) ? raw : {};
    return {
        requiredCells: Array.from(new Set(cellsInRange(unlock.requiredCells ?? [], total,
            `${label}.requiredCells`))),
        combatPower: nonNegative(unlock.combatPower ?? fallback.combatPower,
            `${label}.combatPower`),
        silverCost: nonNegative(unlock.silverCost ?? fallback.silverCost,
            `${label}.silverCost`),
        exploreSeconds: nonNegative(unlock.exploreSeconds ?? fallback.exploreSeconds,
            `${label}.exploreSeconds`),
        staminaCost: nonNegative(unlock.staminaCost ?? fallback.staminaCost,
            `${label}.staminaCost`),
    };
}

function parseSite(
    raw: unknown,
    ctx: TerritoryMapContext,
    index: number,
    fallback: TerritoryUnlock,
): TerritorySite {
    assert(isRecord(raw), `sites[${index}] must be an object`);
    assert(typeof raw.id === 'string' && raw.id.length > 0, `sites[${index}].id is invalid`);
    assert(!ctx.ids.has(raw.id), `duplicate site id ${raw.id}`);
    ctx.ids.add(raw.id);
    assert(
        TERRITORY_SITE_TYPES.includes(raw.type as TerritorySiteType),
        `sites[${index}].type is invalid`,
    );
    const id = raw.id;
    const cellId = cellInRange(raw.cellId, ctx.total, `sites[${index}].cellId`);

    // footprint 缺省（非数组 / 空数组）= [cellId]。
    const rawFootprint = Array.isArray(raw.footprint)
        ? cellList(raw.footprint, `sites[${index}].footprint`)
        : [];
    const footprintCells = rawFootprint.length ? rawFootprint : [cellId];
    assert(
        footprintCells.every((cell) => cell >= 0 && cell < ctx.total),
        `sites[${index}].footprint is invalid`,
    );
    const footprint = Array.from(new Set(footprintCells));
    assert(footprint.length === footprintCells.length,
        `sites[${index}].footprint has duplicate cells`);
    assert(footprint.includes(cellId), `sites[${index}].footprint must include cellId`);
    for (const cell of footprint) {
        assert(cell !== ctx.startCellId, `site ${id} cannot occupy startCellId`);
        assert(!ctx.occupied.has(cell), `site ${id} overlaps another site`);
        ctx.occupied.add(cell);
    }

    const unlock = parseSiteUnlock(raw.unlock, fallback, ctx.total, id);
    // 前置格包含自身 footprint ⇒ checkExplore 要求它已占领 ⇒ 站点永久不可开启。
    for (const cell of unlock.requiredCells) {
        assert(!footprint.includes(cell),
            `site ${id}.requiredCells cannot include its own footprint`);
    }

    const site: TerritorySite = {
        id,
        type: raw.type as TerritorySiteType,
        cellId,
        footprint,
        unlock,
    };
    if (typeof raw.configId === 'string' && raw.configId) site.configId = raw.configId;
    if (typeof raw.buildingId === 'string' && raw.buildingId) site.buildingId = raw.buildingId;
    if (raw.rewardId !== undefined) {
        assert(site.type === TERRITORY_SITE_TYPE.fixedResource,
            `sites[${index}].rewardId is only valid for fixedResource sites`);
        const rewardId = nonNegative(raw.rewardId, `sites[${index}].rewardId`);
        assert(rewardId > 0, `sites[${index}].rewardId must be a positive integer`);
        site.rewardId = rewardId;
    }
    return site;
}

function parseRandomSites(raw: unknown, ctx: TerritoryMapContext): TerritoryRandomSites | undefined {
    if (!isRecord(raw)) return undefined;
    assert(Array.isArray(raw.candidateCells), 'randomSites.candidateCells must be an array');
    assert(
        typeof raw.rewardPoolId === 'string' && raw.rewardPoolId.length > 0,
        'randomSites.rewardPoolId is invalid',
    );
    // 过滤起点与已被站点占用格属于有意的业务归一化（非整数/越界仍 throw）。
    const candidates = cellsInRange(raw.candidateCells, ctx.total, 'randomSites.candidateCells')
        .filter((cell) => cell !== ctx.startCellId && !ctx.occupied.has(cell));
    const maxActive = nonNegative(raw.maxActive ?? 1, 'randomSites.maxActive');
    assert(maxActive >= 1, 'randomSites.maxActive must be at least 1');
    const randomSites: TerritoryRandomSites = {
        triggerSilver: nonNegative(raw.triggerSilver ?? 0, 'randomSites.triggerSilver'),
        rewardPoolId: raw.rewardPoolId,
        candidateCells: Array.from(new Set(candidates)),
        maxActive,
    };
    // 可选字段：cellId → 建筑 ID。空串按「这一格没指定」处理（编辑器表单清空后会落成""）。
    // ⚠️ 键是 JSON 对象的字符串形态，只接受十进制非负整数；`Number('')` 是 0、`Number(' 12 ')` 是 12，
    // 所以必须先用正则卡住，再判越界与「不是候选格」（否则那一格永远不出现，这条配置等于静默失效）。
    if (raw.buildingIds !== undefined) {
        assert(isRecord(raw.buildingIds), 'randomSites.buildingIds must be an object');
        const known = new Set(randomSites.candidateCells);
        const buildingIds: Record<number, string> = {};
        for (const key of Object.keys(raw.buildingIds)) {
            assert(/^\d+$/.test(key), `randomSites.buildingIds.${key} must be a cell in [0, ${ctx.total - 1}]`);
            const cell = Number(key);
            assert(cell < ctx.total, `randomSites.buildingIds.${key} must be a cell in [0, ${ctx.total - 1}]`);
            assert(known.has(cell), `randomSites.buildingIds.${key} is not a candidate cell`);
            const value = raw.buildingIds[key];
            assert(typeof value === 'string', `randomSites.buildingIds.${key} must be a string`);
            if (value.trim() !== '') buildingIds[cell] = value.trim();
        }
        if (Object.keys(buildingIds).length) randomSites.buildingIds = buildingIds;
    }
    return randomSites;
}

function parseDecorations(raw: unknown, total: number): TerritoryDecoration[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const seen = new Set<number>();
    return raw.map((item, index) => {
        assert(isRecord(item), `decorations[${index}] must be an object`);
        const cellId = cellInRange(item.cellId, total, `decorations[${index}].cellId`);
        assert(!seen.has(cellId), `decorations[${index}] repeats cell ${cellId}`);
        seen.add(cellId);
        assert(typeof item.artId === 'string' && item.artId.length > 0,
            `decorations[${index}].artId is invalid`);
        return { cellId, artId: item.artId };
    });
}

/**
 * 把编辑器导出的地图 JSON 归一化成 {@link TerritoryMapConfig}。
 *
 *  任一字段不合规直接 throw —— 地图是配置驱动的，错了就让开发者在控制台看到，
 *  不悄悄退回默认值，否则运行时会出现"格子能点但没奖励"这种静默错误。
 */
export function configureTerritoryMap(input: unknown): TerritoryMapConfig {
    assert(isRecord(input), 'map must be an object');
    const header = parseHeader(input);
    const defaults = parseDefaults(input.defaults);
    assert(Array.isArray(input.sites), 'sites must be an array');
    const ctx: TerritoryMapContext = {
        total: header.total,
        startCellId: header.startCellId,
        occupied: new Set(),
        ids: new Set(),
    };
    const sites = (input.sites as unknown[]).map((raw, index) =>
        parseSite(raw, ctx, index, defaults));
    return {
        version: TERRITORY_MAP_VERSION,
        mapKind: TERRITORY_MAP_KIND,
        id: header.id,
        name: typeof input.name === 'string' && input.name ? input.name : header.id,
        chapterId: header.chapterId,
        rows: header.rows,
        columns: header.columns,
        startCellId: header.startCellId,
        background: typeof input.background === 'string' ? input.background : '',
        defaults,
        sites,
        randomSites: parseRandomSites(input.randomSites, ctx),
        decorations: parseDecorations(input.decorations, header.total),
    };
}
