/**
 * 「云与地块的 15px 间隙」预览的**几何导出**（与代码同一份真源，不在 python 里重算）。
 *
 * 给 `tools/preview_cloud_tile_gap.py` 用：导出挡云多边形、地块轮廓、蜂窝间距与一个
 * "岛屿底部边缘"的格子布局，python 只负责拿真美术合成 + 标注。
 *
 * 跑法：`npx tsx tools/preview_cloud_tile_gap.ts`（一般由 python 脚本自动调）。
 */
import { writeFileSync } from 'node:fs';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
    HEX_GRID_TILE_SIDE_HEIGHT,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
    hexGridViewPoint,
} from '../assets/script/core/hex/HexGridLayout';
import {
    TERRITORY_CLOUD_ART_HEIGHT,
    TERRITORY_CLOUD_ART_OFFSET_Y,
    TERRITORY_CLOUD_ART_WIDTH,
    TERRITORY_CLOUD_KEEP_OUT_PX,
    territoryCloudKeepOutPoints,
    territoryFaceOutlinePoints,
    territoryTileOutlinePoints,
} from '../assets/script/app/territory/model/TerritoryCloud';

/** 预览用的小岛：3 列 × 2 行，底部那一排就是用户截图里"云贴着地块"的那一排。 */
const ROWS = 2;
const COLUMNS = 3;
const cells: { cellId: number; x: number; y: number }[] = [];
for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
        const point = hexGridViewPoint(row, column, ROWS, COLUMNS);
        cells.push({ cellId: row * COLUMNS + column, x: point.x, y: point.y });
    }
}

const payload = {
    tile: {
        width: HEX_GRID_IMAGE_WIDTH,
        height: HEX_GRID_IMAGE_HEIGHT,
        faceWidth: HEX_GRID_FACE_WIDTH,
        faceHeight: HEX_GRID_FACE_HEIGHT,
        lift: HEX_GRID_CONTENT_LIFT,
        side: HEX_GRID_TILE_SIDE_HEIGHT,
    },
    cloud: {
        width: TERRITORY_CLOUD_ART_WIDTH,
        height: TERRITORY_CLOUD_ART_HEIGHT,
        offsetY: TERRITORY_CLOUD_ART_OFFSET_Y,
    },
    keepOut: TERRITORY_CLOUD_KEEP_OUT_PX,
    spacing: { column: HEX_GRID_VIEW_COLUMN_SPACING, row: HEX_GRID_VIEW_ROW_SPACING },
    columns: COLUMNS,
    rows: ROWS,
    cells,
    /** 地块可见轮廓（格面 + 侧壁），相对格面中心。 */
    outline: territoryTileOutlinePoints(),
    /** 旧口径的基准轮廓（只有格面），只给对照图用。 */
    faceOutline: territoryFaceOutlinePoints(),
    /** 挡云多边形（地块轮廓外扩 15px），相对格面中心。 */
    keepOutPoints: territoryCloudKeepOutPoints(),
    /** 旧口径的挡云多边形（格面外扩 15px）—— 底边比图底还高 `side − inset`。 */
    oldKeepOutPoints: territoryCloudKeepOutPoints(TERRITORY_CLOUD_KEEP_OUT_PX, territoryFaceOutlinePoints()),
};

const out = process.argv[2] ?? 'docs/.tmp-cloud-tile-gap.json';
writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(`${out}  ${cells.length} 格`);
