import type { TerritorySite } from './TerritoryMapConfig';
import { TERRITORY_SITE_TYPE } from './TerritoryMapConfig';
import type { TerritoryCampaignStage } from './TerritoryCampaignConfig';

/**
 * 站点气泡里的**文案真源**（零 cc 纯函数）。
 *
 * 为什么值得单独一个文件（2026-11-02）：玩家点一个还不能解锁的格子时，提示要说清楚
 * 「卡在哪一块」—— 需求写的是「关卡地块提示关卡的名字，**名字同气泡文案**」。
 * 如果气泡在视图里拼 `${chapterId}-${stage}`、提示在 application 层再拼一遍，
 * 两边迟早各改一半（异步据点就是活例子：气泡写 `PVP`，拼编号就会写成 `2-4`，
 * 而地图上根本没有那个编号）。
 *
 * ⇒ 气泡怎么显示，这里就怎么算；`TerritoryMapView` 与本提示**都只调这一个函数**。
 */

/**
 * 异步据点的气泡文案。
 *
 * 🔴 它可重复挑战，编号会被读成"第 4 关，打一次就过"，统一写 `PVP`
 * （2026-10-28 山猫）。判定必须排在编号**之前**：异步据点也绑了 `stage`（`configId` 2000x），
 * 先算编号的话只有"没绑关卡"的异步据点才会变，看起来像没改。
 */
export const TERRITORY_ASYNC_PVP_BUBBLE_TEXT = 'PVP';

/** 算文案只需要站点类型 / 是否绑了关卡，收窄到这两个字段就不必拖整个站点对象。 */
export type TerritoryBubbleSite = Pick<TerritorySite, 'type'>;

/**
 * 这一格气泡上写什么；`undefined` = 这一格不显示气泡（与 `ITerritoryStationRender.levelBubble`
 * 的可选语义一致 —— 别改成 `null`，`renderLevelBubble` 用 `?? ''` 兜底、测试用 `undefined` 断言）。
 *
 *  · `asyncPvp` ⇒ `PVP`（不看有没有 `stage`，理由见 {@link TERRITORY_ASYNC_PVP_BUBBLE_TEXT}）；
 *  · 绑了关卡 ⇒ `章节-关卡`（美术稿是 `1-1`，连字符两侧**不留空格**：间距由
 *    `MAP_MARKER_BADGE_SPACING_X` 控，字符串里塞空格会跟着字号/字体漂）；
 *  · 其余（`fixedResource` / 装饰 / 没绑关卡的格）⇒ `undefined`，由各自的提示承担。
 */
export function territoryLevelBubbleText(
    site: TerritoryBubbleSite | null | undefined,
    stage: TerritoryCampaignStage | null | undefined,
): string | undefined {
    if (site?.type === TERRITORY_SITE_TYPE.asyncPvp) return TERRITORY_ASYNC_PVP_BUBBLE_TEXT;
    if (!stage) return undefined;
    return `${stage.chapterId}-${stage.stage}`;
}
