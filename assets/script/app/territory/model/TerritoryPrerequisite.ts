import { TERRITORY_TEXTS } from '../application/TerritoryTexts';
import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritorySite } from './TerritoryMapConfig';
import { isTerritoryChestSite } from './TerritoryMapConfig';
import { territoryLevelBubbleText } from './TerritoryLevelBubble';

/**
 * 前置未满足时的提示文案（纯函数，零 cc）。
 *
 * 关卡格提示关卡名，格式与气泡一致；宝箱格提示前置宝箱未打开。
 * 只报配置顺序里的第一个能命名的前置，避免 toast 过长。
 */

/** 一个未满足前置格的画像。 */
export interface ITerritoryPrerequisiteBlocker {
    readonly cellId: number;
    /** 这一格是不是宝箱（`fixedResource` / `patrolChest`）。 */
    readonly isChest: boolean;
    /** 这一格的气泡文案（`1-1` / `PVP`）；`undefined` = 没有编号可说（普通地块 / 装饰）。 */
    readonly label: string | undefined;
}

/**
 * 拼成一句提示，只看第一个能命名的前置。
 *
 * 返回空串表示一个都叫不出名字，调用方退回通用文案。
 */
export function territoryPrerequisiteBlockText(
    blockers: readonly ITerritoryPrerequisiteBlocker[],
): string {
    for (const blocker of blockers) {
        if (blocker.isChest) return TERRITORY_TEXTS.prerequisiteChestLocked;
        if (blocker.label) return TERRITORY_TEXTS.prerequisiteStageLocked(blocker.label);
    }
    return '';
}

/**
 * 把未满足的前置格翻成玩家可读的提示。
 *
 * 未满足的格由调用方给出，这里按 footprint 找回站点，再用气泡文案命名；
 * 返回空串表示无法命名。
 */
export function territoryPrerequisiteText(
    blockerCellIds: readonly number[],
    sites: readonly TerritorySite[],
    stageByCell: ReadonlyMap<number, TerritoryCampaignStage>,
): string {
    const blockers: ITerritoryPrerequisiteBlocker[] = [];
    for (let i = 0; i < blockerCellIds.length; i++) {
        const cellId = blockerCellIds[i];
        let site: TerritorySite | null = null;
        for (let j = 0; j < sites.length; j++) {
            if (sites[j].footprint.includes(cellId)) {
                site = sites[j];
                break;
            }
        }
        // 关卡绑定挂在**站点**格上；前置格可能是同一站点的另一格（`footprint`），两级都查。
        const stage = stageByCell.get(cellId)
            ?? (site ? stageByCell.get(site.cellId) : undefined);
        blockers.push({
            cellId,
            isChest: !!site && isTerritoryChestSite(site),
            label: territoryLevelBubbleText(site, stage),
        });
    }
    return territoryPrerequisiteBlockText(blockers);
}
