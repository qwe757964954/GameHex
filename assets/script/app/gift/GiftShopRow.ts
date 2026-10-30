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

/** 按钮文案带图标时 Label 的 x 偏移（让开左侧 34px 的货币图）。 */
const LABEL_WITH_ICON_X = 16;

/**
 * 礼包商品列表里的**一行**（503×175，充当「超值礼包」页 `RowView.content` 下第一个子节点，
 * 即虚拟列表的模板）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/超值礼包子页面/组件_礼包_超值礼包_普通礼包item.xml`：
 *   行底框 + 商品名 + 限购文案 + 奖励格（4 格）+ 购买按钮（含货币图 / 免费）+ 折扣角标 + 已售罄标。
 *
 * 状态口径照老端 `SubTabSpecialGiftBase.InitList()`（三态互斥）：
 *   | 状态 | 条件 | 表现 |
 *   |---|---|---|
 *   | 售罄 | `limit > 0 && buyTimes >= limit` | 按钮整块隐藏 + 出「已售罄」标；折扣角标也藏 |
 *   | 免费 | 否则 `cost === 0` | 按钮文案「免费」，无货币图 |
 *   | 购买 | 否则 | 按钮文案 = `cost` 裸数字 + 货币图 |
 *
 * ⚠️ 有两处**有意偏离 FGUI 原稿**，都在 `render()` 里：
 *   ① 购买按钮的文案**居中**（原稿 `title xy=(45,8)` + `pivot 0.5` 会把字摆到按钮左上角外，
 *      而同组件的「免费」分支 `n8 (78,27)` 是正中心 —— 显见是原稿遗留的脏坐标）；
 *   ② 文案带图标时右移 16px（原稿靠 `relation right-left` 让图标贴着字，那个关系同样
 *      基于上面的脏坐标，落地后图标会跑到按钮外面）。
 *
 * ⚠️ 整行会被虚拟列表 **clone 复用** ⇒ `render()` 里每一处状态都必须**绝对赋值**
 *   （规则 10：条件式赋值会让上一行残留的状态串到下一行）。
 */
@ccclass('GiftShopRow')
export class GiftShopRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，`gf_row_bg`）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Title：商品名（`giftShop.desc`）' })
    titleLabel: Label = null;

    @property({ type: Label, tooltip: 'Limit：限购文案（`限购 0/1`）；空串时整块隐藏' })
    limitLabel: Label = null;

    @property({ type: Node, tooltip: 'RewardBar：奖励格容器（挂 4 个 GiftRewardSlot）' })
    rewardBar: Node = null;

    @property({ type: Node, tooltip: 'ActionBtn：购买按钮（挂 cc.Button）' })
    actionButton: Node = null;

    @property({ type: Label, tooltip: 'ActionBtn/Label：按钮文案' })
    actionLabel: Label = null;

    @property({ type: Sprite, tooltip: 'ActionBtn/Icon：按钮左侧货币图标（`免费` 时隐藏）' })
    actionIcon: Sprite = null;

    @property({ type: Node, tooltip: 'DiscountTag：折扣角标（售罄时隐藏）' })
    discountTag: Node = null;

    @property({ type: Label, tooltip: 'DiscountTag/Label：折扣文案（`5折`）' })
    discountLabel: Label = null;

    @property({ type: Node, tooltip: 'SoldOutIcon：已售罄标（售罄时按钮整块让位给它）' })
    soldOutIcon: Node = null;

    /**
     * 按钮点击回调，**由宿主在每次铺行时重设**（`GiftSpecialView.renderRow`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：同一个实例会被虚拟列表复用到别的下标，
     * 回调里必须按 index 现取当前行，才不会点第 3 行买到第 1 行。
     */
    onAction: (() => void) | null = null;

    /** 奖励格（`rewardBar` 下的子节点，按 x 从左到右排）。 */
    private get slots(): GiftRewardSlot[] {
        return this.rewardBar.getComponentsInChildren(GiftRewardSlot)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    protected onLoad(): void {
        // 监听挂在**节点自己**上：虚拟列表 clone 出来的每个实例各绑一次。
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
    }

    private emitAction(): void {
        this.onAction?.();
    }

    /** 铺一行。所有状态绝对赋值（本组件会被虚拟列表复用）。 */
    render(view: IGiftShopRowView): void {
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }

        this.titleLabel.string = view.title;

        // 限购：`limit <= 0` 时文案是空串 → 整块藏掉（FGUI `gearDisplay 限购 = 1`）
        this.limitLabel.string = view.limitText;
        this.limitLabel.node.active = view.limitText.length > 0;

        // 折扣角标：FGUI 是 `gearDisplay 折扣=1` 与 `gearDisplay2 状态∈{免费,购买}` 的**与**关系
        this.discountLabel.string = view.discountText;
        this.discountTag.active = view.discountText.length > 0 && !view.soldOut;

        // 售罄 / 按钮互斥（FGUI 两个 gearDisplay 也是互斥的）
        this.soldOutIcon.active = view.soldOut;
        this.actionButton.active = !view.soldOut;

        this.actionLabel.string = view.buyText;
        // 带图标时让开左侧位置（见类注释里偏离②）。`免费` 是纯文案，回正中心。
        this.actionLabel.node.setPosition(view.showIcon ? LABEL_WITH_ICON_X : 0, 0);
        const showIcon = view.showIcon && view.currencyFrame != null;
        if (view.currencyFrame) this.actionIcon.spriteFrame = view.currencyFrame;
        this.actionIcon.node.active = showIcon;

        const slots = this.slots;
        for (let index = 0; index < slots.length; index++) {
            const reward = view.rewards[index];
            if (!reward) {
                slots[index].hide();
                continue;
            }
            slots[index].node.active = true;
            slots[index].render(reward.qualityFrame, reward.iconFrame);
        }
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }
}
