/**
 * UITab — 页内标签子页
 * ------------------------------------------------------------------
 * 与弹窗（PopupBase）的分工：
 *   PopupBase  整页 / 弹窗：进 PopupManager 的栈，参与深度排序、遮罩与 onCover/onReveal
 *   UITab      页内子页：挂在 UITabContainer 的 content 下，**不进栈**，
 *              只负责「同一页里当前显示哪一块内容」
 *
 * 生命周期（全部由 UITabContainer 驱动，业务不要直接调 `_markXxx`）：
 *   onInit()        实例化完成、挂到 content 之后调用一次 —— 做数据准备
 *   onSelected()    被选中时调用（可能多次）—— 刷新显示 / 启动动效
 *   onUnselected()  被切走时调用（可能多次）—— 停动效 / 收资源
 *
 * 约定：本组件的 `node.active` 就是「是否被选中」，容器负责切换，
 *       子类不要自己去改 `node.active`。
 *
 *  本文件原先 `extends UIBase`（旧 UI 框架）；旧框架下线后改为直接
 *    `extends Component`，只依赖 cc + UIResources。
 * ------------------------------------------------------------------
 */
import { _decorator, Component, instantiate, Node, Prefab } from 'cc';
import { UIResources } from './UIResources';

const { ccclass } = _decorator;

@ccclass('UITab')
export class UITab extends Component {

    /**
     * 必填：本 Tab 预制体在 `assets/resources/ui/` 下的相对路径，如 `'uidemo/ListTab'`。
     * 由 UITabContainer.addTab 读取，用来实例化。
     */
    public static prefabUrl: string = '';

    /** 是否已走过一次 onInit。 */
    private _inited: boolean = false;
    /** 是否处于选中状态。 */
    private _selected: boolean = false;
    /** 关联的 Tab 按钮节点。 */
    private _tabBtn: Node | null = null;

    // ============================================================
    // 子类覆写点
    // ============================================================

    /** 实例化完成、挂到 content 之后调用一次。适合准备数据、绑列表回调。 */
    protected onInit(): void {
        // 子类覆写
    }

    /** 被选中。适合刷新显示、播入场动效。 */
    protected onSelected(): void {
        // 子类覆写
    }

    /** 被切走。适合停动效、收资源。 */
    protected onUnselected(): void {
        // 子类覆写
    }

    // ============================================================
    // 由 UITabContainer 驱动（业务不要直接调用）
    // ============================================================

    /** @internal 绑定关联的 Tab 按钮节点。 */
    public _bindButton(btn: Node | null): void {
        this._tabBtn = btn;
    }

    /** @internal 标记初始化完成并触发 onInit（只生效一次）。 */
    public _markInited(): void {
        if (this._inited) return;
        this._inited = true;
        try {
            this.onInit();
        } catch (error) {
            console.error(`[UITab] ${this.node.name}.onInit 抛错:`, error);
        }
    }

    /** @internal 标记选中。 */
    public _markSelected(): void {
        this._selected = true;
        this.node.active = true;
        if (!this._inited) return;
        try {
            this.onSelected();
        } catch (error) {
            console.error(`[UITab] ${this.node.name}.onSelected 抛错:`, error);
        }
    }

    /** @internal 标记未选中。 */
    public _markUnselected(): void {
        const wasSelected = this._selected;
        this._selected = false;
        if (this.node && this.node.isValid) this.node.active = false;
        if (!wasSelected || !this._inited) return;
        try {
            this.onUnselected();
        } catch (error) {
            console.error(`[UITab] ${this.node.name}.onUnselected 抛错:`, error);
        }
    }

    // ============================================================
    // 公开 API
    // ============================================================

    /**
     * 加载并实例化本 Tab 的预制体，挂到 parent 下。
     * @returns 实例化出来的 UITab 组件（未选中）；失败返回 null
     */
    public async instantiatePrefab(parent: Node): Promise<UITab | null> {
        const cls = this.constructor as typeof UITab;
        const url = cls.prefabUrl;

        if (!url) {
            console.error(`[UITab] ${cls.name}.prefabUrl 未设置`);
            return null;
        }

        const prefab: Prefab | null = await UIResources.loadAsync(url);
        if (!prefab) {
            console.error(`[UITab] 加载 ${url} 失败`);
            return null;
        }

        const node = instantiate(prefab);
        node.setParent(parent);
        node.setPosition(0, 0, 0);

        const tab = node.getComponent(cls) as UITab | null;
        if (!tab) {
            console.error(
                `[UITab] ${url} 预制体根节点上没有 ${cls.name} 组件。\n` +
                `请确认预制体根节点挂了 ${cls.name}（@ccclass + extends UITab）。`,
            );
            node.destroy();
            return null;
        }
        return tab;
    }

    /** 是否处于选中状态。 */
    public get isSelected(): boolean {
        return this._selected;
    }

    /** 关联的 Tab 按钮节点。 */
    public get tabBtn(): Node | null {
        return this._tabBtn;
    }
}
