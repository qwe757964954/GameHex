import { _decorator, Component, Node, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { GiftShopRow } from './GiftShopRow';
import type { IGiftShopRowView } from './GiftShopRow';
import { GiftSubTab } from './GiftSubTab';
import type { IGiftSubTab } from './GiftTable';

const { ccclass, property } = _decorator;

/** 子页签要用的三张图（宿主预加载后传进来）。 */
export interface IGiftSubTabFrames {
    /** 未选中底图（`gf_subtab_off`）。 */
    readonly off: SpriteFrame | null;
    /** 选中底图（`gf_subtab_on`）。 */
    readonly on: SpriteFrame | null;
    /** 子页签 `artKey`（`daily` / `week` / `month`）→ 标题图。 */
    readonly titles: ReadonlyMap<string, SpriteFrame>;
}

/** 一次刷新要的全部展示数据（宿主已把图预加载好、把行组装成视图模型）。 */
export interface IGiftSpecialPresentData {
    readonly subtabs: readonly IGiftSubTab[];
    /** 当前选中的 `giftShop.type`。 */
    readonly selectedType: number;
    readonly subTabFrames: IGiftSubTabFrames;
    readonly rows: readonly IGiftShopRowView[];
}

/**
 * 「超值礼包」页 —— 子页签栏 + 商品行列表。
 *
 * 版面照 FGUI `礼包/组件/子页面/组件_礼包_超值礼包.xml` + `超值礼包子页面/组件_礼包_超值礼包_普通礼包.xml`：
 *   底板 `gf_panel_bg`（597×852）+ 顶部装饰 `gf_deco` + 子页签栏 + 可滚动的商品行列表。
 *   底板与装饰是**静态**的，直接写在 prefab 上（`GiftPage` 只管动态部分）。
 *
 * 分层：本类只做「把视图模型铺到子视图」，取数 / 判定 / 文案全在 `GiftTable` + `GiftPage`；
 * 子页签点击与购买按钮都只**回调**宿主，自己不碰网络。
 *
 * ⚠️ 列表用项目自带的虚拟列表（规则 8）：prefab 里 `RowView/content/RowTemplate` 就是它的模板节点，
 *   运行时被 clone 复用。当前每个子页签最多 15 行（月度礼包）、视口只放得下 2.9 行 ⇒ 必须能滚，
 *   所以**别改成 `cc.ScrollView` + 预摆 N 行**（行数随策划表变，硬编码会静默截断）。
 */
@ccclass('GiftSpecialView')
export class GiftSpecialView extends Component {
    @property({ type: Node, tooltip: 'SubTabBar：子页签栏（挂 3 个 GiftSubTab）' })
    subTabBar: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'RowView：商品行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    /** 点了某个子页签（回传 `giftShop.type`）。 */
    onSelectType: ((type: number) => void) | null = null;

    /** 点了某行的购买按钮（回传 `giftShop.id`）。 */
    onBuy: ((id: number) => void) | null = null;

    /** 当前页签下的行（`renderItemFn` 按 index 现取，不能闭包捕获）。 */
    private rowViews: IGiftShopRowView[] = [];

    /** 已显示的子页签对应的 `giftShop.type`（下标 = 显示序）。 */
    private tabTypes: readonly number[] = [];

    /** `renderItemFn` 只需绑一次（长驻回调）。 */
    private rowRendererBound = false;

    protected onLoad(): void {
        // 子页签各自绑一次点击；回调里**现取** `tabTypes`（铺列表之前它是空的，
        // 所以不能把类型当参数捕获进去）。
        const tabs = this.tabs;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].bind(index, (clicked) => this.emitSelect(clicked));
        }
    }

    /** 铺一次页面（子页签 + 行列表）。 */
    present(data: IGiftSpecialPresentData): void {
        this.presentSubTabs(data);
        this.presentRows(data.rows);
    }

    // ============================================================
    // 子页签
    // ============================================================

    private presentSubTabs(data: IGiftSpecialPresentData): void {
        const tabs = this.tabs;
        this.tabTypes = data.subtabs.map((tab) => tab.type);
        for (let index = 0; index < tabs.length; index++) {
            const tab = data.subtabs[index];
            if (!tab) {
                tabs[index].node.active = false;
                continue;
            }
            tabs[index].node.active = true;
            tabs[index].render(tab.type === data.selectedType, data.subTabFrames.off, data.subTabFrames.on);
            // 拿不到标题图时**保留上一帧**（`GiftSubTab.renderTitle` 自己会跳过 null），
            // 否则模板复用时会把上一个页签的标题串过来。
            tabs[index].renderTitle(data.subTabFrames.titles.get(tab.artKey) ?? null);
        }
    }

    private emitSelect(index: number): void {
        const type = this.tabTypes[index];
        if (type === undefined) return;
        this.onSelectType?.(type);
    }

    /** 子页签（按 x 排序 —— `_children` 序 ≠ 视觉序）。 */
    private get tabs(): GiftSubTab[] {
        return this.subTabBar.getComponentsInChildren(GiftSubTab)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    // ============================================================
    // 行列表
    // ============================================================

    private presentRows(rows: readonly IGiftShopRowView[]): void {
        // ⚠️ 视图模型整体换掉，`renderItemFn` 里按 index **现取**（长驻回调，禁闭包捕获）
        this.rowViews = Array.from(rows);

        const list = this.rowList;
        if (!list) return;
        if (!this.rowRendererBound) {
            this.rowRendererBound = true;
            list.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        list.refreshList(this.rowViews);
        // 换子页签后回到顶部：月度（15 行）滚到底再切每日（8 行）时，
        // 不复位会停在「内容变短后的越界位置」（`refreshList` 内部的 snapToEnd 也会误判）。
        list.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（被 clone 复用的槽位 → 每次都按当前 `rowViews` 重铺）。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(GiftShopRow);
        if (!view) return;

        // 回调按 **index 现取** `rowViews[index]`，不能闭包捕获 `row` ——
        // 同一个实例会被复用到别的下标。捕获的症状 = 点第 3 行买到第 1 行。
        view.onAction = () => {
            const current = this.rowViews[index];
            if (current) this.onBuy?.(current.id);
        };

        const row = this.rowViews[index];
        if (!row) {
            view.hide();
            return;
        }
        node.active = true;
        view.render(row);
    }
}
