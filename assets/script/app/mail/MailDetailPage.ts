/**
 * 「邮件」详情弹窗（老端 `LayerMailVerbose`）。
 *
 * 结构逐节点对齐 FGUI `邮件/组件/组件_邮件_邮件内容.xml`：
 *   `PanelBg → TitleBg → Title → CloseBtn → MailTitle → SplitLine → ContentView → RewardBox → RewardList → TakeBtn → TakenStamp`
 *   （`RewardBox` 里是**横向虚拟列表** `RewardList/content/RewardSlotTemplate`：格子按数据出、由列表的
 *     `NodePool` 复用，见下面「奖励列表」那段）
 *
 * ## 三处**有意偏离** FGUI 原稿（都记在 `tmp/_mail_nodes.md` §5）
 *
 * ① **长文本不做滚动列表**：原稿用 `controller 类型`（短文本 / 长文本）切「一个 Label」与
 *    「一个虚拟列表」。新端统一走 `ContentView`（Label 多行，`<br/>` 换成换行）——
 *    邮件正文一般就几行，再挂一个 `VScrollView` 收益极低。
 * ② **正文框高度固定 400，无奖励时拉到 580**：原稿靠 `gearSize controller="奖励领取"` 切换，
 *    这里在 `applyContentHeight` 里显式做（两个高度常量在 `MailTable`）。
 * ③ **正文不带富文本样式**：原稿是 `richtext ubb="true"`；新端无富文本标签，
 *    文案里也没有颜色标记（`MailTexts` 里不带标记）。
 *
 * ## 奖励列表：**逐条对齐**原稿（不预摆格子）
 *
 * FGUI 是 `列表_奖励列表`（`layout="row" colGap="10" align="center" overflow="scroll"`），
 * 老端 `LayerMailVerbose.InitList()` 用 `initVirtualList(this, RenderListItem)` —— 格数跟数据走、
 * item 由列表池化。新端同样用 `VirtualScrollView` 对齐这三件事：
 *
 * | FGUI | 新端 |
 * |---|---|
 * | `layout="row" colGap="10"` | `VirtualScrollView`（`direction=HORIZONTAL`、`spacing=10`、一行的 `gridCount=1`） |
 * | `align="center"`（只在装得下时生效） | `autoCenter = true`（同一公式 `(视口−内容)/2`，同样只在小内容时生效） |
 * | `overflow="scroll"` | 横向滚动（视口 515 宽，一格 90 + 间距 10 ⇒ 一次最多看 5 格） |
 * | 预摆 8 个 item | 一个 `RewardSlotTemplate`，其余由 `NodePool` 复用 |
 *
 * 所以**没有「第 8 格画到弹窗外」这回事了**：视口挂 `cc.Mask`，超出部分裁掉、可拖出来看。
 * 按钮口径（FGUI `gearText controller="是否领取" pages="0,1" values="领取|删除"`）：
 * **没领** ⇒ 「领取」；**已领** ⇒ 「删除」（老端 `com.getSelectedIndex("是否领取") == 0` 那支）。
 */

import { _decorator, Button, Label, Node, SpriteFrame, UITransform } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import { toIdString } from '../net/RequestGuard';
import { MAIL_QUALITY_FRAME_ROOT, mailRewardIconRef, qualityFrameName } from './MailArt';
import { MailRewardSlot } from './MailRewardSlot';
import { IMailRepository, mailRepository } from './MailRepository';
import {
    detailButtonText,
    IMailDetail,
    MAIL_CONTENT_HEIGHT_NO_REWARD,
    MAIL_CONTENT_HEIGHT_WITH_REWARD,
    MAIL_REWARD_SLOT_COUNT,
    plainMailContent,
} from './MailTable';
import {
    MAIL_BTN_DELETE,
    MAIL_BTN_TAKE,
    MAIL_DETAIL_TITLE,
    MAIL_TIP_DELETE_OK,
    MAIL_TIP_OFFLINE,
    MAIL_TIP_REQUEST_FAILED,
    MAIL_TIP_TAKE_OK,
} from './MailTexts';

const { ccclass, property } = _decorator;

@ccclass('MailDetailPage')
export class MailDetailPage extends PopupBase {
    static prefabPath = 'ui/Mail/MailDetail';

    @property({ type: Button, tooltip: 'CloseBtn：右上角关闭' })
    closeButton: Button = null;

    @property({ type: Label, tooltip: 'MailTitle：邮件标题' })
    titleLabel: Label = null;

