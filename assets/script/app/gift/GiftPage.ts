import { _decorator, Button, Color, Label, Node, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadArt } from '../card/CardLineupIcons';
import {
    GIFT_ART_NAMES,
    GIFT_ART_ROOT,
    GIFT_SUB_TAB_ART,
    qualityFrameName,
    resolveGiftIconRef,
} from './GiftArt';
import { giftRepository } from './GiftRepository';
import { loadQualityFrameMap } from '../common/QualityFrameLoader';
import type { IGiftRepository, IGiftSnapshot } from './GiftRepository';
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
    listSubTabs,
    sortGiftRows,
} from './GiftTable';
import type { IGiftShopRow, GiftMainTabKey } from './GiftTable';
import { GIFT_TEXTS, RECHARGE_TEXTS } from './GiftTexts';

const { ccclass, property } = _decorator;

/**
 * 「礼包」弹窗，对应 `assets/resources/ui/Gift/Gift.prefab`。
 *
 * 页面容器 `PageRoot` 下包含超值礼包、累计充值和每日充值三页，底部页签切换。
 * 静态布局全部在 prefab 上；本类只负责取数、加载随数据变化的图片、组装视图模型，
 * 以及把点击转成仓库请求后重新取数。
 */
@ccclass('GiftPage')
export class GiftPage extends PopupBase {
    /** 弹窗在 resources 下的路径；目录名大小写在真机上敏感。 */
    static prefabPath = 'ui/Gift/Gift';

    @property({ type: Node, tooltip: 'BackBtn：左下返回按钮（挂 cc.Button）' })
    backButton: Node = null!;

    @property({ type: Node, tooltip: 'TabBar：底部大页签栏（挂 3 个 GiftTabButton）' })
    tabBar: Node = null!;

    @property({ type: Node, tooltip: 'PageRoot：页面容器' })
    pageRoot: Node = null!;

    @property({ type: GiftSpecialView, tooltip: 'PageRoot/SpecialPage：超值礼包页' })
    specialView: GiftSpecialView = null!;

    /** prefab 中该字段留空，`ensureViews()` 按节点名从 `PageRoot` 查找。 */
    @property({ type: Node, tooltip: 'PageRoot/RechargeTotalPage：累计充值页' })
    totalViewNode: Node | null = null;

    /** prefab 中该字段留空，`ensureViews()` 按节点名从 `PageRoot` 查找。 */
    @property({ type: Node, tooltip: 'PageRoot/DailyPage：每日充值页' })
    dailyViewNode: Node | null = null;

    @property({ type: Label, tooltip: 'Hint：提示行（空配置 / 离线 / 操作失败 / 购买成功）' })
    hintLabel: Label = null!;

    /** 数据端口；测试可替换。 */
    private repo: IGiftRepository = giftRepository;

    private snapshot: IGiftSnapshot | null = null;

    private selectedTab: GiftMainTabKey = 'special';

    /** 当前子页签（`giftShop.type`）；`0` 表示尚未选择。 */
    private selectedType = 0;

    private selectedDailyRound = 1;

    private selectedTotalTab: number = RECHARGE_TAB.base;

    /** 两个充值页的组件；在 `ensureViews()` 中解析。 */
    private dailyView: RechargeDailyView | null = null;

    private totalView: RechargeTotalView | null = null;

    private busy = false;

    /** 每次取数或换页签时递增，用于丢弃过期异步结果。 */
    private revision = 0;

    /** 品质框缓存（4 张固定图）。 */
    private qualityFrames: Map<string, SpriteFrame> | null = null;

    /** 子页签底图和标题图缓存。 */
    private subTabFrames: IGiftSubTabFrames | null = null;

    /** `resId` → 图标，道具和货币共用。 */
    private readonly iconFrames = new Map<number, SpriteFrame>();

    /** 确认无图的 `resId`，避免每次刷新重复加载。 */
    private readonly missingIcons = new Set<number>();

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.ensureViews();
        this.backButton.on(Button.EventType.CLICK, this.onBackClick, this);

