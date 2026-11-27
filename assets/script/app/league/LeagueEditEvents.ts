export const LeagueEditEvent = {
    Intent: 'league-edit:intent',
    Output: 'league-edit:output',
} as const;

/** change 同步草稿，submit 提交当前输入原文。 */
export interface ILeagueEditIntent {
    readonly kind: 'change' | 'submit';
    readonly content: string;
}

export interface ILeagueEditViewState {
    readonly content: string;
    readonly submitting: boolean;
}

/** 来源为产生输出的联盟编辑控制器。 */
export type LeagueEditOutput =
    | { readonly kind: 'render'; readonly state: ILeagueEditViewState }
    | { readonly kind: 'tip'; readonly text: string }
    | { readonly kind: 'close' };
