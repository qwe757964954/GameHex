import { BIGMAP_TILE_HEIGHT, BIGMAP_TILE_WIDTH, buildBigMapWorldLayout } from './BigMapWorldLayout';

export interface IBigMapPlotPosition {
    readonly hexId: number;
    readonly row: number;
    readonly column: number;
}

export interface IBigMapBaseLayout {
    readonly points: ReadonlyMap<number, { readonly x: number; readonly y: number }>;
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly scale: number;
    readonly paintOrder: readonly number[];
}

export function buildBigMapBaseLayout(
    cells: readonly IBigMapPlotPosition[], width: number, height: number,
): IBigMapBaseLayout {
    const rows = cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0);
    const columns = cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0);
    const source = buildBigMapWorldLayout(rows, columns);
    const scale = Math.max(0.01, Math.min((width - 40) / (source.width + 24), (height - 100) / (source.height + 100)));
    const points = new Map<number, { readonly x: number; readonly y: number }>();
    for (const cell of cells) {
        const point = source.points.get(cell.row * columns + cell.column);
        if (point) points.set(cell.hexId, { x: point.x * scale, y: point.y * scale });
    }
    const paintOrder = [...points.entries()].sort(([, first], [, second]) => (
        second.y - first.y || first.x - second.x
    )).map(([hexId]) => hexId);
    return { points, tileWidth: BIGMAP_TILE_WIDTH * scale, tileHeight: BIGMAP_TILE_HEIGHT * scale, scale, paintOrder };
}

export function pickBigMapBasePlot(layout: IBigMapBaseLayout, x: number, y: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    for (const [hexId, point] of layout.points) {
        const dx = Math.abs(x - point.x);
        const dy = Math.abs(y - point.y);
        if (dy <= layout.tileHeight / 2
            && dx <= layout.tileWidth / 2 - dy * layout.tileWidth / (2 * layout.tileHeight)) return hexId;
    }
    return -1;
}
