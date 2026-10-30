/**
 * PopupBase — 弹窗基类
 * ------------------------------------------------------------------
 * 对齐 Unity GameFramework 的 UIFormLogic / IUIForm：
 *
 *   GF (UIFormLogic)          PopupBase
 *   ─────────────────────     ────────────────────────────────────────
 *   OnInit(userData)          onInit()
 *   OnOpen(userData)          onOpen(userData)          ← 每次打开
 *   OnClose(userData)         onClose(reason)
 *   OnPause()                 onCover()                 ← 被上层弹窗盖住
 *   OnResume()                onReveal()                ← 重新露出
 *   OnCover()                 onCover()                 ← 合并到上面
 *   OnReveal()                onReveal()
 *   OnDepthChanged(depth)     onDepthChanged(depth)
 *
 * 生命周期由 PopupManager 驱动，业务不要在外部直接调 `_internalXxx`。
 *
 * ==================================================================
 * 「点击空白关闭」的实现说明（本类的核心职责之一）
 * ==================================================================
 * 需求：点弹窗内容以外的区域自动关闭，子类不用写任何代码。
 *
 * 判定链路：
 *   1. 弹窗根节点自己挂全屏尺寸（720×1280），并在 onOpen 时注册
 *      TOUCH_START / MOVE / END / CANCEL 四个监听 —— Cocos 里节点只要注册了触摸
 *      监听就会参与命中检测（`UITransform.hitTest`），**不需要 Sprite/Button**。
 *   2. 内容区（`contentNodes`，留空则自动取全部「激活的直接子节点」）在抬起时
 *      做命中测试：命中 → 说明点的是内容，不关；未命中 → 点的是空白，关闭。
 *   3. 按下到抬起的 UI 位移超过 `POPUP_BLANK_TOLERANCE` 视为拖拽（滑列表/摇杆），
 *      不触发关闭 —— 否则在列表上滑一下就把弹窗关掉了。
 *
 * 为什么不用「内容区挂 BlockInputEvents」那套？
 *   那样每个弹窗 prefab 都得往内容节点挂组件、且内容区一旦有多个并列节点
 *   （比如左右两块面板）就要挂多次，属于「每个 prefab 都要配一遍」的方案。
 *   本类把它收敛成基类里的统一逻辑：prefab 什么都不用配，默认就生效。
 *
 * 命中测试用了两条独立链路，任一命中即认为「点在内容上」（保守，避免误关）：
 *   ① 屏幕空间：`UITransform.hitTest(event.getLocation())` —— 引擎官方 API
 *   ② UI 空间  ：`event.getUILocation()` 落在 `getBoundingBoxToWorld()` 矩形内
 *
 * ==================================================================
 * ★ 空 白 接 收 层（`__BlankClose`）—— 为什么必须有它
 * ==================================================================
 * Cocos 的触摸分发**先做命中检测**：某个节点只有在「触点落在它的 `UITransform`
 * 矩形内」时才会收到触摸事件。所以「把监听挂在弹窗根节点上」这条路，隐含要求
 * **根节点自身的 `UITransform` 必须覆盖整屏**。
 *
 * 现实是：不少 prefab 的根节点尺寸是随手给的（本工程联盟系列 14 个弹窗里，
 * 13 个根节点只有 `100×100`，只有 `ui/League/League` 是 `720×1280`）。
 * 于是「点在弹窗外围的空白处」根本没有节点命中 ⇒ 根节点收不到 `TOUCH_END`
 * ⇒ **点空白没有任何反应**（不是逻辑写错，是事件压根没到）。
 *
 * 修法不是「逐个去改 prefab 的根节点尺寸」——那治标，且会连带影响挂在子节点上、
 * 依赖父节点尺寸的 `Widget` 对齐。这里改成**运行时补一个全屏的空白接收层**：
 *
 *   · 节点名 `__BlankClose`，无任何渲染组件（完全透明，玩家看不见）；
 *   · 尺寸取所在层（弹窗层）尺寸并略微外扩，位置对齐层的中心 ⇒ 覆盖整屏；
 *   · 插到弹窗根节点的 **index 0（最底层）**——引擎取「最上层命中的节点」，
 *     所以任何注册了监听的按钮/列表都比它优先，**点按钮绝不会被它抢走**；
 *   · 只有「上层没节点接住」时它才命中，这正是「点空白」的定义。
 *
 * 这样 prefab 什么都不用配，且与根节点尺寸彻底解耦。
 *
 * ==================================================================
 * ★ 内容区判定要排除「全屏装饰底图」
 * ==================================================================
 * `contentNodes` 留空时，内容区 = 全部激活的直接子节点。有些页面根下有一张
 * **全屏底图**（如 `Bg` 720×1742 / 720×1280），它是背景板不是内容，
 * 若算进内容区 ⇒ 整屏都算「点在内容上」⇒ 空白点击**永远不关闭**。
 *
 * 判据（`isBlankBackdrop`，三个条件同时满足才算底图）：
 *   ① 尺寸 ≥ 可见区 90%；
 *   ② 有 `cc.Sprite`（真的画了东西，全屏透明纯容器不算 —— 那是内容承载层）；
 *   ③ 没有 `Button` / `EditBox` / `Mask` / `ScrollView` / `PageView` 等交互组件。
 * ==================================================================
 */

