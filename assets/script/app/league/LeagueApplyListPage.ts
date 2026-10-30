/**
 * 「申请列表」弹窗（老端 `play/LayerLeagueHallApprove`，`ui/League/LeagueApplyList`）。
 *
 * ## 版面（真源 = FGUI `主界面_联盟/大厅/组件_联盟_大厅_申请列表.xml`，720×1280）
 *
 * | FGUI | xy / size | 本节点 |
 * |---|---|---|
 * | `popBg`（公用 `组件_公共弹窗_新`，标题「申请管理」） | (40,287) **640×706** | `PopupBg` + `TitleBg` + `TitleDeco` + `Title` + `CloseBtn` |
 * | `requestList`（`overflow=scroll`） | (90,349) **540×446** | `ApplyListView`（虚拟列表） |
 * | `defaultItem` = `组件_联盟_联盟角色申请`（行底框 540×128） | — | `ApplyListView/content/ApplyRow` |
 * | `btn_applyall`（`按钮_公共_通用`，`TY_btn10`） | (386,810) 218×106 | `BtnAllAgree` |
 * | `btn_noapplyall`（`按钮_公共_通用`，`TY_btn09`） | (113,810) 218×106 | `BtnAllReject` |
 *
 * `popBg` 那组的 relation 是 `center-center,middle-middle`，老端又调了 `toFullCenterParent`
 * ⇒ 弹窗**恒居中**（FGUI 里那对 xy 只是设计态坐标，不用照抄）；底板图见
 * `LeagueArt.LEAGUE_ART_POPUP_BOARD` 的说明（第四刀换成真九宫格底板）。
 *
 * ## 老端行为（`LayerLeagueHallApproveUI`）与移植取舍
 *
 * 1. **数据靠推送刷新**：老端 `init()` 里 `toolSet.addListener(VOUnionApplysBag, "OnChanged", updateView)`
 *    —— 面板自己**不发** `RequestUnionApplyList`，只等推送。本端为「打开即一定有数据」，
 *    在 `onOpen` 里**主动拉一次**（`requestApplyList`）再读缓存（`ILeagueRepository` 口径）。
 * 2. **两个批量按钮先判空再发包**：
 *    `if (!nowApplyArr || nowApplyArr.length == 0) return;` ⇒ 空列表**不发包**（`canApproveAll`）。
 * 3. **行内两颗按钮**：`btn_kick` = 拒绝（`agree=false`）、`btn_sure` = 同意（`agree=true`）；
 *    点头像 = `CtrlMgr.CtrlPlayer.openOtherPlayerInfo(applyId, serverId, selectServerId)`（他人信息面板未落地）。
 * 4. **写操作后刷新**：老端靠推送，本端在写成功后**再拉一次**列表（见 `afterWrite`）。
 *    另加一道**防连点闸门** `busy` —— 老端没有，但写操作会走 5s 超时，
 *    连点会重复发包（**这是本端有意加的一道**，与「详情行把盟主提到最前」同性质的稳健性增量）。
 */

import { _decorator, Button, Node } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { LeagueApplyRow, type LeagueApplyAction } from './LeagueApplyRow';
import { leagueRepository, type ILeagueRepository, type LeagueRequestResult } from './LeagueRepository';
import {
    buildLeagueApplyViews,
    canApproveAll,
    type ILeagueApplyView,
} from './LeagueTable';
import {
    LEAGUE_APPLY_TITLE,
    LEAGUE_TIP_FAILED,
    LEAGUE_TIP_OFFLINE,
} from './LeagueTexts';
import { CommonTips } from '../common/CommonTips';

const { ccclass, property } = _decorator;

@ccclass('LeagueApplyListPage')
export class LeagueApplyListPage extends PopupBase {
    /**
     * ⚠️ 目录名大小写必须与磁盘一致（`ui/League/`）—— 热更新 zip 内路径大小写敏感，
     * 在 Windows 编辑器里怎么写都能跑，真机上才会 `resources.load` 失败、开出一个空弹窗。
     */
    static prefabPath = 'ui/League/LeagueApplyList';

