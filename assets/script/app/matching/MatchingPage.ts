import { _decorator, Button, Component, instantiate, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import type { MatchIconLoader } from './MatchIcons';
import { MatchPlayerItem } from './MatchPlayerItem';
import { MATCH_TEXT } from './MatchTypes';
import type { MatchPhase, MatchPlayerData } from './MatchTypes';

const { ccclass, property } = _decorator;

/** 流程注入的匹配数据与完成通知。 */
export interface IMatchingPageOptions {
    mine: MatchPlayerData;
    iconLoader: MatchIconLoader;
    tips: readonly string[];
    /** 搜索阶段的参与人数（含我方），默认 2；成功后按实际对手数排布。 */
    participantCount?: number;
    /** 按显示顺序返回本局对手。 */
    pickOpponents: () => readonly MatchPlayerData[];
    /** 等待服务端就绪；失败返回 false，期间保持搜索状态。 */
    awaitReady?: () => Promise<boolean>;
    /** 最短搜索展示时长（秒），默认 3。 */
    searchSeconds?: number;
    onMatched: (opponents: readonly MatchPlayerData[]) => void;
}

const DEFAULT_SEARCH_SECONDS = 3.0;

const MATCH_HOLD_SECONDS = 1.4;

const ITEM_HEIGHT = 160;
const ITEM_GAP = 38;

/** 设计稿四条信息条的中心 y；人数变化时保持整组居中。 */
const ITEMS_CENTER_Y = 37;

const MAX_PARTICIPANTS = 4;

const TIP_AUTO_SECONDS = 3;

const TIP_SLIDE_SECONDS = 0.3;

const TIP_STEP_PREV = -1;
const TIP_STEP_NEXT = 1;

/** 匹配页：展示 2~4 方信息、搜索动画和循环提示；流程负责开战。 */
@ccclass('MatchingPage')
export class MatchingPage extends Component {
    @property({ type: Label, tooltip: 'StatusLabel：顶部状态标题' })
    statusLabel: Label = null;

    @property({
        type: Node,
        tooltip: 'ItemList：信息条容器；子节点依次是各参与方（0 号 = 我方），数量 = 本局人数（2~4）',
    })
    itemList: Node = null;

    @property({ type: Label, tooltip: 'TipText：提示条正文当前页，翻页时与备页一左一右滑动' })
    tipText: Label = null;

    @property({ type: Node, tooltip: 'TipArrowL：提示条左箭头，点击切到上一条' })
    tipArrowL: Node = null;

    @property({ type: Node, tooltip: 'TipArrowR：提示条右箭头，点击切到下一条' })
    tipArrowR: Node = null;

    private phase: MatchPhase = 'searching';

    private searchElapsed = 0;

    private searchSeconds = DEFAULT_SEARCH_SECONDS;

    private options: IMatchingPageOptions | null = null;

    private opponents: readonly MatchPlayerData[] = [];

    private itemViews: MatchPlayerItem[] = [];

    /** 等待回包期间仍处于 searching，避免重复选人和排入场回调。 */
    private isFinishing = false;

    private matchCallback: (() => void) | null = null;

    private tips: readonly string[] = [];

    private tipIndex = 0;

    private tipAutoElapsed = 0;

    /** 复用备页；提示文本需固定宽度并使用 CLAMP，保证翻页衔接。 */
    private tipSpareText: Label = null;

    private tipPageWidth = 0;

    private isTipSliding = false;

    private waveNodes: Node[] = [];

    get currentPhase(): MatchPhase {
        return this.phase;
    }

    get matchedOpponents(): readonly MatchPlayerData[] {
        return this.opponents;
    }

    get tipCount(): number {
        return this.tips.length;
    }

    /** 箭头监听随节点销毁释放，不在销毁期访问事件 API。 */
    protected onLoad(): void {
        this.ensureItems();
        this.bindTipArrow(this.tipArrowL, TIP_STEP_PREV);
        this.bindTipArrow(this.tipArrowR, TIP_STEP_NEXT);
        this.tipPageWidth = this.tipText.node.getComponent(UITransform).width;
        this.createTipSpare();
    }

    private ensureItems(): void {
        this.itemViews = this.itemList.children
            .map((node) => node.getComponent(MatchPlayerItem))
            .filter((view): view is MatchPlayerItem => view != null);
    }

    /** 由流程启动；避免使用引擎生命周期方法名 start。 */
    beginMatch(options: IMatchingPageOptions): void {
        this.cancelMatchCallback();
        this.options = options;
        this.searchSeconds = Math.max(0, options.searchSeconds ?? DEFAULT_SEARCH_SECONDS);
        this.searchElapsed = 0;
        this.opponents = [];
        this.isFinishing = false;
        this.applyTips(options.tips);

        this.ensureItems();
        if (!this.itemViews.length) {
            console.error('[MatchingPage] ItemList 下没有信息条实例，匹配界面无法渲染');
            return;
        }
        const participants = Math.max(2, Math.min(MAX_PARTICIPANTS, Math.floor(options.participantCount ?? 2)));
        const slots = participants - 1;
        this.layout(participants);
        this.itemViews.forEach((view, index) => {
            view.setIconLoader(options.iconLoader);
            void view.applySlot(index);
        });
        this.setPhase('searching');
        void this.itemViews[0].refresh(options.mine);
        for (let i = 1; i <= slots; i++) this.itemViews[i].clear();
    }

    updateMine(data: MatchPlayerData): void {
        void this.itemViews[0].refresh(data);
    }

    update(deltaTime: number): void {
        this.advanceTipAutoPlay(deltaTime);
        if (this.phase !== 'searching' || !this.options) return;
        this.searchElapsed += deltaTime;
        if (this.searchElapsed >= this.searchSeconds) this.finishSearch();
    }

    private finishSearch(): void {
        const options = this.options;
        if (!options || this.isFinishing) return;
        this.isFinishing = true;
        void this.settleOpponent(options);
    }

    private async settleOpponent(options: IMatchingPageOptions): Promise<void> {
        if (options.awaitReady) {
            try {
                if (!await options.awaitReady()) return;
            } catch (error) {
                console.warn('[MatchingPage] 开战准备失败，停止匹配', error);
                return;
            }
            // 等待期间可能已退出或开始新一轮匹配。
            if (!this.isValid || this.options !== options) return;
        }
        const opponents = options.pickOpponents();
        this.opponents = opponents;
        // 按实际回包人数重排，避免保留空槽。
        this.layout(Math.min(MAX_PARTICIPANTS, opponents.length + 1));
        for (let i = 0; i < opponents.length && i + 1 < this.itemViews.length; i++) {
            void this.itemViews[i + 1].refresh(opponents[i]);
        }
        this.setPhase('matched');
        this.matchCallback = () => {
            this.matchCallback = null;
            options.onMatched(opponents);
        };
        this.scheduleOnce(this.matchCallback, MATCH_HOLD_SECONDS);
    }

    private cancelMatchCallback(): void {
        if (this.matchCallback) this.unschedule(this.matchCallback);
        this.matchCallback = null;
    }

    private setPhase(phase: MatchPhase): void {
        this.phase = phase;
        if (phase === 'searching') {
            this.startWaveText();
        } else {
            this.stopWaveText();
            this.statusLabel.string = MATCH_TEXT[phase];
        }
        for (let i = 1; i < this.itemViews.length; i++) {
            this.itemViews[i].setSearching(phase === 'searching');
        }
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

    /** 复用 prefab 字节点，只控制动画与显隐。 */
    private startWaveText(): void {
        this.stopWaveText();
        this.statusLabel.enabled = false;
        const nodes = this.statusLabel.node.children;
        const amplitude = 6;
        const waveSeconds = 0.9;
        nodes.forEach((n, i) => {
            n.active = true;
            const baseY = n.position.y;
            const delay = i * 0.07;
            const upY = baseY + amplitude;
            tween(n)
                .sequence(
                    tween(n).to(waveSeconds / 2 + delay, { position: new Vec3(n.position.x, upY, 0) }, { easing: 'sineOut' }),
                    tween(n).to(waveSeconds / 2, { position: new Vec3(n.position.x, baseY, 0) }, { easing: 'sineInOut' }),
                )
                .repeatForever()
                .start();
        });
        this.waveNodes = nodes;
    }

    private stopWaveText(): void {
        for (const n of this.waveNodes) n.active = false;
        this.stopWaveAnimations();
        this.statusLabel.enabled = true;
    }

    private stopWaveAnimations(): void {
        for (const n of this.waveNodes) {
            Tween.stopAllByTarget(n);
        }
        this.waveNodes = [];
    }

    protected onDestroy(): void {
        this.cancelMatchCallback();
        this.options = null;
        // 父节点 onDestroy 时子节点已被销毁，不能再访问 Label.enabled 或节点显隐。
        this.stopWaveAnimations();
    }

    private createTipSpare(): void {
        const spare = instantiate(this.tipText.node);
        spare.name = 'TipTextSpare';
        spare.active = false;
        spare.setParent(this.tipText.node.parent);
        this.tipSpareText = spare.getComponent(Label);
    }

    private applyTips(tips: readonly string[]): void {
        this.tips = tips;
        const total = this.tips.length;
        const switchable = total > 1;
        this.tipText.node.active = total > 0;
        this.tipArrowL.active = switchable;
        this.tipArrowR.active = switchable;
        this.tipIndex = 0;
        this.tipAutoElapsed = 0;
        this.isTipSliding = false;
        if (total > 0) this.showTip(this.tipIndex);
    }

    private advanceTipAutoPlay(deltaTime: number): void {
        if (this.tips.length <= 1) return;
        if (this.isTipSliding) {
            this.tipAutoElapsed = 0;
            return;
        }
        this.tipAutoElapsed += deltaTime;
        if (this.tipAutoElapsed < TIP_AUTO_SECONDS) return;
        this.tipAutoElapsed = 0;
        this.showTip(this.tipIndex + TIP_STEP_NEXT, TIP_STEP_NEXT);
    }

    /** 按压缩放由 Button 处理，保留右箭头的镜像缩放。 */
    private bindTipArrow(arrow: Node, step: number): void {
        arrow.on(Button.EventType.CLICK, () => this.stepTip(step));
    }

    private stepTip(step: number): void {
        this.showTip(this.tipIndex + step, step);
        this.tipAutoElapsed = 0;
    }

    /** step 为 0 时直接显示，正负值控制滑动方向；滑动中忽略新请求。 */
    private showTip(index: number, step = 0): void {
        const total = this.tips.length;
        if (!total) return;
        const next = ((index % total) + total) % total;

        if (step === 0) {
            this.tipIndex = next;
            this.tipText.string = this.tips[next];
            this.tipText.node.setPosition(0, 0, 0);
            return;
        }

        if (this.isTipSliding) return;

        const side = step > 0 ? 1 : -1;
        const distance = this.tipPageWidth;
        const outgoing = this.tipText;
        const incoming = this.tipSpareText;

        this.tipIndex = next;
        this.isTipSliding = true;

        incoming.string = this.tips[next];
        incoming.node.setPosition(side * distance, 0, 0);
        incoming.node.active = true;

        tween(outgoing.node)
            .to(TIP_SLIDE_SECONDS, { position: new Vec3(-side * distance, 0, 0) }, { easing: 'quadInOut' })
            .start();
        tween(incoming.node)
            .to(TIP_SLIDE_SECONDS, { position: new Vec3(0, 0, 0) }, { easing: 'quadInOut' })
            .call(() => {
                // 并回正页，复位备页供下次翻页。
                outgoing.string = incoming.string;
                outgoing.node.setPosition(0, 0, 0);
                incoming.node.setPosition(0, 0, 0);
                incoming.node.active = false;
                this.isTipSliding = false;
            })
            .start();
    }
}