    @property({ type: Node, tooltip: 'ContentView：正文（Label 多行；无奖励时会拉高）' })
    contentNode: Node = null;

    @property({ type: Label, tooltip: 'ContentView：正文字（本节点上的 cc.Label）' })
    contentLabel: Label = null;

    @property({ type: Node, tooltip: 'RewardBox：奖励底框（有奖励才显示）' })
    rewardBox: Node = null;

    /**
     * 奖励列表（`RewardBox/RewardList`）：横向 `VirtualScrollView`，item 模板是它
     * `content` 的首子节点 `RewardSlotTemplate`（挂 `MailRewardSlot`）。
     *
     * 格数由数据决定、格子由组件内部的 `NodePool` 复用 —— 宿主**不再**持有 N 个格子引用
     * （旧形态是 `rewardSlots: Node[]` 预摆 8 个，与工程其它模块的 `rewardBar` 口径也不一致）。
     */
    @property({ type: VirtualScrollView, tooltip: 'RewardList：奖励横向列表（格数与回收交给它）' })
    rewardList: VirtualScrollView = null;

    @property({ type: Button, tooltip: 'TakeBtn：领取 / 删除' })
    takeButton: Button = null;

    @property({ type: Label, tooltip: 'TakeBtn/Label：按钮文案（领取 / 删除）' })
    takeLabel: Label = null;

    @property({ type: Node, tooltip: 'TakenStamp：「已领取」印章（已领取才显示）' })
    takenStamp: Node = null;

