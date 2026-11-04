import type { Node } from 'cc';
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

    constructor(private readonly context: IControllerContext, root: Node, private readonly presented: () => void) {
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
