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
import { RoleController, type IRoleGemDialog } from '../../role/RoleController';
import { CommonTips } from '../../common/CommonTips';
import { roleRepository } from '../../role/RoleRepository';
import type { IRoleSnapshot } from '../../role/RoleTypes';
import { MilitiaTalentPage } from '../../role/MilitiaTalentPage';
import { EquipEvolvePage } from '../../role/EquipEvolvePage';
import { RoleEquipInfoPopup } from '../../role/RoleEquipInfoPopup';
import { RoleGemInfoPopup } from '../../role/RoleGemInfoPopup';
import { RoleGongMingPopup } from '../../role/RoleGongMingPopup';
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
import { CacheMgr } from '../../net/CacheMgr';
import { toCount, toIdString } from '../../net/RequestGuard';
import { readRoleRow } from '../../main/MainRoleRow';
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
        const guide = this.createGuideComposition();
        this.own(() => guide.dispose());
    }
    private createGuideComposition(): GuideComposition {
        return new GuideComposition(this.context, this.root, 'main', this.territoryView);
    }

    private registerPage(owner: object, controller: Pick<ControllerBase, 'dispose'>, lifecycle: IPageLifecycle): void {
        this.own(() => controller.dispose());
        this.pages.set(owner, lifecycle);
    }
    private openScopedPopup<T extends { close(): void }>(opening: Promise<T | null>): void {
        void opening.then(popup => {
            if (this.isDisposed) popup?.close();
        }).catch(reportMainPageFailure);
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
        this.own(() => GameNet.instance.removeCaller(role));
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
        // 未通关 PVP 气泡复用左上角玩家卡的头像 / 等级：组合层是读 `CmdRole` 的边界，
        // 页面只收纯数据。角色缓存一变就让它重取头像并补画一帧。
        territory.setPlayerProfileSource(() => {
            const role = readRoleRow();
            return { avatarId: toIdString(role?.img), level: toCount(role?.lv) };
        });
        CacheMgr.instance.setEventUpdate('CmdRole', this, this.onTerritoryPlayerProfileChange);
        this.own(() => CacheMgr.instance.removeEventUpdate('CmdRole', this, this.onTerritoryPlayerProfileChange));
        // 2026-11-10 需求 ③：英雄碎片进度徽标的数据源由组合层注入（页面只认接口，
        // 不反向 import `app/card`）。纯表现，没注入 ⇒ 不播徽标，发奖链路零变化。
        territory.setHeroProgressSource(new TerritoryHeroProgressSource());
        if (main) {
            // 宝箱栏的「战斗」格使用本页地图演整页过场。
            main.territoryMap = territory;
            main.hasTerritoryMap = true;
        }
    }

    private onTerritoryPlayerProfileChange(): void {
        this.territoryView?.refreshPlayerBubble();
    }

    private createCardController(card: CardLineupPage): CardLineupController {
        return new CardLineupController(this.context, {
            owner: card,
            autoLoadDecks: card.autoLoadDecks,
            fallbackLevel: card.fallbackLevel,
            repository: cardRepository,
            failed: reportMainPageFailure,
            popups: {
                openEditor: () => { this.openScopedPopup(LineupBoardPage.open()); },
                openUpgrade: (unit, level) => {
                    this.openScopedPopup(CardUpgradePage.open({ userData: { card: unit, cardId: unit.id, level } satisfies ICardUpgradeOpenData }));
                },
            },
        });
    }
    private createRoleController(role: RolePage): RoleController<IRoleSnapshot> {
        const dialog = this.createRoleGemDialog();
        return new RoleController(this.context, {
            owner: role,
            growth: {
                equip: (id, partId) => roleRepository.equipmentGrowth(id, partId),
                washAttributes: (ids, values) => roleRepository.equipmentWashAttributes(ids, values),
                plans: () => roleRepository.equipPlans(),
                gem: id => roleRepository.gemGrowth(id),
                filters: () => roleRepository.gemFilters(),
                request: (proto, payload, apply) => roleRepository.requestGrowth(proto, payload, role, apply),
            },
            gems: {
                slots: () => roleRepository.equipParts(),
                find: id => roleRepository.findGem(id),
                change: change => roleRepository.changeGem(change, role),
                preview: async () => {
                    const { status, materials } = await roleRepository.previewGemCompose(role);
                    return { status, materials: materials.map(item => ({ id: toIdString(item.id), count: item.num })) };
                },
                compose: () => roleRepository.composeGems(role),
                showRewards: rewards => FW.ShowReward(rewards),
                dialog: dialog.open,
                cancel: () => {
                    dialog.cancel();
                    GameNet.instance.removeCaller(role);
                },
            },
            failed: reportMainPageFailure,
            repository: {
                load: () => roleRepository.load()
            },
            view: {
                render: snapshot => role.renderSnapshot(snapshot),
                selectBag: tab => role.selectBag(tab),
                showBag: (tab, filter, filterName) => role.showBag(tab, filter, filterName)
            },
            popups: {
                openTalent: () => { this.openScopedPopup(MilitiaTalentPage.open()); },
                openEquipInfo: (partId, bagUniqueId) => {
                    this.openScopedPopup(RoleEquipInfoPopup.open({
                        userData: {
                            partId: partId || (bagUniqueId ? 0 : 1),
                            bagUniqueId,
                        },
                    }));
                },
                openEquipEvolve: (partId, tab) => {
                    this.openScopedPopup(EquipEvolvePage.open({ userData: { partId, tab } }));
                },
                openGemInfo: gemId => {
                    this.openScopedPopup(RoleGemInfoPopup.open({ userData: { gemId } }));
                },
                openGongMing: () => {
                    this.openScopedPopup(RoleGongMingPopup.open());
                },
            },
            feedback: {
                tip: text => FW.showTip(text)
            },
        });
    }
    private createRoleGemDialog() {
        let cancel: (() => void) | null = null;
        return {
            open: (data: IRoleGemDialog) => new Promise<'confirm' | 'alternate' | null>((resolve, reject) => {
                let popup: CommonTips | null = null;
                let choice: 'confirm' | 'alternate' | null = null;
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    if (cancel === dismiss) cancel = null;
                    resolve(choice);
                };
                const dismiss = () => {
                    choice = null;
                    finish();
                    if (popup?.isPopupOpen) popup.close();
                };
                cancel = dismiss;
                void CommonTips.open({
                    cache: false,
                    allowMultiple: true,
                    userData: {
                        ...data,
                        showCancel: !!data.sureText,
                        onSure: () => {
                            choice = 'confirm';
                        },
                        onCancel: () => {
                            choice = data.cancelText ? 'alternate' : null;
                        },
                    },
                    onClose: finish,
                }).then(opened => {
                    popup = opened;
                    if (settled && popup?.isPopupOpen) popup.close();
                    if (!popup) finish();
                }, error => {
                    if (settled) return;
                    settled = true;
                    if (cancel === dismiss) cancel = null;
                    reject(error);
                });
            }),
            cancel: () => {
                cancel?.();
            },
        };
    }

    private createStoreController(store: StorePage): StoreController {
        const controller = new StoreController(
            this.context,
            store,
            storeAction,
            reportMainPageFailure,
            this.requestOwner,
            () => store.isValid,
        );
        if (!this.requestOwner) {
            this.own(() => GameNet.instance.removeCaller(controller));
        }
        return controller;
    }
    private createLeagueController(league: LeagueTabPage): LeagueTabController {
        return new LeagueTabController(this.context, {
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
                    repository: leagueRepository,
                    view: { render: rows => view.render(rows) },
                    feedback: {
                        tip: text => FW.showTip(text),
                        notifyJoined: () => EventMgr.instance.emit(LeagueTabEvent.Joined),
                    },
                    popups: {
                        openCreate: () => { this.openScopedPopup(LeagueCreatePage.open()); },
                        openUnion: union => { this.openScopedPopup(LeagueInfoPage.open({ userData: { union } })); },
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
    private onLifecycle(event: IViewLifecycle, source: object): void {
        const page = this.pages.get(source);
        if (!page) return;
        if (event.phase === 'presented') { this.presented(); return; }
        if (event.phase === 'destroyed') { this.dispose(); return; }
        if (event.phase === 'ready') page.ready();
        else if (event.phase === 'enabled') page.enabled?.();
        else if (event.phase === 'disabled') page.disabled?.();
    }
    dispose(): void {
        if (this.isDisposed) return;
        // 输入解除由 super.dispose() 统一完成（先 offTarget 再释放资源），这里只丢生命周期表。
        this.pages.clear();
        this.territoryView = null;
        super.dispose();
    }
}
function reportMainPageFailure(error: unknown): void { console.warn('[MainPageComposition]', error); }
