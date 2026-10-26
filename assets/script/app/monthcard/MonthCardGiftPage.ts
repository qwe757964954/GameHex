import { _decorator, Label, Node, Prefab, SpriteFrame, instantiate } from 'cc';
import { routedLoad } from '../common/RoutedResource';
import { MONTHCARD_ART_ROOT, spriteFramePathOf } from '../ArtPaths';
import { resIconRoot } from '../common/ResTypes';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import type { PopupCloseReason } from '../../framework/ui/PopupDef';
import { loadArt } from '../card/CardLineupIcons';
import {
    MONTHCARD_ENTRY_PREFAB_PATH,
    MONTHCARD_FRAME_NAMES,
} from './MonthCardGiftArt';
import { MonthCardGiftEntry } from './MonthCardGiftEntry';
import type { IMonthCardGiftEntryArt } from './MonthCardGiftEntry';
import { entryPosition } from './MonthCardGiftLayout';
import { monthCardGiftRepository } from './MonthCardGiftRepository';
import type { IMonthCardGiftRepository } from './MonthCardGiftRepository';
import {
    buildView,
    buildViews,
    mustTakeDailyRewardFirst,
} from './MonthCardGiftTable';
import type { IMonthCardGiftSnapshot, IMonthCardGiftView } from './MonthCardGiftTable';
import { MONTHCARD_TEXTS } from './MonthCardGiftTexts';

const { ccclass, property } = _decorator;

const MONTHCARD_TICK_SECONDS = 1;

/**
 * 月卡礼包弹窗。
 * 数据由 Repository 读取，条目从 MonthCardGiftEntry.prefab 实例化。
 * 点空白关闭，无独立关闭按钮。
 */
@ccclass('MonthCardGiftPage')
export class MonthCardGiftPage extends PopupBase {
    static prefabPath = 'ui/MonthCardGift/MonthCardGift';

    @property({
        type: Node,
        tooltip: 'List：月卡条目容器',
    })
    list: Node = null!;

    @property({ type: Label, tooltip: 'Hint：空列表提示（可选）' })
    hintLabel: Label | null = null;

