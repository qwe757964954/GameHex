/**
 * PopupManager — 弹窗管理器（单例）
 * ------------------------------------------------------------------
 * 对齐 Unity GameFramework 的 UIComponent：
 *
 *   GF (UIComponent)                    PopupManager
 *   ─────────────────────────────────   ──────────────────────────────────
 *   常驻 GameObject 上挂 UIComponent     常驻节点 Popup 上挂本组件
 *   OpenUIForm(name, group, data)       openAsync(cls, params)
 *   CloseUIForm(serialId)               close(popup | serialId, reason)
 *   CloseAllLoadedUIForms()             closeAll(reason)
 *   HasUIForm / GetUIForm               has(cls) / get(cls)
 *   UIFormInfo                          IPopupInfo
 *   UIFormInstanceObjectPool            实例缓存池（params.cache = true 时启用）
 *   UIGroup 深度由 depth 决定            按 popupLayer + 打开先后排序
 *   pauseCoveredUIForm                  被覆盖的弹窗收到 onCover()
 *
 * ------------------------------------------------------------------
 * 常驻节点约定
 * ------------------------------------------------------------------
 * 场景（Root.scene）Canvas 下固定存在一个名为 `Popup` 的节点：
 *
 *   Root(scene) → Canvas → Popup   ← 挂 PopupManager
 *                          ├─ GameRunAway   （运行时的弹窗实例）
 *                          ├─ ZCGuidePanel
 *                          └─ CommonTips
 *
 * 「常驻」的含义：它不随业务界面增删，弹窗一律挂到它下面，因此
 *   - 弹窗天然盖在所有业务 UI（Procedure / HUD / 棋盘）之上；
 *   - 切流程（ProcedureGame → ProcedureMain）时不会被连带销毁；
 *   - 深度排序只需要在这一个节点内部做，不用跨父节点比较。
 *
 * 若场景里找不到该节点，会兜底在 Canvas 下自动创建一个，保证不崩。
 * ------------------------------------------------------------------
 */

import {
    _decorator,
    Canvas,
    Component,
    director,
    instantiate,
    Layers,
    Node,
    Prefab,
    UITransform,
} from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import type { ICallbackOwnerRegistry } from '../../core/runtime/CallbackOwner';
import { ResourceScope } from '../../core/asset/ResourceScope';
import {
    IPopupOpenParams,
    POPUP_ROOT_NAME,
    PopupCloseReason,
    PopupLayer,
} from './PopupDef';
import type { PopupBase } from './PopupBase';

const { ccclass } = _decorator;

/** 单个已打开弹窗的运行时记录（对齐 GF 的 UIFormInfo）。 */
export interface IPopupInfo {
    /** 打开序号，全局递增（对齐 GF 的 serialId）。 */
    serialId: number;
    /** 弹窗实例。 */
    popup: PopupBase;
    /** 预制体路径（缓存池的 key）。 */
    path: string;
    /** 生效层级。 */
    layer: PopupLayer;
    /** 关闭后是否回收进实例池。 */
    cache: boolean;
}

interface IPopupOpening {
    path: string;
    cls: new () => PopupBase;
    cancelled: boolean;
    promise: Promise<PopupBase | null>;
    entry?: IPopupInfo;
}

@ccclass('PopupManager')
export class PopupManager extends Component {
    // ============================================================
    // 单例
    // ============================================================

    private static _instance: PopupManager | null = null;

    /**
     * 全局访问点。
     * 优先返回已挂载的实例；实例不存在/已销毁时按名字在场景里重新定位，
     * 找不到 `Popup` 节点则兜底创建，保证业务侧永远拿到可用对象（或 null 并报错）。
     */
    static get inst(): PopupManager | null {
        const cached = PopupManager._instance;
        if (cached && cached.isValid) return cached;

        const root = PopupManager._ensureSceneRoot();
        if (!root) {
            console.error('[PopupManager] 场景内既没有 Popup 节点也找不到 Canvas，无法初始化');
            return null;
        }
        let mgr = root.getComponent(PopupManager);
        if (!mgr) {
            console.warn('[PopupManager] Popup 节点上没有 PopupManager 组件，已自动补挂');
            mgr = root.addComponent(PopupManager);
        }
        return mgr;
    }

