import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritorySite, TerritorySiteType } from './TerritoryMapConfig';
import { territoryPatrolAnchorByCell } from './TerritoryMonsterPatrol';

/**
 * 「一个节点只在一块地上长 UI」：算出同一节点里不该重复画 UI 的格子。
 *
 * 节点指同 `configId` 的战斗站点组（stage / boss / asyncPvp）。组内只有一格配了
 * `buildingId` 时，其余格子的 UI 收到那一格；没有任何一格配建筑时保持原样，
 * 避免整关凭空消失。这里只管「画不画」，不影响格子可点、可解锁。
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
 * `cellId` → 这一格所属节点承载 UI 的那一格（含 footprint）。
 *
 * 组内有建筑格时整组指向它；没有建筑格时各站点指向自己的 `cellId`。
 */
export function territoryNodeCarrierByCell(sites: readonly TerritorySite[]): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    for (const list of nodeGroups(sites).values()) {
        let carrier: number | null = null;
        for (let i = 0; i < list.length; i++) {
            if (hasBuilding(list[i])) {
                carrier = list[i].cellId;
                break;
            }
        }
        for (const site of list) {
            const target = carrier ?? site.cellId;
            out.set(site.cellId, target);
            for (const cell of site.footprint) out.set(cell, target);
        }
    }
    // 2026-11-20：巡逻野怪片区也走「一个节点只在一格长 UI」，承载格换成
    // **配了 `patrolId` 的那一格**（分组键 `site.id`，见 `territoryPatrolAnchorByCell`）。
    // 战斗节点按 `configId` + `buildingId` 收敛，两套分组互不重叠，直接合进同一份 map：
    // `territoryNodeLockCells` 不必知道片区类型，锁自然只落在野怪 id 那格。
    for (const [cell, anchor] of territoryPatrolAnchorByCell(sites)) out.set(cell, anchor);
    return out;
}

/**
 * 同一关卡节点的地块 → **用哪一格的进度判地皮 / 格面框**。
 * 将同区域战斗站点的地块状态色收敛到建筑承载格统一判定。
 * 保持整片地块状态色同步，锁与价格等 UI 仍由承载格独立渲染。
 */
export function territoryNodeStateCellByCell(
    sites: readonly TerritorySite[],
): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    for (const list of nodeGroups(sites).values()) {
        const carriers: TerritorySite[] = [];
        for (let i = 0; i < list.length; i++) {
            if (hasBuilding(list[i])) carriers.push(list[i]);
        }
        // 多建筑节点各自承担 UI ⇒ 不收敛。
        if (carriers.length > 1) continue;
        const anchor = carriers.length === 1 ? carriers[0].cellId : list[0].cellId;
        for (const site of list) {
            out.set(site.cellId, anchor);
            for (const cell of site.footprint ?? []) out.set(cell, anchor);
        }
    }
    return out;
}

/**
 * 「整片一起置灰」要补的格子（不含入参里已有的那些）。
 *
 * 模型侧 `lockBlockedCells` 是**逐格**算前置的，`paintHexes` 也已经把被卡住站点的
 * footprint 铺开；但 `chapter_01` 那种「多个单格站点共用 configId」的节点，兄弟格
 * 与承载格可能只有一格进集合 ⇒ 整片里只有它置灰，其余仍是泥土。
 *
 * 组内任一格被卡住 ⇒ 整组（含各自 footprint）一起灰；解锁那帧也一起换回颜色。
 * 只作用于战斗节点组：宝箱 / 随机格本来就是各自独立的格子，不跟着别人变。
 */
