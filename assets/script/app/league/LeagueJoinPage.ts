import { EventMgr } from '../../framework/event/EventMgr';
/**
 * 加入联盟页，未入盟态的整页内容，不继承 PopupBase。
 * 只负责接线与展示：搜索、快速加入、创建、行详情的业务编排在 `LeagueJoinController`。
 */

import { _decorator, Button, Component, EditBox, Label, Node } from 'cc';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT } from '../ArtPaths';
import { leagueBannerArt } from './LeagueArt';
import { LeagueJoinEvent, type ILeagueJoinIntent } from './LeagueJoinEvents';
import { LeagueUnionRow } from './LeagueUnionRow';
import {
    isLeagueSearchId,
    sanitizeLeagueSearchInput,
    type ILeagueUnionView,
} from './LeagueTable';
import {
    LEAGUE_HALL_SEARCH_PROMPT,
    LEAGUE_JOIN_BTN_CREATE,
    LEAGUE_JOIN_BTN_QUICK,
} from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueJoinPage')
export class LeagueJoinPage extends Component {
    /**
     * 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感。
     * 本页由 `LeagueTabPage` 通过 `@property(Prefab)` 实例化，这个常量主要给测试 /
     * 文档引用（与其它页面同口径）。
     */
    static prefabPath = 'ui/League/LeagueJoin';

    @property({ type: Node, tooltip: 'Search/BtnSearch：按联盟 ID 查询' })
    searchButton: Node = null;

    @property({ type: EditBox, tooltip: 'Search/Input：联盟 ID 查询框（数字键盘）' })
    searchInput: EditBox = null!;

    @property({ type: VirtualScrollView, tooltip: 'LeagueListView：可加入的联盟列表（虚拟列表 + Mask）' })
    unionList: VirtualScrollView = null!;

    @property({ type: Node, tooltip: 'BtnCreate：创建联盟（开 LeagueCreate 弹窗）' })
    createButton: Node = null;

    @property({ type: Node, tooltip: 'BtnQuickJoin：快速加入（最多 5 条）' })
    quickJoinButton: Node = null;

    /** 控制器推来的本趟视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: readonly ILeagueUnionView[] = [];

    // 生命周期

    protected onLoad(): void {
        this.bindButtons();
        this.bindList();
    }

    /**
     * 必须 `start()` 而不是 `onLoad()`：`VirtualScrollView` 挂在本节点**子节点**上，
     * 引擎的激活顺序是「根 → 子」⇒ `onLoad` 那一刻子节点的槽位还没建。
     * 控制器在 `showPage` 返回后创建，首屏取数由它负责；这里只写静态文案。
     */
    protected start(): void {
        this.applyStaticTexts();
    }

    protected onDestroy(): void {
        this.rows = [];
    }

    // 展示

    /** 控制器每次取数 / 搜索后把行推过来；本页只存数据并等一帧铺列表。 */
    render(rows: readonly ILeagueUnionView[]): void {
        this.rows = rows.slice();
        this.unschedule(this.deferredRefresh);
        this.scheduleOnce(this.deferredRefresh, 0);
    }

    /**
     * 铺列表。
     *
     * 列表在本节点的**子节点**上，本组件的 `start()` 早于它的槽位建立 ⇒ 必须再等一帧。
     * 用组件调度而不是全局 `Director`：页面销毁时 `unschedule` 直接收掉，不需要额外令牌。
     */
    private readonly deferredRefresh = (): void => {
        this.unionList.refreshList(this.rows.length);
        this.unionList.scrollToTop(false);
    };

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueUnionRow);
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

    // 接线

    private bindButtons(): void {
        this.bindClick(this.searchButton, this.emitSearch);
        this.bindClick(this.createButton, this.emitCreate);
        this.bindClick(this.quickJoinButton, this.emitQuickJoin);

        const input = this.searchInput;
        if (input) input.node.on('text-changed', this.onSearchTextChanged, this);
        else console.warn('[LeagueJoin] Search/Input 没绑上，输入框不会过滤非数字');
    }

    private bindList(): void {
        this.unionList.renderItemFn = (node, index) => this.renderRow(node, index);
        this.unionList.onItemClickFn = (node, index) => this.onRowClick(node, index);
    }

    /** 两个按钮的文案（prefab 已写好，这里只在「空」时兜一次）。 */
    private applyStaticTexts(): void {
        setLabelIfEmpty(this.createButton, LEAGUE_JOIN_BTN_CREATE);
        setLabelIfEmpty(this.quickJoinButton, LEAGUE_JOIN_BTN_QUICK);
        const placeholder = this.searchInput.placeholderLabel;
        if (placeholder && !placeholder.string) placeholder.string = LEAGUE_HALL_SEARCH_PROMPT;
    }

    // 输入 → 意图

    /** 查询框输入：非正整数就地清空（老端 `onInputTextChange` 逐字照搬）。 */
    private onSearchTextChanged(): void {
        const input = this.searchInput;
        input.string = sanitizeLeagueSearchInput(input.string);
        this.emit({ kind: 'input', text: input.string ?? '' });
    }

    private readonly emitSearch = (): void => {
        this.emit({ kind: 'search' });
    };

    private readonly emitCreate = (): void => {
        this.emit({ kind: 'create' });
    };

    private readonly emitQuickJoin = (): void => {
        this.emit({ kind: 'quickJoin' });
    };

    /**
     * 点列表某一行 ⇒ 开「联盟信息」。
     *
     * 传的是**行视图对象本身**，不是 id：列表里的 `CmdUnion` 可能来自
     * `RequestUnionSearch` 的 Rsp，而 `LeagueRepository` **刻意不**把搜索结果写进
     * 缓存表（免得抢「我所在的联盟」那个 `tlKey`）⇒ 详情面板回缓存查是查不到的。
     */
    private onRowClick(_node: Node, index: number): void {
        const view = this.rows[index];
        if (!view) return;
        this.emit({ kind: 'openUnion', union: view });
    }

    private emit(intent: ILeagueJoinIntent): void {
        EventMgr.instance.emit(LeagueJoinEvent.Intent, intent);
    }

    /** 按名字接按钮；prefab 必须挂 `cc.Button`（缺节点只 warn，不再用 TOUCH_END 兜底）。 */
    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueJoin] 按钮节点缺失，点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (!button) {
            console.warn('[LeagueJoin] 按钮节点缺少 cc.Button，点击不会生效');
            return;
        }
        button.node.on(Button.EventType.CLICK, handler, this);
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

/** 按钮底下的文案：prefab 已写好，运行期只在「空」时兜一次（免得手滑删了 label 就成空按钮）。 */
function setLabelIfEmpty(node: Node | null, text: string): void {
    const label = node ? node.getComponentInChildren(Label) : null;
    if (label && !label.string) label.string = text;
}
