import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
} from '../../../core/hex/HexGridLayout';

/**
 * 地块可见台面（那层六边形顶面）的六个顶点，格心为原点，UI 坐标。
 * 墙砖按这六条边贴，城墙渲染和破门边判定共用这一份；台面相对正六边形有 CONTENT_LIFT 上移
 * 和压缩，两边各算各的会把缺口和砖错开一根。
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

/** 六条顶面边的外法线（相邻顶点中点的方向），弧度；index 就是墙砖边序。*/
export const ZC_HEX_TOP_EDGE_NORMALS: ReadonlyArray<number> = ZC_HEX_TOP_VERTICES.map((point, edge) => {
    const next = ZC_HEX_TOP_VERTICES[(edge + 1) % ZC_HEX_TOP_VERTICES.length];
    return Math.atan2((point[1] + next[1]) / 2, (point[0] + next[0]) / 2);
});

/** (x,y) 相对格心最贴着哪条顶面边（外法线对齐度最高）。破门和选断墙口都走这里。*/
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
