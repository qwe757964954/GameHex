import type { LeagueRequestResult } from './LeagueRepository';

export const LeagueRewardEvent = { Intent: 'league-reward:intent', Completed: 'league-reward:completed' } as const;

export type LeagueRewardAction =
    | { readonly kind: 'store'; readonly id: number }
    | { readonly kind: 'bargain'; readonly buy: boolean }
    | { readonly kind: 'task'; readonly resId: number }
    | { readonly kind: 'progress'; readonly subType: number }
    | { readonly kind: 'sweep' };

export interface ILeagueRewardIntent {
    readonly action: LeagueRewardAction;
}

export interface ILeagueRewardCompletion {
    readonly status: LeagueRequestResult;
}
