import { _decorator, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { Toast } from '../common/Toast';
import { CelebrationFrames } from './CelebrationFrames';
import { OSTabButton } from './OSTabButton';
import { OSTargetItem } from './OSTargetItem';
import { OSRankItem } from './OSRankItem';
import { OSShopItem } from './OSShopItem';
import { OSRankRankDetailPage } from './OSRankRankDetailPage';
import {
    CL_TAB_COUNT,
    celebrationRepository,
    celebrationSelfRoleId,
    countdownTextOf,
    myRankValueTextOf,
    propertyWantTextOf_,
    targetStateOf,
} from './CelebrationRepository';
import type {
    CelebrationBuyResult,
    ICelebrationRankRow,
    ICelebrationShopRow,
    ICelebrationSnapshot,
    ICelebrationTargetRow,
} from './CelebrationRepository';
import { CL_TEXTS } from './CelebrationTexts';
import { ECelebrationTargetRewardType } from './CelebrationTable';

const { ccclass, property } = _decorator;

/**
 * 开服庆典**主容器**（prefab `ui/Celebration/OSRank`，720×1280）
 * —— 老端 `LayerOSRankUI`（`ui://开服冲榜/组件_开服冲榜_主界面`）。
 *
 * ## 三个页签的显隐落点（逐条对过 FGUI 原稿）
 *
 * `<controller name="页签" pages="0,庆典目标,1,庆典排名,2,限时特惠" selected="1"/>`
 *
 * ⚠️ 设计期 `selected="1"` ⇒ **首次打开停在「庆典排名」页**，不是目标页。照抄。
 *
 * | FGUI 节点 | gear | 归属 |
 * |---|---|---|
 * | `list_target` | `页签 pages="0"` | 只有庆典目标页 |
 * | `list_rank` | `页签 pages="1"` | 只有庆典排名页 |
 * | `list_goods` | `页签 pages="2"` | 只有限时特惠页 |
 * | `n123`（group：`n116/n117/n118` 三张 `kfqd06` 底 + `n119/n120/lab_proty1` 三个文案） | `页签 pages="1"` | 只有庆典排名页（列头） |
 * | `n105`（`FooterTip`） | `页签 pages="1"` | 只有庆典排名页（邮件发放说明） |
 *
 * **其余一律常显**（三页都在）：`btn_rank`（详细排名>）、`btn_help`、`btn_go_build`（前往提升>）、
 * `lab_proty` + `lab_my_power`（战力口径 + 当前值）、`n99` + `lab_my_rank`（我的名次）。
 * ⇒ 没有 gear 的节点**不要**跟着页签切显隐，那是"看着像"的改法。
 *
 * ## 老端的三个刷新入口
 *
 * | 老端 | 触发 | 做了什么 |
 * |---|---|---|
 * | `UpdateTime()` | `addTimer(1000, …)` + `enterAsync` 里先跑一次 | 只刷 `refreshTime` 倒计时 |
 * | `updateView()` | `enterAsync` / 页签切换 / `VOCelebrationBag` 的 `OnChanged` | 铺按钮 + 三段文案 + **当前页签**的列表 + 目标页签红点 |
 * | `updateRank()` | `enterAsync` / `ModelRank` 的 `rankDataUpdate` | 发 `CmdGetRankReqMsg{showNum: 1}` 只取 `myRank` 填 `lab_my_rank` |
 *
 * ⇒ 本类同构：`onOpen` → `reload()`（= `updateView` 的数据部分）+ `updateMyRank()`；
 * `schedule(_tick, 1)` 只刷倒计时（老端那个 `UpdateTime` **也只做这一件事**，
 * 别把整个 `reload()` 塞进每秒 —— 那会每秒重读五张表 + 重发一次查排名）。
 *
 * ## ⚠️ 不做 `VOCelebrationBag.OnChanged` / `ModelRank.rankDataUpdate` 那种"事件驱动重刷"
 *
 * 老端靠 VO 层的变更事件回调 `updateView()`。Demo3.8 里这两份数据的来源都是
 * `CacheMgr`（`GameNet` 收包时写），没有对应的"变更通知"入口。
 * 所以改为**动作后主动重刷**：领奖 / 购买成功各 `await reload()` 一次（与 `HangPage`
 * 「领取后 reload」同一处置）。丢的只是"别处改了数据这个界面自动跟"，
 * 而本界面是独占的全屏层，没有那条路径。
 *
 * ## 🔴 虚拟列表的三条约定
 *
 * 1. **`renderItemFn` 只绑一次**（`onInit` 里），行内容按 `index` **现取** `this._snapshot`
 *    —— 绝不把 `rows` 闭包进函数（那会把"切换页签后的新数据"喂进旧闭包，规则 55）。
 * 2. **先 `active` 后 `setTotalCount`**：`VirtualScrollView` 的槽位在它自己的 `start()` 里建，
 *    节点隐藏时不建 ⇒ 隐藏时 `setTotalCount` **静默无效**（规则 86）。
 *    所以 `applyTab()`（改显隐）必须在 `pushList()`（喂条数）**之前**跑。
 * 3. **等一帧**：`onOpen` 早于 `start()`。统一走 `PopupBase.nextPopupFrame()`，
 *    关闭期间返回 `false`、不留悬空 Promise（`GMPanel` / `LineupBoardPage` 同一处置）。
 */

/** 倒计时刷新间隔（老端 `toolSet.addTimer(1000, this.UpdateTime, this)`）。 */
export const CL_TICK_SECONDS = 1;

/** 首次打开停在哪一页 —— FGUI 原稿 `页签 selected="1"`。 */
export const CL_DEFAULT_TAB = 1;

@ccclass('OSRankPage')
export class OSRankPage extends PopupBase {
    static prefabPath = 'ui/Celebration/OSRank';

    // ============================================================
    // Inspector 绑定
    // ============================================================

    @property({ type: Label, tooltip: 'RefreshTime：倒计时 `13:16:55后刷新`（FGUI `refreshTime`）' })
    refreshTime: Label = null!;

    @property({ type: Label, tooltip: 'MyPowerLabel：战力口径名（FGUI `lab_proty`，运行时被 `config.name` 覆盖）' })
    myPowerLabel: Label = null!;

    @property({ type: Label, tooltip: 'MyPowerValue：当前进度值（FGUI `lab_my_power`；老端直接 `setText(curValue)`，**不缩写**）' })
    myPowerValue: Label = null!;

    @property({ type: Label, tooltip: 'MyRankLabel：`我的名次:`（FGUI `n99`，静态文案）' })
    myRankLabel: Label = null!;

    @property({ type: Label, tooltip: 'MyRankValue：`第3名` / `未上榜`（FGUI `lab_my_rank`）' })
    myRankValue: Label = null!;

    @property({ type: Label, tooltip: 'FooterTip：邮件发放说明（FGUI `n105`，**只在排名页可见**，原文含错别字「多钱」，照抄）' })
    footerTip: Label = null!;

    @property({ type: [Node], tooltip: '列头底图 + 文案（FGUI group `n123` 的 6 个成员，**只在排名页可见**）：Header1/2/3 + HeaderLabel1/2/3' })
    rankHeaderNodes: Node[] = [];

    @property({ type: Label, tooltip: '列头第三格 `{战力口径}要求`（FGUI `lab_proty1`，**只在排名页可见**）' })
    rankHeaderLabel3: Label = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListTarget：庆典目标列表（FGUI `list_target`）' })
    listTarget: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListRank：庆典排名列表（FGUI `list_rank`）' })
    listRank: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: 'ListShop：限时特惠列表（FGUI `list_goods`）' })
    listShop: VirtualScrollView = null!;

    @property({ type: OSTabButton, tooltip: 'TabTarget：庆典目标页签（FGUI `按钮_庆典目标`）' })
    tabTarget: OSTabButton = null!;

    @property({ type: OSTabButton, tooltip: 'TabRank：庆典排名页签（FGUI `按钮_庆典排名`）' })
    tabRank: OSTabButton = null!;

    @property({ type: OSTabButton, tooltip: 'TabShop：限时特惠页签（FGUI `按钮_庆典特惠`）' })
    tabShop: OSTabButton = null!;

    @property({ type: Node, tooltip: 'BackBtn：返回（FGUI `按钮_返回`）' })
    backBtn: Node = null!;

    @property({ type: Node, tooltip: 'RankDetailBtn：`详细排名>`（FGUI `btn_rank`）' })
    rankDetailBtn: Node = null!;

    @property({ type: Node, tooltip: 'RankDetailBtn/RedDot：老端**从不点亮** ⇒ 每趟写 false（见文件头）' })
    rankDetailRedDot: Node = null!;

    @property({ type: Node, tooltip: 'HelpBtn：帮助（FGUI `btn_help`）' })
    helpBtn: Node = null!;

    @property({ type: Node, tooltip: 'HelpBtn/RedDot：老端**从不点亮** ⇒ 每趟写 false' })
    helpRedDot: Node = null!;

    @property({ type: Node, tooltip: 'GoBuildBtn：`前往提升>`（FGUI `btn_go_build`）' })
    goBuildBtn: Node = null!;

    @property({ type: Node, tooltip: 'GoBuildBtn/RedDot：老端**从不点亮** ⇒ 每趟写 false' })
    goBuildRedDot: Node = null!;

    // ============================================================
    // 运行时状态
    // ============================================================

    /** 当前快照（`reload()` 写入；行为空 / 未加载时为 `null`）。 */
    private _snapshot: ICelebrationSnapshot | null = null;

    /** 本次打开用的图帧表（`onClose` 里 `dispose()`）。 */
    private _frames: CelebrationFrames | null = null;

    /** 当前页签（0 目标 / 1 排名 / 2 特惠）。 */
    private _tab: number = CL_DEFAULT_TAB;

    /** 列表推送代号：切页签连点时，只有最后一次允许落地。 */
    private _listSeq: number = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.backBtn?.on('click', this._onBack, this);
        this.rankDetailBtn?.on('click', this._onRankDetail, this);
        this.helpBtn?.on('click', this._onHelp, this);
        this.goBuildBtn?.on('click', this._onGoBuild, this);

        // 页签回调只挂一次（页签节点不像列表行那样被复用）。
        if (this.tabTarget) this.tabTarget.onTap = () => this.selectTab(0);
        if (this.tabRank) this.tabRank.onTap = () => this.selectTab(1);
        if (this.tabShop) this.tabShop.onTap = () => this.selectTab(2);

        // ⚠️ `renderItemFn` **只绑一次**，行内容按 index 现取（规则 55）。
        //    三个列表各绑自己的分支，页签切换不需要重绑。
        if (this.listTarget) this.listTarget.renderItemFn = this._renderTargetRow;
        if (this.listRank) this.listRank.renderItemFn = this._renderRankRow;
        if (this.listShop) this.listShop.renderItemFn = this._renderShopRow;
    }

    protected async onOpen(): Promise<void> {
        this._tab = CL_DEFAULT_TAB;
        await this.reload();
        void this.updateMyRank();
        this.schedule(this._tick, CL_TICK_SECONDS);
    }

    /**
     * ⚠️ 只停表 + 释放图帧，**不写 `off(...)`**（规则 71）：
     * 同节点组件按 `_components` 序销毁，销毁期访问事件 API 会抛 `TypeError` 并中断销毁链。
     * `PopupBase.onDestroy` 已经把业务字段清干净了，这里只做本类自己的收尾。
     */
    protected onClose(): void {
        this.unschedule(this._tick);
        this._listSeq++;
        this._snapshot = null;
        this._frames?.dispose();
        this._frames = null;
    }

    // ============================================================
    // 数据 → 界面
    // ============================================================

    /** 读表 + 预加载图 + 铺一次（等价老端 `updateView()` 的数据部分）。 */
    async reload(): Promise<void> {
        const snapshot = await celebrationRepository.load();
        // 等表期间面板可能已经关了 —— 节点一销毁再往下写会把真正的原因盖掉。
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
        await this.pushList();
    }

    /** 用当前快照铺一次（**同步**核心，探针可直接调）。 */
    applySnapshot(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        // ---- ① 倒计时（老端 `UpdateTime()`）----
        if (this.refreshTime) this.refreshTime.string = countdownTextOf(snapshot, Date.now());

        // ---- ② 战力口径 + 当前值（老端 `lab_proty` / `lab_my_power`）----
        // ⚠️ 老端是 `setText(refConfig.name)`（把设计期占位「战斗力:」整个覆盖）
        //    与 `setText(voCelebration.GetValue())` —— `GetValue()` 返回 `cmd.curValue`，
        //    FGUI 的 `setText` 对 Long 走 `toString()` ⇒ **纯整数、不走 numAbbr**。
        if (this.myPowerLabel) {
            this.myPowerLabel.string = snapshot.config ? snapshot.config.name : CL_TEXTS.powerLabelFallback;
        }
        if (this.myPowerValue) this.myPowerValue.string = `${Math.floor(snapshot.curValue)}`;

        // ---- ③ 「我的名次:」标签（静态文案，兜一手：prefab 里是半角冒号）----
        if (this.myRankLabel) this.myRankLabel.string = CL_TEXTS.myRankLabel;

        // ---- ④ 排名页底部说明（只在排名页可见，但文案是静态的）----
        if (this.footerTip) this.footerTip.string = CL_TEXTS.footerTip;

        // ---- ⑤ 列头第三格 `{战力口径}要求`（老端 `lab_proty1 = name + 要求`）----
        if (this.rankHeaderLabel3) this.rankHeaderLabel3.string = propertyWantTextOf_(snapshot);

        // ---- ⑥ 页签 + 红点 + 列表显隐 ----
        this.applyTab();
    }

    /**
     * 铺页签态、红点与三个列表的显隐。
     *
     * 每一处都**无条件写**（规则 82）：prefab 照 FGUI 设计期烘了非零默认值，
     * 「只在翻转时写」会让首次 `新值 === 缓存初值` 短路，永久停在错的初始态。
     */
    applyTab(): void {
        const snapshot = this._snapshot;
        const tab = this._tab;
        const targetTab = tab === 0;
        const rankTab = tab === 1;
        const shopTab = tab === 2;

        // ---- 三个列表（gearDisplay 落点见文件头）----
        if (this.listTarget) this.listTarget.node.active = targetTab;
        if (this.listRank) this.listRank.node.active = rankTab;
        if (this.listShop) this.listShop.node.active = shopTab;

        // ---- 排名页专有的列头 6 件 + 底部说明 ----
        for (const node of this.rankHeaderNodes) {
            if (node) node.active = rankTab;
        }
        if (this.rankHeaderLabel3) this.rankHeaderLabel3.node.active = rankTab;
        if (this.footerTip) this.footerTip.node.active = rankTab;

        // ---- 页签四件套：只有「庆典目标」的红点会被点亮（老端 `targetRd.OnRDUpdate(GetRd())`）----
        const rd = snapshot ? snapshot.rd !== 0 : false;
        if (this.tabTarget) this.tabTarget.render(targetTab, rd);
        if (this.tabRank) this.tabRank.render(rankTab, false);
        if (this.tabShop) this.tabShop.render(shopTab, false);

        // ---- 三处「老端从不点亮」的红点：显式写 false（prefab 烘的就是隐藏，这里是防回归）----
        if (this.rankDetailRedDot) this.rankDetailRedDot.active = false;
        if (this.helpRedDot) this.helpRedDot.active = false;
        if (this.goBuildRedDot) this.goBuildRedDot.active = false;
    }

    /**
     * 切页签（老端 `changeSelectTab`）。
     *
     * ⚠️ 顺序**不能反**：先 `applyTab()` 改显隐，再 `pushList()` 喂条数 ——
     * 隐藏中的 `VirtualScrollView` 槽位没建，`setTotalCount` 静默无效（规则 86）。
     */
    selectTab(index: number): void {
        if (index < 0 || index >= CL_TAB_COUNT) return;
        this._tab = index;
        this.applyTab();
        void this.pushList();
    }

    /**
     * 把**当前页签**的条数交给虚拟列表。
     *
     * 只推当前页签：另外两个是 `active = false`，喂了也不生效。
     * `_listSeq` 守卫连点：只有最后一次 `await nextPopupFrame()` 的结果允许落地。
     */
    private async pushList(): Promise<void> {
        const seq = ++this._listSeq;
        if (!await this.nextPopupFrame()) return;
        if (seq !== this._listSeq) return;
        if (!this.isValid || !this.node.isValid) return;

        const list = this._listOfTab(this._tab);
        if (!list || !list.node.isValid) return;
        list.setTotalCount(this._countOfTab(this._tab));
        // 换了数据源 ⇒ 回到顶部（不播动画）。
        list.scrollToTop(false);
    }

    /** 查一次「我的名次」（老端 `updateRank()`，`showNum: 1`）。 */
    async updateMyRank(): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        const detail = await celebrationRepository.requestRank(
            snapshot.rankType,
            1,
            // ⚠️ 形参叫 `unionId`，但老端传的是**自己的 roleId**（`ModelRole.GetRole().GetCmd().id`），
            //    不是公会 id —— 见 `RequestRankMsg` 文件头。
            celebrationSelfRoleId(),
            this,
        );
        if (!this.isValid || !this.node.isValid) return;
        // 老端：`rsp.rankInfo.myRank` 有值 ⇒ `rank == -1 ? 未上榜 : 第{0}名`；没值也退到「未上榜」。
        const rank = detail ? detail.myRank.rank : -1;
        if (this.myRankValue) this.myRankValue.string = myRankValueTextOf(rank);
    }

    // ============================================================
    // 每帧 / 每秒
    // ============================================================

    /** 每秒只刷倒计时（老端 `UpdateTime()` 也只做这一件事）。 */
    private _tick(): void {
        const snapshot = this._snapshot;
        if (!snapshot) return;
        if (this.refreshTime) this.refreshTime.string = countdownTextOf(snapshot, Date.now());
    }

    // ============================================================
    // 交互
    // ============================================================

    private _onBack(): void {
        this.closeByButton();
    }

    /** `详细排名>` ⇒ 二级弹窗（老端 `CtrlRank.openLayerOSRankDetail(rankType, refConfig.name)`）。 */
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

        // 老端**不做**本地前置校验（点得到就发）；这里补两道"按钮点不到但逻辑上不该点"的闸
        // —— 置灰/隐藏归 `OSTargetItem.render` 管，闸只挡重复点击。
        const state = targetStateOf(snapshot, row);
        if (state === ECelebrationTargetRewardType.Unfinished) {
            Toast.show(CL_TEXTS.notReachedTip);
            return;
        }
        if (state === ECelebrationTargetRewardType.Received) {
            Toast.show(CL_TEXTS.alreadyClaimedTip);
            return;
        }

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
        // ⚠️ `id` 传的是 `celebrationConfig.id`（= `snapshot.celebrationId`），
        //    **不是** `rankType`（`snapshot.rankType`）。见 `RequestCelebrationMsg` 文件头。
        await this.reload();
    }

    /**
     * 买一件限时特惠（老端 `RequestCelebrationBuyShop(data.id, data.subId, data.rmb)`）。
     *
     * ⚠️ 售罄时**不发早退**：老端只 `gearLook` 置灰、按钮仍可点，点了照样发请求、由服务端拒。
     * 这里照抄 —— 加个"本地拦截"会让客户端与服务端对"能不能买"的口径不一致。
     */
    private async buyShop(row: ICelebrationShopRow): Promise<void> {
        const snapshot = this._snapshot;
        if (!snapshot) return;

        const result: CelebrationBuyResult = await celebrationRepository.buyShopGoods(
            snapshot.celebrationId,
            row.subId,
            this,
        );
        if (result === 'offline') {
            Toast.show(CL_TEXTS.offlineTip);
            return;
        }
        if (result === 'failed') {
            Toast.show(CL_TEXTS.failedTip);
            return;
        }
        if (result === 'pay') {
            // 老端这里走 `SDKMgr.pay(rmb, "common", 0)`；Demo3.8 没有支付 SDK ⇒ 如实告知。
            Toast.show(CL_TEXTS.payUnavailable);
            return;
        }
        // 服务端已回包（`tlCmdGoods` 是奖励明细，`CmdCelebrationBuyShopGoodsBroMsg` 会刷缓存）。
        await this.reload();
    }

    // ============================================================
    // 列表行（**必须同步**：滚动中随时回调）
    // ============================================================

    private readonly _renderTargetRow = (node: Node, index: number): void => {
        const snapshot = this._snapshot;
        const frames = this._frames;
        const row = snapshot?.targetArr[index];
        const item = node.getComponent(OSTargetItem);
        if (!snapshot || !frames || !row || !item) return;
        // ⚠️ 回调**每趟重设**：行是 clone 复用的，闭包必须捕获"这一趟的 row"，
        //    否则点第 3 行会去领第 1 行的奖（`OSTargetItem.onClaim` 的文件头）。
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

    // ============================================================
    // 查表
    // ============================================================

    private _listOfTab(tab: number): VirtualScrollView | null {
        if (tab === 0) return this.listTarget;
        if (tab === 1) return this.listRank;
        if (tab === 2) return this.listShop;
        return null;
    }

    private _countOfTab(tab: number): number {
        const snapshot = this._snapshot;
        if (!snapshot) return 0;
        if (tab === 0) return snapshot.targetArr.length;
        if (tab === 1) return snapshot.rankArr.length;
        if (tab === 2) return snapshot.shopArr.length;
        return 0;
    }
}
