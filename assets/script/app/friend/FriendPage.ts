/**
 * 「好友」弹窗（老端 `LayerFriend`，`assets/resources/ui/Friend/Friend.prefab`）。
 *
 * ## 版面（真源 = FGUI `好友/组件/组件_好友.xml`，720×1280）
 *
 * 三块：**弹窗框**（`组件_公共弹窗_新`：底板 / 标题飘带 / 关闭钮 / 标题）、
 * **可滚动列表**（`list` 78,309 564×592 `lineGap=10`）、**两排底部按钮 + 三个页签**。
 *
 * ⚠️ **层序**（`_children` 序 = 渲染序）：`PanelBg → RowView → 各按钮 → TabBar → 各文本`。
 *    列表必须排在按钮**之前** —— 反过来按钮会被列表的 `cc.Mask` 裁掉、且收不到触摸
 *    （这是本项目栽过的坑：单测看不出来，只有端到端探针能逮）。
 *
 * ## 三个页签的版面由一个纯函数算
 *
 * 15 条 `gearDisplay` / `gearDisplay2` 收进 `FriendTable.resolveFriendLayout()`（17 个开关），
 * 本类只负责「按开关写 `active` / 文案 / 底图」。漏掉一条**不会报错**，
 * 只会让按钮出现在错误的页签下 —— 所以那 17 个开关有独立的单测表。
 *
 * ## 数据与分层
 *
 *   判定 / 文案 / 美术   `FriendTable`（纯函数）/ `FriendTexts` / `FriendArt`
 *   取数与请求        `FriendRepository`（缓存 + `gameConfig` + 15 条协议）
 *   行              `FriendRow`（三页签共用一份，对齐老端 `setSelectedIndex("页签", …)`）
 *   本类            「取数 → 预加载两帧 → 组装视图模型 → 铺界面」+「点击 → 发请求 → 重新取数」
 *
 * ## 两条静默失效的时序铁律（本类已按正解写）
 *
 * ① `rowList.renderItemFn` **只在 `onInit` 里绑一次**，回调按 `index` 现取 `this.rows[index]`
 *    —— 回调里禁闭包捕获本趟数据，否则「点第 3 行删掉第 1 个」。
 * ② **异步预加载必须在铺行之前 `await` 完**，但预加载的内容**不能**依赖 `this.rows`
 *    （那一刻它是上一帧的行）。本类只预加载两帧页签底图，与行无关，天然安全；
 *    图标（头像）由每一行自己的 `FriendAvatarLoader` 异步补，不参与这一趟。
 */

