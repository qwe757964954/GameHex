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
 * 「超值礼包」页：子页签栏 + 商品行列表。
 *
 * 底板和装饰固定在 prefab 上；本类只铺视图模型，点击通过回调交给宿主。
 * 列表使用项目虚拟列表，行数随配置表变化，不能改成预摆固定行。
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

    /** 当前页签下的行；`renderItemFn` 按索引实时读取。 */
    private rowViews: IGiftShopRowView[] = [];

    /** 已显示的子页签对应的 `giftShop.type`，下标即显示顺序。 */
    private tabTypes: readonly number[] = [];

    protected onLoad(): void {
        const tabs = this.tabs;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].bind(index, (clicked) => this.emitSelect(clicked));
        }
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
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

    /** 子页签按 x 坐标排序，`_children` 顺序不等于视觉顺序。 */
    private get tabs(): GiftSubTab[] {
        return this.subTabBar.getComponentsInChildren(GiftSubTab)
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    // ============================================================
    // 行列表
    // ============================================================

    private presentRows(rows: readonly IGiftShopRowView[]): void {
        this.rowViews = Array.from(rows);
        this.rowList.refreshList(this.rowViews);
        // 换子页签后回到顶部，避免短列表停在上一页的越界位置。
        this.rowList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染；槽位会被复用，因此每次按当前索引重铺。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(GiftShopRow);
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
