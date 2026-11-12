import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritorySite, TerritorySiteType } from './TerritoryMapConfig';

/**
 * 「一个节点只在一块地上长 UI」—— 算出同一节点里**不该画任何东西**的格子。
 *
 * ## 需求（2026-11-09 用户口径）
 *
 * > 「关卡或者 boss 关卡，或者 pvp 据点，置于**建筑地块**上展示具体的 UI，
 * >  其他**同一节点**的地块不展示任何 UI。」
 *
 * 截图现象：`chapter_01` 的一关是**多个单格站点**共用同一个 `configId`
 * （`10001` = `327`（无建筑，30 银币）＋ `328`（建筑 69004，30 银币）），
 * 于是同一片地块上出现「一个建筑 + 一圈银币数字」，读起来像「这一关要买三次」。
 *
 * ## 口径：一个节点只认**配了建筑**的那一格
 *
 * 「节点」= **同 `configId` 的战斗站点组**（`stage` / `boss` / `asyncPvp`）。
 * 组内只要**有一格配了 `buildingId`**，其余格子的 `cellId` / `footprint` 全部进返回值：
 *
 * | 情形 | 结果 |
 * | :--- | :--- |
 * | 组内只有 1 格（`chapter_02` 起的一站式 footprint） | 不隐 |
 * | 组内多格、**恰好一格**有建筑（`chapter_01` 的 13 关） | 隐其余各格 |
 * | 组内多格、**都没有**建筑 | **不隐**（隐了整关会凭空消失） |
 * | 组内多格、**每格都有**建筑 | 不隐（各自承载自己的 UI） |
 *
 * ## 🔴 只管「画不画」，不管「能不能开」
 *
 * 隐藏的是**价格 / 编号气泡 / 建筑**这三种 UI，不是格子本身：这些格子仍然可点、
 * 仍然照常扣银币解锁（用户 2026-11-09：「保留可点，照常解锁」）。
 * 所以本模块的返回值只喂给 `TerritoryMapView.stationRenderOf` 的**画法**分支，
 * **不许**拿去过滤 `revealedCells` / `siteOpenableCells` / 扣费判据。
 *
 * ## 为什么不是「只隐 footprint 的兄弟格」
 *
 * `chapter_02` 起一关是**一个站点带 5~10 格 footprint**，非锚点格根本没有独立站点
 * ⇒ 本来就不画东西，不需要这条规则。真正需要它的是 `chapter_01` 那种
 * 「一关拆成多个单格站点」的配法，那里的兄弟格是**独立站点**，各自带价格。
 */

/** 会在地图上「长得像一个节点」的战斗站点类型（与 `stationRenderOf` 的三个分支同源）。 */
const NODE_SITE_TYPES: readonly TerritorySiteType[] = [
    TERRITORY_SITE_TYPE.stage,
    TERRITORY_SITE_TYPE.boss,
    TERRITORY_SITE_TYPE.asyncPvp,
];

export function isTerritoryNodeSite(site: TerritorySite): boolean {
    return NODE_SITE_TYPES.includes(site.type);
}

/** 这一格是否配了指认的建筑（空串 / 缺字段都算没配，与 `stationIconOf` 同口径）。 */
function hasBuilding(site: TerritorySite): boolean {
    return typeof site.buildingId === 'string' && site.buildingId.trim() !== '';
}

/**
 * 按 `configId` 分组。没有 `configId` 的站点无法判「同一节点」⇒ 不参与（保持现状更安全）。
 */
function nodeGroups(sites: readonly TerritorySite[]): Map<string, TerritorySite[]> {
    const groups = new Map<string, TerritorySite[]>();
    for (const site of sites) {
        if (!isTerritoryNodeSite(site)) continue;
        const key = (site.configId ?? '').trim();
        if (key === '') continue;
        const list = groups.get(key);
        if (list) list.push(site);
        else groups.set(key, [site]);
    }
    return groups;
}

/**
 * `cellId` → **这一格所属节点承载 UI 的那一格**（含 `footprint`）。
 *
 *  · 组内有建筑格 ⇒ 整组（含各自 footprint）都指向那一格；
 *  · 组内一格建筑都没有 ⇒ 每个站点指向自己的 `cellId`（footprint 收到锚点上）。
 *
 * ⚠️ footprint 也要进表：`chapter_02` 起一关就是一块 5~10 格的 footprint，
 *    锁 / 价格这些逐格画的东西都可能在非锚点格上出现，不归一就又回到「一片锁」。
 */
