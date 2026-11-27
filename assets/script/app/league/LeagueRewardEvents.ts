import type { LeagueRequestResult } from './LeagueRepository';

export const LeagueRewardEvent = {
    Intent: 'league-reward:intent',
    Output: 'league-reward:output',
    Completed: 'league-reward:completed',
} as const;

/** 来源为产生输出的联盟奖励控制器。 */
export type LeagueRewardOutput = {
    readonly kind: 'reward';
    readonly rewards: CmdGoods[];
};

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
