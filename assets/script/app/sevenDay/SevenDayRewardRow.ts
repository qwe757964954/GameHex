import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RedDot } from '../common/RedDot';
import { SevenDayRewardSlot } from './SevenDayRewardSlot';

const { ccclass, property } = _decorator;

/**
 * 七日狂欢列表里的**一行**（660×180，作为 `RowView` 的 `content` 下第一个子节点充当虚拟列表模板）。
 *
 * 结构对齐 FGUI `七日狂欢/组件/组件_七日狂欢_主界面item.xml`：
 *   行底框（九宫）+ 标题 + 进度 + 奖励格 + 右侧按钮（四个状态）+ 折扣角标 / 已售罄 / 已领取。
 *
 *  ⚠️ 本组件的所有 `@property` 都由 prefab 配好（项目约定：样式与布局全在 Inspector 上）。
 *  ⚠️ 因为整行会被虚拟列表 **clone 复用**，所以 `render()` 里每一处状态都必须**绝对赋值** ——
 *  条件式赋值会让上一行残留的状态串到下一行（规则 10）。
 */
@ccclass('SevenDayRewardRow')
export class SevenDayRewardRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，九宫 `sd_row_bg`）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Title：任务名 / 商品名' })
    titleLabel: Label = null;

    @property({ type: Label, tooltip: 'Progress：进度文案，如 `(3/100)`' })
    progressLabel: Label = null;

    @property({ type: Node, tooltip: 'RewardBar：奖励格容器（下面挂 SevenDayRewardSlot）' })
    rewardBar: Node = null;

    @property({ type: Node, tooltip: 'ActionBtn：右侧按钮（挂 cc.Button）' })
    actionButton: Node = null;

    @property({ type: Label, tooltip: 'ActionBtn/Label：按钮文案' })
    actionLabel: Label = null;

    @property({ type: Sprite, tooltip: 'ActionBtn 的背景 Sprite（按状态换 绿/蓝/红 三张九宫图）' })
    actionBackground: Sprite = null;

    @property({ type: RedDot, tooltip: 'ActionBtn/RedDot：可领取红点（默认隐藏）' })
    actionRedDot: RedDot = null;

    @property({ type: Node, tooltip: 'DiscountTag：折扣角标（`{0}折`，默认隐藏）' })
    discountTag: Node = null;

    @property({ type: Label, tooltip: 'DiscountTag/Label：折扣文案' })
    discountLabel: Label = null;

    @property({ type: Node, tooltip: 'SoldOutIcon：已售罄角标（默认隐藏）' })
    soldOutIcon: Node = null;

    @property({ type: Node, tooltip: 'TakenIcon：已领取角标（默认隐藏）' })
    takenIcon: Node = null;

    @property({ type: SpriteFrame, tooltip: '按钮底图：绿（可领取 / 免费 / 前往）`sd_btn_green`' })
    buttonGreen: SpriteFrame = null;

    @property({ type: SpriteFrame, tooltip: '按钮底图：蓝（购买）`sd_btn_blue`' })
    buttonBlue: SpriteFrame = null;

    @property({ type: SpriteFrame, tooltip: '按钮底图：红（未完成，不可点）`sd_btn_red`' })
    buttonRed: SpriteFrame = null;

    /**
     * 按钮点击回调，**由宿主在每次铺行时重设**（`SevenDayPage` 的 `renderItemFn`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：整行会被虚拟列表 clone 复用，同一个实例会被赋予
     * 不同的行数据；监听绑在**实例**上（`onLoad` 一次），回调里再取「当前行的身份」，
     * 才不会点第 3 行触发第 1 行的请求。
     */
    onAction: (() => void) | null = null;

    /** 奖励格（`rewardBar` 下的子节点，按 x 从左到右排）。 */
    private get slots(): SevenDayRewardSlot[] {
        return this.rewardBar.getComponentsInChildren(SevenDayRewardSlot)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    protected onLoad(): void {
        // 监听挂在**节点自己**上（不是模板节点）：虚拟列表 clone 出来的每个实例各绑一次。
        // `actionButton` 在「已售罄 / 已领取」时被整块 `active=false`，那时按钮本来就不该响应。
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
    }

    private emitAction(): void {
        this.onAction?.();
    }

    /**
     * 铺一行。
     *
     * @param title       任务名 / 商品名
     * @param progress    进度文案，空串 = 不显示
     * @param action      按钮三态：`text` 文案、`tone` 配色、`enabled` 可点、`redDot` 红点
     * @param extras      右侧角标：折扣 / 已售罄 / 已领取
     * @param qualityFrame 奖励格要用的品质框（**由宿主预加载好再传**）
     */
    render(view: {
        readonly title: string;
        readonly progress: string;
        readonly action: { readonly text: string; readonly tone: 'green' | 'blue' | 'red'; readonly enabled: boolean; readonly redDot: boolean };
        readonly discount: string;
        readonly soldOut: boolean;
        readonly taken: boolean;
        readonly qualityFrame: SpriteFrame | null;
        readonly iconFrame: SpriteFrame | null;
    }): void {
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }

        this.titleLabel.string = view.title;
        this.progressLabel.string = view.progress;

        // 按钮：三态共用同一个节点，靠换图 + 文案 + interactable 区分
        this.actionLabel.string = view.action.text;
        this.actionBackground.spriteFrame = view.action.tone === 'green'
            ? this.buttonGreen
            : view.action.tone === 'blue'
                ? this.buttonBlue
                : this.buttonRed;
        const button = this.actionButton.getComponent(Button);
        if (button) button.interactable = view.action.enabled;
        this.actionRedDot.setRedDot(view.action.redDot);

        // 角标互斥：折扣只在「可购买」时出现，售罄 / 已领取各自独立（老端的控制器是互斥的，
        // 这里用「绝对赋值 + 显式互斥」表达同一语义，避免三个角标同时亮）
        this.discountTag.active = view.discount.length > 0 && !view.soldOut && !view.taken;
        this.discountLabel.string = view.discount;
        this.soldOutIcon.active = view.soldOut;
        this.takenIcon.active = view.taken;
        // 角标出现时按钮整体藏掉（老端同样是 gearDisplay 互斥）
        this.actionButton.active = !view.soldOut && !view.taken;

        const slots = this.slots;
        for (let index = 0; index < slots.length; index++) {
            // 现在表里每行只有 1 条奖励，多出来的格子一律藏掉（不是"留着空的"）
            if (index === 0) {
                slots[index].node.active = true;
                slots[index].render(view.qualityFrame, view.iconFrame);
            } else {
                slots[index].hide();
            }
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
