import { EventMgr } from '../../framework/event/EventMgr';
import { _decorator, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { EnemyCardView } from '../common/EnemyCardView';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { TERRITORY_EVENTS } from '../territory/view/TerritoryEvents';

const { ccclass, property } = _decorator;

/** 一个敌军卡位（头像 + 名字 + 技能描述）。 */
export interface ILevelTipEnemy {
    readonly icon: SpriteFrame | null;
    readonly name: string;
    /** 该敌人的技能描述；空串 = 没有描述。 */
    readonly description: string;
}

/** 「关卡提示」内容。 */
export interface ILevelTipContent {
    readonly title: string;
    readonly enemies: readonly ILevelTipEnemy[];
    /** 描述框的兜底文案（所有敌人都没描述时用）。 */
    readonly description: string;
}

/**
 * 「关卡提示」弹窗 —— 关卡界面右上角感叹号点开（蓝湖「关卡提示」设计稿）。
 *
 * 走 `PopupBase`：它压在「关卡界面」上面这件事由 **popup 深度栈**负责 ——
 * 打开时下层收 `onCover`、关掉后下层收 `onReveal`，页面不用管两个 node 的 active，
 * 也不用手工撑尺寸（`Dim` 用 `cc.Widget` 四边对齐）。
 *
 * ## 敌军列表为什么是虚拟列表
 *
 * 一章的敌军会**超过 3 个**（设计稿只画了 3 张），固定卡位会直接吞掉多出来的敌人。
 * 现在用 `VirtualScrollView`（横向一行、3 列网格）：条数由数据决定、节点按需复用。
 * 卡结构是 `EnemyCard(176×249) > Frame + Icon + EnemyName` —— **名字挂在卡下面**。
 *
 * ## 选中态（对齐蓝湖设计稿）
 *
 * 设计稿里**第一张卡外面套了一圈黄色选中框**（切片 `xunazhong`），
 * 下方描述框显示的是**当前选中那个敌人**的技能描述。
 * 所以：
 * - 描述**逐个敌人**带（`ILevelTipEnemy.description`），不是全部拼一起
 *   （拼一起在超过 3 个敌人时会撑爆描述框）；
 * - 点卡切换选中 ⇒ 描述框跟着换；
 * - 选中框是 `EnemyCard` 自己的一张图（卡内节点），由 `EnemyCardView.setSelected` 开关。
 *
 * ⚠️ 两条硬顺序：
 * 1. **先 `active`（popup 打开即激活）再 `setTotalCount`** —— 隐藏中的 `VirtualScrollView`
 *    槽位还没建，`setTotalCount` 会静默无效（规则 86 的同款坑）。
 * 2. `renderItemFn` / `onItemClickFn` 是 raw function，**只能代码里赋值**，prefab 绑不了。
 *
 */
@ccclass('LevelTipPanel')
export class LevelTipPanel extends PopupBase {
    /** ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/main/`）。 */
    static prefabPath = 'ui/main/LevelTipPanel';

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/TitleLabel：关卡标题（与关卡界面同一份）' })
    private titleLabel: Label = null!;

    @property({ type: VirtualScrollView, group: '节点引用', tooltip: 'Panel/EnemyScroll：敌军列表（横向一行虚拟列表）' })
    private enemyList: VirtualScrollView = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/DescText：敌军描述（当前选中敌人的技能描述）' })
    private descLabel: Label = null!;

    /** 当前这批敌军（`renderItemFn` 按下标取）。 */
    private enemies: readonly ILevelTipEnemy[] = [];

    /**
     * 描述框的兜底文案（所有敌人都没写描述时用）。
     *
     * 🔴 必须**存成字段**：切换选中时要用它兜底，
     * 若只在 `applyContent` 里传一次，切到没描述的敌人就会变成空串。
     */
    private fallbackDescription = '';

    /** 当前选中的敌军下标；`-1` = 没选（描述框空）。 */
    private selectedIndex = -1;

    protected onInit(): void {
        this.enemyList.renderItemFn = this.renderEnemy;
        this.enemyList.onItemClickFn = this.onEnemyClick;
    }

    protected onOpen(userData?: unknown): void {
        if (userData) this.applyContent(userData as ILevelTipContent);
    }

    /** 已开着时换内容（`openAsync` 单实例去重，不重走 `onOpen`）。 */
    applyContent(content: ILevelTipContent, preserveSelection = false): void {
        this.titleLabel.string = content.title;
        this.enemies = content.enemies;
        this.fallbackDescription = content.description;

        // 选中态复位到第一张（设计稿默认选中第一个敌人）；
        // 换内容时旧下标可能已越界 ⇒ 钳回合法范围。
        this.selectedIndex = this.enemies.length > 0
            ? (preserveSelection && this.selectedIndex >= 0 && this.selectedIndex < this.enemies.length ? this.selectedIndex : 0)
            : -1;
        this.refreshSelection();
        this.refreshDescription();

        // 此时节点已激活，槽位建得出来（顺序反了 `setTotalCount` 静默无效）
        this.enemyList.setTotalCount(content.enemies.length);
    }

    protected onClose(): void {
        // 只派发提示自己的关闭：`DETAIL_CLOSE` 会把下面的关卡界面一起收掉
        EventMgr.instance.emit(TERRITORY_EVENTS.LEVEL_TIP_CLOSE);
    }

    /** 单卡渲染：缺图只关图标（「有框没图」是美术缺图，「整格消失」会被读成没有这个敌人）。 */

    private readonly renderEnemy = (card: Node, index: number): void => {
        // 卡是独立预制体，`EnemyCardView` 一定在（`itemPrefab` 焊死），下标也不会越界（`setTotalCount` 就是它的长度）
        const view = card.getComponent(EnemyCardView)!;
        view.render(this.enemies[index]);
        // 选中框跟着当前下标走（槽位是复用的，改下标时要重刷所有卡）
        view.setSelected(index === this.selectedIndex);
    };

    /** 点卡：切选中 ⇒ 描述框换文案 + 选中框重刷。 */
    private readonly onEnemyClick = (_card: Node, index: number): void => {
        if (index === this.selectedIndex) return;
        this.selectedIndex = index;
        this.refreshSelection();
        this.refreshDescription();
    };

    /**
     * 刷新选中框。
     *
     * 槽位是**池化复用**的（`content.children[0]` 不一定是 index 0），
     * 所以要用 `VScrollViewItem.dataIndex` 反查每张卡自己的下标。
     */
    private refreshSelection(): void {
        const content = this.enemyList.content;
        if (!content) return;
        for (const child of content.children) {
            const item = child.getComponent('VScrollViewItem') as { dataIndex?: number } | null;
            const index = item?.dataIndex;
            if (index === undefined || index < 0) continue;
            const view = child.getComponent(EnemyCardView);
            if (!view) continue;
            view.setSelected(index === this.selectedIndex);
        }
    }

    /** 描述框：优先显示选中敌人的描述；它没描述时退回兜底文案。 */
    private refreshDescription(): void {
        const selected = this.selectedIndex >= 0 ? this.enemies[this.selectedIndex] : undefined;
        const text = selected?.description !== undefined && selected.description !== ''
            ? selected.description
            : this.fallbackDescription;
        this.descLabel.string = text;
        this.descLabel.node.active = text !== '';
    }
}
