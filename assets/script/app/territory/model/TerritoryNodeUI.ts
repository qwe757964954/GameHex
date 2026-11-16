import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritorySite, TerritorySiteType } from './TerritoryMapConfig';

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
        const carrier = list.filter(hasBuilding)[0]?.cellId ?? null;
        for (const site of list) {
            const target = carrier ?? site.cellId;
            out.set(site.cellId, target);
            for (const cell of site.footprint) out.set(cell, target);
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
 * 同一节点里不承载建筑 / 编号气泡的格子。
 *
 * 只作用于已解锁后的画法；未解锁的兄弟格仍显示自己的价格。
 */
export function territoryNodeMutedCells(sites: readonly TerritorySite[]): ReadonlySet<number> {
    const muted = new Set<number>();
    if (!sites.length) return muted;
    for (const list of nodeGroups(sites).values()) {
        if (list.length < 2) continue;
        const carriers = list.filter(hasBuilding);
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
    return muted;
}
