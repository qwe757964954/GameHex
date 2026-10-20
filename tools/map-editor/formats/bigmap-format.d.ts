/**
 * `bigmap-format.js` 的类型声明。
 *
 * 工程 tsconfig 没开 `allowJs`（`temp/tsconfig.cocos.json`），所以 TS 侧 import 这个 .js
 * 必须有同名 .d.ts，否则 `tests/bigmap-format.test.ts` 会给基线加一条 TS2307。
 *
 * 结构刻意与 `assets/script/app/bigmap/model/BigMapLayout.ts` 的 `IBigMapLayout` 保持同形 ——
 * 对拍测试要能整体 deepEqual。
 */

export const BIGMAP_LAYOUT_KIND: 'bigmapWorld';
export const BIGMAP_LAYOUT_VERSION: number;
export const BIGMAP_TERRAINS: readonly string[];
export const BIGMAP_POINT_TYPES: readonly number[];

export class BigmapValidationError extends Error {
    readonly issues: string[];
    readonly statusCode: number;
    constructor(issues: string[] | string);
}

export interface IEditorLayoutTerrainOverride {
    readonly hexId: number;
    readonly terrain: string;
}

export interface IEditorLayoutCity {
    readonly cityId: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
    readonly ring: number;
    readonly rangeHex: readonly number[];
    readonly adjacentCityIds: readonly number[];
    readonly label: string;
}

export interface IEditorLayoutMonster {
    readonly instanceId: number;
    readonly monsterId: number;
    readonly level: number;
    readonly anchorHexId: number;
    readonly hexIds: readonly number[];
}

export interface IEditorLayoutBase {
    readonly baseId: string;
    readonly name: string;
    readonly isPlayer: boolean;
    readonly hexId: number;
    readonly ring: number;
    readonly power: number;
}

export interface IEditorSpawnZone {
    readonly zoneId: number;
    readonly cityId: number;
    readonly cells: readonly number[];
    readonly capacity: number;
}

export interface IEditorLayoutPoint {
    readonly pointId: number;
    readonly pointType: number;
    readonly hexIds: readonly number[];
    readonly openCron: string;
}

export interface IEditorLayout {
    readonly kind: string;
    readonly version: number;
    readonly layoutVersion: number;
    readonly worldId: number;
    readonly worldName: string;
    readonly rows: number;
    readonly columns: number;
    readonly terrainSeed: number;
    readonly terrainOverrides: readonly IEditorLayoutTerrainOverride[];
    readonly cities: readonly IEditorLayoutCity[];
    readonly monsters: readonly IEditorLayoutMonster[];
    readonly bases: readonly IEditorLayoutBase[];
    readonly blocked: readonly number[];
    readonly spawnZones: readonly IEditorSpawnZone[];
    readonly points: readonly IEditorLayoutPoint[];
    readonly background: string;
}

export function cellCoords(hexId: number, columns: number): { row: number; column: number };
export function hexIdAt(row: number, column: number, rows: number, columns: number): number;
export function hexNeighbors(hexId: number, rows: number, columns: number): number[];
export function circleHexes(anchorHexId: number, radius: number, rows: number, columns: number): number[];
export function hexDistance(a: number, b: number, rows: number, columns: number): number;
export function poissonSpawnPoints(
    cells: readonly number[],
    minDistance: number,
    rows: number,
    columns: number,
    blocked?: readonly number[],
): number[];
export function deriveAdjacentCities(
    cities: readonly IEditorLayoutCity[],
    rows: number,
    columns: number,
): Map<number, number[]>;
export function normalizeBigmapLayout(data: unknown): { layout: IEditorLayout; warnings: string[] };
export function emptyBigmapLayout(options: {
    rows: number;
    columns: number;
    worldId?: number;
    worldName?: string;
    terrainSeed?: number;
}): IEditorLayout;
