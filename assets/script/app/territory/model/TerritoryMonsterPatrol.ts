import { TERRITORY_SITE_TYPE, territoryNeighbors } from './TerritoryMapConfig';
import type { TerritoryMapConfig, TerritorySite } from './TerritoryMapConfig';

export const TERRITORY_MONSTER_PATROL_STEP_MS = 1600;

/**
 * 巡逻宝箱怪「未挑战成功」的叠加参数 —— 与战斗内**其他玩家卡牌**同一形式。
 *
 * 真源在 `zcds/view/ZCUnitView.ts`：`OTHER_PLAYER_TINT = #828282`（主骨架顶点色压暗）、
 * `OWNER_EDGE_COLOR[enemy] = ZC_CLIENT_COLORS.enemyEdge = (251,73,105)`（描边）、
 * `OUTLINE_COPY_SCALE = 1.08`（整只角色放大副本）。这里只搬**数值与资源路径**，
 * 不反向 import zcds/view（领地页不该拖战斗视图）；`tests/territory-patrol-look.test.ts`
 * 用源码守卫盯住两边不许漂移。
 *
 * 轮廓渲染规范：通过 shaders/unit-outline-copy 将副本不透明像素着为纯色并适当放大形成外轮廓描边。
 */
export const TERRITORY_PATROL_DIM_RGB: readonly [number, number, number] = [0x82, 0x82, 0x82];
export const TERRITORY_PATROL_EDGE_RGB: readonly [number, number, number] = [251, 73, 105];
export const TERRITORY_PATROL_OUTLINE_SCALE = 1.08;
export const TERRITORY_PATROL_OUTLINE_EFFECT_PATH = 'shaders/unit-outline-copy';

export interface ITerritoryMonsterPatrol {
    readonly cellId: number;
    readonly monsterId: number;
    readonly route: readonly number[];
}

/** 巡逻区分组键：以 site.id 为准，确保同一片巡逻区完整成组。 */
function territoryPatrolGroupKey(site: TerritorySite): string {
    return site.id;
}

/**
 * 映射每一格巡逻宝箱站点到其战斗 ID (battleId)。
 */
export function territoryPatrolBattleByCell(
    sites: readonly TerritorySite[],
): ReadonlyMap<number, number> {
    const battleByCell = new Map<number, number>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        if (site.battleId === undefined) continue;
        battleByCell.set(site.cellId, site.battleId);
    }
    return battleByCell;
}

/**
 * 获取巡逻区已挑战成功的格子集合（含 footprint）。同 battleId 任一格占点即整片通过。
 *
 * 2026-11-20 起这份集合**只管表现与地块状态**（野怪恢复原色 / 收描边、地皮转草地 /
 * 摘红框），不再决定野怪生灭 —— 见 {@link buildTerritoryMonsterPatrols}。
 */
export function territoryPatrolPassedCells(
    sites: readonly TerritorySite[],
    progress: { isOwned(cellId: number): boolean },
): ReadonlySet<number> {
    const battleByCell = territoryPatrolBattleByCell(sites);
    const passedBattles = new Set<number>();
    for (const [cellId, battleId] of battleByCell) {
        if (progress.isOwned(cellId)) passedBattles.add(battleId);
    }
    const out = new Set<number>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        const battleId = battleByCell.get(site.cellId);
        if (battleId === undefined || !passedBattles.has(battleId)) continue;
        out.add(site.cellId);
        for (const cell of site.footprint) out.add(cell);
    }
    return out;
}

/**
 * 确定巡逻区交互锚点格：优先取携带 patrolId 的配置格，向服务端上报统一使用该格。
 */
export function territoryPatrolAnchorCell(
    site: TerritorySite,
    sites: readonly TerritorySite[],
): number {
    if (site.type !== TERRITORY_SITE_TYPE.patrolChest) return site.cellId;
    let anchor: number | null = null;
    for (const item of sites) {
        if (item.type !== TERRITORY_SITE_TYPE.patrolChest || item.id !== site.id) continue;
        if (!item.patrolId) continue;
        if (item.cellId === site.cellId) return item.cellId;
        if (anchor === null || item.cellId < anchor) anchor = item.cellId;
    }
    return anchor ?? site.cellId;
}

