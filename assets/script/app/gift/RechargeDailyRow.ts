import { _decorator, Component, Label, Node } from 'cc';
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
 * 每日充值页**一行**（641×176，`DailyPage/List/content/RowTemplate`，被虚拟列表 clone 复用）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/每日充值页面/组件_礼包_每日充值item.xml`：
 *   `Bg`（`hdjm3`）+ `Desc`（「第 N 天充值获取 M 金币」）+ `Progress`（区间金币进度）
 *   + `Goods0` / `Goods1`（两个 90×90 奖励格）+ 四态按钮区
 *   （`BtnLock` 未开启 / `BtnGoto` 前往充值 / `BtnClaim` 领取 / `TakenText` 已领取）。
 *
 * ⚠️ 四态**互斥且绝对赋值**：虚拟列表会把这个模板复用到别的下标，只把该亮的打开、
 * 不清掉上一趟亮着的那个，就会出现「一个按钮压着另一个」。
 * ⚠️ FGUI 原稿里进度条的 `gearDisplay` 只挂在「前往充值」页 ⇒ 只有 `goto` 态显示进度条，照搬。
 *
 * ⚠️ 按钮是「底图 Sprite + Label 子节点」两个东西（技能 §10.3）——
 *   FGUI 的 `Button title` 在 Cocos 里没有对应物，必须显式绑 Label，否则是空按钮且不报错。
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

    @property({ type: Node, tooltip: 'BtnGoto：前往充值按钮' })
    btnGoto: Node = null!;

    @property({ type: Label, tooltip: 'BtnGoto 的文案' })
    btnGotoLabel: Label = null!;

    @property({ type: Node, tooltip: 'BtnClaim：领取按钮' })
    btnClaim: Node = null!;

    @property({ type: Label, tooltip: 'BtnClaim 的文案' })
    btnClaimLabel: Label = null!;

    @property({ type: Label, tooltip: 'TakenText：已领取文字' })
    takenText: Label = null!;

    /** 当前按钮键（宿主回调时按它分派动作）。 */
    private buttonKey: RechargeDailyButtonKey = 'locked';

    /** 宿主点按钮时回调；回调里**按 index 现取**行数据，不要闭包捕获本趟入参。 */
    onAction: (() => void) | null = null;

    /** 本行当前状态（宿主可取，避免再判一次）。 */
    get state(): RechargeDailyButtonKey {
        return this.buttonKey;
    }

    protected onLoad(): void {
        // 两个可点按钮共用同一个回调，动作语义由 `buttonKey` 决定（宿主只需要知道「这一行被点了」）。
        for (const node of [this.btnGoto, this.btnClaim]) {
            node.on(Node.EventType.TOUCH_END, () => this.onAction?.(), this);
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
        this.buttonKey = state;
        this.descLabel.string = desc;

        // 进度条：FGUI 的 gearDisplay 只挂在「前往充值」页
        this.progress.node.active = state === 'goto';
        if (state === 'goto') this.progress.render(currentCoin, targetCoin);

        this.btnLock.active = state === 'locked';
        this.btnGoto.active = state === 'goto';
        this.btnClaim.active = state === 'claim';
        this.takenText.node.active = state === 'taken';

        this.btnLockLabel.string = texts.locked;
        this.btnGotoLabel.string = texts.goto;
        this.btnClaimLabel.string = texts.claim;
        this.takenText.string = texts.taken;

        // ⚠️ 逐格给图（同一行两个奖励品质可以不同）+ 显式重开（上一趟可能被 `hide()` 关过）。
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
