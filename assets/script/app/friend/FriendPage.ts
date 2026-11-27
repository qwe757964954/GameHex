/**
 * 「好友」弹窗（`assets/bundles/main-pages/ui/Friend/Friend.prefab`）。
 *
 * 层序：`PanelBg → RowView → 各按钮 → TabBar → 各文本`。列表必须排在按钮之前 ——
 * 反过来按钮会被列表的 Mask 裁掉，而且收不到触摸（单测看不出来，只有真机才能发现）。
 *
 * 三个页签的显隐收在 `FriendTable.resolveFriendLayout()` 的 17 个开关里，本类只负责按开关
 * 写 `active` / 文案 / 底图；漏一条不会报错，只会让按钮出现在错误的页签下。
 *
 * 两条时序约束：
 *   1. `rowList.renderItemFn` 只在 `onInit` 里绑一次，回调按 `index` 现取 `this.rows[index]`
 *      —— 回调里不能闭包捕获本趟数据，否则「点第 3 行删掉的是第 1 个」。
 *   2. 异步预加载要在铺行之前 `await` 完，且预加载内容不能依赖 `this.rows`。这里只预加载
 *      页签 / 按钮底图，与行无关；头像由每行的 `FriendAvatarLoader` 自己异步补。
 */

import { _decorator, Button, EditBox, Label, Node, Sprite, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { RedDot } from '../common/RedDot';
import { RED_DOT_TYPE_NUMBER } from '../common/RedDotState';
import { FRIEND_ART_ROOT } from '../ArtPaths';
import { FRIEND_ART_BTN_BLUE, FRIEND_ART_BTN_BLUE_ROOT, FRIEND_ART_BTN_DARK, FRIEND_ART_BTN_GOLD, FRIEND_ART_BTN_GOLD_ROOT, FRIEND_ART_TAB_ON, FRIEND_ART_TAB_ON_ROOT } from './FriendArt';
import { friendRepository } from './FriendRepository';
import type { FriendRequestResult, IFriendRepository, IFriendSnapshot } from './FriendRepository';
import { FriendApplyPage } from './FriendApplyPage';
import { FriendGetEndPage } from './FriendGetEndPage';
import { FriendRow } from './FriendRow';
import type { IFriendRowArt } from './FriendRow';
import { FriendTabButton } from './FriendTabButton';
import {
    buildFriendRowView,
    canSendMore,
    FRIEND_TAB_KEYS,
    FriendTab,
    IFriendRowView,
    parseSearch,
    resolveFriendLayout,
    rowsOfTab,
} from './FriendTable';
import {
    formatText,
    FRIEND_BTN_APPLY_LIST,
    FRIEND_BTN_GET_END,
    FRIEND_BTN_REFRESH,
    FRIEND_BTN_REMOVE_MODE,
    FRIEND_BTN_REMOVE_MODE_BACK,
    FRIEND_BTN_REMOVE_ONE_KEY,
    FRIEND_BTN_SEND_ONE_KEY,
    FRIEND_BLACK_COUNT_TEMPLATE,
    FRIEND_COUNT_TEMPLATE,
    FRIEND_REMOVE_SELECT_TEMPLATE,
    FRIEND_ROW_TEXTS,
    FRIEND_SEND_TIMES_TEMPLATE,
    FRIEND_TAG_ADD,
    FRIEND_TAG_BLACK,
    FRIEND_TAG_COUNT_TEMPLATE,
    FRIEND_TAG_LIST,
    FRIEND_TAG_REMOVE,
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
 * 聊天模块是否可用 —— Demo3.8 没有（老端走聊天服 + `ModelTeam`）。
 *
 * `false` 时 `buildFriendRowView` 把「私聊」按钮整块隐藏而不是置灰：置灰会让人以为
 * 「有这功能、只是当前不可用」，隐藏才是「本版本没这功能」的正确表达。
 */
const FRIEND_CHAT_AVAILABLE = false;

@ccclass('FriendPage')
export class FriendPage extends PopupBase {
    /**
     * 目录名必须与磁盘一致（`assets/resources/ui/Friend/`，F 大写）：热更新 zip 内的路径
     * 大小写敏感，写成 `ui/friend/...` 在 Windows 编辑器里能跑、真机上 `resources.load` 失败。
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

    @property({ type: Label, tooltip: 'RemoveCountLabel：已选择 N 人（页签 0 且删除模式）' })
    removeCountLabel: Label = null;

    // ---- v2 顶部统计卡 / 标签行 ----
    @property({ type: Node, tooltip: 'StatBar：好友数 + 今日赠送次数（页签 0）' })
    statBar: Node = null;

    @property({ type: Node, tooltip: 'BlackStatBar：黑名单单独统计卡（页签 2）' })
    blackStatBar: Node = null;

    @property({ type: Label, tooltip: 'TagRow/TagTitle：好友列表 / 推荐好友 / 黑名单 / 批量删除' })
    tagTitleLabel: Label = null;

    @property({ type: Label, tooltip: 'TagRow/TagCount：标签后人数（删除模式隐藏）' })
    tagCountLabel: Label = null;

    @property({ type: Node, tooltip: 'TagRow/RemoveCountPill：删除模式「已选择 N 人」药丸' })
    removeCountPill: Node = null;

    /** 数据端口；测试可注入替身。 */
    private repo: IFriendRepository = friendRepository;

    private snapshot: IFriendSnapshot | null = null;

    private tab: FriendTab = FriendTab.List;

    /** 是否在「批量删除」模式（只影响页签 0）。 */
    private deleteMode = false;

    /** 勾选中的好友 id。 */
    private readonly checked = new Set<string>();

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: IFriendRowView[] = [];

    /** 与 `rows` 下标一一对应的 id（回调靠它认行）。 */
    private rowIds: string[] = [];

    /** 请求未返回时忽略后续点击，避免连点发两次。 */
    private busy = false;

    /** 每次取数 / 换页签递增，用来作废在飞的异步结果。 */
    private revision = 0;

    /** 选中页签的金黄底（首次用到后缓存）。 */
    private tabFrames: { readonly on: SpriteFrame | null } | null = null;

    /** 行主按钮三张底图（金 / 蓝 / 暗）；行内只切引用。 */
    private rowButtonFrames: IFriendRowArt | null = null;

    /** 好友申请按钮上的通用红点（数字 = 待处理申请数）。 */
    private applyListRedDot: RedDot | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bind(this.closeButton, this.onCloseClick);

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

        this.applyListRedDot = this.node.getChildByName('ApplyRedDot')?.getComponent(RedDot) ?? null;

        // 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        this.tab = FriendTab.List;
        this.deleteMode = false;
        this.checked.clear();
        this.searchInput.string = '';
        await this.reload();
    }

    /** 子弹窗（好友申请 / 领取体力）关掉时，本页重新取一次数。 */
    protected onReveal(): void {
        void this.reload();
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
        let snapshot = await this.repo.load();
        if (!this.alive || revision !== this.revision) return;

        // 「添加好友」页签进来时还没有推荐列表就顺手拉一次。
        if (this.tab === FriendTab.Add && snapshot.suggestRows.length === 0) {
            const result = await this.repo.refreshSuggest(this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'ok') {
                snapshot = await this.repo.load();
                if (!this.alive || revision !== this.revision) return;
            }
        }

        // 底图先备好再铺界面，避免「先出框后补图」的闪烁。
        await this.loadStaticFrames();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
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
        this.applyListRedDot?.setRedDot(layout.showApplyList ? snapshot.applyRows.length : 0, RED_DOT_TYPE_NUMBER);
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

        // v2 顶部统计卡：好友页两张卡，黑名单单独一张卡
        this.statBar.active = layout.showFriendCount || layout.showSendTimes;
        this.blackStatBar.active = layout.showBlackCount;

        // v2 标签行：标题随页签 / 删除模式，人数在删除模式让位给「已选择 N 人」
        this.tagTitleLabel.string = this.tagTitle();
        this.tagCountLabel.string = formatText(FRIEND_TAG_COUNT_TEMPLATE, this.tagCount(snapshot));
        this.tagCountLabel.node.active = !this.deleteMode;
        this.removeCountPill.active = layout.showRemoveCount;

        this.presentRows(snapshot);
    }

    /** 标签行标题（删除模式下固定为「批量删除」）。 */
    private tagTitle(): string {
        if (this.deleteMode && this.tab === FriendTab.List) return FRIEND_TAG_REMOVE;
        if (this.tab === FriendTab.Add) return FRIEND_TAG_ADD;
        if (this.tab === FriendTab.Black) return FRIEND_TAG_BLACK;
        return FRIEND_TAG_LIST;
    }

    /** 标签后人数：与列表同源，不再单独请求。 */
    private tagCount(snapshot: IFriendSnapshot): number {
        if (this.tab === FriendTab.Add) return snapshot.suggestRows.length;
        if (this.tab === FriendTab.Black) return snapshot.blackRows.length;
        return snapshot.friendRows.length;
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
            tabs[index].render(FRIEND_TAB_LABELS[index], index === this.tab, null, frames?.on ?? null);
        }
    }

    /**
     * 组装并铺列表。行数据必须在 `refreshList` 之前算完（异步预加载读不到 `this.rows`）。
     */
    private presentRows(snapshot: IFriendSnapshot): void {
        const source = {
            friendRows: snapshot.friendRows,
            suggestRows: snapshot.suggestRows,
            blackRows: snapshot.blackRows,
        };
        const data = rowsOfTab(this.tab, source);

        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            views.push(buildFriendRowView(this.tab, row, FRIEND_ROW_TEXTS, {
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

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index 现取）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendRow);

        row.onAction = () => this.dispatchRow(this.rowIds[index], (id) => void this.onRowAction(id));
        row.onChat = () => this.dispatchRow(this.rowIds[index], (id) => this.onRowChat(id));
        row.onCheck = () => this.dispatchRow(this.rowIds[index], (id) => this.onRowCheck(id));

        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view, this.rowButtonFrames);
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
        if (this.tab === FriendTab.Black) {
            await this.runRequest(this.repo.blackRemove(id, this), FRIEND_TIP_REMOVE_BLACK_OK);
            return;
        }
        if (this.tab === FriendTab.Add) {
            await this.runRequest(this.repo.apply(id, this), FRIEND_TIP_APPLY_OK);
            return;
        }
        // 好友列表：次数用完时只提示、不置灰。
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
     * 这里不重铺整个列表 —— `refreshList` 会把滚动位置复位到顶部，勾到第 8 个人时会弹回第 1 个。
     */
    private onRowCheck(id: string): void {
        if (!this.deleteMode) return;
        if (this.checked.has(id)) this.checked.delete(id);
        else this.checked.add(id);
        this.refreshCheckedRow(id);

        if (this.snapshot) {
            this.removeCountLabel.string = formatText(FRIEND_REMOVE_SELECT_TEMPLATE, this.checked.size);
        }
    }

    private refreshCheckedRow(id: string): void {
        const snapshot = this.snapshot;
        const index = this.rowIds.indexOf(id);
        if (!snapshot || index < 0) return;
        const row = snapshot.friendRows.find((item) => item.id === id);
        if (!row) return;

        const view = buildFriendRowView(this.tab, row, FRIEND_ROW_TEXTS, {
            nowMs: snapshot.now,
            deleteMode: this.deleteMode,
            checked: this.checked.has(id),
            applied: snapshot.appliedIds.has(id),
            leftSendTimes: snapshot.leftSendTimes,
            chatAvailable: FRIEND_CHAT_AVAILABLE,
        });
        this.rows[index] = view;

        const node = this.rowList.getItemByIndex(index);
        const item = node.getComponent(FriendRow);
        item.render(view, this.rowButtonFrames);
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
            FW.showTip(formatText(FRIEND_REMOVE_SELECT_TEMPLATE, 0));
            return;
        }
        await this.runRequest(this.repo.remove(Array.from(this.checked), this), FRIEND_TIP_DELETE_OK);
        this.checked.clear();
    }

    private async onRefreshClick(): Promise<void> {
        await this.requestSuggestList(this.repo.refreshSuggest(this));
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
        await this.requestSuggestList(this.repo.search(parsed, this));
    }

    /** 「换一批」与搜索共用的收尾：成功后刷新列表，列表为空给提示。 */
    private async requestSuggestList(task: Promise<FriendRequestResult>): Promise<void> {
        const result = await task;
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

    /** 选中页签底图 + 行主按钮三张底图；首次之后走缓存。 */
    private async loadStaticFrames(): Promise<void> {
        if (!this.tabFrames) {
            const on = await loadArt(FRIEND_ART_TAB_ON, FRIEND_ART_TAB_ON_ROOT);
            this.tabFrames = { on };
        }
        if (!this.rowButtonFrames) {
            const [gold, blue, mute] = await Promise.all([
                loadArt(FRIEND_ART_BTN_GOLD, FRIEND_ART_BTN_GOLD_ROOT),
                loadArt(FRIEND_ART_BTN_BLUE, FRIEND_ART_BTN_BLUE_ROOT),
                loadArt(FRIEND_ART_BTN_DARK, FRIEND_ART_ROOT),
            ]);
            this.rowButtonFrames = { gold, blue, mute };
        }
    }

    /** 底部三个页签（按 x 排序 —— 子节点序不等于视觉序）。 */
    private get tabButtons(): FriendTabButton[] {
        return this.tabBar.getComponentsInChildren(FriendTabButton)
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

    /** `isPopupOpen` 在关闭时立即转 false ⇒ 在飞结果不会再写已回收的 Label。 */
    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}
