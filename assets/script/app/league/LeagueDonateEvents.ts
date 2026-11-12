import type { ILeagueDonateSnapshot } from './LeagueRepository';

export const LeagueDonateEvent = { Intent: 'league-donate:intent' } as const;

/**
 * 一次捐献弹窗会话的意图。
 *
 * `owner` 限定本次打开的页面；两种意图都不带参数 —— 次数、钱够不够、
 * 勾选态等业务判断全在 Controller / Model，视图只负责报「点了哪颗按钮」。
 */
export type ILeagueDonateIntent =
    | { readonly owner: object; readonly kind: 'free' }
    | { readonly owner: object; readonly kind: 'coin' };

export interface ILeagueDonateViewState {
    /** 首屏读快照未回来时为 `null`，视图保持 prefab 静态稿。 */
    readonly snapshot: ILeagueDonateSnapshot | null;
    /** 写请求在飞（防连点）。 */
    readonly busy: boolean;
}
