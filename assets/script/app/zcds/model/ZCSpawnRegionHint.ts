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

/** Resolve own-region labels into board-local anchors using the rendered cell positions. */
export function resolveZCSpawnRegionHints(
    regions: readonly ZCMapRegion[],
    cellPositions: ReadonlyMap<number, Readonly<{ x: number; y: number }>>,
    section: number,
): IZCSpawnRegionHint[] {
    const hints: IZCSpawnRegionHint[] = [];
    for (const region of regions) {
        if (region.section !== section || region.cells.length === 0) continue;

        let xTotal = 0;
        let yTotal = 0;
        let count = 0;
        for (const cell of region.cells) {
            const position = cellPositions.get(cell);
            if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
            xTotal += position.x;
            yTotal += position.y;
            count += 1;
        }
        if (count === 0) continue;

        const tendency = region.tendency ?? ZC_DEPTH_TENDENCY[region.depth];
        hints.push({
            depth: region.depth,
            label: ZC_TENDENCY_TEXT[tendency],
            x: xTotal / count,
            y: yTotal / count,
        });
    }
    return hints;
}
