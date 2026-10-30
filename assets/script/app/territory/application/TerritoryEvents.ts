import type { TerritoryModelOutput } from './TerritoryModel';
import type { ITerritoryRenderState } from './TerritoryViewState';

export const TerritoryUiEvent = {
    Intent: 'territory:ui-intent', Ready: 'territory:view-ready', Disposed: 'territory:view-disposed',
} as const;
export const TerritoryViewEvent = { Render: 'territory:render', Command: 'territory:view-command' } as const;
export type TerritoryIntent =
    | { readonly kind: 'siteTap' | 'randomTap'; readonly cellId: number }
    | { readonly kind: 'chapter'; readonly offset: number }
    | { readonly kind: 'battle' | 'closeDetail' | 'openLevelTip' | 'closeLevelTip' | 'scout' | 'focusBoss' };
export interface ITerritoryIntentEvent { readonly intent: TerritoryIntent }
export type TerritoryViewCommand = Exclude<TerritoryModelOutput, { readonly kind: 'changed' }>
    | { readonly kind: 'focusCell'; readonly cellId: number }
    | { readonly kind: 'prepareBattle' };
export interface ITerritoryCommandEvent { readonly command: TerritoryViewCommand }
export interface ITerritoryRenderEvent { readonly state: ITerritoryRenderState }

export type { ITerritoryRewardPresentation, ITerritoryDetailState, ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent, ITerritoryNavigateBattlePayload, ITerritoryPlayerStageContent,
    ITerritoryShowRewardsPayload, ITerritoryShowTipPayload, ITerritorySetBusyPayload } from './TerritoryModel';
