import { _decorator, Button, Component, Label, Node, SpriteFrame } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 累计充值页顶部的一个宝箱。
 *
 * 已领取时显示开启图且不可点；达到档位但未领取时可点；未达标时不可点。
 */
@ccclass('RechargeChest')
export class RechargeChest extends Component {
    @property({ type: Node, tooltip: 'Closed：未开启宝箱图' })
    closedIcon: Node = null!;

    @property({ type: Node, tooltip: 'Opened：已开启宝箱图' })
    openedIcon: Node = null!;

    @property({ type: Button, tooltip: 'Button：宝箱点击区' })
    button: Button = null!;

    @property({ type: GiftRewardSlot, tooltip: 'Goods：奖励格（70×70）' })
    goods: GiftRewardSlot = null!;

    @property({ type: Label, tooltip: 'Progress：`M/N` 进度文本' })
    progressLabel: Label = null!;

    /** 宿主点宝箱时回调。 */
    onAction: (() => void) | null = null;

    protected onLoad(): void {
        this.button.node.on(Button.EventType.CLICK, () => this.onAction?.());
    }

    render(
        taken: boolean,
        reachable: boolean,
        progressText: string,
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
    ): void {
        // 奖励格和进度文本是宝箱节点的兄弟，显隐必须一起处理。
        this.node.active = true;
        this.goods.node.active = true;
        this.progressLabel.node.active = true;

        this.closedIcon.active = !taken;
        this.openedIcon.active = taken;
        this.button.interactable = !taken && reachable;

        this.progressLabel.string = progressText;
        this.goods.render(qualityFrame, iconFrame);
    }

    hide(): void {
        this.node.active = false;
        this.goods.node.active = false;
        this.progressLabel.node.active = false;
    }
}
