import type { ILeagueDonateSnapshot } from './LeagueRepository';

export const LeagueDonateEvent = {
    Intent: 'league-donate:intent',
    Output: 'league-donate:output',
} as const;

/**
 * 一次捐献弹窗会话的意图。
 *
 * 三种意图都不带回调；`confirmCoin` 由确认弹窗确定后派发。
 */
export type ILeagueDonateIntent =
    | { readonly kind: 'free' }
    | { readonly kind: 'coin' }
    | { readonly kind: 'confirmCoin' };

export interface ILeagueDonateViewState {
    /** 首屏读快照未回来时为 `null`，视图保持 prefab 静态稿。 */
    readonly snapshot: ILeagueDonateSnapshot | null;
    /** 写请求在飞（防连点）。 */
    readonly busy: boolean;
}

/** 来源为产生输出的联盟捐献控制器。 */
export type LeagueDonateOutput =
    | { readonly kind: 'render'; readonly state: ILeagueDonateViewState }
    | { readonly kind: 'tip'; readonly text: string }
    | { readonly kind: 'reward'; readonly goods: CmdGoods[] }
    | { readonly kind: 'confirm'; readonly content: string };
