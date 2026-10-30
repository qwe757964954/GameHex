import { _decorator, Component, Label, Node } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';
import type { IGiftSlotFrame } from './GiftRewardSlot';
import type { RechargeRowState } from './RechargeActivityTable';

const { ccclass, property } = _decorator;

/** 累计充值一行的按钮文案（由宿主从 `GiftTexts.RECHARGE_TEXTS` 组装后传进来）。 */
export interface IRechargeTotalRowTexts {
    readonly claim: string;
    readonly goto: string;
}

/**
 * 累计充值页**一行**（642×176，`RechargeTotalPage/List/content/RowTemplate`，被虚拟列表 clone 复用）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/累计充值页面/组件_活动列表_项.xml`：
 *   `Bg`（`leichongbg`）+ `Title`（「充值 N 元 (M/N)」）+ `RewardList`（最多 5 个 85×85 奖励格，间距 5）
 *   + 三态按钮区（`BtnClaim` 领取 / `BtnUndone` 前往 / `TakenIcon` 已领取图标）
 *   + 限购文本（`每周限购：10/10`，只有限购档才显示）。
 *
 * ⚠️ 三态**互斥且绝对赋值**（虚拟列表复用同一批槽位）。
 * ⚠️ 奖励格固定 5 个：超出「本行奖励数」的整格 `hide()`，位置**不重排**
 *   （对齐 FGUI `list` 从左往右铺的行为），所以不需要 `cc.Layout`。
 * ⚠️ 按钮 = 底图 Sprite + Label 子节点（技能 §10.3），文案必须显式绑 Label。
 */
@ccclass('RechargeTotalRow')
export class RechargeTotalRow extends Component {
    @property({ type: Label, tooltip: 'Title：档位标题' })
    titleLabel: Label = null;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods0：第 1 个奖励格' })
    goods0: GiftRewardSlot = null;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods1：第 2 个奖励格' })
    goods1: GiftRewardSlot = null;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods2：第 3 个奖励格' })
    goods2: GiftRewardSlot = null;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods3：第 4 个奖励格' })
    goods3: GiftRewardSlot = null;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods4：第 5 个奖励格' })
    goods4: GiftRewardSlot = null;

    @property({ type: Node, tooltip: 'BtnClaim：领取按钮' })
    btnClaim: Node = null;

    @property({ type: Label, tooltip: 'BtnClaim 的文案' })
    btnClaimLabel: Label = null;

    @property({ type: Node, tooltip: 'BtnUndone：前往按钮（未达成，老端跳商店）' })
    btnUndone: Node = null;

    @property({ type: Label, tooltip: 'BtnUndone 的文案' })
    btnUndoneLabel: Label = null;

    @property({ type: Node, tooltip: 'TakenIcon：已领取图标' })
    takenIcon: Node = null;

    @property({ type: Node, tooltip: 'Limit：限购文本组（不限购时整组隐藏）' })
    limitNode: Node = null;

    @property({ type: Label, tooltip: 'Limit/Title：「每周限购：」' })
    limitTitle: Label = null;

    @property({ type: Label, tooltip: 'Limit/Value：已购/上限' })
    limitValue: Label = null;

    /** 宿主点按钮时回调（领取 / 前往都走它，宿主按 `state` 分派）。 */
    onAction: (() => void) | null = null;

    /** 本行当前状态。 */
    private rowState: RechargeRowState = 'undone';

    get state(): RechargeRowState {
        return this.rowState;
    }

    protected onLoad(): void {
        this.btnClaim.on(Node.EventType.TOUCH_END, () => this.onAction?.(), this);
        this.btnUndone.on(Node.EventType.TOUCH_END, () => this.onAction?.(), this);
    }

    render(
        title: string,
        state: RechargeRowState,
        texts: IRechargeTotalRowTexts,
        slots: readonly IGiftSlotFrame[],
        limitText: string | null,
    ): void {
        this.node.active = true;
        this.rowState = state;
        this.titleLabel.string = title;

        this.btnClaim.active = state === 'claimable';
        this.btnUndone.active = state === 'undone';
        this.takenIcon.active = state === 'taken';
        this.btnClaimLabel.string = texts.claim;
        this.btnUndoneLabel.string = texts.goto;

        this.limitNode.active = limitText !== null;
        if (limitText !== null) {
            this.limitTitle.string = limitText;
            this.limitValue.string = '';
        }

        // ⚠️ 逐格给图（5 个奖励品质可以各不相同）+ 显式重开（上一趟可能被 `hide()` 关过）。
        const views = [this.goods0, this.goods1, this.goods2, this.goods3, this.goods4];
        for (let i = 0; i < views.length; i++) {
            const slot = slots[i];
            if (!slot || !slot.iconFrame) {
                views[i].hide();
                continue;
            }
            views[i].node.active = true;
            views[i].render(slot.qualityFrame, slot.iconFrame);
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
