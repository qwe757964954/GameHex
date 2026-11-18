/**
 * 联盟捐献弹窗。免费档先播广告再发 adv=true，金币档检查次数和货币后发请求。
 * 有意偏离：捐献不弹二次确认，奖励图标由页面预取。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { PopupBase } from '../../framework/ui/PopupBase';
import { LeagueAdButton } from './LeagueAdButton';
import { LeagueDonateEvent, type ILeagueDonateViewState } from './LeagueDonateEvents';
import type { ILeagueDonateSnapshot } from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import {
    fillLeagueText,
    LEAGUE_DONATE_FREE_COUNT_TEMPLATE,
    LEAGUE_DONATE_TITLE,
} from './LeagueTexts';
// `LEAGUE_COIN_RES_ID`（= 10 金币）来自 `LeagueTable`（表常量），**不在** `LeagueTexts`。
// 本节用的两个 `resId` 是两件事：
// · 扣的钱 / 按钮图标 = `roleProperty.coin`(10)；
// · 捐完到手的奖励 = `roleProperty.unionCoin`(11) 与 `unionContri`(13)（后者由快照带过来）。
import { LEAGUE_COIN_RES_ID } from './LeagueTable';

const { ccclass, property } = _decorator;

@ccclass('LeagueDonatePage')
export class LeagueDonatePage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
     */
    static prefabPath = 'ui/League/LeagueDonate';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'ItemCoin/Reward：铜币奖励格' })
    coinSlot: LeagueRewardSlot = null!;

    @property({ type: Label, tooltip: 'ItemCoin/Name：labName「联盟金币*300」' })
    coinName: Label = null!;

    @property({ type: LeagueRewardSlot, tooltip: 'ItemExp/Reward：贡献奖励格' })
    expSlot: LeagueRewardSlot = null!;

    @property({ type: Label, tooltip: 'ItemExp/Name：labName「联盟贡献*10」' })
    expName: Label = null!;

    @property({ type: Label, tooltip: 'LabCount：剩余捐献次数' })
    countLabel: Label = null!;

    @property({ type: LeagueAdButton, tooltip: 'BtnFree：免费捐献（广告未接入 ⇒ 只提示）' })
    freeButton: LeagueAdButton = null!;

    @property({ type: LeagueAdButton, tooltip: 'BtnBuy：金币捐献' })
    buyButton: LeagueAdButton = null!;

    /** 展示资源按快照缓存，避免每次 render 都重取三张图。 */
    private art: ILeagueRewardArt | null = null;
    private artSnapshot: ILeagueDonateSnapshot | null = null;
    /** 正在取图的那份快照；后一次 render 换了快照时，前一次的结果不再落地。 */
    private artRequestSnapshot: ILeagueDonateSnapshot | null = null;

    /** 写请求在飞（视图侧也挡一道，避免重复派发意图）。 */
    private busy = false;

    // 生命周期

    protected onInit(): void {
        const button = this.closeButton.getComponent(Button);
        button.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        this.bindClick(this.freeButton, () => this.emitFree());
        this.bindClick(this.buyButton, () => this.emitCoin());
    }

    protected async onOpen(): Promise<void> {
        this.art = null;
        this.artSnapshot = null;
        this.artRequestSnapshot = null;
        this.busy = false;
    }

    protected onClose(): void {
        this.busy = false;
        this.artRequestSnapshot = null;
    }

    onDestroy(): void {
        super.onDestroy();
    }

    // 意图派发（只报「点了哪颗按钮」，业务判断全在 Controller）

    private emitFree(): void {
        if (this.busy) return;
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: this, kind: 'free' });
    }

    private emitCoin(): void {
        if (this.busy) return;
        EventMgr.instance.emit(LeagueDonateEvent.Intent, { owner: this, kind: 'coin' });
    }

    // 渲染（控制器推来的状态一律绝对赋值）

    /** 弹窗标题（供单测 / 复用方取）。 */
    static get titleText(): string {
        return LEAGUE_DONATE_TITLE;
    }

    render(state: ILeagueDonateViewState): void {
        this.busy = state.busy;
        const snapshot = state.snapshot;
        if (!snapshot) return;
        this.present(snapshot);
        void this.applyArt(snapshot);
    }

    /**
     * 铺界面 —— 老端 `LayerLeagueDonateUI.updateView()` 逐句对照。
     */
    private present(snapshot: ILeagueDonateSnapshot): void {
        // 两件奖励：名字（语言表前缀 + 数量）
        this.coinName.string = snapshot.coinNameText;
        this.expName.string = snapshot.expNameText;

        // 剩余次数
        this.countLabel.string = snapshot.remainText;

        // 免费按钮：「免费」页 + 老端那句「免费：{剩余}/{上限}」+ 红点恒关
        this.freeButton.setPage('free');
        const advRest = Math.max(0, snapshot.config.donateAdvCount - snapshot.todayDonateAdvTimes);
        this.freeButton.setFreeLabel(
            fillLeagueText(LEAGUE_DONATE_FREE_COUNT_TEMPLATE, advRest, snapshot.config.donateAdvCount),
        );
        // 老端：`hasDonateRD()` = 广告剩余次数 > 0，而广告子系统没迁 ⇒ 恒 0 ⇒ 恒关。
        this.freeButton.setRedDot(false);

        // 金币按钮：「金币」页 + 单价；图标由 applyArt 异步补上
        this.buyButton.setPage('coin');
        this.buyButton.setCost(snapshot.config.donateCost);
        this.buyButton.setRedDot(false);
    }

    /** 三张图：两件奖励（11 / 13）+ 金币按钮上那颗**金币**图标（10）。 */
    private async applyArt(snapshot: ILeagueDonateSnapshot): Promise<void> {
        if (this.artSnapshot === snapshot && this.art) {
            this.paintArt(snapshot, this.art);
            return;
        }
        if (this.artRequestSnapshot === snapshot) return;
        this.artRequestSnapshot = snapshot;
        const art = await loadLeagueRewardArt(
            [snapshot.coinResId, snapshot.expResId, LEAGUE_COIN_RES_ID],
            snapshot.items,
            snapshot.resources,
        );
        if (!this.alive || this.artRequestSnapshot !== snapshot) return;
        this.art = art;
        this.artSnapshot = snapshot;
        this.paintArt(snapshot, art);
    }

    private paintArt(snapshot: ILeagueDonateSnapshot, art: ILeagueRewardArt): void {
        const coinFrames = art.framesOf(snapshot.coinResId);
        this.coinSlot.render(coinFrames.frame, coinFrames.icon, snapshot.config.donateGainCoin, true);
        const expFrames = art.framesOf(snapshot.expResId);
        this.expSlot.render(expFrames.frame, expFrames.icon, snapshot.config.donateGainExp, true);
        this.buyButton.setCostIcon(art.iconFrameOf(LEAGUE_COIN_RES_ID));
    }

    // 杂项

    /** 按组件绑按钮（`LeagueAdButton` 的根节点上有 `cc.Button`；缺则 warn）。 */
    private bindClick(button: LeagueAdButton | null, handler: () => void): void {
        if (!button) {
            console.warn('[LeagueDonate] 广告按钮缺失，点击不会生效');
            return;
        }
        const node = button.node;
        const comp = node.getComponent(Button);
        if (comp) comp.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}
