import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RedDot } from '../common/RedDot';
import { Toast } from '../common/Toast';
import { CelebrationFrames } from './CelebrationFrames';
import { OSTabButton } from './OSTabButton';
import { OSTargetItem } from './OSTargetItem';
import { OSRankItem } from './OSRankItem';
import { OSShopItem } from './OSShopItem';
import { OSRankRankDetailPage } from './OSRankRankDetailPage';
import {
    CL_NOT_IN_RANK,
    CL_TAB_COUNT,
    celebrationRepository,
    celebrationSelfRoleId,
    countdownTextOf,
    myRankValueTextOf,
    targetHeaderTextOf,
    targetStateOf,
} from './CelebrationRepository';
import type {
    ICelebrationShopRow,
    ICelebrationSnapshot,
    ICelebrationTargetRow,
} from './CelebrationRepository';
import { CL_TEXTS } from './CelebrationTexts';
import { ECelebrationTab, ECelebrationTargetRewardType } from './CelebrationTable';

const { ccclass, property } = _decorator;

/**
 * 开服庆典主容器（prefab `ui/Celebration/OSRank`，720×1280），老端 `LayerOSRankUI`。
 *
 * 页签显隐照 FGUI 的 `页签` 控制器（`0,庆典目标 / 1,庆典排名 / 2,限时特惠`）：
 * 设计期 `selected="1"`，首次打开停在庆典排名页，不是目标页。
 * `list_target` / `list_rank` / `list_goods`、列头 group `n123`（6 件）、底部说明 `n105`
 * 都跟着页签切；`btn_rank`、`btn_help`、`btn_go_build`、`lab_proty` + `lab_my_power`、
 * `n99` + `lab_my_rank` 没有 gear，三页常显，不要跟着切。
 *
 * 老端有三个刷新入口：`UpdateTime()`（每秒只刷倒计时）、`updateView()`（铺按钮 / 文案 / 当前页签列表 /
 * 目标页签红点）、`updateRank()`（`CmdGetRankReqMsg{showNum:1}` 只取 `myRank`）。
 * 这里同构：`onOpen` → `reload()` + `updateMyRank()`，`schedule(_tick, 1)` 只刷倒计时，
 * 不把 `reload()` 塞进每秒（那会每秒重读五张表 + 重发查排名）。
 *
 * 老端靠 `VOCelebrationBag` / `ModelRank` 的变更事件重刷，本工程这两份数据只有 `CacheMgr`、没有变更通知，
 * 所以改成动作后主动重刷：领奖 / 购买成功各 `await reload()` 一次。本界面是独占全屏层，没有「别处改了要跟」的路径。
 *
 * 虚拟列表三条约定：
 * 1. `renderItemFn` 只在 `onInit` 绑一次，行内容按 `index` 现取 `this._snapshot`，不把 `rows` 闭包进去；
 * 2. 先 `applyTab()` 再 `pushList()`：槽位在 `VirtualScrollView.start()` 里建，节点隐藏时不建，
 *    隐藏时 `setTotalCount` 静默无效；
 * 3. `VirtualScrollView` 会在 `start()` 就绪后自动补跑待铺条数，无需手动等帧。
 */

/** 倒计时刷新间隔（老端 `toolSet.addTimer(1000, this.UpdateTime, this)`）。 */
const CL_TICK_SECONDS = 1;

/** 首次打开停在哪一页 —— FGUI 原稿 `页签 selected="1"`。 */
export const CL_DEFAULT_TAB = 1;

@ccclass('OSRankPage')
export class OSRankPage extends PopupBase {
    static prefabPath = 'ui/Celebration/OSRank';

    @property({ type: Label, tooltip: 'RefreshTime：倒计时 13:16:55后刷新（FGUI refreshTime）' })
    refreshTime: Label = null!;

    @property({ type: Label, tooltip: 'MyPowerLabel：战力口径名（FGUI lab_proty，运行时被 config.name 覆盖）' })
    myPowerLabel: Label = null!;

    @property({ type: Label, tooltip: 'MyPowerValue：当前进度值（FGUI lab_my_power；老端直接 setText，不缩写）' })
    myPowerValue: Label = null!;

    @property({ type: Label, tooltip: 'MyRankLabel：我的名次:（FGUI n99，静态文案）' })
    myRankLabel: Label = null!;

    @property({ type: Label, tooltip: 'MyRankValue：第3名 / 未上榜（FGUI lab_my_rank）' })
    myRankValue: Label = null!;

