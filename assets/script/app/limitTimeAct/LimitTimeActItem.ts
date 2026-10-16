import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 一个奖励格要的图（宿主预加载后传入）。 */
export interface IRewardSlotView {
    /** 品质框图。 */
    frame: SpriteFrame | null;
    /** 道具图。 */
    icon: SpriteFrame | null;
}

/**
 * 限时活动三页签共用的一行（任务 / 礼包 / 限购）。
 *
 * 老端 `LayerLimitTimeAct` 里三页签共用同一个 `list` 的 item（FGUI `限时活动_元旦` 的
 * `组件_限时活动列表_项`），靠 `setSelectedPage` 切「已领取 / 折扣 / 售罄」等控制器态。
 * 这里把那些控制器态收敛成**显式字段**（按钮三态 + 限购文字 + 折扣文字 + 印章 + 红点），
 * 由宿主按页签类型决定显示 / 隐藏哪个。
 *
 * 字段分工：
 *   - 任务行：`nameLabel`（名字 + 进度）、`actionButton`（前往 / 领取 / 已领取）、`rewardBar`
 *   - 礼包行：`nameLabel`（标题）、`actionButton`（购买）、`limitLabel`（限购 X/Y）、
 *     `discountLabel`（折扣）、`priceLabel`（价格）、`rewardBar`
 *
 * 奖励格（`rewardBar` 下的 `cc.Sprite` 子节点）由宿主**预加载好图**再传进来（复用 `VScrollView`
 * 的回收残影规避约定：这里现加载会先闪一帧上一行的图）。
 */
@ccclass('LimitTimeActItem')
export class LimitTimeActItem extends Component {
    @property({ type: Label, tooltip: 'Name：名字（任务行会拼上进度）' })
    nameLabel: Label = null!;

    @property({ type: Button, tooltip: 'ActionBtn：右侧按钮（前往 / 领取 / 购买）' })
    actionButton: Button = null!;

    @property({ type: Label, tooltip: 'ActionLabel：按钮文字' })
    actionLabel: Label = null!;

    @property({ type: Node, tooltip: 'RewardBar：奖励格容器（子节点是奖励格）' })
    rewardBar: Node = null!;

    @property({ type: Label, tooltip: 'LimitLabel：限购文字（礼包 / 限购行用，任务行置空）' })
    limitLabel: Label = null!;

    @property({ type: Label, tooltip: 'DiscountLabel：折扣文字（礼包 / 限购行用）' })
    discountLabel: Label = null!;

    @property({ type: Label, tooltip: 'PriceLabel：价格文字（礼包 / 限购行用）' })
    priceLabel: Label = null!;

    @property({ type: Node, tooltip: 'RedDot：可领取红点' })
    redDot: Node = null!;

    @property({ type: Node, tooltip: 'TakenStamp：已领取印章（任务行用）' })
    takenStamp: Node = null!;

    /**
     * 铺一个任务行。
     *
     * `phase`：`goto` 前往 / `claimable` 领取 / `taken` 已领取 / `undone` 未完成（不可点）。
     * 无条件写 label（规则 82），不依赖新旧状态短路。
     */
    renderTask(opts: {
        title: string;
        phase: 'goto' | 'claimable' | 'taken' | 'undone';
        rewards: readonly IRewardSlotView[];
    }): void {
        this.nameLabel.string = opts.title;
        this.actionLabel.string = opts.phase === 'claimable' ? '领取'
            : opts.phase === 'taken' ? '已领取'
            : opts.phase === 'undone' ? '未完成' : '前往';
        this.actionButton.node.active = opts.phase !== 'taken';
        this.actionButton.interactable = opts.phase !== 'taken' && opts.phase !== 'undone';
        this.takenStamp.active = opts.phase === 'taken';
        this.redDot.active = opts.phase === 'claimable';
        // 任务行不显示礼包字段
        this.limitLabel.node.active = false;
        this.discountLabel.node.active = false;
        this.priceLabel.node.active = false;
        this.renderRewards(opts.rewards);
    }

    /**
     * 铺一个礼包 / 限购行。
     *
     * `remain`：剩余可购次数；`soldout`：是否售罄。
     */
    renderGoods(opts: {
        title: string;
        priceText: string;
        limitText: string;
        discountText: string;
        soldout: boolean;
        rewards: readonly IRewardSlotView[];
    }): void {
        this.nameLabel.string = opts.title;
        this.actionLabel.string = opts.soldout ? '售罄' : '购买';
        this.actionButton.node.active = true;
        this.takenStamp.active = false;
        this.redDot.active = false;
        this.limitLabel.node.active = opts.limitText.length > 0;
        this.limitLabel.string = opts.limitText;
        this.discountLabel.node.active = opts.discountText.length > 0;
        this.discountLabel.string = opts.discountText;
        this.priceLabel.node.active = opts.priceText.length > 0;
        this.priceLabel.string = opts.priceText;
        this.renderRewards(opts.rewards);
    }

    /** 铺奖励格：按 rewardBar 子节点顺序填，多出来的藏掉。 */
    private renderRewards(rewards: readonly IRewardSlotView[]): void {
        const slots = this.rewardBar.children;
        for (let i = 0; i < slots.length; i += 1) {
            const slot = slots[i];
            const view = rewards[i];
            if (!view) {
                slot.active = false;
                continue;
            }
            slot.active = true;
            const frame = slot.getComponent(Sprite);
            const iconNode = slot.getChildByName('Icon');
            const icon = iconNode?.getComponent(Sprite);
            if (frame && view.frame) frame.spriteFrame = view.frame;
            if (icon && iconNode) {
                if (view.icon) {
                    icon.spriteFrame = view.icon;
                    iconNode.active = true;
                } else {
                    iconNode.active = false;
                }
            }
        }
    }
}
