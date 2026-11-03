import type { TerritoryModelOutput } from './TerritoryModel';
import type { ITerritoryRenderState } from './TerritoryViewState';

export const TerritoryUiEvent = {
    Intent: 'territory:ui-intent', Ready: 'territory:view-ready', Disposed: 'territory:view-disposed',
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