import { _decorator, Button, EditBox, Label, Node, Sprite, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { FRIEND_ART_ROOT, FRIEND_ART_TAB_OFF, FRIEND_ART_TAB_ON, friendButtonArt } from './FriendArt';
import { friendRepository } from './FriendRepository';
import type { FriendRequestResult, IFriendRepository, IFriendSnapshot } from './FriendRepository';
import { FriendApplyPage } from './FriendApplyPage';
import { FriendGetEndPage } from './FriendGetEndPage';
import { FriendRow } from './FriendRow';
import { FriendTabButton } from './FriendTabButton';
import {
    buildFriendRowView,
    canSendMore,
    FRIEND_TAB_KEYS,
    FriendTab,
    IFriendRowView,
    IFriendRowTexts,
    parseSearch,
    resolveFriendLayout,
    rowsOfTab,
} from './FriendTable';
import {
    FRIEND_BTN_APPLY_LIST,
    FRIEND_BTN_GET_END,
    FRIEND_BTN_REFRESH,
    FRIEND_BTN_REMOVE_MODE,
    FRIEND_BTN_REMOVE_MODE_BACK,
    FRIEND_BTN_REMOVE_ONE_KEY,
    FRIEND_BTN_SEND_ONE_KEY,
    FRIEND_COUNT_TEMPLATE,
    FRIEND_BLACK_COUNT_TEMPLATE,
    FRIEND_ROW_TEXTS,
    FRIEND_SEND_TIMES_TEMPLATE,
    FRIEND_REMOVE_SELECT_TEMPLATE,
    FRIEND_TAB_LABELS,
    FRIEND_TIP_APPLY_OK,
    FRIEND_TIP_CANT_SEARCH_SELF,
    FRIEND_TIP_CHAT_MISSING,
    FRIEND_TIP_DELETE_OK,
    FRIEND_TIP_GET_MAX,
    FRIEND_TIP_NOT_FRIEND,
    FRIEND_TIP_OFFLINE,
    FRIEND_TIP_REFRESH_EMPTY,
    FRIEND_TIP_REMOVE_BLACK_OK,
    FRIEND_TIP_REQUEST_FAILED,
    FRIEND_TIP_SEARCH_EMPTY,
    FRIEND_TIP_SEND_MAX,
    FRIEND_TIP_SEND_OK,
} from './FriendTexts';

const { ccclass, property } = _decorator;

/**
 * 聊天模块是否可用 —— **Demo3.8 没有**（老端走聊天服 + `ModelTeam`）。
 *
 * 传 `false` 时 `buildFriendRowView` 把「私聊」按钮整块隐藏（而**不是**置灰）：
 * 置灰会让人以为「有这功能、只是当前不可用」，隐藏才是「本版本没这功能」的正确表达。
 */
const FRIEND_CHAT_AVAILABLE = false;

@ccclass('FriendPage')
export class FriendPage extends PopupBase {
    /**
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Friend/`，F 大写）：
     * Android / iOS 热更新 zip 内的路径**大小写敏感**，写成 `ui/friend/...`
     * 在 Windows 编辑器里照样能跑，真机上才会 `resources.load` 失败、变成一个空弹窗。
     */
    static prefabPath = 'ui/Friend/Friend';

    // ---- 弹窗框 ----
    @property({ type: Node, tooltip: 'PanelBg/CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    // ---- 列表 ----
    @property({ type: VirtualScrollView, tooltip: 'RowView：好友列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null;

    // ---- 底部按钮（文案 / 显隐 / 底图都随页签变） ----
    @property({ type: Node, tooltip: 'BatchRemoveBtn：右上「批量删除 / 返回」（页签 0）' })
    batchRemoveButton: Node = null;

    @property({ type: Sprite, tooltip: 'BatchRemoveBtn：底图（删除模式切深色，否则金色）' })
    batchRemoveBackground: Sprite = null;

    @property({ type: Label, tooltip: 'BatchRemoveBtn/Label：文案（批量删除 / 返回）' })
    batchRemoveLabel: Label = null;

    @property({ type: Node, tooltip: 'SendOneKeyBtn：一键赠送（页签 0 且非删除模式）' })
    sendOneKeyButton: Node = null;

    @property({ type: Label, tooltip: 'SendOneKeyBtn/Label：文案' })
    sendOneKeyLabel: Label = null;

    @property({ type: Node, tooltip: 'GetEndBtn：领取体力（页签 0 且非删除模式）' })
    getEndButton: Node = null;

    @property({ type: Label, tooltip: 'GetEndBtn/Label：文案' })
    getEndLabel: Label = null;

    @property({ type: Node, tooltip: 'RemoveOneKeyBtn：一键删除（页签 0 且删除模式）' })
    removeOneKeyButton: Node = null;

    @property({ type: Label, tooltip: 'RemoveOneKeyBtn/Label：文案' })
    removeOneKeyLabel: Label = null;

    @property({ type: Node, tooltip: 'RefreshBtn：换一批（页签 1）' })
    refreshButton: Node = null;

    @property({ type: Label, tooltip: 'RefreshBtn/Label：文案' })
    refreshLabel: Label = null;

    @property({ type: Node, tooltip: 'ApplyListBtn：好友申请（页签 1）' })
    applyListButton: Node = null;

    @property({ type: Label, tooltip: 'ApplyListBtn/Label：文案' })
    applyListLabel: Label = null;

    @property({ type: Node, tooltip: 'SearchBtn：搜索（页签 1）' })
    searchButton: Node = null;

    @property({ type: EditBox, tooltip: 'SearchInput：玩家名 / ID 输入框（页签 1）' })
    searchInput: EditBox = null;

    // ---- 页签 ----
    @property({ type: Node, tooltip: 'TabBar：底部三个页签的容器' })
    tabBar: Node = null;

    // ---- 文本 ----
    @property({ type: Label, tooltip: 'FriendCountLabel：好友数：n/max（页签 0）' })
    friendCountLabel: Label = null;

    @property({ type: Label, tooltip: 'BlackCountLabel：黑名单：n/max（页签 2）' })
    blackCountLabel: Label = null;

    @property({ type: Label, tooltip: 'SendTimesLabel：今日还可赠送 N 次（页签 0 且非删除模式）' })
    sendTimesLabel: Label = null;

    @property({ type: Label, tooltip: 'RemoveCountLabel：已选择：N 人（页签 0 且删除模式）' })
    removeCountLabel: Label = null;

    /** 数据端口；测试可注入替身。 */
    private repo: IFriendRepository = friendRepository;

    /** 最近一次快照。 */
    private snapshot: IFriendSnapshot | null = null;

    /** 当前页签。 */
    private tab: FriendTab = FriendTab.list;

    /** 是否在「批量删除」模式（只影响页签 0）。 */
    private deleteMode = false;

    /** 勾选中的好友 id（批量删除用）。 */
    private readonly checked = new Set<string>();

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: IFriendRowView[] = [];

    /** 与 `rows` 下标一一对应的 id（回调靠它认行）。 */
    private rowIds: string[] = [];

    /** 一个请求还没回来时忽略后续点击（避免连点发两次）。 */
    private busy = false;

    /** 每次取数 / 换页签递增，用来作废在飞的异步结果。 */
    private revision = 0;

    /** 两帧页签底图（首次用到后缓存）。 */
    private tabFrames: { readonly on: SpriteFrame | null; readonly off: SpriteFrame | null } | null = null;

    /** 两张按钮底图（`batchRemoveButton` 在删除模式要换深色）。 */
    private buttonFrames: { readonly gold: SpriteFrame | null; readonly dark: SpriteFrame | null } | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const close = this.closeButton.getComponent(Button);
        close?.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        const tabs = this.tabButtons;
        for (let index = 0; index < tabs.length; index++) {
            tabs[index].bind(index, (clicked) => void this.onTabClick(clicked));
        }

        this.bind(this.batchRemoveButton, this.onBatchRemoveClick);
        this.bind(this.sendOneKeyButton, this.onSendOneKeyClick);
        this.bind(this.getEndButton, this.onGetEndClick);
        this.bind(this.removeOneKeyButton, this.onRemoveOneKeyClick);
        this.bind(this.refreshButton, this.onRefreshClick);
        this.bind(this.applyListButton, this.onApplyListClick);
        this.bind(this.searchButton, this.onSearchClick);

        // ⚠️ 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.tab = FriendTab.list;
        this.deleteMode = false;
        this.checked.clear();
        this.searchInput.string = '';
        await this.reload();
    }

    protected onClose(): void {
        // 关掉后在飞的异步结果一律作废（否则会往已回收的 Label 上写）。
        this.revision += 1;
    }

    /** 子弹窗（好友申请 / 领取体力）关掉时，本页重新取一次数。 */
    protected onReveal(): void {
        void this.reload();
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IFriendRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与铺界面
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repo.load();
        if (!this.alive || revision !== this.revision) return;
        this.snapshot = snapshot;

        // 「添加好友」页签进来时若还没有推荐列表，顺手拉一次（老端同款：
        // 首次切到该页签 ⇒ `requetRefreshSuggest`）。
        if (this.tab === FriendTab.add && snapshot.suggestRows.length === 0) {
            const result = await this.repo.refreshSuggest(this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'ok') {
                const again = await this.repo.load();
                if (!this.alive || revision !== this.revision) return;
                this.snapshot = again;
            }
        }

        // 两帧页签底图 + 两张按钮底图先备好，再铺界面（避免「先出框后补图」的闪烁）。
        await this.loadStaticFrames();
        if (!this.alive || revision !== this.revision) return;

        // ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
        //    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        const layout = resolveFriendLayout({
            tab: this.tab,
            deleteMode: this.deleteMode,
            friendCount: snapshot.friendRows.length,
            friendMax: snapshot.config.maxFriends,
            blackCount: snapshot.blackRows.length,
            blackMax: snapshot.config.maxBlacks,
            removeCount: this.checked.size,
            leftSendTimes: snapshot.leftSendTimes,
            leftGetTimes: snapshot.leftGetTimes,
            texts: {
                friendCount: FRIEND_COUNT_TEMPLATE,
                blackCount: FRIEND_BLACK_COUNT_TEMPLATE,
                sendTimes: FRIEND_SEND_TIMES_TEMPLATE,
                removeSelect: FRIEND_REMOVE_SELECT_TEMPLATE,
                batchRemove: FRIEND_BTN_REMOVE_MODE,
                batchRemoveBack: FRIEND_BTN_REMOVE_MODE_BACK,
            },
        });

        this.presentTabs();

        // ---- 17 个开关 + 文案（全部绝对赋值） ----
        this.batchRemoveButton.active = layout.showBatchRemove;
        this.batchRemoveLabel.string = layout.batchRemoveText;
        const gold = this.buttonFrames?.gold ?? null;
        const dark = this.buttonFrames?.dark ?? null;
        const batchFrame = layout.batchRemoveGold ? gold : dark;
        if (batchFrame) this.batchRemoveBackground.spriteFrame = batchFrame;

        this.sendOneKeyButton.active = layout.showSendOneKey;
        this.sendOneKeyLabel.string = FRIEND_BTN_SEND_ONE_KEY;
        this.getEndButton.active = layout.showGetEnd;
        this.getEndLabel.string = FRIEND_BTN_GET_END;
        this.removeOneKeyButton.active = layout.showRemoveOneKey;
        this.removeOneKeyLabel.string = FRIEND_BTN_REMOVE_ONE_KEY;
        this.refreshButton.active = layout.showRefresh;
        this.refreshLabel.string = FRIEND_BTN_REFRESH;
        this.applyListButton.active = layout.showApplyList;
        this.applyListLabel.string = FRIEND_BTN_APPLY_LIST;
        this.searchButton.active = layout.showSearch;
        this.searchInput.node.active = layout.showSearch;

        this.friendCountLabel.string = layout.friendCountText;
        this.friendCountLabel.node.active = layout.showFriendCount;
        this.blackCountLabel.string = layout.blackCountText;
        this.blackCountLabel.node.active = layout.showBlackCount;
        this.sendTimesLabel.string = layout.sendTimesText;
        this.sendTimesLabel.node.active = layout.showSendTimes;
        this.removeCountLabel.string = layout.removeCountText;
        this.removeCountLabel.node.active = layout.showRemoveCount;

        this.presentRows(snapshot);
    }

    private presentTabs(): void {
        const tabs = this.tabButtons;
        const frames = this.tabFrames;
        for (let index = 0; index < tabs.length; index++) {
            const def = FRIEND_TAB_KEYS[index];
            if (!def) {
                tabs[index].node.active = false;
                continue;
            }
            tabs[index].node.active = true;
            tabs[index].render(FRIEND_TAB_LABELS[index] ?? def, index === this.tab, frames?.off ?? null, frames?.on ?? null);
        }
    }

    /**
     * 组装并铺列表。
     *
     * ⚠️ 行数据在 `refreshList` **之前**已经算完（下面那个 `for` 是同步的）——
     *    这条顺序就是「异步预加载禁读 `this.rows`」那条铁律的正解形态。
     */
    private presentRows(snapshot: IFriendSnapshot): void {
        const source = {
            friendRows: snapshot.friendRows,
            suggestRows: snapshot.suggestRows,
            blackRows: snapshot.blackRows,
        };
        const data = rowsOfTab(this.tab, source);
        const texts = this.rowTexts();

        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            views.push(buildFriendRowView(this.tab, row, texts, {
                nowMs: snapshot.now,
                deleteMode: this.deleteMode,
                checked: this.checked.has(row.id),
                applied: snapshot.appliedIds.has(row.id),
                leftSendTimes: snapshot.leftSendTimes,
                chatAvailable: FRIEND_CHAT_AVAILABLE,
            }));
        }
        this.rows = views;
        this.rowIds = ids;

        this.rowList.refreshList(views);
        // 换页签 / 换模式后回到顶部：从 20 行的黑名单切到 2 行的推荐时，
        // 不复位会停在「内容变短后的越界位置」。
        this.rowList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendRow);
        if (!row) return;

        row.onAction = () => this.dispatchRow(this.rowIds[index], (id) => void this.onRowAction(id));
        row.onChat = () => this.dispatchRow(this.rowIds[index], (id) => this.onRowChat(id));
        row.onCheck = () => this.dispatchRow(this.rowIds[index], (id) => this.onRowCheck(id));

        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
    }

    /** 回调里 `index` 可能已经越界（列表刚变短）—— 取不到 id 就什么都不做。 */
    private dispatchRow(id: string | undefined, action: (id: string) => void): void {
        if (!id) return;
        action(id);
    }

    // ============================================================
    // 交互 —— 行
    // ============================================================

    private async onRowAction(id: string): Promise<void> {
        if (this.busy) return;
        if (this.tab === FriendTab.black) {
            await this.runRequest(this.repo.blackRemove(id, this), FRIEND_TIP_REMOVE_BLACK_OK);
            return;
        }
        if (this.tab === FriendTab.add) {
            await this.runRequest(this.repo.apply(id, this), FRIEND_TIP_APPLY_OK);
            return;
        }
        // 好友列表：次数用完时**只提示不置灰**（老端 `onItemBtnClick` 第一句判断）
        const left = this.snapshot?.leftSendTimes ?? 0;
        if (!canSendMore(left)) {
            FW.showTip(FRIEND_TIP_SEND_MAX);
            return;
        }
        await this.runRequest(this.repo.sendEnd(id, this), FRIEND_TIP_SEND_OK);
    }

    private onRowChat(id: string): void {
        const snapshot = this.snapshot;
        const isFriend = !!snapshot && snapshot.friendRows.some((row) => row.id === id);
        FW.showTip(isFriend ? FRIEND_TIP_CHAT_MISSING : FRIEND_TIP_NOT_FRIEND);
    }

    /**
     * 勾选 / 取消勾选（只在删除模式下有用）。
     *
     * ⚠️ 这里**不重铺整个列表**（`refreshList` 会把滚动位置复位到顶部，
     * 用户勾到第 8 个人时会突然弹回第 1 个）—— 只重渲染那一行 + 刷计数。
     */
    private onRowCheck(id: string): void {
        if (!this.deleteMode) return;
        if (this.checked.has(id)) this.checked.delete(id);
        else this.checked.add(id);
        this.refreshCheckedRow(id);

        const snapshot = this.snapshot;
        if (snapshot) {
            this.removeCountLabel.string = FRIEND_REMOVE_SELECT_TEMPLATE.replace('{0}', String(this.checked.size));
        }
    }

    private refreshCheckedRow(id: string): void {
        const snapshot = this.snapshot;
        const index = this.rowIds.indexOf(id);
        if (!snapshot || index < 0) return;
        const row = snapshot.friendRows.find((item) => item.id === id) ?? snapshot.blackRows.find((item) => item.id === id);
        if (!row) return;

        const view = buildFriendRowView(FriendTab.list, row, this.rowTexts(), {
            nowMs: snapshot.now,
            deleteMode: this.deleteMode,
            checked: this.checked.has(id),
            applied: snapshot.appliedIds.has(id),
            leftSendTimes: snapshot.leftSendTimes,
            chatAvailable: FRIEND_CHAT_AVAILABLE,
        });
        this.rows[index] = view;

        const node = this.rowList.getItemByIndex(index);
        const component = node?.getComponent(FriendRow);
        if (component) component.render(view);
    }

    // ============================================================
    // 交互 —— 底部按钮 / 页签
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    private onBatchRemoveClick(): void {
        this.deleteMode = !this.deleteMode;
        // 退出删除模式时把勾选清掉（留着会让下次进来就带着上一次的选择）
        this.checked.clear();
        this.present();
    }

    private async onSendOneKeyClick(): Promise<void> {
        const left = this.snapshot?.leftSendTimes ?? 0;
        if (!canSendMore(left)) {
            FW.showTip(FRIEND_TIP_SEND_MAX);
            return;
        }
        await this.runRequest(this.repo.sendEndOneKey(this), FRIEND_TIP_SEND_OK);
    }

    private async onGetEndClick(): Promise<void> {
        const left = this.snapshot?.leftGetTimes ?? 0;
        if (left <= 0) {
            FW.showTip(FRIEND_TIP_GET_MAX);
            return;
        }
        // 子弹窗自己取数（它读的是同一份缓存）—— 关掉时 `onReveal` 会让本页重新取数。
        await FriendGetEndPage.open({});
    }

    private async onRemoveOneKeyClick(): Promise<void> {
        if (this.checked.size === 0) {
            FW.showTip(FRIEND_REMOVE_SELECT_TEMPLATE.replace('{0}', '0'));
            return;
        }
        await this.runRequest(this.repo.remove(Array.from(this.checked), this), FRIEND_TIP_DELETE_OK);
        this.checked.clear();
    }

    private async onRefreshClick(): Promise<void> {
        const result = await this.repo.refreshSuggest(this);
        if (!this.alive) return;
        if (result !== 'ok') {
            FW.showTip(result === 'offline' ? FRIEND_TIP_OFFLINE : FRIEND_TIP_REQUEST_FAILED);
            return;
        }
        await this.reload();
        if (!this.alive) return;
        if ((this.snapshot?.suggestRows.length ?? 0) === 0) FW.showTip(FRIEND_TIP_REFRESH_EMPTY);
    }

    private async onApplyListClick(): Promise<void> {
        await FriendApplyPage.open({});
    }

    private async onSearchClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        const parsed = parseSearch(this.searchInput.string, snapshot.selfId, snapshot.selfName);
        if (parsed.kind === 'empty') {
            FW.showTip(FRIEND_TIP_SEARCH_EMPTY);
            return;
        }
        if (parsed.kind === 'self') {
            FW.showTip(FRIEND_TIP_CANT_SEARCH_SELF);
            return;
        }
        const result = await this.repo.search(parsed, this);
        if (!this.alive) return;
        if (result !== 'ok') {
            FW.showTip(result === 'offline' ? FRIEND_TIP_OFFLINE : FRIEND_TIP_REQUEST_FAILED);
            return;
        }
        await this.reload();
        if (!this.alive) return;
        if ((this.snapshot?.suggestRows.length ?? 0) === 0) FW.showTip(FRIEND_TIP_REFRESH_EMPTY);
    }

    private async onTabClick(index: number): Promise<void> {
        // `index` 是页签按 x 排序后的下标，与 `FRIEND_TAB_KEYS` / `FriendTab` 同序。
        if (!FRIEND_TAB_KEYS[index]) return;
        if (index === this.tab) return;
        this.tab = index as FriendTab;
        // 换页签先退出删除模式：`展示删除界面` controller 只属于「好友列表」页签，
        // 带着它切到别页会让「删除人数」这类文本残留。
        this.deleteMode = false;
        this.checked.clear();
        await this.reload();
    }

    // ============================================================
    // 图与文案
    // ============================================================

    /** 页签两帧 + 按钮两帧；首次之后走缓存。 */
    private async loadStaticFrames(): Promise<void> {
        if (!this.tabFrames) {
            const [on, off] = await Promise.all([
                loadArt(FRIEND_ART_TAB_ON, FRIEND_ART_ROOT),
                loadArt(FRIEND_ART_TAB_OFF, FRIEND_ART_ROOT),
            ]);
            this.tabFrames = { on, off };
        }
        if (!this.buttonFrames) {
            const [gold, dark] = await Promise.all([
                loadArt(friendButtonArt('gold'), FRIEND_ART_ROOT),
                loadArt(friendButtonArt('dark'), FRIEND_ART_ROOT),
            ]);
            this.buttonFrames = { gold, dark };
        }
    }

    /** 行文案包（唯一来源 `FriendTexts`；三个行组件共用同一份）。 */
    private rowTexts(): IFriendRowTexts {
        return FRIEND_ROW_TEXTS;
    }

    /** 底部三个页签（按 x 排序 —— `_children` 序 ≠ 视觉序）。 */
    private get tabButtons(): FriendTabButton[] {
        return this.tabBar.getComponentsInChildren(FriendTabButton)
            .slice()
            .sort((a, b) => a.node.position.x - b.node.position.x);
    }

    /** 给一个按钮节点接点击（只接一次，在 `onInit` 里调）。 */
    private bind(node: Node, handler: () => void): void {
        const button = node.getComponent(Button);
        if (!button) {
            console.warn(`[Friend] ${node.name} 上没有 cc.Button，点击不会生效`);
            return;
        }
        button.node.on(Button.EventType.CLICK, handler, this);
    }

    /** 发一次请求 + 三态提示 + 成功后重新取数。 */
    private async runRequest(task: Promise<FriendRequestResult>, okTip: string): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const result = await task;
        this.busy = false;
        if (!this.alive) return;

        if (result === 'offline') {
            FW.showTip(FRIEND_TIP_OFFLINE);
            return;
        }
        if (result === 'failed') {
            FW.showTip(FRIEND_TIP_REQUEST_FAILED);
            return;
        }
        FW.showTip(okTip);
        await this.reload();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
