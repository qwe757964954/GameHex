/**
 * 领地视图间的事件契约（事件名即字符串常量，`grep TERRITORY_EVENTS.X` 即可追完整链路）。
 *
 * 跨组件通知统一走 `EventMgr` 全局中控（与 `TERRITORY_PRESENTER_EVENTS`、`CardLineupEvent` 同款）：
 * 发送方不需要知道有谁在听，页面也不需要知道「自己下面挂了几个弹窗」。
 *
 * ⚠️ 订阅方销毁时必须 `EventMgr.instance.offTarget(this)`，否则旧实例会被一直回调（幽灵回调）。
 *
 * 站点点击是**两层转发**，用两个事件名隔开：
 *   `TerritoryStationView` 发 `STATION_TAP` → `TerritoryMapView` 做「输入锁拦截 + 点击反馈」
 *   → 再发对外的 `STATION_CLICK` → 页面订阅。
 * 必须分开：若共用一个名字，`MapView` 转发出去的那条会被自己的订阅收到，无限循环。
 */
export const TERRITORY_EVENTS = {
    /**
     * 站点被点击（**内部事件**，`TerritoryStationView` → `TerritoryMapView`）。
     * 载荷：`TerritoryStationTarget`。
     */
    STATION_TAP: 'territory:station-tap',
    /** 站点 / 随机资源格被点击（**对外事件**，`TerritoryMapView` → 页面）。载荷同上。 */
    STATION_CLICK: 'territory:station-click',
    /** 详情弹窗关闭（暗底 / 关闭按钮）。无载荷。 */
    DETAIL_CLOSE: 'territory:detail-close',
    /** 详情弹窗开战按钮。无载荷。 */
    DETAIL_START: 'territory:detail-start',
    /**
     * 玩家关卡弹窗（异步据点）的「侦查」按钮。无载荷。
     *
     * 与 `DETAIL_START` / `DETAIL_CLOSE` 共用同一条转发链：两个详情面板语义相同，
     * 页面只需要一套 handler，不必按面板区分。
     */
    DETAIL_SCOUT: 'territory:detail-scout',
    /** 关卡界面右上角的感叹号 → 打开「关卡提示」（敌军列表）。无载荷。 */
    LEVEL_TIP_OPEN: 'territory:level-tip-open',
    /**
     * 「关卡提示」关闭。无载荷。
     *
     * 与 `DETAIL_CLOSE` 分开：提示是压在关卡界面**上面**的二级弹窗，关它只该收起它自己，
     * 不能把关卡界面一起关掉。
     */
    LEVEL_TIP_CLOSE: 'territory:level-tip-close',
} as const;

/**
 * Presenter → 页面：状态已变更（走 `framework/event/EventMgr`）。
 *
 * ⚠️ 订阅方销毁时必须 `EventMgr.instance.offTarget(this)`（页面在 `onDestroy`、测试经 `dispose`），
 * 否则旧实例会被一直回调 —— 跨页累积既是泄漏、也是"幽灵回调"。
 */
export const TERRITORY_PRESENTER_EVENTS = {
    /** Presenter 任一状态变更后广播，页面拿它做全量重渲染。无载荷。 */
    StateChange: 'territory:presenter-state-change',
    /** 进入对局。载荷类型见 TerritoryPresenter 导出的 ITerritoryNavigateBattlePayload。 */
    NavigateToBattle: 'territory:navigate-battle',
    /** 轻提示。载荷：{ text: string }。 */
    ShowTip: 'territory:show-tip',
    /** 发奖反馈。载荷类型见 TerritoryPresenter 导出的 ITerritoryShowRewardsPayload。 */
    ShowRewards: 'territory:show-rewards',
    /** 写请求全屏遮挡开关。载荷：{ busy: boolean; text?: string }。 */
    SetBusy: 'territory:set-busy',
    /**
     * 服务端钱包推送（**输入事件**，页面 → Presenter；方向与上面几个输出事件相反）。
     * 页面在角色缓存更新 / 首次进入时把权威钱包推进来，Presenter 不再回头拉。
     * 载荷类型见 TerritoryPresenter 导出的 ITerritoryWalletUpdatedPayload。
     */
    WalletUpdated: 'territory:wallet-updated',
} as const;
