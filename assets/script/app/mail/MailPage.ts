/**
 * 「邮件」主容器（老端 `LayerMail`）。
 *
 * 结构逐节点对齐 FGUI `邮件/组件/组件_邮件_主界面.xml`：
 *   `PanelBg → TitleBg → Title → CloseBtn → RowView → BatchRemoveBtn → GetOneKeyBtn → EmptyLabel → AutoDeleteLabel`
 *
 * ⚠️ **不加任何整体偏移**：原稿 `popBg xy=13,128 size=680,946` 就是 **720×1280 画布坐标**。
 *   早期笔记里「原稿是 706×1202 ⇒ 整体 `(+7,+39)`」的推导**是错的** —— 那个 706 只是
 *   `group n47_fokg` 框住了 popBg 自己（普通组的框 = 成员并集，不是独立证据）；
 *   全工程 249 个 `size="720,1280"` 组件里 194 个对称于 720 ⇒ 基准就是 720。
 *   三条反证见 `tmp/_mail_geom_check.mjs`（120 项）与 `tests/mail.test.ts` C4（容差 0.5px）。
 *
 * ## 三条时序铁律（都在本文件里，且都**静默失效**）
 *
 * ① `rowList.renderItemFn` **只在 `onInit` 里绑一次**，回调按 `index` 现取 `this.rows[index]`
 *    —— 禁闭包捕获本趟入参（否则 reload 后界面永远停在第一份快照）。
 * ② `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
 *    ⇒ 必须 `await this.nextPopupFrame()` 再 `refreshList`，否则列表**一片空白**。
 * ③ 行底图必须在 `refreshList` **之前**取完（`loadRowArt`），否则复用条目会闪上一行的图。
 */

import { _decorator, Button, Label, SpriteFrame } from 'cc';
import { loadArt } from '../card/CardLineupIcons';
import { CommonTips } from '../common/CommonTips';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { mailRowArt } from './MailArt';
import type { IMailRowArt } from './MailRow';
import { MailRow } from './MailRow';
import { IMailSnapshot, IMailRepository, mailRepository } from './MailRepository';
import { MailDetailPage } from './MailDetailPage';
import {
    autoDeleteArgs,
    buildMailRowView,
    IMailRowView,
    MAIL_STATE_READ as MAIL_STATE_READ_NUM,
    MAIL_STATE_UNREAD,
    pickDeletableIds,
    pickTakeIds,
} from './MailTable';
import {
    formatText,
    MAIL_AUTO_DELETE_TEMPLATE,
    MAIL_BTN_DELETE_ONE_KEY,
    MAIL_BTN_TAKE_ONE_KEY,
    MAIL_CONFIRM_CANCEL,
    MAIL_CONFIRM_OK,
    MAIL_DELETE_CONFIRM,
    MAIL_EMPTY,
    MAIL_STATE_READ,
    MAIL_TIME_DAYS,
    MAIL_TIME_HOURS,
    MAIL_TIME_JUST_NOW,
    MAIL_TIME_MINUTES,
    MAIL_TIP_DELETE_OK,
    MAIL_TIP_NO_DELETABLE,
    MAIL_TIP_OFFLINE,
    MAIL_TIP_REQUEST_FAILED,
    MAIL_TIP_TAKE_NONE,
    MAIL_TIP_TAKE_OK,
    MAIL_TITLE,
} from './MailTexts';

const { ccclass, property } = _decorator;

@ccclass('MailPage')
export class MailPage extends PopupBase {
    static prefabPath = 'ui/Mail/Mail';

    @property({ type: Button, tooltip: 'CloseBtn：右上角关闭' })
    closeButton: Button = null!;

    @property({ type: VirtualScrollView, tooltip: 'RowView：邮件列表（自带虚拟列表 + Mask）' })
    rowList: VirtualScrollView = null!;

    @property({ type: Button, tooltip: 'BatchRemoveBtn：一键删除' })
    batchRemoveButton: Button = null!;

