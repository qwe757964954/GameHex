/**
 * 通用事件派发器（**纯 TypeScript：不 import `cc`，也不依赖 framework 其它模块**，规则 78 同一口径）。
 *
 * ## 与同目录 `EventProxy` 的分工（两个都留着，别互相替代）
 *
 * | | `EventProxy` | `EventBus` |
 * |---|---|---|
 * | 依赖 | `ScriptObject` → `Log` → `EngineMain`（`Utils` 还会摸 `cc.view`） | 零依赖 |
 * | 监听解绑 | `add(event, listener, caller)` 要求传**可销毁的 caller**，靠它做自动解绑 | 不追踪 caller；总线归谁、谁的生命周期说了算 |
 * | 适用 | 网络那套（`NetSocket.msgEventProxy`，长生命周期、消息名动态） | 契约模块 / 纯逻辑单测 / 界面向外派发的意图 |
 *
 * 关键差别是**能不能在纯逻辑单测里 require**：`EventBus` 可以（不需要造引擎桩），`EventProxy` 不行。
 *
 * ## 设计取舍
 *
 * - **payload 可选**：多数界面意图无参（"点了什么"），少数要带一个值（如地块点击的 `hexId`）⇒
 *   `emit(event, payload)` / `handler(payload)`，形状与 `EventProxy.execute(event, p1…p6)` 同族。
 * - `on` **幂等**：同一 (事件, 函数, target) 重复订阅只保留一份 —— 视图支持重复初始化，否则会叠成「点一下走两遍」。
 * - 本类**不提供 `clear()`**：总线实例归谁就跟着谁回收，没有"忘了清"这一摊。
 *
 * ```ts
 * const bus = new EventBus<MyEvent>();
 * bus.on(MyEvent.A, this.onA, this);   // target 决定回调里的 this
 * bus.emit(MyEvent.A);
 * bus.off(MyEvent.A, this.onA, this);
 * ```
 */
export type EventBusHandler = (payload?: any) => void;

export class EventBus<E extends number | string = string> {
    private readonly handlers = new Map<E, Array<{ handler: EventBusHandler; target: unknown }>>();

    /** 订阅（幂等）：同一 (事件, 函数, target) 只留一份。 */
    on(event: E, handler: EventBusHandler, target?: unknown): void {
        const list = this.handlers.get(event) ?? [];
        if (list.some((item) => item.handler === handler && item.target === target)) return;
        list.push({ handler, target });
        this.handlers.set(event, list);
    }

    /** 注销（同一 (事件, 函数, target) 才移除；不存在时静默返回）。 */
    off(event: E, handler: EventBusHandler, target?: unknown): void {
        const list = this.handlers.get(event);
        if (!list) return;
        const kept = list.filter((item) => item.handler !== handler || item.target !== target);
        if (kept.length > 0) this.handlers.set(event, kept);
        else this.handlers.delete(event);
    }

    /**
     * 摘掉某个宿主挂过的**全部**监听（跨事件扫描）。
     *
     * 给"全局唯一总线"用：订阅方（控制器 / 面板）销毁时必须调一次，否则旧实例会一直被回调。
     * 单实例总线（归视图所有）用不到它 —— 那种情况下总线随宿主一起回收。
     */
    offTarget(target: unknown): void {
        for (const [event, list] of [...this.handlers]) {
            const kept = list.filter((item) => item.target !== target);
            if (kept.length > 0) this.handlers.set(event, kept);
            else this.handlers.delete(event);
        }
    }

    /**
     * 派发。遍历前**拷一份** —— 回调里再订阅 / 注销都不会漏派或越界
     * （「本次新增的监听不会被本次触发」这条语义因此自动成立）。
     */
    emit(event: E, payload?: any): void {
        const list = this.handlers.get(event);
        if (!list) return;
        for (const item of [...list]) item.handler.call(item.target, payload);
    }
}