import {
    _decorator,
    Button,
    Component,
    director,
    Director,
    EditBox,
    EventTouch,
    Mask,
    Node,
    PageView,
    ScrollView,
    Sprite,
    UITransform,
    Vec2,
    Vec3,
    view,
} from 'cc';
import {
    IPopupOpenParams,
    POPUP_BLANK_TOLERANCE,
    PopupCloseReason,
    PopupLifecycleState,
    PopupLayer,
} from './PopupDef';
import { PopupManager } from './PopupManager';
import type { ICallbackOwnerRegistry } from '../../core/runtime/CallbackOwner';
import { scopeAssetService, type AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { ProcedureManager } from '../procedure/ProcedureManager';
import type { GameContext } from '../../core/runtime/GameContext';

const { ccclass, property } = _decorator;

/** 复用的临时向量，避免每次触摸都 new。 */
const _tmpScreen = new Vec2();
const _tmpUi = new Vec2();
const _tmpWorld = new Vec3();

/** 空白接收层的节点名（运行时创建在弹窗根节点下、index 0）。 */
export const POPUP_BLANK_CATCHER = '__BlankClose';

/**
 * 判定「全屏装饰底图」的尺寸阈值：达到可见区这个比例就算「铺满整屏」。
 * 取 0.9 而不是 1.0，是为了容忍个别底图比画布略小几像素的情况。
 */
const BLANK_BACKDROP_RATIO = 0.9;

/** 空白接收层的外扩系数：略大于层尺寸，规避适配/取整造成的边缘漏点。 */
const BLANK_CATCHER_SCALE = 1.25;

/**
 * 单次弹窗打开的取消上下文。
 * 关闭或销毁弹窗时一定会 cancel；通过它创建的帧等待也一定会结束，不会留下悬空 Promise。
 */
export class PopupOpenContext {
    private _cancelled = false;
    private readonly _cancelListeners = new Set<() => void>();
    private readonly _cancelPromise: Promise<void>;
    private _resolveCancel: (() => void) | null = null;

    constructor(readonly serialId: number) {
        this._cancelPromise = new Promise<void>((resolve) => { this._resolveCancel = resolve; });
    }

    get cancelled(): boolean {
        return this._cancelled;
    }

    /** @internal 由 PopupBase 在关闭时调用。 */
    cancel(): void {
        if (this._cancelled) return;
        this._cancelled = true;
        // 必须用 `Array.from` 而不是 `[...this._cancelListeners]`：
        // 构建期 Babel（loose）会把展开降级成 `[].concat(set)`，而 concat 不展开迭代器，
        // 拿到的会是「装着 Set 本身的单元素数组」→ 下面的 listener() 抛
        // `s is not a function`，**真正的取消回调一个都不会执行**（微信包里已实测复现）。
        const listeners = Array.from(this._cancelListeners);
        this._cancelListeners.clear();
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.error('[PopupOpenContext] 取消回调抛错', error);
            }
        }
        this._resolveCancel?.();
        this._resolveCancel = null;
    }

    /** 用于让 onOpen 与关闭竞争；关闭发生后一定 resolve。 */
    get whenCancelled(): Promise<void> {
        return this._cancelPromise;
    }

    /** 注册取消回调；返回注销函数。上下文已取消时会立即调用。 */
    onCancel(listener: () => void): () => void {
        if (this._cancelled) {
            listener();
            return () => {};
        }
        this._cancelListeners.add(listener);
        return () => { this._cancelListeners.delete(listener); };
    }

    /**
     * 等到引擎完成下一帧。正常到帧返回 true；等待期间弹窗关闭返回 false。
     * 监听挂在全局 Director 上，不依赖可能被销毁并取消调度的 Component。
     */
    nextFrame(): Promise<boolean> {
        if (this._cancelled) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            let settled = false;
            let removeCancel = () => {};
            const finish = (advanced: boolean) => {
                if (settled) return;
                settled = true;
                director.off(Director.EVENT_AFTER_UPDATE, onFrame);
                removeCancel();
                resolve(advanced);
            };
            const onFrame = () => finish(true);
            removeCancel = this.onCancel(() => finish(false));
            if (!settled) director.once(Director.EVENT_AFTER_UPDATE, onFrame);
        });
    }
}

