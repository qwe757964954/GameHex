import { _decorator, Button, Color, Label, Node, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { loadArt, loadFrameArt } from '../card/CardLineupIcons';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import {
    QUALITY_FRAME_NAMES,
    qualityFrameName,
    resolveItemIconRef,
} from './SevenDayArt';
import { sevenDayRepository } from './SevenDayRepository';
import type { ISevenDayRepository, ISevenDaySnapshot, SevenDayRequestResult } from './SevenDayRepository';
import { SevenDayDayTab } from './SevenDayDayTab';
import { SevenDayPageTab } from './SevenDayPageTab';
import { SevenDayPointBox } from './SevenDayPointBox';
import { SevenDayRewardRow } from './SevenDayRewardRow';
import {
    boxHasRedDot,
    boxProgressOf,
    boxStateOf,
    dayHasRedDot,
    dayLabelOf,
    discountText,
    formatRemain,
    isDayUnlocked,
    listDayTabs,
    listRowsOfDay,
    listRowsOfTab,
    shopStateOf,
    taskProgressText,
    taskStateOf,
} from './SevenDayTable';
import type { SevenDayListRow } from './SevenDayTable';
import { SEVEN_DAY_TEXTS } from './SevenDayTexts';

const { ccclass, property } = _decorator;

const DESIGN_HEIGHT = 1280;

/**
 * 「七日狂欢」弹窗（`assets/resources/ui/SevenDay/SevenDay.prefab`）。
 *
 * 版面照搬 FGUI 包「七日狂欢」（`zarts/.../assets/七日狂欢/组件/组件_七日狂欢_主界面.xml`，
 * 720×1280 与画布 1:1），效果图 = `zarts/.../塔防/Q_七日狂欢/七日狂欢效果图.jpg`：
 *   - 上半是背景 + 人物 + 标题美术字，右上角关闭；
 *   - 左侧「剩余时间:」+ 倒计时；
 *   - 两排交错的 7 个天数按钮（第 1/3/5/7 天在上排、第 2/4/6 天在下排，右高左低）；
 *   - 中部三页签（今日福利 / 今日挑战 / 半价礼包）+ 可滚动的奖励行列表；
 *   - 底部一排 5 个积分宝箱 + 当前积分。
 *
 *  **分层**（与 `FirstRechargePage` 同一套）：
 *    数据与判定  `SevenDayTable`（纯函数）+ `SevenDayRepository`（表 / 内存状态 / 请求）
 *    子视图      `SevenDayDayTab`（一天）、`SevenDayPageTab`（一页签）、
 *                `SevenDayRewardRow`（一行，内含 `SevenDayRewardSlot`）、`SevenDayPointBox`（一宝箱）
 *    本类        只做「取数 → 铺到子视图」和「点击 → 发请求 → 重新取数」
 *
 *  项目约定：**样式与布局全在 prefab 的 Inspector 上**；只有「随数据变化的东西」
 *  （行数、进度宽度、按钮三态）才在代码里算。
 *
 *  ⚠️ 列表用项目自带的虚拟列表（`VirtualScrollView`，规则 8）：prefab 里的 `RowView/RowTemplate`
 *  就是它的模板节点，运行时被 clone 复用。**别改成 `cc.ScrollView` + 预摆 N 行** ——
 *  行数上限虽然只有 9（表里最多的一天），但奖励会随版本变，硬编码会静默截断。
 */
@ccclass('SevenDayPage')
export class SevenDayPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径（`PopupManager` 用它加载）。
     *
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/SevenDay/`，S 与 D 大写）：
     * Android / iOS 的热更新 zip 内路径**大小写敏感**，写成 `ui/sevenDay/...`
     * 在编辑器里照样能跑（Windows 不敏感），真机上才会 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/SevenDay/SevenDay';

    @property({ type: Node, tooltip: 'CloseBtn：右上角关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Label, tooltip: 'TimeLabel：剩余时间（`3天12时`）' })
    timeLabel: Label = null!;

    @property({ type: Node, tooltip: 'DayBar：天数按钮栏（下面挂 7 个 SevenDayDayTab）' })
    dayBar: Node = null!;

    @property({ type: Node, tooltip: 'TabBar：页签栏（下面挂 3 个 SevenDayPageTab）' })
    tabBar: Node = null!;

    @property({ type: VirtualScrollView, tooltip: 'RowView：奖励行列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'BoxBar：积分宝箱栏（下面挂 5 个 SevenDayPointBox）' })
    boxBar: Node = null!;

    @property({ type: Label, tooltip: 'PointLabel：当前积分' })
    pointLabel: Label = null!;

    @property({ type: Label, tooltip: 'Hint：提示行（离线 / 空配置 / 操作失败时替换掉页签名）' })
    hintLabel: Label = null!;

    @property({ type: Node, tooltip: 'Panel：长屏时向下拉伸的九宫主底板' })
    panel: Node = null!;

    @property({ type: [Node], tooltip: '贴顶节点：长屏额外高度不改变它们距屏幕顶部的位置' })
    topAlignedNodes: Node[] = [];

    @property({ type: [Node], tooltip: '贴底节点：积分宝箱与积分区域在长屏上保持距屏幕底部不变' })
    bottomAlignedNodes: Node[] = [];

    /** 数据端口；测试可替换。 */
    private repo: ISevenDayRepository = sevenDayRepository;

    /**
     * 页签栏开关 —— **默认关，这是老端口径**（2026-09-26 按用户要求完全对齐老端实拍）。
     *
     * FGUI 原稿里 `<list name="list_tab" … visible="false">`，老端 `listTab.update([SevenDayTab.task])`
     * 只喂一个页签、`selectTab` 恒为 `SevenDayTab.task` ⇒ 界面上**没有页签栏**，只有一个混合列表
     * = 当天全部任务（今日福利 + 今日挑战混排，见 `listRowsOfDay`；day1 共 10 条）。
     *
     * 置 `true` 会恢复「按 `typeName` 分组」的 3 页签（`listDayTabs` / `listRowsOfTab` 一直都在），
     * 但**必须同时**把 `RowView` 的顶边从 392 改回 450 —— 页签栏占 382..450，不然列表压住它。
     * 这条开关与 `SevenDayTable.ts` 文件头、`tests/seven-day.test.ts` 的契约用例三处要一起改。
     */
    private static readonly SHOW_PAGE_TAB_BAR = false;

    private closeAction: Button | null = null;
    /** 当前快照（表 + 服务器状态 + 道具表）。 */
    private snapshot: ISevenDaySnapshot | null = null;
    /** 当前选中的天（1-based）。`0` = 还没定（首帧按创角第几天）。 */
    private selectedDay = 0;
    /** 当前选中的页签名（`typeName`）；空串 = 还没定（取当天第一个页签）。 */
    private selectedTab = '';
    private busy = false;
    private elapsed = 0;
    /** 品质框（4 档固定图），首次用到后缓存 —— 与档位无关，不用每次重载。 */
    private qualityFrames: Map<string, SpriteFrame> | null = null;

    /** 每次「取数 → 铺界面」递增，用来丢弃过期的异步结果。 */
    private presentRevision = 0;
    private loadRevision = 0;
    /** 列表数据（`renderItemFn` 按 index 取）。 */
    private rows: SevenDayListRow[] = [];
    /** `renderItemFn` 只需绑一次。 */
    private rowRendererBound = false;
    /** 自适应布局必须始终从 prefab 的 720×1280 基线算，避免重复打开时累计偏移。 */
    private readonly layoutBaseY = new Map<Node, number>();
    private panelBaseWidth = 0;
    private panelBaseHeight = 0;
    private rowListBaseWidth = 0;
    private rowListBaseHeight = 0;
    /**
     * 「这一趟」渲染要用的上下文。
     *
     * ⚠️ `renderItemFn` 是长驻回调，必须从这里**现取** snapshot / 预加载图，
     *    不能闭包捕获 `present()` 的入参（否则后续 reload 都拿第一份快照渲染，见 `presentRows`）。
     */
    private rowContext: {
        readonly snapshot: ISevenDaySnapshot;
        readonly qualityFrames: Map<string, SpriteFrame>;
        readonly iconFrames: Map<number, SpriteFrame>;
    } | null = null;

    protected onInit(): void {
        this.bindBlankContent();
        this.captureLayoutBase();
        this.closeAction = this.closeButton.getComponent(Button);
        this.closeAction?.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        for (const tab of this.dayTabs) {
            tab.node.on(Button.EventType.CLICK, () => this.onDayClick(tab), this);
        }
        for (const tab of this.pageTabs) {
            tab.node.on(Button.EventType.CLICK, () => this.onPageTabClick(tab), this);
        }
        for (const box of this.boxes) {
            box.boxButton.on(Button.EventType.CLICK, () => this.onBoxClick(box), this);
        }
    }

    /**
     * 声明「内容区」= 只有这几个**交互**节点；其余一切都算空白（点了就关）。
     *
     * ## 为什么这个界面必须显式声明
     *
     * 本页是**全屏页**，两根底图拼起来把整屏盖满：
     * `BgTop` 720×484（顶部美术）+ `Panel` 720×1145（九宫底板，长屏还会被 `applyScreenLayout`
     * 再拉高 `visibleHeight − 1280`）。`PopupBase` 默认把「全部激活的直接子节点」当内容区，
     * 于是整屏都是内容 ⇒ **点空白永不关闭**（实测 720×1485 上按 16×24 扫 384 点，只有底部 44px
     * 里的 2 个点是空白）。
     *
     * 而底图又过不了 `PopupBase.isBlankBackdrop()` 的「全屏装饰底图」判据 ——
     * 它要求**宽高都 ≥ 设计分辨率的 90%**（648×1152），`Panel` 是 **720×1145**（差 **7px**）、
     * `BgTop` 只有 484 高 ⇒ 两片都没被排掉。
     *
     * ## 为什么列这几个就够、且不会误关
     *
     * `Button` / `ScrollView` 都在自己节点上注册了触摸监听 ⇒ 触摸的命中目标是**它们**，
     * 事件沿父链冒泡（冒不到 index 0 的 `__BlankClose`）⇒ 点按钮/滑列表**本来就不会**被接收层抢走。
     * 把它们放进内容区只是让语义显式、并挡掉「按钮之间的小缝隙」误判成空白。
     *
     * ## 为什么写在代码里而不是 prefab 的 Inspector
     *
     * `contentNodes` 是 `PopupBase` 上的 `@property([Node])`，本来该在编辑器里配；
     * 但 cocos-mcp-server 的 `component_set_component_property` 对 `nodeArray` **漏传
     * `dump.type`**，写入必抛 `Cannot read properties of undefined (reading 'hasOwnProperty')`
     * （`extensions/cocos-mcp-server/dist/tools/component-tools.js` 的 `propertyType === 'nodeArray'` 分支），
     * 而铁律禁止手写 prefab JSON ⇒ 只能代码化。**修好扩展后可以改回 Inspector 配置**。
     */
    private bindBlankContent(): void {
        const interactive: Node[] = [];
        for (const node of [this.closeButton, this.dayBar, this.tabBar, this.rowList?.node, this.boxBar]) {
            if (node && node.isValid) interactive.push(node);
        }
        this.contentNodes = interactive;
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.selectedTab = '';
        this.setHint('');
        this.applyScreenLayout();
        // 打开时向服务端要一次最新状态；连不上就跳过（继续用内存快照渲染，不弹错）。
        await this.repo.refreshFromServer(this);
        if (!this.alive) return;
        await this.reload();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: ISevenDayRepository): void {
        this.repo = repository;
    }

    /** 倒计时每秒走一格；跨天时整体重算（替代老端的 `theNextDay` 事件）。 */
    protected update(deltaTime: number): void {
        this.elapsed += deltaTime;
        if (this.elapsed < 1) return;
        this.elapsed = 0;
        const snapshot = this.snapshot;
        if (!snapshot) return;
        this.presentTime(snapshot);
        // 跨天：创角第几天变了就把整个界面重铺一次（新的天解锁、旧的天按钮状态变）
        const nextCurDay = deriveCurDayOf(snapshot, Date.now());
        if (nextCurDay !== snapshot.curDay && !this.busy) {
            void this.reload();
        }
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = await this.repo.load();
        if (!this.alive || revision !== this.loadRevision) return;
        this.snapshot = snapshot;

        if (snapshot.tasks.length === 0 && snapshot.shops.length === 0) {
            this.presentEmpty();
            return;
        }
        // 首次（或换了天后）校准选中的天与页签
        if (this.selectedDay <= 0) this.selectedDay = snapshot.curDay;
        if (this.selectedDay > snapshot.taskMaxDay && snapshot.taskMaxDay > 0) {
            this.selectedDay = snapshot.taskMaxDay;
        }
        await this.present();
    }

    private async present(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const revision = ++this.presentRevision;

        const tabs = SevenDayPage.SHOW_PAGE_TAB_BAR
            ? listDayTabs(snapshot.tasks, snapshot.shops, this.selectedDay)
            : [];
        if (tabs.length === 0) {
            this.selectedTab = '';
        } else if (!tabs.some((tab) => tab.typeName === this.selectedTab)) {
            this.selectedTab = tabs[0]!.typeName;
        }

        this.presentTime(snapshot);
        this.presentDayTabs(snapshot);
        this.presentPageTabs(snapshot, tabs);

        //  品质框与图标必须先 **await 完**再铺界面：行渲染是同步的，在里面现加载会在滚动时
        //  先闪一帧上一行的图（`VScrollView` 回收残影同款缺陷）。
        // ⚠️ 行数据要**先**算出来：`loadIconFrames` 得按「这一趟的行」决定预加载哪些图标，
        //    而它在 `presentRows` 之前 await。若在那里面读 `this.rows`，拿到的是**上一帧**的行
        //    （首次打开时还是空数组）—— 症状是所有奖励图标都不加载、静默只画品质框，不报错。
        // ⚠️ 默认（页签栏关）走 `listRowsOfDay`：老端 `GetTlRefSevenDay(day, task)` 口径，
        //    当天全部 `type=2` 一个列表混排。别再改回 `listRowsOfTab`（那会只剩一个 typeName 的行）。
        const rows = SevenDayPage.SHOW_PAGE_TAB_BAR
            ? listRowsOfTab(snapshot.tasks, snapshot.shops, this.selectedDay, this.selectedTab, snapshot.state)
            : listRowsOfDay(snapshot.tasks, this.selectedDay, snapshot.state);

        const [qualityFrames, iconFrames] = await Promise.all([
            this.loadQualityFrames(),
            this.loadIconFrames(snapshot, rows),
        ]);
        if (!this.alive || revision !== this.presentRevision) return;

        this.presentRows(snapshot, rows, qualityFrames, iconFrames);
        this.presentBoxes(snapshot, iconFrames);
        this.pointLabel.string = String(snapshot.state.point);
    }

    private presentTime(snapshot: ISevenDaySnapshot): void {
        this.timeLabel.string = snapshot.endTimeMs > 0
            ? formatRemain(snapshot.endTimeMs - Date.now())
            : '';
    }

    private presentDayTabs(snapshot: ISevenDaySnapshot): void {
        const tabs = this.dayTabs;
        for (let index = 0; index < tabs.length; index++) {
            const day = index + 1;
            // 表里配了几天就显示几天（老端 `GetTaskMaxDay`）
            if (snapshot.taskMaxDay > 0 && day > snapshot.taskMaxDay) {
                tabs[index].hide();
                continue;
            }
            tabs[index].node.active = true;
            tabs[index].render(
                day,
                dayLabelOf(day, SEVEN_DAY_TEXTS.dayPrefix, SEVEN_DAY_TEXTS.daySuffix),
                isDayUnlocked(day, snapshot.curDay),
                day === this.selectedDay,
                dayHasRedDot(snapshot.tasks, day, snapshot.curDay, snapshot.state),
            );
        }
    }

    private presentPageTabs(snapshot: ISevenDaySnapshot, tabs: readonly { readonly typeName: string }[]): void {
        // 老端口径：页签栏整块不显示（FGUI 原稿 `list_tab` 就是 `visible="false"`，见 `SHOW_PAGE_TAB_BAR`）。
        // ⚠️ 必须在**代码里**关，不能只靠 prefab 关 —— 否则有人把 prefab 的 `_active` 改回 true
        //    就会「页签露出来 + 列表压住它」（`RowView` 顶边 392 < 页签底边 450）。
        this.tabBar.active = SevenDayPage.SHOW_PAGE_TAB_BAR;
        if (!SevenDayPage.SHOW_PAGE_TAB_BAR) {
            for (const tab of this.pageTabs) tab.hide();
            return;
        }
        const views = this.pageTabs;
        for (let index = 0; index < views.length; index++) {
            const tab = tabs[index];
            if (!tab) {
                views[index].hide();
                continue;
            }
            views[index].node.active = true;
            views[index].render(
                tab.typeName,
                tab.typeName === this.selectedTab,
                this.tabHasRedDot(snapshot, tab.typeName),
            );
        }
    }

    private presentRows(
        snapshot: ISevenDaySnapshot,
        rows: SevenDayListRow[],
        qualityFrames: Map<string, SpriteFrame>,
        iconFrames: Map<number, SpriteFrame>,
    ): void {
        // 行由 `present()` 提前算好传进来（图标预加载要用同一份，见那里的注释）。
        this.rows = rows;
        // ⚠️ `renderItemFn` 是**长驻**回调（只挂一次），而它每次被调用时要用「**这一趟**」的
        //    snapshot / 预加载图。所以只能存到字段里**现取**，绝不能闭包捕获这里的入参 ——
        //    闭包捕获会让后续每次 reload 都拿**第一次**的 snapshot 去渲染：
        //    症状是「领奖成功后行文案永远停在『领取』、进度永远不动」（离线数据变了但界面纹丝不动）。
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
        const view = node.getComponent(SevenDayRewardRow);
        if (!view) return;
        // 回调按 **index 现取** `this.rows[index]`，不能闭包捕获 `row` ——
        // 同一个实例会被复用到别的下标（`renderItemFn` 每次重铺都会重新赋值）。
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

    /** 把一行数据翻译成 `SevenDayRewardRow.render()` 要的视图模型。 */
    private buildRowView(
        snapshot: ISevenDaySnapshot,
        row: SevenDayListRow,
        qualityFrames: Map<string, SpriteFrame>,
        iconFrames: Map<number, SpriteFrame>,
    ): Parameters<SevenDayRewardRow['render']>[0] {
        const texts = SEVEN_DAY_TEXTS;
        if (row.kind === 'task') {
            const task = row.task;
            const state = taskStateOf(task, snapshot.state);
            const reward = task.reward[0];
            return {
                title: task.name,
                progress: taskProgressText(
                    task,
                    snapshot.state,
                    { progress: texts.taskProgress, fight: texts.taskFight, unFight: texts.taskUnFight },
                    // 关卡号 → 关卡名：Demo3.8 还没有「章节-关卡」映射，直接回数字，
                    // 由 `taskFight` 模板拼成「通关第N关」。
                    (level) => String(level),
                ),
                action: {
                    text: state === 'claimable' ? texts.taskClaim
                        : state === 'taken' ? texts.taskTaken
                            : state === 'goto' ? texts.taskGoto
                                : texts.taskUndone,
                    tone: state === 'undone' ? 'red' : 'green',
                    // 未完成 / 已领取都不可点
                    enabled: state === 'claimable' || state === 'goto',
                    redDot: state === 'claimable',
                },
                discount: '',
                soldOut: false,
                taken: state === 'taken',
                qualityFrame: this.qualityFrameOf(reward, snapshot, qualityFrames),
                iconFrame: this.iconFrameOf(reward, snapshot, iconFrames),
            };
        }

        const shop = row.shop;
        const state = shopStateOf(shop, snapshot.state);
        const reward = shop.rewards[0];
        return {
            title: shop.name,
            progress: '',
            action: {
                text: state === 'soldOut' ? texts.shopSoldOut
                    : state === 'free' ? texts.shopFree
                        : texts.shopBuy,
                tone: state === 'free' ? 'green' : 'blue',
                enabled: state !== 'soldOut',
                redDot: state === 'free',
            },
            discount: discountText(shop.discount, texts.discount),
            soldOut: state === 'soldOut',
            taken: false,
            qualityFrame: this.qualityFrameOf(reward, snapshot, qualityFrames),
            iconFrame: this.iconFrameOf(reward, snapshot, iconFrames),
        };
    }

    private presentBoxes(snapshot: ISevenDaySnapshot, iconFrames: Map<number, SpriteFrame>): void {
        const boxes = this.boxes;
        for (let index = 0; index < boxes.length; index++) {
            const row = snapshot.boxes[index];
            if (!row) {
                boxes[index].hide();
                continue;
            }
            boxes[index].node.active = true;
            const state = boxStateOf(row, snapshot.state);
            const qualityFrame = this.qualityFrameOf(row.reward[0], snapshot, null);
            boxes[index].render(
                row.point,
                boxProgressOf(index, snapshot.boxes, snapshot.state.point),
                state,
                qualityFrame,
                // 宝箱里的奖励物品（图一里三个宝箱都带物品图；老端 `com_goods` 就是干这个的）
                this.iconFrameOf(row.reward[0], snapshot, iconFrames),
            );
        }
    }

    /** 一档都没有（表没读到）时的样子：全部隐藏 + 提示。 */
    private presentEmpty(): void {
        for (const tab of this.dayTabs) tab.hide();
        for (const tab of this.pageTabs) tab.hide();
        for (const box of this.boxes) box.hide();
        this.rowList?.refreshList([]);
        this.pointLabel.string = '0';
        this.timeLabel.string = '';
        this.setHint(SEVEN_DAY_TEXTS.empty);
    }

    // ============================================================
    // 交互
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    private onDayClick(tab: SevenDayDayTab): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const day = this.dayTabs.indexOf(tab) + 1;
        if (!isDayUnlocked(day, snapshot.curDay)) {
            // 老端同：未解锁的天点了只提示，不切页（且要把选中态弹回原来那天）
            this.setHint(SEVEN_DAY_TEXTS.dayLocked);
            this.presentDayTabs(snapshot);
            return;
        }
        if (day === this.selectedDay) return;
        this.selectedDay = day;
        // 换天时页签要重选（不同天的 typeName 集合可能不同）
        this.selectedTab = '';
        this.setHint('');
        void this.present();
    }

    private onPageTabClick(tab: SevenDayPageTab): void {
        const name = tab.titleLabel.string;
        if (name.length === 0 || name === this.selectedTab) return;
        this.selectedTab = name;
        void this.present();
    }

    private async onBoxClick(box: SevenDayPointBox): Promise<void> {
        const snapshot = this.snapshot;
        if (this.busy || !snapshot) return;
        const index = this.boxes.indexOf(box);
        const row = snapshot.boxes[index];
        if (!row) return;

        // 只有「可领取」才发请求；未开启 / 已领取都只提示（老端：可领取时领，否则弹奖励预览）
        if (boxStateOf(row, snapshot.state) !== 'claimable') return;
        await this.runWrite(() => this.repo.claimBox(row.resId, this));
    }

    /**
     * 行内按钮（任务「领取 / 前往」、商品「购买 / 免费」）。
     *
     * ⚠️ 参数是**从 `this.rows` 现取的当前行**，不是渲染时捕获的那份 —— 虚拟列表复用节点，
     * 捕获会点到别的行（见 `SevenDayRewardRow.onAction` 的注释）。
     */
    private async onRowAction(row: SevenDayListRow): Promise<void> {
        const snapshot = this.snapshot;
        if (this.busy || !snapshot) return;

        if (row.kind === 'task') {
            const state = taskStateOf(row.task, snapshot.state);
            if (state === 'claimable') {
                // 老端口径：领任务奖励传的是**天**，服务端按该天所有已完成任务一起结算
                await this.runWrite(() => this.repo.claimTaskReward(row.task.days, this));
                return;
            }
            if (state === 'goto') {
                // 老端按 `goto` 走 `CtrlJumpView.JumpType` 跳对应玩法；本工程还没接跳转链路，
                // 所以**明确给提示**，而不是让按钮点下去毫无反应（规则：不静默失败）。
                this.setHint(SEVEN_DAY_TEXTS.gotoMissing, true);
            }
            // `undone` / `taken` 的按钮本来就是 `interactable=false`
            return;
        }

        const state = shopStateOf(row.shop, snapshot.state);
        if (state === 'soldOut') return;
        // 「免费」与「可购买」走同一条请求（老端也是同一个 `buyShop`，`cost <= 0` 由服务端判定）
        await this.runWrite(() => this.repo.buyShop(row.shop.id, this));
    }

    /**
     * 写请求的公共壳：置忙、发请求、按结果给提示、成功后重取数。
     *
     * 四条写路径（领任务奖励 / 买商品 / 领宝箱）**共用同一段**，避免各写一份漏掉
     * `busy` 复位或 `alive` 判定（页面在请求返回前被关掉时 `setHint` 会写到已销毁的 Label 上）。
     */
    private async runWrite(write: () => Promise<SevenDayRequestResult>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = await write();
        this.busy = false;
        if (!this.alive) return;
        if (result === 'offline') {
            this.setHint(SEVEN_DAY_TEXTS.offline, true);
            return;
        }
        if (result === 'failed') {
            this.setHint(SEVEN_DAY_TEXTS.failed, true);
            return;
        }
        this.setHint('');
        await this.reload();
    }

    // ============================================================
    // 工具
    // ============================================================

    /** 某页签当天是否有红点（任务页签看可领取；宝箱红点归到底部，不重复画）。 */
    private tabHasRedDot(snapshot: ISevenDaySnapshot, typeName: string): boolean {
        // 老端 `hasRedDot(selectDay, tab)` 里的 `ref.days > curDay` 过滤这里**不用再写**：
        // `selectedDay` 恒 `<= curDay`（初值取 `curDay`，且 `onDayClick` 拦掉了未解锁的天）。
        for (const task of snapshot.tasks) {
            if (task.days !== this.selectedDay || task.typeName !== typeName) continue;
            if (taskStateOf(task, snapshot.state) === 'claimable') return true;
        }
        return false;
    }

    /**
     * 奖励 → 品质框。
     *
     * `qualityFrames` 传 `null` 时（宝箱那条路）**返回 `null`** —— 让节点保留 prefab 上的静态框，
     * 而不是去查一个没预加载的 map（那会给出 `undefined`，`Sprite.spriteFrame = undefined`
     * 在部分版本上会抛）。
     */
    private qualityFrameOf(
        reward: { readonly resId: number } | undefined,
        snapshot: ISevenDaySnapshot,
        qualityFrames: Map<string, SpriteFrame> | null,
    ): SpriteFrame | null {
        if (!reward || !qualityFrames) return null;
        const info = snapshot.items.get(reward.resId);
        const quality = info ? info.quality : 1;
        return qualityFrames.get(qualityFrameName(quality)) ?? null;
    }

    private iconFrameOf(
        reward: { readonly resId: number } | undefined,
        snapshot: ISevenDaySnapshot,
        iconFrames: Map<number, SpriteFrame>,
    ): SpriteFrame | null {
        if (!reward) return null;
        return iconFrames.get(reward.resId) ?? null;
    }

    /**
     * 预加载当前页签各行奖励的图标；解析不出路径的条目直接跳过（奖励格降级成「只画品质框」）。
     *
     * ⚠️ 别在这里加 `SEVEN_DAY_ITEM_ICON_MAP.size === 0 → 早退`：白名单**现在就是空的**，
     *    图标靠 `item.icon` 的资源路径直通（见 `SevenDayArt.splitIconPath`），
     *    加那条早退会让所有图标静默消失。
     */
    private async loadIconFrames(
        snapshot: ISevenDaySnapshot,
        rows: readonly SevenDayListRow[],
    ): Promise<Map<number, SpriteFrame>> {
        const frames = new Map<number, SpriteFrame>();
        const wanted = new Map<number, { root: string; name: string }>();
        const collect = (reward: { readonly resId: number } | undefined): void => {
            if (!reward || wanted.has(reward.resId)) return;
            const info = snapshot.items.get(reward.resId);
            const ref = info ? resolveItemIconRef(info.icon) : null;
            if (ref) wanted.set(reward.resId, ref);
        };
        for (const row of rows) {
            collect(row.kind === 'task' ? row.task.reward[0] : row.shop.rewards[0]);
        }
        // ⚠️ 奖励来源有**两处**：列表行 + 底部积分宝箱。只收行的话，宝箱里那件物品的图永远
        //    加载不出来（症状：宝箱只剩品质框、物品位置空着，不报错也不告警）。
        for (const box of snapshot.boxes) collect(box.reward[0]);
        if (wanted.size === 0) return frames;

        await Promise.all(Array.from(wanted.entries()).map(async ([resId, ref]) => {
            const frame = await loadArt(ref.name, ref.root);
            if (frame) frames.set(resId, frame);
        }));
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

    private setHint(text: string, error: boolean = false): void {
        this.hintLabel.string = text;
        this.hintLabel.color = error
            ? SEVEN_DAY_HINT_ERROR
            : SEVEN_DAY_HINT_IDLE;
    }

    /**
     * 原稿是 720×1280。长屏不再把整页垂直居中：页头贴顶、积分区贴底，
     * 中间九宫底板与奖励列表吃掉全部额外高度。
     */
    private applyScreenLayout(): void {
        const rootTransform = this.node.getComponent(UITransform);
        const parentTransform = this.node.parent?.getComponent(UITransform);
        const visibleHeight = Math.max(DESIGN_HEIGHT, parentTransform?.contentSize.height ?? DESIGN_HEIGHT);
        const extra = visibleHeight - DESIGN_HEIGHT;
        rootTransform?.setContentSize(rootTransform.contentSize.width, visibleHeight);

        for (const node of this.topAlignedNodes) {
            const baseY = this.layoutBaseY.get(node);
            if (baseY !== undefined) node.setPosition(node.position.x, baseY + extra / 2, node.position.z);
        }
        for (const node of this.bottomAlignedNodes) {
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

    private captureLayoutBase(): void {
        for (const node of [...this.topAlignedNodes, ...this.bottomAlignedNodes]) {
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

    /** 天数按钮（按 x 从左到右 —— `_children` 顺序 ≠ 视觉顺序）。 */
    private get dayTabs(): SevenDayDayTab[] {
        return this.dayBar.getComponentsInChildren(SevenDayDayTab)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y);
    }

    /** 页签（按 x 排序）。 */
    private get pageTabs(): SevenDayPageTab[] {
        return this.tabBar.getComponentsInChildren(SevenDayPageTab)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    /** 宝箱（按**视觉从左到右**排；FGUI 的 list_box 是 `renderOrder="descent"`，节点序是从右往左）。 */
    private get boxes(): SevenDayPointBox[] {
        return this.boxBar.getComponentsInChildren(SevenDayPointBox)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    onDestroy(): void {
        this.presentRevision += 1;
        this.loadRevision += 1;
        super.onDestroy();
    }
}

/** 提示文字颜色（与首充同一口径：正常棕 / 异常红）。 */
const SEVEN_DAY_HINT_IDLE = new Color(176, 168, 150, 255);
const SEVEN_DAY_HINT_ERROR = new Color(226, 88, 74, 255);

/** 用「现在」重算创角第几天（跨天检测用）。 */
function deriveCurDayOf(snapshot: ISevenDaySnapshot, nowMs: number): number {
    // snapshot.curDay 是「now 时刻」的天数；这里只需要「有没有变」，用时间差推就行：
    // 每过满一天 curDay 才会变，所以用 (now - snapshot.now) 与一天的商做增量。
    const elapsedDays = Math.floor((nowMs - snapshot.now) / 86400000);
    return snapshot.curDay + elapsedDays;
}
