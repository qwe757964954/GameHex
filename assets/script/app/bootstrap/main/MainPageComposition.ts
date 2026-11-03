import type { Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { CardLineupPage } from '../../card/CardLineupPage';
import { CardLineupController } from '../../card/CardLineupController';
import { cardRepository } from '../../card/CardRepository';
import { CardUpgradePage } from '../../card/CardUpgradePage';
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

interface PageLifecycle {
    readonly ready: () => void;
    readonly enabled?: () => void;
    readonly disabled?: () => void;
}

/** One mounted tab owns one composition; views receive only presentation resources. */
export class MainPageComposition extends ControllerBase {
    private readonly pages = new Map<object, PageLifecycle>();
    readonly territory: MainTerritoryMap | null;

    constructor(context: IControllerContext, root: Node, private readonly presented: () => void) {
        super(context, 'main-page');
        this.listen(VIEW_LIFECYCLE, this.onLifecycle);
        try {
            const failed = (error: unknown): void => console.warn('[MainPageComposition]', error);
            const card = root.getComponent(CardLineupPage);
            if (card) {
                card.initialize(this.resources);
                const controller = new CardLineupController(context, {
                    owner: card, autoLoadDecks: card.autoLoadDecks, fallbackLevel: card.fallbackLevel,
                    repository: cardRepository,
                    openEditor: () => { void LineupBoardPage.open(); },
                    openUpgrade: (unit, level) => { void CardUpgradePage.open({ userData: { card: unit, cardId: unit.id, level } }); },
                    failed,
                });
                this.own(() => controller.dispose());
                this.pages.set(card, { ready: () => controller.start() });
            }
            const role = root.getComponent(RolePage);
            if (role) {
                const controller = new RoleController(context, {
                    owner: role, load: () => roleRepository.load(), render: snapshot => role.renderSnapshot(snapshot),
                    selectBag: tab => role.selectBag(tab), showBag: tab => role.showBag(tab),
                    openTalent: () => { void MilitiaTalentPage.open(); }, tip: text => FW.showTip(text), failed,
                });
                this.own(() => controller.dispose());
                this.pages.set(role, { ready: () => controller.start(), enabled: () => { void controller.refresh(); }, disabled: () => controller.cancel() });
            }
            const store = root.getComponent(StorePage);
            if (store) {
                const controller = new StoreController(context, store, storeAction, failed);
                this.own(() => controller.dispose());
                this.pages.set(store, { ready: () => controller.start() });
            }
            const league = root.getComponent(LeagueTabPage);
            if (league) {
                const controller = new LeagueTabController(context, {
                    owner: league, load: () => leagueRepository.load(), showPage: joined => league.showPage(joined), failed,
                });
                this.own(() => controller.dispose());
                this.pages.set(league, { ready: () => controller.start() });
            }
            const main = root.getComponent(MainPage);
            if (main) main.initialize(this.resources);
            const territory = root.getComponentInChildren(MainTerritoryMap);
            this.territory = territory;
            if (territory) {
                const entry = new TerritoryEntry(context, (callback, seconds) => {
                    territory.schedule(callback, seconds);
                    return () => territory.unschedule(callback);
                });
                this.own(() => entry.dispose());
                territory.initialize(entry.controller.resources, entry.saveOwner);
                this.pages.set(territory, { ready: () => entry.start() });
                if (main) {
                    // 宝箱栏的「战斗」格要靠它演整页过场（见 `MainPage.territoryMap`）。
                    main.territoryMap = territory;
                    main.hasTerritoryMap = true;
                }
            }
        } catch (error) { this.dispose(); throw error; }
    }

    private onLifecycle(event: IViewLifecycle): void {
        const page = this.pages.get(event.owner);
        if (!page) return;
        if (event.phase === 'presented') { this.presented(); return; }
        if (event.phase === 'destroyed') { this.dispose(); return; }
        if (event.phase === 'ready') {
            page.ready();
        } else if (event.phase === 'enabled') page.enabled?.();
        else if (event.phase === 'disabled') page.disabled?.();
    }
}