export function territoryPatrolAnchorByCell(sites: readonly TerritorySite[]): ReadonlyMap<number, number> {
    const anchors = new Map<string, number>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest || !site.patrolId) continue;
        const key = territoryPatrolGroupKey(site);
        anchors.set(key, Math.min(anchors.get(key) ?? site.cellId, site.cellId));
    }

    const byCell = new Map<number, number>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        const anchor = anchors.get(territoryPatrolGroupKey(site));
        if (anchor === undefined) continue;
        byCell.set(site.cellId, site.patrolId ? site.cellId : anchor);
    }

    // 先写站点格，重叠的 footprint 才不会覆盖其他站点的锚点。
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest || !anchors.has(territoryPatrolGroupKey(site))) continue;
        const anchor = byCell.get(site.cellId);
        for (const cell of site.footprint) {
            if (!byCell.has(cell)) byCell.set(cell, anchor);
        }
    }
    return byCell;
}

/**
 * 巡逻路线组：**同一片巡逻区**（同一个 `site.id`）的全部巡逻格（footprint 并集）。
 *
 * 与 {@link territoryPatrolGroupKey} 同口径；绑关卡也读同一片。
 */
function territoryRouteCells(sites: readonly TerritorySite[]): ReadonlyMap<string, ReadonlySet<number>> {
    const cellsByGroup = new Map<string, Set<number>>();
    for (const site of sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        const key = territoryPatrolGroupKey(site);
        let cells = cellsByGroup.get(key);
        if (!cells) {
            cells = new Set<number>();
            cellsByGroup.set(key, cells);
        }
        for (const cell of site.footprint) cells.add(cell);
    }
    return cellsByGroup;
}

/**
 * 巡逻野怪：**一片巡逻区**（同 `site.id`）的格子全部开启后，从填了 `patrolId` 的格子出发，
 * 在这片区域的格子内往返（分片口径见 {@link territoryRouteCells}）。
 *
 * 2026-11-20 口径：「已经通过的巡逻宝箱野怪，会继续展示移动，样式要去掉颜色叠暗和
 * 红色描边」。⇒ **通关只改表现，不再决定生灭**：本函数只看「片区内格子全部开启」
 * 这一个可见性前置，战斗通过与否一概不过滤；`territoryPatrolPassedCells` 交给发布帧，
 * 由 `TerritoryMonsterPatrolView.applyLook` 把该片的怪写成原色并收起描边副本，
 * 同时 `paintHexes` 用它把地块转草地 / 摘红框。
 *
 * 🔴 别把「已通过」重新写回来当生灭判据：那会让通关片区变成一片空草地，
 * 用户要的是「怪还在走、只是不再像敌人」。
 */
export function buildTerritoryMonsterPatrols(
    map: TerritoryMapConfig,
    progress: { isCellUnlocked(cellId: number): boolean; isOwned(cellId: number): boolean },
): readonly ITerritoryMonsterPatrol[] {
    const cellsByGroup = territoryRouteCells(map.sites);
    const patrols: ITerritoryMonsterPatrol[] = [];
    for (const site of map.sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest || !site.patrolId) continue;
        const cells = cellsByGroup.get(territoryPatrolGroupKey(site));
        if (!cells) continue;
        let allUnlockedOrOwned = true;
        for (const cell of cells) {
            if (!progress.isCellUnlocked(cell) && !progress.isOwned(cell)) {
                allUnlockedOrOwned = false;
                break;
            }
        }
        if (!allUnlockedOrOwned) continue;
        const route = [site.cellId];
        const visited = new Set(route);
        const visit = (cellId: number): void => {
            for (const neighbor of territoryNeighbors(cellId, map)) {
                if (!cells.has(neighbor) || visited.has(neighbor)) continue;
                visited.add(neighbor);
                route.push(neighbor);
                visit(neighbor);
                route.push(cellId);
            }
        };
        visit(site.cellId);
        if (route.length > 1) route.pop();
        patrols.push({ cellId: site.cellId, monsterId: site.patrolId, route });
    }
    return patrols;
}
