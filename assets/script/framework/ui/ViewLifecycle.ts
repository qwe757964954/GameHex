/** 页面仅报告生命周期；外部组合对象据此启动、暂停或释放该页控制器。 */
export const VIEW_LIFECYCLE = 'ui:view-lifecycle';
export interface IViewLifecycle {
    readonly owner: object;
    readonly phase: 'ready' | 'enabled' | 'disabled' | 'destroyed' | 'presented';
}
