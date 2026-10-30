import { _decorator, Color, Component, Graphics, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec3, view } from 'cc';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import { loadBigMapArt, type IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapViewState } from '../application/BigMapViewState';
import { BIGMAP_COLORS, type IBigMapButton } from './BigMapTheme';
import { BigMapWorldView } from './BigMapWorldView';
import { BigMapBaseView } from './BigMapBaseView';
import { BIGMAP_CITY_PHASE_LABEL } from '../model/BigMapCitySchedule';
import { sortSnapshotScores } from '../model/BigMapSnapshot';
import {
    BIGMAP_HUD_COLORS, drawBigMapCardPanel, fitBigMapSprite,
} from './BigMapSkin';
import { bigMapInfoLayout } from '../model/BigMapInfoLayout';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapPlotDetail, formatBigMapMonsterDetail } from './BigMapPresentationText';
import { BIGMAP_CAMP_STATE_TEXT, BIGMAP_CAMP_OCCUPATION_TEXT, BIGMAP_CAMP_QUERY_TEXT } from '../model/BigMapCampInfo';
import { formatBigMapCampRoleLines } from '../model/BigMapCampRoleInfo';

import { BigMapPageLayout } from './BigMapPageLayout';
import { BigMapButton } from './BigMapButton';
import { BigMapBuildRow } from './BigMapBuildRow';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, BigMapViewEvent, type BigMapIntent, type IBigMapRenderEvent, type IBigMapViewCommandEvent } from '../application/BigMapEvents';

const { ccclass } = _decorator;

type BigMapMode = 'world' | 'base';

/** 模式按钮的 Prefab 引用。 */
interface IBigMapModeButton {
    readonly node: Node;
    readonly label: Label;
    readonly icon: Sprite;
    readonly frame: Sprite;
    /** 贴图没加载出来时兜底的那块手画底板（和其余按钮的 `drawPanel` 同款），有贴图就隐掉。 */
    readonly fallback: Graphics;
}

const HEADER_HEIGHT = 108;

const FOOTER_HEIGHT = 88;
const SIDE_PANEL_WIDTH = 300;

const MODE_BUTTON_HEIGHT = 96;
const MODE_FRAME_WIDTH = 111;
const MODE_FRAME_Y = -7.5;
const MODE_ICON_SIZE = 79;
const MODE_ICON_Y = 11.5;

/** 建造列表末尾「解锁队列」伪行的 id（真实建筑 id 都是 7 开头）。 */
const QUEUE_ROW_ID = -1;
const BIGMAP_PAGE_PREFAB_PATH = 'ui/bigmap/BigMapPage';
const BIGMAP_WORLD_PREFAB_PATH = 'ui/bigmap/BigMapWorldView';

