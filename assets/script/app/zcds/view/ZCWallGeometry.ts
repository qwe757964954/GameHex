import { ZC_HEX_CONFIG, type ZCFaction, type ZCHexConfig } from '../model/ZCGameModel';
import { mapToViewX, mapToViewY } from './ZCGameViewUtil';
import { ZC_OUTLINE_HEX_POINTS } from './ZCOutlineLayer';

/** 完整墙显示六边；新击破的墙只隐藏命中的一边；旧版整墙已毁状态保持全隐藏。 */
export function shouldRenderWallEdge(
    wall: Readonly<{ wallHp: number; wallBreachedEdge?: number | null }>,
    edge: number,
): boolean {
    if (wall.wallHp > 0) return true;
    return Number.isInteger(wall.wallBreachedEdge) && wall.wallBreachedEdge !== edge;
}

/**
 * Wall tile mapping for each hex edge. The 123×90 face has 61.5px horizontal and 54.5px
 * diagonal edges. Scale by opaque sprite-body length and extend each end by 6px; equal-length
 * edges must use equal scales. Offsets align the tile's top-face seam to the edge. Left edges
 * mirror their right-side pair; both horizontal edges use `up`. `renderWallSystem` sorts by screen y.
 */
export interface ZCWallTileSpec {
    art: string;
    flip: boolean;
    angle: number;
    scale: number;
    /** 墙砖图片自身从一端指向另一端的局部轴；斜墙的主体方向烘焙在图片里，不是局部 x。 */
    axisX: number;
    axisY: number;
    /** 图中心相对边中点的墙层偏移（让砖顶面中线对齐六边形边），单位像素。 */
    offsetX: number;
    offsetY: number;
    /** leftWidth, rightWidth, leftSampleInset, rightSampleInset（墙砖轴向 0..1）。 */
    joinProfile: readonly [number, number, number, number];
}

export interface ZCWallSegmentGeometry {
    adjacentId: number | null;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    x: number;
    y: number;
    angle: number;
    length: number;
}

export const WALL_TILE_EDGES: ReadonlyArray<ZCWallTileSpec> = [
    // edge 0 右上斜边（54.5px）：rightUp 砖身 66.6px，两端伸出 6px。
    { art: 'rightUp', flip: false, angle: -4.4, scale: 0.491, axisX: 1, axisY: -1, offsetX: -3.09, offsetY: -2.01, joinProfile: [0.14, 0.30, 0.18, 0.34] },
    // edge 1 上水平边（61.5px）：up 砖身 73.5px，两端伸出 6px。
    { art: 'up', flip: false, angle: 0, scale: 0.529, axisX: 1, axisY: 0, offsetX: 0, offsetY: -5.82, joinProfile: [0.08, 0.08, 0.12, 0.12] },
    // edge 2 左上斜边（54.5px）：rightUp 镜像，同 edge 0。
    { art: 'rightUp', flip: true, angle: 4.4, scale: 0.491, axisX: 1, axisY: -1, offsetX: 3.09, offsetY: -2.01, joinProfile: [0.14, 0.30, 0.18, 0.34] },
    // edge 3 左下斜边（54.5px）：rightDown 镜像，砖身 66.5px，两端伸出 6px。
    { art: 'rightDown', flip: true, angle: -4.2, scale: 0.491, axisX: 1, axisY: 1, offsetX: -2.67, offsetY: -1.75, joinProfile: [0.30, 0.14, 0.34, 0.18] },
    // edge 4 下水平边（61.5px）：直接用和 edge 1 完全相同的 up 图配置（不旋转、不错缝），
    // 保证底部、顶部视觉上是一模一样的一根。
    { art: 'up', flip: false, angle: 0, scale: 0.529, axisX: 1, axisY: 0, offsetX: 0, offsetY: -5.82, joinProfile: [0.08, 0.08, 0.12, 0.12] },
    // edge 5 右下斜边（54.5px）：rightDown，同 edge 3。
    { art: 'rightDown', flip: false, angle: 4.2, scale: 0.491, axisX: 1, axisY: 1, offsetX: 2.67, offsetY: -1.75, joinProfile: [0.30, 0.14, 0.34, 0.18] },
];

/**
 * Sprite 顶点色 alpha 给 wall-tile.effect 传 2-bit 连接标记：bit0=局部左端、bit1=局部右端。
 * 四个状态正好落在 0/85/170/255，shader 用 `round(alpha * 3)` 无损还原。
 * blue 同样用四档编码墙砖帧槽位；阵营染色保留在 red/green，shader 用 green 还原 blue。
 */
const WALL_ENDPOINT_KEY_SCALE = 100;

/** Minimum cosine for matching an edge to a neighbor; false matches reach 0.737, valid matches >= 0.951. */
const WALL_EDGE_NEIGHBOR_MIN_ALIGNMENT = 0.85;

export function wallEndpointOwnerKey(owner: ZCFaction, x: number, y: number): string {
    // 同一个六边形顶点会由不同边的三角函数路径算出，量化可消除 1e-14 级浮点尾差。
    return `${owner}:${Math.round(x * WALL_ENDPOINT_KEY_SCALE)}:${Math.round(y * WALL_ENDPOINT_KEY_SCALE)}`;
}

