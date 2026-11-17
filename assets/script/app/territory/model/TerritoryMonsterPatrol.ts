import { TERRITORY_SITE_TYPE, territoryNeighbors } from './TerritoryMapConfig';
import type { TerritoryMapConfig, TerritorySite } from './TerritoryMapConfig';

export const TERRITORY_MONSTER_PATROL_STEP_MS = 1600;

export interface ITerritoryMonsterPatrol {
    readonly cellId: number;
    readonly monsterId: number;
    readonly route: readonly number[];
}

/**
 * 战斗组键：**同一片巡逻区域**。
 *
 * 编辑器给每个巡逻格单独编号（`patrolChest_154` / `_155`…），`site.id` 只表达
 * 「巡逻路线连通的一组格」，不能拿来分战斗 —— 拿它分会变成「每格一组」，
 * 下标恒为 0、`battleIds` 的第二场（难度 2）永远不生效。
 * 一片区域的实际标识是「同一份 `battleIds` + 同一份前置格」：chapter_01 的
 * `[60001,60002] | [347]`、`[60003,60004] | [310]` 等五片正好各成一组。
 */
function territoryBattleGroupKey(site: TerritorySite): string {
    return `${site.battleIds?.join(',') ?? ''}|${site.unlock.requiredCells.join(',')}`;
}

/**
 * 逐格分配战斗：区域组内按 `cellId` 升序，第 `i` 格取 `battleIds[i % length]`。
 *
 * 配置里每组是「难度1 / 难度2」两场（`60001` / `60002`），这样摊开后同区两场都会
 * 落在具体格子上，而不是永远只用到第一个。
 */
function territoryBattleByCell(map: TerritoryMapConfig): ReadonlyMap<number, number> {
    const groups = new Map<string, TerritorySite[]>();
    for (const site of map.sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        const key = territoryBattleGroupKey(site);
        const list = groups.get(key);
        if (list) list.push(site);
        else groups.set(key, [site]);
    }
    const battleByCell = new Map<number, number>();
    for (const sites of groups.values()) {
        const ordered = sites.slice().sort((a, b) => a.cellId - b.cellId);
        for (const [index, site] of ordered.entries()) {
            const battleIds = site.battleIds;
            if (!battleIds?.length) continue;
            battleByCell.set(site.cellId, battleIds[index % battleIds.length]);
        }
    }
    return battleByCell;
}

/** 巡逻路线组：同一个 `site.id` 的全部巡逻格（footprint 并集）。 */
function territoryRouteCells(map: TerritoryMapConfig): ReadonlyMap<string, ReadonlySet<number>> {
    const cellsById = new Map<string, Set<number>>();
    for (const site of map.sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest) continue;
        let cells = cellsById.get(site.id);
        if (!cells) {
            cells = new Set<number>();
            cellsById.set(site.id, cells);
        }
        for (const cell of site.footprint) cells.add(cell);
    }
    return cellsById;
}

/**
 * 巡逻野怪：组内格子全部开启后，从填了 `patrolId` 的格子出发，在本组格内往返。
 *
 * 生灭判据是**战斗 id**（与关卡同口径），不是单项占点：
 * - 区域组内按 `cellId` 升序把 `battleIds` 依次摊到各格（见 `territoryBattleByCell`）；
 * - 同一场战斗（同 battleId）的格子**共享通过状态** —— 任一格已占点即整片通过，
 *   与 `TerritoryProgress.isAreaPassed` 的区域口径一致；
 * - 该格战斗已通过 ⇒ 不再生成这只巡逻野怪（玩家打掉了这组敌人）。
 *
 * 「组内格子全部开启」仍保留为前置：它是**可见性**条件，未揭示的格子被云层盖着，
 * 提前出怪会直接穿帮。战斗判定决定的是「已经在巡逻的怪什么时候消失」。
 */
export function buildTerritoryMonsterPatrols(
    map: TerritoryMapConfig,
    progress: { isCellUnlocked(cellId: number): boolean; isOwned(cellId: number): boolean },
): readonly ITerritoryMonsterPatrol[] {
    const battleByCell = territoryBattleByCell(map);
    // 已通过的战斗：同 id 的格子任一格占点即算通过（关卡的区域共享同口径）。
    const passed = new Set<number>();
    for (const [cellId, battleId] of battleByCell) {
        if (progress.isOwned(cellId)) passed.add(battleId);
    }
    const cellsById = territoryRouteCells(map);
    const patrols: ITerritoryMonsterPatrol[] = [];
    for (const site of map.sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest || !site.patrolId) continue;
        const cells = cellsById.get(site.id);
        if (!cells) continue;
        if (!Array.from(cells).every(cell => progress.isCellUnlocked(cell) || progress.isOwned(cell))) continue;
        const battleId = battleByCell.get(site.cellId);
        if (battleId !== undefined && passed.has(battleId)) continue;
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