    @property({ type: Label, tooltip: 'BatchRemoveBtn/Label：文案' })
    batchRemoveLabel: Label = null!;

    @property({ type: Button, tooltip: 'GetOneKeyBtn：一键领取' })
    getOneKeyButton: Button = null!;

    @property({ type: Label, tooltip: 'GetOneKeyBtn/Label：文案' })
    getOneKeyLabel: Label = null!;

    @property({ type: Label, tooltip: 'EmptyLabel：邮箱内没有任何信件' })
    emptyLabel: Label = null!;

    @property({ type: Label, tooltip: 'AutoDeleteLabel：自动删除提示（带配置占位）' })
    autoDeleteLabel: Label = null!;

    /** 数据端口（测试 / 探针用 `setRepository` 换掉）。 */
    private repo: IMailRepository = mailRepository;

    private snapshot: IMailSnapshot | null = null;
    /** 本趟列表的视图模型（`renderItemFn` 按 index 现取）。 */
    private rows: IMailRowView[] = [];
    private rowArt: IMailRowArt = { unread: null, read: null };
    /** `renderItemFn` 只绑一次。 */
    private rowRendererBound = false;
    /** 同一次刷新里有并发（`onOpen` + `onClose` 回调）时只跑一趟。 */
    private busy = false;
    /** 刷新代数：过期结果直接丢（列表已重建）。 */
    private revision = 0;

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IMailRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // PopupBase 生命周期
    // ============================================================

    protected onInit(): void {
        this.batchRemoveLabel.string = MAIL_BTN_DELETE_ONE_KEY;
        this.getOneKeyLabel.string = MAIL_BTN_TAKE_ONE_KEY;
        this.emptyLabel.string = MAIL_EMPTY;
        this.closeButton?.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.batchRemoveButton?.node.on(Button.EventType.CLICK, this.onBatchRemove, this);
        this.getOneKeyButton?.node.on(Button.EventType.CLICK, this.onGetOneKey, this);

        // ⚠️ 只绑一次，回调按 index 现取（见文件头铁律 ①）
        if (!this.rowRendererBound && this.rowList) {
            this.rowList.renderItemFn = (node, index) => this.renderRow(node, index);
            this.rowRendererBound = true;
        }
    }

    protected async onOpen(): Promise<void> {
        // ⚠️ 铁律 ②：`VirtualScrollView` 在 `start()` 里建槽位，`onOpen` early 于它
        await this.nextPopupFrame();
        await this.reload();
    }

    /** 从详情返回时刷新（详情会把邮件标成已读）。 */
    protected onReveal(): void {
        void this.reload();
    }

    // ============================================================
    // 数据 → 列表
    // ============================================================

    /** 读数据 → 预取行底图 → 铺列表。不抛。 */
    async reload(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const revision = ++this.revision;
        try {
            const snapshot = await this.repo.load(this);
            if (!this.isValid || revision !== this.revision) return;
            this.snapshot = snapshot;

            // ⚠️ 铁律 ③：图要在 `refreshList` 之前取完
            await this.loadRowArt();
            if (!this.isValid || revision !== this.revision) return;

            this.present(snapshot);
        } catch (error) {
            console.error('[Mail] 刷新失败', error);
        } finally {
            this.busy = false;
        }
    }

    /** 两张行底图（未读 / 已读），带缓存。 */
    private async loadRowArt(): Promise<void> {
        if (this.rowArt.unread && this.rowArt.read) return;
        const unreadRef = mailRowArt(MAIL_STATE_UNREAD);
        const readRef = mailRowArt(MAIL_STATE_READ_NUM);
        const [unread, read] = await Promise.all([
            loadArt(unreadRef.name, unreadRef.root),
            loadArt(readRef.name, readRef.root),
        ]);
        this.rowArt = { unread, read };
        if (!unread) console.warn('[Mail] 未读行底图取不到');
        if (!read) console.warn('[Mail] 已读行底图取不到');
    }

