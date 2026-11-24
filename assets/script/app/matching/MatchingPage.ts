import { _decorator, Button, Component, Label, Layout, Node, UIOpacity } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { MatchPlayerItem } from './MatchPlayerItem';
import type { IIconLoader } from '../common/SpriteFrameCache';
import { matchRevealDelays } from './MatchReveal';
import { MATCH_TEXT, type MatchPhase, type MatchPlayerData } from './MatchTypes';
import type { IMatchingViewState } from './MatchingModel';
import { matchingTipOpacity, matchingTipOffsetY, matchingTipProgress, matchingWaveOffset } from './MatchingTimeline';
const { ccclass, property } = _decorator;
/**
 * 匹配页只渲染快照、驱动视觉时间轴；搜索及开战由外部控制器负责。
 *
 * 信息条按 `state.slots` 布局，已确认的对手资料来自 `state.opponents`。
 */
@ccclass('MatchingPage')
export class MatchingPage extends Component {
    @property({ type: Label, tooltip: 'StatusLabel：顶部状态标题' })
    statusLabel: Label = null!;

    @property({
        type: Node,
        tooltip: 'ItemList：展示席位的信息条容器（0 号是我方）',
    })
    itemList: Node = null!;

    @property({ type: Label, tooltip: 'TipText：提示条正文当前页，翻页时淡入淡出与垂直微浮动' })
    tipText: Label = null!;

    @property({ type: Node, tooltip: 'TipArrowL：提示条左箭头，点击切到上一条' })
    tipArrowL: Node = null!;

    @property({ type: Node, tooltip: 'TipArrowR：提示条右箭头，点击切到下一条' })
    tipArrowR: Node = null!;

    @property({ type: UIOpacity, tooltip: 'TipOpacity：提示条文本透明度组件，挂载于 TipText 节点' })
    tipOpacity: UIOpacity = null!;

    private phase: MatchPhase = 'searching';
    private opponents: readonly MatchPlayerData[] = [];
    private itemViews: MatchPlayerItem[] = [];
    private loadIcon: IIconLoader = null!;
    private tips: readonly string[] = [];
    private tipIndex = 0;
    private tipNextAt = 0;
    private tipTransition: { startedAt: number; direction: number; targetIndex: number; switched: boolean } | null = null;
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
    initialize(tips: readonly string[], loader: IIconLoader | { readonly load: IIconLoader }): void {
        this.tips = tips;
        this.loadIcon = typeof loader === 'function' ? loader : loader.load;
    }
    protected onLoad(): void {
        this.itemViews = this.itemList.children.map(node => node.getComponent(MatchPlayerItem));
        this.revealed = this.itemViews.map(() => false);
        this.itemViews.forEach((view, index) => {
            view.initialize(this.loadIcon);
            void view.applySlot(index);
        });
        this.tipArrowL.on(Button.EventType.CLICK, this.previousTip, this);
        this.tipArrowR.on(Button.EventType.CLICK, this.nextTip, this);
        this.tipOpacity = this.tipOpacity ?? this.tipText.getComponent(UIOpacity);
        this.tipText.node.active = this.tips.length > 0;
        this.tipArrowL.active = this.tipArrowR.active = this.tips.length > 1;
        this.tipText.string = this.tips[0] ?? '';
        this.waveNodes = this.statusLabel.node.children.map(node => ({ node, x: node.position.x, y: node.position.y }));
        this.waveStartedAt = Date.now() / 1000;
        this.tipNextAt = this.waveStartedAt + 3;
    }
    protected start(): void { EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'ready' }, this); }
    render(state: IMatchingViewState): void {
        this.phase = state.phase;
        this.opponents = state.opponents;
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
        if (this.phase === 'searching') {
            // 手写循环替代 forEach 箭头函数：改前每帧新建一个闭包，改后 update 零临时对象。
            const waves = this.waveNodes;
            for (let index = 0; index < waves.length; index += 1) {
                const wave = waves[index];
                wave.node.setPosition(wave.x, wave.y + matchingWaveOffset(now - this.waveStartedAt, index), 0);
            }
        }
        const transition = this.tipTransition;
        if (transition) {
            const progress = matchingTipProgress(now - transition.startedAt);
            if (progress >= 0.5 && !transition.switched) {
                this.tipIndex = transition.targetIndex;
                this.tipText.string = this.tips[this.tipIndex] ?? '';
                transition.switched = true;
            }
            this.tipOpacity.opacity = matchingTipOpacity(progress);
            this.tipText.node.setPosition(0, matchingTipOffsetY(progress, transition.direction), 0);
            if (progress === 1) {
                this.tipOpacity.opacity = 255;
                this.tipText.node.setPosition(0, 0, 0);
                this.tipTransition = null;
                this.tipNextAt = now + 3;
            }
        } else if (now >= this.tipNextAt && this.tips.length > 1) this.stepTip(1);
    }
    private readonly previousTip = (): void => this.stepTip(-1);
    private readonly nextTip = (): void => this.stepTip(1);
    private stepTip(step: number): void {
        if (this.tipTransition || this.tips.length < 2) return;
        const targetIndex = (this.tipIndex + step + this.tips.length) % this.tips.length;
        this.tipTransition = {
            startedAt: Date.now() / 1000,
            direction: step > 0 ? 1 : -1,
            targetIndex,
            switched: false,
        };
    }
    protected onDestroy(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, this);
        this.revealToken += 1;
        this.waveNodes = []; this.itemViews = []; this.tipTransition = null;
    }
    private layout(count: number): void {
        const visibleCount = Math.max(1, Math.min(this.itemViews.length, count));
        this.itemList.children.forEach((node, index) => {
            node.active = index < visibleCount;
        });
        // 设计稿两套行距：匹配成功 4 条=205+10、正在寻找 3 条=205+25；
        // 两种都是**整体居中**，容器固定在 y=42，不再按人数做旧的 y 补偿。
        const layout = this.itemList.getComponent(Layout);
        if (layout) layout.spacingY = visibleCount >= 4 ? 10 : 25;
        this.itemList.setPosition(0, 42, 0);
    }

}
