/**
 * UITabContainer — 页内 Tab 容器
 * ------------------------------------------------------------------
 * 挂在弹窗（PopupBase）或任意页面的根节点上，持有若干 UITab，负责：
 *   1. 把 Tab 预制体实例化到「内容挂载点」下
 *   2. 把「按钮根节点/<btnName>」的点击接到 selectTab
 *   3. 保证同一时刻只有一个 Tab 处于激活（选中）状态
 *
 * 节点约定（两个挂载点可以在 Inspector 拖，留空则按名字兜底找）：
 *   <本节点>
 *     tabBtns/                ← buttonRoot
 *       TabBtn_List           ← addTab(ListTab, 'TabBtn_List') 时找的就是这个名字
 *       TabBtn_Settings
 *     content/                ← contentNode，Tab 预制体实例化到这里
 *
 * 它**不进 PopupManager 的栈**，也不参与深度排序 —— 那是弹窗的事。
 * 谁建 Tab 由页面自己决定：通常是弹窗的 onOpen() 里 await container.setup()。
 *
 *  本文件原先 `extends UIBase`（旧 UI 框架）；旧框架下线后改为直接
 *    `extends Component`，自带 findNode，只依赖 cc + UIResources + UITab。
 * ------------------------------------------------------------------
 */
import { _decorator, Component, instantiate, Node, Prefab } from 'cc';
import { UITab } from './UITab';
import { UIResources } from './UIResources';

const { ccclass, property } = _decorator;

/** 内容挂载点的默认节点名。 */
const DEFAULT_CONTENT_NAME = 'content';
/** 按钮根节点的默认节点名。 */
const DEFAULT_BUTTON_ROOT_NAME = 'tabBtns';

@ccclass('UITabContainer')
export class UITabContainer extends Component {

    /** 容器预制体自身的路径（供外部按类加载容器时用）。 */
    public static prefabUrl: string = '';

    @property({
        type: Node,
        tooltip: 'Tab 内容挂载点。留空则自动取名为 content 的直接子节点。',
    })
    contentNode: Node | null = null;

    @property({
        type: Node,
        tooltip: 'Tab 按钮根节点。留空则自动取名为 tabBtns 的直接子节点。',
    })
    buttonRoot: Node | null = null;

    /** 已实例化的 Tab（按添加顺序）。 */
    protected _tabs: UITab[] = [];
    /** 当前选中的 Tab。 */
    protected _selectedTab: UITab | null = null;

    // ============================================================
    // 节点查找
    // ============================================================

    /**
     * 按路径查找子节点，支持 `'a/b/c'` 形式。空路径返回自身。
     */
    public findNode(path: string): Node | null {
        if (!path) return this.node;
        const parts = path.split('/').filter((p) => p.length > 0);
        let cur: Node | null = this.node;
        for (const name of parts) {
            if (!cur) return null;
            cur = cur.getChildByName(name);
        }
        return cur;
    }

    /** 解析内容挂载点（Inspector 绑定优先，其次按名字找）。 */
    protected resolveContentNode(): Node | null {
        if (this.contentNode && this.contentNode.isValid) return this.contentNode;
        const found = this.node.getChildByName(DEFAULT_CONTENT_NAME);
        if (found) {
            this.contentNode = found;
            return found;
        }
        return null;
    }

    /** 解析按钮根节点（Inspector 绑定优先，其次按名字找）。 */
    protected resolveButtonRoot(): Node | null {
        if (this.buttonRoot && this.buttonRoot.isValid) return this.buttonRoot;
        const found = this.node.getChildByName(DEFAULT_BUTTON_ROOT_NAME);
        if (found) {
            this.buttonRoot = found;
            return found;
        }
        return null;
    }

    // ============================================================
    // 增删
    // ============================================================

    /**
     * 加载并添加一个 Tab。
     *
     * 关键点：必须走「实例化预制体 + node.getComponent(tabClass)」拿组件，
     * 不能用 `new tabClass()` 造孤儿 —— 孤儿组件没有 this.node，选中/取消时会直接抛错。
     *
     * @param tabClass Tab 类（extends UITab），必须设置 static prefabUrl
     * @param btnName  关联的按钮节点名（在 buttonRoot 下）
     * @returns 实例化好的 Tab（当前未选中）；失败返回 null
     */
    public async addTab<T extends UITab>(tabClass: new () => T, btnName: string): Promise<T | null> {
        const content = this.resolveContentNode();
        if (!content) {
            console.error(`[UITabContainer] ${this.node.name} 找不到内容挂载点 '${DEFAULT_CONTENT_NAME}'`);
            return null;
        }

        const url = (tabClass as unknown as { prefabUrl: string }).prefabUrl;
        if (!url) {
            console.error(`[UITabContainer] ${tabClass.name}.prefabUrl 未设置`);
            return null;
        }

        const prefab: Prefab | null = await UIResources.loadAsync(url);
        if (!prefab) {
            console.error(`[UITabContainer] 加载 ${url} 失败`);
            return null;
        }

        const node = instantiate(prefab);
        node.setParent(content);
        node.setPosition(0, 0, 0);

        const tab = node.getComponent(tabClass) as T | null;
        if (!tab) {
            console.error(
                `[UITabContainer] ${url} 预制体根节点上没有 ${tabClass.name} 组件。\n` +
                `请确认预制体根节点挂了 ${tabClass.name}（@ccclass + extends UITab）。`,
            );
            node.destroy();
            return null;
        }

        // 先 onInit（此时节点是激活的，onLoad 已跑过），再置为未选中
        tab._markInited();

        const btn = this.resolveButtonRoot()?.getChildByName(btnName) ?? null;
        tab._bindButton(btn);
        if (btn) {
            btn.on(Node.EventType.TOUCH_END, () => this.selectTab(tab), this);
        } else {
            console.warn(`[UITabContainer] 找不到按钮 ${DEFAULT_BUTTON_ROOT_NAME}/${btnName}，该 Tab 无法通过点击切换`);
        }

        this._tabs.push(tab);
        tab._markUnselected();
        return tab;
    }

    /** 销毁所有已添加的 Tab 并清空状态。 */
    public clearTabs(): void {
        for (const tab of this._tabs) {
            if (tab && tab.node && tab.node.isValid) tab.node.destroy();
        }
        this._tabs = [];
        this._selectedTab = null;
    }

    // ============================================================
    // 切换
    // ============================================================

    /** 切换到指定 Tab（已经在选中状态则什么都不做）。 */
    public selectTab(tab: UITab): void {
        if (!tab || this._selectedTab === tab) return;
        if (this._selectedTab) this._selectedTab._markUnselected();
        this._selectedTab = tab;
        tab._markSelected();
    }

    /** 按索引切换。 */
    public selectTabByIndex(index: number): void {
        const tab = this._tabs[index];
        if (tab) this.selectTab(tab);
    }

    /** 当前选中的 Tab。 */
    public get selectedTab(): UITab | null {
        return this._selectedTab;
    }

    /** 全部 Tab（按添加顺序）。 */
    public get tabs(): UITab[] {
        return this._tabs;
    }

    // ============================================================
    // 生命周期
    // ============================================================

    protected onDestroy(): void {
        this.clearTabs();
    }
}