    /** 铺列表 + 空态 + 自动删除提示。 */
    private present(snapshot: IMailSnapshot): void {
        // ⚠️ 文案模板一律从 `MailTexts` 取（`MailTable` 里一个中文字面量都没有）
        const texts = {
            readText: MAIL_STATE_READ,
            timeDays: MAIL_TIME_DAYS,
            timeHours: MAIL_TIME_HOURS,
            timeMinutes: MAIL_TIME_MINUTES,
            timeJustNow: MAIL_TIME_JUST_NOW,
        };
        this.rows = snapshot.rows.map((row) => buildMailRowView(row, texts, snapshot.now));

        const list = this.rowList;
        if (list && list.isValid) {
            list.refreshList(this.rows);
            list.scrollToTop(false);
        }

        const empty = this.rows.length === 0;
        this.emptyLabel.node.active = empty;
        this.autoDeleteLabel.node.active = !empty;
        this.autoDeleteLabel.string = formatText(MAIL_AUTO_DELETE_TEMPLATE, ...autoDeleteArgs(snapshot.config));
    }

    /** 渲染一条（列表在条目激活前回调；`index` 越界时整行藏掉）。 */
    private renderRow(node: any, index: number): void {
        const row = node?.getComponent?.(MailRow) as MailRow | null;
        if (!row) return;
        const view = this.rows[index];
        if (!view) {
            row.hide();
            return;
        }
        row.node.active = true;
        // ⚠️ 回调每次重设（同一实例会被复用到别的下标）
        row.onOpen = (id) => this.openDetail(id);
        row.render(view, this.rowArt);
    }

    // ============================================================
    // 交互
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    /**
     * 一键删除：只删**已读且已领**的（老端 `read + take == 0`）。
     * 没有可删的 ⇒ 直接提示；有 ⇒ 弹二次确认。
     */
    private onBatchRemove(): void {
        const ids = pickDeletableIds(this.snapshot?.rows ?? []);
        if (ids.length === 0) {
            FW.showTip(MAIL_TIP_NO_DELETABLE);
            return;
        }
        void CommonTips.open({
            userData: {
                content: MAIL_DELETE_CONFIRM,
                sureText: MAIL_CONFIRM_OK,
                cancelText: MAIL_CONFIRM_CANCEL,
                onSure: () => {
                    void this.runDelete(ids);
                },
            },
        });
    }

    private async runDelete(ids: readonly string[]): Promise<void> {
        const result = await this.repo.deleteMails(ids, this);
        if (!this.isValid) return;
        if (result === 'ok') {
            FW.showTip(MAIL_TIP_DELETE_OK);
            await this.reload();
            return;
        }
        FW.showTip(result === 'offline' ? MAIL_TIP_OFFLINE : MAIL_TIP_REQUEST_FAILED);
    }

    /** 一键领取：收所有**还没领**的（老端 `!cmd.take`）。 */
    private async onGetOneKey(): Promise<void> {
        const ids = pickTakeIds(this.snapshot?.rows ?? []);
        if (ids.length === 0) {
            FW.showTip(MAIL_TIP_TAKE_NONE);
            return;
        }
        const outcome = await this.repo.takeRewards(ids, this);
        if (!this.isValid) return;
        if (outcome.result !== 'ok') {
            FW.showTip(outcome.result === 'offline' ? MAIL_TIP_OFFLINE : MAIL_TIP_REQUEST_FAILED);
            return;
        }
        // 领到了东西才提示成功（`rewards` 为空 = 服务端认为没有可领的，也算成功一次请求）
        FW.showTip(MAIL_TIP_TAKE_OK);
        await this.reload();
    }

    /** 打开详情；关掉后刷新一次（详情把它标成已读）。 */
    private openDetail(id: string): void {
        void MailDetailPage.open({
            userData: { id },
            onClose: () => {
                void this.reload();
            },
        });
    }
}
