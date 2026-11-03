import { _decorator, Component, instantiate, Prefab, SpriteFrame, UITransform, Vec3, view } from 'cc';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { loadBigMapArt, type IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapCityView, IBigMapViewState } from '../application/BigMapViewState';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapMonsterDetail, formatBigMapPlotDetail } from './BigMapPresentationText';
import { BigMapWorldView } from './BigMapWorldView';

import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { PopupManager } from '../../../framework/ui/PopupManager';
import { Toast } from '../../common/Toast';
import { BigMapCityPopup, type IBigMapCityPopupContent } from './BigMapCityPopup';
import { BigMapInfoPopup, type IBigMapInfoPopupContent } from './BigMapInfoPopup';
import { BigMapPageLayout } from './BigMapPageLayout';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, BigMapViewEvent, type BigMapIntent, type IBigMapRenderEvent, type IBigMapViewCommandEvent } from '../application/BigMapEvents';

const { ccclass, property } = _decorator;

type BigMapMode = 'world' | 'base';

const HEADER_HEIGHT = 108;

const FOOTER_HEIGHT = 88;

const BIGMAP_PAGE_PREFAB_PATH = 'ui/bigmap/BigMapPage';
const BIGMAP_WORLD_PREFAB_PATH = 'ui/bigmap/BigMapWorldView';

