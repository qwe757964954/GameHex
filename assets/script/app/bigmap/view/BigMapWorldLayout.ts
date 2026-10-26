import {
    buildHexGridLayout, HEX_GRID_FACE_HEIGHT, HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT, HEX_GRID_IMAGE_WIDTH, type IHexGridLayout,
} from '../../../core/hex/HexGridLayout';
import { bigMapHash } from '../model/BigMapWorld';

/** 大地图原稿为平面 147×96，不改战斗/冒险共用的 130×119 地块几何。 */
export const BIGMAP_TILE_WIDTH = 147;
export const BIGMAP_TILE_HEIGHT = 96;
export const BIGMAP_COLUMN_STEP = BIGMAP_TILE_WIDTH * 0.75;
export const BIGMAP_ROW_STEP = BIGMAP_TILE_HEIGHT;

export interface IBigMapTerritoryEdge {
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
}

export function buildBigMapTerritoryEdges(layout: IHexGridLayout, hexIds: readonly number[]): readonly IBigMapTerritoryEdge[] {
    const edges = new Map<string, IBigMapTerritoryEdge>();
    const halfWidth = BIGMAP_TILE_WIDTH / 2;
    const halfHeight = BIGMAP_TILE_HEIGHT / 2;
    for (const hexId of new Set(hexIds)) {
        const center = layout.points.get(hexId);
        if (!center) continue;
        const vertices = [
            { x: center.x + halfWidth, y: center.y },
            { x: center.x + halfWidth / 2, y: center.y + halfHeight },
            { x: center.x - halfWidth / 2, y: center.y + halfHeight },
            { x: center.x - halfWidth, y: center.y },
            { x: center.x - halfWidth / 2, y: center.y - halfHeight },
            { x: center.x + halfWidth / 2, y: center.y - halfHeight },
        ];
        for (let index = 0; index < vertices.length; index += 1) {
            const first = vertices[index];
            const second = vertices[(index + 1) % vertices.length];
            const start = first.x < second.x || (first.x === second.x && first.y < second.y) ? first : second;
            const end = start === first ? second : first;
            const key = `${Math.round(start.x * 1000)},${Math.round(start.y * 1000)}:${Math.round(end.x * 1000)},${Math.round(end.y * 1000)}`;
            if (edges.has(key)) edges.delete(key);
            else edges.set(key, { start, end });
        }
    }
    return [...edges.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([, edge]) => edge);
}

export function buildBigMapWorldLayout(rows: number, columns: number): IHexGridLayout {
    const base = buildHexGridLayout(rows, columns);
    if (base.points.size === 0) return base;
    const scaleX = BIGMAP_TILE_WIDTH / HEX_GRID_FACE_WIDTH;
    const scaleY = BIGMAP_TILE_HEIGHT / HEX_GRID_FACE_HEIGHT;
    const points = new Map<number, { readonly x: number; readonly y: number }>();
    for (const [id, point] of base.points) points.set(id, { x: point.x * scaleX, y: point.y * scaleY });
    return {
        points,
        width: (base.width - HEX_GRID_IMAGE_WIDTH) * scaleX + BIGMAP_TILE_WIDTH,
        height: (base.height - HEX_GRID_IMAGE_HEIGHT) * scaleY + BIGMAP_TILE_HEIGHT,
        paintOrder: base.paintOrder,
    };
}

export function bigMapGroundIndex(seed: number, hexId: number, count: number): number {
    return count > 0 ? bigMapHash(seed, hexId) % count : -1;
}

export interface IBigMapVisibleBounds {
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
}

export interface IBigMapMarkerHitArea {
    readonly hexId: number;
    readonly width: number;
    readonly height: number;
    readonly iconY?: number;
    readonly badgeY?: number;
    readonly badgeHeight?: number;
}

export const BIGMAP_MARKER_ICON_LIFT = 24;
export const BIGMAP_MARKER_BADGE_Y = 70;
export const BIGMAP_MARKER_BADGE_WIDTH = 88;
export const BIGMAP_MARKER_BADGE_HEIGHT = 30;

