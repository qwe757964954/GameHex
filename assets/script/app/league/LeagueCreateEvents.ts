import type { ILeagueCostView } from './LeagueTable';

export const LeagueCreateEvent = { Intent: 'league-create:intent' } as const;

/**
 * 一次创建弹窗会话的意图。
 *
 * `owner` 限定本次打开的页面；意图只带输入原文 / 下标 / 勾选态，
 * **不带回调、不带控制器引用**（见 `docs/agent/MVC设计规范.md`）。
 */
export type ILeagueCreateIntent =
    | { readonly owner: object; readonly kind: 'name'; readonly name: string }
    | { readonly owner: object; readonly kind: 'banner'; readonly index: number }
    | { readonly owner: object; readonly kind: 'quickJoin'; readonly quickJoin: boolean }
    | { readonly owner: object; readonly kind: 'submit'; readonly name: string; readonly quickJoin: boolean };

/** 控制器推给视图的首屏 / 每次状态变化；视图只按它绝对赋值。 */
export interface ILeagueCreateViewState {
    readonly name: string;
    readonly selectIndex: number;
    readonly quickJoin: boolean;
    /** 首屏读表未回来时为 `null`，此时视图不动消耗项。 */
    readonly cost: ILeagueCostView | null;
    readonly submitting: boolean;
}
