export const LeagueTabEvent = { Joined: 'league-tab:joined', Refresh: 'league-tab:refresh' } as const;
/** 入盟或创建成功后的通知，由当前联盟容器控制器重新读取缓存。 */
export interface ILeagueJoinedEvent { readonly owner: object; }
