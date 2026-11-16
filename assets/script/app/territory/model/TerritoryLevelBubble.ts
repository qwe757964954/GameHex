import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';

/**
 * 站点气泡文案的唯一来源（纯函数，零 cc）。
 *
 * 气泡与前置提示共用这一处，避免编号在不同层各拼一遍。
 */

/**
 * 异步据点的气泡文案。
 *
 * 异步据点可重复挑战，统一写 PVP 而不是关卡编号；判定必须排在编号之前。
 */
export const TERRITORY_ASYNC_PVP_BUBBLE_TEXT = 'PVP';

/** 未通关 PVP 复用玩家头像与红色九宫格气泡，通关后恢复原编号牌。 */
export const TERRITORY_PVP_BUBBLE_PORTRAIT_PATH = 'icons/head/icon_hero_head_40018/spriteFrame';
export const TERRITORY_PVP_BUBBLE_WIDTH = 60;
export const TERRITORY_PVP_BUBBLE_HEIGHT = 66;
export const TERRITORY_PVP_BUBBLE_PORTRAIT_SIZE = 46;
export const TERRITORY_PVP_BUBBLE_PORTRAIT_Y = 3;

/** 算文案只需要站点类型 / 是否绑了关卡，收窄到这两个字段就不必拖整个站点对象。 */
export type TerritoryBubbleSite = Pick<TerritorySite, 'type'>;

/**
 * 这一格气泡上写什么；`undefined` 表示不显示气泡。
 *
 * `asyncPvp` 写 PVP；绑了关卡写 `章节-关卡`；其余交给各自的提示。
 */
export function territoryLevelBubbleText(
    site: TerritoryBubbleSite | null | undefined,
    stage: TerritoryCampaignStage | null | undefined,
): string | undefined {
    if (site?.type === TERRITORY_SITE_TYPE.asyncPvp) return TERRITORY_ASYNC_PVP_BUBBLE_TEXT;
    if (!stage) return undefined;
    return `${stage.chapterId}-${stage.stage}`;
}
