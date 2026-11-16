import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';

const { ccclass, property } = _decorator;

/** 奖励格要画的图（宿主已预加载好）。 */
export interface IGiftRewardView {
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
}

/** 一行商品要铺的视图模型（由 `GiftSpecialView` 的宿主组装好）。 */
export interface IGiftShopRowView {
    /** `giftShop.id` —— 点按钮时回传给宿主的身份（虚拟列表复用节点，只能靠它认行）。 */
    readonly id: number;
    /** 商品名 —— `giftShop.desc`（**不是** `title`）。 */
    readonly title: string;
    /** 限购文案，空串 = 整块隐藏。 */
    readonly limitText: string;
    /** 折扣文案，空串 = 不显示折扣角标。 */
    readonly discountText: string;
    readonly soldOut: boolean;
    /** 购买按钮文案（`免费` 或裸数字 / `60幻灵玉`）。 */
    readonly buyText: string;
    /** `true` 时按钮文案是裸数字、货币靠左侧小图标表达。 */
    readonly showIcon: boolean;
    readonly currencyFrame: SpriteFrame | null;
    readonly rewards: readonly IGiftRewardView[];
}

/**
 * 商品列表的一行，同时充当虚拟列表模板。
 *
 * 售卖状态互斥：
 * - 售罄：隐藏购买按钮，显示已售罄标，折扣角标也隐藏；
 * - 免费：按钮显示“免费”，无货币图标；
 * - 购买：按钮显示价格，带货币图标。
 *
 * 行节点会被虚拟列表复用，`render()` 每次都要全量赋值，不能依赖上一帧状态。
 */
@ccclass('GiftShopRow')
export class GiftShopRow extends Component {
    @property({ type: Label, tooltip: 'Title：商品名（`giftShop.desc`）' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: 'Limit：限购文案（`限购 0/1`）；空串时整块隐藏' })
    limitLabel: Label = null!;

    @property({ type: Node, tooltip: 'RewardBar：奖励格容器（挂 4 个 GiftRewardSlot）' })
    rewardBar: Node = null!;

    @property({ type: Node, tooltip: 'ActionBtn：购买按钮（挂 cc.Button）' })
    actionButton: Node = null!;

    @property({ type: Label, tooltip: 'ActionBtn/Label：按钮文案；无图标时居中' })
    actionLabel: Label = null!;

    @property({ group: '购买按钮', tooltip: '带货币图时 Label 的 x 偏移（让开左侧 34px 的图标）' })
    actionLabelIconX = 16;

    @property({ type: Sprite, tooltip: 'ActionBtn/Icon：按钮左侧货币图标（`免费` 时隐藏）' })
    actionIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'DiscountTag：折扣角标（售罄时隐藏）' })
    discountTag: Node = null!;

    @property({ type: Label, tooltip: 'DiscountTag/Label：折扣文案（`5折`）' })
    discountLabel: Label = null!;

    @property({ type: Node, tooltip: 'SoldOutIcon：已售罄标（售罄时按钮整块让位给它）' })
    soldOutIcon: Node = null!;

    /** 按钮点击回调，由宿主在每次铺行时重设，回调内按索引读取当前行。 */
    onAction: (() => void) | null = null;

    /** 奖励格，按 x 坐标从左到右排序。 */
    private slots: GiftRewardSlot[] = [];

    protected onLoad(): void {
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
        this.slots = this.rewardBar.getComponentsInChildren(GiftRewardSlot)
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    private emitAction(): void {
        this.onAction?.();
    }

    /** 铺一行；虚拟列表会复用本组件，所有状态必须绝对赋值。 */
    render(view: IGiftShopRowView): void {
        this.titleLabel.string = view.title;

        this.limitLabel.string = view.limitText;
        this.limitLabel.node.active = view.limitText.length > 0;

        this.discountLabel.string = view.discountText;
        this.discountTag.active = view.discountText.length > 0 && !view.soldOut;

        this.soldOutIcon.active = view.soldOut;
        this.actionButton.active = !view.soldOut;

        this.actionLabel.string = view.buyText;
        this.actionLabel.node.setPosition(view.showIcon ? this.actionLabelIconX : 0, 0);
        this.actionIcon.spriteFrame = view.currencyFrame;
        this.actionIcon.node.active = view.showIcon && view.currencyFrame != null;

        for (let index = 0; index < this.slots.length; index++) {
            const reward = view.rewards[index];
            if (!reward) {
                this.slots[index].hide();
                continue;
            }
            this.slots[index].node.active = true;
            this.slots[index].render(reward.qualityFrame, reward.iconFrame);
        }
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }
}
