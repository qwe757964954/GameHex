import { _decorator, Button, Color, Component, Label, Node, Sprite, UITransform, Widget, type SpriteFrame } from 'cc';
import type { BigMapMode, IBigMapViewState } from '../application/BigMapViewState';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { BIGMAP_COLORS } from './BigMapTheme';
import { BIGMAP_DOCK_COLORS, BIGMAP_HUD_COLORS, fitBigMapSprite } from './BigMapSkin';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapDuration } from './BigMapPresentationText';
import { BigMapBaseView } from './BigMapBaseView';
import type { IBigMapPlotCardContent } from './BigMapPlotCard';
import { BigMapPlotCard } from './BigMapPlotCard';
import { BigMapResourceFeedback, formatBigMapResourceAmount } from './BigMapResourceFeedback';
import type { IBigMapResourceView } from '../application/BigMapViewState';

const { ccclass, property } = _decorator;
const RESOURCE_TYPES = ['grain', 'wood', 'iron', 'coin', 'stamina'] as const;
/** 设计稿顶部资源胶囊只放四种；金币在玩家卡里，不再重复占胶囊位。 */
const DESIGN_RESOURCE_TYPES = ['grain', 'wood', 'iron', 'stamina'] as const;

const BASE_REFERENCE_HEIGHT = 1610;
const BASE_MAP_OFFSET_Y = 68;

interface IBigMapDockCard {
    readonly name: string;
    readonly buildingId: number;
    readonly level: number;
    readonly seconds: number;
    readonly intent: BigMapIntent;
    readonly enabled: boolean;
    readonly lockedReason?: string;
}

/** 持有页面预制体内部控件，负责渲染和输入；外部仅交付展示快照与资源。 */
@ccclass('BigMapPageLayout')
export class BigMapPageLayout extends Component {
    @property([Label]) private resourceLabels: Label[] = [];
    @property([Sprite]) private resourceIcons: Sprite[] = [];
    @property(Sprite) private backdrop: Sprite = null!;
    @property(BigMapBaseView) private baseView: BigMapBaseView = null!;
    @property(Button) private harvestButton: Button = null!;
    @property(Button) private buildMenuButton: Button = null!;
    @property(Node) private modeNode: Node = null!;
    @property(Label) private modeLabel: Label = null!;
    @property(Sprite) private modeIcon: Sprite = null!;
    @property(Sprite) private modeFrame: Sprite = null!;
    @property(Sprite) private modeFallback: Sprite = null!;

    @property({ group: '模式按钮', tooltip: '底框目标宽度' }) private modeFrameWidth = 111;
    @property({ group: '模式按钮', tooltip: '底框目标 y' }) private modeFrameY = -7.5;
    @property({ group: '模式按钮', tooltip: '图标目标尺寸' }) private modeIconSize = 79;
    @property({ group: '模式按钮', tooltip: '图标目标 y' }) private modeIconY = 11.5;
    @property(Button) private exploreButton: Button = null!;
    /**
     *基地建筑卡（非模态贴底卡）。
     *
     *取代原先「点建筑就弹居中 `BigMapInfoPopup`」：那张弹窗有暗底和空白接收层，
     *会把地图整块挡住，想连着升两座建筑必须先关再找。这里只是页面内的普通节点。
     */
    @property(BigMapPlotCard) private plotCard: BigMapPlotCard = null!;

    /** 设计稿顶部 HUD（玩家卡 / 队列卡 / 资源胶囊），只在基地模式显示。 */
    @property(Node) private designHud: Node = null!;
    /** 设计稿底部 720×559 建造面板，只在基地模式显示。 */
    @property(Node) private designDock: Node = null!;
    /** 旧顶栏：世界模式继续用，基地模式让位给 `designHud`。 */
    @property(Node) private legacyHeader: Node = null!;

