import { HEX_GRID_FACE_HEIGHT, buildHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { HexGridPoint, IHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';

/** 地图格心坐标（已相对整张图包围盒中心平移）。 */
export type ITerritoryMapPoint = HexGridPoint;

export type ITerritoryMapLayout = IHexGridLayout;

/** 沿用共享六边形布局的坐标、包围盒与画家顺序。 */
export function buildTerritoryMapLayout(map: TerritoryMapConfig): ITerritoryMapLayout {
    return buildHexGridLayout(map.rows, map.columns);
}

/** 目标格停在视口中线偏上的抬升量（px），用于避开底部快速寻敌按钮。 */
export const TERRITORY_MAP_VIEW_LIFT = 100;

/** 内容层底部留白缺省值（px）。 */
export const TERRITORY_MAP_CONTENT_PADDING = 300;

/** 地图底边与顶部 HUD 框底边的最小间隙（px）。 */
export const TERRITORY_MAP_HUD_GAP = 15;

/** 地图底边与底部挂件上沿允许的最大空当（px）。 */
export const TERRITORY_MAP_BOTTOM_GAP = 50;

/** 量不到底部挂件时的兜底咬入高度（px）。 */
export const TERRITORY_MAP_BOTTOM_INSET = 300;

/**
 * 由视口高与底部挂件咬入高度反算内容层底部留白。
 *
 * 滚到底时地图底边停在挂件上沿上方 `GAP`，即 `pad = inset + GAP`，
 * 结果夹在 `[0, 视口高]`。
 */
export function territoryMapContentPaddingBottom(
    viewportHeight: number,
    bottomInset = TERRITORY_MAP_BOTTOM_INSET,
): number {
    const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
    const inset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : TERRITORY_MAP_BOTTOM_INSET;
    const pad = inset + TERRITORY_MAP_BOTTOM_GAP;
    return height > 0 ? Math.min(height, pad) : pad;
}

/** 内容层顶部留白缺省值（px），运行时由页面注入。 */
export const TERRITORY_MAP_CONTENT_PADDING_TOP = 0;

/** 第一排地块可见顶边高出格心的距离，即半个格面高。 */
export const TERRITORY_MAP_TOP_FACE_RISE = HEX_GRID_FACE_HEIGHT / 2;

/** 第一排完整露出后仍可继续下拉的手感余量（px）。 */
export const TERRITORY_MAP_TOP_BREATH = 60;

/**
 * 由顶部 HUD 底边反算内容层顶部留白。
 *
 * `padTop = hudBottom + GAP + FACE_RISE + BREATH`，非有限值按 0 处理。
 */
export function territoryMapContentPaddingTop(hudBottom: number): number {
    const bottom = Number.isFinite(hudBottom) ? Math.max(0, hudBottom) : 0;
    return bottom + TERRITORY_MAP_HUD_GAP + TERRITORY_MAP_TOP_FACE_RISE + TERRITORY_MAP_TOP_BREATH;
}

/**
 * 地图内容层相对内容层中心的 y 偏移。
 *
 * 底部比顶部多出多少，地图中心就要高出一半，保证地图顶边贴住内容层顶边。
 */
export function territoryMapContentShiftY(
    paddingBottom = TERRITORY_MAP_CONTENT_PADDING,
    paddingTop = TERRITORY_MAP_CONTENT_PADDING_TOP,
): number {
    const bottom = Number.isFinite(paddingBottom) ? Math.max(0, paddingBottom) : TERRITORY_MAP_CONTENT_PADDING;
    const top = Number.isFinite(paddingTop) ? Math.max(0, paddingTop) : TERRITORY_MAP_CONTENT_PADDING_TOP;
    return (bottom - top) / 2;
}

/** ScrollView 内容层尺寸 = 地图包围盒 + 顶部与底部留白。 */
export function territoryMapContentSize(
    layout: ITerritoryMapLayout,
    paddingBottom = TERRITORY_MAP_CONTENT_PADDING,
    paddingTop = TERRITORY_MAP_CONTENT_PADDING_TOP,
): { readonly width: number; readonly height: number } {
    const bottom = Number.isFinite(paddingBottom) ? Math.max(0, paddingBottom) : TERRITORY_MAP_CONTENT_PADDING;
    const top = Number.isFinite(paddingTop) ? Math.max(0, paddingTop) : TERRITORY_MAP_CONTENT_PADDING_TOP;
    return {
        width: layout.width,
        height: layout.height > 0 ? layout.height + bottom + top : 0,
    };
}

/** 将地图格心换算为 ScrollView 从左上角计量的滚动偏移。 */
export function territoryMapOffsetForCell(
    layout: ITerritoryMapLayout,
    cellId: number,
    viewport: Readonly<{ width: number; height: number }>,
    options?: Readonly<{ lift?: number; paddingBottom?: number; paddingTop?: number }>,
): ITerritoryMapPoint {
    const point = layout.points.get(cellId);
    if (!point) return { x: 0, y: 0 };

    const lift = options?.lift ?? TERRITORY_MAP_VIEW_LIFT;
    const paddingBottom = options?.paddingBottom ?? TERRITORY_MAP_CONTENT_PADDING;
    const paddingTop = options?.paddingTop ?? TERRITORY_MAP_CONTENT_PADDING_TOP;
    const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
    const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
    const content = territoryMapContentSize(layout, paddingBottom, paddingTop);
    const maxX = Math.max(0, layout.width - width);
    const maxY = Math.max(0, content.height - height);
    const shift = territoryMapContentShiftY(paddingBottom, paddingTop);
    return {
        x: Math.min(maxX, Math.max(0, point.x + layout.width / 2 - width / 2)),
        y: Math.min(maxY, Math.max(0, content.height / 2 - shift - height / 2 - point.y + lift)),
    };
}
