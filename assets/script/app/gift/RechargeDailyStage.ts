import { _decorator, Component, Label, Node, SpriteFrame } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 每日充值页顶部的一个累计阶段格。
 *
 * 三态：未达标 / 达标未领 / 已领取。文案由宿主传入。
 */
export type RechargeStageState = 'locked' | 'claimable' | 'taken';

@ccclass('RechargeDailyStage')
export class RechargeDailyStage extends Component {
    @property({ type: GiftRewardSlot, tooltip: 'Goods：奖励格（本节点 Sprite 是品质框，子节点 Icon 是道具图）' })
    goods: GiftRewardSlot = null!;

    @property({ type: Label, tooltip: 'DayLabel：下方天数文案（如「累计 2 天」）' })
    dayLabel: Label = null!;

    @property({ type: Node, tooltip: 'ClaimTip：可领奖文字（默认隐藏）' })
    claimTip: Node = null!;

    @property({ type: Node, tooltip: 'CheckMark：已领奖对勾（默认隐藏）' })
    checkMark: Node = null!;

    /** 宿主点这一格时回调；实际请求由宿主判断状态后发送。 */
    onAction: (() => void) | null = null;

    /**
     * 该节点在 prefab 上没有 `cc.Button`，只能直接监听 `TOUCH_END`；
     * 节点带 UITransform，命中检测正常。
     */
    protected onLoad(): void {
        this.node.on(Node.EventType.TOUCH_END, () => this.onAction?.());
    }

    /** 铺一个阶段格；三态全部绝对赋值。 */
    render(dayText: string, state: RechargeStageState, qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        this.node.active = true;
        this.dayLabel.string = dayText;
        this.claimTip.active = state === 'claimable';
        this.checkMark.active = state === 'taken';
        this.goods.render(qualityFrame, iconFrame);
    }

    hide(): void {
        this.node.active = false;
    }
}