    @property([Label]) private designResourceLabels: Label[] = [];
    @property(Label) private designBuildQueueValue: Label = null!;
    @property(Label) private designResearchQueueValue: Label = null!;
    @property([Label]) private designCardNames: Label[] = [];
    @property([Label]) private designCardLevels: Label[] = [];
    @property([Label]) private designCardTimers: Label[] = [];
    @property([Node]) private designCardTimerIcons: Node[] = [];
    @property([Sprite]) private designCardIcons: Sprite[] = [];
    @property([Button]) private designCardButtons: Button[] = [];
    @property(Node) private designCardLock: Node = null!;
    @property([Label]) private designCardActions: Label[] = [];
    @property(Button) private upgradeTab: Button = null!;
    @property(Button) private baseBackButton: Button = null!;
    @property(Label) private designCardLockReason: Label = null!;

    private dockCards: readonly IBigMapDockCard[] = [];
    private isUpgradeTab = false;
    private dockButtonFrames: readonly SpriteFrame[] = [];

    /** 每个资源格的反馈驱动（懒建，与 resourceLabels 对齐）。 */
    private resourceFeedback: BigMapResourceFeedback[] | null = null;
    /** 有没有反馈在播（没有就整段 update 直接返回，不逐帧空转）。 */
    private resourceFeedbackActive = false;

    //仅保留输入所需的表现状态；初始化前不接收操作。
    private inputEnabled = false;
    private mode: BigMapMode = 'world';
    private art: IBigMapArt | null = null;
    protected onLoad(): void {
        this.harvestButton.node.on(Button.EventType.CLICK, this.onHarvestClick, this);
        this.buildMenuButton.node.on(Button.EventType.CLICK, this.onBuildMenuClick, this);
        this.exploreButton.node.on(Button.EventType.CLICK, this.onExploreClick, this);
        this.modeNode.on(Button.EventType.CLICK, this.onModeClick, this);
        this.baseBackButton.node.on(Button.EventType.CLICK, this.onModeClick, this);
        this.upgradeTab.node.on(Button.EventType.CLICK, this.onUpgradeTabClick, this);
        this.dockButtonFrames = this.designCardButtons.map((button) => button.node.getComponent(Sprite).spriteFrame);
        for (const button of this.designCardButtons) {
            button.node.on(Button.EventType.CLICK, this.onDesignCardClick, this);
        }
    }

    initialize(data: IBigMapViewState, navigationHeight: number): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        this.plotCard.node.active = false;
        this.applyNavigationHeight(navigationHeight);

        const pageHeight = this.node.getComponent(UITransform).height;
        const dockHeight = this.designDock.getComponent(UITransform).height;
        this.designDock.setPosition(0, (dockHeight - pageHeight) / 2, 0);
        this.designHud.setPosition(0, (pageHeight - BASE_REFERENCE_HEIGHT) / 2, 0);

