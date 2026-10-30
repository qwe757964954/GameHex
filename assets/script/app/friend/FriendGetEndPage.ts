/**
 * 「领取体力」弹窗（老端 `LayerFriendGetEnd`，`assets/resources/ui/Friend/FriendGetEnd.prefab`）。
 *
 * ## 版面（真源 = FGUI `好友/组件/弹窗_好友_领取粮草.xml`，720×1280）
 *
 *   popBg  (346,182) pivot 0.5,0  626×882      ← `组件_公共弹窗_新`，标题「领取体力」
 *   list   (64,254) 564×638       `defaultItem` = `组件_领取粮草项`
 *   文本_赠送次数 (332,917) pivot 0.5,0  155×29  右对齐「今日还可领取N次」
 *   按钮_一键领取 (256,952) 150×70  `颜色,1`（金色）
 *
 * ⚠️ 老端在这个类里有两条 `ALIGN_OFFSET_X = 14` / `ALIGN_OFFSET_Y = 9`，把整个 window 从
 *    `(346,182)` 挪到与主容器 `(360,191)` 重合。**Demo3.8 不需要** —— prefab 里直接按
 *    `(360,191)` 摆好（对齐逻辑属于老端窗口管理器的补丁，不是版面本身）。
 *
 * ⚠️ 本弹窗在 FGUI 里**没有** `全面屏适配` 节点、**没有** controller（对照申请列表弹窗是有
 *    `数据` controller 的）⇒ 也就没有「空列表」这一态：`list.update(...)` 是无条件调的。
 *    这里保持一致 —— 没有数据时列表就是空的，「一键领取」照旧显示（点了会得到 0 条的效果，
 *    但**不会静默**：`leftGetTimes <= 0` 时点它会给提示，见下）。
 *
 * ## 数据来源（只来自好友列表，**不是**主容器三页签的口径）
 *
 * 列表 = `FriendTable.pickGetEndRows(snapshot.friendRows)`
 *      = `todayReceive && !todayTake` 的人（老端 `ModelFriend.getGetEndList()`）。
 * 行内「体力数:N」的 N = `gameConfig.friendAddEndPerTime`（老端 `getAddEndNum()`）。
 *
 * ## 与主容器的关系
 *
 * 由 `FriendPage.onGetEndClick` 打开（那一层已经先判过 `leftGetTimes`）。关掉时
 * `PopupManager._refreshCover()` 给主容器补发 `onReveal` ⇒ 主容器重新取数。
 * 本弹窗自己每次打开也重新取数。
 *
 * ## 一处**有意偏离**老端
 *
 * 老端 `onClickGetEnd` / `onClickGetEndOneKey` 的前置条件是 `getLeftGetTimes() <= 0 则 return`
 * —— **静默返回**（点了什么都不发生）。这里改成弹提示 `FRIEND_TIP_GET_MAX`：
 * 「次数用完」是用户需要知道的信息，不应该靠界面不动来表达。
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
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/Friend/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
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

    /** 一个请求还没回来时忽略后续点击。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        const close = this.closeButton.getComponent(Button);
        close?.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        this.bind(this.getEndOneKeyButton, this.onGetEndOneKeyClick);

        // ⚠️ 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        this.busy = false;
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
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

        // ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
        //    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        this.getEndOneKeyLabel.string = FRIEND_BTN_GET_END_ONE_KEY;
        this.timesLabel.string = formatText(FRIEND_GET_END_TIMES_TEMPLATE, snapshot.leftGetTimes);

        const data = pickGetEndRows(snapshot.friendRows);
        const texts = FRIEND_ROW_TEXTS;
        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            // `kind = 'take'`：主按钮固定「领取」、不置灰，并带上「体力数:N」那一列 ——
            // `endNum` 就是这次能领到的数量（老端 `getAddEndNum()` = `friendAddEndPerTime`）。
            views.push(buildFriendRowView('take', row, texts, {
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

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendGetEndRow);
        if (!row) return;

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

    /**
     * 领取某个好友的体力。
     *
     * ⚠️ 次数用完时**弹提示**而不是静默返回（老端是 `return`，见文件头「有意偏离」）。
     */
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
        return !!this.node && this.node.isValid;
    }
}
