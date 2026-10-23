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

/**
 * 目标格停在视口「中线偏上」的抬升量（px）。
 *
 * 主城页底部压着【快速寻敌】按钮，所以目标格不停在正中，而是停在视口中线上方 100px
 * （2026-10-21 用户反馈「地块和快速寻敌按钮重叠」）。
 *
 * ⚠️ **真正让底部地块躲开按钮的不是这个常数**，是下面的 `TERRITORY_MAP_CONTENT_PADDING`：
 * 这个 lift 排在 `Math.min(maxY, …)` 里面，贴到地图下边缘时会被滚动上限吃掉。
 */
export const TERRITORY_MAP_VIEW_LIFT = 100;

/**
 * 内容层四周额外留白（px）——**这是「整体一起上移」真正生效的地方**。
 *
 * ## 为什么光靠 `TERRITORY_MAP_VIEW_LIFT` 抬不动
 *
 * `cc.ScrollView` 的滚动范围被「内容层尺寸 − 视口尺寸」钳死。内容层尺寸原来恒等于地图包围盒，
 * 于是**贴到地图下边缘的目标格根本没法再往上滚**：第一章起始格（第 18 行）算出来的理想偏移是
 * 1312.5，可最大只能滚到 940 —— 差 372.5px，正好是截图里被【快速寻敌】压住的那一截。
 * 抬升量写多大都没用，因为它排在 `Math.min(maxY, …)` 里面。
 *
 * ## 解法：把内容层撑大（等于给相机多留可走的路）
 *
 * 内容层高度 = 包围盒 + 2×留白，格心坐标**一个都不动**（地图仍然居中在内容层里）。
 * 效果：
 * - 滚到最底时，地图**底边仍在视口底部之上 300px** ⇒ 底部那几排永远不会被按钮压住；
 * - 不管目标格在哪，地图像素位移都只是「相机多滚了 300」，不需要动地块的初始坐标，
 *   也就不会破坏 `buildTerritoryMapLayout` 与共享格心对齐的契约（见 `tests/territory-map-layout.test.ts`）；
 * - 顶部同样多出 300px 可滚范围，靠边的目标格也能落在视口中间，不再一进页面就贴边。
 *
 * 数值取 300：主城页底部叠着【快速寻敌】+【任务】挂件，实测遮挡高度约 150~200px，
 * 留 300 之后整排地块（行高 90）都能完整露出来。
 */
export const TERRITORY_MAP_CONTENT_PADDING = 300;

/** ScrollView 内容层尺寸 = 地图包围盒 + 四周留白（`cc.ScrollView` 靠它算可滚范围）。 */
export function territoryMapContentSize(
    layout: ITerritoryMapLayout,
): { readonly width: number; readonly height: number } {
    return {
        width: layout.width,
        height: layout.height > 0 ? layout.height + TERRITORY_MAP_CONTENT_PADDING * 2 : 0,
    };
}

/** 将地图格心换算为 ScrollView 从左上角计量的滚动偏移。 */
export function territoryMapOffsetForCell(
    layout: ITerritoryMapLayout,
    cellId: number,
    viewport: Readonly<{ width: number; height: number }>,
    options?: Readonly<{ lift?: number }>,
): ITerritoryMapPoint {
    const point = layout.points.get(cellId);
    if (!point) return { x: 0, y: 0 };

    const lift = options?.lift ?? TERRITORY_MAP_VIEW_LIFT;
    const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
    const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
    // ⚠️ 纵向一律用「内容层尺寸」而不是包围盒：可滚范围必须算上留白，否则底部目标永远差一截。
    const content = territoryMapContentSize(layout);
    const maxX = Math.max(0, layout.width - width);
    const maxY = Math.max(0, content.height - height);
    return {
        x: Math.min(maxX, Math.max(0, point.x + layout.width / 2 - width / 2)),
        // 「+ lift」= 往下多滚 lift，画面里的地图就整体上移 lift（滚动偏移与画面位移相反）。
        y: Math.min(maxY, Math.max(0, content.height / 2 - height / 2 - point.y + lift)),
    };
}
