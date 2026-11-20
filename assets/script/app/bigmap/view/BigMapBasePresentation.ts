import {
    buildHexGridLayout, HEX_GRID_CONTENT_LIFT, HEX_GRID_FACE_HEIGHT, HEX_GRID_FACE_WIDTH,
} from '../../../core/hex/HexGridLayout';

/** 基地地皮切片的整图尺寸：`image/buildings/img_land_01/02` 均为 126×117。 */
export const BIGMAP_BASE_TILE_IMAGE_WIDTH = 126;
export const BIGMAP_BASE_TILE_IMAGE_HEIGHT = 117;
/** 片内可见台面（六边形）尺寸；格距 / 拾取 / 选中描边都按台面，而不是整图外框。 */
export const BIGMAP_BASE_FACE_WIDTH = HEX_GRID_FACE_WIDTH;
export const BIGMAP_BASE_FACE_HEIGHT = HEX_GRID_FACE_HEIGHT;
/** 台面中心比整图中心高出的距离；贴图节点要反向下沉，台面才落在格心上。 */
export const BIGMAP_BASE_CONTENT_LIFT = HEX_GRID_CONTENT_LIFT;
/**
 *基地场景的最小画布：设计稿地皮按 126×117 原生尺寸 1:1 展示。
 *1280 覆盖 720×1610 的 1282 高浏览区，相机的 `minZoom` 不会被强行压到 0.89。
 */
export const BIGMAP_BASE_MAP_SIZE = 1280;

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

/**
 *基地格心：直接复用领地/对局的 123×90 台面口径。
 *
 *2026-11-19 蓝湖「大地图(1)」把基地从旧的 235 大格改回原生切片：
 * `img_land_01` 126×117 整图里台面 123×90，列距 92.25、行距 90、相邻列差 45。
 * 贴图节点另下沉 {@link BIGMAP_BASE_CONTENT_LIFT}，建筑/拾取/描边全部用台面格心。
 */
export function buildBigMapBaseLayout(
    cells: readonly IBigMapPlotPosition[],
): IBigMapBaseLayout {
    const rows = cells.reduce((max, cell) => Math.max(max, cell.row + 1), 0);
    const columns = cells.reduce((max, cell) => Math.max(max, cell.column + 1), 0);
    const source = buildHexGridLayout(rows, columns);
    const points = new Map<number, { readonly x: number; readonly y: number }>();
    for (const cell of cells) {
        const point = source.points.get(cell.row * columns + cell.column);
        if (point) points.set(cell.hexId, { x: point.x, y: point.y });
    }
    const paintOrder = Array.from(points.entries()).sort(([, first], [, second]) => (
        second.y - first.y || first.x - second.x
    )).map(([hexId]) => hexId);
    //原图四周是装饰区；5×5 设计稿按 126 原图 1:1，大网格按 45% 竖屏留白继续放大画布。
    const mapSize = Math.max(BIGMAP_BASE_MAP_SIZE, source.width / 0.54, source.height / 0.45);
    return {
        points, tileWidth: BIGMAP_BASE_FACE_WIDTH, tileHeight: BIGMAP_BASE_FACE_HEIGHT,
        scale: 1, paintOrder, mapSize,
    };
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

/**
 *最近格吸附：给摆放用，不需要像素级精度。
 *
 *`pickBigMapBasePlot` 是精确命中六边形，六边形之间天然有空隙 —— 点偏一点就返回 -1，
 *玩家「明明点了那个格子」却什么都没发生（2026-11-11 反馈：找不到放置位置）。
 *摆放是「选落点」，吸到最近格更符合直觉。
 *
 *`tolerance` 之外返回 -1（点在整张基地图外，不该当作"放在这里"）。
 */
export function bigMapNearestPlot(layout: IBigMapBaseLayout, x: number, y: number, tolerance: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(tolerance > 0)) return -1;
    let best = -1;
    let bestDistance = tolerance;
    for (const [hexId, point] of layout.points) {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = hexId;
        }
    }
    return best;
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
