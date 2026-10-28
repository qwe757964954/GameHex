/**
 * 「加入联盟」页（老端 `TabLeagueJoin`，`ui/League/LeagueJoin`）——**「未入盟」态的整页**。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/加入联盟/组件_联盟_加入联盟.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `bg`（loader，`ui://…m` = `lianmeng_bg02`） | (0,0) **720×1280** | `Bg` |
 * | `n19` `lm_kj_pic08`（**无 size ⇒ 原尺寸 720×502**） | (0,0) | `Frame` |
 * | `n20` `frame_Dikuang03` | (0,498) 720×650 | `Board` |
 * | `list_league`（`overflow=scroll`，`SingleColumn`+`autoResizeItem`） | (59,657) **614×345** | `LeagueListView`（虚拟列表） |
 * | `comp_search`（公用 `组件_联盟_查询`） | (97,535) 569×111 | `Search`（+ `SearchBg` / `InputBg` / `Input` / `Placeholder` / `Text` / `BtnSearch`） |
 * | `btn_creat`（`按钮_公共_通用`，`TY_btn23`） | (115,1024) 224×79 | `BtnCreate` |
 * | `btn_join`（`按钮_公共_通用`，`TY_btn20`） | (393,1020) 224×79 | `BtnQuickJoin` |
 *
 * `n13` / `n14`（`组件_通用_全面屏适配`）与 `n18`（一块半透明 `graph`）**不落节点**：
 * 前者是 FGUI 的长屏适配壳（本端由 `cc.Widget` / 全屏 bg 承担），后者是 `GGraph`，不产生子控件。
 *
 * ## 渲染序：`Board` 在 `Frame` **之后**、`Search` 在 `Board` 之后
 *
 * FGUI `displayList` 的序是 `bg → n19 → n20 → list_league → comp_search → 两按钮`
 * ⇒ 底板盖住顶部装饰框的下缘、查询框与列表又盖在底板上。**照抄**，别按「背景该在底下」的直觉调换。
 *
 * ## 本页**不继承 `PopupBase`**（重要）
 *
 * FGUI 里它是**页签内容**（`GameTabUI`），不是弹窗：没有标题条、也没有「点空白关闭」。
 * 本端由容器页 `LeagueTabPage`（`ui/League/LeagueTab`）按 `IsJoinedLeague` 实例化到自身之下
 * ⇒ 拿不到 `PopupManager` 的 `_openContext`，`nextPopupFrame()` 会恒返回 `false`
 * （见 `PopupBase` 的实现）——所以这里用 `director.once(EVENT_AFTER_UPDATE)` 自己等一帧。
 *
 * ## 老端行为（`TabLeagueJoinUI`）与移植取舍
 *
 * 1. **`initAsync` 先拉一次列表**：`await ModelLeague.RequestLeagueList()`，
 *    `init()` 里挂 `VORoleUnionBag` / `VOUnionBag` 的 `OnChanged → updateView`。
 *    本端同样的两件事：`start()` 里拉一次（`requestList`），回来后按缓存铺行；
 *    「推送驱动」在本端**没有等价物**（`GameCacheMgr` 不发变更事件），
 *    所以除开页拉取外，**每次写操作成功后再拉一次**（见 `afterWrite`）。
 * 2. **查询框**：`fgui.Event.TEXT_CHANGE` → 非正整数就 `setText("")`；点查询 → `RequestLeagueSearch(text)` 再 `updateView()`。
 *    本端 `EditBox` 用 `'text-changed'` 事件（同 `LeagueHallPage.onSearchTextChanged`）。
 * 3. **快速加入**：`GetCanBeJoinList(inputText)` 为空 ⇒ `showTip(LEAGUE_NO_JOINABLE)` **且不发包**；
 *    否则 `RequestLeagueJoin(arr)`。⚠️ 该方法**命中搜索缓存时直接点名那一个**（不查 `autoJoin`）
 *    ⇒ 必须走 `pickQuickJoinIdsFor(rows, cached)`，别只调 `pickQuickJoinUnionIds`。
 * 4. **点行 → 开「联盟信息」**：`CtrlLeague.OpenLayerLeagueInfo(vo)`。
 *    传的是**行视图对象本身**（搜索结果不在缓存表里，见 `LeagueRepository` 类头）。
 * 5. **「创建联盟」→ 开 `LeagueCreate`**（老端 `OpenLayerLeagueCreat`）。
 *
 * ## 本端有意增补
 *
 * - `busy` 防连点（老端没有）：`join` 是写请求、走 5s 超时，连点会重复发包。
 *   同 `LeagueApplyListPage.beginWrite()` 的性质。
 * - `onJoined` 回敲容器：老端靠 `CmdRoleUnion` 的**推送**让容器页 `updateView` 切页；
 *   本端没有推送事件，只能由「写成功」这条链路主动通知（见 `LeagueTabPage.refreshAfterJoin`）。
 */

