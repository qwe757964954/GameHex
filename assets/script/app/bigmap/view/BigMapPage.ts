import { _decorator, BlockInputEvents, Color, Component, Graphics, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec3, view } from 'cc';
import type { AssetService } from '../../../core/asset/AssetService';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import { BIGMAP_BUNDLE } from '../../../core/asset/BundleCatalog';
import { loadBigMapArt, type IBigMapArt } from '../application/BigMapArtLoader';
import type { BigMapPresenter, IBigMapActionFeedback } from '../application/BigMapPresenter';
import { BIGMAP_COLORS, createButton, createLabel, createUiNode, drawPanel, type IBigMapButton } from './BigMapTheme';
import { BigMapWorldView } from './BigMapWorldView';
import { BigMapBaseView } from './BigMapBaseView';
import { BigMapTargetPanel } from './BigMapTargetPanel';
import { BIGMAP_CITY_PHASE_LABEL } from '../model/BigMapCitySchedule';
import { sortSnapshotScores } from '../model/BigMapSnapshot';
import {
    BIGMAP_HUD_COLORS, createBigMapSprite, drawBigMapCardPanel, paintBigMapCardPanel, fitBigMapSprite,
} from './BigMapSkin';
import { bigMapInfoLayout } from '../model/BigMapInfoLayout';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapPlotDetail, formatBigMapMonsterDetail } from './BigMapPresentationText';
import { BIGMAP_CAMP_STATE_TEXT, BIGMAP_CAMP_OCCUPATION_TEXT, BIGMAP_CAMP_QUERY_TEXT } from '../model/BigMapCampInfo';

const { ccclass } = _decorator;

type BigMapMode = 'world' | 'base';

const HEADER_HEIGHT = 108;
const FOOTER_HEIGHT = 88;
const SIDE_PANEL_WIDTH = 300;

/**
 * 「基地 / 世界」切换按钮的尺寸 —— **和底部菜单栏七格一模一样**的 122×96
 * （`cu_ty_btn13` 原生 168×132 等比 ×0.726）。用户口径是「和底部菜单栏保持统一」，
 * 这里连木牌大小都对齐，不另造一个尺寸。
 */
const MODE_BUTTON_WIDTH = 122;
const MODE_BUTTON_HEIGHT = 96;

/** 建造列表末尾「解锁队列」伪行的 id（真实建筑 id 都是 7 开头）。 */
const QUEUE_ROW_ID = -1;
const INFO_PANEL_WIDTH = 330;
const BIGMAP_WORLD_PREFAB_PATH = 'ui/bigmap/BigMapWorldView';

/**
 * 大世界页面：地图铺满浏览区，目标详情点选时浮出；建造菜单仅基地模式显示。
 *
 * 页面只做三件事：摆节点、把点击转成 Presenter 调用、把 Presenter 的视图数据写进 Label。
 * 任何规则判断都不在这里（都在 `model/`），所以改数值不用碰这个文件。
 */
@ccclass('BigMapPage')
export class BigMapPage extends Component {
    private presenter: BigMapPresenter | null = null;
    private mode: BigMapMode = 'world';
    private tickAccumulator = 0;
    private unsubscribe: (() => void) | null = null;
    private navigationHeight = FOOTER_HEIGHT;
    private toastUntil = 0;
    private readonly artScope = new ResourceScope('BigMapPage');

    private worldView: BigMapWorldView = null!;
    private baseView: BigMapBaseView = null!;

    private readonly resLabels = new Map<string, Label>();
    private art: IBigMapArt | null = null;
    private buildMenuButton: IBigMapButton = null!;
    private readonly skinButtons: IBigMapButton[] = [];
    private readonly resourceIcons = new Map<string, Sprite>();
    private infoThumbnail: Sprite = null!;
    /**
     * 详情卡图标的**请求显示宽度**（像素）：图标先按它铺开，再由 `applyInfoLayout`
     * 按剩余空间等比缩小。存字段而不是当场算，是因为「自然高度」要靠它反推。
     */
    private infoIconWidth = 112;
    private modeButton: IBigMapButton = null!;
    private harvestButton: IBigMapButton = null!;
    private resetButton: IBigMapButton = null!;

    private buildPanel: Node = null!;
    private readonly buildRows: {
        node: Node;
        background: Graphics;
        name: Label;
        detail: Label;
        buildingId: number;
    }[] = [];

    private infoPanel: Node = null!;
    /** 弹窗暗底（领地页 `TerritorySiteDetail` 的 `Dim` 同款）：点一下关闭。 */
    private infoDim: Node = null!;
    private infoTitle: Label = null!;
    private infoBody: Label = null!;
    private primaryButton: IBigMapButton = null!;
    private secondaryButton: IBigMapButton = null!;

    private queueLabel: Label = null!;
    private queuePanel: Node = null!;
    private toastLabel: Label = null!;

    private selectedCityId = 0;
    private selectedMonsterId = 0;
    private selectedPlotHexId = -1;
    private pendingBuildingId = 0;
    private baseActionPending = false;
    private selectedBaseHexId = -1;
    private readonly targetPanels = new Map<'level' | 'player', BigMapTargetPanel>();
    private playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null;
    private battleWarmup: ((isOpen: boolean) => void) | null = null;
    private playerPortrait: SpriteFrame | null = null;

