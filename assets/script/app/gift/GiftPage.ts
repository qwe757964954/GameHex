import { _decorator, Button, Color, Label, Node, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadArt, loadFrameArt } from '../card/CardLineupIcons';
import {
    GIFT_ART_NAMES,
    GIFT_ART_ROOT,
    GIFT_SUB_TAB_ART,
    QUALITY_FRAME_NAMES,
    qualityFrameName,
    resolveGiftIconRef,
} from './GiftArt';
import { giftRepository } from './GiftRepository';
import type { IGiftRepository, IGiftSnapshot } from './GiftRepository';
import { GiftLingYuView } from './GiftLingYuView';
import type { IGiftLingYuCardView } from './GiftLingYuView';
import type { IGiftShopRowView } from './GiftShopRow';
import { GiftSpecialView } from './GiftSpecialView';
import type { IGiftSubTabFrames } from './GiftSpecialView';
import { GiftTabButton } from './GiftTabButton';
import { RechargeDailyView } from './RechargeDailyView';
import type { IRechargeDailyRowPresent, IRechargeDailyStagePresent } from './RechargeDailyView';
import { RechargeTotalView } from './RechargeTotalView';
import type { IRechargeTotalChestPresent, IRechargeTotalRowPresent } from './RechargeTotalView';
import { rechargeActivityRepository } from './RechargeActivityRepository';
import { pickBoxActivity, RECHARGE_TAB } from './RechargeActivityTable';
import { dailyButtonKey } from './RechargeDailyTable';
import { rechargeDailyRepository } from './RechargeDailyRepository';
import type { IGiftSlotFrame } from './GiftRewardSlot';
import {
    collectGiftRewardResIds,
    discountTextOf,
    GIFT_CURRENCY_RES_ID,
    GIFT_MAIN_TABS,
    giftBuyButtonOf,
    giftShopStateOf,
    limitTextOf,
    listGiftOfType,
    listLingYuCards,
    listSubTabs,
    payCoinText,
    payPriceText,
    sortGiftRows,
} from './GiftTable';
import type { IGiftShopRow } from './GiftTable';
import { GIFT_TEXTS, RECHARGE_TEXTS } from './GiftTexts';

const { ccclass, property } = _decorator;

/** 底部大页签的两张底图（首次加载后缓存在实例上；两张图不会变）。 */
/**
 * 「礼包」弹窗（`LayerGift`，`assets/resources/ui/Gift/Gift.prefab`）。
 *
 * ## 版面
 *
 * 老端的 FGUI 包「礼包」把「导航条」和「页面」拆成了两层组件：
 *   - `组件_礼包_主界面.xml` = 底部导航（返回按钮 + 一排大页签 + 底板），**没有页面容器**；
 *   - `组件_礼包_超值礼包.xml` / `组件_礼包_灵玉礼包.xml` = 整屏页面，由 `LayerGift` 叠上去。
 * 本工程把它合成**一整个 prefab**：`PageRoot`（页面容器）在 `_children` 里排在底部条**之前**
 * ⇒ 页面滚动内容会被底部条盖住，与老端的层序一致。
 *
 * ## 页签口径（**刻意不同于老端代码**）
 *
 * 老端 `LayerGift.InitTabProxy()` 开的是「超值礼包 / 每日充值 / 累计充值」，而新项目
 * `open.json`（客户端真正读的表，`preResId = 103`）开的是：
 *   `409 超值礼包`(order 1) / `411 晶石兑换`(order 3，`roleLevel >= 9999` **关**) / `412 灵玉直冲`(order 4)
 * ⇒ **按 `open.json` 落地**：只做「超值礼包 + 灵玉直冲」两个页签（见 `GIFT_MAIN_TABS`）。
 * 每日充值 / 累计充值在老端依赖 `rechargeDaily` + `VOActivity` 体系，本轮不移植。
 *
 * ## 分层
 *
 *   数据与判定  `GiftTable`（纯函数、可单测）+ `GiftRepository`（表 / 缓存 / 请求）
 *   子视图      `GiftSpecialView`（超值礼包页）、`GiftLingYuView`（灵玉直冲页）、
 *               `GiftShopRow`（商品行）、`GiftLingYuCard`（档位卡）、`GiftSubTab` / `GiftTabButton`（页签）
 *   本类        只做「取数 → 预加载图 → 组装视图模型 → 铺界面」和「点击 → 发请求 → 重新取数」
 *
 * 项目约定：**样式与布局全在 prefab 的 Inspector 上**；只有「随数据变化的东西」
 * （行数、按钮三态、角标显隐）才在代码里算。静态美术（底板 / 装饰 / 底部条）直接写在 prefab 上，
 * 这里只加载「由数据决定」的那几张（品质框、道具 / 货币图标、子页签底 + 标题图、页签底图）。
 */