/** 脚底固定在台面，编号牌随可见建筑高度上移，显示与点击共用坐标。 */
export function bigMapMarkerLayout(width: number, height: number): Omit<IBigMapMarkerHitArea, 'hexId'> {
    return { width, height, iconY: height / 2 - 16, badgeY: height - 16 + 18 };
}

export function pickBigMapMarker(layout: IHexGridLayout, markers: readonly IBigMapMarkerHitArea[], x: number, y: number): number {
    for (let index = markers.length - 1; index >= 0; index -= 1) {
        const marker = markers[index];
        const point = layout.points.get(marker.hexId);
        if (!point) continue;
        const dx = Math.abs(x - point.x);
        const dy = y - point.y;
        if (dx <= BIGMAP_MARKER_BADGE_WIDTH / 2
            && Math.abs(dy - (marker.badgeY ?? BIGMAP_MARKER_BADGE_Y)) <= (marker.badgeHeight ?? BIGMAP_MARKER_BADGE_HEIGHT) / 2) return marker.hexId;
        if (marker.width > 0 && marker.height > 0 && dx <= marker.width / 2
            && Math.abs(dy - (marker.iconY ?? BIGMAP_MARKER_ICON_LIFT)) <= marker.height / 2) return marker.hexId;
    }
    return -1;
}

export function pickBigMapHex(layout: IHexGridLayout, rows: number, columns: number, x: number, y: number): number {
    const first = layout.points.get(0);
    if (!first || !Number.isFinite(x) || !Number.isFinite(y)) return -1;
    const candidate = Math.round((x - first.x) / BIGMAP_COLUMN_STEP);
    for (let column = Math.max(0, candidate - 1); column <= Math.min(columns - 1, candidate + 1); column += 1) {
        const top = layout.points.get(column);
        if (!top) continue;
        const row = Math.round((top.y - y) / BIGMAP_ROW_STEP);
        if (row < 0 || row >= rows) continue;
        const point = layout.points.get(row * columns + column);
        if (!point) continue;
        const dx = Math.abs(x - point.x);
        const dy = Math.abs(y - point.y);
        if (dy <= BIGMAP_TILE_HEIGHT / 2 && dx <= BIGMAP_TILE_WIDTH / 2
            - dy * BIGMAP_TILE_WIDTH / (2 * BIGMAP_TILE_HEIGHT)) return row * columns + column;
    }
    return -1;
}

export function visibleBigMapHexes(layout: IHexGridLayout, rows: number, columns: number, bounds: IBigMapVisibleBounds): number[] {
    const first = layout.points.get(0);
    if (!first) return [];
    const start = Math.max(0, Math.ceil((bounds.left - BIGMAP_TILE_WIDTH / 2 - first.x) / BIGMAP_COLUMN_STEP));
    const end = Math.min(columns - 1, Math.floor((bounds.right + BIGMAP_TILE_WIDTH / 2 - first.x) / BIGMAP_COLUMN_STEP));
    const visible: number[] = [];
    for (let column = start; column <= end; column += 1) {
        const top = layout.points.get(column);
        if (!top) continue;
        const rowStart = Math.max(0, Math.ceil((top.y - bounds.top - BIGMAP_TILE_HEIGHT / 2) / BIGMAP_ROW_STEP));
        const rowEnd = Math.min(rows - 1, Math.floor((top.y - bounds.bottom + BIGMAP_TILE_HEIGHT / 2) / BIGMAP_ROW_STEP));
        for (let row = rowStart; row <= rowEnd; row += 1) visible.push(row * columns + column);
    }
    // 下方地块的侧壁最后绘制，与公共六边形布局的绘制顺序一致。
    return visible.sort((a, b) => {
        const pa = layout.points.get(a);
        const pb = layout.points.get(b);
        return pa && pb ? pb.y - pa.y || pa.x - pb.x : 0;
    });
}
