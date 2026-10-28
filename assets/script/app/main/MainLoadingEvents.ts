/** 主界面预加载的状态通知；路由参数只承载入口数据。 */
export const MAIN_LOADING_EVENTS = {
    PROGRESS: 'main-loading:progress',
    FAILED: 'main-loading:failed',
} as const;

export interface IMainLoadingProgress {
    readonly ratio: number;
    readonly message: string;
}
