import { _decorator, Component } from "cc";
import { ResourceScope } from "../../core/asset/ResourceScope";
import type { GameContext } from "../../core/runtime/GameContext";
import { UpdateBeat } from "../utils/UpdateBeat";
import { ProcedureBase } from "./ProcedureBase";
import type { ProcedurePreloadContext } from "./ProcedureBase";

const { ccclass } = _decorator;

interface PendingSwitch {
    token: number;
    next: ProcedureBase;
    context: ProcedurePreloadContext;
}

/**
 * 游戏流程管理器（对齐 GameFramework 的 ProcedureManager）。
 *
 * 作为全局唯一入口组件，挂载在常驻节点（Root.scene 的 Procedure 节点）上：
 *   1. 注册各流程（registerProcedure）
 *   2. 指定首个流程（startProcedure）
 *   3. 每帧通过 update(dt) 驱动当前流程的 onUpdate
 *
 * 用法：
 *   const mgr = node.addComponent(ProcedureManager);
 *   mgr.registerProcedure(ProcedureLogin);
 *   mgr.registerProcedure(ProcedureGame);
 *   mgr.startProcedure(ProcedureLogin, params);
 *
 * 流程内通过 this.changeProcedure(ProcedureGame, params) 切换。
 */
@ccclass("ProcedureManager")
export class ProcedureManager extends Component {
    public static __cname: string = "ProcedureManager";

    /** 全局单例（首个挂载的 ProcedureManager），供 LoginPage 等业务代码反向引用。 */
    private static _instance: ProcedureManager | null = null;
    static get instance(): ProcedureManager | null {
        return ProcedureManager._instance;
    }

    /** 所有已注册流程（以构造器为 key）。 */
    private readonly procedures = new Map<new (...args: any[]) => ProcedureBase, ProcedureBase>();

    /** 应用路由到流程构造器的映射；由 app/bootstrap 负责装配。 */
    private readonly routes = new Map<string, new (...args: any[]) => ProcedureBase>();

    /** 框架只持有接口，不反向依赖任何具体业务服务。 */
    private _context: GameContext | null = null;

    /** 当前流程。 */
    private current: ProcedureBase | null = null;

    /** 切换序号：用于取消过期的异步预加载结果（连续切换时只认最后一次）。 */
    private switchToken = 0;

    /** 是否正在预加载/切换中。 */
    get switching(): boolean {
        return this.switchToken !== this.completedToken;
    }
    private completedToken = 0;
    private pendingSwitch: PendingSwitch | null = null;

    /**
     * 本次流程切换的落定回调。进入成功传 `true`；预加载失败 / 被新的切换顶掉传 `false`。
     *
     * ## 为什么需要这个钩子
     *
     * `changeProcedure` 是「预加载 → 进入」两阶段，**预加载期间当前界面一直不动**。
     * 压在主界面之上的覆盖页（大世界）如果在这时候就被提前销毁，露出来的就是
     * `MainTabHost.currentTab` —— 而默认 tab 是领地 ⇒ 玩家看到的是
     * 「点攻打先跑回领地，等几十秒才进战斗」。
     *
     * 覆盖页应当留到流程真正切走的这一刻再关，所以这里给一个落定钩子；
     * 预加载失败时它同样会收到 `false`，覆盖页据此撤掉自己的「正在进入」态。
     */
    private readonly switchSettled = new Set<(entered: boolean) => void>();

    /** 逻辑帧间隔累计（用于把真实 dt 切分为固定逻辑步长）。 */
    private readonly fixedDelta = 1 / 60;
    private accumulator = 0;

    onLoad(): void {
        ProcedureManager._instance = this;
    }

    onDestroy(): void {
        if (ProcedureManager._instance === this) {
            ProcedureManager._instance = null;
        }
        this.switchToken += 1;
        this.completedToken = this.switchToken;
        this.cancelPendingSwitch();
        for (const procedure of this.procedures.values()) {
            this._context?.callbackOwners?.removeCallerListener(procedure);
            procedure.destroy();
        }
        this.procedures.clear();
        this.routes.clear();
        this.switchSettled.clear();
        this._context?.sessionAssets.clear();
        this._context = null;
        this.current = null;
    }

    /** 必须在注册流程之前由组合根调用。 */
    configure(context: GameContext): void {
        if (this.procedures.size > 0) {
            throw new Error('ProcedureManager 已注册流程，不能再替换 GameContext');
        }
        this._context = context;
    }

    get context(): GameContext {
        if (!this._context) {
            throw new Error('ProcedureManager 尚未配置 GameContext');
        }
        return this._context;
    }

    /** 注册一个流程（构造器 + 实例由管理器持有）。 */
    registerProcedure<T extends ProcedureBase>(type: new (...args: any[]) => T): T {
        if (this.procedures.has(type)) {
            throw new Error(`流程已注册：${type.name}`);
        }
        const procedure = new type();
        procedure.onInit(this);
        this.procedures.set(type, procedure);
        return procedure;
    }

