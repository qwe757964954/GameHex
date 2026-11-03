import { _decorator, Button, Component, instantiate, Label, Node, UITransform } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import type { MatchIconLoader } from './MatchIcons';
import { MatchPlayerItem } from './MatchPlayerItem';
import { matchRevealDelays } from './MatchReveal';
import { MATCH_TEXT, type MatchPhase, type MatchPlayerData } from './MatchTypes';
import type { IMatchingViewState } from './MatchingModel';
import { matchingTipProgress, matchingWaveOffset } from './MatchingTimeline';
const { ccclass, property } = _decorator;
const ITEM_HEIGHT = 160;
const ITEM_GAP = 38;
const ITEMS_CENTER_Y = 37;

/**
 * 匹配页只渲染快照、驱动视觉时间轴；搜索及开战由外部控制器负责。
 *
 * ⚠️ **这里不许有"本局几个人"的常量**：条数由 `state.slots` 给（实际参与人数 2/3/4，
 * 口径在 `MatchSlots`）。历史上写死过 2、后来又写死过 4，两次都被实机打回。
 */
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
    /**
     * 逐条揭示的**版本号**：每次重新排揭示计划就 +1，旧的 `scheduleOnce` 回来时对不上就作废。
     *
     * 页面会在"回包""PVP 资料回来"这些时机被 `render` 好几次，已经揭示过的那几条要
     * **原地刷新**（不能重播动画，否则每来一次数据整列就抖一遍）。
     */
    private revealToken = 0;
    /** 每个信息条是否已经揭示出数据（index 0 = 我方，恒为 `true`）。 */
    private revealed: boolean[] = [];
    /** 这次排计划时一共有几个对手（回包后席位变多时用来发现"多出来的那几条"）。 */
    private revealSlots = 0;
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
        this.revealed = this.itemViews.map(() => false);
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
        // 🔴 条数 = 本局**实际参与人数**（`state.slots`，2 / 3 / 4），视图不自己定：
        //    这里原来写死过 2，后来又写死过 4，两次都不对 —— 人数是服务端/入口给的，
        //    页面只负责按它排（口径见 `MatchSlots`）。`layout` 内部再夹一次 itemViews 上限。
        this.layout(state.slots);
        this.statusLabel.enabled = state.phase !== 'searching';
        this.statusLabel.string = MATCH_TEXT[state.phase];
        for (const wave of this.waveNodes) {
            wave.node.active = state.phase === 'searching';
            if (state.phase !== 'searching') wave.node.setPosition(wave.x, wave.y, 0);
        }
        void this.itemViews[0].refresh(state.mine);
        if (state.phase !== 'matched') {
            // 回到搜索态：撤销还没揭示的那几条，全部回到"放大镜"。
            this.revealToken += 1;
            this.revealed = this.itemViews.map(() => false);
            for (let i = 1; i < this.itemViews.length; i++) {
                this.itemViews[i].setSearching(true);
                this.itemViews[i].clear();
            }
            return;
        }
        // 已经排过揭示计划 ⇒ 这次只是数据刷新（PVP 资料 / 头像迟到的那些）：
        // 已揭示的条目原地换内容，没揭示的继续等自己那一拍，**不重播**动画。
        if (this.revealed.some(Boolean)) {
            for (let i = 1; i < this.itemViews.length; i++) {
                const data = this.opponents[i - 1];
                if (!data) { this.itemViews[i].setSearching(true); continue; }
                // 兜底：第一次排计划时还没有这条，现在回包补齐了 —— 立刻揭示（否则永远卡在放大镜）。
                if (i > this.revealSlots) { this.revealSlot(i); continue; }
                if (!this.revealed[i]) { this.itemViews[i].setSearching(true); continue; }
                void this.itemViews[i].refresh(data);
            }
            return;
        }
        this.scheduleReveals();
    }

    /**
     * 逐条揭示：第一个对手和"匹配成功"同帧，之后每条隔一个随机 `[0.15, 0.5]` 秒出现。
     *
     * 节奏口径全在 `MatchReveal`（含"总时长必须装得下停留时间"的验算），这里只负责排定时器。
     * 还没轮到的条目**保持"匹配中"的放大镜**，所以观感是"一条条加载好"，而不是"整列空着等"。
     */
    private scheduleReveals(): void {
        const token = ++this.revealToken;
        this.revealed = this.itemViews.map(() => false);
        this.revealed[0] = true;
        this.revealSlots = this.opponents.length;
        const delays = matchRevealDelays(this.opponents.length);
        delays.forEach((delay, index) => {
            const slot = index + 1;
            const reveal = (): void => {
                if (token !== this.revealToken) return;
                this.revealSlot(slot);
            };
            if (delay <= 0) reveal();
            else this.scheduleOnce(reveal, delay);
        });
    }

    /** 揭示第 `slot` 条（0 = 我方）：从"匹配中"切到数据态，并弹一下。 */
    private revealSlot(slot: number): void {
        const view = this.itemViews[slot];
        const data = this.opponents[slot - 1];
        if (!view || !data) return;
        this.revealed[slot] = true;
        view.setSearching(false);
        void view.refresh(data);
        view.popIn();
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
        this.revealToken += 1;
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
