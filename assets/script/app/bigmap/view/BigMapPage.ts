import { _decorator, Component, instantiate, Prefab, SpriteFrame, UITransform, view } from 'cc';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { loadBigMapArt, type IBigMapArt } from '../application/BigMapArtLoader';
import type { BigMapMode, IBigMapCityView, IBigMapViewState } from '../application/BigMapViewState';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapCityOpening, formatBigMapMonsterDetail, formatBigMapPlotDetail } from './BigMapPresentationText';
import { BigMapWorldView } from './BigMapWorldView';
import { HeadArt } from '../../HeadArt';
import { spriteFramePath } from '../../ArtPaths';
import { BIGMAP_CAMP_ROLE_TEXT, formatBigMapCampRoleDetail } from '../model/BigMapCampRoleInfo';
import { BIGMAP_CAMP_MOVE_TEXT } from '../model/BigMapCampMove';

import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { ShowRewardPage } from '../../showReward/ShowRewardPage';
import { Toast } from '../../common/Toast';
import { BigMapCityPopup, type IBigMapCityPopupContent } from './BigMapCityPopup';
import { BigMapInfoPopup, type IBigMapInfoPopupContent } from './BigMapInfoPopup';
import type { IBigMapPlotCardContent } from './BigMapPlotCard';
import { BigMapPageLayout } from './BigMapPageLayout';
import { BIGMAP_TOP_HUD_HEIGHT } from './BigMapTopHudTypes';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, BigMapViewEvent, type BigMapIntent, type IBigMapRenderEvent, type IBigMapViewCommandEvent } from '../application/BigMapEvents';

const { ccclass } = _decorator;

const FOOTER_HEIGHT = 88;

const BIGMAP_PAGE_PREFAB_PATH = 'ui/bigmap/BigMapPage';
const BIGMAP_WORLD_PREFAB_PATH = 'ui/bigmap/BigMapWorldView';

