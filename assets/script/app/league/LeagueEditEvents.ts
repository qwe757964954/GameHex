export const LeagueEditEvent = { Intent: 'league-edit:intent' } as const;

/** change 同步草稿，submit 提交当前输入原文。 */
export interface ILeagueEditIntent {
    readonly kind: 'change' | 'submit';
    readonly content: string;
}

export interface ILeagueEditViewState {
    readonly content: string;
    readonly submitting: boolean;
}