@ccclass('PopupBase')
export class PopupBase extends Component {
    private _resourceScope = new ResourceScope('popup');
    private _assets: AssetService | null = null;

    /** 动态展示资源归本次打开所有；子类无需另外持有资源控制器。 */
    protected get resourceScope(): ResourceScope { return this._resourceScope; }

    protected get assets(): AssetService {
        if (!this._assets) {
            const context = this.gameContext;
            this._assets = scopeAssetService(context.sessionAssets.reusableAssets ?? context.assets, this.resourceScope);
        }
        return this._assets;
    }

    protected get configs(): GameContext['configs'] { return this.gameContext.configs; }
    protected get sessionAssets(): GameContext['sessionAssets'] { return this.gameContext.sessionAssets; }

    private get gameContext(): GameContext {
        const manager = ProcedureManager.instance;
        if (!manager) throw new Error(`${this.className} requires the configured application context`);
        return manager.context;
    }

    // ============================================================
    // 子类契约（静态）
    // ============================================================

    /**
     * 弹窗预制体在 resources 下的路径（不含扩展名）。
     * 子类**必须**覆盖，例如：
     *   static prefabPath = 'ui/game/GameRunAway';
     */
    static prefabPath: string = '';

    // ============================================================
    // Inspector 配置
    // ============================================================

    @property({ group: '弹窗', tooltip: '所属层级：数值越大越靠上（0 普通 / 1 系统 / 2 顶层）' })
    popupLayer: PopupLayer = PopupLayer.NORMAL;

    @property({
        group: '弹窗',
        tooltip: '点击内容区以外的空白处是否自动关闭',
    })
    closeOnBlank: boolean = true;

    @property({
        type: [Node],
        group: '弹窗',
        tooltip:
            '「内容区」节点：点在这些节点范围内不算空白、不会关闭。\n' +
            '留空时自动取本节点下全部处于激活状态的直接子节点（推荐留空）。',
    })
    contentNodes: Node[] = [];

    // ============================================================
    // 运行时状态（由 PopupManager 维护，业务只读）
    // ============================================================

    /** 本次打开的序号（对齐 GF 的 serialId），每次 open 递增。 */
    private _serialId: number = 0;
    /** 当前深度（栈内序号，0 为最底）。 */
    private _depth: number = -1;
    /** 是否处于打开状态。 */
    private _opened: boolean = false;
    /** 是否被上层弹窗盖住。 */
    private _covered: boolean = false;
    /** 关闭是否已处理（防止重复 close 触发两次回调）。 */
    private _closeHandled: boolean = false;
    /** 是否已经走过一次 onInit。 */
    private _inited: boolean = false;
    /** 本次打开的完整参数。 */
    private _params: IPopupOpenParams | null = null;
    /** 本次打开的取消上下文。 */
    private _openContext: PopupOpenContext | null = null;
    /** 当前生命周期状态。 */
    private _lifecycleState: PopupLifecycleState = PopupLifecycleState.Closed;
    private _callbackOwners: Pick<ICallbackOwnerRegistry, 'removeCallerListener'> | null = null;

