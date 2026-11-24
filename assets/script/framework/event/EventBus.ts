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
 * - **source 可选**：需要匹配页面或对局实例时，使用独立的事件来源参数。
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
export type EventBusHandler = (payload?: any, source?: object) => void;

type EventBusListener = { handler: EventBusHandler; target: unknown; active: boolean };

export class EventBus<E extends number | string = string> {
    private readonly handlers = new Map<E, EventBusListener[]>();

    /** 订阅（幂等）：同一 (事件, 函数, target) 只留一份。 */
    on(event: E, handler: EventBusHandler, target?: unknown): void {
        const list = this.handlers.get(event) ?? [];
        if (list.some((item) => item.handler === handler && item.target === target)) return;
        this.handlers.set(event, [...list, { handler, target, active: true }]);
    }

    /** 注销（同一 (事件, 函数, target) 才移除；不存在时静默返回）。 */
    off(event: E, handler: EventBusHandler, target?: unknown): void {
        const list = this.handlers.get(event);
        if (!list) return;
        let changed = false;
        for (const item of list) {
            if (item.handler === handler && item.target === target) {
                item.active = false;
                changed = true;
            }
        }
        if (!changed) return;
        const kept = list.filter((item) => item.active);
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
            let changed = false;
            for (const item of list) {
                if (item.target === target) {
                    item.active = false;
                    changed = true;
                }
            }
            if (!changed) continue;
            const kept = list.filter((item) => item.active);
            if (kept.length > 0) this.handlers.set(event, kept);
            else this.handlers.delete(event);
        }
    }

    /**
     * 订阅变化时替换数组，派发直接持有当前快照，回调增删不改变本轮范围。
     * （本次新增监听延后到下次；已解绑的监听立即停止，即使还在遍历副本中）。
     *
     * `on/off` 替换数组，旧快照里的记录用 `active` 标记是否已被解绑；派发只读这个标记，
     * 不再对每个 handler 做 `Map.get` + `includes`（监听多时那会是 O(n²)）。
     */
    emit(event: E, payload?: any, source?: object): void {
        const list = this.handlers.get(event);
        if (!list) return;
        for (const item of list) {
            if (item.active) item.handler.call(item.target, payload, source);
        }
    }
}
