import { director, Director, instantiate, Prefab } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { MainTabController } from '../../main/MainTabController';
import { MainTab, MainTabHost } from '../../main/MainTabHost';
import { MainTabEvent } from '../../main/MainTabEvents';
import { MainPageComposition } from './MainPageComposition';
import { BigMapEntry } from '../../bigmap/application/BigMapEntry';
import { fetchFormations } from '../../card/FormationService';
import { checkFirstRechargeOnEnterMain } from '../../firstRecharge/FirstRechargeAutoOpen';
import { GAME_VIEW_MARK, reportGameViewClick } from '../../main/GameViewClickService';
import { GameNet } from '../../net/GameNet';

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
    }
    private createController(): MainTabController<Prefab> {
        return new MainTabController(this.context, {
            owner: this.host,
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
                prefetchHero: () => { void fetchFormations({ label: '切角色 tab 预取' }); }
            },
            telemetry: {
                reportClick: tab => { void reportGameViewClick(tab === MainTab.World ? GAME_VIEW_MARK.World : GAME_VIEW_MARK.Other, this.host); }
            },
        });
    }
    private onLifecycle(event: IViewLifecycle): void {
        if (event.owner !== this.host) return;
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
            next = new MainPageComposition(this.context, node, () => this.host.resolveFirstScreen());
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
    private onWarmup(event: { readonly owner: object }): void {
        if (event.owner !== this.host) return;
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
