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
 * 同一关卡节点的地块 → **用哪一格的进度判地皮 / 格面框**。
 *
 * 用户 2026-11-18：「绿圈部分的地块也是归属关卡地块，现在没有和归属相关的地块状态
 * 同步变化，待解锁是灰色，可激活就应该变成红色了」。
 *
 * 现场是 `chapter_01` 的 1-1：`327`（`stage`、`configId=10001`、没配 `buildingId`）与
 * `328`（同 `configId`、配了 `69004`）是同一个节点的两格。`paintHexes` 原先**逐格**拿
 * 自己 cellId 的 `isCellUnlocked / isOwned / isAreaPassed` 判地皮和框，两格的进度一旦
 * 不同步就会「承载格灰、兄弟格褐」，格面红框也只挂在其中一格上。
 *
 * 🔴 收敛口径与「UI 收敛」同源但**不是同一件事**：这里管的是整片地块的状态色，
 * 锁 / 价格 / 编号气泡仍然只长在承载格上（`territoryNodeMutedCells` 一个字没动）。
 * 多建筑节点（组内每格都有 buildingId）不收敛，各格照旧按自己判 —— 那种节点本来
 * 就是各自承担 UI，硬拧成一格会读错。
 *
 * 没有建筑时退回组内第一个站点的 `cellId`：chapter_02 起一关就是「一个站点 + 5~10 格
 * footprint」，footprint 里的格在 `siteByCell` 里查不到站点 ⇒ 不收敛的话它们永远拿不到
 * 关卡的红色格面框。
 */
export function territoryNodeStateCellByCell(
    sites: readonly TerritorySite[],
): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    for (const list of nodeGroups(sites).values()) {
        const carriers = list.filter(hasBuilding);
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
        if (list.filter(hasBuilding).length > 1) continue;
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