/**
 * 把图集 UV 还原成墙砖轴向坐标（第一端 0、第二端 1）的仿射变换。
 *
 * Cocos simple assembler 的四角顺序固定为 left-bottom / right-bottom /
 * left-top / right-top；先逆解局部 x/y，再投影到墙砖自身轴向。不能从
 * `a_position` 推局部坐标：UI 批处理会在进 shader 前把它写成世界坐标。
 */
export function wallAxisTransform(
    frame: Readonly<{ uv: readonly number[] }>,
    axisX: number,
    axisY: number,
): readonly [number, number, number, number] | null {
    if (frame.uv.length < 6) return null;
    const originU = frame.uv[0];
    const originV = frame.uv[1];
    const xU = frame.uv[2] - originU;
    const xV = frame.uv[3] - originV;
    const yU = frame.uv[4] - originU;
    const yV = frame.uv[5] - originV;
    const determinant = xU * yV - xV * yU;
    const axisRange = Math.abs(axisX) + Math.abs(axisY);
    if (Math.abs(determinant) <= Number.EPSILON || axisRange <= Number.EPSILON) return null;

    const localXU = yV / determinant;
    const localXV = -yU / determinant;
    const localXC = -(localXU * originU + localXV * originV);
    const localYU = -xV / determinant;
    const localYV = xU / determinant;
    const localYC = -(localYU * originU + localYV * originV);
    const axisMin = Math.min(0, axisX) + Math.min(0, axisY);
    return [
        (axisX * localXU + axisY * localYU) / axisRange,
        (axisX * localXV + axisY * localYV) / axisRange,
        (axisX * localXC + axisY * localYC - axisMin) / axisRange,
        0,
    ];
}

/**
 * 城墙每格六条边的几何计算器（纯计算，不碰节点 / 材质 / 对象池）。
 *
 * 结果按 hexId 缓存：几何只取决于地图声明（邻居、坐标），同一局内不变，
 * 每帧重绘墙砖时复用。`setMap`（换局）或 `clear`（销毁）时清空缓存。
 */
export class ZCWallGeometry {
    private map: readonly ZCHexConfig[] = ZC_HEX_CONFIG;
    private readonly cache = new Map<number, ReadonlyArray<ZCWallSegmentGeometry>>();

    /** 换局换地图时更新底图并清空缓存（不同地图的邻居/坐标不同）。 */
    setMap(map: readonly ZCHexConfig[]): void {
        this.map = map;
        this.cache.clear();
    }

    clear(): void {
        this.cache.clear();
    }

    /**
     * 计算某格六条边的几何（端点、中点、角度、长度、朝外的邻格 id）。
     *
     *  这是 flat-top 六边形，顶点在左右（angle 0/π）。
     * 顶点取 `ZC_OUTLINE_HEX_POINTS`（与轮廓层**同一份**几何），而不是在这里
     * 另写一套 `R·cos/R·sin` 圆参数化 —— 正六边形下两者等价，但写死的那份
     * 不会跟着地块尺寸变，墙砖就会画到格子外面（零报错）。
     * 法线取该边中点的方向（角平分），与逐边描线同一套。
     */
    edges(hexId: number): ReadonlyArray<ZCWallSegmentGeometry> {
        const cached = this.cache.get(hexId);
        if (cached) return cached;
        const config = this.map[hexId];
        // bit 号序（右边、右上、左上、左、左下、右下）与 appendEdges 一致：
        // 每条边的两端 = 顶点[edge] → 顶点[edge+1]。
        const edges = Array.from({ length: 6 }, (_, edge) => {
            const from = ZC_OUTLINE_HEX_POINTS[edge];
            const to = ZC_OUTLINE_HEX_POINTS[(edge + 1) % ZC_OUTLINE_HEX_POINTS.length];
            // 邻居判定用的法线取该边中点的方向（角平分），与逐边描线同一套。
            const midX = (from[0] + to[0]) / 2, midY = (from[1] + to[1]) / 2;
            const normal = Math.atan2(midY, midX);
            let adjacentId: number | null = null;
            let best = -Infinity;
            for (const id of config.neighbors) {
                const neighbor = this.map[id];
                const dx = neighbor.x - config.x;
                const dy = neighbor.y - config.y;
                const alignment = (dx * Math.cos(normal) + dy * Math.sin(normal)) / Math.max(1, Math.hypot(dx, dy));
                if (alignment > best) { best = alignment; adjacentId = id; }
            }
            const x1 = from[0], y1 = from[1];
            const x2 = to[0], y2 = to[1];
            return {
                adjacentId: best > WALL_EDGE_NEIGHBOR_MIN_ALIGNMENT ? adjacentId : null,
                startX: mapToViewX(config.x) + x1,
                startY: mapToViewY(config.y) + y1,
                endX: mapToViewX(config.x) + x2,
                endY: mapToViewY(config.y) + y2,
                x: mapToViewX(config.x) + (x1 + x2) / 2,
                y: mapToViewY(config.y) + (y1 + y2) / 2,
                angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI,
                length: Math.hypot(x2 - x1, y2 - y1),
            };
        });
        this.cache.set(hexId, edges);
        return edges;
    }
}
