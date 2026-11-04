import {
    buildHexGridLayout, HEX_GRID_FACE_HEIGHT, HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT, HEX_GRID_IMAGE_WIDTH, type IHexGridLayout,
} from '../../../core/hex/HexGridLayout';
import { bigMapHash } from '../model/BigMapWorld';

/**
 * 大地图地块的格宽 / 格高。
 *
 * 2026-11-02 山猫口径：*「按当前的宽度，地块没跟上」* —— 建筑图标放大到设计稿原尺寸
 * （城池 235 / 基地 148 / 野怪 121）之后，147×96 的格子显得过小，建筑像浮在小格子上。
 * 这里把格子按**城池宽度对齐**：一格 = 235 宽，高按平顶六边形 147:96 的比例取 154。
 *
 * 世界地形使用连续背景与透明格，旧的六张沙地切图已停用。
 * 战斗 / 冒险场景走 `HexGridLayout` 的 130×119，**不受这里影响**。
 */
export const BIGMAP_TILE_WIDTH = 235;
/**
 * 高度**由宽度按原稿 147:96 反算**，不取整 —— 平顶六边形共边的前提就是宽高比固定，
 * 取整（153 或 154）会让相邻格出现 1~2px 的缝或重叠。
 */
export const BIGMAP_TILE_HEIGHT = BIGMAP_TILE_WIDTH * 96 / 147;
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
    readonly badgeWidth?: number;
}

export const BIGMAP_MARKER_ICON_LIFT = 24;
/** 建筑脚底到格子中心的下沉量：`iconY = height/2 - 16` ⇒ 建筑底边恒在 `-16`。 */
export const BIGMAP_MARKER_FOOT_LIFT = 16;
/**
 * 名条命中框的兜底尺寸（设计稿「大地图3」里最大的那张：202×56）。
 *
 * 真正的尺寸**按贴图来**（`bigMapMarkerLayout` 的入参）：名条有四张，
 * 野怪/关卡 202×56、玩家占领 193×54，写死一档会让小那张左右各多出 4.5px 的误点区。
 */
export const BIGMAP_MARKER_BADGE_WIDTH = 202;
export const BIGMAP_MARKER_BADGE_HEIGHT = 56;
/**
 * 名条落点：**压在建筑下方**，顶边与建筑底边（`-16`）齐平 —— 设计稿里三者
 * （野怪 `title_01` / 关卡 `title_02` / 玩家 `title_03/04`）都是紧贴建筑底边，重叠 0~5px。
 *
 * ⚠️ 2026-11-02 前这里是**建筑上方**的编号牌（`mapMarkerBadgeY(height - 16)`）；
 * 蓝湖稿把名条挪到了建筑下方，这个方向变化同时影响 `pickBigMapMarker` 与视口裁剪。
 */
export const BIGMAP_MARKER_BADGE_Y = -(BIGMAP_MARKER_FOOT_LIFT + BIGMAP_MARKER_BADGE_HEIGHT / 2);

/**
 * 建筑图标的宽度（蓝湖「大地图3」原稿**实测**，高度按贴图比例自动算）。
 *
 * 原稿：城池（马戏团）235×232、基地/据点（树桩）148×160、野怪（骨门）121×129。
 * 图标底部固定在格中心下方 `BIGMAP_MARKER_FOOT_LIFT` 处，所以放大是**向上长**，
 * 名条不会被推走（`badgeY` 只吃 `FOOT_LIFT` 和自身高度）。
 *
 * ⚠️ 这三个数值比格子（147×96）大不少，是**设计稿的意图**：城池要盖住上方一格。
 * 点选热区会随之变大（`pickBigMapMarker` 用 `height/2` 判），相邻标记边缘可能互相覆盖。
 */
export const BIGMAP_MARKER_CITY_WIDTH = 235;
export const BIGMAP_MARKER_BASE_WIDTH = 148;
export const BIGMAP_MARKER_MONSTER_WIDTH = 121;

/** 脚底固定在台面，名条压在建筑下方，显示与点击共用坐标。 */
export function bigMapMarkerLayout(
    width: number,
    height: number,
    badgeWidth = BIGMAP_MARKER_BADGE_WIDTH,
    badgeHeight = BIGMAP_MARKER_BADGE_HEIGHT,
): Omit<IBigMapMarkerHitArea, 'hexId'> {
    return {
        width,
        height,
        iconY: height / 2 - BIGMAP_MARKER_FOOT_LIFT,
        badgeY: -(BIGMAP_MARKER_FOOT_LIFT + badgeHeight / 2),
        badgeHeight,
        badgeWidth,
    };
}

export function pickBigMapMarker(layout: IHexGridLayout, markers: readonly IBigMapMarkerHitArea[], x: number, y: number): number {
    for (let index = markers.length - 1; index >= 0; index -= 1) {
        const marker = markers[index];
        const point = layout.points.get(marker.hexId);
        if (!point) continue;
        const dx = Math.abs(x - point.x);
        const dy = y - point.y;
        if (dx <= (marker.badgeWidth ?? BIGMAP_MARKER_BADGE_WIDTH) / 2
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