    /** 由入口注入 Presenter（单独注入而非在页面里 new，便于单测与后续联机版替换实现）。 */
    async initialize(presenter: BigMapPresenter, _onClose: (() => void) | null = null, assets: AssetService | null = null, background = '', navigationHeight = FOOTER_HEIGHT,
        playerPortraitLoader: ((scope: ResourceScope) => Promise<SpriteFrame | null>) | null = null,
        battleWarmup: ((isOpen: boolean) => void) | null = null): Promise<void> {
        this.presenter = presenter;
        this.battleWarmup = battleWarmup;
        this.navigationHeight = navigationHeight;
        this.playerPortraitLoader = playerPortraitLoader;
        await Promise.all([
            this.loadWorldView(assets),
            this.loadTargetPanels(assets),
            assets ? this.loadArt(assets, background) : Promise.resolve(),
        ]);
        if (!this.isValid || this.artScope.disposed) return;
        this.buildUi();
        this.applyArt();
        this.unsubscribe = presenter.onChanged(() => this.refreshAll());
        this.refreshAll();
    }

    private async loadWorldView(assets: AssetService | null): Promise<void> {
        if (!assets) throw new Error('[BigMapPage] 加载地图预制体需要 AssetService');
        if (!this.isValid || this.artScope.disposed) return;
        let prefab: Prefab;
        try {
            prefab = await assets.load(BIGMAP_WORLD_PREFAB_PATH, Prefab, { scope: this.artScope });
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

    private async loadArt(assets: AssetService, background: string): Promise<void> {
        const [art, portrait] = await Promise.all([
            loadBigMapArt(assets, this.artScope, background),
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
        // 顶栏 / 详情 / 建造 / 队列**不贴 `concept/ui/*` 那张深铁概念图**：
        // 它们在 `buildUi` 里已经是手画的领地页 HUD 卡（`paintBigMapCardPanel`），贴上去反而盖住。
        // 概念图只留 `plot` / `stamina` / `home` 这些**地图上的图标**继续用。
        // 实心按钮统一走领地页【快速寻敌】那颗 3D 金钮；【基地/大地图】那颗另走两态木牌（见 `applyMode`）。
        for (const button of this.skinButtons) button.setSkin(art.hud.get('button') ?? null, BIGMAP_HUD_COLORS.ink);
        this.primaryButton.setSkin(art.hud.get('button') ?? null, BIGMAP_HUD_COLORS.ink);
        for (const [type, icon] of this.resourceIcons) {
            fitBigMapSprite(icon, art.resources.get(type as 'grain' | 'wood' | 'iron' | 'coin' | 'stamina') ?? null,
                27, icon.node.position.x, icon.node.position.y);
        }
        this.applyMode();
    }

    private async loadTargetPanels(assets: AssetService | null): Promise<void> {
        if (!assets) throw new Error('[BigMapPage] 弹窗预制体需要 AssetService');
        const entries = await Promise.all(([
            ['level', 'BigMapLevelInfoPanel'], ['player', 'BigMapPlayerLevelPanel'],
        ] as const).map(async ([key, name]) => [key, await assets.load(`ui/bigmap/${name}`, Prefab, { scope: this.artScope, bundle: BIGMAP_BUNDLE })] as const))
            .catch((error: unknown) => {
                if (!this.isValid || this.artScope.disposed) return [];
                throw error;
            });
        if (!this.isValid || this.artScope.disposed) return;
        for (const [key, prefab] of entries) {
            const root = instantiate(prefab);
            root.active = false;
            root.setParent(this.node);
            const panel = root.getComponent(BigMapTargetPanel);
            if (!panel) {
                root.destroy();
                throw new Error('[BigMapPage] 目标弹窗缺少 BigMapTargetPanel');
            }
            panel.initialize(this.size.width, this.size.height, () => this.onPrimaryAction(),
                () => { this.onSecondaryAction(); this.clearSelection(); }, () => this.clearSelection());
            this.targetPanels.set(key, panel);
        }
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
        const root = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        root.setContentSize(width, height);

        const backdrop = createUiNode('Backdrop', this.node, width, height);
        drawPanel(backdrop.addComponent(Graphics), width, height, new Color(35, 32, 27), null, 0);
        backdrop.addComponent(BlockInputEvents);

        this.buildWorldArea(width, height);
        this.buildBaseArea(width, height);
        this.buildHeader(width, height);
        this.buildBuildPanel(width, height);
        this.buildInfoPanel(width, height);
        this.modeButton.node.setSiblingIndex(this.node.children.length - 1);
        // 弹窗（暗底 + 卡片）必须压在最上层 —— 上面那行把模式木牌提到了最后，
        // 不再抬一次的话木牌会浮在暗底之上，模态当场穿帮。
        this.infoDim.setSiblingIndex(this.node.children.length - 1);
        this.infoPanel.setSiblingIndex(this.node.children.length - 1);
        // 轻提示最后抬：弹窗开着时也要能看见（「货币不足」这类正是点按钮才有的）。
        this.toastLabel.node.setSiblingIndex(this.node.children.length - 1);

        this.mode = 'world';
        this.applyMode();
    }

    private buildHeader(width: number, height: number): void {
        const header = createUiNode('Header', this.node, width, HEADER_HEIGHT);
        header.setPosition(0, height / 2 - HEADER_HEIGHT / 2, 0);
        // 顶栏**不再是一条通栏底板**，也不再有标题字（2026-10-22 第二轮用户口径：
        // 「删除植物大地图的文字」）。领地页顶部也是这个语法：地图顶到屏幕边，
        // 只有几张**浮在上面的 HUD 卡**（玩家卡 / 资源条），底图完全透出来。
        // `Header` 只当「顶部占位 + 坐标系」用，自己不画任何东西。
        const cardHeight = 62;
        const harvestWidth = 116;
        const cardWidth = Math.max(220, width - 24 - harvestWidth - 12);
        const resourceCard = createUiNode('ResourceCard', header, cardWidth, cardHeight);
        resourceCard.setPosition(-width / 2 + 12 + cardWidth / 2, 0, 0);
        paintBigMapCardPanel(resourceCard, cardWidth, cardHeight, 14);

        const resourceWidth = cardWidth / 5;
        for (const [index, type] of (['grain', 'wood', 'iron', 'coin', 'stamina'] as const).entries()) {
            const x = -cardWidth / 2 + resourceWidth * (index + 0.5);
            const icon = createBigMapSprite(`Resource_${type}`, resourceCard);
            icon.node.setPosition(x - resourceWidth / 2 + 20, 0, 0);
            const label = createLabel(resourceCard, '', 22, BIGMAP_HUD_COLORS.cream, resourceWidth - 38, 30);
            label.overflow = Label.Overflow.SHRINK;
            label.enableOutline = true;
            label.outlineColor = BIGMAP_HUD_COLORS.rim;
            label.outlineWidth = 2;
            label.node.setPosition(x + 14, 0, 0);
            this.resourceIcons.set(type, icon);
            this.resLabels.set(type, label);
        }

        this.harvestButton = createButton(header, BIGMAP_PRESENTATION_TEXT.harvestAll, harvestWidth, 48,
            () => { void this.runBaseAction(() => this.presenter!.requestHarvestAll()); }, 18);
        this.harvestButton.node.setPosition(width / 2 - 12 - harvestWidth / 2, 0, 0);
        this.harvestButton.label.color = BIGMAP_HUD_COLORS.ink;
        this.skinButtons.push(this.harvestButton);
        this.modeButton = createButton(this.node, BIGMAP_PRESENTATION_TEXT.baseToggle,
            MODE_BUTTON_WIDTH, MODE_BUTTON_HEIGHT,
            () => this.switchMode(this.mode === 'world' ? 'base' : 'world'), 24);
        this.modeButton.label.color = BIGMAP_HUD_COLORS.ink;
        this.modeButton.label.enableOutline = false;
        this.modeButton.node.name = 'BaseWorldToggle';
        this.buildMenuButton = createButton(this.node, BIGMAP_PRESENTATION_TEXT.build, 88, 40, () => {
            this.buildPanel.active = !this.buildPanel.active;
        }, 18);
        this.buildMenuButton.node.setPosition(-width / 2 + 60, height / 2 - HEADER_HEIGHT - 32, 0);
        this.skinButtons.push(this.buildMenuButton);
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
        const rect = this.worldAreaRect(width, height);
        const node = this.worldView.node;
        node.setSiblingIndex(this.node.children.length - 1);
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        // 先交付已加载的贴图，避免 build 把整张世界逐格画成 Graphics 后又立即清空重画。
        if (this.art) this.worldView.setArt(this.art);
        this.worldView.build(this.presenter!, rect.width, rect.height);
        this.worldView.onTap = (hexId) => this.onWorldTap(hexId);
    }

    private buildBaseArea(width: number, height: number): void {
        const rect = this.worldAreaRect(width, height);
        rect.height -= 200;
        rect.y += 100;
        const node = createUiNode('BaseView', this.node, rect.width, rect.height);
        node.setPosition(new Vec3(rect.x, rect.y, 0));
        this.baseView = node.addComponent(BigMapBaseView);
        this.baseView.build(this.presenter!, rect.width, rect.height);
        this.baseView.onTap = (hexId) => this.onPlotTap(hexId);
        this.baseView.onHarvest = (instanceId) => { void this.runBaseAction(() => this.presenter!.requestHarvest(instanceId)); };
    }

    private buildBuildPanel(width: number, _height: number): void {
        const panelHeight = 9 * 56 + 52;
        const panel = createUiNode('BuildPanel', this.node, SIDE_PANEL_WIDTH, panelHeight);
        panel.setPosition(new Vec3(-width / 2 + SIDE_PANEL_WIDTH / 2 + 12, -40, 0));
        paintBigMapCardPanel(panel, SIDE_PANEL_WIDTH, panelHeight, 14);
        this.buildPanel = panel;
        panel.addComponent(BlockInputEvents);

        const title = createLabel(panel, BIGMAP_PRESENTATION_TEXT.buildMenu, 20, BIGMAP_HUD_COLORS.gold, SIDE_PANEL_WIDTH - 24, 26);
        title.node.setPosition(new Vec3(0, panelHeight / 2 - 24, 0));
        title.horizontalAlign = Label.HorizontalAlign.CENTER;

        const menu = this.presenter!.buildMenu();
        menu.forEach((entry, index) => {
            const row = createUiNode(`BuildRow_${entry.buildingId}`, panel, SIDE_PANEL_WIDTH - 24, 50);
            row.setPosition(new Vec3(0, panelHeight / 2 - 62 - index * 56, 0));
            const background = row.addComponent(Graphics);
            drawBigMapCardPanel(background, SIDE_PANEL_WIDTH - 24, 50, 8, BIGMAP_HUD_COLORS.cardLight);
            const name = createLabel(row, entry.name, 17, BIGMAP_HUD_COLORS.cream, SIDE_PANEL_WIDTH - 40, 22);
            name.node.setPosition(new Vec3(0, 10, 0));
            const detail = createLabel(row, '', 13, BIGMAP_HUD_COLORS.muted, SIDE_PANEL_WIDTH - 40, 18);
            detail.node.setPosition(new Vec3(0, -11, 0));
            row.on(Node.EventType.TOUCH_END, () => this.onBuildRowClick(entry.buildingId));
            this.buildRows.push({ node: row, background, name, detail, buildingId: entry.buildingId });
        });

        // 队列付费解锁是一条**动作**而不是建筑，但在 UI 上和建筑同属「花钱变强」，所以放在列表末尾。
        const queueRow = createUiNode('BuildRow_Queue', panel, SIDE_PANEL_WIDTH - 24, 50);
        queueRow.setPosition(new Vec3(0, panelHeight / 2 - 62 - menu.length * 56, 0));
        const queueBackground = queueRow.addComponent(Graphics);
        drawBigMapCardPanel(queueBackground, SIDE_PANEL_WIDTH - 24, 50, 8, BIGMAP_HUD_COLORS.cardLight);
        const queueName = createLabel(queueRow, '解锁建造队列', 17, BIGMAP_HUD_COLORS.cream, SIDE_PANEL_WIDTH - 40, 22);
        queueName.node.setPosition(new Vec3(0, 10, 0));
        const queueDetail = createLabel(queueRow, '', 13, BIGMAP_HUD_COLORS.muted, SIDE_PANEL_WIDTH - 40, 18);
        queueDetail.node.setPosition(new Vec3(0, -11, 0));
        queueRow.on(Node.EventType.TOUCH_END, () => this.onBuildRowClick(QUEUE_ROW_ID));
        this.buildRows.push({
            node: queueRow,
            background: queueBackground,
            name: queueName,
            detail: queueDetail,
            buildingId: QUEUE_ROW_ID,
        });
    }

    /**
     * 目标详情弹窗。
     *
     * 2026-10-22 第二轮用户口径：「弹窗样式」跟领地页一致 ⇒ 从**贴底大面板**改成**居中模态**：
     * 全屏暗底（`BIGMAP_HUD_COLORS.scrim`，与 `TerritorySiteDetail` 的 `Dim` 同值 5/10/14/205）
     * + 居中深色卡（标题金、正文米白、两颗按钮并排放在底部）。
     *
     * 2026-10-22 第三轮：「弹窗内的 icon 和描述以及标题需要统一居中对齐」⇒ 卡内改成
     * **一条中线的竖排**（标题 → 图标 → 正文 → 按钮），不再用「左图标 + 右文字栏」。
     * 那个老排法有两个毛病（截图可见）：图标用 `this.size.width`（视口宽）算 x，
     * 而它的父节点是**卡片**（panel 宽 560），于是被推到卡片左边缘、压在正文上；
     * 标题为让开图标又整体右移，看着不居中。
     *
     * 暗底先建、卡片后建：同级后来者在上，卡片自然压在暗底之上，不用管 z 序。
     * 暗底挂 `BlockInputEvents`，点它等于「关掉弹窗」（领地页同一个交互）。
     */
    private buildInfoPanel(width: number, height: number): void {
        const dim = createUiNode('InfoDim', this.node, width, height);
        drawPanel(dim.addComponent(Graphics), width, height, BIGMAP_HUD_COLORS.scrim, null, 0);
        dim.addComponent(BlockInputEvents);
        dim.on(Node.EventType.TOUCH_END, () => this.clearSelection());
        this.infoDim = dim;

        const panelWidth = Math.min(Math.max(300, width - 48), 560);
        const panelHeight = Math.min(400, Math.max(300, height - HEADER_HEIGHT - this.navigationHeight - 160));
        const panel = createUiNode('InfoPanel', this.node, panelWidth, panelHeight);
        panel.setPosition(0, 0, 0);
        paintBigMapCardPanel(panel, panelWidth, panelHeight, 16);
        this.infoPanel = panel;
        panel.addComponent(BlockInputEvents);
        const close = createButton(panel, '×', 30, 30, () => this.clearSelection(), 22);
        close.node.setPosition(panelWidth / 2 - 23, panelHeight / 2 - 22, 0);
        close.label.color = BIGMAP_HUD_COLORS.ink;
        // 关闭按钮 30×30 是方的：`btn_quick_fight` 是高光金钮，压进方形会糊掉高光 ⇒
        // 不套皮肤，保留 `createButton` 自带的圆角小块（在深色卡上就是一块小亮块，够区分）。
        //
        // ⚠️ 卡内一律 `x = 0`：中线的位置由 `applyInfoLayout` 统一决定，这里只给尺寸。
        this.infoThumbnail = createBigMapSprite('TargetThumbnail', panel);
        this.infoThumbnail.node.active = false;
        this.infoTitle = createLabel(panel, '', 24, BIGMAP_HUD_COLORS.gold, panelWidth - 56, 34);
        this.infoTitle.overflow = Label.Overflow.SHRINK;
        this.infoTitle.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.infoTitle.enableOutline = true;
        this.infoTitle.outlineColor = BIGMAP_HUD_COLORS.rim;
        this.infoTitle.outlineWidth = 2;
        this.infoTitle.node.setPosition(0, panelHeight / 2 - 46, 0);
        this.infoBody = createLabel(panel, '', 15, BIGMAP_HUD_COLORS.cream, panelWidth - 56, panelHeight - 170);
        // 正文**恒居中**（用户口径）：图标在时读成「图标下方的说明」，图标不在时就是一整段居中文字。
        // ⚠️ 垂直也要 CENTER：Label 默认 TOP，而居中竖排给正文的框是「图标下沿 ~ 按钮上沿」，
        //    TOP 会让文字全部贴到图标底下、把下方留成一大块空白（看着像少画了一段）。
        this.infoBody.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.infoBody.verticalAlign = Label.VerticalAlign.CENTER;
        this.infoBody.node.setPosition(0, -14, 0);
        this.infoBody.overflow = Label.Overflow.CLAMP;
        this.infoBody.lineHeight = 21;
        // 两颗按钮并排在卡片底部：与领地页弹窗「返回地图 / 开战」同一个排法。
        const actionY = -panelHeight / 2 + 46;
        this.secondaryButton = createButton(panel, '定位', 132, 52, () => this.onSecondaryAction(), 19);
        this.secondaryButton.node.setPosition(-76, actionY, 0);
        this.secondaryButton.label.color = BIGMAP_HUD_COLORS.ink;
        this.skinButtons.push(this.secondaryButton);
        this.primaryButton = createButton(panel, '攻打', 132, 52, () => this.onPrimaryAction(), 20, true);
        this.primaryButton.node.setPosition(76, actionY, 0);
        this.queuePanel = createUiNode('QueueStatus', this.node, width - 180, 38);
        this.queuePanel.setPosition(50, height / 2 - HEADER_HEIGHT - 26, 0);
        paintBigMapCardPanel(this.queuePanel, width - 180, 38, 10, BIGMAP_HUD_COLORS.cardDeep);
        this.queueLabel = createLabel(this.queuePanel, '', 17, BIGMAP_HUD_COLORS.cream, width - 210, 30);
        this.queueLabel.overflow = Label.Overflow.SHRINK;
        this.queueLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.toastLabel = createLabel(this.node, '', 20, BIGMAP_HUD_COLORS.gold, width - 40, 36);
        this.toastLabel.node.setPosition(0, height / 2 - HEADER_HEIGHT - 80, 0);
        this.toastLabel.enableOutline = true;
        this.toastLabel.outlineColor = BIGMAP_HUD_COLORS.rim;
        this.toastLabel.outlineWidth = 2;
        this.toastLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.toastLabel.node.active = false;
        // 建完先按「没有图标」排一次：标题/正文的最终位置由 `applyInfoLayout` 给，
        // 这里不给会让首帧（`refreshAll` 之前）留一个错位的中间态。
        this.applyInfoLayout();
        // 初始必须是关的：`setInfoVisible` 在首帧 `refreshAll` 里也会调一次。
        this.infoDim.active = false;
        this.infoPanel.active = false;
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

    private switchMode(mode: BigMapMode): void {
        if (mode === this.mode) return;
        this.mode = mode;
        this.buildPanel.active = false;
        this.pendingBuildingId = 0;
        this.baseView.setPendingBuilding(0);
        this.applyMode();
        this.clearSelection();
        if (mode === 'base') {
            const main = this.presenter!.plotCells().find((cell) => cell.buildingId === this.presenter!.mainBuildingId);
            if (main) {
                this.selectedPlotHexId = main.hexId;
                this.baseView.select(main.hexId);
            }
        }
        this.refreshAll();
    }

    private applyMode(): void {
        this.worldView.node.active = this.mode === 'world';
        this.baseView.node.active = this.mode === 'base';
        this.buildPanel.active = this.mode === 'base' && this.buildPanel.active;
        this.buildMenuButton.node.active = this.mode === 'base';
        this.queuePanel.active = this.mode === 'base';
        this.modeButton.setText(this.mode === 'world' ? BIGMAP_PRESENTATION_TEXT.baseToggle : BIGMAP_PRESENTATION_TEXT.worldToggle);
        this.modeButton.label.color = BIGMAP_HUD_COLORS.ink;
        if (this.art) {
            // 与底部菜单栏同一个两态口径：`cu_ty_btn13`（常态）/ `cu_ty_btn14`（当前所在模式）。
            const key = this.mode === 'base' ? 'tab_active' : 'tab_idle';
            this.modeButton.setSkin(this.art.hud.get(key) ?? null, BIGMAP_HUD_COLORS.ink);
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

    private onWorldTap(hexId: number): void {
        const presenter = this.presenter!;
        const occupant = this.worldView.occupantAt(hexId);
        if (occupant.kind === 'city') {
            this.battleWarmup?.(true);
            this.selectedBaseHexId = -1;
            this.selectedCityId = occupant.cityId;
            this.selectedMonsterId = 0;
            this.selectedPlotHexId = -1;
            this.refreshInfo();
            // 榜单异步拉一次（拿回来 presenter 会 emit，页面自己重绘）。
            if (presenter.cityView(occupant.cityId)?.isServerCamp) void presenter.refreshCampDetail(occupant.cityId);
            else void presenter.refreshCityRank(occupant.cityId);
            return;
        }
        if (occupant.kind === 'monster') {
            this.battleWarmup?.(true);
            this.selectedBaseHexId = -1;
            this.selectedMonsterId = occupant.instanceId;
            this.selectedCityId = 0;
            this.selectedPlotHexId = -1;
            this.refreshInfo();
            return;
        }
        if (occupant.kind === 'base') {
            if (occupant.base.isPlayer) {
                this.switchMode('base');
                this.feedback({ ok: true, message: '回到自己的基地' });
            } else {
                this.clearSelection();
                this.selectedBaseHexId = hexId;
                this.refreshInfo();
            }
            return;
        }
        this.clearSelection();
    }

    private onPlotTap(hexId: number): void {
        const presenter = this.presenter!;
        this.selectedPlotHexId = hexId;
        if (this.pendingBuildingId !== 0) {
            const buildingId = this.pendingBuildingId;
            void this.runBaseAction(() => presenter.requestBuild(hexId, buildingId), () => {
                this.pendingBuildingId = 0;
                this.baseView.setPendingBuilding(0);
            });
            return;
        }
        const detail = presenter.plotDetail(hexId);
        this.buildPanel.active = detail === null;
        this.refreshInfo();
    }

    private onBuildRowClick(buildingId: number): void {
        if (buildingId === QUEUE_ROW_ID) {
            void this.runBaseAction(() => this.presenter!.requestUnlockBuildQueue());
            return;
        }
        const entry = this.presenter!.buildMenu().find((item) => item.buildingId === buildingId);
        if (!entry) return;
        if (!entry.unlocked) {
            this.feedback({ ok: false, message: entry.reason });
            return;
        }
        this.pendingBuildingId = this.pendingBuildingId === buildingId ? 0 : buildingId;
        this.baseView.setPendingBuilding(this.pendingBuildingId);
        this.buildPanel.active = false;
        this.feedback({
            ok: true,
            message: this.pendingBuildingId === 0 ? '已取消选择' : `点击空地放置${entry.name}`,
        });
    }

    private onPrimaryAction(): void {
        const presenter = this.presenter!;
        if (this.mode === 'base' && this.selectedPlotHexId >= 0) {
            const detail = presenter.plotDetail(this.selectedPlotHexId);
            if (!detail) return;
            void this.runBaseAction(() => detail.queueSlotIndex >= 0
                ? presenter.requestCancelQueue(detail.queueSlotIndex) : presenter.requestUpgrade(detail.instanceId));
            return;
        }
        if (this.selectedCityId !== 0) {
            void this.runBaseAction(() => presenter.requestAttackCity(this.selectedCityId));
            return;
        }
        if (this.selectedMonsterId !== 0) {
            void this.runBaseAction(() => presenter.requestAttackMonster(this.selectedMonsterId));
            return;
        }
        this.feedback({ ok: false, message: '先在地图上选一座城池或一只野怪' });
    }

    private onSecondaryAction(): void {
        const presenter = this.presenter!;
        if (this.mode === 'base') {
            const detail = presenter.plotDetail(this.selectedPlotHexId);
            if (detail) void this.runBaseAction(() => presenter.requestHarvest(detail.instanceId));
            return;
        }
        if (this.selectedCityId !== 0) {
            const view = presenter.cityView(this.selectedCityId);
            if (view) this.worldView.focusOn(view.hexId);
        }
        if (this.selectedMonsterId !== 0) {
            const view = presenter.monsterView(this.selectedMonsterId);
            if (view) this.worldView.focusOn(view.hexId);
        }
        if (this.selectedBaseHexId >= 0) this.worldView.focusOn(this.selectedBaseHexId);
    }

    private clearSelection(): void {
        this.battleWarmup?.(false);
        this.selectedBaseHexId = -1;
        this.selectedCityId = 0;
        this.selectedMonsterId = 0;
        this.selectedPlotHexId = -1;
        this.baseView.select(-1);
        this.refreshInfo();
    }

    // -------------------------------------------------------------- 刷新

    private refreshAll(): void {
        if (!this.presenter) return;
        this.refreshHeader();
        this.refreshBuildRows();
        this.refreshQueue();
        this.refreshInfo();
        this.worldView?.refresh();
        this.baseView?.refresh();
        this.refreshToast();
    }

    private refreshHeader(): void {
        for (const view of this.presenter!.resourceBar()) {
            const label = this.resLabels.get(view.type);
            if (!label) continue;
            const cap = Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
            const pending = view.pending > 0 ? `  +${view.pending}` : '';
            const amount = view.amount >= 1000 ? `${(view.amount / 1000).toFixed(1)}K` : `${view.amount}`;
            const recovery = this.presenter!.actionRecoverSeconds;
            label.string = view.amountKnown === false ? view.type === 'stamina' && recovery !== null && recovery > 0 ? `${recovery}s` : '—'
                : this.art ? amount + (view.type === 'stamina' ? cap : '') : `${view.name} ${view.amount}${cap}${pending}`;
            // HUD 皮肤：米白压深板岩卡；没加载到美术（纯色兜底）时退回旧的深棕字压浅纸面。
            label.color = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        }
        this.harvestButton.setEnabled(!this.baseActionPending && this.presenter!.canHarvest);
    }

    private refreshBuildRows(): void {
        const menu = this.presenter!.buildMenu();
        const textColor = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        const mutedColor = this.art ? BIGMAP_HUD_COLORS.muted : BIGMAP_COLORS.muted;
        const dangerColor = this.art ? BIGMAP_HUD_COLORS.danger : BIGMAP_COLORS.danger;
        const queueInfo = this.presenter!.queueUnlockInfo();
        for (const row of this.buildRows) {
            if (row.buildingId === QUEUE_ROW_ID) {
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
            const entry = menu.find((item) => item.buildingId === row.buildingId);
            if (!entry) continue;
            const selected = this.pendingBuildingId === row.buildingId;
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
        const queues = this.presenter!.queues();
        const busy = queues.filter((queue) => queue.busy)
            .map((queue) => `${queue.name}→Lv.${queue.targetLevel} ${queue.remainSeconds}s`);
        const idle = queues.filter((queue) => !queue.busy).length;
        this.queueLabel.string = `${BIGMAP_PRESENTATION_TEXT.queue} ${queues.length - idle}/${queues.length}`
            + (busy.length > 0 ? ` · ${busy.join(' / ')}` : ` · ${BIGMAP_PRESENTATION_TEXT.emptyQueue}`);
    }

    /**
     * 刷新详情弹窗。
     *
     * 拆成「填内容 → 统一排版」两步：内容方法里有 6 个 `return`（没选中 / 查不到就提前退出），
     * 排版却**每一轮都必须跑**（否则上一次的图标 / 按钮位置会留下来）。
     * 用外层包装而不是在每个 `return` 前补一句，是为了不给以后加分支的人留坑。
     */
    private refreshInfo(): void {
        this.refreshInfoContent();
        this.applyInfoLayout();
        this.refreshTargetPanel();
    }

    private refreshTargetPanel(): void {
        for (const [key, panel] of this.targetPanels) {
            if (this.mode !== 'world' || (key === 'player' ? this.selectedBaseHexId < 0
                : this.selectedCityId === 0 && this.selectedMonsterId === 0)) panel.hide();
        }
        const presenter = this.presenter;
        if (!presenter || this.mode !== 'world') return;
        if (this.selectedBaseHexId >= 0) {
            const base = presenter.world.baseByHex.get(this.selectedBaseHexId);
            const panel = this.targetPanels.get('player');
            if (!base || !panel) return;
            this.setInfoVisible(false);
            panel.render({
                title: base.name, headings: ['基地信息', '交互说明'],
                sections: [`战力：${base.power}\n距离：${Math.round(presenter.distanceFromBase(base.hexId))} 格`,
                    '其他玩家的基地\n当前暂未开放攻打\n可定位查看基地所在位置'],
                tip: '', primaryCaption: '暂不可攻打', primaryEnabled: false, staminaCost: 0, staminaIcon: null,
            });
            return;
        }
        const city = this.selectedCityId ? presenter.cityView(this.selectedCityId) : null;
        const monster = this.selectedMonsterId ? presenter.monsterView(this.selectedMonsterId) : null;
        const panel = this.targetPanels.get('level');
        if ((!city && !monster) || !panel) return;
        const lines = this.infoBody.string.split('\n').filter((line) => line !== '');
        this.setInfoVisible(false);
        panel.render({
            title: this.infoTitle.string, headings: ['目标状态', '挑战信息', '目标说明'],
            sections: [lines.slice(0, 2).join('\n'), lines.slice(2, 5).join('\n'), lines.slice(5).join('\n')],
            tip: '消耗行动力挑战目标，奖励以战斗结算为准',
            primaryCaption: this.primaryButton.label.string, primaryEnabled: city?.canAttack ?? monster?.canAttack ?? false,
            staminaCost: city?.staminaCost ?? monster?.staminaCost ?? 0,
            staminaIcon: this.art?.resources.get('stamina') ?? null,
        });
    }

    private refreshInfoContent(): void {
        const presenter = this.presenter!;
        this.setInfoVisible(this.selectedCityId !== 0 || this.selectedMonsterId !== 0
            || (this.mode === 'base' && this.selectedPlotHexId >= 0));
        this.secondaryButton.node.active = true;
        this.infoThumbnail.node.active = false;
        this.infoBody.fontSize = this.mode === 'base' ? 18 : 14;
        this.infoBody.lineHeight = this.mode === 'base' ? 28 : 19;
        if (this.mode === 'base' && this.selectedPlotHexId >= 0) {
            const detail = presenter.plotDetail(this.selectedPlotHexId);
            if (!detail) { this.setInfoVisible(false); return; }
            this.infoTitle.string = `${detail.name}  Lv.${detail.level} → ${detail.targetLevel}`;
            const busy = detail.queueSlotIndex >= 0;
            this.infoBody.string = formatBigMapPlotDetail(detail);
            this.primaryButton.node.active = true;
            this.primaryButton.setText(busy ? BIGMAP_PRESENTATION_TEXT.cancelBuild : BIGMAP_PRESENTATION_TEXT.upgrade);
            this.primaryButton.setEnabled(busy || detail.canUpgrade);
            this.secondaryButton.node.active = detail.stored > 0 || presenter.canCollectBuilding(detail.buildingId);
            this.secondaryButton.setText(presenter.isServerBase ? BIGMAP_PRESENTATION_TEXT.harvest : `${BIGMAP_PRESENTATION_TEXT.harvest} ${detail.stored}`);
            if (this.art && this.size.width >= 600) {
                this.setInfoIcon(this.art.buildings.get(detail.buildingId) ?? null, 110);
            }
            return;
        }

        if (this.selectedCityId !== 0) {
            const city = presenter.cityView(this.selectedCityId);
            if (!city) return;
            this.infoTitle.string = `${city.name}（Lv.${city.level}）`;
            if (this.art && this.size.width >= 600) this.setInfoIcon(this.art.city, 112);
            if (city.isServerCamp) {
                const info = city.campInfo;
                this.infoBody.string = [
                    info ? `占领状态：${BIGMAP_CAMP_OCCUPATION_TEXT[info.opType]}` : '',
                    info ? `据点状态：${BIGMAP_CAMP_STATE_TEXT[info.state]}` : '',
                    city.campDetailStatus === 'loading' || !info && city.campDetailStatus === 'idle'
                        ? BIGMAP_CAMP_QUERY_TEXT.pending : '',
                    city.campDetailStatus === 'failed'
                        ? city.canAttack && !info ? BIGMAP_CAMP_QUERY_TEXT.failedCanAttack : BIGMAP_CAMP_QUERY_TEXT.failed : '',
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
            const monster = presenter.monsterView(this.selectedMonsterId);
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
                '· 点建造中的格子 → 取消并返还资源',
                '',
                `建筑解锁全部来自冒险章节，当前已通关第 ${presenter.adventureChapter} 章。`,
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
        const presenter = this.presenter;
        const snapshot = presenter?.daySnapshot();
        if (!presenter || !snapshot) return '';
        const top = sortSnapshotScores(snapshot).slice(0, 3);
        if (top.length === 0) return '';
        const lines = top.map(([cityId, score]) => (
            `· ${presenter.cityView(cityId)?.name ?? cityId}　第 ${score.rank} 名　战功 ${score.warScore}`
        ));
        return ['', `昨日战绩（累计积分 ${snapshot.totalWarScore}）`, ...lines].join('\n');
    }

    private async runBaseAction(action: () => Promise<IBigMapActionFeedback>, onSuccess?: () => void): Promise<void> {
        if (this.baseActionPending) return;
        this.baseActionPending = true;
        try {
            const result = await action();
            if (!this.isValid || this.artScope.disposed) return;
            if (result.ok) onSuccess?.();
            this.feedback(result);
        } catch {
            if (this.isValid && !this.artScope.disposed) this.feedback({ ok: false, message: '操作失败，请重试' });
        } finally {
            this.baseActionPending = false;
            if (this.isValid && !this.artScope.disposed) this.refreshAll();
        }
    }

    private feedback(feedback: { ok: boolean; message: string }): void {
        if (!feedback.message) return;
        this.toastLabel.string = feedback.message;
        this.toastLabel.color = feedback.ok ? BIGMAP_COLORS.gold : BIGMAP_COLORS.danger;
        this.toastUntil = Date.now() + 2600;
        this.toastLabel.node.active = true;
        this.toastLabel.node.setSiblingIndex(this.node.children.length - 1);
    }

    private refreshToast(): void {
        if (this.toastUntil === 0) return;
        if (Date.now() > this.toastUntil) {
            this.toastUntil = 0;
            this.toastLabel.node.active = false;
        } else {
            this.toastLabel.node.setSiblingIndex(this.node.children.length - 1);
        }
    }

    // -------------------------------------------------------------- 心跳

    protected update(deltaTime: number): void {
        if (!this.presenter) return;
        this.tickAccumulator += deltaTime;
        if (this.tickAccumulator < 0.5) return;
        this.tickAccumulator = 0;
        // 静默推进（不触发 onChanged 递归），随后自己刷一次——地图标记重画比整页刷新便宜。
        this.presenter.tick(false);
        this.refreshHeader();
        this.refreshQueue();
        this.refreshInfo();
        this.worldView?.refresh();
        this.baseView?.refresh();
        this.refreshToast();
    }

    onDestroy(): void {
        this.presenter?.dispose();
        this.artScope.dispose();
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