    /** 注册应用路由。具体流程类型只在 app/bootstrap 中出现。 */
    registerRoute<T extends ProcedureBase>(route: string, type: new (...args: any[]) => T): T {
        if (this.routes.has(route)) {
            throw new Error(`路由已注册：${route}`);
        }
        this.routes.set(route, type);
        return this.registerProcedure(type);
    }

    /** 启动并切入首个流程。 */
    startProcedure<T extends ProcedureBase>(type: new (...args: any[]) => T, params?: any): void {
        this.changeProcedure(type, params);
    }

    /** 便捷入口：供业务代码（如 LoginPage）通过全局单例切换流程。 */
    static switchTo<T extends ProcedureBase>(type: new (...args: any[]) => T, params?: any): void {
        const mgr = ProcedureManager._instance;
        if (!mgr) {
            console.error('[ProcedureManager] 尚未初始化，无法切换流程');
            return;
        }
        mgr.changeProcedure(type, params);
    }

    /** 业务页面使用的路由入口，避免页面直接依赖具体 Procedure 类。 */
    static navigate(route: string, params?: any): void {
        const mgr = ProcedureManager._instance;
        if (!mgr) {
            console.error(`[ProcedureManager] 尚未初始化，无法导航：${route}`);
            return;
        }
        mgr.navigate(route, params);
    }

    navigate(route: string, params?: any): void {
        const type = this.routes.get(route);
        if (!type) {
            console.error(`[ProcedureManager] 未注册路由：${route}`);
            return;
        }
        this.changeProcedure(type, params);
    }

    /**
     * 切入目标流程（若未注册则先注册）。
     * 流程为「预加载 → 进入」两阶段：先 await onPreload，完成后才 onEnter。
     * 若预加载期间再次发起切换，旧切换作废（以最后一次为准）。
     */
    changeProcedure<T extends ProcedureBase>(type: new (...args: any[]) => T, params?: any): void {
        let next = this.procedures.get(type) as ProcedureBase | undefined;
        if (!next) {
            next = this.registerProcedure(type);
        }
        if (next === this.current && !this.switching) {
            return;
        }
        if (this.pendingSwitch?.next === next) {
            return;
        }

        this.cancelPendingSwitch();
        const token = ++this.switchToken;
        const context: ProcedurePreloadContext = {
            resources: new ResourceScope(`procedure:${next.className}:${token}`),
            cancelled: false,
        };
        this.pendingSwitch = { token, next, context };
        void this.runSwitch(token, next, params, context);
    }

    private async runSwitch(
        token: number,
        next: ProcedureBase,
        params: any,
        context: ProcedurePreloadContext,
    ): Promise<void> {
        // 预加载（可异步）。期间不切换当前流程，避免资源未就绪就进入。
        try {
            await next.onPreload(params, context);
        } catch (error) {
            console.error(`[ProcedureManager] 流程预加载失败：${next.className}`, error);
            // 当前界面继续保留，同时结束本次 switching 状态，允许用户再次触发进入。
            if (token === this.switchToken && this.pendingSwitch?.token === token) {
                this.cancelPendingSwitch();
                this.completedToken = token;
            }
            return;
        }
        // 预加载完成，若已不是最新切换则作废。
        // 这里**不再**补一次 `settleSwitch(false)`：走这条路说明切换已被顶掉或取消，
        // `cancelPendingSwitch()` 当时已经通知过；再补一次会让订阅方收到重复的失败。
        if (token !== this.switchToken || context.cancelled || this.pendingSwitch?.token !== token) {
            return;
        }
        // 通知覆盖页：这一刻才真正切走。放在 `onLeave` 之前 —— 宿主页面还活着，
        // 覆盖页关闭时回调宿主刷新底栏才不会碰到已销毁的节点。
        this.settleSwitch(true);
        const previous = this.current;
        try {
            previous?.onLeave();
        } finally {
            if (previous) this._context?.callbackOwners?.removeCallerListener(previous);
        }
        this.current = next;
        next._adoptResourceScope(context.resources);
        //  onEnter 是同步的，但里面会 addComponent / 建对局模型 —— 一旦抛错，异常会顺着
        // async 的 runSwitch 变成 **unhandled promise rejection**：控制台既没有 error 日志，
        // 也没有进入游戏，只有最后一条「离开 xxx 流程」——排查成本极高
        // （2026-09-16 web-mobile 上就是被这个吞掉了 createPvpTileTypes 的 TypeError）。
        // 所以这里显式落日志；并用 finally 保证 switching 状态一定复位，
        // 否则 pendingSwitch 不清空，后续所有 navigate 都会被上面的去重分支静默挡掉。
        try {
            next.onEnter(params);
        } catch (error) {
            console.error(`[ProcedureManager] ${next.className}.onEnter 失败，已清理流程并释放资源`, error);
            try {
                next.onLeave();
            } catch (cleanupError) {
                console.error(`[ProcedureManager] ${next.className}.onLeave 清理失败`, cleanupError);
            }
            this._context?.callbackOwners?.removeCallerListener(next);
            context.resources.dispose();
            if (this.current === next) this.current = null;
        } finally {
            this.pendingSwitch = null;
            this.completedToken = token;
        }
    }

