import type { ILeagueUnionView } from './LeagueTable';

export const LeagueJoinEvent = { Intent: 'league-join:intent' } as const;

/**
 * 加入联盟页的一次会话意图。
 *
 * `openUnion` 直接带行视图对象（列表行 → 详情的同一份不可变数据），
 * 不带任何回调或控制器引用。
 */
export type ILeagueJoinIntent =
    | { readonly kind: 'input'; readonly text: string }
    | { readonly kind: 'search' }
    | { readonly kind: 'quickJoin' }
    | { readonly kind: 'create' }
    | { readonly kind: 'openUnion'; readonly union: ILeagueUnionView };

/** 视图只负责把控制器算好的行铺到列表上（延迟一帧由视图自己处理）。 */
export interface ILeagueJoinView {
    readonly render: (rows: readonly ILeagueUnionView[]) => void;
}
