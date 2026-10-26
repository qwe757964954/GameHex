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
 * 内容层**底部**留白（px）——**这是「整体一起上移」真正生效的地方**。
 *
 * ## 为什么光靠 `TERRITORY_MAP_VIEW_LIFT` 抬不动
 *
 * `cc.ScrollView` 的滚动范围被「内容层尺寸 − 视口尺寸」钳死。内容层尺寸原来恒等于地图包围盒，
 * 于是**贴到地图下边缘的目标格根本没法再往上滚**：第一章起始格（第 18 行）算出来的理想偏移是
 * 1312.5，可最大只能滚到 940 —— 差 372.5px，正好是截图里被【快速寻敌】压住的那一截。
 * 抬升量写多大都没用，因为它排在 `Math.min(maxY, …)` 里面。
 *
 * ## 解法：只在**底部**把内容层撑大
 *
 * 内容层高度 = 包围盒 + 底部留白，地图**顶部与内容层顶部对齐**（见
 * {@link territoryMapContentShiftY}）。效果：
 * - 滚到最底时，地图**底边仍在视口底部之上 300px** ⇒ 底部那几排永远不会被按钮压住；
 * - 滚到最顶时，**第一排格子贴住视口顶**，不会露出没有格子的空底图；
 * - 格心坐标一个都不动（对齐靠内容层偏移，不靠改 `buildTerritoryMapLayout`）。
 *
 * 🔴 2026-10-23 之前是「上下各 300」的对称留白 ⇒ 用户截图「格子没有铺到顶端」：
 * 滚到顶时上方露出 300px 纯底图（既没格子也没云）。顶部留白改成 **0** 解决。
 *
 * 数值取 300：主城页底部叠着【快速寻敌】+【任务】挂件，实测遮挡高度约 150~200px，
 * 留 300 之后整排地块（行高 90）都能完整露出来。
 */
export const TERRITORY_MAP_CONTENT_PADDING = 300;

/**
 * 内容层**顶部**留白（px）—— 恒 0。
 *
 * 单独留一个常量而不是直接写 0：`syncContentSize` / `territoryMapContentShiftY` /
 * `territoryMapOffsetForCell` 三处都要读它，散着写 0 会让"以后想加一点顶部呼吸感"
 * 变成改三个地方。真要加，只改这里，三处自动跟。
 */
export const TERRITORY_MAP_CONTENT_PADDING_TOP = 0;

/**
 * 地图内容层相对**内容层中心**的 y 偏移（px）。
 *
 * 顶部留白 0、底部留白 300 ⇒ 内容层比地图高 300，而地图顶部要贴内容层顶部
 * ⇒ 地图中心必须比内容层中心**高**半个留白（`(底部 - 顶部) / 2 = 150`）。
 *
 * ⚠️ 这个偏移作用在**「与格子同坐标系的那几个层」**上（`GridLayer` / 云层 /
 * 四个站点层 / `GainLayer`），由 `TerritoryMapView.initialize` 统一写一次；
 * `MapBackground` 不参与（它是按内容层尺寸 cover 铺满的，跟着偏反而会露边）。
 */
export function territoryMapContentShiftY(): number {
    const bottom = Number.isFinite(TERRITORY_MAP_CONTENT_PADDING) ? TERRITORY_MAP_CONTENT_PADDING : 0;
    const top = Number.isFinite(TERRITORY_MAP_CONTENT_PADDING_TOP) ? TERRITORY_MAP_CONTENT_PADDING_TOP : 0;
    return (bottom - top) / 2;
}

/** ScrollView 内容层尺寸 = 地图包围盒 + 顶部 / 底部留白（`cc.ScrollView` 靠它算可滚范围）。 */
export function territoryMapContentSize(
    layout: ITerritoryMapLayout,
): { readonly width: number; readonly height: number } {
    return {
        width: layout.width,
        height: layout.height > 0
            ? layout.height + TERRITORY_MAP_CONTENT_PADDING + TERRITORY_MAP_CONTENT_PADDING_TOP
            : 0,
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
    // 地图在内容层里**不居中**（顶部留白 0、底部 300）⇒ 格心的 y 要减去内容层偏移，
    // 否则算出来的偏移会整体多 150（表现为"滚过头，顶部又露出半格空"）。
    const shift = territoryMapContentShiftY();
    return {
        x: Math.min(maxX, Math.max(0, point.x + layout.width / 2 - width / 2)),
        // 「+ lift」= 往下多滚 lift，画面里的地图就整体上移 lift（滚动偏移与画面位移相反）。
        y: Math.min(maxY, Math.max(0, content.height / 2 - shift - height / 2 - point.y + lift)),
    };
}
