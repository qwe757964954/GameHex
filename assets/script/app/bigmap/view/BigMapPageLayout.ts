import { _decorator, Button, Color, Component, Label, Node, Sprite, UITransform, Widget, type SpriteFrame } from 'cc';
import type { BigMapMode, IBigMapViewState } from '../application/BigMapViewState';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { BIGMAP_DOCK_COLORS, fitBigMapSprite } from './BigMapSkin';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapDuration } from './BigMapPresentationText';
import { BigMapBaseView } from './BigMapBaseView';
import type { IBigMapPlotCardContent } from './BigMapPlotCard';
import { BigMapPlotCard } from './BigMapPlotCard';
import { BigMapTopHud } from './BigMapTopHud';
import { Toast } from '../../common/Toast';

const { ccclass, property } = _decorator;

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

    /**
     * 顶部 HUD（玩家卡 / 5 格资源 / 基地队列卡）。
     *
     * 世界与基地共用同一棵节点树、同一份渲染；模式差异只在
     * `BigMapTopHud.render` 内切「队列卡是否显示」，不再维护两套 Label。
     */
    @property(BigMapTopHud) private topHud: BigMapTopHud = null!;
    /** 设计稿底部 720×559 建造面板，只在基地模式显示。 */
    @property(Node) private designDock: Node = null!;
    /** 建造面板展开时的空白区域点击接收层：点击面板外空白处隐藏建造面板。 */
    @property(Button) private dockBlankCatcher: Button = null!;

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
    @property(Button) private seasonButton: Button = null!;
    @property(Button) private warButton: Button = null!;
    @property(Label) private designCardLockReason: Label = null!;

    private dockCards: readonly IBigMapDockCard[] = [];
    private isUpgradeTab = false;
    private isDockOpen = false;
    private latestState: IBigMapViewState | null = null;
    private dockButtonFrames: readonly SpriteFrame[] = [];

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
        const queueBtn = this.topHud?.queueCardButton;
        if (queueBtn) queueBtn.node.on(Button.EventType.CLICK, this.onQueueClick, this);
        if (this.dockBlankCatcher) this.dockBlankCatcher.node.on(Button.EventType.CLICK, this.onBlankClick, this);
        this.seasonButton.node.on(Button.EventType.CLICK, this.onLockedNavClick, this);
        this.warButton.node.on(Button.EventType.CLICK, this.onLockedNavClick, this);
    }

    initialize(data: IBigMapViewState, navigationHeight: number): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        this.plotCard.node.active = false;
        this.applyNavigationHeight(navigationHeight);

        this.node.getComponent(Widget)?.updateAlignment();
        this.baseView.node.getComponent(Widget)?.updateAlignment();
        const pageHeight = this.node.getComponent(UITransform).height;
        const dockHeight = this.designDock.getComponent(UITransform).height;
        this.designDock.setPosition(0, (dockHeight - pageHeight) / 2, 0);
        this.topHud.node.setPosition(0, (pageHeight - BASE_REFERENCE_HEIGHT) / 2, 0);
        this.dockBlankCatcher?.node.getComponent(Widget)?.updateAlignment();

        const cardWidget = this.plotCard.node.getComponent(Widget);
        cardWidget.bottom = dockHeight + 12;
        cardWidget.updateAlignment();
    }

    mountWorld(node: Node): void {
        node.setParent(this.node);
        node.setSiblingIndex(0);
    }

    buildBase(data: IBigMapViewState, width: number, height: number, focusOffsetY: number): void {
        this.baseView.node.setPosition(0, 0, 0);
        this.baseView.setMapOffset(0, BASE_MAP_OFFSET_Y + focusOffsetY);
        this.baseView.build(data, width, height);
    }

    focusBase(hexId: number): void { this.baseView.focusOn(hexId); }

    setArt(art: IBigMapArt): void {
        this.art = art;
        this.baseView.setArt(art);
        this.applyMode(this.mode);
    }

    render(data: IBigMapViewState): void {
        this.latestState = data;
        this.inputEnabled = !data.ui.enteringBattle;
        if (this.mode !== data.ui.mode) {
            this.isUpgradeTab = false;
            this.isDockOpen = false;
        }
        if (data.ui.pendingBuildingId !== 0) {
            this.isDockOpen = false;
        }
        this.mode = data.ui.mode;
        this.applyMode(this.mode, data);
        this.topHud.render(data);
        this.harvestButton.interactable = !data.ui.baseActionPending && data.canHarvest;
        const dockActive = (this.mode === 'base') && (this.isDockOpen || data.ui.buildMenuVisible);
        if (dockActive) {
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
            if (this.latestState) this.refreshDock(this.latestState);
            return;
        }
        this.sendIntent({ kind: 'toggleBuildMenu' });
    }

    private onUpgradeTabClick(): void {
        if (this.isUpgradeTab) return;
        this.isUpgradeTab = true;
        this.sendIntent({ kind: 'clear' });
        if (this.latestState) this.refreshDock(this.latestState);
    }

    private onQueueClick(): void {
        if (!this.inputEnabled || this.mode !== 'base') return;
        const dockActive = this.isDockOpen || (this.latestState?.ui.buildMenuVisible ?? false);
        if (dockActive) {
            this.isDockOpen = false;
            if (this.latestState?.ui.buildMenuVisible) {
                this.sendIntent({ kind: 'closeBuildMenu' });
            } else if (this.latestState) {
                this.applyDockVisibility(this.latestState);
            }
        } else {
            this.isDockOpen = true;
            if (this.latestState) {
                this.applyDockVisibility(this.latestState);
                this.refreshQueue(this.latestState);
                this.refreshDock(this.latestState);
            }
        }
    }

    private onBlankClick(): void {
        const dockActive = (this.mode === 'base') && (this.isDockOpen || (this.latestState?.ui.buildMenuVisible ?? false));
        if (!this.inputEnabled || !dockActive) return;
        this.isDockOpen = false;
        if (this.latestState?.ui.buildMenuVisible) {
            this.sendIntent({ kind: 'closeBuildMenu' });
        } else if (this.latestState) {
            this.applyDockVisibility(this.latestState);
        }
    }

    private onLockedNavClick(): void {
        if (!this.inputEnabled) return;
        Toast.show(BIGMAP_PRESENTATION_TEXT.featureNotOpen);
    }

    private applyDockVisibility(data: IBigMapViewState): void {
        const base = this.mode === 'base';
        const dockActive = base && (this.isDockOpen || data.ui.buildMenuVisible);
        this.designDock.active = dockActive;
        if (this.dockBlankCatcher) this.dockBlankCatcher.node.active = dockActive;
        this.modeNode.active = !base || !dockActive;
        if (this.art) {
            const icon = this.art.hud.get(this.mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeIcon, icon, this.modeIconSize, 0, this.modeIconY);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeFrame, frame, this.modeFrameWidth, 0, this.modeFrameY);
            this.modeFallback.node.active = !frame;
            this.modeLabel.string = this.mode === 'world' ? BIGMAP_PRESENTATION_TEXT.baseToggle : BIGMAP_PRESENTATION_TEXT.worldToggle;
        }
    }

    private onDesignCardClick(button: Button): void {
        const card = this.dockCards[this.designCardButtons.indexOf(button)];
        if (card) {
            if (card.intent.kind === 'build') {
                this.isDockOpen = false;
                if (this.latestState) this.applyDockVisibility(this.latestState);
            }
            this.sendIntent(card.intent);
        }
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

    /** 页面加载好的玩家头像转交给顶部玩家卡（`MainResBar`），不二次请求。 */
    setPlayerPortrait(frame: SpriteFrame | null): void {
        this.topHud.setPlayerPortrait(frame);
    }

    private applyMode(mode: BigMapMode, data?: IBigMapViewState): void {
        const base = mode === 'base';
        this.baseView.node.active = base;
        // 顶栏两模式都显示；队列卡由 TopHud 按模式自行切换。
        this.topHud.node.active = true;
        const currentData = data ?? this.latestState;
        const dockActive = base && (this.isDockOpen || (currentData?.ui.buildMenuVisible ?? false));
        this.designDock.active = dockActive;
        if (this.dockBlankCatcher) this.dockBlankCatcher.node.active = dockActive;
        this.modeNode.active = !base || !dockActive;
        this.exploreButton.node.active = !base;
        //「一键收获」是世界玩法入口：基地模式收起，世界模式恢复。
        // prefab 中该按钮 right=70：给 Canvas/GMButton（52 宽 + 右 10）再留 8px 间隙，避免压住 GM 入口。
        this.harvestButton.node.active = !base;
        if (this.art) {
            const icon = this.art.hud.get(mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeIcon, icon, this.modeIconSize, 0, this.modeIconY);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeFrame, frame, this.modeFrameWidth, 0, this.modeFrameY);
            this.modeFallback.node.active = !frame;
            this.modeLabel.string = mode === 'world' ? BIGMAP_PRESENTATION_TEXT.baseToggle : BIGMAP_PRESENTATION_TEXT.worldToggle;
        }
    }

    /**
     * 统一心跳：推进顶部 5 个资源格的反馈。
     *
     * 不用 tween：反馈驱动只记 elapsed，每帧向 MainResBarFeedback 纯函数要当帧值；
     * TopHud 内部逐格 `step`，没有反馈时返回 false，不做额外节点操作。
     */
    update(dt: number): void {
        this.topHud.step(dt);
    }

    private refreshQueue(data: IBigMapViewState): void {
        const busy = data.queues.filter((queue) => queue.busy).length;
        const unlocked = data.queues.filter((queue) => !queue.locked).length;
        const summary = `${busy}/${unlocked}`;
        this.designDock.getChildByName('TopRow').getChildByName('QueueValue').getComponent(Label).string = summary;
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