    // ============================================================
    // 运行时状态
    // ============================================================

    /** 已打开的弹窗栈（按打开顺序，未排序；深度按 popupLayer 动态算）。 */
    private _stack: IPopupInfo[] = [];
    /** 实例缓存池：path → 已关闭待复用的节点。 */
    private _cache: Map<string, Node[]> = new Map();
    /** 默认唯一弹窗的打开任务：path → 正在进行的同一次 open。 */
    private _openingByPath: Map<string, IPopupOpening> = new Map();
    /** 全部尚未结束的打开任务（包含显式允许多开的任务）。 */
    private _openings: Set<IPopupOpening> = new Set();
    /** 串行 id 发号器。 */
    private _serialId: number = 0;
    /** 已进入销毁流程；阻止 onClose 回调或迟到异步任务重新打开弹窗。 */
    private _disposed: boolean = false;
    /** Prefab 资源由管理器持有，至少覆盖所有仍存活或缓存中的弹窗节点。 */
    private readonly _assetScope = new ResourceScope('framework:popup-manager');
    private _assetService: AssetService | null = null;
    private _callbackOwners: ICallbackOwnerRegistry | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    onLoad(): void {
        if (PopupManager._instance && PopupManager._instance !== this) {
            console.warn('[PopupManager] 场景内已存在实例，忽略重复挂载');
            return;
        }
        this._disposed = false;
        PopupManager._instance = this;
        this._ensureRootLayer();
    }

    onDestroy(): void {
        this._disposed = true;
        if (PopupManager._instance === this) {
            PopupManager._instance = null;
        }
        for (const opening of this._openings) opening.cancelled = true;
        const opened = this._stack.splice(0).reverse();
        for (const entry of opened) {
            entry.popup._internalClose(PopupCloseReason.Force);
            if (entry.popup.node?.isValid) entry.popup.node.destroy();
        }
        this._openings.clear();
        this._openingByPath.clear();
        for (const pool of this._cache.values()) {
            for (const node of pool) if (node.isValid) node.destroy();
        }
        this._cache.clear();
        this._assetScope.dispose();
    }

    /** 由应用组合根注入资源端口；缓存节点与 Prefab 引用共用管理器生命周期。 */
    initialize(assets: AssetService, callbackOwners?: ICallbackOwnerRegistry): void {
        if (this._disposed) {
            console.error('[PopupManager] 管理器已销毁，不能再注入资源服务');
            return;
        }
        this._assetService = assets;
        this._callbackOwners = callbackOwners ?? null;
    }

    // ============================================================
    // 打开
    // ============================================================

    /**
     * 打开一个弹窗。
     * 默认同类单实例：已打开时返回现有实例，正在打开时返回同一次任务；
     * 确有多开需求时必须显式传 `allowMultiple: true`。
     * @param cls    弹窗组件类（必须 extends PopupBase 且声明 static prefabPath）
     * @param params 打开参数
     * @returns 弹窗实例；加载失败或中途被关闭时返回 null
     */
    public openAsync<T extends PopupBase>(
        cls: new () => T,
        params: IPopupOpenParams = {},
    ): Promise<T | null> {
        const root = this.node;
        if (this._disposed || !root || !root.isValid) {
            console.error('[PopupManager] 常驻节点已销毁，无法打开弹窗');
            return Promise.resolve(null);
        }

        const path = (cls as unknown as typeof PopupBase).prefabPath;
        if (!path) {
            console.error(`[PopupManager] ${cls.name} 未声明 static prefabPath，无法定位预制体`);
            return Promise.resolve(null);
        }

        const unique = params.allowMultiple !== true;
        if (unique) {
            const pending = this._openingByPath.get(path);
            if (pending) return pending.promise as Promise<T | null>;
            const opened = this.get(cls);
            if (opened) return Promise.resolve(opened);
        }

        const opening: IPopupOpening = {
            path,
            cls,
            cancelled: false,
            promise: null!,
        };
        const task = this._openNew(cls, params, opening);
        opening.promise = task;
        this._openings.add(opening);
        if (unique) this._openingByPath.set(path, opening);
        const finish = () => this._finishOpening(opening);
        task.then(finish, finish);
        return task;
    }