    private repo: IMailRepository = mailRepository;
    private detail: IMailDetail | null = null;
    private mailId = '';
    private busy = false;
    /** 每个格子要用的图（一次取完，`renderItemFn` 里按 index 同步派发）。 */
    private rewardFrames: readonly (readonly [SpriteFrame | null, SpriteFrame | null])[] = [];
    /** `renderItemFn` 只绑一次。 */
    private rewardRendererBound = false;

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IMailRepository): void {
        this.repo = repository;
    }

    /** 当前详情（给探针看）。 */
    get currentDetail(): IMailDetail | null {
        return this.detail;
    }

    // ============================================================
    // PopupBase 生命周期
    // ============================================================

    protected onInit(): void {
        this.titleLabel.string = MAIL_DETAIL_TITLE;
        this.closeButton?.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.takeButton?.node.on(Button.EventType.CLICK, this.onTakeOrDelete, this);

        // ⚠️ 只绑一次，回调按 index 现取（同 `MailPage` 铁律 ①）
        if (!this.rewardRendererBound && this.rewardList) {
            this.rewardList.renderItemFn = (node, index) => this.renderRewardSlot(node, index);
            this.rewardRendererBound = true;
        }
    }

    protected async onOpen(userData?: any): Promise<void> {
        this.mailId = toIdString(userData?.id);
        await this.nextPopupFrame();
        if (!this.mailId) {
            console.warn('[Mail] 详情弹窗没拿到邮件 id');
            this.close();
            return;
        }
        await this.loadDetail();
    }

    // ============================================================
    // 数据 → 界面
    // ============================================================

    private async loadDetail(): Promise<void> {
        // 先读详情（服务端顺带标记已读），再取表索引（`load()` 在已经拉过列表时不再发包）
        const detail = await this.repo.readMail(this.mailId, this);
        if (!this.isValid) return;
        if (!detail) {
            FW.showTip(MAIL_TIP_REQUEST_FAILED);
            this.close();
            return;
        }
        this.detail = detail;

        const snapshot = await this.repo.load(this);
        if (!this.isValid) return;

        await this.loadRewardArt(detail, snapshot.items, snapshot.resources);
        if (!this.isValid) return;

        await this.present(detail);
    }

    /**
     * 一次性把**每个**奖励格要用的图取完（品质框 + 道具图标）。
     *
     * ⚠️ 必须**先取完再铺**：`renderItemFn` 是同步回调，在里面现加载会先闪一帧上一份奖励的图。
     * 这里是虚拟列表 ⇒ 格子是按 index 现造的，所以不能按「宿主有几个格子」截断，
     * 要把数据里的每一格都备好（`loadArt` 自身有缓存，重复项不会重复请求）。
     */
    private async loadRewardArt(
        detail: IMailDetail,
        items: Parameters<typeof mailRewardIconRef>[1],
        resources: Parameters<typeof mailRewardIconRef>[2],
    ): Promise<void> {
        const out: (readonly [SpriteFrame | null, SpriteFrame | null])[] = [];
        for (let index = 0; index < detail.rewards.length; index++) {
            const reward = detail.rewards[index];
            if (!reward) {
                out.push([null, null]);
                continue;
            }
            const quality = await loadArt(qualityFrameName(reward.quality), MAIL_QUALITY_FRAME_ROOT);
            const ref = mailRewardIconRef(reward.resId, items, resources);
            const icon = ref ? await loadArt(ref.name, ref.root) : null;
            if (!ref) console.warn(`[Mail] 奖励图标解析不出：resId=${reward.resId}（该格只剩品质框）`);
            out.push([quality, icon]);
        }
        this.rewardFrames = out;
    }

    private async present(detail: IMailDetail): Promise<void> {
        this.titleLabel.string = detail.title;
        this.contentLabel.string = plainMailContent(detail.content);

        const count = detail.rewards.length;
        const hasReward = count > 0;
        this.applyContentHeight(hasReward);

        // ⚠️ `RewardBox` 出厂 `active = false`（原稿是 `controller 奖励领取` 的一页），
        //    所以里面的虚拟列表 `onLoad/start` 要等**第一次被激活**才跑（规则 108）；
        //    而 `VirtualScrollView` 的视口尺寸与槽位数组全在 `start()` 里建 ⇒ 必须先开箱、
        //    等一帧、再 `refreshList()`，否则列表一片空白（**不报错**）。同 `MailPage` 铁律 ②。
        this.rewardBox.active = hasReward;
        if (!hasReward) return;

        // 老端是虚拟列表（格数跟着数据走）；8 只是 FGUI 预摆的 item 数，超了给一条 warn 就行
        // （列表可拖，不会丢）—— 与活动模块「超出槽位数的不会显示」的告警同口径。
        if (count > MAIL_REWARD_SLOT_COUNT) {
            console.warn(`[Mail] 奖励 ${count} 项，超过 FGUI 预摆的 ${MAIL_REWARD_SLOT_COUNT} 格（横向可拖，不截断）`);
        }

        await this.nextPopupFrame();
        if (!this.isValid) return;
        this.rewardList.refreshList(count);

        this.takeLabel.string = detailButtonText(detail.take, MAIL_BTN_TAKE, MAIL_BTN_DELETE);
        this.takenStamp.active = detail.take;
    }

    /**
     * 列表的 item 回调（`renderItemFn`）：只按 `index` 取这一格要用的两张图。
     *
     * `node` 是列表从 `RewardSlotTemplate` 克隆/回收来的，`MailRewardSlot` 与它的
     * `frame` / `icon` 两个引用**由生成器写死在模板上**（规则 109：绑错了当场抛，不在这里判空）。
     */
    private renderRewardSlot(node: Node, index: number): void {
        const frames = this.rewardFrames[index] ?? [null, null];
        node.getComponent(MailRewardSlot).render(frames[0], frames[1]);
    }

    /** 正文框高度：有奖励 400、无奖励 580（FGUI `gearSize` 的两页，见文件头偏离 ②）。 */
    private applyContentHeight(hasReward: boolean): void {
        const ut = this.contentNode?.getComponent(UITransform);
        if (!ut) return;
        ut.setContentSize(
            ut.contentSize.width,
            hasReward ? MAIL_CONTENT_HEIGHT_WITH_REWARD : MAIL_CONTENT_HEIGHT_NO_REWARD,
        );
    }

    // ============================================================
    // 交互
    // ============================================================

    private onCloseClick(): void {
        this.closeByButton();
    }

    /** 已领取 ⇒ 删除这封；未领取 ⇒ 领取奖励。做完关窗（老端 `closeUI()`）。 */
    private async onTakeOrDelete(): Promise<void> {
        const detail = this.detail;
        if (!detail || this.busy) return;
        this.busy = true;
        try {
            if (detail.take) {
                const result = await this.repo.deleteMails([detail.id], this);
                if (!this.isValid) return;
                if (result !== 'ok') {
                    FW.showTip(result === 'offline' ? MAIL_TIP_OFFLINE : MAIL_TIP_REQUEST_FAILED);
                    return;
                }
                FW.showTip(MAIL_TIP_DELETE_OK);
            } else {
                const outcome = await this.repo.takeRewards([detail.id], this);
                if (!this.isValid) return;
                if (outcome.result !== 'ok') {
                    FW.showTip(outcome.result === 'offline' ? MAIL_TIP_OFFLINE : MAIL_TIP_REQUEST_FAILED);
                    return;
                }
                FW.showTip(MAIL_TIP_TAKE_OK);
            }
            this.close();
        } finally {
            this.busy = false;
        }
    }
}