    private repo: IMonthCardGiftRepository = monthCardGiftRepository;
    private snapshot: IMonthCardGiftSnapshot | null = null;
    private views: IMonthCardGiftView[] = [];
    private entries: MonthCardGiftEntry[] = [];
    private readonly frames = new Map<string, SpriteFrame>();
    private readonly rewardIcons = new Map<number, SpriteFrame>();
    private entryPrefab: Prefab | null = null;
    private revision = 0;
    private busy = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.setHint('');
        // 购买成功广播（`CmdCardBuyBroMsg`）：购买时弹窗一定开着，这里挂、关闭时摘。
        this.repo.listen(this, this.onBuySettled);
        await this.presentAll();
        if (!this.alive) return;
        this.startCountdown();
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.stopCountdown();
        this.repo.unlisten(this);
    }

    protected onCover(): void {
        this.stopCountdown();
    }

    protected onReveal(): void {
        this.startCountdown();
    }

    setRepository(repository: IMonthCardGiftRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async presentAll(): Promise<void> {
        const revision = ++this.revision;

        let snapshot: IMonthCardGiftSnapshot;
        try {
            snapshot = await this.repo.load();
        } catch (error) {
            console.error('[MonthCardGift] 取数失败', error);
            this.setHint(MONTHCARD_TEXTS.failed);
            return;
        }
        if (!this.alive || revision !== this.revision) return;
        this.snapshot = snapshot;

        const views = buildViews(snapshot);
        this.views = views;

        if (views.length === 0) {
            for (const entry of this.entries) entry.node.active = false;
            this.setHint(MONTHCARD_TEXTS.empty);
            return;
        }
        this.setHint('');

        // 先预加载完再铺界面，避免闪帧
        await this.loadArt(views);
        if (!this.alive || revision !== this.revision) return;

        const ready = await this.ensureEntries(views.length);
        if (!this.alive || revision !== this.revision || !ready) return;

        for (let index = 0; index < views.length; index++) {
            const entry = this.entries[index];
            entry.node.active = true;
            const pos = entryPosition(index);
            entry.node.setPosition(pos.x, pos.y, 0);
            entry.applyView(views[index], this.art);
        }
    }

    private get art(): IMonthCardGiftEntryArt {
        return { frames: this.frames, rewardIcons: this.rewardIcons };
    }

    /** 预加载月卡图与奖励图标。 */
    private async loadArt(views: readonly IMonthCardGiftView[]): Promise<void> {
        await Promise.all(MONTHCARD_FRAME_NAMES.map(async (name) => {
            const frame = await loadArt(name, MONTHCARD_ART_ROOT);
            if (frame) this.frames.set(name, frame);
        }));

        const wanted = new Map<number, string>();
        for (const view of views) {
            const gift = view.gift;
            const buyReward = gift.buyReward;
            if (buyReward && buyReward.iconArt.length > 0) wanted.set(buyReward.resId, buyReward.iconArt);
            for (const reward of gift.dayRewards) {
                if (reward.iconArt.length > 0) wanted.set(reward.resId, reward.iconArt);
            }
        }
        if (wanted.size === 0) return;

        await Promise.all(Array.from(wanted.entries()).map(async ([resId, iconArt]) => {
            let frame: SpriteFrame | null = null;
            if (iconArt.startsWith('icons/')) {
                // 数据里存的是图片资源路径，装配路径必须补 `/spriteFrame`，
                // 否则 resources bundle 索引里查不到裸路径（见 `spriteFramePathOf`）。
                const framePath = spriteFramePathOf(iconArt);
                frame = await new Promise<SpriteFrame | null>((resolve) => {
                    routedLoad(framePath, SpriteFrame, (err, sf) => {
                        if (err) {
                            console.warn('[MonthCardGift] 物品图标加载失败', framePath, err.message);
                            resolve(null);
                        } else {
                            resolve(sf);
                        }
                    });
                });
            } else {
                frame = await loadArt(iconArt, resIconRoot(iconArt));
            }
            if (frame) this.rewardIcons.set(resId, frame);
        }));
    }

    /** 保证有 count 个条目实例，多余的只隐藏不销毁。 */
    private async ensureEntries(count: number): Promise<boolean> {
        if (!this.entryPrefab) {
            this.entryPrefab = await this.loadEntryPrefab();
            if (!this.entryPrefab) {
                this.setHint(MONTHCARD_TEXTS.entryLoadFailed);
                return false;
            }
        }

        while (this.entries.length < count) {
            const node = instantiate(this.entryPrefab);
            node.parent = this.list;
            const component = node.getComponent(MonthCardGiftEntry);
            if (!component) {
                console.error('[MonthCardGift] 条目预制体上没有 MonthCardGiftEntry 组件', MONTHCARD_ENTRY_PREFAB_PATH);
                node.destroy();
                this.setHint(MONTHCARD_TEXTS.entryLoadFailed);
                return false;
            }
            component.onBuy = (view) => { void this.handleBuy(view); };
            component.onClaim = (view) => { void this.handleClaim(view); };
            this.entries.push(component);
        }

        for (let index = count; index < this.entries.length; index++) {
            this.entries[index].node.active = false;
        }
        return true;
    }

    private loadEntryPrefab(): Promise<Prefab | null> {
        return new Promise<Prefab | null>((resolve) => {
            routedLoad(MONTHCARD_ENTRY_PREFAB_PATH, Prefab, (error, asset) => {
                if (error || !asset) {
                    console.warn('[MonthCardGift] 条目预制体加载失败', MONTHCARD_ENTRY_PREFAB_PATH, error);
                    resolve(null);
                    return;
                }
                resolve(asset);
            });
        });
    }

    // ============================================================
    // 倒计时
    // ============================================================

    private readonly onSecondTick = (): void => {
        const now = Date.now();
        let expired = false;
        for (const entry of this.entries) {
            if (entry.node.active && entry.tickRemain(now)) expired = true;
        }
        if (expired) void this.presentAll();
    };

    private startCountdown(): void {
        this.stopCountdown();
        this.schedule(this.onSecondTick, MONTHCARD_TICK_SECONDS);
    }

    private stopCountdown(): void {
        this.unschedule(this.onSecondTick);
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 购买 / 续费。有效期内必须先领今日奖励。 */
    private async handleBuy(view: IMonthCardGiftView): Promise<void> {
        if (this.busy) return;
        const gift = view.gift;
        const hasDayReward = gift.dayRewards.length > 0;
        if (mustTakeDailyRewardFirst(view.endTimeMs, hasDayReward, view.claimedToday, Date.now())) {
            FW.showTip(MONTHCARD_TEXTS.dailyNotTaken);
            return;
        }

        this.busy = true;
        this.setHint('');
        const result = await this.repo.buy(gift.type, gift.payId, this);
        this.busy = false;
        if (!this.alive) return;

        if (result === 'offline') { this.setHint(MONTHCARD_TEXTS.offline); return; }
        if (result === 'failed') { this.setHint(MONTHCARD_TEXTS.failed); return; }
        // 'ok' 只表示「已开单、支付已触发」，真正发货等 `CmdCardBuyBroMsg` 广播（`onBuySettled`）。
        // 这里**不**再 `presentAll()`：支付成功前界面保持「未购买」，避免闪一下又没变化。
    }

    /**
     * 购买成功广播回调（对应老端 `ModelMonthCard.enter()` 挂的 `CmdCardBuyBroMsg`）：
     * 服务端真发货（endTime 已加、buyReward 已发）后才广播 ⇒ 飘字 + 弹奖励 + 重刷状态。
     */
    private readonly onBuySettled = (goods: CmdGoods[]): void => {
        if (!this.alive) return;
        FW.showTip(MONTHCARD_TEXTS.buySuccess);
        if (goods.length > 0) FW.ShowReward(goods);
        void this.presentAll();
    };

    /** 领取每日奖励。 */
    private async handleClaim(view: IMonthCardGiftView): Promise<void> {
        if (this.busy) return;
        const snapshot = this.snapshot;
        if (!snapshot) return;

        const state = snapshot.states.get(view.gift.plan);
        const activityResId = state ? state.activityResId : 0;
        if (activityResId <= 0) {
            FW.showTip(MONTHCARD_TEXTS.offline);
            return;
        }

        this.busy = true;
        this.optimisticClaim(view, activityResId);

        const result = await this.repo.claim(activityResId, this);
        this.busy = false;
        if (!this.alive) return;

        if (result === 'offline') FW.showTip(MONTHCARD_TEXTS.offline);
        else if (result === 'failed') FW.showTip(MONTHCARD_TEXTS.failed);
        await this.presentAll();
    }

    /** 乐观切到今日已领取。 */
    private optimisticClaim(view: IMonthCardGiftView, activityResId: number): void {
        const index = this.views.findIndex((item) => item.gift.plan === view.gift.plan);
        if (index < 0) return;
        const provisional = buildView(
            view.gift,
            view.endTimeMs,
            { claimedToday: true, activityResId },
            Date.now(),
        );
        this.views[index] = provisional;
        const entry = this.entries[index];
        if (entry) entry.applyView(provisional, this.art);
    }

    // ============================================================
    // 工具
    // ============================================================

    private setHint(text: string): void {
        if (this.hintLabel && this.hintLabel.isValid) this.hintLabel.string = text;
        if (text.length > 0) console.log(`[MonthCardGift] ${text}`);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    onDestroy(): void {
        this.stopCountdown();
        this.revision += 1;
        this.entries = [];
        this.views = [];
        this.repo.unlisten(this);
        super.onDestroy();
    }
}
