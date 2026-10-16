import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
} from '../../../core/hex/HexGridLayout';

/**
 * 地块**格面（可见六边形台面）**的六个顶点（以格心为原点，UI 坐标）。
 *
 * 墙砖逐段贴在这六条边上，城墙渲染层（ZCOutlineLayer / ZCGameRenderWorld）与
 * 伤害模型（破门边判定）必须共用同一份口径；否则格面相对标准正六边形有
 * CONTENT_LIFT 上移与非对称压缩，会让"破门边"和单位实际贴着的砖错位一根。
 */
const HEX_TOP_HALF_WIDTH = HEX_GRID_FACE_WIDTH / 2;
const HEX_TOP_HALF_HEIGHT = HEX_GRID_FACE_HEIGHT / 2;

export const ZC_HEX_TOP_VERTICES: ReadonlyArray<readonly [number, number]> = [
    [HEX_TOP_HALF_WIDTH, HEX_GRID_CONTENT_LIFT],
    [HEX_TOP_HALF_WIDTH / 2, HEX_GRID_CONTENT_LIFT + HEX_TOP_HALF_HEIGHT],
    [-HEX_TOP_HALF_WIDTH / 2, HEX_GRID_CONTENT_LIFT + HEX_TOP_HALF_HEIGHT],
    [-HEX_TOP_HALF_WIDTH, HEX_GRID_CONTENT_LIFT],
    [-HEX_TOP_HALF_WIDTH / 2, HEX_GRID_CONTENT_LIFT - HEX_TOP_HALF_HEIGHT],
    [HEX_TOP_HALF_WIDTH / 2, HEX_GRID_CONTENT_LIFT - HEX_TOP_HALF_HEIGHT],
];

/** 六条顶面边的外法线（取相邻顶点中点方向），单位弧度；index 即墙砖边序。 */
export const ZC_HEX_TOP_EDGE_NORMALS: ReadonlyArray<number> = ZC_HEX_TOP_VERTICES.map((point, edge) => {
    const next = ZC_HEX_TOP_VERTICES[(edge + 1) % ZC_HEX_TOP_VERTICES.length];
    return Math.atan2((point[1] + next[1]) / 2, (point[0] + next[0]) / 2);
});

/**
 * 判定 (x,y) 相对格心几何上贴着哪一条顶面边（最大外法线对齐）。
 * 单位破门、选断墙口都用这一口径，保证缺口正对单位站位。
 */
export function zcHexTopEdgeToward(x: number, y: number, centerX: number, centerY: number): number {
    const dx = x - centerX;
    const dy = y - centerY;
    let bestEdge = 0;
    let bestAlignment = -Infinity;
    for (let edge = 0; edge < ZC_HEX_TOP_EDGE_NORMALS.length; edge += 1) {
        const normalAngle = ZC_HEX_TOP_EDGE_NORMALS[edge];
        const alignment = dx * Math.cos(normalAngle) + dy * Math.sin(normalAngle);
        if (alignment > bestAlignment) {
            bestAlignment = alignment;
            bestEdge = edge;
        }
    }
    return bestEdge;
}
