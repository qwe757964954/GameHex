import type { ILeagueCostView } from './LeagueTable';

export const LeagueCreateEvent = {
    Intent: 'league-create:intent',
    Output: 'league-create:output',
} as const;

/**
 * 一次创建弹窗会话的意图。
 *
 * 意图只带输入原文、下标或勾选态，
 * **不带回调、不带控制器引用**（见 `docs/agent/MVC设计规范.md`）。
 */
export type ILeagueCreateIntent =
    | { readonly kind: 'name'; readonly name: string }
    | { readonly kind: 'banner'; readonly index: number }
    | { readonly kind: 'quickJoin'; readonly quickJoin: boolean }
    | { readonly kind: 'submit'; readonly name: string; readonly quickJoin: boolean };

/** 控制器推给视图的首屏 / 每次状态变化；视图只按它绝对赋值。 */
export interface ILeagueCreateViewState {
    readonly name: string;
    readonly selectIndex: number;
    readonly quickJoin: boolean;
    /** 首屏读表未回来时为 `null`，此时视图不动消耗项。 */
    readonly cost: ILeagueCostView | null;
    readonly submitting: boolean;
}

/** 来源为产生输出的联盟创建控制器。 */
export type LeagueCreateOutput =
    | { readonly kind: 'render'; readonly state: ILeagueCreateViewState }
    | { readonly kind: 'tip'; readonly text: string }
    | { readonly kind: 'close' }
    | { readonly kind: 'joined' };
