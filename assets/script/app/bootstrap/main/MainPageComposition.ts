import { instantiate, Prefab, type Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { CardLineupPage } from '../../card/CardLineupPage';
import { CardLineupController } from '../../card/CardLineupController';
import { cardRepository } from '../../card/CardRepository';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import type { ICardUpgradeOpenData } from '../../card/CardPresentations';
import { LineupBoardPage } from '../../card/LineupBoardPage';
import { RolePage } from '../../role/RolePage';
import { RoleController } from '../../role/RoleController';
import { roleRepository } from '../../role/RoleRepository';
import { MilitiaTalentPage } from '../../role/MilitiaTalentPage';
import { StorePage } from '../../store/StorePage';
import { StoreController } from '../../store/StoreController';
import { storeAction } from '../../store/StoreActions';
import { LeagueTabPage } from '../../league/LeagueTabPage';
import { LeagueTabController } from '../../league/LeagueTabController';
import { leagueRepository } from '../../league/LeagueRepository';
import { MainPage } from '../../main/MainPage';
import { MainTerritoryMap } from '../../main/MainTerritoryMap';
import { TerritoryEntry } from '../../territory/application/TerritoryEntry';
import { FW } from '../../../framework/FW';
import { TerritoryHeroProgressSource } from './TerritoryHeroProgressSource';
import { GuideController } from '../../guide/application/GuideController';
import { loadGuideDialog, loadGuidePortraits, loadGuideSteps } from '../../guide/application/GuideLoader';
import { createGuideSaveStore } from '../../guide/application/GuideStorageAdapter';
import { GuideDialogView } from '../../guide/ui/GuideDialogView';

/** 引导对话层 prefab（`assets/bundles/main-pages/ui/Guide/GuideDialog.prefab`）。 */
const GUIDE_DIALOG_PREFAB = 'ui/Guide/GuideDialog';

interface IPageLifecycle {
    readonly ready: () => void;
    readonly enabled?: () => void;
    readonly disabled?: () => void;
}

/** One mounted tab owns one composition; views receive only presentation resources. */
export class MainPageComposition extends ControllerBase {
    private readonly pages = new Map<object, IPageLifecycle>();
    private territoryView: MainTerritoryMap | null = null;
    get territory(): MainTerritoryMap | null { return this.territoryView; }

    constructor(private readonly context: IControllerContext, private readonly root: Node, private readonly presented: () => void) {
        super(context, 'main-page');
        this.listen(VIEW_LIFECYCLE, this.onLifecycle);
        try { this.mount(root); }
        catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[MainPageComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private mount(root: Node): void {
        const card = root.getComponent(CardLineupPage);
        if (card) this.mountCard(card);
        const role = root.getComponent(RolePage);
        if (role) this.mountRole(role);
        const store = root.getComponent(StorePage);
        if (store) this.mountStore(store);
        const league = root.getComponent(LeagueTabPage);
        if (league) this.mountLeague(league);
        const main = root.getComponent(MainPage);
        if (main) main.initialize(this.resources);
        this.territoryView = root.getComponentInChildren(MainTerritoryMap);
        if (this.territoryView) this.mountTerritory(this.territoryView, main);
        this.mountGuide();
    }

    /**
     * 挂新手引导。
     *
     * 异步是因为要等 `guideStep` 表加载；主界面每次从战斗回来都会重建组合层，
     * 而 `GuideProgress` 从存档恢复，所以重复启动是幂等的（不会重放已完成的步）。
     *
     * 表缺失 / 配置断链 ⇒ `start()` 返回 false，本次不做引导，主界面照常可用。
     */
    private mountGuide(): void {
        void this.startGuide();
    }

    private async startGuide(): Promise<void> {
        const steps = await loadGuideSteps();
        // await 之后组合层可能已经被销毁（切页 / 退出对局），必须判。
        if (this.isDisposed || steps.length === 0) return;

        const view = await this.createGuideView();
        if (!view) return;
        if (this.isDisposed) { view.node.destroy(); return; }

        // 台词与立绘并行取；任一缺失只让对应表现空着（Loader 内部已兜底）。
        const [{ groups }, frames] = await Promise.all([
            loadGuideDialog(),
            loadGuidePortraits(this.resources),
        ]);
        if (this.isDisposed) { view.node.destroy(); return; }
        view.initialize(groups, frames);

        const controller = new GuideController(this.context, {
            store: createGuideSaveStore(),
            steps,
            view: { render: (state, advance) => view.render(state, advance) },
            failed: reportMainPageFailure,
        });
        if (!controller.start()) {
            view.node.destroy();
            controller.dispose();
            return;
        }
        this.own(() => controller.dispose());
    }

    /**
     * 实例化对话层，挂到主界面根节点末尾（兄弟序最大 = 盖在所有页面之上）。
     *
     * 初始 `active = false`：没启动 / 已走完引导时不能遮挡主界面，
     * 显隐由 `GuideDialogView.render / hide` 自己管。
     */
    private async createGuideView(): Promise<GuideDialogView | null> {
        try {
            const prefab = await this.resources.assets.load(GUIDE_DIALOG_PREFAB, Prefab, { scope: this.resources.scope });
            if (!prefab) {
                console.warn('[MainPageComposition] 引导 prefab 加载失败，本次不做引导');
                return null;
            }
            const node = instantiate(prefab);
            node.active = false;
            this.root.addChild(node);
            const view = node.getComponent(GuideDialogView);
            if (!view) {
                console.warn('[MainPageComposition] 引导 prefab 上缺少 GuideDialogView');
                node.destroy();
                return null;
            }
            return view;
        } catch (error) {
            reportMainPageFailure(error);
            return null;
        }
    }
    private registerPage(owner: object, controller: Pick<ControllerBase, 'dispose'>, lifecycle: IPageLifecycle): void {
        this.own(() => controller.dispose());
        this.pages.set(owner, lifecycle);
    }
    private mountCard(card: CardLineupPage): void {
        const controller = this.createCardController(card);
        this.registerPage(card, controller, { ready: () => controller.start() });
        card.initialize(this.resources);
    }
    private mountRole(role: RolePage): void {
        const controller = this.createRoleController(role);
        this.registerPage(role, controller, {
            ready: () => controller.start(), enabled: () => { void controller.refresh(); }, disabled: () => controller.cancel(),
        });
    }
    private mountStore(store: StorePage): void {
        const controller = this.createStoreController(store);
        this.registerPage(store, controller, { ready: () => controller.start() });
    }
    private mountLeague(league: LeagueTabPage): void {
        const controller = this.createLeagueController(league);
        this.registerPage(league, controller, { ready: () => controller.start() });
    }
    private mountTerritory(territory: MainTerritoryMap, main: MainPage | null): void {
        const entry = this.createTerritoryEntry(territory);
        this.registerPage(territory, entry, { ready: () => entry.start() });
        territory.initialize(entry.controller.resources, entry.saveOwner);
        // 2026-11-10 需求 ③：英雄碎片进度徽标的数据源由组合层注入（页面只认接口，
        // 不反向 import `app/card`）。纯表现，没注入 ⇒ 不播徽标，发奖链路零变化。
        territory.setHeroProgressSource(new TerritoryHeroProgressSource());
        if (main) {
            // 宝箱栏的「战斗」格使用本页地图演整页过场。
            main.territoryMap = territory;
            main.hasTerritoryMap = true;
        }
    }
    private createCardController(card: CardLineupPage): CardLineupController {
        return new CardLineupController(this.context, {
            owner: card,
            autoLoadDecks: card.autoLoadDecks,
            fallbackLevel: card.fallbackLevel,
            repository: cardRepository,
            failed: reportMainPageFailure,
            popups: {
                openEditor: () => { void LineupBoardPage.open(); },
                openUpgrade: (unit, level) => { void CardUpgradePage.open({ userData: { card: unit, cardId: unit.id, level } satisfies ICardUpgradeOpenData }); }
            },
        });
    }
    private createRoleController(role: RolePage): RoleController<Awaited<ReturnType<typeof roleRepository.load>>> {
        return new RoleController(this.context, {
            owner: role,
            failed: reportMainPageFailure,
            repository: {
                load: () => roleRepository.load()
            },
            view: {
                render: snapshot => role.renderSnapshot(snapshot),
                selectBag: tab => role.selectBag(tab),
                showBag: tab => role.showBag(tab)
            },
            popups: {
                openTalent: () => { void MilitiaTalentPage.open(); }
            },
            feedback: {
                tip: text => FW.showTip(text)
            },
        });
    }
    private createStoreController(store: StorePage): StoreController {
        return new StoreController(this.context, store, storeAction, reportMainPageFailure);
    }
    private createLeagueController(league: LeagueTabPage): LeagueTabController {
        return new LeagueTabController(this.context, {
            owner: league,
            failed: reportMainPageFailure,
            repository: {
                load: () => leagueRepository.load()
            },
            view: {
                showPage: joined => league.showPage(joined)
            },
        });
    }
    private createTerritoryEntry(territory: MainTerritoryMap): TerritoryEntry {
        return new TerritoryEntry(this.context, (callback, seconds) => {
            territory.schedule(callback, seconds);
            return () => territory.unschedule(callback);
        });
    }
    private onLifecycle(event: IViewLifecycle): void {
        const page = this.pages.get(event.owner);
        if (!page) return;
        if (event.phase === 'presented') { this.presented(); return; }
        if (event.phase === 'destroyed') { this.dispose(); return; }
        if (event.phase === 'ready') page.ready();
        else if (event.phase === 'enabled') page.enabled?.();
        else if (event.phase === 'disabled') page.disabled?.();
    }
    dispose(): void {
        this.releaseInputs();
        this.pages.clear();
        this.territoryView = null;
        super.dispose();
    }
}
function reportMainPageFailure(error: unknown): void { console.warn('[MainPageComposition]', error); }
