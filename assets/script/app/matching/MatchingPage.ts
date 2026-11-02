import { _decorator, Button, Component, instantiate, Label, Node, UITransform } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import type { MatchIconLoader } from './MatchIcons';
import { MatchPlayerItem } from './MatchPlayerItem';
import { MATCH_TEXT, type MatchPhase, type MatchPlayerData } from './MatchTypes';
import type { IMatchingViewState } from './MatchingModel';
import { matchingTipProgress, matchingWaveOffset } from './MatchingTimeline';
const { ccclass, property } = _decorator;
const ITEM_HEIGHT = 160;
const ITEM_GAP = 38;
const ITEMS_CENTER_Y = 37;
const MAX_PARTICIPANTS = 4;

/** 匹配页只渲染快照、驱动视觉时间轴；搜索及开战由外部控制器负责。 */
@ccclass('MatchingPage')
export class MatchingPage extends Component {
    @property({ type: Label, tooltip: 'StatusLabel：顶部状态标题' })
    statusLabel: Label = null!;

    @property({
        type: Node,
        tooltip: 'ItemList：信息条容器；子节点依次是各参与方（0 号 = 我方），数量 = 本局人数（2~4）',
    })
    itemList: Node = null!;

    @property({ type: Label, tooltip: 'TipText：提示条正文当前页，翻页时与备页一左一右滑动' })
    tipText: Label = null!;

    @property({ type: Node, tooltip: 'TipArrowL：提示条左箭头，点击切到上一条' })
    tipArrowL: Node = null!;

    @property({ type: Node, tooltip: 'TipArrowR：提示条右箭头，点击切到下一条' })
    tipArrowR: Node = null!;

    private phase: MatchPhase = 'searching';
    private opponents: readonly MatchPlayerData[] = [];
    private itemViews: MatchPlayerItem[] = [];
    private iconLoader: MatchIconLoader | null = null;
    private tips: readonly string[] = [];
    private tipIndex = 0;
    private tipSpareText: Label = null!;
    private tipPageWidth = 0;
    private tipNextAt = 0;
    private slide: { startedAt: number; side: number } | null = null;
    private waveStartedAt = 0;
    private waveNodes: { node: Node; x: number; y: number }[] = [];
    get currentPhase(): MatchPhase { return this.phase; }
    get matchedOpponents(): readonly MatchPlayerData[] { return this.opponents; }
    get tipCount(): number { return this.tips.length; }
    initialize(iconLoader: MatchIconLoader, tips: readonly string[]): void {
        this.iconLoader = iconLoader;
        this.tips = tips;
    }
    protected onLoad(): void {
        const iconLoader = this.iconLoader;
        if (!iconLoader) throw new Error('MatchingPage 缺少图标服务');
        this.itemViews = this.itemList.children.map(node => node.getComponent(MatchPlayerItem)).filter(view => view != null);
        if (this.itemViews.length < 2) throw new Error('MatchingPage 至少需要两条信息条');
        this.itemViews.forEach((view, index) => { view.setIconLoader(iconLoader); void view.applySlot(index); });
        this.tipArrowL.on(Button.EventType.CLICK, this.previousTip, this);
        this.tipArrowR.on(Button.EventType.CLICK, this.nextTip, this);
        this.tipPageWidth = this.tipText.node.getComponent(UITransform).width;
        const spare = instantiate(this.tipText.node);
        spare.name = 'TipTextSpare'; spare.active = false; spare.setParent(this.tipText.node.parent);
        this.tipSpareText = spare.getComponent(Label);
        this.tipText.node.active = this.tips.length > 0;
        this.tipArrowL.active = this.tipArrowR.active = this.tips.length > 1;
        this.tipText.string = this.tips[0] ?? '';
        this.waveNodes = this.statusLabel.node.children.map(node => ({ node, x: node.position.x, y: node.position.y }));
        this.waveStartedAt = Date.now() / 1000;
        this.tipNextAt = this.waveStartedAt + 3;
    }
    protected start(): void { EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'ready' }); }
    render(state: IMatchingViewState): void {
        this.phase = state.phase;
        this.opponents = state.opponents;
        this.layout(state.phase === 'searching' ? 2 : Math.min(MAX_PARTICIPANTS, state.opponents.length + 1));
        this.statusLabel.enabled = state.phase !== 'searching';
        this.statusLabel.string = MATCH_TEXT[state.phase];
        for (const wave of this.waveNodes) {
            wave.node.active = state.phase === 'searching';
            if (state.phase !== 'searching') wave.node.setPosition(wave.x, wave.y, 0);
        }
        void this.itemViews[0].refresh(state.mine);
        for (let i = 1; i < this.itemViews.length; i++) {
            const view = this.itemViews[i];
            view.setSearching(state.phase === 'searching');
            const opponent = state.phase === 'matched' ? state.opponents[i - 1] : null;
            if (opponent) void view.refresh(opponent); else view.clear();
        }
    }
    update(): void {
        const now = Date.now() / 1000;
        if (this.phase === 'searching') this.waveNodes.forEach((wave, index) => {
            wave.node.setPosition(wave.x, wave.y + matchingWaveOffset(now - this.waveStartedAt, index), 0);
        });
        const slide = this.slide;
        if (slide) {
            const progress = matchingTipProgress(now - slide.startedAt);
            this.tipText.node.setPosition(-slide.side * this.tipPageWidth * progress, 0, 0);
            this.tipSpareText.node.setPosition(slide.side * this.tipPageWidth * (1 - progress), 0, 0);
            if (progress === 1) {
                this.tipText.string = this.tipSpareText.string;
                this.tipText.node.setPosition(0, 0, 0);
                this.tipSpareText.node.active = false;
                this.slide = null;
                this.tipNextAt = now + 3;
            }
        } else if (now >= this.tipNextAt && this.tips.length > 1) this.stepTip(1);
    }
    private readonly previousTip = (): void => this.stepTip(-1);
    private readonly nextTip = (): void => this.stepTip(1);
    private stepTip(step: number): void {
        if (this.slide || this.tips.length < 2) return;
        this.tipIndex = (this.tipIndex + step + this.tips.length) % this.tips.length;
        this.slide = { startedAt: Date.now() / 1000, side: step > 0 ? 1 : -1 };
        this.tipSpareText.string = this.tips[this.tipIndex];
        this.tipSpareText.node.setPosition(this.slide.side * this.tipPageWidth, 0, 0);
        this.tipSpareText.node.active = true;
    }
    protected onDestroy(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { owner: this, phase: 'destroyed' });
        this.waveNodes = []; this.itemViews = []; this.slide = null; this.iconLoader = null;
    }
    private layout(count: number): void {
        const visibleCount = Math.max(1, Math.min(this.itemViews.length, count));
        const stride = ITEM_HEIGHT + ITEM_GAP;
        const span = visibleCount * ITEM_HEIGHT + (visibleCount - 1) * ITEM_GAP;
        this.itemList.children.forEach((node, index) => {
            const visible = index < visibleCount;
            node.active = visible;
            if (!visible) return;
            node.setPosition(0, ITEMS_CENTER_Y + span / 2 - ITEM_HEIGHT / 2 - index * stride, 0);
        });
    }

}