    /** @internal 组合根通过 PopupManager 注入，缓存实例沿用相同的归属管理器。 */
    _bindCallbackOwners(owners: Pick<ICallbackOwnerRegistry, 'removeCallerListener'>): void {
        this._callbackOwners = owners;
    }

    /** 空白关闭的触摸状态。 */
    private _blankBound: boolean = false;
    /** 空白接收层（运行时创建，挂在根节点下最底层；承载四个触摸监听）。 */
    private _blankCatcher: Node | null = null;
    private _touchStartX: number = 0;
    private _touchStartY: number = 0;
    private _touchMoved: boolean = false;

    // ============================================================
    // 公开只读状态
    // ============================================================

    /** 打开序号；未打开时为 0。 */
    get serialId(): number {
        return this._serialId;
    }

    /** 当前深度（0 = 最底层弹窗）。 */
    get depth(): number {
        return this._depth;
    }

    /** 是否处于打开状态。 */
    get isPopupOpen(): boolean {
        return this._opened;
    }

    /** 是否被上层弹窗盖住。 */
    get isCovered(): boolean {
        return this._covered;
    }

    /** 本次打开的完整参数（onOpen 之后可用）。 */
    get openParams(): Readonly<IPopupOpenParams> | null {
        return this._params;
    }

    get lifecycleState(): PopupLifecycleState {
        return this._lifecycleState;
    }

    /** 子类异步流程可读取；上下文随每次打开重新创建。 */
    protected get popupOpenContext(): PopupOpenContext | null {
        return this._openContext;
    }

    /** 子类统一使用的取消安全下一帧等待。 */
    protected nextPopupFrame(): Promise<boolean> {
        return this._openContext?.nextFrame() ?? Promise.resolve(false);
    }

    // ============================================================
    // 静态入口：打开（委托 PopupManager）
    // ============================================================

    /**
     * 打开本弹窗。等价于 `PopupManager.inst.openAsync(本类, params)`。
     *
     * 用法（子类无需再写 static open）：
     *   await GameRunAway.open({ userData: { mine, enemy } });
     */
    static async open<T extends PopupBase>(
        this: new () => T,
        params: IPopupOpenParams = {},
    ): Promise<T | null> {
        return PopupManager.inst.openAsync(this, params);
    }

    // ============================================================
    // 生命周期钩子（子类覆写）
    // ============================================================

    /** 首次实例化后调用一次（早于第一次 onOpen）。适合做不随打开变化的初始化。 */
    protected onInit(): void {
        // 子类覆写
    }

    /**
     * 每次打开时调用。
     * 可以返回 Promise，PopupManager 会 await 它（弹窗的 openAsync 因此可用来等待数据加载）。
     */
    protected onOpen(_userData?: any, _context?: PopupOpenContext): void | Promise<void> {
        // 子类覆写
    }

    /** 关闭前调用（此时节点仍然有效）。不要在这里 destroy 节点，回收由 PopupManager 负责。 */
    protected onClose(_reason: PopupCloseReason): void {
        // 子类覆写
    }

    /** 被上层弹窗盖住时调用（对齐 GF OnCover/OnPause）。适合暂停定时器、停止动效。 */
    protected onCover(): void {
        // 子类覆写
    }

    /** 重新露出时调用（对齐 GF OnReveal/OnResume）。 */
    protected onReveal(): void {
        // 子类覆写
    }

    /** 层级变化时调用（对齐 GF OnDepthChanged）。 */
    protected onDepthChanged(_depth: number): void {
        // 子类覆写
    }

