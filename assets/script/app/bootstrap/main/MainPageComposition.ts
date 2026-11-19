import { CHEST_EVENTS } from '../../main/ChestEvents';
import { TerritoryUiEvent } from '../../territory/application/TerritoryEvents';
import { TerritoryChestOpenPage } from '../../territory/view/TerritoryChestOpenPage';
import { chestLegendHeroesOf } from '../../territory/model/TerritoryChestOpenLayout';
import { HeroObtainPage } from '../../card/view/HeroObtainPage';
import { loadCardLevelUpRows, loadPvpCardRarities } from '../../card/CardLineupDecks';
import { createItemCounter } from '../../card/ItemBag';
import { buildCardLevelUpTable, evaluateUpgrade, parseCardLevelUpRow } from '../../card/CardUpgradeCost';
import type { IShowRewardEntry as IRewardEntry } from '../../common/RewardEntries';
import { GuideComposition } from '../guide/GuideComposition';
import type { Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
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
import { LeagueJoinController } from '../../league/LeagueJoinController';
import { LeagueTabEvent } from '../../league/LeagueTabEvents';
import { LeagueCreatePage } from '../../league/LeagueCreatePage';
import { LeagueInfoPage } from '../../league/LeagueInfoPage';
import { leagueRepository } from '../../league/LeagueRepository';
import { GameNet } from '../../net/GameNet';
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

    constructor(private readonly context: IControllerContext, private readonly root: Node, private readonly presented: () => void,
        private readonly requestOwner?: object) {
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
        territory.initialize(entry.resources, entry.saveOwner);
        this.listen(TerritoryUiEvent.ChestRevealed, this.onChestRevealed);
        this.listen(TerritoryUiEvent.ChestRewardsReady, this.onChestRewardsReady);
        // 2026-11-10 需求 ③：英雄碎片进度徽标的数据源由组合层注入（页面只认接口，
        // 不反向 import `app/card`）。纯表现，没注入 ⇒ 不播徽标，发奖链路零变化。
        territory.setHeroProgressSource(new TerritoryHeroProgressSource());
        if (main) {
            // 宝箱栏的「战斗」格使用本页地图演整页过场。
            main.territoryMap = territory;
            main.hasTerritoryMap = true;
        }
    }
    /**
     * 宝箱奖励应落到哪一层：本页活跃时由本组合消费；其余情况交给主 tab 兜底，
     * 保证切页/重开后迟到回包的奖励仍然可见。
     */
    treasureRewardRoute(owner: { readonly node: Node }): 'active' | 'fallback' {
        return !this.isDisposed && owner.node === this.root ? 'active' : 'fallback';
    }
    private onTreasureRewards(event: { readonly owner: MainPage; readonly goods: readonly unknown[] }): void {
        if (event.owner.node !== this.root || !event.goods.length) return;
        void TerritoryChestOpenPage.open({ userData: { goods: event.goods } }).then(popup => {
            if (this.isDisposed) popup?.close();
        }).catch(reportMainPageFailure);
    }

    private onChestRevealed(event: { readonly owner: { readonly isValid: boolean }; readonly entries: readonly IRewardEntry[] }): void {
        // 宝箱开启页（宝箱栏 / 巡逻等入口）那条：页内已经把奖励画出来了，这里只补英雄页。
        void this.presentChestHeroes(event.entries, event.owner).catch(reportMainPageFailure);
    }

    private onChestRewardsReady(event: { readonly owner: MainTerritoryMap; readonly rewards: readonly IRewardEntry[] }): void {
        // 领地宝箱：地图上的开箱粒子动画演完了（奖励还没给玩家看）⇒ 英雄页 → 统一奖励弹窗。
        if (event.owner !== this.territoryView) return;
        void this.runChestRewardChain(event.owner, event.rewards).catch(reportMainPageFailure);
    }

    /**
     * 领地宝箱的奖励链（2026-11-17 需求 ② / ③）：
     * 橙色卡牌碎片 ⇒ 按**卡牌 id 升序**逐个弹「获得英雄」→ 全关掉后弹**统一获得奖励弹窗**。
     *
     * 顺序是需求的一部分：先看英雄、再统一看整箱奖励；两者都在开箱粒子动画之后。
     *
     * ⚠️ 整段（含地图上的粒子动画）算一个「演出窗口」：进场时
     *    {@link TerritoryUiEvent.ChestPresentation} 已由地图页置 true，这里负责收尾。
     *    不关的话引导层会一直让位 —— 玩家的下一段台词就永远不播了。
     *
     * 🔴 **收尾不能一律在这里关**：`ShowRewardPage` 要等 prefab 加载完才 `enabled`，
     *    中间隔着几帧。这里抢先关掉，2-3 的对话框会先闪出来、再被奖励窗盖掉。
     *    ⇒ 「后面还有统一奖励弹窗」时把收尾交给引导层（它监听 `VIEW_LIFECYCLE`，
     *    等奖励窗 `enabled` 时清窗口，`disabled` 时才真正恢复）；没有弹窗可等才在这里直接关。
     */
    private async runChestRewardChain(owner: MainTerritoryMap, rewards: readonly IRewardEntry[]): Promise<void> {
        let popupPlanned = false;
        try {
            await this.presentChestHeroes(rewards, owner);
            if (this.isDisposed || !owner.isValid || !rewards.length) return;
            popupPlanned = true;
            FW.ShowReward(rewards.map((reward) => ({
                resId: reward.resId,
                number: reward.number,
            })) as unknown as CmdGoods[]);
        } finally {
            if (!popupPlanned) {
                EventMgr.instance.emit(TerritoryUiEvent.ChestPresentation, { owner, playing: false });
            }
        }
    }

    /**
     * 橙卡（`pvpCard.rarity === 4`）碎片逐个展示英雄页。
     *
     * 🔴 判据是**卡牌品级**不是碎片道具品质：碎片 `18003` 在 item 表里是 quality 2，
     * 老实现（`entry.quality === 5`）在任何真实数据上都筛不出英雄，等于这条链从来没跑过。
     */
    private async presentChestHeroes(
        entries: readonly { readonly resId: number; readonly number: number }[],
        owner: { readonly isValid: boolean },
    ): Promise<void> {
        if (!entries.some(entry => entry.number > 0)) return;
        const [rawRows, lineup, rarities] = await Promise.all([
            loadCardLevelUpRows(),
            cardRepository.loadLineup(false),
            loadPvpCardRarities(),
        ]);
        if (this.isDisposed || !owner.isValid) return;
        const rows = rawRows.map(parseCardLevelUpRow).filter(row => row !== null);
        const heroes = chestLegendHeroesOf(entries, rows, (cardId) => rarities.get(cardId) ?? 0);
        const table = buildCardLevelUpTable(rawRows);
        const counter = createItemCounter();
        for (const heroId of heroes) {
            if (this.isDisposed || !owner.isValid) return;
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
            if (this.isDisposed || !owner.isValid) {
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
        return new StoreController(
            this.context,
            store,
            storeAction,
            reportMainPageFailure,
            this.requestOwner,
            () => store.isValid,
        );
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
            join: {
                create: view => new LeagueJoinController(this.context, {
                    owner: view,
                    joinedOwner: league,
                    repository: leagueRepository,
                    view: { render: rows => view.render(rows) },
                    feedback: {
                        tip: text => FW.showTip(text),
                        notifyJoined: owner => EventMgr.instance.emit(LeagueTabEvent.Joined, { owner }),
                    },
                    popups: {
                        openCreate: owner => { void LeagueCreatePage.open({ userData: { owner } }); },
                        openUnion: union => { void LeagueInfoPage.open({ userData: { union } }); },
                    },
                    requests: { removeCaller: caller => GameNet.instance.removeCaller(caller) },
                }),
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
        // 输入解除由 super.dispose() 统一完成（先 offTarget 再释放资源），这里只丢生命周期表。
        this.pages.clear();
        this.territoryView = null;
        super.dispose();
    }
}
function reportMainPageFailure(error: unknown): void { console.warn('[MainPageComposition]', error); }
