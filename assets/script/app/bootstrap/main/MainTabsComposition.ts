import { director, Director, instantiate, Node, Prefab } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { MainTabController } from '../../main/MainTabController';
import { MainTab, MainTabHost } from '../../main/MainTabHost';
import { MainTabEvent } from '../../main/MainTabEvents';
import { MainPageComposition } from './MainPageComposition';
import { BigMapEntry } from '../../bigmap/application/BigMapEntry';
import { CHEST_EVENTS } from '../../main/ChestEvents';
import * as TerritoryChestOpenPageModule from '../../territory/view/TerritoryChestOpenPage';
import { fetchFormations } from '../../card/FormationService';
import { cardRepository } from '../../card/CardRepository';
import { cardArtProvider } from '../../card/CardArtProvider';
import { visibleIconTallies, visibleLineupCards } from '../../card/CardLineupTypes';
import { checkFirstRechargeOnEnterMain } from '../../firstRecharge/FirstRechargeAutoOpen';
import { GAME_VIEW_MARK, reportGameViewClick } from '../../main/GameViewClickService';
import { GameNet } from '../../net/GameNet';

/** 宝箱奖励事件名；单测把 `ChestEvents` 模块桩成空对象时仍能注册监听。 */
const CHEST_REWARDS_EVENT = CHEST_EVENTS?.REWARDS ?? 'chest:rewards';

/** ProcedureMain owns this object; no view holds a controller or its teardown callback. */
export class MainTabsComposition extends ControllerBase {
    readonly tabs: MainTabController<Prefab>;
    private page: MainPageComposition | null = null;
    private backgroundWarmupActive = false;
    private afterDrawWarmup: (() => void) | null = null;
    private started = false;

