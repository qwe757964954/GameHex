import {
    ZC_DEPTH_TENDENCY,
    ZC_TENDENCY_TEXT,
    type ZCMapRegion,
} from './ZCMapConfig';

export interface IZCSpawnRegionHint {
    depth: ZCMapRegion['depth'];
    label: string;
    x: number;
    y: number;
}

/**
 * 自选出生点的区域提示：取本区域内已渲染格位的平均坐标，作为标签锚点。
 * 只处理当前 section 的区域；没有可用格位的区域直接跳过。
*/
export function resolveZCSpawnRegionHints(
    regions: readonly ZCMapRegion[],
    cellPositions: ReadonlyMap<number, Readonly<{ x: number; y: number }>>,
    section: number,
): IZCSpawnRegionHint[] {
    const hints: IZCSpawnRegionHint[] = [];
    for (const region of regions) {
        if (region.section !== section || region.cells.length === 0) continue;

        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (const cell of region.cells) {
            const position = cellPositions.get(cell);
            if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
            sumX += position.x;
            sumY += position.y;
            count += 1;
        }
        if (count === 0) continue;

        const tendency = region.tendency ?? ZC_DEPTH_TENDENCY[region.depth];
        hints.push({
            depth: region.depth,
            label: ZC_TENDENCY_TEXT[tendency],
            x: sumX / count,
            y: sumY / count,
        });
    }
    return hints;
}
