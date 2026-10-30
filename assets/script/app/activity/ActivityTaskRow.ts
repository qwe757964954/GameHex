import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { ActivityRewardSlot } from './ActivityRewardSlot';

const { ccclass, property } = _decorator;

/** 一个奖励格的视图数据。 */
export interface IActivityRewardSlotView {
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
    /** 数量文案（空串即不显示）。由宿主走 `itemNumberTextOf` 生成（`0 ⇒ ''`、纯整数不缩写）。 */
    readonly numberText: string;
}

/** 一行任务的视图数据（由 `LayerActivityPage.buildRowView` 组装）。 */
export interface IActivityTaskRowView {
    /** 标题 + 进度，如 `完成1次装备升级 (1/1)`。 */
    readonly title: string;
    /** 右侧按钮文案（`领取` / `前往` / `未完成`）。 */
    readonly actionText: string;
    /** 右侧按钮底图（可点/不可点/跳转三种配色）。 */
    readonly actionFrame: SpriteFrame | null;
    readonly actionEnabled: boolean;
    /** `已领取` 时整块按钮换成印章，按钮节点隐藏。 */
    readonly actionVisible: boolean;
    readonly redDot: boolean;
    readonly taken: boolean;
    readonly slots: readonly IActivityRewardSlotView[];
}

/**
 * 每日任务列表里的**一行**（679×190，作为 `RowView/content` 下第一个子节点充当虚拟列表模板）。
 *
 * 结构对齐 FGUI `活动/组件/组件_活动列表_项.xml`：
 *   行底框（九宫 `act_row_bg`）+ 标题飘带（`act_row_ribbon`）+ 「标题 (进度/目标)」
 *   + 奖励格（最多 5 个 `ActivityRewardSlot`）+ 右侧按钮（`领取` / `前往` / `未完成` 三态）
 *   + 可领取红点 + 已领取印章。
 *
 *  ⚠️ 本组件的所有 `@property` 都由 prefab 配好（项目约定：样式与布局全在 Inspector 上）。
 *
 *  ⚠️ FGUI 那两个按钮（`按钮_领取` / `按钮_未完成`）是**同一个组件的两个 gearDisplay 分支**，
 *  在 Cocos 里就是一个按钮节点 + 换底图 + 换文案 + `interactable`，没有"两个节点互相顶掉"
 *  带来的"点了没反应"风险。
 *
 *  ⚠️ 因为整行会被虚拟列表 **clone 复用**，所以 `render()` 里每一处状态都必须**绝对赋值** ——
 *  条件式赋值会让上一行残留的状态串到下一行（规则 10）。
 */
@ccclass('ActivityTaskRow')
export class ActivityTaskRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底框（本节点上的 cc.Sprite，九宫 `act_row_bg`）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Title：任务名 + 进度，如 `完成1次装备升级 (1/1)`' })
    titleLabel: Label = null;

    @property({ type: Node, tooltip: 'RewardBar：奖励格容器（下面挂 ActivityRewardSlot）' })
    rewardBar: Node = null;

    @property({ type: Node, tooltip: 'ActionBtn：右侧按钮（挂 cc.Button）' })
    actionButton: Node = null;

    @property({ type: Label, tooltip: 'ActionBtn/Label：按钮文案' })
    actionLabel: Label = null;

    @property({ type: Sprite, tooltip: 'ActionBtn/Bg：按钮底图（按状态换 绿/蓝/灰 三张九宫图）' })
    actionBackground: Sprite = null;

    @property({ type: Node, tooltip: 'ActionBtn/RedDot：可领取红点（默认隐藏）' })
    actionRedDot: Node = null;

    @property({ type: Node, tooltip: 'TakenStamp：已领取印章（`act_taken_stamp`，默认隐藏）' })
    takenStamp: Node = null;

    /**
     * 按钮点击回调，**由宿主在每次铺行时重设**（`LayerActivityPage.renderRow`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：整行会被虚拟列表 clone 复用，同一个实例会被赋予
     * 不同的行数据；监听绑在**实例**上（`onLoad` 一次），回调里再取「当前行的身份」，
     * 才不会点第 3 行去领第 1 行的奖。
     */
    onAction: (() => void) | null = null;

    protected onLoad(): void {
        this.actionButton.on(Button.EventType.CLICK, this.emitAction, this);
    }

    private emitAction(): void {
        this.onAction?.();
    }

    /** 奖励格（`rewardBar` 下的子节点，按 x 从左到右排 —— `_children` 顺序 ≠ 视觉顺序）。 */
    private get slots(): ActivityRewardSlot[] {
        return this.rewardBar.getComponentsInChildren(ActivityRewardSlot)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    render(view: IActivityTaskRowView): void {
        // prefab 上偶尔会漏绑 `background`（本节点自己就是那张底图）—— 兜一下而不是画不出来
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }

        this.titleLabel.string = view.title;

        // 按钮：三态共用同一个节点，靠换图 + 文案 + interactable 区分
        this.actionLabel.string = view.actionText;
        if (view.actionFrame) this.actionBackground.spriteFrame = view.actionFrame;
        const button = this.actionButton.getComponent(Button);
        if (button) button.interactable = view.actionEnabled;
        this.actionRedDot.active = view.redDot;
        this.actionButton.active = view.actionVisible;
        // 印章与按钮互斥（FGUI 是 `状态` 控制器的第 2 页）
        this.takenStamp.active = view.taken;

        const slots = this.slots;
        for (let index = 0; index < slots.length; index++) {
            const slotView = view.slots[index];
            if (!slotView) {
                // 表里奖励比 prefab 槽位少：多余的格子一律**藏掉**（不是"留着空的"）
                slots[index].hide();
                continue;
            }
            slots[index].node.active = true;
            slots[index].render(slotView.qualityFrame, slotView.iconFrame, slotView.numberText);
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