export function territoryNodeCarrierByCell(sites: readonly TerritorySite[]): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    for (const list of nodeGroups(sites).values()) {
        const carrier = list.filter(hasBuilding)[0]?.cellId ?? null;
        for (const site of list) {
            const target = carrier ?? site.cellId;
            out.set(site.cellId, target);
            for (const cell of site.footprint ?? []) out.set(cell, target);
        }
    }
    return out;
}

/**
 * 把「被卡住」的格子收敛成**一个节点一处 UI**，且只落在承载 UI 的那一格上。
 *
 * ## 口径（2026-11-10 用户，覆盖 2026-11-09 第三轮的「每格都画锁」）
 *
 * > 「如果是未解锁，那么整个关卡节点就**只有建筑虚影上**显示锁住的 icon；
 * >  如果是可激活，那么只有建筑虚影显示银币和数值 UI，**不会出现锁和银币同时存在**的情况。」
 *
 * 三件事一起成立：
 *  ① 锁只画在**承载格**（配了建筑的那格；`chapter_02` 起就是锚点）—— 空地一格都不画；
 *  ② 锁与价格**互斥** —— 画锁的格一定不画价格（`syncStations` 据此把 `isCondition` 置 false）；
 *  ③ 组内**任一格**被前置卡住 ⇒ 整个节点算「未解锁」⇒ 承载格画锁。
 *
 * ③ 是 2026-11-09 那条「附近格子也要有锁」的**正确做法**：不是把锁复制到空地上，
 * 而是把「这个节点开不了」落到唯一看得见的那一格上。
 * 原型见 `chapter_01` 的 `10005` 首领：`213`（建筑）+ 周围 6 格空地，
 * 6 格的前置要三只宝箱（`253/232/231`）⇒ 整节点只在 213 上画 1 把锁，6 格空地什么都不画。
 *
 * 非节点格（随机资源格 / 宝箱）原样透传 —— 它们一格就是一处内容，没有「节点」可收。
 *
 * ⚠️ 与 {@link territoryNodeMutedCells} 是两条独立判据，别合并：那个管「画不画内容 UI」，
 * 这个管「锁画在哪一格」。两者的交集恒为空（承载格永远不 muted）。
 */
export function territoryNodeLockCells(
    sites: readonly TerritorySite[],
    lockedCells: readonly number[] | undefined,
): ReadonlySet<number> {
    const out = new Set<number>();
    if (!lockedCells || lockedCells.length === 0) return out;
    const carrier = sites && sites.length > 0 ? territoryNodeCarrierByCell(sites) : null;
    for (const cellId of lockedCells) out.add(carrier?.get(cellId) ?? cellId);
    return out;
}

/**
 * 同一节点里**不承载建筑 / 编号气泡**的格子（`cellId` 集合）。
 *
 * ⚠️ 只作用于**已解锁**之后的画法：未解锁的兄弟格照样要显示自己的「银币 + 数量」
 * （用户 2026-11-09 第五轮：「兄弟格跟 30 样式一样」），价格不归这里管。
 * 判据落在 `TerritoryMapView.stationRenderOf` 的 `mutedCells.has(...) && isOpened`。
 *
 * @param sites 本章全部站点；不传 / 空数组 ⇒ 空集合（等价于「保持现状」）。
 */
export function territoryNodeMutedCells(sites: readonly TerritorySite[]): ReadonlySet<number> {
    const muted = new Set<number>();
    if (!sites || sites.length === 0) return muted;
    for (const list of nodeGroups(sites).values()) {
        if (list.length < 2) continue;
        const carriers = list.filter(hasBuilding);
        // 一格建筑都没有 ⇒ 隐了整关就消失；每格都有建筑 ⇒ 各自承担 UI。两种情况都保持现状。
        if (carriers.length === 0 || carriers.length === list.length) continue;
        const carrierCells = new Set<number>();
        for (const site of carriers) {
            carrierCells.add(site.cellId);
            for (const cell of site.footprint ?? []) carrierCells.add(cell);
        }
        for (const site of list) {
            if (carriers.includes(site)) continue;
            const cells = site.footprint && site.footprint.length > 0 ? site.footprint : [site.cellId];
            for (const cell of cells) {
                // 防御：兄弟站的 footprint 万一压到承载格上，承载格必须保住 UI。
                if (carrierCells.has(cell)) continue;
                muted.add(cell);
            }
        }
    }
    return muted;
}