import { _decorator, Button, Component, director, Director, EditBox, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT, leagueBannerArt } from './LeagueArt';
import { LeagueCreatePage } from './LeagueCreatePage';
import { LeagueInfoPage } from './LeagueInfoPage';
import { leagueRepository, type ILeagueRepository, type LeagueRequestResult } from './LeagueRepository';
import { GameNet } from '../net/GameNet';
import { LeagueUnionRow } from './LeagueUnionRow';
import {
    buildLeagueUnionViews,
    isLeagueSearchId,
    pickQuickJoinIdsFor,
    pickUnionListForSearch,
    sanitizeLeagueSearchInput,
    type ILeagueUnionRow,
    type ILeagueUnionView,
} from './LeagueTable';
import {
    LEAGUE_HALL_LV_SUFFIX,
    LEAGUE_HALL_SEARCH_PROMPT,
    LEAGUE_JOIN_BTN_CREATE,
    LEAGUE_JOIN_BTN_QUICK,
    LEAGUE_NO_JOINABLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_INPUT_UNION_ID,
    LEAGUE_TIP_OFFLINE,
    LEAGUE_UNION_LEADER_PREFIX,
    LEAGUE_UNION_MEMBER_PREFIX,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

/** 全服行的三段前缀（与本页列表 / 大厅全服行同源）。 */
const JOIN_ROW_TEXTS = {
    levelSuffix: LEAGUE_HALL_LV_SUFFIX,
    leaderPrefix: LEAGUE_UNION_LEADER_PREFIX,
    memberPrefix: LEAGUE_UNION_MEMBER_PREFIX,
} as const;

@ccclass('LeagueJoinPage')
export class LeagueJoinPage extends Component {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
     * 本页由 `LeagueTabPage` 通过 `@property(Prefab)` 实例化，这个常量主要给测试 /
     * 文档引用（与其它页面同口径）。
     */
    static prefabPath = 'ui/League/LeagueJoin';

    @property({ type: Node, tooltip: 'Search/BtnSearch：按联盟 ID 查询' })
    searchButton: Node = null!;

    @property({ type: EditBox, tooltip: 'Search/Input：联盟 ID 查询框（数字键盘）' })
    searchInput: EditBox = null!;

    @property({ type: VirtualScrollView, tooltip: 'LeagueListView：可加入的联盟列表（虚拟列表 + Mask）' })
    unionList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'BtnCreate：创建联盟（开 LeagueCreate 弹窗）' })
    createButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnQuickJoin：快速加入（最多 5 条）' })
    quickJoinButton: Node = null!;

    /**
     * 写成功（快速加入 / 创建）后的回敲 —— 由容器页 `LeagueTabPage` 赋值。
     * 老端靠 `CmdRoleUnion` 推送驱动容器切页，本端没有推送事件 ⇒ 用这条链路顶上。
     */
    onJoined?: () => void;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueUnionView[] = [];

    /** 渲染回调只绑一次（`start()` 只会跑一次，这里仍留幂等保护）。 */
    private rendererBound = false;

    /** 按钮只绑一次。 */
    private buttonsBound = false;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.bindButtons();
        this.bindList();
    }

    /**
     * ⚠️ 必须 `start()` 而不是 `onLoad()`：`VirtualScrollView` 挂在本节点**子节点**上，
     *    引擎的激活顺序是「根 → 子」⇒ `onLoad` 那一刻子节点的槽位还没建。
     *    （同 `CardLineupPage.start()`；`LeagueHallPage` 因为有 `PopupBase.onOpen` 更晚，
     *    用 `nextPopupFrame()` 再等一帧。）
     */
    protected start(): void {
        this.applyStaticTexts();
        void this.reload();
    }

    protected onDestroy(): void {
        this.revision += 1;
        GameNet.instance.removeCaller(this);
    }

    // ============================================================
    // 接线
    // ============================================================

    private bindButtons(): void {
        if (this.buttonsBound) return;
        this.buttonsBound = true;
        this.bindClick(this.searchButton, () => void this.onSearchClick());
        this.bindClick(this.createButton, () => this.onCreateClick());
        this.bindClick(this.quickJoinButton, () => void this.onQuickJoinClick());

        const input = this.searchInput;
        if (input) input.node.on('text-changed', this.onSearchTextChanged, this);
        else console.warn('[LeagueJoin] Search/Input 没绑上，输入框不会过滤非数字');
    }

    private bindList(): void {
        if (this.rendererBound) return;
        this.rendererBound = true;
        if (!this.unionList) {
            console.warn('[LeagueJoin] LeagueListView 没绑上，联盟列表不会渲染');
            return;
        }
        this.unionList.renderItemFn = (node, index) => this.renderRow(node, index);
        this.unionList.onItemClickFn = (node, index) => this.onRowClick(node, index);
    }

    /** 两个按钮的文案（FGUI 是静态 `title`，本端也要在运行期写一次：prefab 里已写好，这里只兜底重刷）。 */
    private applyStaticTexts(): void {
        setLabelIfEmpty(this.createButton, LEAGUE_JOIN_BTN_CREATE);
        setLabelIfEmpty(this.quickJoinButton, LEAGUE_JOIN_BTN_QUICK);
        const placeholder = this.searchInput?.placeholderLabel;
        if (placeholder && !placeholder.string) placeholder.string = LEAGUE_HALL_SEARCH_PROMPT;
    }

    // ============================================================
    // 取数
    // ============================================================

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /** 拉一次列表 + 铺行。 */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const result = await this.repository.requestList(this);
        if (!this.alive || revision !== this.revision) return;

        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;

        this.present(snapshot.unions);

        // 拉失败仍然把缓存里的东西铺出来（离线时界面不该是空的），另给一条提示。
        if (result !== 'ok') FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    /**
     * 按「搜索缓存」铺行 —— 老端 `GetCmdUnionListBySearch`：
     * 命中过搜索缓存就只显示那一条，否则显示全部。
     */
    private present(rows: readonly ILeagueUnionRow[]): void {
        const key = this.searchInput?.string ?? '';
        this.rows = buildLeagueUnionViews(pickUnionListForSearch(rows, this.repository.cachedSearch(key)), JOIN_ROW_TEXTS);
        void this.deferRefresh();
    }

    /**
     * 铺列表。
     *
     * ⚠️ 列表在本节点的**子节点**上，本组件的 `start()` 早于它的槽位建立 ⇒ 必须再等一帧。
     *    监听挂在全局 `Director` 上（不依赖本组件的调度），与 `PopupOpenContext.nextFrame()` 同口径。
     */
    private async deferRefresh(): Promise<void> {
        await nextFrame();
        if (!this.alive || !this.unionList?.isValid) return;
        this.unionList.refreshList(this.rows);
        this.unionList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueUnionRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
        void this.loadBanner(row, view);
    }

    /** 旗面按颜色下标**换图**（FGUI 是 `gearIcon` 换图，不是给一张图染色）。 */
    private async loadBanner(row: LeagueUnionRow, view: ILeagueUnionView): Promise<void> {
        const token = row.bannerToken;
        const frame = await loadArt(leagueBannerArt(view.icon), LEAGUE_ART_ROOT);
        if (!row.isValid) return;
        row.applyBanner(frame, token);
    }

    // ============================================================
    // 查询
    // ============================================================

    /** 查询框输入：非正整数就地清空（老端 `onInputTextChange` 逐字照搬）。 */
    private onSearchTextChanged(): void {
        const input = this.searchInput;
        if (!input) return;
        input.string = sanitizeLeagueSearchInput(input.string);
    }

    /** 点「查询」：空输入提示；否则按 id 搜，回来后按缓存重铺列表。 */
    private async onSearchClick(): Promise<void> {
        const key = this.searchInput?.string ?? '';
        if (!key) {
            FW.showTip(LEAGUE_TIP_INPUT_UNION_ID);
            return;
        }
        const revision = ++this.revision;
        const result = await this.repository.search(key, this);
        if (!this.alive || revision !== this.revision) return;
        this.reportResult(result);
        if (result !== 'ok') return;

        // 搜索成功后**不重新拉列表**：老端也只是 `updateView()` 重铺一遍
        //（`GetCmdUnionListBySearch` 会命中刚写进缓存的这一条）。
        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;
        this.present(snapshot.unions);
    }

    // ============================================================
    // 快速加入 / 创建
    // ============================================================

    /**
     * 「快速加入」—— 老端 `onClickJoin()`：
     * 取「可快速加入」列表（**命中搜索缓存时直接点名那一个**），空则提示且**不发包**。
     */
    private async onQuickJoinClick(): Promise<void> {
        const key = this.searchInput?.string ?? '';
        const snapshot = await this.repository.load();
        if (!this.alive) return;

        const ids = pickQuickJoinIdsFor(snapshot.unions, this.repository.cachedSearch(key));
        if (!ids.length) {
            FW.showTip(LEAGUE_NO_JOINABLE);
            return;
        }
        if (!this.beginWrite()) return;
        try {
            await this.afterWrite(await this.repository.join(ids, this));
        } finally {
            this.busy = false;
        }
    }

    /** 「创建联盟」→ 开 `LeagueCreate` 弹窗；创建成功后同样回敲容器。 */
    private onCreateClick(): void {
        void LeagueCreatePage.open({
            userData: { onCreated: () => this.notifyJoined() },
        });
    }

    /**
     * 点列表某一行 ⇒ 开「联盟信息」。
     *
     * ⚠️ 传的是**行视图对象本身**，不是 id：列表里的 `CmdUnion` 可能来自
     *    `RequestUnionSearch` 的 Rsp，而 `LeagueRepository` **刻意不**把搜索结果写进
     *    缓存表（免得抢「我所在的联盟」那个 `tlKey`）⇒ 详情面板回缓存查是查不到的。
     */
    private onRowClick(_node: Node, index: number): void {
        const view = this.rows[index];
        if (!view) return;
        void LeagueInfoPage.open({ userData: { union: view } });
    }

    // ============================================================
    // 收尾
    // ============================================================

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    /** 写完后按三态收口；成功则重拉一次列表 + 通知容器（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        this.reportResult(result);
        if (result !== 'ok') return;
        await this.reload();
        if (!this.alive) return;
        this.notifyJoined();
    }

    private notifyJoined(): void {
        try {
            this.onJoined?.();
        } catch (error) {
            console.error('[LeagueJoin] onJoined 回调抛错', error);
        }
    }

    /** 三态归一：只有 `'ok'` 静默。 */
    private reportResult(result: LeagueRequestResult): void {
        if (result === 'ok') return;
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    /** 按名字接按钮；节点有 `cc.Button` 走 CLICK，否则退回 `TOUCH_END`（缺节点只 warn）。 */
    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueJoin] 按钮节点缺失，点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /** 输入框占位文案（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get searchPrompt(): string {
        return LEAGUE_HALL_SEARCH_PROMPT;
    }

    /** 老端 `isPositiveInteger` 的入口（转发给 `LeagueTable`，方便测试只 import 本文件）。 */
    static sanitize(text: string): string {
        return sanitizeLeagueSearchInput(text);
    }

    /** 搜索框是否已是合法 id（老端 `StringUtil.isPositiveInteger`）。 */
    static isValidSearchId(text: string): boolean {
        return isLeagueSearchId(text);
    }
}

/** 引擎的一帧（不依赖组件调度，节点销毁也能结束）。 */
function nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
        director.once(Director.EVENT_AFTER_UPDATE, () => resolve());
    });
}

/** 按钮底下的文案：prefab 已写好，运行期只在「空」时兜一次（免得手滑删了 label 就成空按钮）。 */
function setLabelIfEmpty(node: Node | null, text: string): void {
    const label = node ? node.getComponentInChildren(Label) : null;
    if (label && !label.string) label.string = text;
}