/**
 * 大世界页面：地图铺满浏览区，目标详情点选时浮出；建造菜单仅基地模式显示。
 *
 * 页面只做三件事：摆节点、派发点击意图、把 Controller 的展示快照写进 Label。
 * 任何规则判断都不在这里（都在 `model/`），所以改数值不用碰这个文件。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private data: IBigMapViewState | null = null;
    private ready = false;
    private mode: BigMapMode = 'world';
    private navigationHeight = FOOTER_HEIGHT;
    private toastUntil = 0;
    private controllerResources: IControllerResources = null;
    private get artScope(): ResourceScope { return this.controllerResources.scope; }

    private layout: BigMapPageLayout = null;
    private worldView: BigMapWorldView = null;
    private baseView: BigMapBaseView = null;

    private readonly resLabels = new Map<string, Label>();
    private art: IBigMapArt | null = null;
    private buildMenuButton: IBigMapButton = null;
    private readonly skinButtons: IBigMapButton[] = [];
    private readonly resourceIcons = new Map<string, Sprite>();
    private infoThumbnail: Sprite = null;
    /**
     * 详情卡图标的**请求显示宽度**（像素）：图标先按它铺开，再由 `applyInfoLayout`
     * 按剩余空间等比缩小。存字段而不是当场算，是因为「自然高度」要靠它反推。
     */
    private infoIconWidth = 112;
    private modeButton: IBigMapModeButton = null;
    private harvestButton: IBigMapButton = null;

    private buildPanel: Node = null;
    /**
     * 建造目录的行。**按 `kind`（= `baseBuildType`）定位**，不按 `buildingId` ——
     * 一行代表一类建筑（「粮食田 1/5」），点一次建的是这一类的下一座 id，
     * 建完之后 nextId 会变，用旧 id 记行会点错建筑。
     */
    private readonly buildRows: {
        node: Node;
        background: Graphics;
        name: Label;
        detail: Label;
        kind: number;
    }[] = [];

    private infoPanel: Node = null;
    /** 弹窗暗底（领地页 `TerritorySiteDetail` 的 `Dim` 同款）：点一下关闭。 */
    private infoDim: Node = null;
    private infoTitle: Label = null;
    private infoBody: Label = null;
    private primaryButton: IBigMapButton = null;
    private secondaryButton: IBigMapButton = null;

    private queueLabel: Label = null;
    private queuePanel: Node = null;
    private toastLabel: Label = null;
    /** 开战回包已到、战斗还在预加载：全屏遮罩挡住地图，别让玩家继续点。 */
    private enterMask: Node = null;
    private enteringBattle = false;

    private selectedCityId = 0;
    private selectedMonsterId = 0;
    private selectedPlotHexId = -1;
    private pendingBuildingId = 0;
    /** 搬移态：非 0 时点空地 = 把这栋建筑搬过去（协议 `CmdSlgBuildMoveReqMsg`）。 */
    private pendingMoveInstanceId = 0;
    private baseActionPending = false;
    private selectedBaseHexId = -1;
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
            this.loadArt(background),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.buildUi();
        this.applyArt();
        this.ready = true;
        this.render(this.data);
        EventMgr.instance.emit(BigMapUiEvent.Ready);
    }

    private async loadPageLayout(): Promise<void> {
        if (!this.isValid || this.artScope.disposed) return;
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
        if (!this.isValid || this.artScope.disposed) return;
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

    private async loadArt(background: string): Promise<void> {
        const [art, portrait] = await Promise.all([
            loadBigMapArt(this.controllerResources.assets, this.artScope, background, this.data?.resourceIcons ?? new Map(),
                this.data?.buildingConfigs ?? new Map(), this.data?.campConfigs ?? new Map()),
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
        this.baseView.setArt(art);
        for (const button of this.skinButtons) button.setSkin(art.hud.get('button') ?? null, BIGMAP_HUD_COLORS.ink);
        this.primaryButton.setSkin(art.hud.get('button') ?? null, BIGMAP_HUD_COLORS.ink);
        for (const [type, icon] of this.resourceIcons) {
            fitBigMapSprite(icon, art.resources.get(type as 'grain' | 'wood' | 'iron' | 'coin' | 'stamina') ?? null,
                27, icon.node.position.x, icon.node.position.y);
        }
        this.applyMode();
    }

    // -------------------------------------------------------------- 构建

    private get size(): { width: number; height: number } {
        const size = view.getVisibleSize();
        return {
            width: this.node.getComponent(UITransform)?.width || size.width,
            height: this.node.getComponent(UITransform)?.height || size.height,
        };
    }

    private buildUi(): void {
        const { width, height } = this.size;
        const ui = this.layout;
        ui.resize(width, height, this.navigationHeight);
        this.baseView = ui.baseView;
        this.buildPanel = ui.buildPanel;
        this.infoPanel = ui.infoPanel;
        this.infoDim = ui.infoDim;
        this.infoTitle = ui.infoTitle;
        this.infoBody = ui.infoBody;
        this.infoThumbnail = ui.infoThumbnail;
        this.primaryButton = ui.primaryButton;
        this.secondaryButton = ui.secondaryButton;
        this.harvestButton = ui.harvestButton;
        this.buildMenuButton = ui.buildMenuButton;
        this.queuePanel = ui.queuePanel;
        this.queueLabel = ui.queueLabel;
        this.toastLabel = ui.toastLabel;
        this.enterMask = ui.enterMask;
        this.modeButton = { node: ui.modeNode, label: ui.modeLabel, icon: ui.modeIcon,
            frame: ui.modeFrame, fallback: ui.modeFallback };
        for (const [index, type] of (['grain', 'wood', 'iron', 'coin', 'stamina'] as const).entries()) {
            this.resLabels.set(type, ui.resourceLabels[index]);
            this.resourceIcons.set(type, ui.resourceIcons[index]);
        }
        this.skinButtons.push(ui.harvestButton, ui.buildMenuButton, ui.secondaryButton);
        this.bindButton(ui.harvestButton, () => this.sendIntent({ kind: 'harvestAll' }));
        this.bindButton(ui.buildMenuButton, () => this.sendIntent({ kind: 'toggleBuildMenu' }));
        this.bindButton(ui.closeButton, () => this.clearSelection());
        this.bindButton(ui.primaryButton, () => this.onPrimaryAction());
        this.bindButton(ui.secondaryButton, () => this.onSecondaryAction());
        this.infoDim.on(Node.EventType.TOUCH_END, this.clearSelection, this);
        ui.modeNode.on(Node.EventType.TOUCH_END, () => this.switchMode(this.mode === 'world' ? 'base' : 'world'), this);
        this.worldView.node.setParent(ui.node);
        this.worldView.node.setSiblingIndex(1);
        this.buildWorldArea(width, height);
        this.buildBaseArea(width, height);
        this.bindBuildRows();
        this.applyInfoLayout();
        this.mode = 'world';
        this.applyMode();
    }

    private bindButton(button: BigMapButton, action: () => void): void {
        button.node.on(Node.EventType.TOUCH_END, () => { if (button.interactable) action(); }, this);
    }

    private setBuildMenuVisible(visible: boolean): void {
        this.buildPanel.active = visible;
        // 激活会重画模板底板，同帧补回可建造/已满等状态底色。
        if (visible) this.refreshBuildRows();
    }

    private bindBuildRows(): void {
        const data = this.data;
        if (!data) return;
        const menu = data.buildMenu;
        const entries = [...menu, { kind: QUEUE_ROW_ID, name: '解锁建造队列' }];
        entries.forEach((entry, index) => {
            const node = instantiate(this.layout.buildRowTemplate.node);
            node.name = `BuildRow_${entry.kind}`;
            node.setParent(this.buildPanel);
            node.active = true;
            node.setPosition(0, 216 - index * 56);
            const row = node.getComponent(BigMapBuildRow);
            if (!row) throw new Error('[BigMapPage] 建造行模板缺少 BigMapBuildRow');
            row.nameLabel.string = entry.name;
            node.on(Node.EventType.TOUCH_END, () => this.onBuildRowClick(entry.kind), this);
            this.buildRows.push({ node, background: row.background, name: row.nameLabel,
                detail: row.detail, kind: entry.kind });
        });
    }

    /** 浏览地图铺满屏宽；浮层放在地图之上，不再把竖屏压成负宽度。 */
    private worldAreaRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const left = -width / 2 + 12;
        const right = width / 2 - 12;
        const bottom = -height / 2 + this.navigationHeight;
        const top = height / 2 - HEADER_HEIGHT - 20;
        return { x: (left + right) / 2, y: (bottom + top) / 2, width: right - left, height: top - bottom };
    }

    private buildWorldArea(width: number, height: number): void {
        const data = this.data;
        if (!data) return;
        const rect = this.worldAreaRect(width, height);
        const node = this.worldView.node;
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        // 先交付已加载的贴图，避免 build 把整张世界逐格画成 Graphics 后又立即清空重画。
        if (this.art) this.worldView.setArt(this.art);
        this.worldView.build(data, rect.width, rect.height);
    }

    private buildBaseArea(width: number, height: number): void {
        const data = this.data;
        if (!data) return;
        const rect = this.worldAreaRect(width, height);
        rect.height -= 200;
        rect.y += 100;
        const node = this.baseView.node;
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        this.baseView.build(data, rect.width, rect.height);
    }

    /**
     * 登记这一轮要显示的图标（真正的缩放与摆位交给 `applyInfoLayout`）。
     *
     * 只做「换帧 + 开关」，**不摆位置**：位置必须和标题 / 正文一起算
     * （空间不够时图标要让位给文字），分开写就会出现「图标先摆到左边、正文再压上来」。
     *
     * @param width 请求显示宽度（像素）；实际尺寸可能被 `applyInfoLayout` 等比压小。
     */
    private setInfoIcon(frame: SpriteFrame | null, width: number): void {
        this.infoThumbnail.spriteFrame = frame;
        this.infoThumbnail.node.active = !!frame;
        this.infoIconWidth = width > 0 ? width : 112;
    }

    /**
     * 详情卡内部的**居中竖排**：标题 → 图标 → 正文 → 按钮，水平中心统一在 `x = 0`。
     *
     * 具体数值全在 `model/BigMapInfoLayout.bigMapInfoLayout` 里算（纯函数，可单测）：
     * 这里只做「读当前状态 → 调它 → 把结果写进节点」。
     *
     * 为什么要按行数反算正文可用高度：正文是 `CLAMP`，位置给错了会直接截字。
     * 所以模型那边是「先算正文要多少 → 剩下的才给图标」；图标不够大就等比缩小，
     * 缩到 56 以下还放不下就干脆不显示（保住文字，图标是装饰）。
     */
    private applyInfoLayout(): void {
        if (!this.infoPanel?.isValid) return;
        const panelTransform = this.infoPanel.getComponent(UITransform);
        if (!panelTransform) return;

        const frame = this.infoThumbnail.node.active ? this.infoThumbnail.spriteFrame : null;
        // 自然高度 = 按请求宽度铺开后的**可见**高度（用 `rect` 而不是画布尺寸：美术有 trim 留白）。
        const naturalHeight = frame && frame.rect.width > 0
            ? frame.rect.height * (this.infoIconWidth / frame.rect.width)
            : 0;

        const layout = bigMapInfoLayout({
            panelWidth: panelTransform.contentSize.width,
            panelHeight: panelTransform.contentSize.height,
            lines: Math.max(1, this.infoBody.string.split('\n').length),
            lineHeight: this.infoBody.lineHeight,
            hasPrimary: this.primaryButton.node.active,
            hasSecondary: this.secondaryButton.node.active,
            iconHeight: naturalHeight,
        });

        this.infoTitle.node.setPosition(layout.centerX, layout.titleY, 0);
        if (layout.iconVisible) {
            this.placeInfoIcon(layout.iconSize, layout.iconY);
        } else if (this.infoThumbnail.node.active) {
            this.infoThumbnail.node.active = false;
        }
        const bodyTransform = this.infoBody.node.getComponent(UITransform);
        if (bodyTransform) bodyTransform.setContentSize(layout.bodyWidth, layout.bodyHeight);
        this.infoBody.node.setPosition(layout.centerX, layout.bodyY, 0);
        this.secondaryButton.node.setPosition(layout.secondaryX, layout.actionY, 0);
        this.primaryButton.node.setPosition(layout.primaryX, layout.actionY, 0);
    }

    /**
     * 把图标摆到「水平居中 + 可见中心落在 `centerY`」，缩放按**可见高度** `height` 反算。
     *
     * 与 `fitBigMapSprite` 同一套口径：`scale = 目标尺寸 / rect 尺寸`、
     * 位置减去 `offset × scale`（美术留白不对称时，可见中心不在节点中心，不补偿就左右偏几像素）。
     *
     * 每次都从 `frame.rect` **重算**缩放（不读节点当前缩放）：反复 `refreshInfo` 不会越缩越小。
     */
    private placeInfoIcon(height: number, centerY: number): void {
        const frame = this.infoThumbnail.spriteFrame;
        if (!frame || !(frame.rect.height > 0)) {
            this.infoThumbnail.node.active = false;
            return;
        }
        const scale = height / frame.rect.height;
        const node = this.infoThumbnail.node;
        node.setScale(scale, scale, 1);
        node.setPosition(-frame.offset.x * scale, centerY - frame.offset.y * scale, 0);
    }

    // -------------------------------------------------------------- 模式切换

    private switchMode(mode: BigMapMode): void { this.sendIntent({ kind: 'mode', mode }); }

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
        this.baseView.node.active = this.mode === 'base';
        this.buildPanel.active = this.mode === 'base' && this.buildPanel.active;
        this.buildMenuButton.node.active = this.mode === 'base';
        this.queuePanel.active = this.mode === 'base';
        this.modeButton.label.string = this.mode === 'world'
            ? BIGMAP_PRESENTATION_TEXT.baseToggle
            : BIGMAP_PRESENTATION_TEXT.worldToggle;
        if (this.art) {
            // 图标跟着文字走：写【基地】就压建筑 icon，写【大地图】就压折页地图。
            // 换模式时**只换 spriteFrame**，不重建节点 —— 重建会让那颗按钮在点下的那一帧闪一下。
            const icon = this.art.hud.get(this.mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeButton.icon, icon, MODE_ICON_SIZE, 0, MODE_ICON_Y);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeButton.frame, frame, MODE_FRAME_WIDTH, 0, MODE_FRAME_Y);
            this.modeButton.fallback.node.active = !frame;
        }
    }

    private setInfoVisible(visible: boolean): void {
        this.infoPanel.active = visible;
        // 暗底与卡片同生同死：只亮卡片就是一块浮在地图上的板，没有模态感。
        this.infoDim.active = visible;
        const { width, height } = this.size;
        // 弹窗改成居中模态后不再占底部，模式木牌回到常驻位（原先要给它让 330px）。
        this.modeButton.node.setPosition(-width / 2 + 78,
            -height / 2 + this.navigationHeight + 54 + (MODE_BUTTON_HEIGHT - 68) / 2, 0);
    }

    // -------------------------------------------------------------- 交互

    private sendIntent(intent: BigMapIntent): void {
        if (this.data && this.ready && !this.enteringBattle) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onWorldTap(hexId: number): void { this.sendIntent({ kind: 'worldTap', hexId }); }
    private onPlotTap(hexId: number): void { this.sendIntent({ kind: 'plotTap', hexId }); }
    private onBuildRowClick(buildingKind: number): void { this.sendIntent({ kind: 'build', buildingKind }); }
    private onPrimaryAction(): void { this.sendIntent({ kind: 'primary' }); }
    private onSecondaryAction(): void { this.sendIntent({ kind: 'secondary' }); }
    private clearSelection(): void { this.sendIntent({ kind: 'clear' }); }

    private onRender(event: IBigMapRenderEvent): void {
        this.data = event.state;
        if (this.ready) this.render(event.state);
    }
    private onCommand(event: IBigMapViewCommandEvent): void {
        if (!this.ready) return;
        const command = event.command;
        if (command.kind === 'feedback') this.feedback(command);
        else if (command.kind === 'focusWorld') this.worldView.focusOn(command.hexId);
        else this.baseView.focusOn(command.hexId);
    }
    private render(data: IBigMapViewState): void {
        this.data = data;
        const ui = data.ui;
        this.mode = ui.mode;
        this.selectedCityId = ui.selectedCityId;
        this.selectedMonsterId = ui.selectedMonsterId;
        this.selectedPlotHexId = ui.selectedPlotHexId;
        this.selectedBaseHexId = ui.selectedBaseHexId;
        this.pendingBuildingId = ui.pendingBuildingId;
        this.pendingMoveInstanceId = ui.pendingMoveInstanceId;
        this.baseActionPending = ui.baseActionPending;
        this.enteringBattle = ui.enteringBattle;
        this.applyMode();
        this.setBuildMenuVisible(ui.mode === 'base' && ui.buildMenuVisible);
        this.enterMask.active = ui.enteringBattle;
        this.refreshAll();
    }

    // -------------------------------------------------------------- 刷新

    private refreshAll(): void {
        if (!this.data) return;
        this.refreshHeader();
        this.refreshBuildRows();
        this.refreshQueue();
        this.refreshInfo();
        this.worldView.render(this.data);
        this.baseView.render(this.data);
        this.refreshToast();
    }

    private refreshHeader(): void {
        const data = this.data;
        if (!data) return;
        for (const view of data.resources) {
            const label = this.resLabels.get(view.type);
            if (!label) continue;
            const cap = Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
            const pending = view.pending > 0 ? `  +${view.pending}` : '';
            const amount = view.amount >= 1000 ? `${(view.amount / 1000).toFixed(1)}K` : `${view.amount}`;
            const recovery = data.actionRecoverSeconds;
            label.string = view.amountKnown === false ? view.type === 'stamina' && recovery !== null && recovery > 0 ? `${recovery}s` : '—'
                : this.art ? amount + (view.type === 'stamina' ? cap : '') : `${view.name} ${view.amount}${cap}${pending}`;
            // HUD 皮肤：米白压深板岩卡；没加载到美术（纯色兜底）时退回旧的深棕字压浅纸面。
            label.color = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        }
        this.harvestButton.setEnabled(!this.baseActionPending && data.canHarvest);
    }

    private refreshBuildRows(): void {
        const data = this.data;
        if (!data) return;
        const menu = data.buildMenu;
        const textColor = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        const mutedColor = this.art ? BIGMAP_HUD_COLORS.muted : BIGMAP_COLORS.muted;
        const dangerColor = this.art ? BIGMAP_HUD_COLORS.danger : BIGMAP_COLORS.danger;
        const queueInfo = data.queueUnlock;
        for (const row of this.buildRows) {
            if (row.kind === QUEUE_ROW_ID) {
                drawBigMapCardPanel(
                    row.background, SIDE_PANEL_WIDTH - 24, 50, 8,
                    queueInfo.canUnlock ? BIGMAP_HUD_COLORS.cardLight : BIGMAP_HUD_COLORS.cardDeep,
                );
                row.name.string = `解锁建造队列  ${queueInfo.current}/${queueInfo.max}`;
                row.name.color = queueInfo.canUnlock ? textColor : mutedColor;
                row.detail.string = queueInfo.canUnlock
                    ? `货币 ${Math.round(queueInfo.cost)} · 点击解锁第 ${queueInfo.current + 1} 条`
                    : queueInfo.reason;
                row.detail.color = queueInfo.canUnlock ? mutedColor : dangerColor;
                continue;
            }
            const entry = menu.find((item) => item.kind === row.kind);
            if (!entry) continue;
            const selected = this.pendingBuildingId !== 0 && this.pendingBuildingId === entry.buildingId;
            drawBigMapCardPanel(
                row.background, SIDE_PANEL_WIDTH - 24, 50, 8,
                selected ? BIGMAP_HUD_COLORS.cardLight : BIGMAP_HUD_COLORS.cardDeep,
            );
            if (selected) {
                // 选中态在深色卡上补一圈金线：深底轮换太弱，光换填充色一眼看不出来。
                row.background.strokeColor = BIGMAP_HUD_COLORS.gold;
                row.background.lineWidth = 2;
                row.background.roundRect(-SIDE_PANEL_WIDTH / 2 + 12 + 3, -22, SIDE_PANEL_WIDTH - 24 - 6, 44, 4);
                row.background.stroke();
            }
            row.name.string = `${entry.name}  ${entry.count}/${entry.maxOwnNum}`;
            row.name.color = entry.unlocked ? textColor : mutedColor;
            if (!entry.unlocked) {
                row.detail.string = entry.reason;
                row.detail.color = dangerColor;
            } else {
                row.detail.string = `粮${entry.costGrain} 木${entry.costWood} 铁${entry.costIron} · ${entry.buildTime}s · 第${entry.unlockChapter}章`;
                row.detail.color = entry.affordable ? mutedColor : dangerColor;
            }
        }
    }

    private refreshQueue(): void {
        const data = this.data;
        if (!data) return;
        const queues = data.queues;
        const busy = queues.filter((queue) => queue.busy)
            .map((queue) => `${queue.name}→Lv.${queue.targetLevel} ${queue.remainSeconds}s`);
        // 分母是 `bigmapQueue.maxBuildQueue`（解锁上限），不是"已解锁几条" ——
        // 否则新号看到的永远是 `0/1`，根本不知道还能解锁。
        const locked = queues.filter((queue) => queue.locked).length;
        const unlocked = queues.length - locked;
        this.queueLabel.string = `${BIGMAP_PRESENTATION_TEXT.queue} ${busy.length}/${unlocked}`
            + (busy.length > 0 ? ` · ${busy.join(' / ')}` : ` · ${BIGMAP_PRESENTATION_TEXT.emptyQueue}`)
            + (locked > 0 ? ` · ${BIGMAP_PRESENTATION_TEXT.queueLocked} ${locked}` : '');
    }

    /**
     * 刷新详情弹窗。
     *
     * 拆成「填内容 → 统一排版」两步：内容方法里有 6 个 `return`（没选中 / 查不到就提前退出），
     * 排版却**每一轮都必须跑**（否则上一次的图标 / 按钮位置会留下来）。
     * 用外层包装而不是在每个 `return` 前补一句，是为了不给以后加分支的人留坑。
     */
    private refreshInfo(): void {
        if (this.enteringBattle) {
            // 「正在进入战斗」期间不刷详情内容，但**排版必须跟一轮** ——
            // 否则会留着上一轮的图标 / 按钮位置（`bigmap-info-layout` 钉的就是这条）。
            this.setInfoVisible(false);
            this.applyInfoLayout();
            return;
        }
        this.refreshInfoContent();
        this.applyInfoLayout();
    }

    private refreshInfoContent(): void {
        const data = this.data;
        if (!data) return;
        this.setInfoVisible(this.selectedCityId !== 0 || this.selectedMonsterId !== 0
            || (this.mode === 'base' && this.selectedPlotHexId >= 0));
        this.secondaryButton.node.active = true;
        this.infoThumbnail.node.active = false;
        this.infoBody.fontSize = this.mode === 'base' ? 18 : 14;
        this.infoBody.lineHeight = this.mode === 'base' ? 28 : 19;
        if (this.mode === 'base' && this.selectedPlotHexId >= 0) {
            const detail = data.plotDetails.get(this.selectedPlotHexId);
            if (!detail) { this.setInfoVisible(false); return; }
            this.infoTitle.string = `${detail.name}  Lv.${detail.level} → ${detail.targetLevel}`;
            const busy = detail.queueSlotIndex >= 0;
            const moving = this.pendingMoveInstanceId === detail.instanceId;
            this.infoBody.string = formatBigMapPlotDetail(detail) + (moving ? `\n${BIGMAP_PRESENTATION_TEXT.moveHint}` : '');
            this.primaryButton.node.active = true;
            this.primaryButton.setText(busy ? BIGMAP_PRESENTATION_TEXT.cancelBuild : BIGMAP_PRESENTATION_TEXT.upgrade);
            this.primaryButton.setEnabled(busy || detail.canUpgrade);
            // 次按钮一键两用：有产出（或能收服务端产出）优先「收取」，否则给「移动」；
            // 建造中的格子既收不了也搬不了，直接藏掉。
            const canHarvest = detail.stored > 0 || data.collectableBuildings.has(detail.buildingId);
            this.secondaryButton.node.active = canHarvest || !busy;
            this.secondaryButton.setText(canHarvest
                ? data.isServerBase ? BIGMAP_PRESENTATION_TEXT.harvest : `${BIGMAP_PRESENTATION_TEXT.harvest} ${detail.stored}`
                : moving ? BIGMAP_PRESENTATION_TEXT.moveCancel : BIGMAP_PRESENTATION_TEXT.move);
            if (this.art && this.size.width >= 600) {
                this.setInfoIcon(this.art.buildings.get(detail.buildingId) ?? null, 110);
            }
            return;
        }

        if (this.selectedCityId !== 0) {
            const city = data.cities.get(this.selectedCityId);
            if (!city) return;
            this.infoTitle.string = `${city.name}（Lv.${city.level}）`;
            if (this.art && this.size.width >= 600) {
                this.setInfoIcon(this.art.camps.get(city.cityId) ?? this.art.city, 112);
            }
            if (city.isServerCamp) {
                const info = city.campInfo;
                const camp = city.campConfig;
                this.infoBody.string = [
                    info ? `占领状态：${BIGMAP_CAMP_OCCUPATION_TEXT[info.opType]}` : '',
                    info ? `据点状态：${BIGMAP_CAMP_STATE_TEXT[info.state]}` : '',
                    city.campDetailStatus === 'loading' || !info && city.campDetailStatus === 'idle'
                        ? BIGMAP_CAMP_QUERY_TEXT.pending : '',
                    city.campDetailStatus === 'failed'
                        ? city.canAttack && !info ? BIGMAP_CAMP_QUERY_TEXT.failedCanAttack : BIGMAP_CAMP_QUERY_TEXT.failed : '',
                    // 角色列表（r879 协议）：与据点状态是两条独立请求，各占一段、互不吞并。
                    ...formatBigMapCampRoleLines(city.campRoles, city.campRolesStatus),
                    camp ? `每日宣战上限：${camp.dailyBattleLimit} 次 · 开服第 ${camp.openDay} 天开放` : '',
                    camp ? `上榜积分：${camp.rankMinScore} · 占领积分：${camp.minOccupyScore}` : '',
                    `消耗行动力：${city.staminaCost}`,
                    city.attackReason,
                    city.desc,
                ].filter((line) => line !== '').join('\n');
                this.primaryButton.node.active = true;
                this.primaryButton.setText(city.canAttack ? '攻打' : '不可攻打');
                this.primaryButton.setEnabled(city.canAttack);
                this.secondaryButton.setText('定位');
                return;
            }
            const stateText: Record<string, string> = {
                open: '可攻打', locked: '未解锁', occupied: '已占领', unavailable: '本期未开放', breached: '城防已破',
            };
            const lines = [
                `状态：${stateText[city.state] ?? city.state}`,
                city.state === 'locked' ? `条件：${city.reason}` : '',
                `日程：${BIGMAP_CITY_PHASE_LABEL[city.phase]}${city.canAttack ? '' : ` · ${city.attackReason}`}`,
                // 「在不在势力范围内」现在只认服务器的 `toCampId`（见 `bigMapWithinCityRange`），
                // 所以文案不能再写「超出距离」，避免和判据口径对不上。
                `距离：${Math.round(city.distance)} 格${city.isPlayerCamp ? '（所处城池）' : city.inRange ? '' : `（不在势力范围内，伤害 -${city.damageCutPct}%）`}`,
                `城防：${Math.round(city.hpRatio * 100)}%   本轮战功：${city.warScore}/${city.minWarScore}`,
                `名次：第 ${city.playerRank} 名   同场 ${city.attackerCount} 人`,
                `消耗行动力：${city.staminaCost}`,
                city.state === 'open'
                    ? `预计伤害 ${city.previewDamage} · 战功 +${city.previewWarScore}`
                    : '',
                city.state === 'occupied' ? `占领奖励：货币 +${city.rewardCoin}` : '',
                '',
                city.desc,
            ];
            this.infoBody.string = lines.filter((line) => line !== '').join('\n');
            // 按钮跟随日程：休战/结算期即使城池开放也要灰掉，否则「亮着但点了才报错」。
            this.primaryButton.node.active = true;
            this.primaryButton.setText(city.canAttack ? '攻打' : '不可攻打');
            this.primaryButton.setEnabled(city.canAttack);
            this.secondaryButton.setText('定位');
            return;
        }

        if (this.selectedMonsterId !== 0) {
            const monster = data.monsters.get(this.selectedMonsterId);
            if (!monster) return;
            this.infoTitle.string = `${monster.name}（${monster.level} 级）`;
            if (this.art && this.size.width >= 600) this.setInfoIcon(this.art.monster, 112);
            this.infoBody.string = formatBigMapMonsterDetail(monster);
            this.primaryButton.node.active = true;
            this.primaryButton.setText(monster.canAttack ? '攻打' : monster.respawnInSeconds > 0 ? '等待刷新' : '暂不可挑战');
            this.primaryButton.setEnabled(monster.canAttack);
            this.secondaryButton.setText('定位');
            return;
        }

        this.infoTitle.string = this.mode === 'base' ? '基地建造' : '选择目标';
        this.infoBody.string = this.mode === 'base'
            ? [
                '六边格建造区：一格只能放一座建筑。',
                '',
                '· 左侧点建筑 → 再点空地放置',
                '· 点已建成的建筑 → 升级（第 3 章解锁）',
                '· 详情里的「移动」→ 点空地搬过去',
                '· 点建造中的格子 → 取消并返还资源',
                '',
                `建筑解锁全部来自冒险章节，当前已通关第 ${data.adventureChapter} 章。`,
            ].join('\n')
            : [
                '点击地图上的：',
                '· 城池建筑 → 查看城防与攻打',
                '· 野怪 → 查看挑战条件',
                '· 绿色树屋 → 进入我的基地',
                '· 红色树屋 → 查看其他基地',
                '',
                '城池解锁是「章节 + 开服天数 + 前置城池已占领」三重条件。',
            ].join('\n') + this.daySnapshotLines();
        this.primaryButton.node.active = false;
        this.secondaryButton.node.active = false;
    }

    /**
     * 「昨日战绩」——22:00 快照，只显示战功最高的三座城。
     *
     * 没有快照（新号 / 还没过过 22:00）就返回空串，不占版面也不显示「暂无」这种噪音。
     */
    private daySnapshotLines(): string {
        const data = this.data;
        const snapshot = data?.daySnapshot;
        if (!data || !snapshot) return '';
        const top = sortSnapshotScores(snapshot).slice(0, 3);
        if (top.length === 0) return '';
        const lines = top.map(([cityId, score]) => (
            `· ${data.cities.get(cityId)?.name ?? cityId}　第 ${score.rank} 名　战功 ${score.warScore}`
        ));
        return ['', `昨日战绩（累计积分 ${snapshot.totalWarScore}）`, ...lines].join('\n');
    }

    private feedback(feedback: { ok: boolean; message: string }): void {
        if (!feedback.message) return;
        this.toastLabel.string = feedback.message;
        this.toastLabel.color = feedback.ok ? BIGMAP_COLORS.gold : BIGMAP_COLORS.danger;
        this.toastUntil = Date.now() + 2600;
        this.toastLabel.node.active = true;
        this.toastLabel.node.setSiblingIndex(this.layout.node.children.length - 1);
    }

    private refreshToast(): void {
        if (this.toastUntil === 0) return;
        if (Date.now() > this.toastUntil) {
            this.toastUntil = 0;
            this.toastLabel.node.active = false;
        } else {
            this.toastLabel.node.setSiblingIndex(this.layout.node.children.length - 1);
        }
    }

    // -------------------------------------------------------------- 心跳

    protected update(): void { this.refreshToast(); }

    onDestroy(): void {
        this.ready = false;
        if (this.data) EventMgr.instance.emit(BigMapUiEvent.Disposed);
        EventMgr.instance.offTarget(this);
        this.data = null;
    }
}
