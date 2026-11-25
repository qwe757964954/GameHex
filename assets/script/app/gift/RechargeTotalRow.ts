import { _decorator, Button, Component, Label, Node } from 'cc';
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
 * 累计充值页的一行，由虚拟列表复用。
 *
 * 领取、前往、已领取三态互斥；奖励格固定 5 个，不足的隐藏且不重排。
 */
@ccclass('RechargeTotalRow')
export class RechargeTotalRow extends Component {
    @property({ type: Label, tooltip: 'Title：档位标题' })
    titleLabel: Label = null!;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods0：第 1 个奖励格' })
    goods0: GiftRewardSlot = null!;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods1：第 2 个奖励格' })
    goods1: GiftRewardSlot = null!;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods2：第 3 个奖励格' })
    goods2: GiftRewardSlot = null!;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods3：第 4 个奖励格' })
    goods3: GiftRewardSlot = null!;

    @property({ type: GiftRewardSlot, tooltip: 'RewardList/Goods4：第 5 个奖励格' })
    goods4: GiftRewardSlot = null!;

    @property({ type: Button, tooltip: 'BtnClaim：领取按钮' })
    btnClaim: Button = null!;

    @property({ type: Label, tooltip: 'BtnClaim 的文案' })
    btnClaimLabel: Label = null!;

    @property({ type: Button, tooltip: 'BtnUndone：前往按钮（未达成，老端跳商店）' })
    btnUndone: Button = null!;

    @property({ type: Label, tooltip: 'BtnUndone 的文案' })
    btnUndoneLabel: Label = null!;

    @property({ type: Node, tooltip: 'TakenIcon：已领取图标' })
    takenIcon: Node = null!;

    @property({ type: Node, tooltip: 'Limit：限购文本组（不限购时整组隐藏）' })
    limitNode: Node = null!;

    @property({ type: Label, tooltip: 'Limit/Title：「每周限购：」' })
    limitTitle: Label = null!;

    @property({ type: Label, tooltip: 'Limit/Value：已购/上限' })
    limitValue: Label = null!;

    /** 宿主点按钮时回调，按当前状态分派领取或前往。 */
    onAction: (() => void) | null = null;

    protected onLoad(): void {
        this.btnClaim.node.on(Button.EventType.CLICK, () => this.onAction?.());
        this.btnUndone.node.on(Button.EventType.CLICK, () => this.onAction?.());
    }

    render(
        title: string,
        state: RechargeRowState,
        texts: IRechargeTotalRowTexts,
        slots: readonly IGiftSlotFrame[],
        limitText: string | null,
    ): void {
        this.node.active = true;
        this.titleLabel.string = title;

        this.btnClaim.node.active = state === 'claimable';
        this.btnUndone.node.active = state === 'undone';
        this.takenIcon.active = state === 'taken';
        this.btnClaimLabel.string = texts.claim;
        this.btnUndoneLabel.string = texts.goto;

        this.limitNode.active = limitText !== null;
        if (limitText !== null) {
            this.limitTitle.string = limitText;
            this.limitValue.string = '';
        }

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
