/**
 * 事件中控（**全局唯一一份**，纯 TS）。
 *
 * ## 为什么要中控
 *
 * 视图要派发意图、控制器要订阅，但**不该把总线当参数传来传去** —— 尤其是弹窗：
 * 它由 `PopupManager` 异步建，只能塞 `userData` 才传得进去，还得操心「还没送到就被点」。
 * 中控让两边只认事件名：
 *
 * ```ts
 * EventMgr.instance.emit(ZCGameUiEvent.OpenRank);              // 视图
 * EventMgr.instance.on(ZCGameUiEvent.OpenRank, this.onX, this); // 控制器
 * ```
 *
 * ## ⚠️ 全局总线必须自己管生命周期
 *
 * 订阅方销毁时**必须** `offTarget(this)`（`ZCGame.shutdown` 里就有这么一行）：
 * 少了它，旧实例会一直被回调 —— 跨局累积既是泄漏、也是"幽灵回调"。
 *
 * ## 与既有两个派发器的关系（都留着，各管一摊）
 *
 * | | 依赖 | 适用 |
 * |---|---|---|
 * | `EventProxy` | `ScriptObject → Log → EngineMain`（`Utils` 还摸 `cc.view`）；caller 统一为普通对象，退出时显式解除 | 网络那套（`NetSocket.msgEventProxy`），长生命周期、消息名动态 |
 * | `FWEventCenter`（`FW.FWEvent`） | 同上（引擎向），事件类型写死在 `FWEventType` | 框架自有事件（次日刷新 / 前后台 / 窗口 resize） |
 * | `EventMgr` | **零依赖（纯 TS）** | 界面意图（`ZCGameUiEvent`）：纯逻辑单测能直接 require，不必造引擎桩 |
 */
import { EventBus, type EventBusHandler } from './EventBus';

export class EventMgr {
    private static _instance: EventMgr | null = null;

    static get instance(): EventMgr {
        if (EventMgr._instance === null) EventMgr._instance = new EventMgr();
        return EventMgr._instance;
    }

    private readonly bus = new EventBus<string>();

    /** 订阅（幂等，同 `EventBus.on`）。`target` 决定回调里的 `this`。 */
    on(event: string, handler: EventBusHandler, target?: unknown): void {
        this.bus.on(event, handler, target);
    }

    /** 注销单条。 */
    off(event: string, handler: EventBusHandler, target?: unknown): void {
        this.bus.off(event, handler, target);
    }

    /** 派发；需要带值时给第二个参数（如地块点击的 `hexId`）。 */
    emit(event: string, payload?: any): void {
        this.bus.emit(event, payload);
    }

    /** 摘掉某个宿主挂过的**全部**监听 —— 订阅方销毁时必须调（见类注释）。 */
    offTarget(target: unknown): void {
        this.bus.offTarget(target);
    }
}