@ccclass('GiftPage')
export class GiftPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Gift/`，G 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/gift/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/Gift/Gift';

    @property({ type: Node, tooltip: 'BackBtn：左下返回按钮（挂 cc.Button）' })
    backButton: Node = null!;

    @property({ type: Node, tooltip: 'TabBar：底部大页签栏（挂 2 个 GiftTabButton）' })
    tabBar: Node = null!;

    @property({ type: Node, tooltip: 'PageRoot：页面容器（下挂 SpecialPage / LingYuPage，同一时刻只开一个）' })
    pageRoot: Node = null!;

    @property({ type: GiftSpecialView, tooltip: 'PageRoot/SpecialPage：超值礼包页' })
    specialView: GiftSpecialView = null!;

    @property({ type: Node, tooltip: 'PageRoot/RechargeTotalPage：累计充值页' })
    totalViewNode: Node = null!;

    @property({ type: Node, tooltip: 'PageRoot/DailyPage：每日充值页' })
    dailyViewNode: Node = null!;

    @property({ type: Label, tooltip: 'Hint：提示行（空配置 / 离线 / 操作失败 / 购买成功）' })
    hintLabel: Label = null!;

    /** 数据端口；测试可替换。 */
    private repo: IGiftRepository = giftRepository;

    /** 当前快照（表 + 商店已购次数 + item 表 + 已购档位）。 */
    private snapshot: IGiftSnapshot | null = null;

    /** 当前选中的大页签。 */
    private selectedTab: 'special' | 'total' | 'daily' = 'special';

    /** 当前选中的子页签（`giftShop.type`）；`0` = 还没定（取第一个）。 */
    private selectedType = 0;

    /** 当前选中的「每日充值」档位（`rechargeDaily.round`）。 */
    private selectedDailyRound = 1;

    /** 当前选中的「累计充值」页签（`RechargeActivityTable.RECHARGE_TAB.*`）。 */
    private selectedTotalTab: number = RECHARGE_TAB.base;

    /**
     * 两个充值页的组件（在 `ensureViews()` 里解析出来）。
     *
     * ⚠️ 走 `getComponent(类)` 而不是 `getComponent('类名' as any)`：前者是类型化的
     * （改了回调签名编译期就报），后者只是字符串查表、写错了运行时才 `undefined`。
     * prefab 上的真源是 `totalViewNode` / `dailyViewNode` 这两个 Node 引用，不另存组件引用。
     */
    private dailyView: RechargeDailyView | null = null;

    private totalView: RechargeTotalView | null = null;

    private busy = false;

    /** 每次「取数 / 换页签」递增，用来丢弃过期的异步结果。 */
    private revision = 0;

    /** 品质框（4 张固定图），首次用到后缓存 —— 与档位无关，不用每次重载。 */
    private qualityFrames: Map<string, SpriteFrame> | null = null;

    /** 子页签底图 + 标题图（固定几张），首次用到后缓存。 */
    private subTabFrames: IGiftSubTabFrames | null = null;

    /** `resId` → 图标（道具图标 + 货币图标共用一张表）。 */
    private readonly iconFrames = new Map<number, SpriteFrame>();

    /** 确认**没有图**的 `resId`（负缓存，避免每次刷新都重试）。 */
    private readonly missingIcons = new Set<number>();

    /** 灵玉页购买按钮底图（`gf_btn_lingyu`，固定一张）。 */
    private lingYuButtonFrame: SpriteFrame | null = null;

    private lingYuButtonTried = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.ensureViews();
        const back = this.backButton.getComponent(Button);
        back?.node.on(Button.EventType.CLICK, this.onBackClick, this);

        const tabs = this.tabButtons;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].bind(index, (clicked) => this.onTabClick(clicked));
        }

        // 子视图只回调，不碰网络 / 不碰数据（取数全在本类）。
        this.specialView.onSelectType = (type) => void this.onSelectType(type);
        this.specialView.onBuy = (id) => void this.onBuyGift(id);
        this.bindRechargeViews();
    }

    /** 两个充值页的回调接线（`ensureViews()` 已把组件解析好）。 */
    private bindRechargeViews(): void {
        const daily = this.dailyView;
        if (daily) {
            daily.onSwitchRound = (round) => void this.onSelectDailyRound(round);
            daily.onClaimDay = (round, day) => void this.onClaimDailyReward(round, day, false);
            daily.onClaimAcc = (round, day) => void this.onClaimDailyReward(round, day, true);
            // 「去充值」= 老端跳商店；累计奖励走**阶段格**（两条不同的路）。
            daily.onGoto = () => this.onGotoRecharge();
        }

        const total = this.totalView;
        if (total) {
            total.onSwitchTab = (tab) => void this.onSelectTotalTab(tab);
            total.onClaim = (activityId, rechargeProcess) => void this.onClaimTotalReward(activityId, rechargeProcess);
            total.onGoto = () => this.onGotoRecharge();
        }
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.selectedTab = 'special';
        this.selectedType = 0;
        // 两个充值页的选择也复位（面板是复用的，不复位会停在上次的档位 / 页签）。
        this.selectedDailyRound = 1;
        this.selectedTotalTab = RECHARGE_TAB.base;
        this.setHint('');
        await this.reload();
    }

    protected onClose(): void {
        // 关掉后在飞的异步结果一律作废（否则会往已回收的 Label 上写）。
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IGiftRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与铺界面
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repo.load();
        if (!this.alive || revision !== this.revision) return;
        this.snapshot = snapshot;

        if (snapshot.shops.length === 0 && snapshot.payChannels.length === 0) {
            this.presentEmpty();
            return;
        }
        // 固定几张图先备好（品质框 / 子页签底 + 标题 / 大页签底 / 灵玉按钮底）——
        // 一次性加载完再铺界面，避免「先出框后补图」的闪烁。
        await this.preloadStaticFrames();
        if (!this.alive || revision !== this.revision) return;
        await this.present(revision);
    }

    private async present(revision: number): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        this.ensureViews();
        this.presentTabButtons();
        const isSpecial = this.selectedTab === 'special';
        const isDaily = this.selectedTab === 'daily';
        this.specialView.node.active = isSpecial;
        this.totalViewNode.active = !isSpecial && !isDaily;
        this.dailyViewNode.active = isDaily;

        if (isSpecial) await this.presentSpecial(snapshot, revision);
        else if (isDaily) await this.presentDaily(revision);
        // `selectedTab` 只有三个取值 ⇒ 非 special / daily 就是 total（不用再判一次）。
        else await this.presentTotal(revision);
    }

    // ============================================================
    // 超值礼包页
    // ============================================================

    private async presentSpecial(snapshot: IGiftSnapshot, revision: number): Promise<void> {
        const subtabs = listSubTabs(snapshot.shops);
        if (subtabs.length === 0) {
            // 表里一个档位都没配 ⇒ 直接把整页藏掉，只留提示（别画一块空底板）。
            this.specialView.node.active = false;
            this.setHint(GIFT_TEXTS.empty);
            return;
        }
        if (!subtabs.some((tab) => tab.type === this.selectedType)) {
            this.selectedType = subtabs[0].type;
        }

        const rows = sortGiftRows(
            listGiftOfType(snapshot.shops, this.selectedType),
            (id) => snapshot.buyTimes.get(id) ?? 0,
        );

        // ⚠️ 图标必须在 `present()` **之前** await 完：行渲染是同步的，
        //    边渲染边加载会先闪一帧上一行的图（`VScrollView` 回收残影同款缺陷）。
        //
        // ⚠️ 必须**额外带上货币档 `GIFT_CURRENCY_RES_ID`**：购买按钮左侧那颗图标不在
        //    `row.rewards` 里，只按奖励 resId 预加载会让 `buildRowView` 永远取不到它 ⇒
        //    所有付费按钮静默降级成「60幻灵玉」而不是「60 + 图标」。
        //    （灵玉页那条路径是单独 `loadIconFrames([GIFT_CURRENCY_RES_ID])` 的，所以没这个问题 ——
        //      这里漏了，端到端探针逮到的。）
        await this.loadIconFrames(collectGiftRewardResIds(rows).concat(GIFT_CURRENCY_RES_ID));
        if (!this.alive || revision !== this.revision) return;

        const qualityFrames = this.qualityFrames;
        if (!qualityFrames || !this.subTabFrames) return;

        const rowViews = rows.map((row) => this.buildRowView(snapshot, row, qualityFrames));
        this.specialView.present({
            subtabs,
            selectedType: this.selectedType,
            subTabFrames: this.subTabFrames,
            rows: rowViews,
        });
    }

    /** 把一行数据翻译成 `GiftShopRow.render()` 要的视图模型。 */
    private buildRowView(
        snapshot: IGiftSnapshot,
        row: IGiftShopRow,
        qualityFrames: Map<string, SpriteFrame>,
    ): IGiftShopRowView {
        const buyTimes = snapshot.buyTimes.get(row.id) ?? 0;
        const currencyFrame = this.iconFrames.get(GIFT_CURRENCY_RES_ID) ?? null;
        const buy = giftBuyButtonOf(row, buyTimes, {
            freeText: GIFT_TEXTS.free,
            currencyName: GIFT_TEXTS.currency,
            hasCurrencyIcon: currencyFrame != null,
        });
        return {
            id: row.id,
            title: row.desc,
            limitText: limitTextOf(buyTimes, row.limit),
            discountText: discountTextOf(row.discount),
            soldOut: giftShopStateOf(row, buyTimes) === 'soldOut',
            buyText: buy.text,
            showIcon: buy.showIcon,
            currencyFrame,
            rewards: row.rewards.map((reward) => ({
                qualityFrame: this.qualityFrameOf(snapshot, reward.resId, qualityFrames),
                iconFrame: this.iconFrames.get(reward.resId) ?? null,
            })),
        };
    }

    /** 奖励 `resId` → 品质框（「超值礼包」页用的薄包装）。 */
    private qualityFrameOf(
        snapshot: IGiftSnapshot,
        resId: number,
        qualityFrames: Map<string, SpriteFrame>,
    ): SpriteFrame | null {
        return this.qualityFrameOfRes(snapshot.items, resId, qualityFrames);
    }

    /** 奖励 `resId` → 品质框；`item` 表查不到时按品质 1 取框。 */
    private qualityFrameOfRes(
        items: ReadonlyMap<number, { readonly quality: number }>,
        resId: number,
        qualityFrames: Map<string, SpriteFrame>,
    ): SpriteFrame | null {
        const info = items.get(resId);
        const quality = info ? info.quality : 1;
        return qualityFrames.get(qualityFrameName(quality)) ?? null;
    }

    /**
     * 一个奖励格的图。
     *
     * ⚠️ **逐格**给（`qualityFrame` + `iconFrame` 配对）—— 一行里几个奖励品质可以不同，
     * 传「一个框给所有格」会出现「第 3 格的框是第 1 格的品质」这种静默错。
     */
    private slotFrameOf(
        items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>,
        resId: number,
        qualityFrames: Map<string, SpriteFrame>,
    ): IGiftSlotFrame {
        return {
            qualityFrame: this.qualityFrameOfRes(items, resId, qualityFrames),
            iconFrame: this.iconFrames.get(resId) ?? null,
        };
    }

    /**
     * 兜底：@property 没拖到时从 `pageRoot` 下自动找；顺带把两个页面组件解析出来。
     *
     * ⚠️ 组件用 `getComponent(类)`（类型化）取 —— 不额外存一份 prefab 引用，
     *    `totalViewNode` / `dailyViewNode` 就是真源。
     */
    private ensureViews(): void {
        if (!this.totalViewNode && this.pageRoot) {
            this.totalViewNode = this.pageRoot.getChildByName('RechargeTotalPage')!;
        }
        if (!this.dailyViewNode && this.pageRoot) {
            this.dailyViewNode = this.pageRoot.getChildByName('DailyPage')!;
        }
        if (!this.totalView && this.totalViewNode) {
            this.totalView = this.totalViewNode.getComponent(RechargeTotalView);
        }
        if (!this.dailyView && this.dailyViewNode) {
            this.dailyView = this.dailyViewNode.getComponent(RechargeDailyView);
        }
    }
    // ============================================================
    // 累计充值页
    // ============================================================

    /**
     * 铺「累计充值」页。
     *
     * 数据全在 `rechargeActivityRepository`（活动体系：`CmdActivity` 缓存 + `activityTab` /
     * `activity` / `rechargeGiftActPlan` 三张表），判定在 `RechargeActivityTable`（纯函数）。
     * 本类只组装视图模型。
     *
     * ⚠️ 图标必须在 `present()` **之前** await 完：行渲染是同步的，边渲染边加载会先闪一帧
     *   上一行的图（`VScrollView` 回收残影同款缺陷）。
     */
    private async presentTotal(revision: number): Promise<void> {
        const view = this.totalView;
        if (!view) return;

        const snapshot = await rechargeActivityRepository.load();
        if (!this.alive || revision !== this.revision) return;

        // 页签不可用（`type 1004` 的活动没开）时回落基础页 —— 否则会停在一个空页签上。
        if (this.selectedTotalTab === RECHARGE_TAB.advanced && !snapshot.advancedTabVisible) {
            this.selectedTotalTab = RECHARGE_TAB.base;
        }
        const tab = this.selectedTotalTab;
        const page = snapshot.pages.get(tab);
        if (!page) {
            view.node.active = false;
            this.setHint(GIFT_TEXTS.empty);
            return;
        }

        const qualityFrames = await this.loadQualityFrames();
        await this.loadIconFrames(
            page.rows.flatMap((row) => row.rewards.map((reward) => reward.resId))
                .concat(page.boxes.map((box) => box.reward?.resId ?? 0)),
            snapshot.items,
        );
        if (!this.alive || revision !== this.revision) return;

        const boxActivity = pickBoxActivity(snapshot.activities);
        const tabOrder = snapshot.advancedTabVisible ? [RECHARGE_TAB.base, RECHARGE_TAB.advanced] : [RECHARGE_TAB.base];

        const rows: IRechargeTotalRowPresent[] = page.rows.map((row) => ({
            title: RechargeTotalView.rowTitle(row.rechargeProcess, row.curProcess),
            state: row.state,
            rechargeProcess: row.rechargeProcess,
            slots: row.rewards.map((reward) => this.slotFrameOf(snapshot.items, reward.resId, qualityFrames)),
        }));

        const chests: IRechargeTotalChestPresent[] = page.boxes.map((box) => ({
            rechargeProcess: box.rechargeProcess,
            taken: box.taken,
            reachable: box.touchable && !box.taken,
            progressText: RechargeTotalView.chestProgress(box.curProcess, box.rechargeProcess),
            qualityFrame: box.reward ? this.qualityFrameOfRes(snapshot.items, box.reward.resId, qualityFrames) : null,
            iconFrame: box.reward ? (this.iconFrames.get(box.reward.resId) ?? null) : null,
        }));

        view.present({
            selectedTab: tab,
            tabOrder,
            tabLabels: TOTAL_TAB_LABELS,
            introText: page.desc,
            progressValue: page.progressValue,
            progressMax: page.progressMax,
            listActivityId: page.activityId,
            chestActivityId: boxActivity ? boxActivity.id : 0,
            chests,
            rows,
        });
    }

    // ============================================================
    // 每日充值页
    // ============================================================

    /**
     * 铺「每日充值」页（表 `rechargeDaily` + 专属缓存 `CmdRechargeDaily`）。
     *
     * ⚠️ 同 `presentTotal`：图标要在 `present()` 之前 await 完；且 await 之后别读上一趟的
     *   视图状态（那次结果可能已经被换档位 / 关面板作废）。
     */
    private async presentDaily(revision: number): Promise<void> {
        const view = this.dailyView;
        if (!view) return;

        const snapshot = await rechargeDailyRepository.load();
        if (!this.alive || revision !== this.revision) return;

        if (snapshot.rounds.length === 0) {
            view.node.active = false;
            this.setHint(GIFT_TEXTS.empty);
            return;
        }

        const selected = snapshot.rounds.find((round) => round.round === this.selectedDailyRound) ?? snapshot.rounds[0];
        this.selectedDailyRound = selected.round;

        const qualityFrames = await this.loadQualityFrames();
        await this.loadIconFrames(
            selected.days.flatMap((day) => day.rewards.map((reward) => reward.resId))
                .concat(selected.accRewards.map((acc) => acc.reward.resId)),
            snapshot.items,
        );
        if (!this.alive || revision !== this.revision) return;

        const stages: IRechargeDailyStagePresent[] = selected.accRewards.map((acc) => ({
            days: acc.days,
            label: RechargeDailyView.accStageLabel(acc.days),
            // 已领 > 达标未领 > 未达标（`accProgress` 已在 `buildRoundView` 里 clamp 到总天数）
            state: acc.taken ? 'taken' : (selected.accProgress >= acc.days ? 'claimable' : 'locked'),
            qualityFrame: this.qualityFrameOfRes(snapshot.items, acc.reward.resId, qualityFrames),
            iconFrame: this.iconFrames.get(acc.reward.resId) ?? null,
        }));

        const rows: IRechargeDailyRowPresent[] = selected.days.map((day) => ({
            desc: RechargeDailyView.rowDesc(day.days, day.targetCoin),
            days: day.days,
            buttonKey: dailyButtonKey(day.state),
            currentCoin: day.currentCoin,
            targetCoin: day.targetCoin,
            slots: day.rewards.map((reward) => this.slotFrameOf(snapshot.items, reward.resId, qualityFrames)),
        }));

        const roundLabels = new Map<number, string>();
        for (const round of snapshot.rounds) roundLabels.set(round.round, RechargeDailyView.roundLabel(round.round));

        view.present({
            rounds: snapshot.rounds.map((round) => round.round),
            selectedRound: selected.round,
            roundLabels,
            accProgress: selected.accProgress,
            accTotal: selected.accTotal,
            stages,
            rows,
        });
    }
    // ============================================================
    // 灵玉直冲页
    // ============================================================

    private async presentLingYu(snapshot: IGiftSnapshot, revision: number): Promise<void> {
        const cards = listLingYuCards(snapshot.payChannels, snapshot.paidChannelIds);
        if (cards.length === 0) {
            this.totalViewNode.active = false;
        this.dailyViewNode.active = false;
            this.setHint(GIFT_TEXTS.empty);
            return;
        }

        await this.loadIconFrames([GIFT_CURRENCY_RES_ID]);
        const buttonFrame = await this.loadLingYuButtonFrame();
        if (!this.alive || revision !== this.revision) return;

        const iconFrame = this.iconFrames.get(GIFT_CURRENCY_RES_ID) ?? null;
        const cardViews: IGiftLingYuCardView[] = cards.map((card) => ({
            id: card.row.id,
            title: card.row.name,
            coin: payCoinText(card.row.coin),
            price: payPriceText(card.row.rmb),
            firstBuy: card.firstBuy,
            iconFrame,
            buttonFrame,
        }));
        // 灵玉直冲页已下线
    }

    // ============================================================
    // 交互
    // ============================================================

    private onBackClick(): void {
        this.closeByButton();
    }

    private onTabClick(index: number): void {
        const def = GIFT_MAIN_TABS[index];
        if (!def || def.key === this.selectedTab) return;
        this.selectedTab = def.key;
        this.setHint('');
        void this.present(++this.revision);
    }

    private async onSelectType(type: number): Promise<void> {
        if (type === this.selectedType) return;
        this.selectedType = type;
        this.setHint('');
        // 换子页签要重算行 + 重载这批行的图标，所以递增 revision 作废在飞的旧结果。
        await this.present(++this.revision);
    }

    /** 换「每日充值」档位（`rechargeDaily.round`）。 */
    private async onSelectDailyRound(round: number): Promise<void> {
        if (round === this.selectedDailyRound) return;
        this.selectedDailyRound = round;
        this.setHint('');
        await this.present(++this.revision);
    }

    /** 换「累计充值」页签（`RECHARGE_TAB.base` / `.advanced`）。 */
    private async onSelectTotalTab(tab: number): Promise<void> {
        if (tab === this.selectedTotalTab) return;
        this.selectedTotalTab = tab;
        this.setHint('');
        await this.present(++this.revision);
    }

    /**
     * 累计充值页点「领取」（列表行 + 顶部宝箱都走这里）。
     *
     * 老端 `RequestTakeRechargeGiftActReward(resId, rechargeProcess)`；`activityId` 就是
     * 活动实例的 `openResId`（`VOActivity.GetId()`）。
     */
    private async onClaimTotalReward(activityId: number, rechargeProcess: number): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = await rechargeActivityRepository.claim(activityId, rechargeProcess, this);
        this.busy = false;
        if (!this.alive) return;

        if (result === 'ok') {
            await this.present(++this.revision);
            return;
        }
        this.setHint(result === 'offline' ? GIFT_TEXTS.offline : GIFT_TEXTS.failed, true);
    }

    /**
     * 「前往 / 去充值」。
     *
     * 老端这两个按钮都跳**商城**（`CtrlJumpView`）；Demo3.8 还没接商城路由 ——
     * 按既定范式**不发请求、也不假装成功**，给一条明确提示（规则：不静默失败）。
     */
    private onGotoRecharge(): void {
        this.setHint(RECHARGE_TEXTS.gotoMissing, true);
    }

    /**
     * 商品行的购买按钮。
     *
     * 老端 `SubTabSpecialGiftBase` 会先 `CheckHaveEnoughCostAndOpenAlert(...)`（元宝不足弹补足提示），
     * 再 `ModelGift.requestBuy`。Demo3.8 没有那套补足弹窗（`CtrlJumpView` 体系未接），
     * 所以这里**只发业务请求**，货币不足由服务端拒绝、按 `failed` 提示。
     */
    private async onBuyGift(id: number): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = await this.repo.buyGift(id, this);
        this.busy = false;
        if (!this.alive) return;

        if (result === 'offline') {
            this.setHint(GIFT_TEXTS.offline, true);
            return;
        }
        if (result === 'failed') {
            this.setHint(GIFT_TEXTS.failed, true);
            return;
        }
        this.setHint(GIFT_TEXTS.buyOk);
        await this.reload();
    }

    /**
     * 灵玉档位卡的购买按钮。
     *
     * ⚠️ 老端走 `SDKMgr.pay(ref.id, "common", 0)`（真实支付），Demo3.8 **没有支付 SDK**
     *   ⇒ 按既定范式（`FirstRechargeRepository` / `MonthCardGiftRepository`）**不发请求、
     *   也不假装成功**，明确给一条提示（规则：不静默失败）。
     */
    /** 每日充值领奖（day=true 领累计奖励）。 */
    private async onClaimDailyReward(round: number, day: number, isAcc: boolean): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = isAcc
            ? await rechargeDailyRepository.claimAcc(round, day, this)
            : await rechargeDailyRepository.claimDay(round, day, this);
        this.busy = false;
        if (!this.alive) return;
        if (result === 'ok') {
            await this.present(++this.revision);
        } else {
            this.setHint(GIFT_TEXTS.failed, true);
        }
    }

    private onPayChannel(_id: number): void {
        this.setHint(GIFT_TEXTS.payMissing, true);
    }

    // ============================================================
    // 图与文案
    // ============================================================

    /** 固定几张图（品质框 / 子页签 / 灵玉按钮底）；首次之后走缓存。 */
    private async preloadStaticFrames(): Promise<void> {
        await Promise.all([
            this.loadQualityFrames(),
            this.loadSubTabFrames(),
            this.loadLingYuButtonFrame(),
        ]);
    }

    private async loadQualityFrames(): Promise<Map<string, SpriteFrame>> {
        const cached = this.qualityFrames;
        if (cached) return cached;
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(QUALITY_FRAME_NAMES.map(async (name) => {
            const frame = await loadFrameArt(name);
            if (frame) frames.set(name, frame);
        }));
        this.qualityFrames = frames;
        return frames;
    }

    private async loadSubTabFrames(): Promise<IGiftSubTabFrames> {
        const cached = this.subTabFrames;
        if (cached) return cached;

        const entries = Object.entries(GIFT_SUB_TAB_ART);
        const loaded = await Promise.all([
            this.loadGiftArt('subTabOff'),
            this.loadGiftArt('subTabOn'),
            ...entries.map(([, artKey]) => this.loadGiftArt(artKey)),
        ]);

        const titles = new Map<string, SpriteFrame>();
        entries.forEach(([artKey], index) => {
            const frame = loaded[index + 2];
            if (frame) titles.set(artKey, frame);
        });

        const frames: IGiftSubTabFrames = { off: loaded[0], on: loaded[1], titles };
        this.subTabFrames = frames;
        return frames;
    }

    private async loadLingYuButtonFrame(): Promise<SpriteFrame | null> {
        if (this.lingYuButtonTried) return this.lingYuButtonFrame;
        this.lingYuButtonTried = true;
        this.lingYuButtonFrame = await this.loadGiftArt('btnLingYu');
        return this.lingYuButtonFrame;
    }

    /**
     * 预加载一批 `resId` 的图标。
     *
     * 两级来源（见 `GiftArt.resolveGiftIconRef`）：`item.icon` 优先，查不到再走
     * `image/main/resbar` 的货币 / 资源档图。都拿不到的记进负缓存，之后不再重试。
     *
     * `items` 传本次数据源的 `item` 表 —— 两个充值页的 item 表来自各自的 repository
     * （`this.snapshot` 在这个页面可能还是空的 / 是「超值礼包」页的那份）。
     */
    private async loadIconFrames(
        resIds: readonly number[],
        items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }> | null = null,
    ): Promise<void> {
        const itemTable = items ?? this.snapshot?.items ?? new Map<number, { readonly quality: number; readonly icon: string }>();
        const wanted: { readonly resId: number; readonly root: string; readonly name: string }[] = [];
        for (const resId of resIds) {
            // `0` = 宝箱那行没有奖励（`reward === null`）占位，跳过。
            if (!resId) continue;
            if (this.iconFrames.has(resId) || this.missingIcons.has(resId)) continue;
            if (wanted.some((item) => item.resId === resId)) continue;
            const ref = resolveGiftIconRef(itemTable.get(resId), resId);
            if (ref) wanted.push({ resId, root: ref.root, name: ref.name });
            else this.missingIcons.add(resId);
        }
        if (wanted.length === 0) return;

        await Promise.all(wanted.map(async (item) => {
            const frame = await loadArt(item.name, item.root);
            if (frame) this.iconFrames.set(item.resId, frame);
            else this.missingIcons.add(item.resId);
        }));
    }

    private loadGiftArt(key: string): Promise<SpriteFrame | null> {
        const name = GIFT_ART_NAMES[key];
        if (!name) return Promise.resolve(null);
        return loadArt(name, GIFT_ART_ROOT);
    }

    /** 大页签（按 x 排序 —— `_children` 序 ≠ 视觉序）。 */
    private get tabButtons(): GiftTabButton[] {
        return this.tabBar.getComponentsInChildren(GiftTabButton)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    private presentTabButtons(): void {
        const tabs = this.tabButtons;
        for (let index = 0; index < tabs.length; index++) {
            const def = GIFT_MAIN_TABS[index];
            if (!def) {
                tabs[index].node.active = false;
                continue;
            }
            tabs[index].node.active = true;
            tabs[index].render('', def.key === this.selectedTab);
        }
    }

    /** 一套数据都没读到时的样子：两页全藏 + 提示。 */
    private presentEmpty(): void {
        this.ensureViews();
        this.presentTabButtons();
        this.specialView.node.active = false;
        this.totalViewNode.active = false;
        this.dailyViewNode.active = false;
        this.setHint(GIFT_TEXTS.empty);
    }

    private setHint(text: string, error: boolean = false): void {
        this.hintLabel.string = text;
        this.hintLabel.color = error ? GIFT_HINT_ERROR : GIFT_HINT_IDLE;
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}

/** 提示文字颜色（与首充 / 七日同一口径：正常棕 / 异常红）。 */
const GIFT_HINT_IDLE = new Color(176, 168, 150, 255);
const GIFT_HINT_ERROR = new Color(226, 88, 74, 255);

/** 「累计充值」页两个页签的文案（唯一出口 `GiftTexts.RECHARGE_TEXTS`）。 */
const TOTAL_TAB_LABELS: ReadonlyMap<number, string> = new Map<number, string>([
    [RECHARGE_TAB.base, RECHARGE_TEXTS.tabTotal],
    [RECHARGE_TAB.advanced, RECHARGE_TEXTS.tabAdvanced],
]);
