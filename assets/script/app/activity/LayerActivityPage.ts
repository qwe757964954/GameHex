import { _decorator, Button, Color, instantiate, Label, Node, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadArt, loadFrameArt } from '../card/CardLineupIcons';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import {
    ACTIVITY_ART_NAMES,
    ACTIVITY_ART_ROOT,
    ACTIVITY_TITLE_ART,
    ACTIVITY_TITLE_ART_ROOT,
    boxArtKey,
    buttonArtKey,
    QUALITY_FRAME_NAMES,
    qualityFrameName,
    resolveRewardIconRef,
} from './LayerActivityArt';
import { activityRepository } from './LayerActivityRepository';
import type { ActivityRequestResult, IActivityRepository, IActivitySnapshot } from './LayerActivityRepository';
import { gotoActivityTask } from './ActivityJump';
import { itemNumberTextOf } from '../itemdetail/ItemDetailTable';
import { ActivityProgressBox } from './ActivityProgressBox';
import type { IActivityBoxArt } from './ActivityProgressBox';
import { ActivityTaskRow } from './ActivityTaskRow';
import type { IActivityRewardSlotView, IActivityTaskRowView } from './ActivityTaskRow';
import {
    ACTIVITY_BAR_CENTER_Y,
    ACTIVITY_BAR_HEIGHT,
    ACTIVITY_BAR_LEFT,
    ACTIVITY_CHEST_ART_SIZE,
    ACTIVITY_CHEST_CENTER_Y,
    ACTIVITY_CHEST_NODE_HEIGHT,
    ACTIVITY_CHEST_NODE_WIDTH,
    ACTIVITY_PREVIEW_MAX_CELLS,
    ACTIVITY_ROW_REWARD_SLOTS,
    barFillWidth,
    chestOffsetX,
} from './LayerActivityLayout';
import { RewardPreviewPage } from './RewardPreviewPage';
import type { IRewardPreviewCell } from './RewardPreviewPage';
import {
    barRatioOf,
    boxPhaseOf,
    chestRatioOf,
    EMPTY_ACTIVITY_STATE,
    lastBoxCost,
    rewardGoodsOf,
    stateSignatureOf,
    taskHasRedDot,
    taskPhaseOf,
    taskProgressText,
} from './LayerActivityTable';
import type { IActivityProgressRow, IActivityReward, IActivityServerState, IActivityTaskRow } from './LayerActivityTable';
import { ACTIVITY_TEXTS } from './LayerActivityTexts';

const { ccclass, property } = _decorator;

/** 提示文字颜色（与七日狂欢 / 首充同一口径：正常棕 / 异常红）。 */
const ACTIVITY_HINT_IDLE = new Color(176, 168, 150, 255);
const ACTIVITY_HINT_ERROR = new Color(226, 88, 74, 255);

/**
 * 设计分辨率高度 —— `applyScreenLayout()` 的基线。
 *
 * ⚠️ **别用 `view.getVisibleSize().height`**：长屏上它是 1485（设计分辨率只有 1280），
 *    拿它当基线算 `extra` 会让「多出来的高度」每次都再叠一遍（反复开关弹窗越走越偏）。
 *    这里要的是「画布按设计分辨率算有多高」这个常量。
 */
const ACTIVITY_DESIGN_HEIGHT = 1280;

/**
 * 「贴顶节点」名单 —— 长屏适配时整体 `+extra/2`（保持与面板顶的相对位置）。
 *
 * ## ⚠️ 为什么名单在代码里而不是 prefab 的 Inspector 上
 *
 * `topAlignedNodes` 是 `@property([Node])`，而 MCP 的 `component_set_component_property`
 * **写不了 `nodeArray`**：旧版扩展在 `dag.dump` 里漏传 `type`，必抛
 * `Cannot read properties of undefined (reading 'hasOwnProperty')`
 * （`extensions/cocos-mcp-server/dist/tools/component-tools.js` 的 `nodeArray` 分支），
 * 而铁律禁止手写 prefab JSON ⇒ Inspector 上配不了。`SevenDayPage.contentNodes` 是同一个处境，
 * 同样落在代码里。**扩展修好之后可以整张挪回 Inspector**（那时删掉这张表即可）。
 *
 * ## ⚠️ 名字与 prefab 是硬绑定
 *
 * 改名会让长屏适配**静默偏掉**（只是位置差一点，不报错）⇒
 * `tests/activity.test.ts` 有一条用例逐个断言这些名字在 prefab 根下存在。
 */
const ACTIVITY_HEADER_NODES: readonly string[] = [
    'TitleArt',      // 标题横幅
    'TitleLabel',    // 「每日任务」
    'TopBg',         // 横幅下的顶部装饰
    'CloseBtn',      // 右上角关闭
    'ProgressStrip', // 周活跃整条（徽章 / 积分 / 条 / 宝箱）
    'Hint',          // 提示行
];

