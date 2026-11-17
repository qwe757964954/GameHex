import { CHEST_EVENTS } from '../../main/ChestEvents';
import { TerritoryUiEvent } from '../../territory/application/TerritoryEvents';
import { TerritoryChestOpenPage } from '../../territory/view/TerritoryChestOpenPage';
import { chestOpenLegendHeroesOf } from '../../territory/model/TerritoryChestOpenLayout';
import { HeroObtainPage } from '../../card/view/HeroObtainPage';
import { loadCardLevelUpRows } from '../../card/CardLineupDecks';
import { createItemCounter } from '../../card/ItemBag';
import { buildCardLevelUpTable, evaluateUpgrade, parseCardLevelUpRow } from '../../card/CardUpgradeCost';
import type { IShowRewardEntry as IRewardEntry } from '../../common/RewardEntries';
import { GuideComposition } from '../guide/GuideComposition';
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
import { TerritoryHeroProgressSource } from './TerritoryHeroProgressSource';


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
        this.listen(CHEST_EVENTS.REWARDS, this.onTreasureRewards);
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
        const guide = new GuideComposition(this.context, this.root, 'main', this.territoryView);
        this.own(() => guide.dispose());
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
        this.listen(TerritoryUiEvent.ChestRevealed, this.onChestRevealed);
        // 2026-11-10 需求 ③：英雄碎片进度徽标的数据源由组合层注入（页面只认接口，
        // 不反向 import `app/card`）。纯表现，没注入 ⇒ 不播徽标，发奖链路零变化。
        territory.setHeroProgressSource(new TerritoryHeroProgressSource());
        if (main) {
            // 宝箱栏的「战斗」格使用本页地图演整页过场。
            main.territoryMap = territory;
            main.hasTerritoryMap = true;
        }
    }
    private onTreasureRewards(event: { readonly owner: MainPage; readonly goods: readonly unknown[] }): void {
        if (event.owner.node !== this.root || !event.goods.length) return;
        void TerritoryChestOpenPage.open({ userData: { goods: event.goods } }).then(popup => {
            if (this.isDisposed) popup?.close();
        }).catch(reportMainPageFailure);
    }

    private onChestRevealed(event: { readonly owner: TerritoryChestOpenPage; readonly entries: readonly IRewardEntry[] }): void {
        void this.presentChestHeroes(event).catch(reportMainPageFailure);
    }

    private async presentChestHeroes(event: { readonly owner: TerritoryChestOpenPage; readonly entries: readonly IRewardEntry[] }): Promise<void> {
        if (!event.entries.some(entry => entry.quality === 5 && entry.number > 0)) return;
        const [rawRows, lineup] = await Promise.all([loadCardLevelUpRows(), cardRepository.loadLineup(false)]);
        const rows = rawRows.map(parseCardLevelUpRow).filter(row => row !== null);
        if (this.isDisposed || !event.owner.isValid) return;
        const heroes = chestOpenLegendHeroesOf(event.entries, rows);
        const table = buildCardLevelUpTable(rawRows);
        const counter = createItemCounter();
        for (const heroId of heroes) {
            if (this.isDisposed || !event.owner.isValid) return;
            const status = evaluateUpgrade(table, heroId, lineup.heroLevels.get(heroId) ?? 0, counter);
            const progress = status.requirements.find(item => item.key === 'card');
            let finish: () => void;
            const closed = new Promise<void>(resolve => { finish = resolve; });
            const unregister = this.scope.defer(finish);
            const popup = await HeroObtainPage.open({
                userData: {
                    heroId,
                    progressCurrent: progress?.owned,
                    progressMax: progress?.need,
                },
                onClose: finish,
            });
            if (this.isDisposed || !event.owner.isValid) {
                popup?.close();
                unregister();
                return;
            }
            if (!popup) {
                unregister();
                continue;
            }
            const releasePopup = this.scope.defer(() => { popup.close(); });
            await closed;
            releasePopup();
            unregister();
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
                openUpgrade: (unit, level) => {
                    void CardUpgradePage.open({ userData: { card: unit, cardId: unit.id, level } satisfies ICardUpgradeOpenData })
                        .catch(reportMainPageFailure);
                }
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