export function territoryNodeGreyCells(
    sites: readonly TerritorySite[],
    blocked: ReadonlySet<number>,
): ReadonlySet<number> {
    const out = new Set<number>();
    for (const list of nodeGroups(sites).values()) {
        // 与 territoryNodeStateCellByCell 同一条边界：多建筑节点各自承担 UI，不摊灰。
        let buildingCount = 0;
        for (let i = 0; i < list.length; i++) {
            if (hasBuilding(list[i])) {
                buildingCount += 1;
                if (buildingCount > 1) break;
            }
        }
        if (buildingCount > 1) continue;
        const cells = new Set<number>();
        for (const site of list) {
            cells.add(site.cellId);
            for (const cell of site.footprint ?? []) cells.add(cell);
        }
        let anyBlocked = false;
        for (const cell of cells) {
            if (blocked.has(cell)) { anyBlocked = true; break; }
        }
        if (!anyBlocked) continue;
        for (const cell of cells) {
            if (!blocked.has(cell)) out.add(cell);
        }
    }
    return out;
}

/**
 * 把被卡住的格子收敛成一个节点一处 UI，只落在承载 UI 的那一格上。
 *
 * 锁与价格互斥；组内任一格被前置卡住，整个节点算未解锁，由承载格画锁。
 * 与 {@link territoryNodeMutedCells} 是两条独立判据：那个管画不画内容 UI，
 * 这个管锁画在哪一格。
 */
export function territoryNodeLockCells(
    sites: readonly TerritorySite[],
    lockedCells: readonly number[] | undefined,
): ReadonlySet<number> {
    const out = new Set<number>();
    if (!lockedCells || lockedCells.length === 0) return out;
    const carrier = territoryNodeCarrierByCell(sites);
    for (const cellId of lockedCells) out.add(carrier.get(cellId) ?? cellId);
    return out;
}

/**
 * 同一节点里**任何状态都不画 UI** 的格子（建筑 / 编号气泡 / 价格 / 锁）。
 *
 * 战斗节点按 `configId` + `buildingId` 收敛；2026-11-20 起巡逻野怪片区按
 * `site.id` + `patrolId` 收敛（§3.48）。隐掉的格子仍然可点、照常扣银币解锁，
 * 与 `stationRenderOf` 的 muted 早退一致。
 */
export function territoryNodeMutedCells(sites: readonly TerritorySite[]): ReadonlySet<number> {
    const muted = new Set<number>();
    if (!sites.length) return muted;
    for (const list of nodeGroups(sites).values()) {
        if (list.length < 2) continue;
        const carriers: TerritorySite[] = [];
        for (let i = 0; i < list.length; i++) {
            if (hasBuilding(list[i])) carriers.push(list[i]);
        }
        // 一格建筑都没有会隐掉整关；每格都有建筑则各自承担 UI。两种情况都保持现状。
        if (carriers.length === 0 || carriers.length === list.length) continue;
        const carrierCells = new Set<number>();
        for (const site of carriers) {
            carrierCells.add(site.cellId);
            for (const cell of site.footprint) carrierCells.add(cell);
        }
        for (const site of list) {
            if (carriers.includes(site)) continue;
            const cells = site.footprint.length ? site.footprint : [site.cellId];
            for (const cell of cells) {
                if (carrierCells.has(cell)) continue;
                muted.add(cell);
            }
        }
    }
    // 2026-11-20：「同个节点的巡逻野怪地块，只在配置了野怪 id 的地块上展示解锁 icon
    // 和激活银币 icon，其他地块不显示，参考异步 PVP 地块」。
    // 巡逻格没有 `buildingId`、没有 `configId`，战斗节点那套分组一条都命不中 ⇒
    // 必须单独按 `site.id` 收敛：锚点（带 patrolId）留在集合外，其余格（含 footprint）
    // 全部 mute，交给 `stationRenderOf` 早退成「空地但仍可点」。
    // 整片都没配 patrolId 的旧图 `territoryPatrolAnchorByCell` 不给映射 ⇒ 一个都不隐。
    for (const [cell, anchor] of territoryPatrolAnchorByCell(sites)) {
        if (cell !== anchor) muted.add(cell);
    }
    return muted;
}
