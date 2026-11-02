export const MainTabEvent = { Warmup: 'main-tab:warmup', Select: 'main-tabs:select' } as const;

/** 底栏用户点击；owner 为宿主实例，程序跳转以 source=route 派发，不产生点击上报。 */
export interface IMainTabSelectEvent {
    readonly owner: object;
    readonly tab: number;
    readonly source?: 'route';
}
