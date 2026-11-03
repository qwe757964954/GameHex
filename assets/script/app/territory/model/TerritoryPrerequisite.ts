import { TERRITORY_TEXTS } from '../application/TerritoryTexts';
import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';
import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import { territoryLevelBubbleText } from './TerritoryLevelBubble';

/**
 * 「前置没满足」的提示文案（零 cc 纯函数）。
 *
 * 需求（2026-11-02 用户，截图里那条「前置领地尚未占领」太笼统）：
 *  · **关卡地块**提示**关卡的名字**，格式 `【数字-数字 关卡通关后解锁】`，
 *    **名字同气泡文案**（`1-1` / `PVP`，真源在 `model/TerritoryLevelBubble`）；
 *  · **宝箱地块**提示 `【前置宝箱未打开】`，并让那只宝箱播跳动动画（视图侧 `playChestHint`）。
 *
 * ## 只报**第一个**
 *
 *  一张图的 `requiredCells` 可以是 **1~5 个**（`chapter_01` 实测最长 5 个，且多为宝箱），
 *  全列出来 toast 会跨两行压住地图。用户 2026-11-02 定口径：**只报清单里的第一个**
 *  （顺序 = 配置里 `requiredCells` 的书写顺序 = 编辑器连线顺序，`prerequisiteBlockers`
 *  原样保留，不排序）。玩家顺着提示做掉一个，再点一次自然会看到下一个，
 *  比一句"1-1、1-2、1-3 关卡通关后解锁，前置宝箱未打开"好读得多。
 *
 *  挑第一个**叫得出名字**的：纯地块前置（不属于任何站点）念不出来，跳过它看下一个；
 *  一个都叫不出名字 ⇒ 空串，调用方退回「前置领地尚未占领」。
 */

/** 一个「未满足的前置格」的画像 —— 由调用方查表填好，本文件不认识地图与进度。 */
export interface ITerritoryPrerequisiteBlocker {
    readonly cellId: number;
    /** 这一格是不是固定奖励宝箱（`fixedResource`）。 */
    readonly isChest: boolean;
    /** 这一格的气泡文案（`1-1` / `PVP`）；`undefined` = 没有编号可说（普通地块 / 装饰）。 */
    readonly label: string | undefined;
}

/**
 * 拼成一句提示（**只看第一个能命名的前置**）。
 *
 *  宝箱 ⇒ `前置宝箱未打开`；关卡 ⇒ `1-1 关卡通关后解锁`；
 *  返回空串 = 一个都叫不出名字，调用方要退回通用文案。
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
 * 一步到位：把「还没满足的前置格」翻成玩家看得懂的那句话。
 *
 * 三件事必须同源，缺一条就会出现"提示说的和地图上画的不一样"：
 *  ① **哪几格没满足** ← 调用方给（`TerritoryProgress.prerequisiteBlockers`，与拦截判据同源）；
 *  ② **那几格是什么** ← 按 `footprint` 找回站点（宝箱 = `fixedResource`）；
 *  ③ **叫什么名字** ← `territoryLevelBubbleText`（**就是气泡上那几个字**，异步据点
 *     因此是 `PVP` 而不是 `2-4` —— 见 `model/TerritoryLevelBubble`）。
 *
 * 返回空串 = 一个都叫不出名字（前置是不属于任何站点的普通地块），调用方退回通用文案。
 */
export function territoryPrerequisiteText(
    blockerCellIds: readonly number[],
    sites: readonly TerritorySite[],
    stageByCell: ReadonlyMap<number, TerritoryCampaignStage>,
): string {
    const blockers: ITerritoryPrerequisiteBlocker[] = blockerCellIds.map((cellId) => {
        const site = sites.find((candidate) => candidate.footprint.includes(cellId)) ?? null;
        // 关卡绑定挂在**站点**格上；前置格可能是同一站点的另一格（`footprint`），两级都查。
        const stage = stageByCell.get(cellId)
            ?? (site ? stageByCell.get(site.cellId) : undefined);
        return {
            cellId,
            isChest: site?.type === TERRITORY_SITE_TYPE.fixedResource,
            label: territoryLevelBubbleText(site, stage),
        };
    });
    return territoryPrerequisiteBlockText(blockers);
}