    /**
     * 是否允许「点击空白关闭」。
     * 覆写返回 false 可屏蔽本次空白点击（例如需要先弹二次确认）。
     */
    protected canCloseOnBlank(): boolean {
        return true;
    }

    // ============================================================
    // 公开 API
    // ============================================================

    /**
     * 关闭本弹窗。
     * 会经 PopupManager 统一处理：出栈 → 刷新深度 → 恢复下层弹窗 → 回收/销毁节点。
     */
    close(reason: PopupCloseReason = PopupCloseReason.Manual): void {
        if (this._closeHandled) return;

        const mgr = PopupManager.inst;
        if (mgr.owns(this)) {
            mgr.close(this, reason);
            return;
        }

        // 兜底：本弹窗不是经 PopupManager 打开的（被手动 instantiate 挂到别处），自行收尾。
        this._internalClose(reason);
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
    }

    /** 点关闭按钮的语法糖，等价于 close(PopupCloseReason.CloseButton)。 */
    closeByButton(): void {
        this.close(PopupCloseReason.CloseButton);
    }

    /**
     * 不走 PopupManager 的直接初始化。
     *
     * 用于「把本组件挂在已实例化的节点上、当内嵌面板用」的场景（CommonTips 的历史用法）：
     * 依然会正常走 onInit / onOpen，并**启用点击空白关闭**；
     * 区别只是不进管理器的栈（不参与深度排序与 onCover），close() 时自行销毁节点。
     */
    async initStandalone(userData?: any, params: IPopupOpenParams = {}): Promise<void> {
        if (this._opened) return;
        await this._internalOpen(0, { ...params, userData }, params.layer ?? this.popupLayer);
    }

    // ============================================================
    // 由 PopupManager 驱动的内部流程（业务不要直接调用）
    // ============================================================

    /** @internal 由 PopupManager 调用。 */
    public async _internalOpen(serialId: number, params: IPopupOpenParams, layer: PopupLayer): Promise<void> {
        this._openContext?.cancel();
        this._resourceScope.dispose();
        this._resourceScope = new ResourceScope(`popup:${this.className}`);
        this._assets = null;
        const context = new PopupOpenContext(serialId);
        this._openContext = context;
        this._lifecycleState = PopupLifecycleState.Opening;
        this._serialId = serialId;
        this._params = params;
        this._opened = true;
        this._covered = false;
        this._closeHandled = false;
        this.popupLayer = layer;

        if (!this._inited) {
            this._inited = true;
            try {
                this.onInit();
            } catch (error) {
                console.error(`[PopupBase] ${this.className} onInit 抛错`, error);
            }
        }

        // onInit 允许业务主动关闭；一旦本轮上下文失效，就不能继续绑定事件或执行 onOpen。
        if (context.cancelled || this._openContext !== context || !this._opened) return;

        // 「点击空白关闭」：每次打开都按最新配置重绑一次
        if (params.closeOnBlank !== undefined) this.closeOnBlank = params.closeOnBlank;
        this._bindBlankClose();

        const openTask = (async () => {
            try {
                await this.onOpen(params.userData, context);
            } catch (error) {
                if (!context.cancelled) console.error(`[PopupBase] ${this.className} onOpen 抛错`, error);
            }
        })();

        // onOpen 即使写出了永不结束的 Promise，关闭也会让本次 open 调用立刻结束。
        await Promise.race([openTask, context.whenCancelled]);
        if (this._openContext === context && !context.cancelled && this._opened) {
            this._lifecycleState = PopupLifecycleState.Open;
        }
    }

    /** @internal 由 PopupManager 调用（节点仍有效，随后可能被回收或销毁）。 */
    public _internalClose(reason: PopupCloseReason): void {
        if (this._closeHandled) return;
        this._closeHandled = true;
        this._lifecycleState = PopupLifecycleState.Closing;
        this._openContext?.cancel();

        this._unbindBlankClose();

        try {
            this.onClose(reason);
        } catch (error) {
            console.error(`[PopupBase] ${this.className} onClose 抛错`, error);
        }
        this._callbackOwners?.removeCallerListener(this);
        this._resourceScope.dispose();

        const onClose = this._params?.onClose;
        this._params = null;
        this._opened = false;
        this._covered = false;
        this._depth = -1;
        this._serialId = 0;
        this._openContext = null;
        this._lifecycleState = PopupLifecycleState.Closed;

        try {
            onClose?.(reason);
        } catch (error) {
            console.error(`[PopupBase] ${this.className} onClose 回调抛错`, error);
        }
    }

