export const LeagueEditEvent = { Intent: 'league-edit:intent' } as const;

/** owner 限定本次编辑页面；change 同步草稿，submit 提交当前输入原文。 */
export interface ILeagueEditIntent {
    readonly owner: object;
    readonly kind: 'change' | 'submit';
    readonly content: string;
}

export interface ILeagueEditViewState {
    readonly content: string;
    readonly submitting: boolean;
}