    @property({ type: Node, tooltip: 'CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: 'ApplyListView：申请列表（虚拟列表 + Mask）' })
    applyList: VirtualScrollView = null;

    @property({ type: Node, tooltip: 'BtnAllAgree：全部同意' })
    allAgreeButton: Node = null;

    @property({ type: Node, tooltip: 'BtnAllReject：全部拒绝' })
    allRejectButton: Node = null;

    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: ILeagueApplyView[] = [];

    /** 本次有没有待审批的申请（`canApproveAll` 的入参）。 */
    private pendingCount = 0;

    /** 写操作在飞（防连点）。 */
    private busy = false;

    /** 每次取数递增，用来作废在飞的异步结果。 */
    private revision = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    /**
     * 三颗按钮的节点在 `LeagueApplyList.prefab` 上都挂了 `cc.Button` ⇒ 统一监听节点 `CLICK`。
     *
     * 不再用「只绑一次」的布尔门闩：`onInit` 每个实例只跑一次（换页复用走 `onOpen`），
     * 而 `node.on` 的监听随节点销毁一起释放；即便重复订阅，`EventTarget` 也会按
     * `callback + target` 去重（下面两个 handler 是箭头函数属性，引用稳定）。
     */
    protected onInit(): void {
        this.closeButton.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.allAgreeButton.on(Button.EventType.CLICK, this.handleAgreeAll, this);
        this.allRejectButton.on(Button.EventType.CLICK, this.handleRejectAll, this);
        // `renderItemFn` 是普通属性赋值（不是事件订阅）⇒ 重复赋同一个函数不会叠加
        this.applyList.renderItemFn = (node, index) => this.renderRow(node, index);
    }

    protected async onOpen(): Promise<void> {
        await this.reload();
    }

    protected onClose(): void {
        this.revision += 1;
    }

    onDestroy(): void {
        this.revision += 1;
        super.onDestroy();
    }

    // ============================================================
    // 取数
    // ============================================================

    /** 弹窗标题（供单测 / 复用方取，避免到处写中文字面量）。 */
    static get titleText(): string {
        return LEAGUE_APPLY_TITLE;
    }

    /** 数据端口（单测 / 探针可换成内存桩）。 */
    protected get repository(): ILeagueRepository {
        return leagueRepository;
    }

    /**
     * 拉一次申请列表 + 铺行。
     *
     * ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
     *    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
     */
    private async reload(): Promise<void> {
        const revision = ++this.revision;

        const result = await this.repository.requestApplyList(this);
        if (!this.alive || revision !== this.revision) return;

        const snapshot = await this.repository.load();
        if (!this.alive || revision !== this.revision) return;

        this.pendingCount = snapshot.applys.length;
        this.rows = buildLeagueApplyViews(snapshot.applys);

        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();

        // 拉失败仍然把缓存里的东西铺出来（离线时界面不该是空的），另给一条提示。
        if (result !== 'ok') FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    private present(): void {
        this.applyList.refreshList(this.rows);
        this.applyList.scrollToTop(false);
    }

    /** 虚拟列表的行渲染（槽位会被 clone 复用 ⇒ 回调里按 index **现取**）。 */
    private renderRow(node: Node, index: number): void {
        const row = node.getComponent(LeagueApplyRow);
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.render(view);
        // 行自己的按钮回调：读取「点击那一刻」这一槽位上的数据（槽位复用到哪行就是哪行）
        row.onAction = (action, current) => void this.approveOne(action, current);
        row.onAvatar = (current) => this.openApplicant(current);
    }

    // ============================================================
    // 审批
    // ============================================================

    /** 行内「同意 / 拒绝」（老端 `btn_sure` / `btn_kick`）。 */
    private async approveOne(action: LeagueApplyAction, view: ILeagueApplyView): Promise<void> {
        if (!this.beginWrite()) return;
        try {
            const result = await this.repository.approveApply(view.applyId, action === 'agree', this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /** 「全部同意 / 全部拒绝」—— 空列表不发包（老端两句守卫）。 */
    private async approveAll(agree: boolean): Promise<void> {
        if (!canApproveAll(this.rows) || this.pendingCount <= 0) return;
        if (!this.beginWrite()) return;
        try {
            const result = await this.repository.approveApplyOneKey(agree, this);
            await this.afterWrite(result);
        } finally {
            this.busy = false;
        }
    }

    /** 点头像 = 看申请人信息（老端 `openOtherPlayerInfo` 本工程未移植，用联盟自有数据弹轻量资料卡）。 */
    private openApplicant(view: ILeagueApplyView): void {
        this.showApplicantCard(view);
    }

    /** 看申请人：老端走通用玩家信息面板（未移植），这里用申请行已有字段拼一张轻量资料卡。 */
    private showApplicantCard(view: ILeagueApplyView): void {
        const lines = [
            `名称：${view.name}`,
            `等级：${view.levelText}`,
            `战力：${view.powerText}`,
        ];
        void CommonTips.open({
            userData: { title: '申请人信息', content: lines.join('\n'), showCancel: false },
        });
    }

    /** 防连点：写操作在飞时直接拒掉。 */
    private beginWrite(): boolean {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }

    /** 写完后按三态收口；成功则重新拉一次列表（老端靠推送刷新）。 */
    private async afterWrite(result: LeagueRequestResult): Promise<void> {
        if (!this.alive) return;
        if (result === 'ok') {
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }

    // ============================================================
    // 杂项
    // ============================================================

    /** 「全部同意 / 全部拒绝」——箭头函数属性：引用稳定，重复 `on` 会被引擎去重。 */
    private readonly handleAgreeAll = (): void => {
        void this.approveAll(true);
    };

    private readonly handleRejectAll = (): void => {
        void this.approveAll(false);
    };

    private onCloseClick(): void {
        this.closeByButton();
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
