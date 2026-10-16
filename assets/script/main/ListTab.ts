/**
 * ListTab — 演示 Tab：虚拟列表（50 条通知）
 * ------------------------------------------------------------------
 * 列表本体复用现成的、已配好的 `vscroll/VSListTemplate_V` 预制体
 * （自带 Mask + content + item 模板，和 VScrollViewDemo 是同一套用法），
 * 不再手搓 content / item 配置。
 *
 * 取列表组件有两条路：
 *   1. 预制体里已经嵌好这份模板 → Inspector 把 `list` 拖到实例根节点的 VirtualScrollView 上
 *   2. 没嵌 → onSelected 时从 resources 兜底加载一份挂到自己下面
 *
 * 迁移说明：旧版 `extends UITab extends UIBase`，生命周期走 enter(args, done)；
 * 新版走 onInit（备数据）/ onSelected（渲染），并删掉了「程序化补齐 content 节点」的脏兜底。
 * ------------------------------------------------------------------
 */
import { _decorator, instantiate, Label, Node, UITransform } from 'cc';
import { UITab } from '../framework/ui/UITab';
import { UIResources } from '../framework/ui/UIResources';
import { VirtualScrollView } from '../vscrollview/VScrollView';

const { ccclass, property } = _decorator;

/** 现成的完整列表预制体（相对 assets/resources/ui/）。 */
const LIST_TEMPLATE_URL = 'vscroll/VSListTemplate_V';

interface NotifyItem {
    title: string;
    time: string;
}

@ccclass('ListTab')
export class ListTab extends UITab {

    public static prefabUrl: string = 'uidemo/ListTab';

    @property({
        type: VirtualScrollView,
        group: '列表',
        tooltip: '列表组件（内置 VSListTemplate_V 实例的根节点上）',
    })
    list: VirtualScrollView | null = null;

    private data: NotifyItem[] = [];
    /** renderItemFn 只需绑一次。 */
    private _bound: boolean = false;

    protected onInit(): void {
        this.data = Array.from({ length: 50 }, (_, i) => ({
            title: `通知条目 ${i + 1}`,
            time: `2026.09.${(i % 30) + 1}`,
        }));
        console.log(`[ListTab] 数据准备完成，共 ${this.data.length} 条`);
    }

    protected onSelected(): void {
        this.renderList().catch((error) => {
            console.error('[ListTab] 渲染列表失败', error);
        });
    }

    private async renderList(): Promise<void> {
        const list = await this.ensureList();
        if (!list) return;

        if (!this._bound) {
            this._bound = true;
            list.renderItemFn = (itemNode: Node, index: number): void => {
                const item = this.data[index];
                if (!item) return;
                const titleLabel = itemNode.getChildByName('title')?.getComponent(Label);
                const timeLabel = itemNode.getChildByName('time')?.getComponent(Label);
                if (titleLabel) titleLabel.string = item.title;
                if (timeLabel) timeLabel.string = item.time;
            };
        }

        list.refreshList(this.data);
        console.log(`[ListTab] 列表已刷新，共 ${this.data.length} 条`);
    }

    /** 取列表组件：优先用预制体里嵌好的实例，其次从 resources 兜底加载一份。 */
    private async ensureList(): Promise<VirtualScrollView | null> {
        if (this.list && this.list.isValid) return this.list;

        const prefab = await UIResources.loadAsync(LIST_TEMPLATE_URL);
        if (!prefab) return null;
        if (!this.node || !this.node.isValid) return null;

        const listNode = instantiate(prefab);
        listNode.name = 'List';
        listNode.setParent(this.node);
        // 模板根节点锚点是 (0.5, 1)，把顶边贴住本 Tab 的顶边
        const height = this.node.getComponent(UITransform)?.contentSize.height ?? 0;
        listNode.setPosition(0, height / 2, 0);

        const list = listNode.getComponent(VirtualScrollView);
        if (!list) {
            console.error(`[ListTab] ${LIST_TEMPLATE_URL} 根节点上找不到 VirtualScrollView`);
            listNode.destroy();
            return null;
        }
        this.list = list;
        console.log('[ListTab] 兜底加载列表模板成功');
        return list;
    }
}
