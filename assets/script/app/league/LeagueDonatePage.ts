/**
 * 「联盟捐献」弹窗（老端 `play/LayerLeagueDonate`，`ui/League/LeagueDonate`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/商店/组件_联盟_捐献.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「联盟捐献」） | (40,356) **640×567** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `itemCoin`（公用 `组件_联盟_捐献_道具`） | (88,456) **270×180** | `ItemCoin`（底框 + 奖励格 + 名字） |
 * | `itemExp`（同上） | (360,456) **270×180** | `ItemExp` |
 * | `labCount`（26px `#fcf0d6` 居中 + 描边`#000`/2 + bold） | (202,667) 315×36 | `LabCount` |
 * | `btnFree`（`按钮_联盟_广告`，`类型=免费`） | (109,725) 240×110 | `BtnFree`（`LeagueAdButton`） |
 * | `btnBuy`（`按钮_联盟_广告`，`controller="类型,1"`） | (377,725) 240×110 | `BtnBuy`（`LeagueAdButton`） |
 *
 * `popBg` 那组的 relation 是 `center-center,middle-middle` ⇒ 弹窗**恒居中**。
 * 标题骨架按距顶边常数 12.5 / 10 / 10 折算（半高 283.5 ⇒ 条 271、字/闭钮 273.5）。
 *
 * ## 老端行为（`LayerLeagueDonateUI`）与移植取舍
 *
 * 1. **两件奖励**：`itemCoin` 的 `labName` = 「联盟金币*{unionDonateGainCoin}」、物品框图标取
 *    `roleProperty.unionCoin`（**resId 11**）；`itemExp` 同理取 `unionContri`（**resId 13**）。
 *    ⚠️ 文案里的「联盟金币」来自**语言表**（`ALLIANCE_GOLD_COIN`），而 `roleProperty[11].name`
 *    是「**联盟银币**」—— 两者**故意不同**（老端也是 `FW.G_W(...)` 拼的 name）。见 `ILeagueDonateSnapshot`。
 * 2. **`labCount`** = 「剩余捐献次数：{max − today}/{max}」（`REMAINING_DONATION_TIMES`，**带全角冒号**）。
 * 3. **金币按钮**：`类型="金币"`、`icon` = **金币**图标（`roleProperty.coin` = 10）、`labCost` = `unionDonateCost`。
 * 4. **免费按钮的广告路**：老端先 `GetAdvertRestTimes(AdType.unionDonate)`，`<=0` 提示
 *    `LEAGUE_AD_DONATE_LIMIT`，否则 `RequestLeagueDonate(true)`。
 *    广告播放由 `LeagueAd.playLeagueAd()` 承接（**Mock**，无 SDK）⇒ 点「免费」先播广告、
 *    播完才发 `RequestUnionDonate(true)`（**先播后发**，绝不裸发 `adv=true`）。
 *    连带的：`lab_adv` 落 FGUI 的静态串「免费」（编不出真次数）；`com_rd` **恒关**。
 * 5. **金币按钮的流程**：老端 `onClickDonate` 三道关 —— 次数用完 ⇒ `LEAGUE_DONATE_LIMIT`；
 *    钱不够 ⇒ `CheckHaveEnoughCostAndOpenAlert` 弹提示；否则按 `TipsEnum.UnionDonate`
 *    决定「弹确认框」还是「直接发」。**本端照抄前两道关**，第三道见下面的「有意偏离」。
 *
 * ## 本端有意偏离
 *
 * | 处 | 老端 | 本端 | 为什么 |
 * |---|---|---|---|
 * | 确认框文案 | 硬编码 `"是否花费10金币进行联盟捐献？"` | `LEAGUE_DONATE_CONFIRM`（模板，页面填 `donateCost`） | 措辞一字不改，只把写死的数字变活 |
 * | 确认框的「不再提示」 | `共用弹窗/组件_共用弹窗_提示` 带勾选框，勾了写 `TipsEnum.UnionDonate` | **恒问**（复用 `CommonTips`，无勾选框） | Demo3.8 既没有那个弹窗，也没有任何 `cc.CheckBox` 用法；新造一个只为一个勾选框不划算。对未勾过的玩家（默认态）行为**完全一致** |
 * | 钱不够的提示 | `OpenUnEnoughAlert` 详情面板（但联盟这处 `openDetail` 默认 `true`…实测走 tip） | 只 `showTip('{货币名}不足')` | 与 `ModelGoods_1` 的 tip 口径一致；不新造「道具不足」面板 |
 *
 * ## 本端有意增补
 *
 * - `busy` 防连点（老端没有）：捐献是写请求、走 5s 超时（同 `LeagueStorePage`）。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { CommonTips } from '../common/CommonTips';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { LeagueAdButton } from './LeagueAdButton';
import {
    leagueRepository,
    type ILeagueDonateSnapshot,
    type ILeagueRepository,
    type LeagueRequestResult,
} from './LeagueRepository';
import { loadLeagueRewardArt, type ILeagueRewardArt } from './LeagueRewardArt';
import { LeagueRewardSlot } from './LeagueRewardSlot';
import { playLeagueAd } from './LeagueAd';
import {
    fillLeagueText,
    LEAGUE_DONATE_CONFIRM,
    LEAGUE_DONATE_FREE_COUNT_TEMPLATE,
    LEAGUE_DONATE_TITLE,
    LEAGUE_TIP_AD_DONATE_LIMIT,
    LEAGUE_TIP_DONATE_LIMIT,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_NOT_ENOUGH_TEMPLATE,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';
// ⚠️ `LEAGUE_COIN_RES_ID`（= 10 金币）来自 `LeagueTable`（表常量），**不在** `LeagueTexts`。
//    本节用的两个 `resId` 是两件事：
//      · 扣的钱 / 按钮图标 = `roleProperty.coin`(10)；
//      · 捐完到手的奖励 = `roleProperty.unionCoin`(11) 与 `unionContri`(13)（后者由快照带过来）。
import { LEAGUE_COIN_RES_ID } from './LeagueTable';

const { ccclass, property } = _decorator;

@ccclass('LeagueDonatePage')
export class LeagueDonatePage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
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

    /** 本趟快照。 */
    private snapshot: ILeagueDonateSnapshot | null = null;
    private art: ILeagueRewardArt | null = null;

    /** 按钮只绑一次。 */
    private buttonsBound = false;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const button = this.closeButton?.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        else console.warn('[LeagueDonate] CloseBtn 上没有 cc.Button，点击不会生效');

        if (!this.buttonsBound) {
            this.buttonsBound = true;
            this.bindClick(this.freeButton, () => void this.donateFree());
            this.bindClick(this.buyButton, () => void this.donateByCoin());
        }
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取）。 */
    static get titleText(): string {
        return LEAGUE_DONATE_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /** 读一次捐献数据 + 预取两件奖励的图 + 铺界面。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const snapshot = await this.repository.loadDonate();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        // 三张图：两件奖励（11 / 13）+ 金币按钮上那颗**金币**图标（10）
        this.art = await loadLeagueRewardArt(
            [snapshot.coinResId, snapshot.expResId, LEAGUE_COIN_RES_ID],
            snapshot.items,
            snapshot.resources,
        );
        if (!this.alive || revision !== this.revision) return;

        this.present(snapshot);
    }

    /**
     * 铺界面 —— 老端 `LayerLeagueDonateUI.updateView()` 逐句对照。
     */
    private present(snapshot: ILeagueDonateSnapshot): void {
        const art = this.art;

        // 两件奖励：名字（语言表前缀 + 数量）+ 图标格
        if (this.coinName) this.coinName.string = snapshot.coinNameText;
        if (this.expName) this.expName.string = snapshot.expNameText;
        if (this.coinSlot) {
            const frames = art ? art.framesOf(snapshot.coinResId) : { frame: null, icon: null };
            this.coinSlot.render(frames.frame, frames.icon, snapshot.config.donateGainCoin, true);
        }
        if (this.expSlot) {
            const frames = art ? art.framesOf(snapshot.expResId) : { frame: null, icon: null };
            this.expSlot.render(frames.frame, frames.icon, snapshot.config.donateGainExp, true);
        }

        // 剩余次数
        if (this.countLabel) this.countLabel.string = snapshot.remainText;

        // 免费按钮：「免费」页 + 老端那句「免费：{剩余}/{上限}」+ 红点恒关
        if (this.freeButton) {
            this.freeButton.setPage('free');
            const advRest = Math.max(0, snapshot.config.donateAdvCount - snapshot.todayDonateAdvTimes);
            this.freeButton.setFreeLabel(
                fillLeagueText(LEAGUE_DONATE_FREE_COUNT_TEMPLATE, advRest, snapshot.config.donateAdvCount),
            );
            // ⚠️ 老端：`hasDonateRD()` = 广告剩余次数 > 0，而广告子系统没迁 ⇒ 恒 0 ⇒ 恒关。
            this.freeButton.setRedDot(false);
        }

        // 金币按钮：「金币」页 + 金币图标（`roleProperty.coin` = 10）+ 单价
        if (this.buyButton) {
            this.buyButton.setPage('coin');
            this.buyButton.setCost(snapshot.config.donateCost);
            this.buyButton.setCostIcon(art ? art.iconFrameOf(LEAGUE_COIN_RES_ID) : null);
            this.buyButton.setRedDot(false);
        }
    }

    // ============================================================
    // 捐献
    // ============================================================

    /**
     * 点「免费」（广告路）—— 老端 `onClickAdv()`。
     *
     * 本端**不发包**：Demo3.8 没有广告 SDK，`RequestLeagueDonate(true)` 会白拿一次捐献
     * （服务端只看到 `adv=true`，没有任何「看完广告」的凭据）。见 `LEAGUE_AD_PLAYBACK_AVAILABLE`。
     *
     * 提示按老端的两道关照抄，只是把「次数」换成「能力未接入」：
     * 老端是 `adTime <= 0 ⇒ LEAGUE_AD_DONATE_LIMIT`，本端先判「能力有没有」再判次数。
     */
    private async donateFree(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot || snapshot.todayDonateAdvTimes >= snapshot.config.donateAdvCount) {
            FW.showTip(LEAGUE_TIP_AD_DONATE_LIMIT);
            return;
        }
        // ⚠️ **先播后发**：`RequestUnionDonate(true)` 的凭据就是「广告放完了」，没放完就发等于白拿。
        //    这里自己管 `busy` 而不是转 `sendDonate()` —— 后者内部还会 `beginWrite()`，会自我锁死。
        if (!this.beginWrite()) return;
        try {
            const watched = await playLeagueAd();
            if (!watched) {
                FW.showTip(LEAGUE_TIP_FAILED);
                return;
            }
            const result = await this.repository.requestDonate(true, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /**
     * 点「金币」—— 老端 `onClickDonate()` 逐句对照：
     *
     * ```ts
     * if (todayDonateTimes >= unionDonateMaxCount) { showTip(LEAGUE_DONATE_LIMIT); return; }
     * if (!CheckHaveEnoughCostAndOpenAlert([{resId: coin, number: donateCost}])) return;
     * if (!GetTipEnumState(TipsEnum.UnionDonate)) { 弹确认框 } else { RequestLeagueDonate(false) }
     * ```
     */
    private async donateByCoin(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        // ① 次数用完
        if (!snapshot.hasTimes) {
            FW.showTip(LEAGUE_TIP_DONATE_LIMIT);
            return;
        }
        // ② 钱不够
        if (!snapshot.enough) {
            FW.showTip(fillLeagueText(LEAGUE_TIP_NOT_ENOUGH_TEMPLATE, this.coinNameText()));
            return;
        }
        // ③ 二次确认（老端带「不再提示」勾选框，本端恒问 —— 见类头的「有意偏离」）
        const content = fillLeagueText(LEAGUE_DONATE_CONFIRM, snapshot.config.donateCost);
        void CommonTips.open({
            userData: {
                content,
                onSure: () => void this.sendDonate(false),
            },
        });
    }

    /** 发一次捐献（`adv = false` 才真正会走到）。 */
    private async sendDonate(adv: boolean): Promise<void> {
        if (!this.beginWrite()) return;
        try {
            const result = await this.repository.requestDonate(adv, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /** 金币的名字（「金币」）—— 从 `roleProperty` 表取 `resId=10` 那行，取不到退回空串。 */
    private coinNameText(): string {
        return this.snapshot?.resources.get(LEAGUE_COIN_RES_ID)?.name ?? '';
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    /** 写完后按三态收口；成功则重读一次（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 杂项
    // ============================================================

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
        return !!this.node && this.node.isValid;
    }
}
