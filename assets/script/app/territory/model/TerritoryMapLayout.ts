import { buildHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { HexGridPoint, IHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { TerritoryMapConfig } from './TerritoryMapConfig';

/**
 * 领地章节地图的布局换算 —— **纯函数，零 `cc` 依赖**。
 *
 *  从 `TerritoryPage` 里抽出来：布局只跟「行数 / 列数」有关，与渲染、存档、拖拽都无关。
 *  抽成纯函数后既能单测，也让页面不再同时承担「算坐标」与「画节点」两件事 —— 后者归
 *  `TerritoryMapView`。
 */

/** 地图上一个格子的中心（已相对整张图的包围盒中心做过平移）。 */
export type ITerritoryMapPoint = HexGridPoint;

export type ITerritoryMapLayout = IHexGridLayout;

/**
 * 领地沿用共享布局的坐标、包围盒与画家顺序；空地图由共享入口返回有限尺寸。
 */
export function buildTerritoryMapLayout(map: TerritoryMapConfig): ITerritoryMapLayout {
    return buildHexGridLayout(map.rows, map.columns);
}

/** 将地图格心换算为 ScrollView 从左上角计量的滚动偏移。 */
export function territoryMapOffsetForCell(
    layout: ITerritoryMapLayout,
    cellId: number,
    viewport: Readonly<{ width: number; height: number }>,
): ITerritoryMapPoint {
    const point = layout.points.get(cellId);
    if (!point) return { x: 0, y: 0 };

    const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
    const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
    const maxX = Math.max(0, layout.width - width);
    const maxY = Math.max(0, layout.height - height);
    return {
        x: Math.min(maxX, Math.max(0, point.x + layout.width / 2 - width / 2)),
        y: Math.min(maxY, Math.max(0, layout.height / 2 - height / 2 - point.y)),
    };
}