/**
 * 「活动 → 每日任务」弹窗（`assets/resources/ui/Activity/Activity.prefab`）。
 *
 * 版面照搬 FGUI 包「活动」的 `组件/组件_活动_首页.xml`（720×1280，与画布 1:1）+
 * `组件/组件_活动_内容.xml`（页签内容层），效果图 = `zarts/.../塔防/H_活动/活动效果图.jpg`：
 *   - 整块木框底板（`act_panel_bg`）+ 顶部标题横幅「每日任务」+ 右上角关闭；
 *   - 横幅下方一张顶部装饰图（`act_top_bg`）；
 *   - 周活跃一横条：左边徽章 + 当前积分 + 「周活跃」，右边一根进度条 + 一列达标宝箱；
 *   - 下面可滚动的任务行列表（行 = 底框 + 标题飘带 + 「名字 (进度/目标)」 + 奖励格 + 右侧按钮）。
 *
 *  **分层**（与 `SevenDayPage` 同一套）：
 *    数据与判定  `LayerActivityTable`（纯函数）+ `LayerActivityRepository`（表 / 缓存 / 请求）
 *    版面公式    `LayerActivityLayout`（FGUI 坐标 → Cocos 坐标）
 *    子视图      `ActivityTaskRow`（一行，内含 `ActivityRewardSlot`）、`ActivityProgressBox`（一宝箱）
 *    本类        只做「取数 → 铺到子视图」和「点击 → 发请求 → 重新取数」
 *
 * 项目约定：**样式与布局全在 prefab 的 Inspector 上**；只有「随数据变化的东西」
 *  （行数、进度条宽度、宝箱位置、按钮三态）才在代码里算。
 *
 * ## ⚠️ 页签栏只做了「每日任务」一个
 *
 *  FGUI `组件_活动_首页` 里**没有页签节点** —— 老端的页签栏是由它那套 `GameLayerUI`
 *  运行时注入的（`LayerActivityUI.InitTabList` + `TabProxy`），而老端 `InitTabProxy()`
 *  实际只 `addTab(TabDayChallengeActTask)`，另外三个是注释掉的。
 *  Demo3.8 没有那套框架，也没有页签底图，所以这里按老端**已落地的形态**做单页签，
 *  不做「4 个页签里 3 个点不动」的假壳子。
 *
 * ## ⚠️ 领奖后的刷新靠缓存事件，不靠请求的 Promise
 *
 *  两条领奖协议的响应体只有奖励、没有活动状态（见 `RequestActivityMsg`），
 *  所以 `claimTask/claimBox` 成功后**不能**只靠 `await` 完就地重取 —— 那时缓存还没更新，
 *  界面看起来像"点了没反应"。这里在 `onOpen` 订阅 `CmdActivity` 的缓存变更
 *  （`LayerActivityRepository.subscribe`），服务端把新状态推进缓存后再重铺一次。
 */
