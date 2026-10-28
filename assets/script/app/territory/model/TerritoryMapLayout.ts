import { HEX_GRID_FACE_HEIGHT, buildHexGridLayout } from '../../../core/hex/HexGridLayout';
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
 * 地图**底边**与「顶部 HUD 框底边」之间要保留的间隙（px）。
 *
 * 2026-10-27 用户口径：「最底部的地块可以被拖动到 UI 框的下方，间距约 15px」→ 上限收紧到这条线：
 * 拖到最上时地图底边停在「HUD 底边 + 15px」，**不许更远**。
 * 数值沿用领地那套 15px 习惯（见 `TERRITORY_CLOUD_KEEP_OUT_PX`）。
 */
export const TERRITORY_MAP_HUD_GAP = 15;

/**
 * 由「视口高 + 顶部 HUD 底边」反算内容层**底部**留白（px）。
 *
 * ## 推导（留白 = 可滚范围的全部来源）
 *
 * 滚到最底时 content 底边贴住视口底边 ⇒ 地图底边在视口底部**上方 `pad`**。
 * 换成「距视口顶部」的坐标：`地图底边 = 视口高 − pad`。
 * 要让这条边正好落在 `hudBottom + GAP`：
 *
 * ```text
 * 视口高 − pad = hudBottom + GAP
 * ⇒ pad = 视口高 − hudBottom − GAP
 * ```
 *
 * @param viewportHeight 地图视口高（`MapViewport` 的 `UITransform.height`）
 * @param hudBottom      顶部 HUD 底边到**视口顶部**的距离（px）；找不到 HUD 时传 0
 *
 * ⚠️ 结果夹在 `[0, ∞)`：HUD 比视口还高时（极端长屏 / HUD 改版）退回 0 ——
 *    也就是「地图底边最多贴到视口底部」，不会再让内容层尺寸算出负数。
 */
export function territoryMapContentPaddingBottom(viewportHeight: number, hudBottom: number): number {
    const height = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
    const bottom = Number.isFinite(hudBottom) ? Math.max(0, hudBottom) : 0;
    return Math.max(0, height - bottom - TERRITORY_MAP_HUD_GAP);
}

/**
 * 内容层**顶部**留白的**缺省值**（px）—— 恒 0，只有"页面没注入"时才是这个值。
 *
 * 🔴 2026-10-27 起顶部留白也是**运行时值**（{@link territoryMapContentPaddingTop}）：
 * 用户「顶部的格子还是无法拖动到个人信息框的下方」—— 顶部留白 0 意味着滚到顶时第一排格子
 * 贴着视口顶，而 `TopHud`（个人信息框 + 好友/邮件/排行榜/邀请）**浮在视口之上** 146px，
 * 于是最上面那一两排格子永久被挡在面板后面，`elastic = false` 又拖不下来。
 *
 * 单独留一个常量而不是直接写 0：三处调用都要读它，散着写 0 会让"以后想加一点顶部呼吸感"
 * 变成改三个地方。
 */
export const TERRITORY_MAP_CONTENT_PADDING_TOP = 0;

/**
 * 第一排地块的**可见顶边**比格心高出的那一截（px）= 半个格面高。
 *
 * 格面（`HEX_GRID_FACE_HEIGHT` = 90）以格心为中心 ⇒ 图往上探 45。
 * 顶部留白必须把这一截也算进去，否则"格心停在下巴下面 15px"时，第一排的**上半张脸**
 * 还压在面板上 —— 玩家看到的仍然是"没拖下来"。
 *
 * ⚠️ 与底部那套不对称是**故意的**：底部看的是「地图包围盒底边」（格心），而地块侧壁在
 *    格心**下方** 71px，所以格心停在 `hudBottom + 15` 时整块地块自然已经在面板下方；
 *    顶部相反，可见部分在格心**上方** ⇒ 留白要**多**加这 45。
 */
export const TERRITORY_MAP_TOP_FACE_RISE = HEX_GRID_FACE_HEIGHT / 2;

/**
 * 第一排地块「完整露出来」之后，玩家还可以**再往下拖**的那一截（px）。
 *
 * 🔴 2026-10-27 第三轮用户：「当前顶部留白已经实现，但是仍然需要可以下拉多大约 60px」。
 *
 * 45（{@link TERRITORY_MAP_TOP_FACE_RISE}）只做到"第一排不被面板压住"—— 那是**几何下限**，
 * 拖到头时第一排刚好贴着面板下沿，读起来像"卡在面板口上、还没拖完"。60 是**手感余量**，
 * 让玩家拖到头时能看见第一排上方还有一截底图，才相信"确实拖下来了"。
 *
 * ⚠️ 两截必须分开表达，别把 45 直接改成 105：
 *    45 是格面几何（改行高就得跟着变），60 是策划手感（跟几何无关，随时可调）。
 */
export const TERRITORY_MAP_TOP_BREATH = 60;

