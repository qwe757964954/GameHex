import {
    HEX_GRID_LOGICAL_COLUMN_PHASE,
    HEX_GRID_LOGICAL_COLUMN_STEP,
    HEX_GRID_LOGICAL_ROW_STEP,
} from '../../../core/hex/HexGridLayout';
import type { ZCMatchMap } from './ZCMatchConfig';

/** 对局蜂窝的列相位（相邻奇偶列垂直错位的一半）。*/
export const ZC_HEX_COLUMN_PHASE = HEX_GRID_LOGICAL_COLUMN_PHASE;

/** 棋盘逻辑坐标换算。distance 的格距只用于视觉排序，通行范围仍查邻接关系。*/
export class ZCMapGeometry {
    constructor(private readonly map: ZCMatchMap) {}

    distance(fromId: number, toId: number): number {
        const from = this.map.hexes[fromId];
        const to = this.map.hexes[toId];
        return Math.round(Math.hypot(to.x - from.x, to.y - from.y) / HEX_GRID_LOGICAL_ROW_STEP);
    }

    /** 点所在的可用格；落在水域或蜂窝外返回 null。*/
    hexIdAt(x: number, y: number): number | null {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const colApprox = Math.round(x / HEX_GRID_LOGICAL_COLUMN_STEP + (this.map.columns - 1) / 2);
        const phase = (colApprox & 1) ? ZC_HEX_COLUMN_PHASE : -ZC_HEX_COLUMN_PHASE;
        const rowApprox = Math.round((this.map.rows - 1) / 2 - (y - phase) / HEX_GRID_LOGICAL_ROW_STEP);
        let bestId: number | null = null;
        let bestDistanceSq = Infinity;
        for (let row = rowApprox - 1; row <= rowApprox + 1; row += 1) {
            if (row < 0 || row >= this.map.rows) continue;
            for (let col = colApprox - 1; col <= colApprox + 1; col += 1) {
                if (col < 0 || col >= this.map.columns) continue;
                const hex = this.map.hexes[row * this.map.columns + col];
                const distanceSq = (hex.x - x) ** 2 + (hex.y - y) ** 2;
                if (distanceSq < bestDistanceSq) { bestDistanceSq = distanceSq; bestId = hex.id; }
            }
        }
        if (bestId === null) return null;
        const hex = this.map.hexes[bestId];
        if (!hex.playable) return null;
        // 六边形是邻格中心垂直平分线围出来的区域。
        const dx = x - hex.x;
        const dy = y - hex.y;
        if (Math.abs(dy) > HEX_GRID_LOGICAL_ROW_STEP / 2 + 0.5) return null;
        // 斜邻居的垂直差是「相邻列错位量 2*PHASE」，不是行步长/2。正六边形时两者刚好相等
        // （相位 = 行步长/4），换成压扁六边形后相位独立，照行步长算会把判定区放大 17%。
        const diagonalY = 2 * ZC_HEX_COLUMN_PHASE;
        const halfSquared = (HEX_GRID_LOGICAL_COLUMN_STEP ** 2 + diagonalY ** 2) / 2;
        const roundingTolerance = (HEX_GRID_LOGICAL_COLUMN_STEP + diagonalY) / 2;
        return HEX_GRID_LOGICAL_COLUMN_STEP * Math.abs(dx) + diagonalY * Math.abs(dy) <= halfSquared + roundingTolerance
            ? bestId : null;
    }
}