@ccclass('LayerActivityPage')
export class LayerActivityPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Activity/`，A 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/activity/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/Activity/Activity';

    @property({ type: Node, tooltip: 'CloseBtn：右上角关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Label, tooltip: 'TitleLabel：标题横幅上的字（`每日任务`）' })
    titleLabel: Label = null!;

    @property({ type: VirtualScrollView, tooltip: 'RowView：任务行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'ProgressStrip：周活跃整条（徽章 / 积分 / 条 / 宝箱都在它下面）' })
    progressStrip: Node = null!;

    @property({ type: Node, tooltip: 'ProgressStrip/BarFill：进度条填充（锚点必须 (0,0.5)，靠改宽度走）' })
    barFill: Node = null!;

    @property({ type: Node, tooltip: 'ProgressStrip/BoxRow：宝箱容器（子节点在运行时从 BoxTemplate clone）' })
    boxRow: Node = null!;

    @property({ type: Node, tooltip: 'ProgressStrip/BoxRow/BoxTemplate：宝箱模板（默认隐藏，只用来 clone）' })
    boxTemplate: Node = null!;

    @property({ type: Label, tooltip: 'ProgressStrip/CoinLabel：当前周活跃积分' })
    coinLabel: Label = null!;

    @property({ type: Label, tooltip: 'Hint：提示行（离线 / 空配置 / 操作失败时显示）' })
    hintLabel: Label = null!;

    @property({ type: Node, tooltip: 'PanelBg：长屏时拉伸的九宫主底板（位置不动、只长高：上下各吃一半额外高度）' })
    panel: Node = null!;

    @property({ type: [Node], tooltip: '贴顶节点：长屏额外高度不改变它们距屏幕顶部的位置（留空 ⇒ 用代码里的 ACTIVITY_HEADER_NODES，见其注释）' })
    topAlignedNodes: Node[] = [];

    @property({ type: [Node], tooltip: '贴底节点：长屏上保持距屏幕底部不变（每日任务当前没有这种节点，留空即可）' })
    bottomAlignedNodes: Node[] = [];

    /** 数据端口；测试可替换。 */
    private repo: IActivityRepository = activityRepository;

    private closeAction: Button | null = null;
    private snapshot: IActivitySnapshot | null = null;
    private busy = false;
    /** 取消缓存订阅（`onOpen` 建、`onClose` 拆）。 */
    private unsubscribe: (() => void) | null = null;

    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private presentRevision = 0;
    private loadRevision = 0;
    /** 当前列表数据（`renderItemFn` 按 index 取）。 */
    private rows: IActivityTaskRow[] = [];
    /** `renderItemFn` 只需绑一次。 */
    private rowRendererBound = false;
    /** 已加载的活动美术（`ACTIVITY_ART_NAMES` 的 key → SpriteFrame），首次用到后缓存。 */
    private art: Map<string, SpriteFrame> | null = null;
    /** 品质框（4 档固定图），首次用到后缓存。 */
    private qualityFrames: Map<string, SpriteFrame> | null = null;
    /**
     * 「这一趟」预加载好的道具图标（按 `resId`）。
     *
     * ⚠️ `rowContext.iconFrames` 是给**行渲染**用的（`renderItemFn` 要现取）；
     *    这个字段是给**点击**用的（`openBoxPreview` 要点宝箱时立刻拿图，不能再 `await`）。
     *    两者是同一份 Map，只是生命周期不同 —— 别只留一个。
     */
    private iconFrames: Map<number, SpriteFrame> | null = null;

    /**
     * 长屏自适应的**基线**（`节点 → prefab 里的原始 y`）。
     *
     * ⚠️ 必须在 `onInit` 里、`applyScreenLayout()` **之前**抓一次：基线一旦被污染
     * （比如某次在 onOpen 里抓），后续每次开关弹窗都会在**上一次挪过**的位置上再加一次偏移。
     */
    private readonly layoutBaseY = new Map<Node, number>();
    private panelBaseWidth = 0;
    private panelBaseHeight = 0;
    private rowListBaseWidth = 0;
    private rowListBaseHeight = 0;

    /**
     * 「这一趟」渲染要用的上下文。
     *
     * ⚠️ `renderItemFn` 是长驻回调，必须从这里**现取** snapshot / 预加载图，
     *    不能闭包捕获 `present()` 的入参（否则后续 reload 都拿第一份快照渲染）。
     */
    private rowContext: {
        readonly snapshot: IActivitySnapshot;
        readonly qualityFrames: Map<string, SpriteFrame>;
        readonly iconFrames: Map<number, SpriteFrame>;
    } | null = null;

    protected onInit(): void {
        this.titleLabel.string = ACTIVITY_TEXTS.title;
        this.closeAction = this.closeButton.getComponent(Button);
        this.closeAction?.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        // 宝箱模板只用来 clone，永远不进渲染
        if (this.boxTemplate) this.boxTemplate.active = false;
        // 「点空白关闭」的内容区（见 bindBlankContent 的说明），必须早于任何布局改动
        this.bindBlankContent();
        // 长屏基线：此刻 prefab 还没被 applyScreenLayout 动过，抓到的就是设计值
        this.captureLayoutBase();
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.setHint('');
        // 长屏适配要放在铺界面之前：宝箱是按「条宽比例」定位的，而条在面板里；
        // 先把面板/列表拉到位，后面算出来的世界坐标才对。
        this.applyScreenLayout();
        // 领奖后服务端只把新状态推进 `CmdActivity`，不挂在响应体上 ⇒ 必须订阅缓存变更。
        this.unsubscribe = this.repo.subscribe(this, () => this.onActivityCacheChanged());
        await this.reload();
    }

    protected onClose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IActivityRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = await this.repo.load();
        if (!this.alive || revision !== this.loadRevision) return;
        this.snapshot = snapshot;
        await this.present();
    }

    private async present(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const revision = ++this.presentRevision;

        if (snapshot.tasks.length === 0 && snapshot.boxes.length === 0) {
            this.presentEmpty();
            return;
        }

        //  美术必须先 **await 完**再铺界面：行渲染是同步的，在里面现加载会在滚动时
        //  先闪一帧上一行的图（`VScrollView` 回收残影同款缺陷）。
        // ⚠️ 行数据要**先**算出来：`loadIconFrames` 得按「当前的行」决定预加载哪些图标，
        //    而它在 `presentRows` 之前 await。若在那里面读 `this.rows`，拿到的是**上一帧**
        //    的行（首次打开时还是空数组）—— 症状是所有奖励图标都不加载、静默只画品质框。
        const rows = snapshot.tasks.slice();

        const [art, qualityFrames, iconFrames] = await Promise.all([
            this.loadArtFrames(),
            this.loadQualityFrames(),
            this.loadIconFrames(snapshot, rows),
        ]);
        if (!this.alive || revision !== this.presentRevision) return;

        this.presentRows(snapshot, rows, art, qualityFrames, iconFrames);
        this.presentStrip(snapshot);
        this.coinLabel.string = String(snapshot.state.coin);
    }

    private presentRows(
        snapshot: IActivitySnapshot,
        rows: IActivityTaskRow[],
        art: Map<string, SpriteFrame>,
        qualityFrames: Map<string, SpriteFrame>,
        iconFrames: Map<number, SpriteFrame>,
    ): void {
        this.rows = rows;
        // 点击路径（`openBoxPreview`）要用的那份图标表 —— 与 `rowContext.iconFrames` 同一份
        this.iconFrames = iconFrames;
        // ⚠️ `renderItemFn` 是**长驻**回调（只挂一次），每次被调用时要用「**这一趟**」的
        //    snapshot / 预加载图，所以只能存到字段里**现取**，绝不能闭包捕获入参 ——
        //    闭包捕获会让后续每次 reload 都拿**第一次**的 snapshot 渲染：
        //    症状是「领奖成功后行文案永远停在『领取』、进度永远不动」。
        this.rowContext = { snapshot, qualityFrames, iconFrames };

        const list = this.rowList;
        if (!list) return;
        if (!this.rowRendererBound) {
            this.rowRendererBound = true;
            list.renderItemFn = (node, index) => this.renderRow(node, index);
        }
        list.refreshList(this.rows);
    }

    /** 虚拟列表的行渲染（被 clone 复用的槽位 → 每次都按当前 `this.rows` / `rowContext` 重铺）。 */
    private renderRow(node: Node, index: number): void {
        const view = node.getComponent(ActivityTaskRow);
        if (!view) {
            console.warn('[Activity] 行模板上没有 ActivityTaskRow 组件，整行跳过');
            node.active = false;
            return;
        }
        // 回调按 **index 现取** `this.rows[index]`，不能闭包捕获 `row` ——
        // 同一个实例会被复用到别的下标。
        view.onAction = () => {
            const current = this.rows[index];
            if (current) void this.onRowAction(current);
        };
        const context = this.rowContext;
        const row = this.rows[index];
        if (!context || !row) {
            view.hide();
            return;
        }
        node.active = true;
        view.render(this.buildRowView(context.snapshot, row, context.qualityFrames, context.iconFrames));
    }

    /** 把一行数据翻译成 `ActivityTaskRow.render()` 要的视图模型。 */
    private buildRowView(
        snapshot: IActivitySnapshot,
        row: IActivityTaskRow,
        qualityFrames: Map<string, SpriteFrame>,
        iconFrames: Map<number, SpriteFrame>,
    ): IActivityTaskRowView {
        const phase = taskPhaseOf(row, snapshot.state);
        const texts = ACTIVITY_TEXTS;

        if (row.rewards.length > ACTIVITY_ROW_REWARD_SLOTS) {
            // 不静默截断：超出 prefab 槽位数的奖励会被丢掉，必须留痕（改 prefab 加槽位才行）
            console.warn(
                `[Activity] 任务 ${row.resId} 有 ${row.rewards.length} 条奖励，`
                + `超过行模板的 ${ACTIVITY_ROW_REWARD_SLOTS} 个槽位，多余的不会显示`,
            );
        }

        const slots: IActivityRewardSlotView[] = [];
        for (let index = 0; index < Math.min(row.rewards.length, ACTIVITY_ROW_REWARD_SLOTS); index++) {
            const reward = row.rewards[index];
            slots.push({
                qualityFrame: this.qualityFrameOf(reward.resId, snapshot, qualityFrames),
                iconFrame: iconFrames.get(reward.resId) ?? null,
                // 数量走全工程同一条口径（`0 ⇒ ''`、纯整数不缩写）。
                // ⚠️ 不能直接 `String(reward.number)`：那样 `number` 为 0 的条目会画出一个「0」，
                //    而 FGUI `Goods.GetNumberStr()` 对 0 是**空串**。
                numberText: itemNumberTextOf(reward.number),
            });
        }

        const tone = phase === 'claimable' ? 'green' : phase === 'goto' ? 'blue' : 'gray';
        return {
            title: taskProgressText(row, snapshot.state, texts.taskProgress),
            actionText: phase === 'claimable' ? texts.taskClaim
                : phase === 'taken' ? texts.taskTaken
                    : phase === 'goto' ? texts.taskGoto
                        : texts.taskUndone,
            actionFrame: this.artFrameOf(buttonArtKey(tone)),
            actionEnabled: phase === 'claimable' || phase === 'goto',
            // 已领取整块换成印章（FGUI `状态` 控制器第 2 页）
            actionVisible: phase !== 'taken',
            redDot: taskHasRedDot(row, snapshot.state),
            taken: phase === 'taken',
            slots,
        };
    }

    /** 周活跃一整条：进度条填充宽度 + 按 `cost` 比例定位的宝箱。 */
    private presentStrip(snapshot: IActivitySnapshot): void {
        const boxes = snapshot.boxes;
        const costMax = lastBoxCost(boxes);

        // 填充条的锚点是 (0, 0.5)，所以它的 x 就是**条的左端**、宽度 = 填充比例 × 条宽。
        // 两个数都从版面常量取：改条宽时 prefab 不会跟着漂。
        this.barFill?.setPosition(ACTIVITY_BAR_LEFT, ACTIVITY_BAR_CENTER_Y, 0);
        const fill = this.barFill?.getComponent(UITransform);
        if (fill) {
            fill.setContentSize(barFillWidth(barRatioOf(snapshot.state, boxes)), ACTIVITY_BAR_HEIGHT);
        }

        this.rebuildBoxes(boxes, snapshot.state, costMax);
    }

    /**
     * 按当前表行数重建宝箱。
     *
     * ## 为什么是运行时 clone 而不是 prefab 里摆死 N 个
     *
     *  七日狂欢是「prefab 摆 5 个、多的藏掉」—— 因为它那边宝箱档位数是策划固定 5。
     *  每日任务的进度宝箱是**表驱动、行数可变**的（当前 8 行），老端自己也是走虚拟列表。
     *  prefab 摆死就会在表加行时**静默少显示几个**，正是规则里反复提的那类缺陷。
     *  所以这里只摆一个隐藏模板，运行时按行数 clone；模板的样式仍然全在 prefab 上。
     */
    private rebuildBoxes(
        boxes: readonly IActivityProgressRow[],
        state: IActivityServerState,
        costMax: number,
    ): void {
        const row = this.boxRow;
        const template = this.boxTemplate;
        if (!row || !template) return;

        // 先清掉上一趟 clone 出来的（模板本身保留，且必须留在容器里）
        for (const child of row.children.slice()) {
            if (child === template) continue;
            child.destroy();
        }

        const boxArt: IActivityBoxArt = {
            taken: this.artFrameOf(boxArtKey('taken')),
            claimable: this.artFrameOf(boxArtKey('claimable')),
            locked: this.artFrameOf(boxArtKey('locked')),
        };

        for (let index = 0; index < boxes.length; index++) {
            const data = boxes[index];
            const node = instantiate(template);
            node.name = `Box${index + 1}`;
            node.parent = row;
            node.active = true;
            const transform = node.getComponent(UITransform);
            if (transform) transform.setContentSize(ACTIVITY_CHEST_NODE_WIDTH, ACTIVITY_CHEST_NODE_HEIGHT);
            node.setPosition(chestOffsetX(chestRatioOf(data, costMax)), ACTIVITY_CHEST_CENTER_Y, 0);

            const view = node.getComponent(ActivityProgressBox);
            if (!view) {
                console.warn('[Activity] 宝箱模板上没有 ActivityProgressBox 组件，跳过');
                continue;
            }
            // 宝箱图尺寸跟着「条宽 ÷ 档位数」走，不写死在 prefab 上（改表加档位不会叠图）
            view.applyArtSize(ACTIVITY_CHEST_ART_SIZE);
            // 锚点取 `chestButton`（72×72 的宝箱本体）而不是外层 `BoxN`（72×92）：
            // 外层那 92 高是为了「可领取」字样与达标积分的节点框不被裁，比宝箱图**高 10px**
            // ⇒ 拿它当锚点，气泡会整体偏高 10px。
            view.onClick = () => void this.onBoxClick(index, data, view.chestButton ?? node);
            view.render(data.cost, boxPhaseOf(data, index, state), boxArt, ACTIVITY_TEXTS.taskClaim);
        }
    }

    /** 一条都没有（表没读到）时的样子：清空列表 + 提示。 */
    private presentEmpty(): void {
        this.rows = [];
        this.rowContext = null;
        this.rowList?.refreshList([]);
        this.clearBoxes();
        this.barFill?.setPosition(ACTIVITY_BAR_LEFT, ACTIVITY_BAR_CENTER_Y, 0);
        const fill = this.barFill?.getComponent(UITransform);
        if (fill) fill.setContentSize(0, ACTIVITY_BAR_HEIGHT);
        this.coinLabel.string = '0';
        this.setHint(ACTIVITY_TEXTS.empty);
    }

    private clearBoxes(): void {
        const row = this.boxRow;
        if (!row) return;
        for (const child of row.children.slice()) {
            if (child === this.boxTemplate) continue;
            child.destroy();
        }
    }

    // ============================================================
    // 交互
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    /**
     * 缓存里的 `CmdActivity` 变了。
     *
     * 只有在「每日挑战那条活动的状态确实变了」时才重铺 —— 活动缓存是**所有活动共用**的，
     * 别的活动（月卡 / 充值好礼…）变化不该让这个界面白刷一遍。
     */
    private onActivityCacheChanged(): void {
        if (!this.alive || !this.isPopupOpen || this.busy) return;
        const current = stateSignatureOf(this.snapshot?.state ?? EMPTY_ACTIVITY_STATE);
        if (stateSignatureOf(this.repo.peekState()) === current) return;
        void this.reload();
    }

    /**
     * 行内按钮（`领取` / `前往`）。
     *
     * ⚠️ 参数是**从 `this.rows` 现取的当前行**，不是渲染时捕获的那份 —— 虚拟列表复用节点，
     * 捕获会点到别的行。
     */
    private async onRowAction(row: IActivityTaskRow): Promise<void> {
        const snapshot = this.snapshot;
        if (this.busy || !snapshot) return;
        if (snapshot.state.instanceId <= 0) {
            this.setHint(ACTIVITY_TEXTS.notOpen, true);
            return;
        }

        const phase = taskPhaseOf(row, snapshot.state);
        if (phase === 'claimable') {
            await this.runWrite(() => this.repo.claimTask(row.resId, this));
            return;
        }
        if (phase === 'goto') {
            // 老端 `TabDayChallengeActTask` 的「前往」= `CtrlJumpView.JumpType(ref.goto)`。
            // 本端按 `JUMP_TYPE` 路由到**确实存在**的页面，表里没有的一律提示
            // 「该功能暂未开放」（规则：不静默失败）。
            // ⚠️ 第二个参数是「关掉发起页」——只有目标是主界面 tab 页 / 另一条流程时
            //    才用得上（不然弹窗盖在上面，切 tab 看上去毫无变化）；弹窗类目标会保留本页。
            gotoActivityTask(row.goto, () => this.close());
        }
        // `undone` / `taken` 的按钮本来就是 `interactable=false`
    }

    /**
     * 点一个周活跃宝箱。
     *
     * 老端 `TabDayChallengeActTask.InitList`：
     * ```
     * box.setClick(() => {
     *     if (canDoReward) RequestActivityTakeDayActProgressReward(voActivity.GetId(), ref.id);
     *     else           CtrlAlert.OpenPanelRewards(this.proxy, tlGoods, box);   // 弹奖励预览
     * });
     * ```
     * ⇒ **可领取 ⇒ 领；不可领取 / 已领取 ⇒ 弹「里面有什么」的预览气泡**。
     *   本端早先版本后一支是**静默 `return`**（点了完全没反应），这一刀补上（`openBoxPreview`）。
     */
    private async onBoxClick(index: number, data: IActivityProgressRow, anchorNode: Node | null): Promise<void> {
        const snapshot = this.snapshot;
        if (this.busy || !snapshot) return;
        if (snapshot.state.instanceId <= 0) {
            this.setHint(ACTIVITY_TEXTS.notOpen, true);
            return;
        }
        if (boxPhaseOf(data, index, snapshot.state) !== 'claimable') {
            this.openBoxPreview(data, anchorNode);
            return;
        }
        await this.runWrite(() => this.repo.claimBox(data.id, this));
    }

    /**
     * 弹「奖励预览」浮动气泡（`RewardPreviewPage`）。
     *
     * ## 为什么整个流程是**同步**的
     *
     * 品质框（4 张固定图）与道具图标（按 `resId`）在 `present()` 里已经加载并缓存住了
     * （见 `loadIconFrames` —— 宝箱奖励与任务奖励共用同一趟预加载）。
     * ⇒ 这里一个 `await` 都不需要。**这是有意的**：一旦变成异步，「点了没反应」就会
     *   以「加载失败」的形式重新出现，而这一刀修的正是这个病。
     *   真到了「图没缓存住」的极端情况，也是降级成「只画品质框」而不是「什么都不弹」。
     *
     * ## 锚点
     *
     * 用 `getBoundingBoxToWorld()` 的**真实世界盒**。⚠️ 传进来的是 `chestButton`（72×72），
     * 不是外层 `BoxN` —— 理由见 `rebuildBoxes`。
     */
    private openBoxPreview(data: IActivityProgressRow, anchorNode: Node | null): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        const rewards = data.rewards;
        if (rewards.length === 0) {
            this.setHint(ACTIVITY_TEXTS.boxRewardEmpty, true);
            return;
        }
        if (rewards.length > ACTIVITY_PREVIEW_MAX_CELLS) {
            // 不静默截断：气泡只摆了这么多格，超出的要看得到（改 prefab 的 `Bubble/Cells` 才能加）
            console.warn(
                `[Activity] 宝箱 ${data.id} 有 ${rewards.length} 条奖励，`
                + `超过预览气泡的 ${ACTIVITY_PREVIEW_MAX_CELLS} 格，多余的不会显示`,
            );
        }

        const box = anchorNode?.getComponent(UITransform)?.getBoundingBoxToWorld();
        if (!box) {
            this.setHint(ACTIVITY_TEXTS.failed, true);
            return;
        }

        const qualityFrames = this.qualityFrames ?? new Map<string, SpriteFrame>();
        const cells: IRewardPreviewCell[] = [];
        for (let i = 0; i < Math.min(rewards.length, ACTIVITY_PREVIEW_MAX_CELLS); i += 1) {
            const reward = rewards[i];
            cells.push({
                qualityFrame: this.qualityFrameOf(reward.resId, snapshot, qualityFrames),
                iconFrame: this.iconFrames?.get(reward.resId) ?? null,
                numberText: itemNumberTextOf(reward.number),
                resId: reward.resId,
                number: reward.number,
            });
        }

        RewardPreviewPage.showAt({
            cells,
            anchor: { left: box.x, bottom: box.y, width: box.width, height: box.height },
        });
    }

    /**
     * 写请求的公共壳：置忙、发请求、按结果给提示、成功后重取数。
     *
     * 两条写路径共用同一段，避免各写一份漏掉 `busy` 复位或 `alive` 判定
     * （页面在请求返回前被关掉时 `setHint` 会写到已销毁的 Label 上）。
     */
    private async runWrite(write: () => Promise<ActivityRequestResult>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = await write();
        this.busy = false;
        if (!this.alive) return;
        if (result === 'offline') {
            this.setHint(ACTIVITY_TEXTS.offline, true);
            return;
        }
        if (result === 'noInstance') {
            this.setHint(ACTIVITY_TEXTS.notOpen, true);
            return;
        }
        if (result === 'failed') {
            this.setHint(ACTIVITY_TEXTS.failed, true);
            return;
        }
        this.setHint('');
        // 成功只是"请求发出去了"：新状态要等服务端推 `CmdActivity`，
        // 由 `onActivityCacheChanged` 触发重铺。这里再主动取一次，覆盖"推得比响应快"的情况。
        await this.reload();
    }

    // ============================================================
    // 美术
    // ============================================================

    /** 活动自己的图（按钮底 / 宝箱 / 对勾 / 红点…），一次全加载后缓存。 */
    private async loadArtFrames(): Promise<Map<string, SpriteFrame>> {
        const cached = this.art;
        if (cached) return cached;
        const frames = new Map<string, SpriteFrame>();
        const entries = Object.entries(ACTIVITY_ART_NAMES);
        await Promise.all(entries.map(async ([key, name]) => {
            const frame = await loadArt(name, ACTIVITY_ART_ROOT);
            if (frame) frames.set(key, frame);
        }));
        // 标题横幅在 image/common（不在活动目录里，见 LayerActivityArt 的说明）
        const title = await loadArt(ACTIVITY_TITLE_ART, ACTIVITY_TITLE_ART_ROOT);
        if (title) frames.set('title', title);
        this.art = frames;
        return frames;
    }

    /** 品质框（只有 4 张固定图），首次加载后缓存在实例上。 */
    private async loadQualityFrames(): Promise<Map<string, SpriteFrame>> {
        const cached = this.qualityFrames;
        if (cached) return cached;
        const frames = new Map<string, SpriteFrame>();
        await Promise.all(QUALITY_FRAME_NAMES.map(async (name) => {
            const frame = await loadFrameArt(name);
            if (frame) frames.set(name, frame);
        }));
        this.qualityFrames = frames;
        return frames;
    }

    /**
     * 预加载当前各行奖励的图标；解析不出路径的条目直接跳过（奖励格降级成「只画品质框」）。
     *
     * ⚠️ 走 `resolveRewardIconRef` 而不是 `resolveItemIconRef`：奖励里混着**货币 / 属性类**
     * （活跃度 15 每条任务都有），它们在 `roleProperty` 表、图标是 FGUI 组件名。
     * 只查 `item` 的话 10 个格子里 8 个没有图标，而且不报错。
     */
    private async loadIconFrames(
        snapshot: IActivitySnapshot,
        rows: readonly IActivityTaskRow[],
    ): Promise<Map<number, SpriteFrame>> {
        const frames = new Map<number, SpriteFrame>();
        const wanted = new Map<number, { root: string; name: string }>();
        const want = (rewards: readonly IActivityReward[]): void => {
            for (const reward of rewards) {
                if (wanted.has(reward.resId)) continue;
                const ref = resolveRewardIconRef(rewardGoodsOf(reward.resId, snapshot.items, snapshot.resources));
                if (ref) wanted.set(reward.resId, { root: ref.root, name: ref.name });
            }
        };
        for (const row of rows) want(row.rewards);
        // ⚠️ **宝箱奖励也要一起预加载**：点宝箱会弹「奖励预览」气泡（`RewardPreviewPage`），
        //    它用的就是这一份 `iconFrames`；漏了的话气泡里只会画出品质框、没有道具图
        //    （而且不报错 —— 静默降级）。宝箱与任务的奖励有交叠但不相同
        //    （如 `10012` / `16014` 只在 `dayChallengeActTaskProgress` 里出现）。
        for (const box of snapshot.boxes) want(box.rewards);
        if (wanted.size === 0) return frames;

        await Promise.all(Array.from(wanted.entries()).map(async ([resId, ref]) => {
            const frame = await loadArt(ref.name, ref.root);
            if (frame) frames.set(resId, frame);
        }));
        return frames;
    }

    /** 取一张已加载的活动美术；没加载到返回 `null`（调用方保留 prefab 上的静态图）。 */
    private artFrameOf(key: string): SpriteFrame | null {
        return this.art?.get(key) ?? null;
    }

    /** 奖励 → 品质框；`item` / `roleProperty` 两张表都查不到时按品质 1 兜底。 */
    private qualityFrameOf(
        resId: number,
        snapshot: IActivitySnapshot,
        qualityFrames: Map<string, SpriteFrame>,
    ): SpriteFrame | null {
        const info = rewardGoodsOf(resId, snapshot.items, snapshot.resources);
        const quality = info ? info.quality : 1;
        return qualityFrames.get(qualityFrameName(quality)) ?? null;
    }

    private setHint(text: string, error: boolean = false): void {
        this.hintLabel.string = text;
        this.hintLabel.color = error ? ACTIVITY_HINT_ERROR : ACTIVITY_HINT_IDLE;
    }

    // ============================================================
    // 长屏适配 / 点空白关闭
    // ============================================================

    /**
     * 显式点名「内容区」—— 点这些**以外**的地方才算点空白（`PopupBase` 的契约）。
     *
     * ## 为什么必须显式点名，不能靠 `PopupBase` 自动推断
     *
     * 自动推断的规则是「全部激活的直接子节点，排掉全屏装饰底图」，而底图判据里有一条
     * **宽高都 ≥ 设计分辨率 90%（648×1152）**。`PanelBg` 在设计分辨率下是 720×1020 ——
     * **高差 132，过不了这一条** ⇒ 它被当成「内容」⇒ 整屏都算内容 ⇒ **点哪儿都不关**。
     * （`SevenDayPage` 是同一个病，2026-09-28 已按用户要求修过。）
     * 长屏适配把面板拉到 720×1225 之后确实能过判据，但 720×1280 的机型上照样过不了，
     * 所以这里**显式点名**，与屏幕高度无关。
     *
     * ## 为什么是这几个
     *
     * `CloseBtn`（`cc.Button`）/ `RowView`（`ScrollView` + `Mask`）/ 宝箱（`ActivityProgressBox`
     * 在按钮节点上挂了 `TOUCH_END`）都在自己节点上注册了触摸监听 ⇒ 命中目标是**它们**、
     * 事件沿父链冒泡，冒不到 index 0 的全屏接收层 ⇒ 点它们**本来就不会**被算成空白。
     * 列在这里是让语义显式，并挡掉「它们之间的小缝隙」被误判成空白。
     *
     * ⚠️ `contentNodes` 是 `PopupBase` 上的 `@property([Node])`，本来该在 Inspector 里配；
     *    这里写在代码里是因为 MCP 的 `nodeArray` 写入链路在旧版扩展上不稳（见 `SevenDayPage` 同款注释）。
     */
    private bindBlankContent(): void {
        const interactive: Node[] = [];
        for (const node of [this.closeButton, this.progressStrip, this.rowList?.node]) {
            if (node && node.isValid) interactive.push(node);
        }
        this.contentNodes = interactive;
    }

    /**
     * 长屏（`getVisibleSize().height > 1280`）适配。
     *
     * 设计分辨率是 720×1280，长屏多出来的 `extra` 这样分：
     *   · `PanelBg`（九宫底板）**位置不动、只长高 `extra`** —— 上下各长 `extra/2`，
     *     于是「面板顶离屏幕顶」「面板底离屏幕底」两段留白**回到 1280 机型上的比例**，
     *     不会出现「长屏上下各多露一大块游戏场景」；
     *   · 贴顶节点（标题横幅 / 关闭按钮 / 顶部装饰 / 周活跃整条 / 提示行）整体 `+extra/2`
     *     —— 它们与面板顶的相对位置因此**保持不变**；
     *   · 任务列表同时 `+extra/2` 且**高度 +extra** —— 顶边跟着标题走、底边往下多吃一段。
     *
     * ⚠️ 三处偏移都必须从 `layoutBaseY` / `*Base*`（`onInit` 抓的基线）算，
     *    **不能读「当前位置」**—— 否则反复开关弹窗会一次次累加偏移。
     */
    private applyScreenLayout(): void {
        const rootTransform = this.node.getComponent(UITransform);
        const parentTransform = this.node.parent?.getComponent(UITransform);
        const visibleHeight = Math.max(
            ACTIVITY_DESIGN_HEIGHT,
            parentTransform?.contentSize.height ?? ACTIVITY_DESIGN_HEIGHT,
        );
        const extra = visibleHeight - ACTIVITY_DESIGN_HEIGHT;
        rootTransform?.setContentSize(rootTransform.contentSize.width, visibleHeight);

        for (const node of this.headerNodes()) {
            const baseY = this.layoutBaseY.get(node);
            if (baseY !== undefined) node.setPosition(node.position.x, baseY + extra / 2, node.position.z);
        }
        for (const node of this.bottomNodes()) {
            const baseY = this.layoutBaseY.get(node);
            if (baseY !== undefined) node.setPosition(node.position.x, baseY - extra / 2, node.position.z);
        }

        const panelTransform = this.panel?.getComponent(UITransform);
        if (panelTransform && this.panelBaseHeight > 0) {
            panelTransform.setContentSize(this.panelBaseWidth, this.panelBaseHeight + extra);
        }

        const listNode = this.rowList?.node;
        const listTransform = listNode?.getComponent(UITransform);
        const listBaseY = listNode ? this.layoutBaseY.get(listNode) : undefined;
        if (listNode && listTransform && listBaseY !== undefined && this.rowListBaseHeight > 0) {
            listNode.setPosition(listNode.position.x, listBaseY + extra / 2, listNode.position.z);
            listTransform.setContentSize(this.rowListBaseWidth, this.rowListBaseHeight + extra);
        }
    }

    /** 抓一次 prefab 的原始布局（`onInit` 里调，早于任何 `applyScreenLayout`）。 */
    private captureLayoutBase(): void {
        for (const node of [...this.headerNodes(), ...this.bottomNodes()]) {
            if (node) this.layoutBaseY.set(node, node.position.y);
        }
        const listNode = this.rowList?.node;
        if (listNode) {
            this.layoutBaseY.set(listNode, listNode.position.y);
            const transform = listNode.getComponent(UITransform);
            if (transform) {
                this.rowListBaseWidth = transform.contentSize.width;
                this.rowListBaseHeight = transform.contentSize.height;
            }
        }
        const panelTransform = this.panel?.getComponent(UITransform);
        if (panelTransform) {
            this.panelBaseWidth = panelTransform.contentSize.width;
            this.panelBaseHeight = panelTransform.contentSize.height;
        }
    }

    /**
     * 贴顶节点。
     *
     * prefab 上配了（`topAlignedNodes` 非空）就以它为准；否则按 `ACTIVITY_HEADER_NODES`
     * 的名字从根下取 —— 为什么要有这个兜底见那张表的注释（MCP 写不了 `nodeArray`）。
     * `captureLayoutBase` 与 `applyScreenLayout` **必须共用这一个入口**，
     * 否则「抓基线」和「加偏移」会作用在两套不同的节点上。
     */
    private headerNodes(): Node[] {
        const declared = (this.topAlignedNodes ?? []).filter((node) => !!node && node.isValid);
        if (declared.length > 0) return declared;
        const fallback: Node[] = [];
        for (const name of ACTIVITY_HEADER_NODES) {
            const node = this.node.getChildByName(name);
            if (node) fallback.push(node);
        }
        return fallback;
    }

    /** 贴底节点（同上；当前为空集）。 */
    private bottomNodes(): Node[] {
        return (this.bottomAlignedNodes ?? []).filter((node) => !!node && node.isValid);
    }

    // ============================================================
    // 杂项
    // ============================================================

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    onDestroy(): void {
        this.presentRevision += 1;
        this.loadRevision += 1;
        this.unsubscribe?.();
        this.unsubscribe = null;
        super.onDestroy();
    }
}