/**
 * 大世界页面：地图铺满浏览区，目标详情点选时浮出；建造菜单仅基地模式显示。
 *
 * 负责页面装配、世界地图与详情弹窗流程；预制体内部渲染和输入交给 BigMapPageLayout。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private data: IBigMapViewState | null = null;
    private ready = false;
    private mode: BigMapMode = 'world';
    private navigationHeight = FOOTER_HEIGHT;
    private controllerResources: IControllerResources = null;
    // 资源域由 Controller 释放，可能早于 Cocos 帧末销毁；两者都约束 await 后的结果。
    private get artScope(): ResourceScope { return this.controllerResources.scope; }

    private layout: BigMapPageLayout = null;
    private worldView: BigMapWorldView = null;
    /**
     * 城池弹窗（`PopupBase` 子类，走 PopupManager 栈）。命中时**懒打开**，之后复用同一实例；
     * 野怪 / 地块详情走 BigMapInfoPopup。
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
        this.layout.setArt(art);
    }

    // -------------------------------------------------------------- 构建

    private get size(): { width: number; height: number } {
        const size = view.getVisibleSize();
        return {
            width: this.node.getComponent(UITransform)?.width || size.width,
            height: this.node.getComponent(UITransform)?.height || size.height,
        };
    }

    private buildUi(data: IBigMapViewState): void {
        const { width, height } = this.size;
        const ui = this.layout;
        ui.initialize(data, this.navigationHeight);
        ui.mountWorld(this.worldView.node);
        this.buildWorldArea(data, width, height);
        this.buildBaseArea(data, width, height);
        this.mode = 'world';
        this.applyMode();
    }

    /** 浏览地图铺满屏宽；浮层放在地图之上，不再把竖屏压成负宽度。 */
    private worldAreaRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const left = -width / 2 + 12;
        const right = width / 2 - 12;
        const bottom = -height / 2 + this.navigationHeight;
        const top = height / 2 - HEADER_HEIGHT - 20;
        return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
    }

    private buildWorldArea(data: IBigMapViewState, width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        const node = this.worldView.node;
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        // 先交付已加载的贴图，避免 build 把整张世界逐格画成 Graphics 后又立即清空重画。
        if (this.art) this.worldView.setArt(this.art);
        this.worldView.build(data, rect.width, rect.height);
    }

    private buildBaseArea(data: IBigMapViewState, width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        this.layout.buildBase(data, rect);
    }

    // -------------------------------------------------------------- 模式切换

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
    }

    // -------------------------------------------------------------- 交互

    private sendIntent(intent: BigMapIntent): void {
        if (this.ready && !this.enteringBattle) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onWorldTap(hexId: number): void { this.sendIntent({ kind: 'worldTap', hexId }); }
    private onPlotTap(hexId: number): void { this.sendIntent({ kind: 'plotTap', hexId }); }

    private onRender(event: IBigMapRenderEvent): void {
        this.data = event.state;
        if (this.ready) this.render(event.state);
    }
    private onCommand(event: IBigMapViewCommandEvent): void {
        if (!this.ready) return;
        const command = event.command;
        if (command.kind === 'feedback') this.feedback(command);
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

    // -------------------------------------------------------------- 刷新

    private refreshAll(data: IBigMapViewState): void {
        this.layout.render(data);
        this.refreshInfo(data);
        this.worldView.render(data);
    }

    private refreshInfo(data: IBigMapViewState): void {
        if (this.enteringBattle) {
            this.closeInfoPopup();
            this.closeCityPopup();
            return;
        }
        this.refreshInfoContent(data);
    }

    /**
     * 显示 / 复用城池弹窗。
     *
     * 弹窗是 `PopupBase` 子类、由 `PopupManager` 管生命周期，所以这里只做两件事：
     * 已经有实例就**直接复渲染**（不重复压栈），没有才 `open`。
     * 首次 `open` 要读预制体、有一帧延迟 —— 可接受，且打开后一直复用。
     */
    private showCityPopup(city: IBigMapCityView): void {
        const content = this.buildCityPopupContent(city);
        const opened = PopupManager.inst.get(BigMapCityPopup);
        if (opened) {
            opened.render(content);
            this.cityPopupOpened = true;
            return;
        }
        // `open` 是异步的（要读预制体），期间 `get` 仍返回 null ⇒ 不挡住的话每次 refresh 都会再压一层。
        if (this.cityPopupOpened) return;
        this.cityPopupOpened = true;
        void BigMapCityPopup.open({ userData: content }).catch((error: unknown) => {
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
     * 城池 → 弹窗展示数据。
     *
     * 排行榜来自当前城池快照；增益效果：`bigMapCamp` 表只有 `buffConNum` / `buffRate` 两个数值 + 一句 `campDesc`，
     *   没有逐条 buff 文案，先填 `campDesc` 一条（第二条自动隐藏）。
     */
    private buildCityPopupContent(city: IBigMapCityView): IBigMapCityPopupContent {
        const desc = city.campConfig?.desc ?? city.desc;
        return {
            title: city.name,
            buffs: desc ? [{ title: BIGMAP_PRESENTATION_TEXT.buffTitle, desc }] : [],
            ranks: city.rankEntries.map((row) => ({ rank: row.rank, name: row.name ?? '',
                score: String(row.warScore), avatar: null, avatarId: row.avatarId ?? '' })),
            warScore: city.warScore,
            minOccupyScore: city.minWarScore,
            lordName: city.campInfo?.occupyRoleName ?? '',
            lordScore: city.topWarScore > 0 ? String(city.topWarScore) : '',
            staminaCost: city.staminaCost,
            fightCaption: city.canAttack ? BIGMAP_PRESENTATION_TEXT.attack : BIGMAP_PRESENTATION_TEXT.cannotAttack,
            fightEnabled: city.canAttack,
        };
    }

    private refreshInfoContent(data: IBigMapViewState): void {
        const city = this.mode === 'world' && this.selectedCityId !== 0 ? data.cities.get(this.selectedCityId) : null;
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

    private buildInfoPopupContent(data: IBigMapViewState): IBigMapInfoPopupContent | null {
        if (this.mode === 'base' && this.selectedPlotHexId >= 0) {
            const detail = data.plotDetails.get(this.selectedPlotHexId);
            if (!detail) return null;
            const busy = detail.queueSlotIndex >= 0;
            const moving = this.pendingMoveInstanceId === detail.instanceId;
            const canHarvest = detail.stored > 0 || data.collectableBuildings.has(detail.buildingId);
            return {
                title: `${detail.name}  Lv.${detail.level} → ${detail.targetLevel}`,
                body: formatBigMapPlotDetail(detail) + (moving ? `\n${BIGMAP_PRESENTATION_TEXT.moveHint}` : ''),
                icon: this.art?.buildings.get(detail.buildingId) ?? null,
                primary: { text: busy ? BIGMAP_PRESENTATION_TEXT.cancelBuild : BIGMAP_PRESENTATION_TEXT.upgrade,
                    enabled: !this.baseActionPending && (busy || detail.canUpgrade) },
                secondary: canHarvest || !busy ? {
                    text: canHarvest ? data.isServerBase ? BIGMAP_PRESENTATION_TEXT.harvest
                        : `${BIGMAP_PRESENTATION_TEXT.harvest} ${detail.stored}`
                        : moving ? BIGMAP_PRESENTATION_TEXT.moveCancel : BIGMAP_PRESENTATION_TEXT.move,
                    enabled: !this.baseActionPending,
                } : null,
            };
        }
        const monster = this.mode === 'world' && this.selectedMonsterId !== 0 ? data.monsters.get(this.selectedMonsterId) : null;
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

    onDestroy(): void {
        this.ready = false;
        this.closeInfoPopup();
        this.closeCityPopup();
        if (this.data) EventMgr.instance.emit(BigMapUiEvent.Disposed);
        EventMgr.instance.offTarget(this);
        this.data = null;
    }
}