        const tabs = this.tabButtons;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].bind(index, (clicked) => this.onTabClick(clicked));
        }

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
        // 关闭后使所有在途请求失效。
    }

    onDestroy(): void {
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
        if (snapshot.shops.length === 0 && snapshot.payChannels.length === 0) {
            this.snapshot = snapshot;
            this.presentEmpty();
            return;
        }
        // 先把固定图加载完，避免界面先出现空框再补图。
        await this.preloadStaticFrames();
        if (!this.alive || revision !== this.revision) return;
        this.snapshot = snapshot;
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
        await this.loadIconFrames(collectGiftRewardResIds(rows).concat(GIFT_CURRENCY_RES_ID), snapshot.items);
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
                qualityFrame: this.qualityFrameOfRes(snapshot.items, reward.resId, qualityFrames),
                iconFrame: this.iconFrames.get(reward.resId) ?? null,
            })),
        };
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

    /** 奖励格的品质框和图标必须逐格配对，不能整行复用同一个框。 */
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

    /** `@property` 未绑定时从 `PageRoot` 按节点名查找，并解析两个充值页组件。 */
    private ensureViews(): void {
        if (!this.totalViewNode && this.pageRoot) {
            this.totalViewNode = this.pageRoot.getChildByName('RechargeTotalPage');
        }
        if (!this.dailyViewNode && this.pageRoot) {
            this.dailyViewNode = this.pageRoot.getChildByName('DailyPage');
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

    /** 铺「累计充值」页；图标需在 `view.present()` 前加载完，避免行渲染时闪空图。 */
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
     * 铺「每日充值」页（`rechargeDaily` 表 + `CmdRechargeDaily` 缓存）。
     * 图标同样要在 `view.present()` 前加载完。
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

    /** 每日充值领奖；`isAcc` 为真时领累计奖励，否则领单日奖励。 */
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

    // ============================================================
    // 图与文案
    // ============================================================

    /** 固定几张图（品质框 / 子页签）；首次之后走缓存。 */
    private async preloadStaticFrames(): Promise<void> {
        await Promise.all([
            this.loadQualityFrames(),
            this.loadSubTabFrames(),
        ]);
    }

    private async loadQualityFrames(): Promise<Map<string, SpriteFrame>> {
        const cached = this.qualityFrames;
        if (cached) return cached;
        const frames = await loadQualityFrameMap();
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

    /**
     * 预加载一批 `resId` 的图标。
     *
     * `item.icon` 优先，查不到再走 `image/main/resbar`；仍无图则记入负缓存。
     * `items` 使用调用方传入的 item 表，因为两个充值页的数据源与当前 `snapshot` 不同。
     */
    private async loadIconFrames(
        resIds: readonly number[],
        items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>,
    ): Promise<void> {
        const wanted: { readonly resId: number; readonly root: string; readonly name: string }[] = [];
        const seen = new Set<number>();
        for (const resId of resIds) {
            // 0 是「宝箱没有奖励」的占位值。
            if (resId <= 0 || seen.has(resId)) continue;
            seen.add(resId);
            if (this.iconFrames.has(resId) || this.missingIcons.has(resId)) continue;
            const ref = resolveGiftIconRef(items.get(resId), resId);
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

    /** 大页签按 x 坐标排序，`_children` 顺序不等于视觉顺序。 */
    private get tabButtons(): GiftTabButton[] {
        return this.tabBar.getComponentsInChildren(GiftTabButton)
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

    /** 关闭后使所有在途请求失效：`isPopupOpen` 立即转 false。 */
    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}

/** 提示文字颜色：正常棕色，错误红色。 */
const GIFT_HINT_IDLE = new Color(176, 168, 150, 255);
const GIFT_HINT_ERROR = new Color(226, 88, 74, 255);

/** 「累计充值」页两个页签的文案。 */
const TOTAL_TAB_LABELS: ReadonlyMap<number, string> = new Map<number, string>([
    [RECHARGE_TAB.base, RECHARGE_TEXTS.tabTotal],
    [RECHARGE_TAB.advanced, RECHARGE_TEXTS.tabAdvanced],
]);
