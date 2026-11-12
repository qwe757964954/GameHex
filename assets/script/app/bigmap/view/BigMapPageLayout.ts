import { _decorator, Button, Component, Label, Node, Sprite, Widget } from 'cc';
import type { IBigMapViewState } from '../application/BigMapViewState';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';
import { BIGMAP_COLORS } from './BigMapTheme';
import { BIGMAP_HUD_COLORS, fitBigMapSprite } from './BigMapSkin';
import { BIGMAP_PRESENTATION_TEXT, formatBigMapDuration } from './BigMapPresentationText';
import { BigMapBaseView } from './BigMapBaseView';
import type { IBigMapPlotCardContent } from './BigMapPlotCard';
import { BigMapPlotCard } from './BigMapPlotCard';
import { BigMapResourceFeedback, formatBigMapResourceAmount } from './BigMapResourceFeedback';
import type { IBigMapResourceView } from '../application/BigMapViewState';

const { ccclass, property } = _decorator;
const RESOURCE_TYPES = ['grain', 'wood', 'iron', 'coin', 'stamina'] as const;
const MODE_FRAME_WIDTH = 111;
const MODE_FRAME_Y = -7.5;
const MODE_ICON_SIZE = 79;
const MODE_ICON_Y = 11.5;

/** 持有页面预制体内部控件，负责渲染和输入；外部仅交付展示快照与资源。 */
@ccclass('BigMapPageLayout')
export class BigMapPageLayout extends Component {
    @property([Label]) private resourceLabels: Label[] = [];
    @property([Sprite]) private resourceIcons: Sprite[] = [];
    @property(BigMapBaseView) private baseView: BigMapBaseView = null!;
    @property(Button) private harvestButton: Button = null!;
    @property(Button) private buildMenuButton: Button = null!;
    @property(Node) private modeNode: Node = null!;
    @property(Label) private modeLabel: Label = null!;
    @property(Sprite) private modeIcon: Sprite = null!;
    @property(Sprite) private modeFrame: Sprite = null!;
    @property(Sprite) private modeFallback: Sprite = null!;
    @property(Button) private exploreButton: Button = null!;
    @property(Node) private queuePanel: Node = null!;
    @property(Label) private queueLabel: Label = null!;
    /**
     * 建造队列的槽位点（数量 = `bigmapQueue.maxBuildQueue`，当前 3）。
     *
     * 以前队列只有一行文字「建造队列 1/1 · 粮食田→Lv.3 120s · 待解锁 1」——
     * 三块信息挤在 540px 里，窄屏必截断，而且「还剩几条能建」要读完整句才知道。
     * 拆成槽位点后：颜色/填充表达状态，文字只留「几条在用 + 在建什么」。
     */
    // 用 `Node[]` 而不是 `Sprite[]`：cc 的组件数组没法用 MCP 设（只支持 nodeArray），
    // 而这三个槽位必须在 Inspector 里可见可换。Sprite 在 `refreshQueue` 里取，3 次 `getComponent` 可忽略。
    @property({ type: [Node] }) private queueSlotNodes: Node[] = [];
    /**
     * 基地建筑卡（**非模态**贴底卡）。
     *
     * 取代原先「点建筑就弹居中 `BigMapInfoPopup`」：那张弹窗有暗底和空白接收层，
     * 会把地图整块挡住，想连着升两座建筑必须先关再找。这里只是页面内的普通节点。
     */
    @property(BigMapPlotCard) private plotCard: BigMapPlotCard = null!;

    /** 每个资源格的反馈驱动（懒建，与 resourceLabels 对齐）。 */
    private resourceFeedback: BigMapResourceFeedback[] | null = null;
    /** 有没有反馈在播（没有就整段 update 直接返回，不逐帧空转）。 */
    private resourceFeedbackActive = false;

    // 仅保留输入所需的表现状态；初始化前不接收操作。
    private inputEnabled = false;
    private mode: 'world' | 'base' = 'world';
    private art: IBigMapArt | null = null;
    protected onLoad(): void {
        this.harvestButton.node.on(Button.EventType.CLICK, this.onHarvestClick, this);
        this.buildMenuButton.node.on(Button.EventType.CLICK, this.onBuildMenuClick, this);
        this.exploreButton.node.on(Button.EventType.CLICK, this.onExploreClick, this);
        this.modeNode.on(Button.EventType.CLICK, this.onModeClick, this);
    }

