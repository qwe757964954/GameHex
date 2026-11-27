import { GuideComposition } from '../guide/GuideComposition';
import type { Node } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import { EventMgr } from '../../../framework/event/EventMgr';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import type { IPopupOpenParams } from '../../../framework/ui/PopupDef';
import { CardLineupPage } from '../../card/CardLineupPage';
import { CardLineupController } from '../../card/CardLineupController';
import { CardLineupUiEvent, type CardLineupOutput } from '../../card/CardLineupEvents';
import { cardRepository } from '../../card/CardRepository';
import { CardUpgradePage } from '../../card/CardUpgradePage';
import type { ICardUpgradeOpenData } from '../../card/CardPresentations';
import { LineupBoardPage } from '../../card/LineupBoardPage';
import { RolePage } from '../../role/RolePage';
import { RoleController, type IRoleGemDialog } from '../../role/RoleController';
import { RoleEvent, type RoleOutput } from '../../role/RoleEvents';
import { CommonTips } from '../../common/CommonTips';
import { GAME_AUDIO } from '../../ResConst';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { RoleComposePopup } from '../../role/RoleComposePopup';
import { roleRepository } from '../../role/RoleRepository';
import type { IRoleSnapshot } from '../../role/RoleTypes';
import { MilitiaTalentPage } from '../../role/MilitiaTalentPage';
import { EquipEvolvePage } from '../../role/EquipEvolvePage';
import { RoleEquipInfoPopup } from '../../role/RoleEquipInfoPopup';
import { RoleGemInfoPopup } from '../../role/RoleGemInfoPopup';
import { RoleGongMingPopup } from '../../role/RoleGongMingPopup';
import { StorePage } from '../../store/StorePage';
import { StoreController } from '../../store/StoreController';
import { StoreEvent, type StoreOutput } from '../../store/StoreEvents';
import { storeAction } from '../../store/StoreActions';
import { LeagueTabPage } from '../../league/LeagueTabPage';
import { LeagueTabController } from '../../league/LeagueTabController';
import { LeagueJoinController } from '../../league/LeagueJoinController';
import { LeagueJoinEvent, type ILeagueJoinView, type LeagueJoinOutput } from '../../league/LeagueJoinEvents';
import { LeagueTabEvent, type LeagueTabOutput } from '../../league/LeagueTabEvents';
import { LeagueCreatePage } from '../../league/LeagueCreatePage';
import { LeagueInfoPage } from '../../league/LeagueInfoPage';
import { leagueRepository } from '../../league/LeagueRepository';
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
    private cardController: CardLineupController | null = null;
    private rolePage: RolePage | null = null;
    private storeController: StoreController | null = null;
    private leaguePage: LeagueTabPage | null = null;
    private leagueController: LeagueTabController | null = null;
    private leagueJoin: LeagueJoinController | null = null;
    private leagueJoinView: ILeagueJoinView | null = null;
    get territory(): MainTerritoryMap | null { return this.territoryView; }

    constructor(private readonly context: IControllerContext, private readonly root: Node, private readonly presented: () => void,
        private readonly requestOwner?: object) {
        super(context, 'main-page');
        this.listen(VIEW_LIFECYCLE, this.onLifecycle);
        this.listen(CardLineupUiEvent.Output, this.onCardOutput);
        this.listen(RoleEvent.Output, this.onRoleOutput);
        this.listen(StoreEvent.Output, this.onStoreOutput);
        this.listen(LeagueTabEvent.Output, this.onLeagueTabOutput);
        this.listen(LeagueJoinEvent.Output, this.onLeagueJoinOutput);
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
    private openPopup<T extends PopupBase>(
        cls: { open(params?: IPopupOpenParams): Promise<T | null> },
        params: IPopupOpenParams = {},
    ): void {
        void cls.open({ ...params, scope: this.scope }).catch(reportMainPageFailure);
    }
    private mountCard(card: CardLineupPage): void {
        const controller = this.createCardController(card);
        this.cardController = controller;
        this.registerPage(card, controller, { ready: () => controller.start() });
        card.initialize(this.resources);
    }
    private mountRole(role: RolePage): void {
        this.rolePage = role;
        const controller = this.createRoleController();
        this.registerPage(role, controller, {
            ready: () => controller.start(), enabled: () => { void controller.refresh(); }, disabled: () => controller.cancel(),
        });
    }
    private mountStore(store: StorePage): void {
        const controller = this.createStoreController(store);
        this.storeController = controller;
        this.registerPage(store, controller, { ready: () => controller.start() });
    }
    private mountLeague(league: LeagueTabPage): void {
        this.leaguePage = league;
        const controller = this.createLeagueController();
        this.leagueController = controller;
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
            autoLoadDecks: card.autoLoadDecks,
            fallbackLevel: card.fallbackLevel,
            repository: cardRepository,
        });
    }
    private createRoleController(): RoleController<IRoleSnapshot> {
        const dialog = this.createRoleGemDialog();
        return new RoleController(this.context, {
            growth: {
                equip: (id, partId) => roleRepository.equipmentGrowth(id, partId),
                washAttributes: (ids, values) => roleRepository.equipmentWashAttributes(ids, values),
                plans: () => roleRepository.equipPlans(),
                gem: id => roleRepository.gemGrowth(id),
                filters: () => roleRepository.gemFilters(),
                request: (proto, payload, caller, apply) => roleRepository.requestGrowth(proto, payload, caller, apply),
            },
            gems: {
                slots: () => roleRepository.equipParts(),
                find: id => roleRepository.findGem(id),
                // 镶嵌（含替换）成功 → 通用「升级成功」音（用户 2026-11-26）。
                // 接在这一层而不是控制器里：`AudioMgr` 链上带 `cc`，控制器一引就进不了 node 用例；
                // 卸下（`down`）不播 —— 需求只要「镶嵌成功」这一拍。页面自己那几处（宝石详情）另外播。
                change: async (change, caller) => {
                    const status = await roleRepository.changeGem(change, caller);
                    if (status === 'ok' && change.kind !== 'down') FW.playSound(GAME_AUDIO.upgradeSuccess);
                    return status;
                },
                preview: async caller => {
                    const { status, materials } = await roleRepository.previewGemCompose(caller);
                    return { status, materials: materials.map(item => ({ id: toIdString(item.id), count: item.num })) };
                },
                compose: caller => roleRepository.composeGems(caller),
                decompose: (ids, caller) => roleRepository.decomposeEquips(ids, caller),
                qualities: () => roleRepository.gemComposeQualities(),
                showRewards: rewards => FW.ShowReward(rewards),
                dialog: dialog.open,
                cancel: dialog.cancel,
            },
            repository: {
                load: () => roleRepository.load()
            },
            popups: {
                equipInfo: true,
                equipEvolve: true,
                gemInfo: true,
            },
        });
    }
    private createRoleGemDialog() {
        let activeScope: ResourceScope | null = null;
        const cancel = () => {
            const scope = activeScope;
            activeScope = null;
            scope?.dispose();
        };
        return {
            open: (data: IRoleGemDialog) => {
                cancel();
                if (this.isDisposed) return Promise.resolve(null);
                const dialogScope = new ResourceScope('role-gem-dialog');
                const detachHost = this.scope.defer(() => dialogScope.dispose());
                activeScope = dialogScope;
                return new Promise<'confirm' | 'alternate' | null>((resolve, reject) => {
                    let choice: 'confirm' | 'alternate' | null = null;
                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        detachHost();
                        if (activeScope === dialogScope) activeScope = null;
                        resolve(choice);
                    };
                    dialogScope.defer(() => {
                        choice = null;
                        finish();
                    });
                    const onSure = () => {
                        choice = 'confirm';
                    };
                    const onCancel = () => {
                        choice = data.cancelText ? 'alternate' : null;
                    };
                    const settleOpen = (opened: PopupBase | null) => {
                        if (!opened) finish();
                    };
                    const failed = (error: unknown) => {
                        if (settled) return;
                        settled = true;
                        detachHost();
                        if (activeScope === dialogScope) activeScope = null;
                        dialogScope.dispose();
                        reject(error);
                    };

                    // 一键合成：图标台账版弹窗（部位 × 品质），不走通用文本清单。
                    if (data.compose) {
                        void RoleComposePopup.open({
                            scope: dialogScope,
                            userData: {
                                view: data.compose,
                                title: data.title,
                                sureText: data.sureText,
                                confirmAgainText: data.confirmAgainText,
                                onConfirm: onSure,
                                onCancel,
                            },
                            onClose: finish,
                        }).then(settleOpen, failed);
                        return;
                    }

                    void CommonTips.open({
                        scope: dialogScope,
                        cache: false,
                        allowMultiple: true,
                        userData: {
                            ...data,
                            content: data.content ?? '',
                            showCancel: !!data.sureText,
                            onSure,
                            onCancel,
                        },
                        onClose: finish,
                    }).then(settleOpen, failed);
                });
            },
            cancel,
        };
    }

    private createStoreController(store: StorePage): StoreController {
        return new StoreController(this.context, {
            owner: store,
            action: storeAction,
            requestOwner: this.requestOwner,
            canSend: () => store.isValid,
        });
    }
    private createLeagueController(): LeagueTabController {
        return new LeagueTabController(this.context, {
            repository: {
                load: () => leagueRepository.load()
            },
        });
    }
    private createLeagueJoinController(): LeagueJoinController {
        return new LeagueJoinController(this.context, {
            repository: leagueRepository,
        });
    }
    private onCardOutput(output: CardLineupOutput): void {
        switch (output.kind) {
            case 'openEditor':
                this.openPopup(LineupBoardPage);
                return;
            case 'openUpgrade':
                this.openPopup(CardUpgradePage, {
                    userData: { card: output.card, cardId: output.card.id, level: output.level } satisfies ICardUpgradeOpenData,
                });
                return;
            case 'failed':
                reportMainPageFailure(output.error);
                return;
        }
    }
    private onRoleOutput(output: RoleOutput<IRoleSnapshot>): void {
        switch (output.kind) {
            case 'render':
                void this.rolePage?.renderSnapshot(output.snapshot).catch(reportMainPageFailure);
                return;
            case 'selectBag':
                this.rolePage?.selectBag(output.tab);
                return;
            case 'showBag':
                void this.rolePage?.showBag(output.tab, output.filter, output.filterName).catch(reportMainPageFailure);
                return;
            case 'openTalent':
                this.openPopup(MilitiaTalentPage);
                return;
            case 'openEquipInfo':
                this.openPopup(RoleEquipInfoPopup, {
                    userData: {
                        partId: output.partId || (output.bagUniqueId ? 0 : 1),
                        bagUniqueId: output.bagUniqueId,
                    },
                });
                return;
            case 'openEquipEvolve':
                this.openPopup(EquipEvolvePage, { userData: { partId: output.partId, tab: output.tab } });
                return;
            case 'decomposeDone':
                if (output.status === 'ok' && output.rewards.length) FW.ShowReward([...output.rewards]);
                void this.rolePage?.finishDecompose(output).catch(reportMainPageFailure);
                return;
            case 'openGemInfo':
                this.openPopup(RoleGemInfoPopup, { userData: { gemId: output.gemId } });
                return;
            case 'openGongMing':
                this.openPopup(RoleGongMingPopup);
                return;
            case 'tip':
                FW.showTip(output.text);
                return;
            case 'failed':
                reportMainPageFailure(output.error);
                return;
        }
    }
    private onStoreOutput(output: StoreOutput, source: object): void {
        if (source !== this.storeController) return;
        if (output.kind === 'failed') reportMainPageFailure(output.error);
    }
    private onLeagueTabOutput(output: LeagueTabOutput, source: object): void {
        if (source !== this.leagueController) return;
        if (output.kind === 'failed') {
            reportMainPageFailure(output.error);
            return;
        }
        this.disposeLeagueJoin();
        const view = this.leaguePage?.showPage(output.joined) ?? null;
        if (view) {
            this.leagueJoinView = view;
            const join = this.createLeagueJoinController();
            this.leagueJoin = join;
            join.start();
        }
    }
    private onLeagueJoinOutput(output: LeagueJoinOutput, source: object): void {
        if (source !== this.leagueJoin) return;
        switch (output.kind) {
            case 'render':
                this.leagueJoinView?.render(output.rows);
                return;
            case 'tip':
                FW.showTip(output.text);
                return;
            case 'joined':
                EventMgr.instance.emit(LeagueTabEvent.Joined);
                return;
            case 'openCreate':
                this.openPopup(LeagueCreatePage);
                return;
            case 'openUnion':
                this.openPopup(LeagueInfoPage, { userData: { union: output.union } });
                return;
        }
    }
    private disposeLeagueJoin(): void {
        const join = this.leagueJoin;
        this.leagueJoin = null;
        this.leagueJoinView = null;
        join?.dispose();
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
        this.releaseInputs();
        this.disposeLeagueJoin();
        this.cardController = null;
        this.rolePage = null;
        this.storeController = null;
        this.leaguePage = null;
        this.leagueController = null;
        this.pages.clear();
        this.territoryView = null;
        super.dispose();
    }
}
function reportMainPageFailure(error: unknown): void { console.warn('[MainPageComposition]', error); }