    @property({ type: Label, tooltip: 'FooterTip：邮件发放说明（FGUI n105，只在排名页可见；原文「多钱」是错别字，照抄）' })
    footerTip: Label = null!;

    @property({ type: [Node], tooltip: '列头底图 + 文案（FGUI group n123 的 6 个成员，只在排名页可见）：Header1/2/3 + HeaderLabel1/2/3' })
    rankHeaderNodes: Node[] = [];

    @property({ type: Label, tooltip: '列头第三格 {战力口径}要求（FGUI lab_proty1，只在排名页可见）' })
    rankHeaderLabel3: Label = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListTarget：庆典目标列表（FGUI list_target）' })
    listTarget: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListRank：庆典排名列表（FGUI list_rank）' })
    listRank: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListShop：限时特惠列表（FGUI list_goods）' })
    listShop: VirtualScrollView = null!;

    @property({ type: OSTabButton, tooltip: 'TabTarget：庆典目标页签（FGUI 按钮_庆典目标）' })
    tabTarget: OSTabButton = null!;

    @property({ type: OSTabButton, tooltip: 'TabRank：庆典排名页签（FGUI 按钮_庆典排名）' })
    tabRank: OSTabButton = null!;

    @property({ type: OSTabButton, tooltip: 'TabShop：限时特惠页签（FGUI 按钮_庆典特惠）' })
    tabShop: OSTabButton = null!;

    @property({ type: Node, tooltip: 'BackBtn：返回（FGUI 按钮_返回）' })
    backBtn: Node = null!;