    private async _openNew<T extends PopupBase>(
        cls: new () => T,
        params: IPopupOpenParams,
        opening: IPopupOpening,
    ): Promise<T | null> {
        const root = this.node;

        const node = await this._obtainNode(opening.path);
        if (!node || this._disposed || !root.isValid || opening.cancelled) {
            if (node && node.isValid) node.destroy();
            if (!opening.cancelled) console.error(`[PopupManager] 加载弹窗预制体失败：${opening.path}`);
            return null;
        }

        // prefab 根节点应挂着 cls 组件；缺了补挂（兼容只有节点没有脚本的历史 prefab）
        let popup = node.getComponent(cls) as T | null;
        if (!popup) {
            console.warn(`[PopupManager] ${opening.path} 根节点没有 ${cls.name} 组件，已自动补挂`);
            popup = node.addComponent(cls) as T;
        }

        // 运行时层级面板直接显示弹窗脚本组件名，便于多弹窗叠加时定位实例。
        // 缓存节点也会经过这里，避免业务运行期间改名后再次打开仍显示旧名称。
        node.name = popup.className;

        // 层级自动修正：UI 节点落到 DEFAULT 层会被 UI 相机整棵忽略（页面全白）。
        // 这里统一按常驻 Popup 节点的层纠正，免去每个 prefab 手工检查。
        PopupManager._fixLayer(node, root.layer);

        if (node.parent !== root) node.setParent(root);
        node.setPosition(0, 0, 0);
        node.active = true;

        const layer = params.layer ?? popup.popupLayer;
        const entry: IPopupInfo = {
            serialId: ++this._serialId,
            popup,
            path: opening.path,
            layer,
            cache: params.cache === true,
        };
        opening.entry = entry;
        this._stack.push(entry);

        if (this._callbackOwners) popup._bindCallbackOwners(this._callbackOwners);
        await popup._internalOpen(entry.serialId, params, layer);

        // onOpen 里可能已经自己 close 了（例如数据加载失败直接关掉）
        if (this._stack.indexOf(entry) < 0) return null;
        if (!node.isValid) {
            this._stack.splice(this._stack.indexOf(entry), 1);
            return null;
        }

        this._refreshDepth();
        this._refreshCover();
        return popup;
    }

    private _finishOpening(opening: IPopupOpening): void {
        this._openings.delete(opening);
        if (this._openingByPath.get(opening.path) === opening) {
            this._openingByPath.delete(opening.path);
        }
    }

    /** openAsync 的同义写法，便于业务书写（返回 Promise，不阻塞调用方继续执行）。 */
    public open<T extends PopupBase>(cls: new () => T, params: IPopupOpenParams = {}): Promise<T | null> {
        return this.openAsync(cls, params);
    }

    // ============================================================
    // 关闭
    // ============================================================

    /**
     * 关闭指定弹窗。
     * @param target 弹窗实例或它的 serialId
     * @param reason 关闭来源，会透传给 PopupBase.onClose(reason)
     */
    public close(target: PopupBase | number, reason: PopupCloseReason = PopupCloseReason.Manual): void {
        const idx = this._indexOf(target);
        if (idx < 0) {
            console.warn(`[PopupManager] close 的目标不在栈内：${typeof target === 'number' ? target : target?.className}`);
            return;
        }

        const entry = this._stack[idx];
        this._stack.splice(idx, 1);

        // 必须先清 opening 记录：onClose 回调里立即重开同类弹窗时，应创建新任务而不是拿到旧 Promise。
        for (const opening of this._openings) {
            if (opening.entry !== entry) continue;
            opening.cancelled = true;
            if (this._openingByPath.get(opening.path) === opening) this._openingByPath.delete(opening.path);
        }

        const node = entry.popup.node;
        entry.popup._internalClose(reason);

        if (entry.cache && node && node.isValid) {
            // 回收进池子：移出场景树并停用，下次 open 复用
            node.removeFromParent();
            node.active = false;
            this._recycle(entry.path, node);
        } else if (node && node.isValid) {
            node.destroy();
        }

        this._refreshDepth();
        this._refreshCover();
    }

    /** 关闭最上层弹窗。 */
    public closeTop(reason: PopupCloseReason = PopupCloseReason.Manual): void {
        const ordered = this._sortedStack();
        const top = ordered[ordered.length - 1];
        if (top) this.close(top.popup, reason);
    }

