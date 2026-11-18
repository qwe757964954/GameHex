import { TERRITORY_SITE_TYPE, territoryNeighbors } from './TerritoryMapConfig';
import type { TerritoryMapConfig, TerritorySite } from './TerritoryMapConfig';

export const TERRITORY_MONSTER_PATROL_STEP_MS = 1600;

export interface ITerritoryMonsterPatrol {
    readonly cellId: number;
    readonly monsterId: number;
    readonly route: readonly number[];
}

/**
 * 一片巡逻区的键：**`site.id`**。
 *
 * 2026-11-18 口径（山猫）：「巡逻宝箱之前根据战斗 id 判断，现在改由巡逻宝箱 id 相同」——
 * 同 `site.id` 就是同一片，`battleId` / `requiredCells` **不参与**分组。
 * 配置侧同步把同片格子刷成同一个 `site.id`（chapter_01 五片各一个 id），
 * 编辑器读图时按同一口径分组。
 *
 * 为什么不能拿 `battleId` 当分组键：一片只配一个战斗，数值写歪一格就把它拆成两片 ⇒
 * 那片 `route.length === 1` ⇒ 野怪永远站着不动（且零报错）。
 */
function territoryPatrolGroupKey(site: TerritorySite): string {
    return site.id;
}

/**
 * 逐格战斗 ID：每一格 `cellId → battleId`。
 *
 * 一片巡逻区共用同一个 `battleId`（{@link TERRITORY_SITE_TYPE.patrolChest} 的字段），
 * 2026-11-18 起不再有「数组池按下标摊分」—— 配置里一直只填一个值，
 * 摊分只会让「同片数值不一致」变成静默拆片。
 *
 * `battleId` 就是 `levelInfo.levelId`（`levelType=4 / levelMod=2 / chapterStage=0` 的
 * 巡逻野怪关）：**开战参数按格子 id 发**（`chapterCellBattleParams`），这一份映射只用于
 * 「这一格打哪一场」—— 绑关卡行（`TerritoryStageBinding`）与野怪停巡判据都读它。
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
 * 这一片巡逻区上报后端用的格子：同 `site.id` 组里**带 `patrolId` 的那一格**。
 *
 * 怪物配置（`monsterCard.id`）绑在那一格上，服务端按 `cellId` 找配置 ⇒
 * 「同片任一格命中，都把带怪物 id 的格子传给后端」（2026-11-18 口径）：
 * 解锁与开战都用它。没有 `patrolId` 的旧图退回这一格自己。
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

/**
 * 巡逻路线组：**同一片巡逻区**（同一个 `site.id`）的全部巡逻格（footprint 并集）。
 *
 * 与 {@link territoryPatrolGroupKey} 同口径；停巡判据与绑关卡也读同一片。
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
 * 生灭判据是**战斗 id**（与关卡同口径），不是单项占点：
 * - 一片巡逻区（同 `site.id`）共用同一个 `battleId`（见 `territoryPatrolBattleByCell`）；
 * - 同一场战斗（同 battleId）的格子**共享通过状态** —— 任一格已占点即整片通过，
 *   与 `TerritoryProgress.isAreaPassed` 的区域口径一致；
 * - 该场战斗已通过 ⇒ 不再生成这只巡逻野怪（玩家打掉了这组敌人）。
 *
 * 「片区内格子全部开启」仍保留为前置：它是**可见性**条件，未揭示的格子被云层盖着，
 * 提前出怪会直接穿帮。战斗判定决定的是「已经在巡逻的怪什么时候消失」。
 */
export function buildTerritoryMonsterPatrols(
    map: TerritoryMapConfig,
    progress: { isCellUnlocked(cellId: number): boolean; isOwned(cellId: number): boolean },
): readonly ITerritoryMonsterPatrol[] {
    const battleByCell = territoryPatrolBattleByCell(map.sites);
    // 已通过的战斗：同 id 的格子任一格占点即算通过（关卡的区域共享同口径）。
    const passed = new Set<number>();
    for (const [cellId, battleId] of battleByCell) {
        if (progress.isOwned(cellId)) passed.add(battleId);
    }
    const cellsByGroup = territoryRouteCells(map.sites);
    const patrols: ITerritoryMonsterPatrol[] = [];
    for (const site of map.sites) {
        if (site.type !== TERRITORY_SITE_TYPE.patrolChest || !site.patrolId) continue;
        const cells = cellsByGroup.get(territoryPatrolGroupKey(site));
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
