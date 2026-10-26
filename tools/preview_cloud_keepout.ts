/**
 * 「未解锁云」预览的**几何导出**（与代码同一份真源，不在 python 里重算）。
 *
 * 三个场景：
 *  A. **铺满整个背景** —— 只在中间露出一小片岛，其余（含内容层四周留白、顶部 UI 背后那片）
 *     全部被云盖住；云格点 = 真实格 ∪ `territoryCloudFillPoints` 的虚拟格点。
 *  B. **被地块包围的云洞** —— 整张图都解锁了、只剩中间一格没开：那格的云靠
 *     `territoryCloudPocketCells` 判定为"洞"，搬到页面顶层；**不裁剪**，每格一朵、缩
 *     `TERRITORY_CLOUD_POCKET_SCALE`。
 *  C. **影子分层** —— 相邻云重叠时，影子必须落在**所有**云体之下（四版口径：云体 / 影子是
 *     美术层拆好的两张同画布图，`cloud_body_0` / `cloud_shadow_0`）。
 *
 * 跑法：`npx tsx tools/preview_cloud_keepout.ts > /tmp/cloud.json && python tools/preview_cloud_keepout.py`
 */
import { buildHexGridLayout } from '../assets/script/core/hex/HexGridLayout';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
} from '../assets/script/core/hex/HexGridLayout';
import { territoryMapContentSize } from '../assets/script/app/territory/model/TerritoryMapLayout';
import {
    TERRITORY_CLOUD_ART_HEIGHT,
    TERRITORY_CLOUD_ART_OFFSET_Y,
    TERRITORY_CLOUD_ART_WIDTH,
    TERRITORY_CLOUD_KEEP_OUT_PX,
    TERRITORY_CLOUD_POCKET_SCALE,
    TERRITORY_CLOUD_SCALE,
    territoryCloudFillPoints,
    territoryCloudKeepOutPoints,
    territoryCloudPocketCells,
} from '../assets/script/app/territory/model/TerritoryCloud';

const ROWS = 6;
const COLUMNS = 7;
const POCKET_CELL = 2 * COLUMNS + 3;

const layout = buildHexGridLayout(ROWS, COLUMNS);
const content = territoryMapContentSize(layout);
const cells = [...layout.points.entries()].map(([cellId, point]) => ({
    cellId,
    x: point.x,
    y: point.y,
}));

const face = [
    { x: HEX_GRID_FACE_WIDTH / 2, y: 0 },
    { x: HEX_GRID_FACE_WIDTH / 4, y: HEX_GRID_FACE_HEIGHT / 2 },
    { x: -HEX_GRID_FACE_WIDTH / 4, y: HEX_GRID_FACE_HEIGHT / 2 },
    { x: -HEX_GRID_FACE_WIDTH / 2, y: 0 },
    { x: -HEX_GRID_FACE_WIDTH / 4, y: -HEX_GRID_FACE_HEIGHT / 2 },
    { x: HEX_GRID_FACE_WIDTH / 4, y: -HEX_GRID_FACE_HEIGHT / 2 },
];

/** A 场景：中间一小片已解锁岛（其余全是雾）。 */
const island = new Set<number>();
for (const [row, column] of [[2, 2], [2, 3], [3, 2], [3, 3], [2, 4], [1, 3]]) {
    island.add(row * COLUMNS + column);
}

/** B 场景：整张图都解锁，只留一格（模拟截图里那片被包围的小洞）。 */
const almostAll = new Set<number>();
for (const cell of cells) if (cell.cellId !== POCKET_CELL) almostAll.add(cell.cellId);
const pocketCells = territoryCloudPocketCells(ROWS, COLUMNS, almostAll);

/** C 场景：三朵挤在一起（模拟相邻云重叠），只看影子有没有压到别人的云体上。 */
const cluster: { x: number; y: number }[] = [];
for (const [row, column] of [[3, 3], [3, 4], [4, 3]]) {
    const point = layout.points.get(row * COLUMNS + column);
    if (point) cluster.push({ x: point.x, y: point.y });
}

process.stdout.write(JSON.stringify({
    content,
    lift: HEX_GRID_CONTENT_LIFT,
    keepOut: territoryCloudKeepOutPoints(),
    keepOutInset: TERRITORY_CLOUD_KEEP_OUT_PX,
    face,
    cloud: {
        width: TERRITORY_CLOUD_ART_WIDTH,
        height: TERRITORY_CLOUD_ART_HEIGHT,
        offsetY: TERRITORY_CLOUD_ART_OFFSET_Y,
        scale: TERRITORY_CLOUD_SCALE,
        pocketScale: TERRITORY_CLOUD_POCKET_SCALE,
        // 两张同画布 PNG（`tools/split_cloud_layers.py` 拆的）：同坐标贴，影子先画。
        body: 'assets/resources/image/territory/cloud/cloud_body_0.png',
        shadow: 'assets/resources/image/territory/cloud/cloud_shadow_0.png',
    },
    scenarios: [
        {
            key: 'fill',
            title: 'A  云的填充：铺满整个内容层（影子在云体之下）',
            cells,
            revealed: [...island],
            fillPoints: territoryCloudFillPoints(ROWS, COLUMNS, content.width, content.height),
            pockets: territoryCloudPocketCells(ROWS, COLUMNS, island),
            mask: 'keepOut',
        },
        {
            key: 'pocket',
            title: `B  云洞：不裁剪、每格一朵、缩到 ${TERRITORY_CLOUD_POCKET_SCALE}、压在顶层`,
            cells,
            revealed: [...almostAll],
            fillPoints: [],
            pockets: pocketCells,
            pocketScale: TERRITORY_CLOUD_POCKET_SCALE,
            pocketCell: POCKET_CELL,
            mask: 'none',
        },
        {
            key: 'overlap',
            title: 'C  重叠：所有影子都在所有云体之下',
            cells: [],
            revealed: [],
            fillPoints: [],
            pockets: [],
            cluster: cluster.map((point, index) => ({ cellId: index, x: point.x, y: point.y })),
            mask: 'none',
        },
    ],
}, null, 2));