    /** 关闭栈内所有弹窗（从顶到底依次关，保证每个都能收到正确的 onReveal）。 */
    public closeAll(reason: PopupCloseReason = PopupCloseReason.Force): void {
        for (const opening of this._openings) {
            if (!opening.entry) opening.cancelled = true;
        }
        this._openingByPath.clear();
        let guard = 0;
        while (this._stack.length > 0 && guard < 256) {
            guard += 1;
            this.closeTop(reason);
        }
    }

    /** 关闭栈内所有指定类的弹窗。 */
    public closeByClass<T extends PopupBase>(cls: new () => T, reason: PopupCloseReason = PopupCloseReason.Force): void {
        for (const opening of this._openings) {
            if (opening.cls === cls && !opening.entry) opening.cancelled = true;
            if (opening.cls === cls && this._openingByPath.get(opening.path) === opening) {
                this._openingByPath.delete(opening.path);
            }
        }
        const targets = this._stack.filter((e) => e.popup instanceof cls);
        for (const entry of targets) this.close(entry.popup, reason);
    }

    // ============================================================
    // 查询
    // ============================================================

    /** 栈内是否已有该类的弹窗。 */
    public has<T extends PopupBase>(cls: new () => T): boolean {
        return this._stack.some((e) => e.popup instanceof cls);
    }

    /** 取该类的弹窗实例（同类多开时返回最上层那个）。 */
    public get<T extends PopupBase>(cls: new () => T): T | null {
        const ordered = this._sortedStack();
        for (let i = ordered.length - 1; i >= 0; i--) {
            const popup = ordered[i].popup;
            if (popup instanceof cls) return popup as T;
        }
        return null;
    }

    /** 按 serialId 取弹窗实例。 */
    public getBySerialId(serialId: number): PopupBase | null {
        return this._stack.find((e) => e.serialId === serialId)?.popup ?? null;
    }

    /** 最上层弹窗。 */
    get top(): PopupBase | null {
        const ordered = this._sortedStack();
        return ordered.length > 0 ? ordered[ordered.length - 1].popup : null;
    }

    /** 当前打开的弹窗数量。 */
    get count(): number {
        return this._stack.length;
    }

    /** 是否本管理器打开的弹窗（PopupBase.close 用它决定走管理器还是自销毁）。 */
    public owns(popup: PopupBase): boolean {
        return this._stack.some((e) => e.popup === popup);
    }

    /** 已打开的弹窗列表（按深度从低到高）。 */
    public get openedPopups(): readonly PopupBase[] {
        return this._sortedStack().map((e) => e.popup);
    }

    // ============================================================
    // 内部：实例获取 / 回收
    // ============================================================

    private async _obtainNode(path: string): Promise<Node | null> {
        const pool = this._cache.get(path);
        if (pool && pool.length > 0) {
            const reused = pool.pop();
            if (reused && reused.isValid) return reused;
        }
        if (!this._assetService) {
            console.error('[PopupManager] 尚未注入 AssetService，无法加载弹窗预制体');
            return null;
        }
        try {
            const prefab = await this._assetService.load(path, Prefab, { scope: this._assetScope });
            return instantiate(prefab);
        } catch (error) {
            console.error(`[PopupManager] AssetService.load 失败：${path}`, error);
            return null;
        }
    }

    private _recycle(path: string, node: Node): void {
        let pool = this._cache.get(path);
        if (!pool) {
            pool = [];
            this._cache.set(path, pool);
        }
        pool.push(node);
    }

    // ============================================================
    // 内部：深度与覆盖
    // ============================================================

    /** 按 popupLayer 升序、同层按 serialId 升序排列（数组末尾 = 最上层）。 */
    private _sortedStack(): IPopupInfo[] {
        return this._stack.slice().sort((a, b) => {
            if (a.layer !== b.layer) return a.layer - b.layer;
            return a.serialId - b.serialId;
        });
    }

    /** 重排节点顺序并广播 onDepthChanged。 */
    private _refreshDepth(): void {
        const ordered = this._sortedStack();
        const base = this._baseSiblingIndex();
        for (let i = 0; i < ordered.length; i++) {
            const entry = ordered[i];
            const node = entry.popup.node;
            if (node && node.isValid && node.parent === this.node) {
                //  setSiblingIndex 会把入参 clamp 到 [0, 子节点数-1]，
                // 这里的 i 由 base（= 非弹窗子节点数）偏移而来，永远落在合法区间内。
                node.setSiblingIndex(base + i);
            }
            entry.popup._internalDepthChanged(i);
        }
    }

