export const LeagueTabEvent = {
    /** 入盟或创建成功后，由当前联盟容器控制器重新读取缓存。 */
    Joined: 'league-tab:joined',
    Refresh: 'league-tab:refresh',
    Output: 'league-tab:output',
} as const;

export type LeagueTabOutput =
    | { readonly kind: 'page'; readonly joined: boolean }
    | { readonly kind: 'failed'; readonly error: unknown };