/**
 * 由「顶部 HUD 底边」反算内容层**顶部**留白（px）。
 *
 * ## 推导（与底部那条同源：都是"滚到头时地图边缘停在 HUD 下方"）
 *
 * 滚到**最顶**时 content 顶边贴住视口顶边 ⇒ 地图包围盒顶边距视口顶部 = `padTop`。
 * 第一排地块的可见顶边还要再往上 {@link TERRITORY_MAP_TOP_FACE_RISE}，再让出
 * {@link TERRITORY_MAP_TOP_BREATH} 的手感余量：
 *
 * ```text
 * 可见顶边 = padTop − FACE_RISE
 * 要让它在 hudBottom + GAP + BREATH：
 *   padTop = hudBottom + GAP + FACE_RISE + BREATH
 * ```
 *
 * 720×1280 实算（`hudBottom = 146`）：`146 + 15 + 45 + 60 = 266` ⇒ 可见顶边停在 221
 * （= HUD 底边 146 再往下 75）。
 *
 * @param hudBottom 顶部 HUD 底边到**视口顶部**的距离（px）；找不到 HUD 时传 0
 *
 * ⚠️ 结果夹在 `[0, ∞)`，非有限值按 0 —— 绝不让内容层尺寸算出负数。
 * ⚠️ 这里**只是"能拖到的极限"**：真机上玩家要多拖一下才看得见，不是"一进页面就停在这"。
 */
export function territoryMapContentPaddingTop(hudBottom: number): number {
    const bottom = Number.isFinite(hudBottom) ? Math.max(0, hudBottom) : 0;
    return bottom + TERRITORY_MAP_HUD_GAP + TERRITORY_MAP_TOP_FACE_RISE + TERRITORY_MAP_TOP_BREATH;
}

/**
 * 地图内容层相对**内容层中心**的 y 偏移（px）。
 *
 * 顶部留白 `paddingTop`、底部留白 `paddingBottom` ⇒ 内容层比地图高 `bottom + top`，
 * 而地图顶边要贴内容层顶边（滚到顶就是第一排格子贴视口顶）⇒ 地图中心必须比内容层中心**高**
 * 半个差量（`(bottom − top) / 2`）。
 *
 * ⚠️ 这个偏移作用在**「与格子同坐标系的那几个层」**上（`GridLayer` / 云层 /
 * 四个站点层 / `GainLayer`），由 `TerritoryMapView.applyContentShift` 统一写；
 * `MapBackground` 不参与（它是按内容层尺寸 cover 铺满的，跟着偏反而会露边）。
 *
 * ⚠️ 两份留白自 2026-10-27 起都是**页面注入的运行时值**
 * （{@link territoryMapContentPaddingBottom} / {@link territoryMapContentPaddingTop}），
 * 不再恒为 300 / 0 ⇒ 偏移必须跟着一起算，别在任何地方缓存。
 */
export function territoryMapContentShiftY(
    paddingBottom = TERRITORY_MAP_CONTENT_PADDING,
    paddingTop = TERRITORY_MAP_CONTENT_PADDING_TOP,
): number {
    const bottom = Number.isFinite(paddingBottom) ? Math.max(0, paddingBottom) : TERRITORY_MAP_CONTENT_PADDING;
    const top = Number.isFinite(paddingTop) ? Math.max(0, paddingTop) : TERRITORY_MAP_CONTENT_PADDING_TOP;
    return (bottom - top) / 2;
}

/** ScrollView 内容层尺寸 = 地图包围盒 + 顶部 / 底部留白（`cc.ScrollView` 靠它算可滚范围）。 */
export function territoryMapContentSize(
    layout: ITerritoryMapLayout,
    paddingBottom = TERRITORY_MAP_CONTENT_PADDING,
    paddingTop = TERRITORY_MAP_CONTENT_PADDING_TOP,
): { readonly width: number; readonly height: number } {
    const bottom = Number.isFinite(paddingBottom) ? Math.max(0, paddingBottom) : TERRITORY_MAP_CONTENT_PADDING;
    const top = Number.isFinite(paddingTop) ? Math.max(0, paddingTop) : TERRITORY_MAP_CONTENT_PADDING_TOP;
    return {
        width: layout.width,
        height: layout.height > 0 ? layout.height + bottom + top : 0,
    };
}

/** 将地图格心换算为 ScrollView 从左上角计量的滚动偏移。 */
export function territoryMapOffsetForCell(
    layout: ITerritoryMapLayout,
    cellId: number,
    viewport: Readonly<{ width: number; height: number }>,
    options?: Readonly<{ lift?: number; paddingBottom?: number; paddingTop?: number }>,
): ITerritoryMapPoint {
    const point = layout.points.get(cellId);
    if (!point) return { x: 0, y: 0 };

    const lift = options?.lift ?? TERRITORY_MAP_VIEW_LIFT;
    const paddingBottom = options?.paddingBottom ?? TERRITORY_MAP_CONTENT_PADDING;
    const paddingTop = options?.paddingTop ?? TERRITORY_MAP_CONTENT_PADDING_TOP;
    const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
    const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
    // ⚠️ 纵向一律用「内容层尺寸」而不是包围盒：可滚范围必须算上留白，否则底部目标永远差一截。
    const content = territoryMapContentSize(layout, paddingBottom, paddingTop);
    const maxX = Math.max(0, layout.width - width);
    const maxY = Math.max(0, content.height - height);
    // 地图在内容层里**不居中**（顶部留白 top、底部留白 bottom）⇒ 格心的 y 要减去内容层偏移，
    // 否则算出来的偏移会整体多 (bottom − top)/2（表现为"滚过头，顶部又露出半格空"）。
    const shift = territoryMapContentShiftY(paddingBottom, paddingTop);
    return {
        x: Math.min(maxX, Math.max(0, point.x + layout.width / 2 - width / 2)),
        // 「+ lift」= 往下多滚 lift，画面里的地图就整体上移 lift（滚动偏移与画面位移相反）。
        y: Math.min(maxY, Math.max(0, content.height / 2 - shift - height / 2 - point.y + lift)),
    };
}