    initialize(data: IBigMapViewState, navigationHeight: number): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        // 卡片必须垫在导航钮**下面**（否则会盖住「基地 / 大地图」和「探索」）。
        // 层级用代码定：MCP 保存 prefab 时 `_children` 顺序不保证按编辑器所见重排（实测过）。
        // 借队列条的槽位 —— 它本来就处在「地图之上、导航之下」这一层。
        if (this.plotCard?.node && this.queuePanel) {
            this.plotCard.node.setSiblingIndex(this.queuePanel.getSiblingIndex());
        }
        // 首帧先收起：prefab 里它是 active 的（否则编辑器看不见），
        // 不先关掉会在「初始化完成 → 第一次 render」之间闪一下占位文案。
        if (this.plotCard?.node) this.plotCard.node.active = false;
        this.applyNavigationHeight(navigationHeight);
    }

    mountWorld(node: Node): void {
        node.setParent(this.node);
        node.setSiblingIndex(1);
    }

    buildBase(data: IBigMapViewState, rect: { x: number; y: number; width: number; height: number }): void {
        this.baseView.node.setPosition(rect.x, rect.y, 0);
        this.baseView.build(data, rect.width, rect.height);
    }

    focusBase(hexId: number): void { this.baseView.focusOn(hexId); }

    setArt(art: IBigMapArt): void {
        this.art = art;
        this.baseView.setArt(art);
        this.resourceIcons.forEach((icon, index) => {
            icon.spriteFrame = art.resources.get(RESOURCE_TYPES[index]) ?? null;
        });
        this.applyMode(this.mode);
    }

    render(data: IBigMapViewState): void {
        this.inputEnabled = !data.ui.enteringBattle;
        this.mode = data.ui.mode;
        this.applyMode(data.ui.mode);
        this.refreshHeader(data);
        this.refreshQueue(data);
        this.baseView.render(data);
    }

    private sendIntent(intent: BigMapIntent): void {
        if (this.inputEnabled) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent });
    }
    private onHarvestClick(): void { this.sendIntent({ kind: 'harvestAll' }); }
    private onBuildMenuClick(): void { this.sendIntent({ kind: 'toggleBuildMenu' }); }
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
        // 建筑卡要落在「模式钮 / 探索钮」**上方**：那两颗按钮占 108~204（bottom=nav+20、高 96），
        // 卡贴底 124 才不会被导航条压住。
        // 允许未绑定（老 prefab / 测试桩）：卡片缺席不影响其余控件适配。
        const cardWidget = this.plotCard?.node?.getComponent(Widget);
        if (cardWidget) {
            cardWidget.bottom = navigationHeight + 124;
            cardWidget.updateAlignment();
        }
    }

    /**
     * 驱动建筑卡：`null` = 收起。
     *
     * 只在 `BigMapPage` 算好内容后调一次（每帧只写一遍节点），卡自己不持有 Controller。
     */
    renderPlotCard(content: IBigMapPlotCardContent | null): void {
        if (!this.plotCard?.node) return;
        this.plotCard.node.active = content !== null;
        if (content) this.plotCard.render(content);
    }

    private applyMode(mode: IBigMapViewState['ui']['mode']): void {
        this.baseView.node.active = mode === 'base';
        this.buildMenuButton.node.active = mode === 'base';
        this.queuePanel.active = mode === 'base';
        // 「探索」（野怪搜索）只在**大地图**出现（2026-11-11 用户口径：
        // *「基地界面隐藏 搜索icon，搜索icon 只在大地图显示」*）—— 它找的是地图上的野怪，
        // 基地界面既看不到野怪、也没有相机可定位，留着只会点出一句「附近没有可挑战的野怪」。
        this.exploreButton.node.active = mode === 'world';
        this.modeLabel.string = mode === 'world'
            ? BIGMAP_PRESENTATION_TEXT.baseToggle
            : BIGMAP_PRESENTATION_TEXT.worldToggle;
        if (this.art) {
            // 图标跟着文字走：写【基地】就压建筑 icon，写【大地图】就压折页地图。
            // 换模式时**只换 spriteFrame**，不重建节点 —— 重建会让那颗按钮在点下的那一帧闪一下。
            const icon = this.art.hud.get(mode === 'world' ? 'mode_base' : 'mode_world') ?? null;
            fitBigMapSprite(this.modeIcon, icon, MODE_ICON_SIZE, 0, MODE_ICON_Y);
            const frame = this.art.hud.get('mode_frame') ?? null;
            fitBigMapSprite(this.modeFrame, frame, MODE_FRAME_WIDTH, 0, MODE_FRAME_Y);
            this.modeFallback.node.active = !frame;
        }
    }

    /**
     * 统一心跳：推进各资源格反馈。
     *
     * 不用 tween：反馈驱动只记 elapsed，每帧向 MainResBarFeedback 纯函数要当帧值。
     * 没有反馈在播时直接返回，不做逐帧空转。
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
            // 反馈在播（含本帧刚起播）⇒ Label 由反馈驱动接管，本帧不写常态文本。
            if (feedbacks[index].sync(view)) {
                this.resourceFeedbackActive = true;
                continue;
            }
            label.string = this.steadyResourceText(view, data);
            // HUD 皮肤：米白压深板岩卡；没加载到美术（纯色兜底）时退回旧的深棕字压浅纸面。
            label.color = this.art ? BIGMAP_HUD_COLORS.cream : BIGMAP_COLORS.text;
        }
        this.harvestButton.interactable = !data.ui.baseActionPending && data.canHarvest;
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

    /**
     * 队列行：左边槽位点表达状态，右边文字只写「几条在用 + 在建什么」。
     *
     * 槽位三态：未解锁（暗、满格）/ 建造中（亮、按 `progress` 填充）/ 空闲（中性、满格）。
     * 「待解锁 N 条」不再写进文字 —— 暗色槽位本身就说明还有几条能开。
     */
    private refreshQueue(data: IBigMapViewState): void {
        const queues = data.queues;
        const busy = queues.filter((queue) => queue.busy);
        const unlocked = queues.filter((queue) => !queue.locked).length;
        this.queueSlotList().forEach((node, index) => {
            const slot = node.getComponent(Sprite);
            const queue = queues[index];
            if (!queue || !slot) { node.active = false; return; }
            node.active = true;
            if (queue.locked) {
                slot.color = BIGMAP_HUD_COLORS.cardDeep;
                slot.fillRange = 1;
            } else if (queue.busy) {
                slot.color = BIGMAP_HUD_COLORS.cardLight;
                // 刚开工时 progress 是 0，留一点宽度否则整格看不见。
                slot.fillRange = Math.max(0.02, Math.min(1, queue.progress));
            } else {
                slot.color = BIGMAP_COLORS.muted;
                slot.fillRange = 1;
            }
        });
        const summary = `${busy.length}/${unlocked}`;
        this.queueLabel.string = busy.length > 0
            ? `${summary} · ${busy.map((queue) => `${queue.name} Lv.${queue.targetLevel} ${formatBigMapDuration(queue.remainSeconds)}`).join(' / ')}`
            : `${summary} · ${BIGMAP_PRESENTATION_TEXT.emptyQueue}`;
    }

    /**
     * 队列槽位节点。
     *
     * `@property` 是首选（Inspector 可换），但 **MCP 设不进数组**：`nodeArray` / 组件数组都试过，
     * 报 `Cannot read properties of undefined (reading 'hasOwnProperty')`。
     * 所以绑定为空时按固定子节点兜底 —— 这三个槽位是 `QueueStatus` 的固定孩子，不会增删。
     */
    private queueSlotList(): readonly Node[] {
        if (this.queueSlotNodes.length > 0) return this.queueSlotNodes;
        return ['QueueSlot0', 'QueueSlot1', 'QueueSlot2']
            .map((name) => this.queuePanel?.getChildByName(name) ?? null)
            .filter((node): node is Node => node !== null);
    }

}
