/**
 * 「好友申请」弹窗（老端 `LayerFriendApply`，`assets/resources/ui/Friend/FriendApply.prefab`）。
 *
 * ## 版面（真源 = FGUI `好友/组件/弹窗_好友_申请列表.xml`，720×1280）
 *
 *   popBg  (346,182) pivot 0.5,0  626×882        ← `组件_公共弹窗_新`，标题「好友申请」
 *   list   (64,254) 564×638       overflow=scroll，`defaultItem` = `组件_申请列表项`
 *   按钮_一键拒绝 (148,952) 150×70  `颜色,0`（深色）
 *   按钮_一键同意 (378,952) 150×70  `颜色,1`（金色）
 *   n63「暂无申请」(293,522) pivot 0.5,0  84×29
 *
 * ## 与主容器的关系
 *
 * 由 `FriendPage.onApplyListClick` 打开。关掉时 `PopupManager._refreshCover()` 会给主容器
 * 补发 `_internalReveal()` ⇒ 主容器 `onReveal` 重新取数（同意 / 拒绝后好友数会变）。
 * 本弹窗自己也**每次打开都重新取数**（它是最上层，没有「被盖住」这件事）。
 *
 * ## 两处**有意偏离**老端（都写在 `present()` 里）
 *
 * ① 老端 `refreshView` 用 `com.setSelectedPage("数据", datas.length>0?"有":"空")`，
 *    「空」那一支会把 **list 一起隐藏**。这里**不隐藏 list 节点**，只 `refreshList([])` ——
 *    `VirtualScrollView` 的槽位是在 `start()` 里建的，节点被隐藏过再复用（`PopupManager`
 *    会回收节点）时 `start()` 不会重跑，一隐藏就等于把「槽位已建好」这个前提打掉，
 *    下次有数据进来会铺在一堆不存在的槽位上（**不报错，列表空白**）。
 *    列表节点本身没有底图 / 装饰，留着不影响观感。
 * ② 老端两个一键按钮的前置条件是 `getLeftGetTimes() <= 0 则 return` —— 这是从「领取粮草」
 *    复制过来的（申请列表跟「今日领取次数」没有任何关系，是**老端的 bug**）。
 *    这里不抄它：只要列表里有数据就发请求（没数据时两个按钮本来就隐藏）。
 *    不静默：请求结果照常走三态提示。
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
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/Friend/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
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

        this.bind(this.refuseOneKeyButton, this.onRefuseOneKeyClick);
        this.bind(this.agreeOneKeyButton, this.onAgreeOneKeyClick);

        // ⚠️ 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）。
        this.applyList.renderItemFn = (node, index) => this.renderRow(node, index);
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

        const data = snapshot.applyRows;
        const hasData = data.length > 0;

        // 老端 `setSelectedPage("数据", hasData ? "有" : "空")`
        // ⚠️ 只切按钮 / 空态文案，**不动 list 节点本身的 active**（原因见文件头 ①）。
        this.refuseOneKeyButton.active = hasData;
        this.agreeOneKeyButton.active = hasData;
        this.refuseOneKeyLabel.string = FRIEND_BTN_REFUSE_ONE_KEY;
        this.agreeOneKeyLabel.string = FRIEND_BTN_AGREE_ONE_KEY;
        this.emptyLabel.string = FRIEND_APPLY_EMPTY;
        this.emptyLabel.node.active = !hasData;

        const texts = FRIEND_ROW_TEXTS;
        const views: IFriendRowView[] = [];
        const ids: string[] = [];
        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            ids.push(row.id);
            // `kind = add`：主按钮语义是「申请 / 已申请」—— `FriendApplyRow` 不消费这几个字段，
            // 但等级 / 名字 / 战力 / 头像要，所以仍走同一个纯函数拿一份结构完整的视图模型。
            views.push(buildFriendRowView(FriendTab.add, row, texts, {
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

        // 申请列表不长，但换过数据后仍要回顶（拒掉最后一条后再收到新申请时不会停在越界位置）
        this.applyList.refreshList(views);
        this.applyList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(FriendApplyRow);
        if (!row) return;

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
        return !!this.node && this.node.isValid;
    }
}
