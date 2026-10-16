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
            procedure.destroy();
        }
        this.procedures.clear();
        this.routes.clear();
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
        if (token !== this.switchToken || context.cancelled || this.pendingSwitch?.token !== token) {
            return;
        }
        this.current?.onLeave();
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
    }

    /** 当前流程。 */
    get currentProcedure(): ProcedureBase | null {
        return this.current;
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
