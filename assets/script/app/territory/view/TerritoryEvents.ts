/**
 * 领地视图间的事件契约（事件名即字符串常量，`grep TERRITORY_EVENTS.X` 即可追完整链路）。
 *
 * 跨组件通知统一走 **Cocos 节点事件**（`node.on` / `node.emit`），不引入全局事件中心：
 *
 * - 监听挂在**组件自身节点**上，随节点销毁自动清理（页面子树一毁全清，无退订泄漏面）；
 * - 事件名集中在常量表，改契约 = 改常量 + 编译报错，不会像裸回调那样静默断链；
 * - 依赖方向：节点事件只有 `app/territory/view` 内部消费；下方 `TERRITORY_PRESENTER_EVENTS`
 *   是逻辑层状态事件（走 `EventMgr`），`Presenter`（纯 TS）只读本表的字符串常量、不碰节点。
 *
 * 站点点击是**两层转发**：`TerritoryStationView` 在自己节点上发 →
 * `TerritoryMapView` 在站点节点上监听、再转发到 `mapView.node` →
 * 页面在 `mapView.node` 上收。转发层是刻意保留的：`MapLayer`（`mapView.node`）是
 * 全部站点节点的聚合点，页面不需要知道每个站点节点在哪一层。
 */
export const TERRITORY_EVENTS = {
    /** 站点 / 随机资源格被点击。载荷：`TerritoryStationTarget`（`TerritorySite` 或随机格 target）。 */
    STATION_CLICK: 'territory:station-click',
    /** HUD「上一章」被点击。无载荷。 */
    PREVIOUS_CHAPTER: 'territory:previous-chapter',
    /** HUD「下一章」被点击。无载荷。 */
    NEXT_CHAPTER: 'territory:next-chapter',
    /** 详情弹窗关闭（暗底 / 关闭按钮）。无载荷。 */
    DETAIL_CLOSE: 'territory:detail-close',
    /** 详情弹窗开战按钮。无载荷。 */
    DETAIL_START: 'territory:detail-start',
} as const;

/**
 * Presenter → 页面：状态已变更（**逻辑层事件，走 `framework/event/EventMgr`**，zcds 同款中控）。
 *
 * ⚠️ 订阅方销毁时必须 `EventMgr.instance.offTarget(this)`（页面在 `onDestroy`、测试经 `dispose`），
 * 否则旧实例会被一直回调 —— 跨页累积既是泄漏、也是"幽灵回调"。
 */
export const TERRITORY_PRESENTER_EVENTS = {
    /** Presenter 任一状态变更后广播，页面拿它做全量重渲染。无载荷。 */
    StateChange: 'territory:presenter-state-change',
} as const;
