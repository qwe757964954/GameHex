/**
 * 「好友申请」弹窗（`assets/bundles/main-pages/ui/Friend/FriendApply.prefab`）。
 *
 * 由 `FriendPage.onApplyListClick` 打开；关掉时 `PopupManager` 会给主容器补发 reveal，
 * 主容器 `onReveal` 重新取数（同意 / 拒绝后好友数会变）。本弹窗每次打开也重新取数。
 *
 * 两处有意不跟老端：
 *   1. 老端空态会把 list 节点一起隐藏。这里只 `refreshList([])`，不动 list 的 active ——
 *      `VirtualScrollView` 的槽位在 `start()` 里建，节点被 `PopupManager` 回收并隐藏后再复用
 *      不会重跑 `start()`，一隐藏就等于把「槽位已建好」的前提打掉，下次有数据会铺在
 *      不存在的槽位上（不报错，列表空白）。
 *   2. 老端两个一键按钮的前置条件写的是「今日领取次数 <= 0 则 return」（从「领取粮草」复制来的，
 *      申请列表跟领取次数无关）。这里只要列表有数据就发请求，没数据时按钮本来就隐藏。
 */

import { _decorator, Button, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { friendRepository } from './FriendRepository';
import type { FriendRequestResult, IFriendRepository, IFriendSnapshot } from './FriendRepository';
import { FriendApplyRow } from './FriendApplyRow';
import { buildFriendRowView, FriendTab, IFriendRowView } from './FriendTable';
import {
    FRIEND_APPLY_EMPTY,
    FRIEND_BTN_AGREE_ONE_KEY,
    FRIEND_BTN_REFUSE_ONE_KEY,
    FRIEND_ROW_TEXTS,
    FRIEND_TIP_AGREE_OK,
    FRIEND_TIP_AGREE_ONE_KEY_OK,
    FRIEND_TIP_OFFLINE,
    FRIEND_TIP_REFUSE_OK,
    FRIEND_TIP_REFUSE_ONE_KEY_OK,
    FRIEND_TIP_REQUEST_FAILED,
} from './FriendTexts';

const { ccclass, property } = _decorator;

@ccclass('FriendApplyPage')
export class FriendApplyPage extends PopupBase {
    /**
     * 目录名大小写必须与磁盘一致（`ui/Friend/`）：热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上 `resources.load` 才会失败。
     */
    static prefabPath = 'ui/Friend/FriendApply';

    @property({ type: Node, tooltip: 'Popup/CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'Popup/RowView：申请列表（虚拟列表 + Mask）' })
    applyList: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'Popup/RefuseOneKeyBtn：一键拒绝（有申请时才显示）' })
    refuseOneKeyButton: Node = null;

    @property({ type: Label, tooltip: 'RefuseOneKeyBtn/Label：文案' })
    refuseOneKeyLabel: Label = null;

    @property({ type: Node, tooltip: 'Popup/AgreeOneKeyBtn：一键同意（有申请时才显示）' })
    agreeOneKeyButton: Node = null;

    @property({ type: Label, tooltip: 'AgreeOneKeyBtn/Label：文案' })
    agreeOneKeyLabel: Label = null;

    @property({ type: Label, tooltip: 'Popup/EmptyLabel：「暂无申请」（没有申请时才显示）' })
    emptyLabel: Label = null;

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
        this.bind(this.refuseOneKeyButton, this.onRefuseOneKeyClick);
        this.bind(this.agreeOneKeyButton, this.onAgreeOneKeyClick);

        // 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.applyList.renderItemFn = (node, index) => this.renderRow(node, index);
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

        this.snapshot = snapshot;
        this.present();
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;

        const data = snapshot.applyRows;
        const hasData = data.length > 0;

        // 有数据时显示两个一键按钮，没有时显示「暂无申请」。
        // 只切按钮 / 空态文案，不动 list 节点本身的 active（原因见文件头）。
        this.refuseOneKeyButton.active = hasData;
        this.agreeOneKeyButton.active = hasData;
        this.refuseOneKeyLabel.string = FRIEND_BTN_REFUSE_ONE_KEY;
        this.agreeOneKeyLabel.string = FRIEND_BTN_AGREE_ONE_KEY;
        this.emptyLabel.string = FRIEND_APPLY_EMPTY;
        this.emptyLabel.node.active = !hasData;

        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            // `kind = Add`：`FriendApplyRow` 不消费按钮语义，但等级 / 名字 / 战力 / 头像要，
            // 所以仍走同一个纯函数拿一份结构完整的视图模型。
            views.push(buildFriendRowView(FriendTab.Add, row, FRIEND_ROW_TEXTS, {
                nowMs: snapshot.now,
                deleteMode: false,
                checked: false,
                applied: snapshot.appliedIds.has(row.id),
                leftSendTimes: snapshot.leftSendTimes,
                chatAvailable: false,
            }));
        }
        this.rows = views;
        this.rowIds = ids;

        // 申请列表不长，但换过数据后仍要回顶（拒掉最后一条后再收到新申请时不会停在越界位置）。
        this.applyList.refreshList(views);
        this.applyList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index 现取）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendApplyRow);

        row.onAgree = () => this.dispatchRow(this.rowIds[index], (id) => void this.onAgree(id));
        row.onReject = () => this.dispatchRow(this.rowIds[index], (id) => void this.onReject(id));

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

    /** 同意某人（老端 `按钮_添加` → `requetAdd`）。 */
    private async onAgree(id: string): Promise<void> {
        await this.runRequest(this.repo.agree(id, this), FRIEND_TIP_AGREE_OK);
    }

    /** 拒绝某人（老端 `按钮_拒绝` → `requetRefuse`）。 */
    private async onReject(id: string): Promise<void> {
        await this.runRequest(this.repo.refuse(id, this), FRIEND_TIP_REFUSE_OK);
    }

    private async onAgreeOneKeyClick(): Promise<void> {
        await this.runRequest(this.repo.agreeOneKey(this), FRIEND_TIP_AGREE_ONE_KEY_OK);
    }

    private async onRefuseOneKeyClick(): Promise<void> {
        await this.runRequest(this.repo.refuseOneKey(this), FRIEND_TIP_REFUSE_ONE_KEY_OK);
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
