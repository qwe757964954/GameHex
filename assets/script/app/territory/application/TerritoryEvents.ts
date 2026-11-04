import type { TerritoryModelOutput } from './TerritoryModel';
import type { ITerritoryRenderState } from './TerritoryViewState';

export const TerritoryUiEvent = {
    Intent: 'territory:ui-intent', Ready: 'territory:view-ready', Disposed: 'territory:view-disposed',
    /**
     * 章节入口（地图起始格的章节建筑 / 它头上的「章节」气泡）点了 ⇒ 宿主页开章节选择弹窗。
     *
     * 🔴 这一条**必须有名字**：`TerritoryStationView` 发它、`MainPage` 订阅它，谁都不知道对方。
     *    少了这个键两边都拿 `undefined` 当事件名 —— `emit` / `on` 恰好都落在同一个空键上，
     *    功能看着还能用，实际是「两条无关的 undefined 撞在一起」，加任何第三个事件就崩。
     */
    ChapterSelect: 'territory:chapter-select',
} as const;
export const TerritoryViewEvent = { Render: 'territory:render', Command: 'territory:view-command' } as const;
export type TerritoryIntent =
    | { readonly kind: 'siteTap' | 'randomTap'; readonly cellId: number }
    | { readonly kind: 'enterBattle'; readonly payload: import('./TerritoryModel').ITerritoryNavigateBattlePayload }
    | { readonly kind: 'chapter'; readonly offset: number }
    | { readonly kind: 'battle' | 'closeDetail' | 'openLevelTip' | 'closeLevelTip' | 'scout' | 'focusLevel'
        /** 整页过场接手开战：此后程序关掉详情不作废在途开战请求（见 `TerritoryModel.battleHandoff`）。 */
        | 'keepBattleRequest'
        /** 战斗流程没接手 ⇒ 复位在途开战态，别让「开始战斗」变成死按钮。 */
        | 'cancelBattleStart' };
export interface ITerritoryIntentEvent { readonly intent: TerritoryIntent }
export type TerritoryViewCommand = Exclude<TerritoryModelOutput, { readonly kind: 'changed' | 'navigate' }>
    | { readonly kind: 'navigate'; readonly payload: import('./TerritoryModel').ITerritoryNavigateBattlePayload; readonly ready?: Promise<unknown> }
    | { readonly kind: 'focusCell'; readonly cellId: number }
    | { readonly kind: 'prepareBattle' };
export interface ITerritoryCommandEvent { readonly command: TerritoryViewCommand }
export interface ITerritoryRenderEvent { readonly state: ITerritoryRenderState }

export type { ITerritoryRewardPresentation, ITerritoryDetailState, ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent, ITerritoryNavigateBattlePayload, ITerritoryPlayerStageContent,
    ITerritoryShowRewardsPayload, ITerritoryShowTipPayload, ITerritorySetBusyPayload } from './TerritoryModel';
