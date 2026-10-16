import { _decorator, Button, Component, instantiate, Label, Node, Tween, tween, UITransform, Vec3 } from 'cc';
import type { MatchIconLoader } from './MatchIcons';
import { MatchPlayerItem } from './MatchPlayerItem';
import { MATCH_TEXT, MatchPhase, MatchPlayerData } from './MatchTypes';

const { ccclass, property } = _decorator;

/** 由流程注入的匹配参数与回调。 */
export interface MatchingPageOptions {
    /** 本方玩家数据。 */
    mine: MatchPlayerData;
    /** 由匹配流程创建、受本次资源作用域管理的图标加载器。 */
    iconLoader: MatchIconLoader;
    /** 流程预加载完成的提示文案。 */
    tips: readonly string[];
    /**
     * 参与方数量（含我方），2~4。默认 2（1v1）。
     *
     *  必须由流程给：本局人数是「开始游戏」请求时就定下来的，界面自己猜不出来。
     *  只影响**搜索态**铺几个空对手槽；匹配成功后按 `pickOpponents()` 的实际长度重排。
     */
    participantCount?: number;
    /**
     * 选人函数：搜索时长到达后调用一次，返回本局全部对手（1~3 名）。
     *
     *  返回**数组**而不是单个对手：本局可能是 2/3/4 人局，界面按数组长度铺信息条。
     *  顺序即展示顺序（从上到下），与配色槽位一一对应。
     */
    pickOpponents: () => readonly MatchPlayerData[];
    /**
     * 可选：搜索时长到达后、`pickOpponents()` 之前先等这个 Promise。
     *
     *  给「服务端正在下发本局数据」留窗口用（`BattleStartService.startBattle`）——
     *  不提供时行为与以前**逐位一致**：到点直接选人。
     *
     *  为什么不能让 `pickOpponents` 自己变成 async：它的契约是同步返回对手，
     *  改成 async 会把 `finishSearch` 变成"半个状态机"，而这里只需要在选人前插一次等待。
     *  等待期间界面**保持 searching**（放大镜继续转），不会露出"卡住"的空档。
     */
    awaitReady?: () => Promise<void>;
    /** 匹配时长（秒），到点后判定成功。默认 2.2 秒，与真实匹配的等待感对齐。 */
    searchSeconds?: number;
    /** 匹配成功回调（流程在此切到对局）；参数是本局全部对手。 */
    onMatched: (opponents: readonly MatchPlayerData[]) => void;
}

/** 默认匹配时长（秒）。 */
const DEFAULT_SEARCH_SECONDS = 3.0;

/** 「匹配成功！」展示时长（秒），之后交给流程进对局。 */
const MATCH_HOLD_SECONDS = 1.4;

/**
 * 信息条几何（设计单位，来自蓝湖「战斗匹配(1)」720×1610 设计稿）：
 * 条 630×160、条间距 38（相邻条中心距 198）。
 */
const ITEM_HEIGHT = 160;
const ITEM_GAP = 38;

/**
 * 信息条整组的竖向中心（Cocos 局部 y）。
 * 设计稿 4 条占设计 y 391~1145（中心 768），换算 `805 − 768 = 37`。
 * 人数不足 4 时**以同一中心**整体收拢，这样 1v1 也不会贴在屏幕顶上。
 */
const ITEMS_CENTER_Y = 37;

/** 最多参与的方数（我方 1 + 对手 3）：对应 prefab 里 ItemList 下的 4 个槽位。 */
const MAX_PARTICIPANTS = 4;

/**
 * 提示条无人操作时的自动轮播间隔（秒）。
 * 手动点一次箭头就重新计时 —— 刚翻出来的那条至少要停留这么久，不会被自动轮播立刻顶走。
 */
const TIP_AUTO_SECONDS = 3;

/** 一次翻页的滑动时长（秒）——与 ScrollView 的 `pageTurningSpeed`（0.3）手感对齐。 */
const TIP_SLIDE_SECONDS = 0.3;

