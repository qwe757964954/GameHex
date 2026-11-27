export const MainTabEvent = {
    Warmup: 'main-tab:warmup',
    Select: 'main-tabs:select',
    Output: 'main-tabs:output',
} as const;

/** 底栏用户点击；owner 为宿主实例，程序跳转以 source=route 派发，不产生点击上报。 */
export interface IMainTabSelectEvent {
    readonly tab: number;
    readonly source?: 'route';
}

export type MainTabOutput<T = unknown> =
    | { readonly kind: 'showPage'; readonly tab: number; readonly page: T }
    | { readonly kind: 'renderNav'; readonly tab: number }
    | { readonly kind: 'failed'; readonly tab: number; readonly error: unknown };
