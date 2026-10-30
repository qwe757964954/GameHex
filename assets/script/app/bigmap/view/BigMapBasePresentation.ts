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
    readonly mapSize: number;
}

export function buildBigMapBaseLayout(
    cells: readonly IBigMapPlotPosition[],
): IBigMapBaseLayout {
    const rows = cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0);
    const columns = cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0);
    const source = buildBigMapWorldLayout(rows, columns);
    const scale = 1;
    const points = new Map<number, { readonly x: number; readonly y: number }>();
    for (const cell of cells) {
        const point = source.points.get(cell.row * columns + cell.column);
        if (point) points.set(cell.hexId, { x: point.x * scale, y: point.y * scale });
    }
    const paintOrder = [...points.entries()].sort(([, first], [, second]) => (
        second.y - first.y || first.x - second.x
    )).map(([hexId]) => hexId);
    // 原图四周是装饰区；格面与建筑顶部均留在中央54%范围内。
    const mapSize = Math.max(1600, source.width / 0.54, (source.height + 280) / 0.54);
    return { points, tileWidth: BIGMAP_TILE_WIDTH, tileHeight: BIGMAP_TILE_HEIGHT, scale, paintOrder, mapSize };
}

export interface IBigMapBaseCamera {
    readonly zoom: number;
    readonly x: number;
    readonly y: number;
}

export function clampBigMapBaseCamera(
    layout: IBigMapBaseLayout, width: number, height: number, camera: IBigMapBaseCamera,
): IBigMapBaseCamera {
    const minZoom = Math.max(width, height) / layout.mapSize;
    const zoom = Math.max(minZoom, Math.min(Math.max(1.5, minZoom), camera.zoom));
    const limitX = Math.max(0, (layout.mapSize * zoom - width) / 2);
    const limitY = Math.max(0, (layout.mapSize * zoom - height) / 2);
    return { zoom, x: Math.max(-limitX, Math.min(limitX, camera.x)), y: Math.max(-limitY, Math.min(limitY, camera.y)) };
}

export function zoomBigMapBaseCamera(
    layout: IBigMapBaseLayout, width: number, height: number, camera: IBigMapBaseCamera,
    factor: number, anchor: { readonly x: number; readonly y: number },
): IBigMapBaseCamera {
    const { zoom } = clampBigMapBaseCamera(layout, width, height, { ...camera, zoom: camera.zoom * factor });
    const ratio = zoom / camera.zoom;
    return clampBigMapBaseCamera(layout, width, height, {
        zoom, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio,
    });
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