/** 左箭头步进 -1、右箭头 +1（下标取模在 `showTip` 里做，两个方向都能回环）。 */
const TIP_STEP_PREV = -1;
const TIP_STEP_NEXT = 1;

/**
 * 战斗匹配界面（挂在 MatchingRoot.prefab 上，由 ProcedureMatching 驱动）。
 *
 * **支持 2~4 人局**：`ItemList` 下挂了 4 个信息条实例（`MatchPlayerItem`），
 * 按本局实际人数显示前 N 个、并**整体居中**排布（`layout()`）；配色由各条自己的
 * `applySlot(index)` 决定（0 = 我方蓝，1~3 = 对手红 / 紫 / 黄）。
 * 人数从 `participantCount` 进来，界面自己不猜。
 *
 * 两个状态（对应蓝湖「战斗匹配（2）」/「战斗匹配(1)」两张设计稿）：
 *   searching  标题「正在寻找对手中...」；对手条只留底条 + 放大镜，其余内容隐藏
 *   matched    标题「匹配成功！」；对手条展开，填入选中的对手数据
 *
 * 放大镜的绕圈动画由 `MatchPlayerItem` 自己驱动（`setSearching` + 它自己的 `update`），
 * **这里不要再叠缩放/位移** —— 两套动画同时改同一个节点的 transform 会互相覆盖。
 *
 * 底部「提示」条有左右两个箭头（节点上各挂一个 `cc.Button`），点击在提示列表里循环切换正文；
 * 没人点的时候按 `TIP_AUTO_SECONDS` 自动往后翻。文案来自配置表
 * （`MatchTipsConfig`，源表 `doc/塔防数据配置/P-匹配提示.xlsx`），表为空则整条提示区隐藏。
 *
 * 切换是**横向滑动翻页**（ScrollView 式手感，不是文字瞬间替换）：正文页与一张常驻「备页」
 * 在裁剪视窗里同步滑动，一页滑出一页滑入。prefab 结构：
 *
 *     TipView            ← 挂 cc.Mask，400×48，正文的裁剪视窗
 *       TipText          ← cc.Label，overflow = CLAMP，400×48，**固定宽度**即一页
 *
 * 视窗节点**没有做成 `@property`**：它是 `TipText` 的父节点，`onLoad` 里直接取
 * （结构关系，不是按节点名查找 —— 改名、换位置都不受影响）。
 *  `TipText` 的 `overflow` 必须是 **CLAMP**、宽度必须是**固定值**：
 * 若为 NONE（按文本自适应），两张页的宽度会随各自文案长度不同，滑动时中间会裂开一道空档，
 * 「一页出一页进」就断了。
 *
 *  这里**刻意没用 `cc.PageView`**：它的 `scrollToPage` 对越界下标直接 return
 * （`if (idx < 0 || idx >= this._pages.length) return;`），做不了「最后一条 → 第一条」的无缝回环，
 * 而这正是本提示条要的循环轮播（见 `showTip` 的取模）。自己滑两张页反而没这个限制。
 *
 *  箭头**不要自己改 scale** 来做按压反馈：`TipArrowR` 是 `TipArrowL` 的水平镜像
 * （节点 `_lscale.x = -1`），写死 `setScale(1,1,1)` 会把镜像抹平 —— 表现为「右箭头点一下就朝反了」。
 * 反馈交给 Button 的 SCALE 过渡（prefab 里配 `zoomScale 0.86` / `duration 0.08`），
 * 它缓存的 `_originalScale` 是**带符号**的，松手还原时能保住镜像。
 *
 * 界面**没有取消按钮** —— 匹配必然在 `searchSeconds` 内出结果，不需要中途退出。
 * 本组件也不承担中止职责：将来要接系统返回键，由流程自己 `changeProcedure`。
 *
 * 匹配对手由流程提供的 `pickOpponents()` 给出（`ProcedureMatching` 里现在是「服务端
 * `CmdStartBattleRspMsg` 的对手单元 → 拿不到则报错不进对局」）。
 * 本组件不关心对手从哪来，也不知道服务端协议 —— 换数据源**不需要动这里**。
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

    /** 当前状态。 */
    private phase: MatchPhase = 'searching';

    /** 已累计的搜索时长（秒）。 */
    private elapsed = 0;

    /** 本次匹配的目标时长（秒）。 */
    private searchSeconds = DEFAULT_SEARCH_SECONDS;

    /** 回调集合（由流程注入）。 */
    private options: MatchingPageOptions | null = null;

    /** 本局对手（匹配成功后有值，顺序 = 信息条顺序）。 */
    private opponents: readonly MatchPlayerData[] = [];

    /** 信息条视图缓存（`itemList` 的子节点，顺序 = 参与方顺序；0 号是我方）。 */
    private itemViews: MatchPlayerItem[] = [];

    /**
     * 是否已经进入「选人 → 展示匹配成功」这一段。
     *
     * `finishSearch` 里有 `await`，等待期间 `phase` **仍是 searching**，
     * 于是 `update()` 每帧还会再调用一次 —— 没有这个守卫就会重复选人、重复排 `onMatched`。
     * `beginMatch` 里重置。
     */
    private finishing = false;

    /** 提示条文案（来自配置表，按 order 升序）。 */
    private tips: readonly string[] = [];

    /** 底部提示条当前展示的下标。 */
    private tipIndex = 0;

    /** 自动轮播的计时器（秒），到 `TIP_AUTO_SECONDS` 就翻一条并清零。 */
    private tipAutoElapsed = 0;

    /** 正文的裁剪视窗（=`TipText` 的父节点，挂 `cc.Mask`），备页也挂到它下面。 */
    private tipView: Node = null!;

    /** 备页：常驻的正文副本，翻页时从另一侧滑入（默认不激活）。 */
    private tipSpareText: Label = null!;

    /** 一页的宽度 = 正文页的宽度 = 一次翻页要滑动的距离。 */
    private tipPageWidth = 0;

    /** 是否正在滑动翻页 —— 滑动期间忽略新的切换请求，免得两段补间抢同一个节点。 */
    private tipSliding = false;

    /** searching 阶段被拆成单字做波浪浮动的字节点（切走时销毁）。 */
    private waveChars: Node[] = [];

    get currentPhase(): MatchPhase {
        return this.phase;
    }

    /** 本局对手（匹配成功前是空数组）。 */
    get matchedOpponents(): readonly MatchPlayerData[] {
        return this.opponents;
    }

    /** 当前提示条文案条数（配置为空时为 0，此时提示区整体隐藏）。 */
    get tipCount(): number {
        return this.tips.length;
    }

    /**
     * 常驻初始化：绑定箭头触摸并创建复用备页。
     *
     * 箭头从打开到销毁都不会换，所以**只绑一次、不写 onDisable/off** ——
     * 节点销毁时引擎会一并回收这些监听，在销毁期访问事件 API 反而会空指针。
     */
    protected onLoad(): void {
        this.ensureItems();
        this.bindTipArrow(this.tipArrowL, TIP_STEP_PREV);
        this.bindTipArrow(this.tipArrowR, TIP_STEP_NEXT);
        this.tipView = this.tipText.node.parent!;
        this.tipPageWidth = this.tipText.node.getComponent(UITransform)!.width;
        this.createTipSpare();
    }

    /** 缓存信息条视图：`itemList` 的子节点，顺序即参与方顺序（0 号是我方）。 */
    private ensureItems(): void {
        this.itemViews = this.itemList.children
            .map((node) => node.getComponent(MatchPlayerItem))
            .filter((view): view is MatchPlayerItem => view != null);
    }

    /**
     * 由流程调用：填入本方数据并开始寻找对手。
     *
     *  方法名**不能**叫 `start` —— Cocos 组件的生命周期回调正是 `start()`，
     * 引擎在组件首次激活时会用无参调用覆盖掉外部传入的参数
     * （实测：`options` 被清成 undefined，匹配永远卡在 searching）。
     *
     *  信息条数量 = `participantCount`（本局人数，2~4）。本组件**不猜人数**：
     *  它是「开始游戏」请求时就定下来的，只有流程知道。
     */
    beginMatch(options: MatchingPageOptions): void {
        this.options = options;
        this.searchSeconds = Math.max(0, options.searchSeconds ?? DEFAULT_SEARCH_SECONDS);
        this.elapsed = 0;
        this.opponents = [];
        this.finishing = false;
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

    /**
     * 搜索过程中刷新**我方**信息条。
     *
     *  为什么需要它：`beginMatch` 时手上只有本地资料（`MatchServerProfile.buildSelfPlayerData()`），
     *  自己那份**服务端个人信息参数**（昵称 / 战力 / 段位 / 段位积分 / 神器）要等
     *  `CmdStartBattleRspMsg` 回来才知道 —— 而那条请求在搜索期间就在途，通常几百毫秒就到。
     *  流程拿到回包后调这里，界面**不需要等到匹配成功**就能显示自己的真实数据。
     *
     *  与 `matched` 阶段的关系：两者写作同一份数据源（服务端下发的我方单元），
     *  所以这里不做阶段判断 —— 先到先显示，晚到也不会覆盖成别的口径。
     */
    updateMine(data: MatchPlayerData): void {
        void this.itemViews[0].refresh(data);
    }

    update(deltaTime: number): void {
        this.advanceTipAutoPlay(deltaTime);
        if (this.phase !== 'searching' || !this.options) return;
        this.elapsed += deltaTime;
        if (this.elapsed >= this.searchSeconds) this.finishSearch();
    }

    /**
     * 搜索到目标时长：等可选的在途数据 → 选人 → 切到「匹配成功」，展示一小段时间后回调流程。
     *
     *  `finishing` 保证整段只进一次（`update()` 会每帧调到这里，而等待期间 `phase` 还是 searching）。
     */
    private finishSearch(): void {
        const options = this.options;
        if (!options || this.finishing) return;
        this.finishing = true;
        void this.settleOpponent(options);
    }

    private async settleOpponent(options: MatchingPageOptions): Promise<void> {
        if (options.awaitReady) {
            try {
                await options.awaitReady();
            } catch (error) {
                // 等不到就按"立刻选人"处理 —— 匹配本身不允许失败（界面没有取消入口）。
                console.warn('[MatchingPage] 等待在途数据失败，直接选人', error);
            }
            //  等的过程里流程可能已经切走（本组件被销毁），此时再动界面/回调会写到废弃对象上。
            if (!this.isValid || this.options !== options) return;
        }
        const opponents = options.pickOpponents();
        this.opponents = opponents;
        //  人数以**实际选到的对手数**为准：搜索态按 participantCount 铺的槽位可能不一样
        //  （例如声明 4 人却只匹配到 1 个对手），这里重排一次，避免留着空槽。
        this.layout(Math.min(MAX_PARTICIPANTS, opponents.length + 1));
        for (let i = 0; i < opponents.length && i + 1 < this.itemViews.length; i++) {
            void this.itemViews[i + 1].refresh(opponents[i]);
        }
        this.setPhase('matched');
        this.scheduleOnce(() => options.onMatched(opponents), MATCH_HOLD_SECONDS);
    }

    private setPhase(phase: MatchPhase): void {
        this.phase = phase;
        if (phase === 'searching') {
            this.startWaveText(MATCH_TEXT[phase]);
        } else {
            this.stopWaveText();
            this.statusLabel.string = MATCH_TEXT[phase];
        }
        //  对手槽位（1 号起）：搜索中只留底条 + 放大镜，匹配成功后整体换成对手数据。
        for (let i = 1; i < this.itemViews.length; i++) {
            this.itemViews[i].setSearching(phase === 'searching');
        }
    }

    /**
     * 排布信息条：`count` 条**整体居中**于设计稿 4 条所占的区间，多余的槽位隐藏。
     *
     *  设计稿（720×1610）里 4 条占设计 y 391~1145、条高 160、间距 38；
     *  人数不足 4 时保持**同一中心**收拢 —— 1v1 只有两条也不会贴在屏幕顶上。
     *  位置必须在每次人数变化后重算，因为人数是运行时（`beginMatch` / 选人回包）才知道的。
     */
    private layout(count: number): void {
        const shown = Math.max(1, Math.min(this.itemViews.length, count));
        const stride = ITEM_HEIGHT + ITEM_GAP;
        const span = shown * ITEM_HEIGHT + (shown - 1) * ITEM_GAP;
        this.itemList.children.forEach((node, index) => {
            const visible = index < shown;
            node.active = visible;
            if (!visible) return;
            node.setPosition(0, ITEMS_CENTER_Y + span / 2 - ITEM_HEIGHT / 2 - index * stride, 0);
        });
    }

    /**
     * searching 阶段把状态标题拆成单字节点，逐字上下浮动错开相位，形成波浪。
     * 原 Label 隐藏，字节点挂到同一父节点、水平居中排列；matched 时整体销毁还原。
     */
    /**
     * searching 阶段启用预建在 StatusLabel 下的 wave_0..9 字节点，逐字上下浮动错开相位。
     * 字节点在 prefab 里排好、样式和 StatusLabel 一致，这里只做动画、不动态创建。
     */
    private startWaveText(_text: string): void {
        this.stopWaveText();
        this.statusLabel.enabled = false;
        const nodes = this.statusLabel.node.children;
        const amp = 6;
        const period = 0.9;
        nodes.forEach((n, i) => {
            n.active = true;
            const baseY = n.position.y;
            const delay = i * 0.07;
            const upY = baseY + amp;
            tween(n)
                .sequence(
                    tween(n).to(period / 2 + delay, { position: new Vec3(n.position.x, upY, 0) }, { easing: 'sineOut' }),
                    tween(n).to(period / 2, { position: new Vec3(n.position.x, baseY, 0) }, { easing: 'sineInOut' }),
                )
                .repeatForever()
                .start();
        });
        this.waveChars = nodes;
    }

    /** 停掉字节点 tween、隐藏字节点、恢复原 Label。 */
    private stopWaveText(): void {
        for (const n of this.waveChars) {
            Tween.stopAllByTarget(n);
            n.active = false;
        }
        this.waveChars = [];
        this.statusLabel.enabled = true;
    }

    protected onDestroy(): void {
        this.stopWaveText();
    }

    /**
     * 造一张「备页」—— 翻页时新文案从另一侧滑进来，滑到位后再把文案并回正页。
     *
     * 常驻一张备页而不是每次翻页 `instantiate`：整局只造一次，翻页过程零分配。
     * 备页默认 `active = false`，不参与渲染，也不影响首次上屏。
     */
    private createTipSpare(): void {
        const spare = instantiate(this.tipText.node);
        spare.name = 'TipTextSpare';
        spare.active = false;
        spare.setParent(this.tipView);
        this.tipSpareText = spare.getComponent(Label)!;
    }

    /**
     * 拉取提示文案并上屏。
     *
     * 配置为空时把「正文页 + 两个箭头」整组隐藏 —— 空着一格比留白更像 bug；
     * 只有一条时不显示箭头：没有可切换的内容，箭头本身就是误导。
     */
    private applyTips(tips: readonly string[]): void {
        this.tips = tips;
        const total = this.tips.length;
        const switchable = total > 1;
        this.tipText.node.active = total > 0;
        this.tipArrowL.active = switchable;
        this.tipArrowR.active = switchable;
        this.tipIndex = 0;
        this.tipAutoElapsed = 0;
        this.tipSliding = false;
        if (total > 0) this.showTip(this.tipIndex);
    }

    /**
     * 自动轮播：没人点箭头时，每 `TIP_AUTO_SECONDS` 秒往后翻一条。
     *
     * 计时放在 `update` 里累加，而不是 `schedule` —— 手动点击只需把 `tipAutoElapsed` 清零即可
     * 重新计时，不牵涉调度器的注销/重注册，也不会有「同一回调被排了两次」的隐患。
     * 只有一条时不累加：翻来翻去还是同一句。
     * 正在滑动时也不累加（视为「刚翻过」）：等这一页滑完再重新数，滑动不会被下一次自动轮播截断。
     */
    private advanceTipAutoPlay(deltaTime: number): void {
        if (this.tips.length <= 1) return;
        if (this.tipSliding) {
            this.tipAutoElapsed = 0;
            return;
        }
        this.tipAutoElapsed += deltaTime;
        if (this.tipAutoElapsed < TIP_AUTO_SECONDS) return;
        this.tipAutoElapsed = 0;
        this.showTip(this.tipIndex + TIP_STEP_NEXT, TIP_STEP_NEXT);
    }

    /**
     * 给一个提示条箭头绑点击。
     *
     * 事件走节点上 `cc.Button` 派发的 CLICK（prefab 里两个箭头都有 Button 组件），
     * 按下缩放的视觉反馈由 Button 的 SCALE 过渡自己完成，这里只关心「点到了」。
     * 用闭包捕获各自的节点 —— 两个箭头共用一套逻辑，不必用 `event.target` 反查
     * （引擎事件的 `target` 在取消/多点触摸下不一定是我们想要的那个）。
     */
    private bindTipArrow(arrow: Node, step: number): void {
        arrow.on(Button.EventType.CLICK, () => this.stepTip(step));
    }

    /** 手动翻一条，并把自动轮播重新计时（等效于「用户刚翻过，重新数 N 秒」）。 */
    private stepTip(step: number): void {
        this.showTip(this.tipIndex + step, step);
        this.tipAutoElapsed = 0;
    }

    /**
     * 展示第 `index` 条提示。
     *
     * `step` 同时表示**滑动方向**：`> 0` 时正文整体左移（新页从右侧进来），`< 0` 时反向；
     * 传 `0` 表示不做动画直接落位 —— 初次上屏用它，免得开局先看到一次莫名其妙的滑动。
     *
     * 下标在这里统一按条数取模（负数也走 `+total` 修正），所以两个方向都能无缝回环，
     * 调用方不用自己判断边界（`tipIndex + step` 越界与否都行）。
     *
     * 滑动期间收到的新请求直接丢弃：一页 0.3 秒，等待比让两段补间抢同一个节点安全得多。
     */
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

        if (this.tipSliding) return;

        const side = step > 0 ? 1 : -1;
        const distance = this.tipPageWidth;
        const outgoing = this.tipText;
        const incoming = this.tipSpareText;

        this.tipIndex = next;
        this.tipSliding = true;

        incoming.string = this.tips[next];
        incoming.node.setPosition(side * distance, 0, 0);
        incoming.node.active = true;

        tween(outgoing.node)
            .to(TIP_SLIDE_SECONDS, { position: new Vec3(-side * distance, 0, 0) }, { easing: 'quadInOut' })
            .start();
        tween(incoming.node)
            .to(TIP_SLIDE_SECONDS, { position: new Vec3(0, 0, 0) }, { easing: 'quadInOut' })
            .call(() => {
                // 滑完把文案并回正页、两张页都归位，下一段滑动又能从「正页在中间」开始。
                outgoing.string = incoming.string;
                outgoing.node.setPosition(0, 0, 0);
                incoming.node.setPosition(0, 0, 0);
                incoming.node.active = false;
                this.tipSliding = false;
            })
            .start();
    }
}