        const cardWidget = this.plotCard.node.getComponent(Widget);
        cardWidget.bottom = dockHeight + 12;
        cardWidget.updateAlignment();
    }

    mountWorld(node: Node): void {
        node.setParent(this.node);
        node.setSiblingIndex(1);
    }

    buildBase(data: IBigMapViewState, rect: { x: number; y: number; width: number; height: number }): void {
        this.baseView.node.setPosition(rect.x, rect.y, 0);
        this.baseView.setMapOffset(0, BASE_MAP_OFFSET_Y);
        this.baseView.build(data, rect.width, rect.height);
    }

    focusBase(hexId: number): void { this.baseView.focusOn(hexId); }

    setArt(art: IBigMapArt): void {
        this.art = art;
        //页面底衬也铺沙地：设计稿顶部 HUD 后面是连续地表，不能露出黑底。
        if (this.backdrop && art.tiledBackground) {
            this.backdrop.spriteFrame = art.tiledBackground;
            this.backdrop.color = Color.WHITE;
            //基地底图由页面这一层统一铺满：SIMPLE 拉伸整张沙地，
            //不再用 TILED 让 2048 贴图按自身尺寸重复 —— 那样会在浏览区顶边出现一条接缝。
            this.backdrop.type = Sprite.Type.SIMPLE;
            this.backdrop.sizeMode = Sprite.SizeMode.CUSTOM;
            this.backdrop.trim = false;
            //Prefab 根节点仍是 720×1280，宿主实际高度按设备变化；底衬必须盖满宿主，不能留黑边。
            const host = this.node.parent?.getComponent(UITransform)?.contentSize;
            if (host) {
                this.backdrop.node.getComponent(UITransform).setContentSize(
                    Math.max(host.width, 720), Math.max(host.height, BASE_REFERENCE_HEIGHT),
                );
            }
            this.backdrop.node.setPosition(0, 0, 0);
        }
        this.baseView.setArt(art);
        this.resourceIcons.forEach((icon, index) => {
            icon.spriteFrame = art.resources.get(RESOURCE_TYPES[index]) ?? null;
        });
        this.applyMode(this.mode);
    }

    render(data: IBigMapViewState): void {
        this.inputEnabled = !data.ui.enteringBattle;
        if (this.mode !== data.ui.mode) this.isUpgradeTab = false;
        this.mode = data.ui.mode;
        this.applyMode(this.mode);
        this.refreshHeader(data);
        if (this.mode === 'base') {
            this.refreshQueue(data);
            this.refreshDock(data);
        }
        this.baseView.render(data);
    }

    private sendIntent(intent: BigMapIntent): void {
        if (this.inputEnabled) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onHarvestClick(): void { this.sendIntent({ kind: 'harvestAll' }); }
    private onBuildMenuClick(): void {
        if (this.isUpgradeTab) {
            this.isUpgradeTab = false;
            this.sendIntent({ kind: 'clear' });
            return;
        }
        this.sendIntent({ kind: 'toggleBuildMenu' });
    }

    private onUpgradeTabClick(): void {
        if (this.isUpgradeTab) return;
        this.isUpgradeTab = true;
        this.sendIntent({ kind: 'clear' });
    }

    private onDesignCardClick(button: Button): void {
        const card = this.dockCards[this.designCardButtons.indexOf(button)];
        if (card) this.sendIntent(card.intent);
    }

    private onExploreClick(): void { this.sendIntent({ kind: 'searchMonster' }); }
    private onModeClick(): void {
        this.sendIntent({ kind: 'mode', mode: this.mode === 'world' ? 'base' : 'world' });
    }

    /** 固定尺寸、边距与资源均分由 prefab 的 Widget 管理。 */
    private applyNavigationHeight(navigationHeight: number): void {
        this.node.getComponent(Widget).updateAlignment();
        const modeWidget = this.modeNode.getComponent(Widget);
        modeWidget.bottom = navigationHeight + 20;
        modeWidget.updateAlignment();
        const exploreWidget = this.exploreButton.node.getComponent(Widget);
        exploreWidget.bottom = navigationHeight + 128;
        exploreWidget.updateAlignment();
    }

    renderPlotCard(content: IBigMapPlotCardContent | null): void {
        this.plotCard.node.active = content !== null;
        if (content) this.plotCard.render(content);
    }

    private applyMode(mode: BigMapMode): void {
        const base = mode === 'base';
        this.baseView.node.active = base;
        this.legacyHeader.active = !base;
        this.designHud.active = base;
        this.designDock.active = base;
        this.modeNode.active = !base;
        this.exploreButton.node.active = !base;
        if (!base && this.art) {
            const icon = this.art.hud.get(mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeIcon, icon, this.modeIconSize, 0, this.modeIconY);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeFrame, frame, this.modeFrameWidth, 0, this.modeFrameY);
            this.modeFallback.node.active = !frame;
            this.modeLabel.string = BIGMAP_PRESENTATION_TEXT.baseToggle;
        }
    }

    /**
     *统一心跳：推进各资源格反馈。
     *
     *不用 tween：反馈驱动只记 elapsed，每帧向 MainResBarFeedback 纯函数要当帧值。
     *没有反馈在播时直接返回，不做逐帧空转。
     */
    update(dt: number): void {
        if (!this.resourceFeedbackActive) return;
        let busy = false;
        for (const feedback of this.resourceFeedbackList()) {
            if (feedback.step(dt)) busy = true;
        }
        this.resourceFeedbackActive = busy;
    }

    private resourceFeedbackList(): readonly BigMapResourceFeedback[] {
        if (!this.resourceFeedback) {
            this.resourceFeedback = this.resourceLabels.map((label) => new BigMapResourceFeedback(label));
        }
        return this.resourceFeedback;
    }

    private refreshHeader(data: IBigMapViewState): void {
        const feedbacks = this.resourceFeedbackList();
        for (const view of data.resources) {
            const index = RESOURCE_TYPES.indexOf(view.type);
            const label = this.resourceLabels[index];
            //反馈在播（含本帧刚起播）⇒ Label 由反馈驱动接管，本帧不写常态文本。
            if (feedbacks[index].sync(view)) {
                this.resourceFeedbackActive = true;
                continue;
            }
            label.string = this.steadyResourceText(view, data);
            //HUD 皮肤：米白压深板岩卡；没加载到美术（纯色兜底）时退回旧的深棕字压浅纸面。
            label.color = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        }
        if (this.mode === 'base') this.refreshDesignResources(data);
        this.harvestButton.interactable = !data.ui.baseActionPending && data.canHarvest;
    }

    /** 设计稿资源胶囊：只显示粮/木/铁/体力，数值与旧顶栏同一套口径。 */
    private refreshDesignResources(data: IBigMapViewState): void {
        for (let index = 0; index < this.designResourceLabels.length; index += 1) {
            const type = DESIGN_RESOURCE_TYPES[index];
            const view = data.resources.find((item) => item.type === type);
            const label = this.designResourceLabels[index];
            if (!view || !label) continue;
            //设计稿写的是 `3078` 而不是 `3.1K`；这里保留整数原值，
            //只有行动力仍按 `当前/上限` 展示，避免和顶部资源胶囊的视觉口径不一致。
            if (view.amountKnown === false) {
                label.string = this.steadyResourceText(view, data);
            } else {
                const amount = Math.floor(view.amount);
                const cap = type === 'stamina' && Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
                label.string = `${amount}${cap}`;
            }
            label.color = BIGMAP_HUD_COLORS.cream;
        }
    }

    /** 反馈未在播时的常态资源文本：未知 / 恢复倒计时 / 美术态 K 值 / 纯色兜底全名。 */
    private steadyResourceText(view: IBigMapResourceView, data: IBigMapViewState): string {
        const cap = Number.isFinite(view.cap) ? `/${Math.floor(view.cap)}` : '';
        const pending = view.pending > 0 ? `  +${view.pending}` : '';
        const recovery = data.actionRecoverSeconds;
        if (view.amountKnown === false) {
            return view.type === 'stamina' && recovery !== null && recovery > 0 ? `${recovery}s` : '—';
        }
        if (this.art) {
            return formatBigMapResourceAmount(view.amount) + (view.type === 'stamina' ? cap : '');
        }
        return `${view.name} ${view.amount}${cap}${pending}`;
    }

    private refreshQueue(data: IBigMapViewState): void {
        const busy = data.queues.filter((queue) => queue.busy).length;
        const unlocked = data.queues.filter((queue) => !queue.locked).length;
        const summary = `${busy}/${unlocked}`;
        this.designBuildQueueValue.string = summary;
        this.designDock.getChildByName('TopRow').getChildByName('QueueValue').getComponent(Label).string = summary;
        this.designResearchQueueValue.string = '—';
    }

    private refreshDock(data: IBigMapViewState): void {
        this.buildMenuButton.node.getComponent(Sprite).enabled = !this.isUpgradeTab;
        this.upgradeTab.node.getComponent(Sprite).enabled = this.isUpgradeTab;
        this.buildMenuButton.interactable = this.inputEnabled;
        this.upgradeTab.interactable = this.inputEnabled && !data.ui.pendingBuildingId;

        const selectedHexId = data.ui.selectedPlotHexId;
        const canInspect = !data.ui.baseActionPending && !data.ui.pendingBuildingId && !data.ui.pendingMoveInstanceId;
        const locked = this.isUpgradeTab ? undefined
            : data.buildMenu.find((entry) => !entry.unlocked && entry.count < entry.maxOwnNum);
        this.dockCards = this.isUpgradeTab
            ? Array.from(data.plotDetails.entries()).sort(([a], [b]) => (
                Number(b === selectedHexId) - Number(a === selectedHexId) || a - b
            )).slice(0, this.designCardButtons.length).map(([hexId, detail]) => ({
                name: detail.name, buildingId: detail.buildingId, level: detail.level || detail.targetLevel,
                seconds: detail.queueSlotIndex >= 0 ? detail.remainSeconds : detail.buildTime,
                intent: { kind: 'plotTap', hexId }, enabled: canInspect,
            }))
            : [
                ...data.buildMenu.filter((entry) => entry.unlocked),
                ...data.buildMenu.filter((entry) => entry !== locked && !entry.unlocked && entry.count < entry.maxOwnNum),
            ].slice(0, this.designCardButtons.length).map((entry) => ({
                name: entry.name, buildingId: entry.buildingId || this.configuredBuildingId(data, entry.kind),
                level: 1, seconds: entry.unlocked ? entry.buildTime : 0,
                intent: { kind: 'build', buildingKind: entry.kind },
                enabled: entry.unlocked && !data.ui.baseActionPending && !data.ui.pendingMoveInstanceId,
                lockedReason: entry.unlocked ? undefined : entry.reason,
            }));

        const lockName = this.designCardNames[0];
        lockName.node.parent.active = !!locked;
        this.designCardLock.active = !!locked;
        this.designCardLockReason.string = locked?.reason ?? '';
        lockName.string = locked?.name ?? '';
        this.setDockCardArt(0, locked ? this.configuredBuildingId(data, locked.kind) : 0, true);

        for (let index = 0; index < this.designCardButtons.length; index += 1) {
            const card = this.dockCards[index];
            const name = this.designCardNames[index + 1];
            name.node.parent.active = !!card;
            if (!card) continue;

            name.string = card.name;
            const level = this.designCardLevels[index];
            level.string = `${card.level}级`;
            level.node.parent.active = !card.lockedReason;
            const timer = this.designCardTimers[index];
            const duration = formatBigMapDuration(card.seconds);
            timer.string = duration.length === 5 ? `00:${duration}` : duration.padStart(8, '0');
            timer.node.active = card.seconds > 0;
            this.designCardTimerIcons[index].active = timer.node.active;
            const button = this.designCardButtons[index];
            button.node.active = !card.lockedReason;
            button.interactable = this.inputEnabled && card.enabled;
            const buttonSprite = button.node.getComponent(Sprite);
            buttonSprite.spriteFrame = this.dockButtonFrames[Number(this.isUpgradeTab)];
            buttonSprite.color = button.interactable ? Color.WHITE : BIGMAP_DOCK_COLORS.lockedArt;
            this.designCardActions[index].string = card.lockedReason ?? (this.isUpgradeTab
                ? BIGMAP_PRESENTATION_TEXT.upgrade : BIGMAP_PRESENTATION_TEXT.build);
            this.setDockCardArt(index + 1, card.buildingId, !!card.lockedReason);
        }
    }

    private configuredBuildingId(data: IBigMapViewState, kind: number): number {
        for (const config of data.buildingConfigs.values()) {
            if (config.kind === kind) return config.id;
        }
        return 0;
    }

    private setDockCardArt(index: number, buildingId: number, locked: boolean): void {
        const icon = this.designCardIcons[index];
        const card = this.designCardNames[index].node.parent.getComponent(Sprite);
        card.color = locked ? BIGMAP_DOCK_COLORS.lockedCard : Color.WHITE;
        icon.color = locked ? BIGMAP_DOCK_COLORS.lockedArt : Color.WHITE;
        icon.spriteFrame = this.art?.buildings.get(buildingId) ?? null;
        icon.node.active = !!icon.spriteFrame;
    }
}