    /** @internal 由 PopupManager 调用。 */
    public _internalCover(): void {
        if (this._covered) return;
        this._covered = true;
        try {
            this.onCover();
        } catch (error) {
            console.error(`[PopupBase] ${this.className} onCover 抛错`, error);
        }
    }

    /** @internal 由 PopupManager 调用。 */
    public _internalReveal(): void {
        if (!this._covered) return;
        this._covered = false;
        try {
            this.onReveal();
        } catch (error) {
            console.error(`[PopupBase] ${this.className} onReveal 抛错`, error);
        }
    }

    /** @internal 由 PopupManager 调用。 */
    public _internalDepthChanged(depth: number): void {
        if (this._depth === depth) return;
        this._depth = depth;
        try {
            this.onDepthChanged(depth);
        } catch (error) {
            console.error(`[PopupBase] ${this.className} onDepthChanged 抛错`, error);
        }
    }

    // ============================================================
    // 点击空白关闭
    // ============================================================

    /**
     * 注册触摸监听 —— 但**不挂在根节点上**（见类头「空白接收层」一节：
     * 根节点的 `UITransform` 未必覆盖整屏，挂它上面等于白挂）。
     * 监听统一挂在运行时补出来的全屏 `__BlankClose` 上。
     */
    private _bindBlankClose(): void {
        if (this._blankBound) return;

        // ⚠️ 关掉「点空白关闭」的弹窗（Toast / LoadingPopup 等）**绝不能**铺这层：
        //    接收层是全屏的，注册了监听就会在命中检测里胜出，
        //    等于替下层弹窗和主界面吃掉所有点击。只在真的需要时才建。
        if (!this.closeOnBlank) {
            this._blankBound = true;
            this._blankCatcher = null;
            return;
        }

        const catcher = PopupBase.ensureBlankCatcher(this.node);
        if (!catcher) {
            console.warn(`[PopupBase] ${this.className} 无法建立空白接收层，点击空白关闭不会生效`);
            return;
        }

        this._blankBound = true;
        this._blankCatcher = catcher;
        catcher.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
        catcher.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        catcher.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        catcher.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    private _unbindBlankClose(): void {
        if (!this._blankBound) return;
        this._blankBound = false;
        const catcher = this._blankCatcher;
        this._blankCatcher = null;
        if (!catcher || !catcher.isValid) return;
        catcher.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
        catcher.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        catcher.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
        catcher.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
    }

    /**
     * 取得（必要时创建）全屏空白接收层。
     *
     * 注意是 `insertChild(..., 0)` 而不是 `addChild`：必须待在**最底层**，
     * 引擎按「最上层命中」挑接收者，这样才能保证按钮永远优先。
     * 节点无渲染组件 ⇒ 完全透明，不影响观感。
     */
    public static ensureBlankCatcher(root: Node): Node | null {
        if (!root || !root.isValid) return null;

        let catcher = root.getChildByName(POPUP_BLANK_CATCHER);
        if (!catcher || !catcher.isValid) {
            catcher = new Node(POPUP_BLANK_CATCHER);
            catcher.layer = root.layer;
            catcher.addComponent(UITransform);
            root.insertChild(catcher, 0);
        }

        const ui = catcher.getComponent(UITransform);
        if (!ui) return catcher;

        // 尺寸/位置都对齐「所在层」（弹窗层与屏幕同心）—— 而不是对齐根节点自身。
        const parentUi = root.parent?.getComponent(UITransform) ?? null;
        const viewSize = view.getVisibleSize();
        const layerW = parentUi && parentUi.width > 0 ? parentUi.width : viewSize.width;
        const layerH = parentUi && parentUi.height > 0 ? parentUi.height : viewSize.height;
        ui.setContentSize(layerW * BLANK_CATCHER_SCALE, layerH * BLANK_CATCHER_SCALE);

        const rootUi = root.getComponent(UITransform);
        if (rootUi && parentUi) {
            // 层原点（世界）→ 根节点局部坐标：根节点被挪过位置时也能覆盖整屏
            const worldOrigin = parentUi.convertToWorldSpaceAR(_tmpWorld.set(0, 0, 0));
            const local = rootUi.convertToNodeSpaceAR(worldOrigin);
            catcher.setPosition(local.x, local.y, 0);
        } else {
            catcher.setPosition(0, 0, 0);
        }

        return catcher;
    }

    /**
     * 是否「全屏装饰底图」—— 内容区判定要把它排掉，否则全屏都算内容、空白点击永不生效。
     *
     * ⚠️ 阈值必须按**设计分辨率**算，不能按 `view.getVisibleSize()`（踩过）：
     *    长屏适配时可见区会被拉高（实测预览里是 720×1485，设计分辨率是 720×1280），
     *    底图 `Bg` 仍是按设计稿做的 720×1280 ⇒ 除下来只有 0.86，过不了 0.9 的线，
     *    结果底图没被排掉。按设计稿比就恒为 1.0，与机型无关。
     *
     * 三个条件同时满足才判为底图（宁可漏排少关一次，也不误排把真内容当底图）：
     *   ① 尺寸 ≥ 设计分辨率 90%；
     *   ② 有 `cc.Sprite`（真的画了东西；全屏但什么都不画的容器是内容承载层，要留作内容）；
     *   ③ 没有 `Button` / `EditBox` / `Mask` / `ScrollView` / `PageView` 等交互组件。
     */
    public static isBlankBackdrop(node: Node): boolean {
        if (!node || !node.isValid) return false;
        const ui = node.getComponent(UITransform);
        if (!ui) return false;

        const design = view.getDesignResolutionSize();
        if (design.width <= 0 || design.height <= 0) return false;
        if (ui.width < design.width * BLANK_BACKDROP_RATIO) return false;
        if (ui.height < design.height * BLANK_BACKDROP_RATIO) return false;

        // ② 必须真的有渲染
        if (!node.getComponent(Sprite)) return false;

        // ③ 挂了交互组件就不是底图（全屏按钮 / 全屏输入区 / 全屏滚动区）
        if (node.getComponent(Button)) return false;
        if (node.getComponent(EditBox)) return false;
        if (node.getComponent(Mask)) return false;
        if (node.getComponent(ScrollView)) return false;
        if (node.getComponent(PageView)) return false;

        return true;
    }

    private _onTouchStart(event: EventTouch): void {
        const p = event.getUILocation(_tmpUi);
        this._touchStartX = p.x;
        this._touchStartY = p.y;
        this._touchMoved = false;
    }

    private _onTouchMove(event: EventTouch): void {
        if (this._touchMoved) return;
        const p = event.getUILocation(_tmpUi);
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        // 超过容差当作拖拽，抬起时不再判定为「点击空白」
        if (dx * dx + dy * dy > POPUP_BLANK_TOLERANCE * POPUP_BLANK_TOLERANCE) {
            this._touchMoved = true;
        }
    }

    private _onTouchCancel(): void {
        this._touchMoved = false;
    }

    private _onTouchEnd(event: EventTouch): void {
        if (!this.closeOnBlank || !this._opened) return;
        if (this._touchMoved) {
            this._touchMoved = false;
            return;
        }
        if (this._isOnContent(event)) return;
        if (!this.canCloseOnBlank()) return;
        this.close(PopupCloseReason.Blank);
    }

    /** 触点是否落在任一「内容区」节点内。 */
    private _isOnContent(event: EventTouch): boolean {
        const areas = this._collectContentNodes();
        for (const node of areas) {
            if (PopupBase.isPointOnNode(node, event)) return true;
        }
        return false;
    }

    /**
     * 收集参与「非空白」判定的节点。
     * - `contentNodes` 非空 → 只认这些（含隐藏的也要算，业务显式指定即为准）
     * - 否则 → 自动取全部处于激活状态的直接子节点，但排掉两类：
     *     ① 空白接收层自身（它是全屏的，算进去 ⇒ 永远判为「点在内容上」）
     *     ② 全屏装饰底图（`Bg` 之类，见 `isBlankBackdrop`）
     */
    private _collectContentNodes(): Node[] {
        const explicit = this.contentNodes;
        if (explicit && explicit.length > 0) {
            const out: Node[] = [];
            for (const node of explicit) {
                if (node && node.isValid) out.push(node);
            }
            if (out.length > 0) return out;
        }
        const out: Node[] = [];
        const children = this.node.children;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child || !child.isValid || !child.activeInHierarchy) continue;
            if (child.name === POPUP_BLANK_CATCHER) continue;
            if (PopupBase.isBlankBackdrop(child)) continue;
            out.push(child);
        }
        return out;
    }

    /**
     * 判断触点是否落在某个节点上。
     * 两条独立链路任一命中即算命中（保守策略，宁可少关不可误关）：
     *   ① 屏幕空间：`UITransform.hitTest(event.getLocation())`，引擎官方命中测试
     *   ② UI 空间  ：`event.getUILocation()` 落在 `getBoundingBoxToWorld()` 内
     *
     * ⚠️ 关于「UI 坐标 vs 世界坐标」——**本项目里两者是同一套**，不要自作聪明去换算（踩过）：
     *    实测 Canvas 节点位于世界坐标 `(360, 742.5)`（= 半屏宽高），
     *    `cam.screenToWorld(0,0) === (0,0)`、`cam.screenToWorld(448,924) === (720,1485)`，
     *    即 UI 世界空间的原点就在**屏幕左下角**。
     *    曾误按「世界原点在画布中心」去减半个可见区，结果把「屏幕左下角」算成画布中心，
     *    居中的内容板全被判成「点在内容上」⇒ **点空白反而不关**。这里保持原样即可。
     */
    public static isPointOnNode(node: Node, event: EventTouch): boolean {
        if (!node || !node.isValid || !node.activeInHierarchy) return false;
        const uit = node.getComponent(UITransform);
        if (!uit) return false;

        // ① 引擎官方：屏幕空间命中测试
        const hit = uit.hitTest?.(event.getLocation(_tmpScreen));
        if (hit) return true;

        // ② 兜底：UI 空间包围盒
        const ui = event.getUILocation(_tmpUi);
        const box = uit.getBoundingBoxToWorld();
        if (
            ui.x >= box.x &&
            ui.x <= box.x + box.width &&
            ui.y >= box.y &&
            ui.y <= box.y + box.height
        ) {
            return true;
        }

        // ③ 再兜底：把触点当 UI 世界坐标转到节点局部空间判矩形（处理相机偏移的极端情况）
        const local = uit.convertToNodeSpaceAR(_tmpWorld.set(ui.x, ui.y, 0));
        const size = uit.contentSize;
        const anchor = uit.anchorPoint;
        const minX = -size.width * anchor.x;
        const maxX = size.width * (1 - anchor.x);
        const minY = -size.height * anchor.y;
        const maxY = size.height * (1 - anchor.y);
        return local.x >= minX && local.x <= maxX && local.y >= minY && local.y <= maxY;
    }

    // ============================================================
    // 杂项
    // ============================================================

    /** 组件类名，用于日志。 */
    get className(): string {
        return this.constructor.name;
    }

    onDestroy(): void {
        this._resourceScope.dispose();
        this._callbackOwners?.removeCallerListener(this);
        this._callbackOwners = null;
        // 遵循项目约定：不要主动 off() 事件，节点销毁时引擎会自动清理，
        // 销毁期访问事件 API 容易空指针。这里只清业务字段。
        this._params = null;
        this._opened = false;
        this._covered = false;
        this._closeHandled = true;
        this._openContext?.cancel();
        this._openContext = null;
        this._lifecycleState = PopupLifecycleState.Closed;
    }
}
