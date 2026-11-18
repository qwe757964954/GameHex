/**
 * 「领取体力」弹窗（`assets/bundles/main-pages/ui/Friend/FriendGetEnd.prefab`）。
 *
 * 由 `FriendPage.onGetEndClick` 打开（那一层已先判过 `leftGetTimes`）；关掉时
 * `PopupManager` 给主容器补发 reveal，主容器重新取数。本弹窗每次打开也重新取数。
 *
 * 列表口径与主容器三页签不同：只取好友列表里 `todayReceive && !todayTake` 的人
 * （`FriendTable.pickGetEndRows`），行内「体力数:N」的 N 取 `gameConfig.friendAddEndPerTime`。
 *
 * 这里没有「空列表」这一态：prefab 里没有 `数据` controller，没有数据时列表就是空的，
 * 「一键领取」照旧显示 —— 但次数用完时点它会弹提示，而不是像老端那样静默 return。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { friendRepository } from './FriendRepository';
import type { FriendRequestResult, IFriendRepository, IFriendSnapshot } from './FriendRepository';
import { FriendGetEndRow } from './FriendGetEndRow';
import { buildFriendRowView, IFriendRowView, pickGetEndRows } from './FriendTable';
import {
    FRIEND_BTN_GET_END_ONE_KEY,
    FRIEND_GET_END_TIMES_TEMPLATE,
    FRIEND_ROW_TEXTS,
    FRIEND_TIP_GET_MAX,
    FRIEND_TIP_GET_OK,
    FRIEND_TIP_OFFLINE,
    FRIEND_TIP_REQUEST_FAILED,
    formatText,
} from './FriendTexts';

const { ccclass, property } = _decorator;

@ccclass('FriendGetEndPage')
export class FriendGetEndPage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/Friend/`）：热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 才会失败。
     */
    static prefabPath = 'ui/Friend/FriendGetEnd';

    @property({ type: Node, tooltip: 'Popup/CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'Popup/RowView：可领取列表（虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'Popup/GetEndOneKeyBtn：一键领取' })
    getEndOneKeyButton: Node = null;

    @property({ type: Label, tooltip: 'GetEndOneKeyBtn/Label：文案' })
    getEndOneKeyLabel: Label = null;

    @property({ type: Label, tooltip: 'Popup/TimesLabel：「今日还可领取N次」' })
    timesLabel: Label = null;

    /** 数据端口；测试可注入替身。 */
    private repo: IFriendRepository = friendRepository;

    private snapshot: IFriendSnapshot | null = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: IFriendRowView[] = [];

    /** 与 `rows` 下标一一对应的 id（回调靠它认行）。 */
    private rowIds: string[] = [];

    /** 请求未返回时忽略后续点击。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bind(this.closeButton, this.onCloseClick);
        this.bind(this.getEndOneKeyButton, this.onGetEndOneKeyClick);

        // 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        await this.reload();
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

        // `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`：
        // 不 defer 一帧的话 `refreshList` 会落在「槽位还没建」的空档，列表全空。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.snapshot = snapshot;
        this.present();
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        this.getEndOneKeyLabel.string = FRIEND_BTN_GET_END_ONE_KEY;
        this.timesLabel.string = formatText(FRIEND_GET_END_TIMES_TEMPLATE, snapshot.leftGetTimes);

        const data = pickGetEndRows(snapshot.friendRows);
        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            // `kind = 'take'`：主按钮固定「领取」、不置灰，并带上「体力数:N」那一列，
            // N 就是这次能领到的数量。
            views.push(buildFriendRowView('take', row, FRIEND_ROW_TEXTS, {
                nowMs: snapshot.now,
                deleteMode: false,
                checked: false,
                applied: false,
                leftSendTimes: snapshot.leftSendTimes,
                chatAvailable: false,
                endNum: snapshot.config.endPerTime,
            }));
        }
        this.rows = views;
        this.rowIds = ids;

        this.rowList.refreshList(views);
        this.rowList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index 现取）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendGetEndRow);

        row.onAction = () => this.dispatchRow(this.rowIds[index], (id) => void this.onGetEnd(id));

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
    // 交互
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 领取某个好友的体力；次数用完时弹提示，不静默返回。 */
    private async onGetEnd(id: string): Promise<void> {
        if (!this.hasLeftGetTimes()) {
            FW.showTip(FRIEND_TIP_GET_MAX);
            return;
        }
        await this.runRequest(this.repo.getEnd(id, this), FRIEND_TIP_GET_OK);
    }

    private async onGetEndOneKeyClick(): Promise<void> {
        if (!this.hasLeftGetTimes()) {
            FW.showTip(FRIEND_TIP_GET_MAX);
            return;
        }
        await this.runRequest(this.repo.getEndOneKey(this), FRIEND_TIP_GET_OK);
    }

    /** 表还没读到（`takeEndTimes = 0`）时也算「次数用完」—— 比放过去发一个注定被拒的请求好。 */
    private hasLeftGetTimes(): boolean {
        return (this.snapshot?.leftGetTimes ?? 0) > 0;
    }

    // ============================================================
    // 工具
    // ============================================================

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
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}
