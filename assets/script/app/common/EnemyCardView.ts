import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 一张敌军卡要展示什么（关卡提示的「本次出现的敌军」）。 */
export interface IEnemyCardData {
    /** 头像；`null` = 美术缺图（只关图标，卡框和名字照显）。 */
    readonly icon: SpriteFrame | null;
    readonly name: string;
}

/**
 * 敌军卡（`ui/common/EnemyCard.prefab`）：头像 + 名字。
 * 弹窗只提供 `{ icon, name }`，节点引用由 `@property` 绑好。
 *
 * 选中框是卡的子节点（`SelectedFrame`），由 `setSelected` 开关；
 * 虚拟列表槽位会复用，选中态必须按当前下标重刷，不能只在点中那一张时设一次。
 */
@ccclass('EnemyCardView')
export class EnemyCardView extends Component {
    @property({ type: Sprite, tooltip: 'Icon：敌军头像' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'EnemyName：敌军名字' })
    nameLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'SelectedFrame：选中框（黄色括号）' })
    selectedFrame: Sprite = null!;

    /** 铺一张卡（幂等）。缺图只关图标：整格消失会被读成「没有这个敌人」。 */
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