    private cancelPendingSwitch(): void {
        const pending = this.pendingSwitch;
        if (!pending) return;
        this.pendingSwitch = null;
        pending.context.cancelled = true;
        pending.context.resources.dispose();
        try {
            pending.next.onPreloadCancelled?.(pending.context);
        } catch (error) {
            console.error(`[ProcedureManager] 清理过期预加载失败：${pending.next.className}`, error);
        }
        this._context?.callbackOwners?.removeCallerListener(pending.next);
        // 被新的切换顶掉 / 预加载失败 / 管理器销毁 —— 都算「没进去」，覆盖页据此撤掉等待态。
        this.settleSwitch(false);
    }

    /** 当前流程。 */
    get currentProcedure(): ProcedureBase | null {
        return this.current;
    }

    /**
     * 订阅「流程切换落定」；返回取消函数，**订阅方负责在自己不要时调用**。
     *
     * 用法（覆盖页保活到真正切走）：
     * ```ts
     * const stop = ProcedureManager.onSwitchSettled((entered) => {
     *     stop();
     *     if (entered) overlay.close(); else overlay.cancelPendingEnter();
     * });
     * ```
     *
     * ⚠️ 回调在 `onLeave` **之前**同步执行 —— 宿主（主界面）还活着，
     * 覆盖页关闭时回调宿主刷新底栏高亮才是安全的。
     */
    subscribeSwitchSettled(listener: (entered: boolean) => void): () => void {
        this.switchSettled.add(listener);
        return () => { this.switchSettled.delete(listener); };
    }

    /** 静态入口：业务页面不持有管理器实例时也能订阅（语义同 `navigate`）。 */
    static onSwitchSettled(listener: (entered: boolean) => void): () => void {
        const mgr = ProcedureManager._instance;
        if (!mgr) {
            console.error('[ProcedureManager] 尚未初始化，无法订阅流程切换落定');
            return () => undefined;
        }
        return mgr.subscribeSwitchSettled(listener);
    }

    private settleSwitch(entered: boolean): void {
        if (this.switchSettled.size === 0) return;
        // 不在这里清空：一次订阅可能要跨多次切换（例如先被取消、再真正进入）。
        // 订阅方在回调里自己 `stop()` —— 覆盖页那一侧就是这么写的。
        for (const listener of Array.from(this.switchSettled)) {
            try {
                listener(entered);
            } catch (error) {
                console.error('[ProcedureManager] 切换落定回调失败', error);
            }
        }
    }

    /** 每帧驱动当前流程，并顺带驱动框架的 `UpdateBeat`。 */
    update(dt: number): void {
        //  `UpdateBeat` 在本工程原本**没有任何调用方**：老客户端由引擎主循环调
        // `window.frameworkUpdate`（见 `framework/moduleMainframework.ts`），而那个函数
        // 在 Demo3.8 里没人调；`DemoMain` 虽然调了 `UpdateBeat.loop(dt)`，但它没挂进任何场景。
        //
        // 后果不是「少几个帧回调」这么轻 —— 网络层的发送泵就是挂在它上面的：
        // `NetSocket.sendData()` 是 `while (true) { …; await FW.Task.delay(1) }`，
        // `FW.Task.delay` 走 `Timer` → `UpdateBeat`。UpdateBeat 不 tick ⇒ `delay` 永不 resolve
        // ⇒ **第一次 `GameNet.send()` 之后 `isSending` 永远停在 true**，之后所有 `send()`
        // 只入队、不发包、promise 永不 resolve，而且**一条日志都不打**
        // （表现：角色页只有第一次进能拉到数据，第二次不刷新；卡牌升级 / GM 指令同样静默失效）。
        // `sendNow()` 走另一条链路，所以登录一直正常 —— 这就是它藏了这么久的原因。
        //
        // 放在这里而不是另造一个驱动器：`ProcedureManager` 是常驻场景（`Root.scene` 的
        // `Procedure` 节点）的框架级每帧入口，语义上就是本工程的主循环。
        //  必须在 `!this.current` 早退**之前**调用：首个流程切进来之前网络就已经在建连了。
        //  若哪天真把 `DemoMain` 挂进场景，这里会变成每帧驱动两次（计时器走双倍速），
        // 删掉那一边的 `UpdateBeat.loop` 即可。
        UpdateBeat.loop(dt);

        if (!this.current) return;
        // 逻辑帧步长切分：保证 onUpdate 的 elapseSeconds 稳定，便于确定性逻辑。
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= this.fixedDelta && steps < 10) {
            this.current.onUpdate(this.fixedDelta, dt);
            this.accumulator -= this.fixedDelta;
            steps += 1;
        }
        if (this.accumulator >= this.fixedDelta) {
            // 单帧 dt 过大（卡顿/后台恢复），丢弃多余步长避免螺旋追赶。
            this.accumulator = 0;
        }
    }
}
