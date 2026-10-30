import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 月卡礼包里的一个奖励格（80×80）。
 * 本节点挂 cc.Sprite 当框，子节点 Icon 显示图标、Count 显示数量。
 */
@ccclass('MonthCardGiftSlot')
export class MonthCardGiftSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（本节点上的 cc.Sprite）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：奖励图标' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Count：数量文案' })
    count: Label = null;

    protected onLoad(): void {
        if (!this.frame) {
            const own = this.getComponent(Sprite);
            if (own) this.frame = own;
        }
    }

    /**
     * 铺一个奖励。图标和框需由宿主预加载好再传入。
     * @param iconFrame 奖励图标；null = 隐藏 Icon
     * @param qualityFrame 框；null = 保留 prefab 静态框
     * @param countText 数量文案
     */
    render(iconFrame: SpriteFrame | null, qualityFrame: SpriteFrame | null, countText: string): void {
        if (qualityFrame) this.frame.spriteFrame = qualityFrame;

        if (iconFrame) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = true;
        } else {
            this.icon.node.active = false;
        }

        this.count.string = countText;
    }

    /** 隐藏此格。 */
    hide(): void {
        this.node.active = false;
    }
}