    @property({ type: Node, tooltip: 'RankDetailBtn：详细排名>（FGUI btn_rank）' })
    rankDetailBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'RankDetailBtn/RedDot：老端从不点亮，每趟写 false（工程通用红点）' })
    rankDetailRedDot: RedDot = null!;

    @property({ type: Node, tooltip: 'HelpBtn：帮助（FGUI btn_help）' })
    helpBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'HelpBtn/RedDot：老端从不点亮，每趟写 false（工程通用红点）' })
    helpRedDot: RedDot = null!;

    @property({ type: Node, tooltip: 'GoBuildBtn：前往提升>（FGUI btn_go_build）' })
    goBuildBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'GoBuildBtn/RedDot：老端从不点亮，每趟写 false（工程通用红点）' })
    goBuildRedDot: RedDot = null!;

    /** 当前快照（`reload()` 写入；未加载时为 `null`）。 */
    private _snapshot: ICelebrationSnapshot | null = null;

    /** 本次打开用的图帧表，`onClose` 里 dispose。 */
    private _frames: CelebrationFrames | null = null;

    /** 当前页签（见 `ECelebrationTab`）。 */
    private _tab: number = CL_DEFAULT_TAB;

    protected onInit(): void {
        this.backBtn.on('click', this._onBack, this);
        this.rankDetailBtn.on('click', this._onRankDetail, this);
        this.helpBtn.on('click', this._onHelp, this);
        this.goBuildBtn.on('click', this._onGoBuild, this);

        this.tabTarget.onTap = () => this.selectTab(ECelebrationTab.Target);
        this.tabRank.onTap = () => this.selectTab(ECelebrationTab.Rank);
        this.tabShop.onTap = () => this.selectTab(ECelebrationTab.Shop);

        // 三个列表各绑自己的分支，页签切换不需要重绑。
        this.listTarget.renderItemFn = this._renderTargetRow;
        this.listRank.renderItemFn = this._renderRankRow;
        this.listShop.renderItemFn = this._renderShopRow;
    }

    protected async onOpen(): Promise<void> {
        this._tab = CL_DEFAULT_TAB;
        await this.reload();
        void this.updateMyRank();
        this.schedule(this._tick, CL_TICK_SECONDS);
    }

    /**
     * 只停表 + 释放图帧，不写 `off(...)`：同节点组件按 `_components` 序销毁，
     * 销毁期访问事件 API 会抛 TypeError 并中断销毁链。事件由节点销毁统一解除。
     */
    protected onClose(): void {
        this.unschedule(this._tick);
        this._snapshot = null;
        this._frames?.dispose();
        this._frames = null;
    }

    /** 读表 + 预加载图 + 铺一次（老端 `updateView()` 的数据部分）。 */
    async reload(): Promise<void> {
        const snapshot = await celebrationRepository.load();
        // 等表期间面板可能已经关了；节点销毁后再往下写会把真正的原因盖掉。
        if (!this.isValid || !this.node.isValid) return;

        const frames = new CelebrationFrames();
        await frames.preload(snapshot);
        if (!this.isValid || !this.node.isValid) {
            frames.dispose();
            return;
        }

        this._frames?.dispose();
        this._frames = frames;
        this._snapshot = snapshot;

        this.applySnapshot();
        this.pushList();
    }

    /** 用当前快照铺一次（同步，探针可直接调）。 */
    applySnapshot(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        this._refreshCountdown();

        this.myPowerLabel.string = snapshot.config ? snapshot.config.name : CL_TEXTS.powerLabelFallback;
        this.myPowerValue.string = `${Math.floor(snapshot.curValue)}`;
        this.myRankLabel.string = CL_TEXTS.myRankLabel;
        this.footerTip.string = CL_TEXTS.footerTip;
        this.rankHeaderLabel3.string = targetHeaderTextOf(snapshot);

        this.applyTab();
    }

    /** 铺页签态、红点与三个列表的显隐；每一处都无条件写，避免首次值等于 prefab 初值时短路。 */
    applyTab(): void {
        const snapshot = this._snapshot;
        const tab = this._tab;
        const targetTab = tab === ECelebrationTab.Target;
        const rankTab = tab === ECelebrationTab.Rank;
        const shopTab = tab === ECelebrationTab.Shop;

        this.listTarget.node.active = targetTab;
        this.listRank.node.active = rankTab;
        this.listShop.node.active = shopTab;

        // 列头 6 件 + 第三格文案 + 底部说明只属于排名页。
        for (const node of this.rankHeaderNodes) node.active = rankTab;
        this.rankHeaderLabel3.node.active = rankTab;
        this.footerTip.node.active = rankTab;

        // 只有「庆典目标」页签的红点会被点亮（老端 targetRd.OnRDUpdate(GetRd())）。
        const rd = snapshot ? snapshot.rd !== 0 : false;
        this.tabTarget.render(targetTab, rd);
        this.tabRank.render(rankTab, false);
        this.tabShop.render(shopTab, false);

        // 三处「老端从不点亮」的红点显式写 false，防 prefab 初值回归。
        this.rankDetailRedDot.setRedDot(false);
        this.helpRedDot.setRedDot(false);
        this.goBuildRedDot.setRedDot(false);
    }

    /**
     * 切页签。顺序不能反：先改显隐，再喂条数，否则隐藏中的列表 `setTotalCount` 静默无效。
     */
    selectTab(index: number): void {
        if (index < 0 || index >= CL_TAB_COUNT) return;
        this._tab = index;
        this.applyTab();
        this.pushList();
    }

    /** 把当前页签的条数交给虚拟列表；只推当前页签，另外两个是隐藏的，喂了也不生效。 */
    private pushList(): void {
        const list = this._listOfTab();
        if (!list.node.isValid) return;
        list.setTotalCount(this._countOfTab());
        // 换了数据源，回到顶部（不播动画）。
        list.scrollToTop(false);
    }

    /** 查一次「我的名次」（老端 `updateRank()`，`showNum: 1`）。 */
    async updateMyRank(): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        const detail = await celebrationRepository.requestRank(
            snapshot.rankType,
            1,
            // 形参叫 unionId，老端传的是自己的 roleId，不是公会 id。见 RequestRankMsg 文件头。
            celebrationSelfRoleId(),
            this,
        );
        if (!this.isValid || !this.node.isValid) return;
        // 有回包按 rank 取值；没回包或 myRank 为空也退到「未上榜」。
        const rank = detail ? detail.myRank.rank : CL_NOT_IN_RANK;
        this.myRankValue.string = myRankValueTextOf(rank);
    }

    /** 每秒只刷倒计时（老端 `UpdateTime()` 也只做这一件事）。 */
    private _tick(): void {
        this._refreshCountdown();
    }

    private _refreshCountdown(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        this.refreshTime.string = countdownTextOf(snapshot, Date.now());
    }

    private _onBack(): void {
        this.closeByButton();
    }

    /** 详细排名> ⇒ 二级弹窗（老端 `CtrlRank.openLayerOSRankDetail(rankType, refConfig.name)`）。 */
    private _onRankDetail(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        void OSRankRankDetailPage.open({
            userData: {
                rankType: snapshot.rankType,
                rankKey: snapshot.config ? snapshot.config.name : '',
            },
        });
    }

    /** `btn_help` ⇒ 老端 `CtrlAlert.OpenHelpe(config.tips)`；本工程未接帮助系统。 */
    private _onHelp(): void {
        Toast.show(CL_TEXTS.helpUnavailable);
    }

    /** `前往提升>` ⇒ 老端 `CtrlJumpView.JumpType(config.goto)`；本工程未接跳转链路。 */
    private _onGoBuild(): void {
        Toast.show(CL_TEXTS.gotoUnavailable);
    }

    /** 领一档庆典目标奖励（老端 `RequestCelebrationGetTargetReward(data.id, data.subId)`）。 */
    private async claimTarget(row: ICelebrationTargetRow): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        // 老端不做本地前置校验（点得到就发）。这里两道闸只挡「按钮点不到但逻辑上不该点」的重复点击，
        // 置灰 / 隐藏仍归 OSTargetItem.render 管。
        const state = targetStateOf(snapshot, row);
        if (state === ECelebrationTargetRewardType.Unfinished) {
            Toast.show(CL_TEXTS.notReachedTip);
            return;
        }
        if (state === ECelebrationTargetRewardType.Received) {
            Toast.show(CL_TEXTS.alreadyClaimedTip);
            return;
        }

        // id 是 celebrationConfig.id（= snapshot.celebrationId），不是 rankType。
        const result = await celebrationRepository.claimTargetReward(snapshot.celebrationId, row.subId, this);
        if (result === 'offline') {
            Toast.show(CL_TEXTS.offlineTip);
            return;
        }
        if (result === 'failed') {
            Toast.show(CL_TEXTS.failedTip);
            return;
        }
        Toast.show(CL_TEXTS.claimSuccess);
        await this.reload();
    }

    /**
     * 买一件限时特惠（老端 `RequestCelebrationBuyShop(data.id, data.subId, data.rmb)`）。
     * 售罄不早退：老端只置灰、按钮仍可点，由服务端拒；本地拦截会让两端对「能不能买」的口径不一致。
     */
    private async buyShop(row: ICelebrationShopRow): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        const result = await celebrationRepository.buyShopGoods(snapshot.celebrationId, row.subId, this);
        if (result === 'offline') {
            Toast.show(CL_TEXTS.offlineTip);
            return;
        }
        if (result === 'failed') {
            Toast.show(CL_TEXTS.failedTip);
            return;
        }
        if (result === 'pay') {
            // 老端这里走 SDKMgr.pay(rmb, "common", 0)，本工程没有支付 SDK，如实告知。
            Toast.show(CL_TEXTS.payUnavailable);
            return;
        }
        // 服务端已回包（tlCmdGoods 是奖励明细，BroMsg 会刷缓存）。
        await this.reload();
    }

    // 列表行回调必须同步：滚动中随时会被调用。

    private readonly _renderTargetRow = (node: Node, index: number): void => {
        const snapshot = this._snapshot;
        const frames = this._frames;
        const row = snapshot?.targetArr[index];
        const item = node.getComponent(OSTargetItem);
        if (!snapshot || !frames || !row || !item) return;
        // 回调每趟重设：行是 clone 复用的，闭包必须捕获这一趟的 row，否则点第 3 行会领第 1 行的奖。
        item.onClaim = () => { void this.claimTarget(row); };
        item.onGoto = () => this._onGoBuild();
        item.render(snapshot, row, frames);
    };

    private readonly _renderRankRow = (node: Node, index: number): void => {
        const snapshot = this._snapshot;
        const frames = this._frames;
        const row = snapshot?.rankArr[index];
        const item = node.getComponent(OSRankItem);
        if (!snapshot || !frames || !row || !item) return;
        item.render(snapshot, row, frames);
    };

    private readonly _renderShopRow = (node: Node, index: number): void => {
        const snapshot = this._snapshot;
        const frames = this._frames;
        const row = snapshot?.shopArr[index];
        const item = node.getComponent(OSShopItem);
        if (!snapshot || !frames || !row || !item) return;
        item.onBuy = () => { void this.buyShop(row); };
        item.render(snapshot, row, frames);
    };

    /** 当前页签的列表。`_tab` 只由 `selectTab` 写入且已做范围校验，这里按目标页兜底。 */
    private _listOfTab(): VirtualScrollView {
        if (this._tab === ECelebrationTab.Rank) return this.listRank;
        if (this._tab === ECelebrationTab.Shop) return this.listShop;
        return this.listTarget;
    }

    /** 当前页签的条数。 */
    private _countOfTab(): number {
        const snapshot = this._snapshot;
        if (!snapshot) return 0;
        if (this._tab === ECelebrationTab.Rank) return snapshot.rankArr.length;
        if (this._tab === ECelebrationTab.Shop) return snapshot.shopArr.length;
        return snapshot.targetArr.length;
    }
}
