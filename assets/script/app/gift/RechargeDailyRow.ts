import { _decorator, Button, Component, Label, Node } from 'cc';
import { GiftRewardSlot } from './GiftRewardSlot';
import type { IGiftSlotFrame } from './GiftRewardSlot';
import { RechargeProgressBar } from './RechargeProgressBar';
import type { RechargeDailyButtonKey } from './RechargeDailyTable';

const { ccclass, property } = _decorator;

/** 每日充值一行的四态按钮文案（由宿主从 `GiftTexts.RECHARGE_TEXTS` 组装后传进来）。 */
export interface IRechargeDailyButtonTexts {
    readonly locked: string;
    readonly goto: string;
    readonly claim: string;
    readonly taken: string;
}

/**
 * 每日充值页的一行，由虚拟列表复用。
 *
 * 未开启、前往充值、领取、已领取四态互斥，每帧全量赋值；
 * 进度条只在「前往充值」态显示。
 */
@ccclass('RechargeDailyRow')
export class RechargeDailyRow extends Component {
    @property({ type: Label, tooltip: 'Desc：行描述' })
    descLabel: Label = null!;

    @property({ type: RechargeProgressBar, tooltip: 'Progress：金币进度条（仅「前往充值」态显示）' })
    progress: RechargeProgressBar = null!;

    @property({ type: GiftRewardSlot, tooltip: 'Goods0：第一个奖励格' })
    goods0: GiftRewardSlot = null!;

    @property({ type: GiftRewardSlot, tooltip: 'Goods1：第二个奖励格' })
    goods1: GiftRewardSlot = null!;

    @property({ type: Node, tooltip: 'BtnLock：未开启按钮（静态，不可点）' })
    btnLock: Node = null!;

    @property({ type: Label, tooltip: 'BtnLock 的文案' })
    btnLockLabel: Label = null!;

    @property({ type: Button, tooltip: 'BtnGoto：前往充值按钮' })
    btnGoto: Button = null!;

    @property({ type: Label, tooltip: 'BtnGoto 的文案' })
    btnGotoLabel: Label = null!;

    @property({ type: Button, tooltip: 'BtnClaim：领取按钮' })
    btnClaim: Button = null!;

    @property({ type: Label, tooltip: 'BtnClaim 的文案' })
    btnClaimLabel: Label = null!;

    @property({ type: Label, tooltip: 'TakenText：已领取文字' })
    takenText: Label = null!;

    /** 宿主点按钮时回调；回调按索引读取当前行。 */
    onAction: (() => void) | null = null;

    protected onLoad(): void {
        for (const button of [this.btnGoto, this.btnClaim]) {
            button.node.on(Button.EventType.CLICK, () => this.onAction?.(), this);
        }
    }

    render(
        desc: string,
        state: RechargeDailyButtonKey,
        currentCoin: number,
        targetCoin: number,
        texts: IRechargeDailyButtonTexts,
        slots: readonly IGiftSlotFrame[],
    ): void {
        this.node.active = true;
        this.descLabel.string = desc;

        this.progress.node.active = state === 'goto';
        if (state === 'goto') this.progress.render(currentCoin, targetCoin);

        this.btnLock.active = state === 'locked';
        this.btnGoto.node.active = state === 'goto';
        this.btnClaim.node.active = state === 'claim';
        this.takenText.node.active = state === 'taken';

        this.btnLockLabel.string = texts.locked;
        this.btnGotoLabel.string = texts.goto;
        this.btnClaimLabel.string = texts.claim;
        this.takenText.string = texts.taken;

        const views = [this.goods0, this.goods1];
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