    /** 弹窗应占据的起始兄弟序号：让弹窗永远压在 Popup 节点下其它常驻子节点之上。 */
    private _baseSiblingIndex(): number {
        const total = this.node.children.length;
        return Math.max(0, total - this._stack.length);
    }

    /** 除最上层外全部标记为「被覆盖」。 */
    private _refreshCover(): void {
        const ordered = this._sortedStack();
        const last = ordered.length - 1;
        for (let i = 0; i < ordered.length; i++) {
            if (i < last) ordered[i].popup._internalCover();
            else ordered[i].popup._internalReveal();
        }
    }

    private _indexOf(target: PopupBase | number): number {
        if (typeof target === 'number') {
            return this._stack.findIndex((e) => e.serialId === target);
        }
        return this._stack.findIndex((e) => e.popup === target);
    }

    // ============================================================
    // 内部：场景定位与层级修正
    // ============================================================

    /** 保证常驻 Popup 节点自身处于 UI_2D 层。 */
    private _ensureRootLayer(): void {
        const expected = PopupManager._uiLayer();
        if (this.node.layer !== expected) {
            console.warn(`[PopupManager] Popup 节点 layer=${this.node.layer} 不是 UI_2D，已自动修正`);
            this.node.layer = expected;
        }
    }

    /** 期望的 UI 层：常驻节点是 DEFAULT 时退回 UI_2D。 */
    private static _uiLayer(): number {
        return Layers.Enum.UI_2D as unknown as number;
    }

    /**
     * 递归把落到 DEFAULT 层的节点改成期望层。
     * UI prefab 里任何一层是 DEFAULT 都会导致「整棵子树被 UI 相机忽略」，
     * 表现出来就是页面空白，是最容易反复踩的坑，所以在管理器统一拦掉。
     */
    private static _fixLayer(node: Node, expected: number): void {
        if (!node || !node.isValid) return;
        const want = expected === (Layers.Enum.DEFAULT as unknown as number) ? PopupManager._uiLayer() : expected;
        if (node.layer === (Layers.Enum.DEFAULT as unknown as number)) {
            node.layer = want;
        }
        const children = node.children;
        for (let i = 0; i < children.length; i++) {
            PopupManager._fixLayer(children[i], want);
        }
    }

    /** 按名字在整棵场景树里找节点（Canvas 下、或任意深度）。 */
    private static _findByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        const children = root.children;
        for (let i = 0; i < children.length; i++) {
            const found = PopupManager._findByName(children[i], name);
            if (found) return found;
        }
        return null;
    }

    /**
     * 定位常驻 Popup 节点；场景里没有就兜底建一个挂在 Canvas 下。
     * 兜底是为了「节点被误删 / 新场景忘了加」时不至于整个弹窗系统瘫痪。
     */
    private static _ensureSceneRoot(): Node | null {
        const scene = director.getScene();
        if (!scene) return null;

        const existed = PopupManager._findByName(scene, POPUP_ROOT_NAME);
        if (existed) return existed;

        const canvas = PopupManager._findCanvas(scene);
        if (!canvas) return null;

        console.warn(`[PopupManager] 场景内未找到常驻节点 ${POPUP_ROOT_NAME}，已在 Canvas 下自动创建`);
        const created = new Node(POPUP_ROOT_NAME);
        created.layer = PopupManager._uiLayer();
        const transform = created.addComponent(UITransform);
        const canvasSize = canvas.getComponent(UITransform)?.contentSize;
        if (canvasSize) transform.setContentSize(canvasSize.width, canvasSize.height);
        created.setParent(canvas);
        created.setPosition(0, 0, 0);
        created.setSiblingIndex(canvas.children.length - 1);
        return created;
    }

    private static _findCanvas(root: Node): Node | null {
        if (root.getComponent(Canvas)) return root;
        const children = root.children;
        for (let i = 0; i < children.length; i++) {
            const found = PopupManager._findCanvas(children[i]);
            if (found) return found;
        }
        return null;
    }

}