/**
 *大世界页面：地图铺满浏览区，目标详情点选时浮出；建造菜单仅基地模式显示。
 *
 *负责页面装配、世界地图与详情弹窗流程；预制体内部渲染和输入交给 BigMapPageLayout。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private data: IBigMapViewState | null = null;
    private ready = false;
    private mode: BigMapMode = 'world';
    private navigationHeight = FOOTER_HEIGHT;
    private controllerResources: IControllerResources = null;
    //资源域由 Controller 释放，可能早于 Cocos 帧末销毁；两者都约束 await 后的结果。
    private get artScope(): ResourceScope { return this.controllerResources.scope; }

    private layout: BigMapPageLayout = null;
    private worldView: BigMapWorldView = null;
    /**
     *城池弹窗（`PopupBase` 子类，走 PopupManager 栈）。命中时懒打开，之后复用同一实例；
     *野怪 / 地块详情走 BigMapInfoPopup。
     */
    private cityPopupOpened = false;
    private infoPopupOpening = false;
    private infoPopupRevision = 0;
    private infoPopupContent: IBigMapInfoPopupContent | null = null;
    /** 上一次自动聚焦过的城池 —— 只在选中变化时聚焦一次，避免每帧把视角拽回去。 */
    private focusedCityId = 0;

    private art: IBigMapArt | null = null;
    private enteringBattle = false;

    private selectedCityId = 0;
    private selectedMonsterId = 0;
    private selectedPlotHexId = -1;
    /** 搬移态：非 0 时点空地 = 把这栋建筑搬过去（协议 `CmdSlgBuildMoveReqMsg`）。 */
    private pendingMoveInstanceId = 0;
    private baseActionPending = false;
    private playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null;
    private playerPortrait: SpriteFrame | null = null;
    private readonly rolePortraits = new Map<string, SpriteFrame | null>();

    /** 由入口交付初始快照，之后只响应展示事件。 */
    async initialize(data: IBigMapViewState, resources: IControllerResources, background = '', navigationHeight = FOOTER_HEIGHT,
        playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null): Promise<void> {
        this.controllerResources = resources;
        this.data = data;
        EventMgr.instance.on(BigMapViewEvent.Render, this.onRender, this);
        EventMgr.instance.on(BigMapViewEvent.Command, this.onCommand, this);
        this.navigationHeight = navigationHeight;
        this.playerPortraitLoader = playerPortraitLoader;
        await Promise.all([
            this.loadPageLayout(),
            this.loadWorldView(),
            this.loadArt(background, data),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.buildUi(this.data);
        this.applyArt();
        this.ready = true;
        this.render(this.data);
        EventMgr.instance.emit(BigMapUiEvent.Ready);
    }

    private async loadPageLayout(): Promise<void> {
        let prefab: Prefab;
        try {
            prefab = await this.controllerResources.assets.load(BIGMAP_PAGE_PREFAB_PATH, Prefab, { scope: this.artScope });
        } catch (error) {
            if (!this.isValid || this.artScope.disposed) return;
            throw error;
        }
        if (!this.isValid || this.artScope.disposed) return;
        const node = instantiate(prefab);
        const layout = node.getComponent(BigMapPageLayout);
        if (!layout) {
            node.destroy();
            throw new Error('[BigMapPage] 页面预制体缺少 BigMapPageLayout');
        }
        node.setParent(this.node);
        this.layout = layout;
    }

    private async loadWorldView(): Promise<void> {
        let prefab: Prefab;
        try {
            prefab = await this.controllerResources.assets.load(BIGMAP_WORLD_PREFAB_PATH, Prefab, { scope: this.artScope });
        } catch (error) {
            if (!this.isValid || this.artScope.disposed) return;
            throw error;
        }
        if (!this.isValid || this.artScope.disposed) return;
        const node = instantiate(prefab);
        node.setParent(this.node);
        const worldView = node.getComponent(BigMapWorldView);
        if (!worldView) {
            node.destroy();
            throw new Error('[BigMapPage] 地图预制体缺少 BigMapWorldView');
        }
        this.worldView = worldView;
    }

    private async loadArt(background: string, data: IBigMapViewState): Promise<void> {
        const [art, portrait] = await Promise.all([
            loadBigMapArt(this.controllerResources.assets, this.artScope, background, data.resourceIcons,
                data.buildingConfigs, data.campConfigs),
            this.playerPortraitLoader ? this.playerPortraitLoader(this.artScope).catch((error: unknown) => {
                console.warn('[BigMapPage] 玩家头像加载失败', error);
                return null;
            }) : Promise.resolve(null),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.art = art;
        this.playerPortrait = portrait;
    }

    private applyArt(): void {
        const art = this.art;
        if (!art) return;
        this.worldView.setArt(art);
        this.worldView.setPlayerPortrait(this.playerPortrait);
        // 同一帧头像交付给顶部玩家卡：世界与基地两边看到的是同一个人。
        this.layout.setArt(art);
        this.layout.setPlayerPortrait(this.playerPortrait);
    }

    //-------------------------------------------------------------- 构建

    private get size(): { width: number; height: number } {
        const size = view.getVisibleSize();
        const transform = this.node.getComponent(UITransform);
        return {
            width: (transform && transform.width) || size.width,
            height: (transform && transform.height) || size.height,
        };
    }

    private buildUi(data: IBigMapViewState): void {
        const { width, height } = this.size;
        const ui = this.layout;
        ui.initialize(data, this.navigationHeight);
        ui.mountWorld(this.worldView.node);
        this.worldView.node.setPosition(0, 0, 0);
        //先交付已加载的贴图，避免 build 把整张世界逐格画成 Graphics 后又立即清空重画。
        if (this.art) this.worldView.setArt(this.art);
        const insets = { top: BIGMAP_TOP_HUD_HEIGHT, bottom: this.navigationHeight };
        this.worldView.build(data, width, height, insets);
        ui.buildBase(data, width, height, (insets.bottom - insets.top) / 2);
        this.mode = 'world';
        this.applyMode();
    }

    //-------------------------------------------------------------- 模式切换

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
    }

    //-------------------------------------------------------------- 交互

    private sendIntent(intent: BigMapIntent): void {
        if (this.ready && !this.enteringBattle) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }

    private onRender(event: IBigMapRenderEvent): void {
        this.data = event.state;
        if (this.ready) this.render(event.state);
    }
    private onCommand(event: IBigMapViewCommandEvent): void {
        if (!this.ready) return;
        const command = event.command;
        if (command.kind === 'rewards') {
            void ShowRewardPage.open({ userData: { goods: command.rewards.map(reward => ({ resId: reward.resId, number: reward.amount })) } });
        } else if (command.kind === 'feedback') this.feedback(command);
        else if (command.kind === 'focusWorld') this.worldView.focusOn(command.hexId);
        else this.layout.focusBase(command.hexId);
    }
    private render(data: IBigMapViewState): void {
        this.data = data;
        const ui = data.ui;
        this.mode = ui.mode;
        this.selectedCityId = ui.selectedCityId;
        this.selectedMonsterId = ui.selectedMonsterId;
        this.selectedPlotHexId = ui.selectedPlotHexId;
        this.pendingMoveInstanceId = ui.pendingMoveInstanceId;
        this.baseActionPending = ui.baseActionPending;
        this.enteringBattle = ui.enteringBattle;
        this.applyMode();
        this.refreshAll(data);
    }

    //-------------------------------------------------------------- 刷新

    private refreshAll(data: IBigMapViewState): void {
        this.loadRolePortraits(data);
        this.layout.render(data);
        this.refreshInfo(data);
        this.worldView.render(data);
    }

    private refreshInfo(data: IBigMapViewState): void {
        if (this.enteringBattle) {
            this.closeInfoPopup();
            this.closeCityPopup();
            //开战遮罩盖上来时，贴底卡也得收 —— 否则它压在遮罩下面露出半个角。
            this.layout.renderPlotCard(null);
            return;
        }
        this.refreshInfoContent(data);
    }

    /**
     *显示 / 复用城池弹窗。
     *
     *弹窗是 `PopupBase` 子类、由 `PopupManager` 管生命周期，所以这里只做两件事：
     *已经有实例就直接复渲染（不重复压栈），没有才 `open`。
     *首次 `open` 要读预制体、有一帧延迟 —— 可接受，且打开后一直复用。
     */
    private showCityPopup(city: IBigMapCityView): void {
        const content = this.buildCityPopupContent(city);
        const opened = PopupManager.inst.get(BigMapCityPopup);
        if (opened) {
            opened.render(content);
            this.cityPopupOpened = true;
            return;
        }
        //`open` 是异步的（要读预制体），期间 `get` 仍返回 null ⇒ 不挡住的话每次 refresh 都会再压一层。
        if (this.cityPopupOpened) return;
        this.cityPopupOpened = true;
        void BigMapCityPopup.open({ userData: content }).then((popup) => {
            const data = this.data;
            if (!this.isValid || !data || data.ui.campRolesVisible || data.ui.selectedCityId === 0 || data.ui.mode !== 'world') {
                if (popup) popup.close(PopupCloseReason.Force);
                return;
            }
            const current = data.cities.get(data.ui.selectedCityId);
            if (current && popup) popup.render(this.buildCityPopupContent(current));
        }).catch((error: unknown) => {
            this.cityPopupOpened = false;
            console.warn('[BigMapPage] 城池弹窗打开失败', error);
        });
    }

    /** 关掉城池弹窗（没开着时是空操作）。`Force` = 由页面侧主动收，不算用户点空白。 */
    private closeCityPopup(): void {
        if (!this.cityPopupOpened) return;
        this.cityPopupOpened = false;
        PopupManager.inst.closeByClass(BigMapCityPopup, PopupCloseReason.Force);
    }

    /**
     *城池 → 弹窗展示数据。
     *
     *排行榜来自当前城池快照；`bigMapCamp` 表的属性效果没有逐条 buff 文案，
     *先填 `campDesc` 一条（第二条自动隐藏）。
     */
    private buildCityPopupContent(city: IBigMapCityView): IBigMapCityPopupContent {
        const desc = city.campConfig?.desc ?? city.desc;
        const lordId = city.campInfo?.occupyRoleId;
        const lordRank = lordId ? city.rankEntries.find((row) => row.roleId === lordId) : undefined;
        const lordRole = lordId ? city.campRoles.find((role) => role.roleId === lordId) : undefined;
        return {
            hasPlayerActions: city.isServerCamp,
            title: city.name,
            openingText: city.state === 'unavailable' || city.state === 'locked'
                ? formatBigMapCityOpening(city.campConfig?.openDay ?? 0) : '',
            buffs: desc ? [{ title: BIGMAP_PRESENTATION_TEXT.buffTitle, desc }] : [],
            ranks: city.rankEntries.filter((row) => !lordId || row.roleId !== lordId).map((row) => ({ rank: row.rank, name: row.name ?? '',
                score: String(row.warScore), avatar: null, avatarId: row.avatarId ?? '' })),
            warScore: city.warScore,
            minOccupyScore: city.minWarScore,
            lordName: city.campInfo?.occupyRoleName ?? '',
            lordScore: lordRank ? String(lordRank.warScore) : '',
            lordAvatarId: lordRole?.avatarId || lordRank?.avatarId || '',
            staminaCost: city.staminaCost,
            fightCaption: city.canAttack ? BIGMAP_PRESENTATION_TEXT.attack : BIGMAP_PRESENTATION_TEXT.cannotAttack,
            fightEnabled: city.canAttack,
        };
    }

    private refreshInfoContent(data: IBigMapViewState): void {
        //基地建筑一律走贴底卡（非模态，地图不下线）；野怪 / 迁城确认仍走居中 InfoPopup。
        //每帧只写一遍：`buildPlotCardContent` 返回 null 就是收起。
        this.layout.renderPlotCard(this.buildPlotCardContent(data));
        const city = this.mode === 'world' && this.selectedCityId !== 0 ? data.cities.get(this.selectedCityId) : null;
        if (city && data.ui.campRolesVisible) {
            this.closeCityPopup();
            const roles = city.campRoles;
            const index = roles.length > 0 ? data.ui.campRoleIndex % roles.length : 0;
            const role = roles[index];
            const empty = city.campRolesStatus === 'failed' ? BIGMAP_CAMP_ROLE_TEXT.failed
                : city.campRolesStatus === 'ready' ? BIGMAP_CAMP_ROLE_TEXT.empty : BIGMAP_CAMP_ROLE_TEXT.pending;
            this.showInfoPopup({
                title: `${city.name} · 驻守玩家${role ? `（${index + 1}/${roles.length}）` : ''}`,
                body: role ? formatBigMapCampRoleDetail(role) : empty,
                icon: role ? this.rolePortraits.get(role.avatarId) ?? null : null,
                primary: { text: BIGMAP_CAMP_MOVE_TEXT.moveHere, enabled: !this.baseActionPending },
                secondary: { text: BIGMAP_CAMP_ROLE_TEXT.next, enabled: roles.length > 1 && !this.baseActionPending },
            });
            return;
        }
        if (city) {
            this.closeInfoPopup();
            this.showCityPopup(city);
            if (this.focusedCityId !== city.cityId) {
                this.focusedCityId = city.cityId;
                this.sendIntent({ kind: 'secondary' });
            }
            return;
        }
        this.focusedCityId = 0;
        this.closeCityPopup();
        const content = this.buildInfoPopupContent(data);
        if (content) this.showInfoPopup(content);
        else this.closeInfoPopup();
    }

    /**
     *建筑卡内容。
     *
     *与原先 `BigMapInfoPopup` 的 base 分支是同一套语义（主按钮 = 升级 / 取消建造，
     *次按钮 = 收取 / 移动），只是不再塞进模态弹窗，并且正文换成带产量对比的版本。
     */
    private buildPlotCardContent(data: IBigMapViewState): IBigMapPlotCardContent | null {
        //用页面自己的 `mode`（`render` 里从 `ui.mode` 同步过来），与 `buildInfoPopupContent` 同口径。
        if (this.mode !== 'base' || this.selectedPlotHexId < 0) return null;
        const detail = data.plotDetails.get(this.selectedPlotHexId);
        if (!detail) return null;
        const busy = detail.queueSlotIndex >= 0;
        const moving = this.pendingMoveInstanceId === detail.instanceId;
        const canHarvest = detail.stored > 0 || data.collectableBuildings.has(detail.buildingId);
        return {
            name: detail.name,
            level: detail.level,
            targetLevel: detail.targetLevel,
            body: formatBigMapPlotDetail(detail) + (moving ? `\n${BIGMAP_PRESENTATION_TEXT.moveHint}` : ''),
            icon: this.art?.buildings.get(detail.buildingId) ?? null,
            busy,
            remainSeconds: detail.remainSeconds,
            primary: {
                text: busy ? BIGMAP_PRESENTATION_TEXT.cancelBuild : BIGMAP_PRESENTATION_TEXT.upgrade,
                enabled: !data.ui.baseActionPending && (busy || detail.canUpgrade),
            },
            secondary: canHarvest || !busy ? {
                text: canHarvest ? data.isServerBase ? BIGMAP_PRESENTATION_TEXT.harvest
                    : `${BIGMAP_PRESENTATION_TEXT.harvest} ${detail.stored}`
                    : moving ? BIGMAP_PRESENTATION_TEXT.moveCancel : BIGMAP_PRESENTATION_TEXT.move,
                enabled: !data.ui.baseActionPending,
            } : null,
        };
    }

    private buildInfoPopupContent(data: IBigMapViewState): IBigMapInfoPopupContent | null {
        if (data.ui.pendingCampMoveId > 0 && data.ui.selectedBaseHexId >= 0) {
            const city = data.cities.get(data.ui.pendingCampMoveId);
            return {
                title: BIGMAP_CAMP_MOVE_TEXT.confirm, body: `目标据点：${city?.name ?? data.ui.pendingCampMoveId}\n目标格：${data.ui.selectedBaseHexId}`,
                icon: null, primary: { text: BIGMAP_CAMP_MOVE_TEXT.confirm, enabled: !this.baseActionPending },
                secondary: { text: BIGMAP_CAMP_MOVE_TEXT.cancel, enabled: !this.baseActionPending },
            };
        }
        if (this.mode === 'base') return null;
        const monster = this.selectedMonsterId !== 0 ? data.monsters.get(this.selectedMonsterId) : null;
        if (!monster) return null;
        return {
            title: `${monster.name}（${monster.level} 级）`, body: formatBigMapMonsterDetail(monster),
            icon: this.art?.monster ?? null,
            primary: { text: monster.canAttack ? '攻打' : monster.respawnInSeconds > 0 ? '等待刷新' : '暂不可挑战',
                enabled: monster.canAttack }, secondary: { text: '定位', enabled: true },
        };
    }

    private async showInfoPopup(content: IBigMapInfoPopupContent): Promise<void> {
        this.infoPopupContent = content;
        const opened = PopupManager.inst.get(BigMapInfoPopup);
        if (opened) { opened.render(content); return; }
        if (this.infoPopupOpening) return;
        const revision = ++this.infoPopupRevision;
        this.infoPopupOpening = true;
        try {
            const popup = await BigMapInfoPopup.open({ userData: content });
            if (!this.isValid || revision !== this.infoPopupRevision || !this.infoPopupContent) return;
            if (popup) popup.render(this.infoPopupContent);
        } catch (error) {
            console.warn('[BigMapPage] 详情弹窗打开失败', error);
        } finally {
            if (revision === this.infoPopupRevision) this.infoPopupOpening = false;
        }
    }

    private closeInfoPopup(): void {
        this.infoPopupContent = null;
        this.infoPopupOpening = false;
        this.infoPopupRevision += 1;
        PopupManager.inst.closeByClass(BigMapInfoPopup, PopupCloseReason.Force);
    }

    private feedback(feedback: { ok: boolean; message: string }): void {
        if (feedback.message) Toast.show(feedback.message);
    }

    /**
     *头像预取：地图上每个玩家标记都要头像（榜单榜首 + 名单里全部角色）。
     *
     *`rolePortraits` 兼作"已发起"的登记表（先写 `null` 占位），所以每帧全量扫一遍不会重复发请求；
     *新进视野的据点名单到达后，下一帧自然补上。
     */
    private loadRolePortraits(data: IBigMapViewState): void {
        for (const city of data.cities.values()) {
            const avatarIds = [city.rankEntries.find((row) => row.rank === 1)?.avatarId];
            //2026-11-11：名单角色已按 `pos` 摆在地图上 ⇒ 全员头像都要，不能只加载弹窗当前那位。
            for (const role of city.campRoles) avatarIds.push(role.avatarId);
            for (const avatarId of avatarIds) {
                if (!avatarId || this.rolePortraits.has(avatarId)) continue;
                this.rolePortraits.set(avatarId, null);
                void this.loadRolePortrait(avatarId);
            }
        }
    }
    private async loadRolePortrait(avatarId: string): Promise<void> {
        const resources = this.controllerResources;
        let frame: SpriteFrame | null = null;
        try {
            frame = await HeadArt.loadHeadFrame(avatarId, (name, root) =>
                resources.assets.load(spriteFramePath(root, name), SpriteFrame, { scope: resources.scope }));
        } catch (error) {
            console.warn('[BigMapPage] 驻守玩家头像加载失败', error);
        }
        if (!this.isValid || resources.scope.disposed) return;
        this.rolePortraits.set(avatarId, frame);
        this.worldView.setRolePortrait(avatarId, frame);
        if (this.data) this.refreshInfo(this.data);
    }

    onDestroy(): void {
        this.ready = false;
        this.closeInfoPopup();
        this.closeCityPopup();
        if (this.data) EventMgr.instance.emit(BigMapUiEvent.Disposed);
        EventMgr.instance.offTarget(this);
        this.data = null;
        this.rolePortraits.clear();
    }
}
