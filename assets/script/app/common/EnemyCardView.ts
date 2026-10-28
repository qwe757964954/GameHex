import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 一张敌军卡要展示什么（关卡提示的「本次出现的敌军」）。 */
export interface IEnemyCardData {
    /** 头像；`null` = 美术缺图（只关图标，卡框和名字照显）。 */
    readonly icon: SpriteFrame | null;
    readonly name: string;
}

/**
 * **敌军卡**（`ui/common/EnemyCard.prefab`）—— 头像 + 名字。
 *
 * 原来这两张卡是 `LevelTipPanel` 里的**内联节点模板**（`itemCreationMode: 0`），
 * 结构和渲染逻辑混在弹窗里。现在拆成独立预制体：
 * 弹窗只提供 `{ icon, name }`，节点引用由 `@property` 绑好，不在运行时 `getChildByName` 找节点。
 *
 * ## 选中框
 *
 * 蓝湖设计稿里当前选中的那张卡外面套一圈黄色括号（切片 `xunazhong`）。
 * 它是**卡自己的子节点**（`SelectedFrame`），由 `setSelected()` 开关 ——
 * 虚拟列表的槽位是**池化复用**的，选中态必须在 `render` 时按当前下标重刷，
 * 不能只在「点中那一张」时设置一次（那样滑走后框会留在别的卡上）。
 */
@ccclass('EnemyCardView')
export class EnemyCardView extends Component {
    @property({ type: Sprite, tooltip: 'Icon：敌军头像' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'EnemyName：敌军名字' })
    nameLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'SelectedFrame：选中框（黄色括号）' })
    selectedFrame: Sprite = null!;

    /**
     * 铺一张卡（幂等）。
     *
     * 缺图**只关图标**：「有框没图」是美术缺图；「整格消失」会被玩家读成「没有这个敌人」。
     */
    render(data: IEnemyCardData): void {
        this.icon.spriteFrame = data.icon;
        this.icon.node.active = data.icon !== null;
        this.nameLabel.string = data.name;
    }

    /** 开关选中框（幂等）。 */
    setSelected(selected: boolean): void {
        this.selectedFrame.node.active = selected;
    }
}