    constructor(private readonly context: IControllerContext, private readonly host: MainTabHost) {
        super(context, 'main-tabs-composition');
        this.tabs = this.createController();
        this.listen(VIEW_LIFECYCLE, this.onLifecycle);
        this.listen(MainTabEvent.Warmup, this.onWarmup);
        this.listen(CHEST_REWARDS_EVENT, this.onTreasureRewardsFallback);
    }
    private createController(): MainTabController<Prefab> {
        return new MainTabController(this.context, {
            assetType: Prefab,
            failed: (tab, error) => console.warn(`[MainTabsComposition] 页面加载失败：${tab}`, error),
            view: {
                showPage: prefab => this.showPage(prefab),
                renderNav: tab => this.host.renderNav(tab)
            },
            world: {
                openWorld: () => BigMapEntry.shared().open(this.context.configs, { navigation: this.host.navBar, onClose: () => this.tabs.worldClosed() }),
                closeWorld: () => BigMapEntry.shared().close(),
                isWorldOpen: () => BigMapEntry.shared().isOpen
            },
            warmup: {
                beforeSwitch: () => { this.cancelBackgroundWarmup(); this.context.sessionAssets.pauseWarmup?.(); },
                settled: () => this.scheduleBackgroundWarmup()
            },
            hero: {
                prefetchHero: () => this.prefetchHero()
            },
            telemetry: {
                reportClick: tab => { void reportGameViewClick(tab === MainTab.World ? GAME_VIEW_MARK.World : GAME_VIEW_MARK.Other, this.host); }
            },
        });
    }
    /** 与页面 prefab 加载重叠；请求与图片复用既有会话缓存，不等待模型或网络才备图。 */
    private prefetchHero(): void {
        void fetchFormations({ label: '切角色 tab 预取' });
        cardRepository.prefetchHeroInfos();
        void this.warmHeroArt();
    }
    private async warmHeroArt(): Promise<void> {
        const revision = this.tabs.snapshot.revision;
        try {
            const art = await cardRepository.loadArtConfig();
            if (this.isDisposed || revision !== this.tabs.snapshot.revision) return;
            const snapshot = cardRepository.loadLineupSnapshot();
            if (!snapshot) return;
            const deck = visibleLineupCards(snapshot.deck);
            await Promise.all([
                ...deck.map(card => cardArtProvider.loadLineupSlot(card, art)),
                ...visibleIconTallies(deck, art.lineup).map(item => cardArtProvider.loadTallyFrames(item)),
            ]);
        } catch (error) { console.warn('[MainTabsComposition] 卡牌首屏图片预取失败', error); }
    }
    private onLifecycle(event: IViewLifecycle, source: object): void {
        if (source !== this.host) return;
        if (event.phase === 'ready') this.start();
        else if (event.phase === 'destroyed') this.dispose();
    }
    start(): void {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.tabs.start();
        const ready = this.tabs.switchTab(this.host.defaultTab);
        const revision = this.tabs.snapshot.revision;
        void ready.then(() => {
            if (this.isDisposed || revision !== this.tabs.snapshot.revision || !this.page || this.tabs.snapshot.loadingTab !== -1) return;
            void checkFirstRechargeOnEnterMain(this.host);
        });
    }
    private showPage(prefab: Prefab): void {
        const node = instantiate(prefab);
        let next: MainPageComposition | null = null;
        try {
            next = new MainPageComposition(this.context, node, () => this.host.resolveFirstScreen(), this.host);
            const map = next.territory;
            if (map) {
                const focus = this.host.focusCellId;
                this.host.focusCellId = null;
                if (focus) map.setFocusCell(focus.chapterId, focus.cellId);
            }
            this.host.mountPage(node);
        } catch (error) {
            try { next?.dispose(); }
            catch (cleanupError) { console.error('[MainTabsComposition] 页面装配失败后的控制器清理失败', cleanupError); }
            try { node.destroy(); }
            catch (cleanupError) { console.error('[MainTabsComposition] 页面装配失败后的节点清理失败', cleanupError); }
            throw error;
        }
        this.page?.dispose();
        this.page = next;
    }
    /**
     * 宝箱奖励的兜底路由：页面组合还活着时由它处理；页面已销毁或已换成非主页时由主 tabs 接手，
     * 避免 `fastOpen/open` 回包迟到导致奖励丢失。
     */
    private onTreasureRewardsFallback(event: { readonly goods: readonly CmdGoods[] }): void {
        if (!event.goods.length) return;
        if (this.page?.handlesTreasureRewards) return;
        void TerritoryChestOpenPageModule.TerritoryChestOpenPage.open({ userData: { goods: event.goods } }).then(popup => {
            if (this.isDisposed) popup?.close();
        }).catch(error => console.warn('[MainTabsComposition] 宝箱奖励展示失败', error));
    }
    private onWarmup(): void {
        this.backgroundWarmupActive = true;
        this.scheduleBackgroundWarmup();
    }
    private scheduleBackgroundWarmup(): void {
        this.cancelBackgroundWarmup();
        if (!this.backgroundWarmupActive || this.isDisposed || this.tabs.snapshot.loadingTab !== -1) return;
        const revision = this.tabs.snapshot.revision;
        const callback = (): void => {
            this.afterDrawWarmup = null;
            if (this.isDisposed || revision !== this.tabs.snapshot.revision || this.tabs.snapshot.loadingTab !== -1) return;
            void this.warmHeroArt();
            void this.context.sessionAssets.warmup?.().catch(error => console.warn('[MainTabsComposition] 静默预下载失败', error));
        };
        this.afterDrawWarmup = callback;
        director.once(Director.EVENT_AFTER_DRAW, callback);
    }
    private cancelBackgroundWarmup(): void {
        if (this.afterDrawWarmup) director.off(Director.EVENT_AFTER_DRAW, this.afterDrawWarmup);
        this.afterDrawWarmup = null;
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.releaseInputs();
        const page = this.page;
        this.page = null;
        try {
            this.cancelBackgroundWarmup();
            this.context.sessionAssets.pauseWarmup?.();
            GameNet.instance.removeCaller(this.host);
        } finally {
            try { this.tabs.dispose(); }
            finally {
                try { page?.dispose(); }
                finally { super.dispose(); }
            }
        }
    }
}
