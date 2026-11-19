import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { reportGuideComplete } from '../guide/application/GuideEvents';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { Toast } from '../common/Toast';
import { RewardItemView } from '../common/RewardItemView';
import { mainTaskRepository } from './MainTaskRepository';
import type { IMainTaskRepository, IMainTaskSnapshot } from './MainTaskRepository';
import { MAIN_TASK_TEXTS } from './MainTaskTexts';

const { ccclass, property } = _decorator;

/**
 * 主线任务详情弹窗。onOpen 自己读 loadFirst，不接收入口 snapshot（入口状态可能已过期）。
 * 本界面不发请求；跳转链路未接，前往只提示不关窗。
 * 奖励槽几何由 RewardList 的 cc.Layout（GRID、4 列、110×110）负责，代码只切槽位显隐。
 */
@ccclass('MainTaskDetailPage')
export class MainTaskDetailPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     * 目录名**必须**与磁盘一致（`assets/resources/ui/MainTask/`）：热更新 zip 内路径
     * 大小写敏感，写错在编辑器里照样能跑，真机才 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/MainTask/MainTaskDetail';

    @property({ type: Node, tooltip: 'CloseBtn：关闭按钮（点它收起，挂 cc.Button）' })
    closeButton: Node = null!;

    @property({ type: Label, tooltip: 'TaskTitle：任务标题 `任务名 (x/y)`（老端 `lab_title`）' })
    taskTitle: Label = null!;

    @property({ type: Node, tooltip: 'RewardList：奖励格容器（子节点挂公共 RewardItemView，从左到右、每行居中）' })
    rewardList: Node = null!;

    @property({ type: Node, tooltip: 'BtnGo：「前往」按钮' })
    btnGo: Node = null!;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IMainTaskRepository = mainTaskRepository;
    /** 当前快照。 */
    private snapshot: IMainTaskSnapshot | null = null;
    private rewardSlots: RewardItemView[] = [];
    /** 每次「取数 / 铺界面」递增，用来丢弃过期的异步结果。 */
    private loadRevision = 0;

    // 生命周期

    protected onInit(): void {
        this.rewardSlots = this.rewardList.children.map(child => child.getComponent(RewardItemView));
        this.closeButton.on(Button.EventType.CLICK, this.handleClose, this);
        this.btnGo.on(Button.EventType.CLICK, this.handleGo, this);
    }

    private readonly handleClose = (): void => {
        this.close(PopupCloseReason.CloseButton);
    };

    private readonly handleGo = (): void => {
        this.onGoClick();
    };

    protected async onOpen(): Promise<void> {
        // 新手引导 8-1「点开主线任务」：面板一开就算这一步完成（用户 2026-11-18 第 27 条：
        // 引导只高亮任务入口、让玩家自己点，不再代开面板）。与 6-1 的 `pageOpened:card` 同一个
        // 命名族，步表里写 `pageOpened:task`。
        reportGuideComplete('pageOpened', 'task');
        this.snapshot = null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 关闭由 alive 覆盖，onClose 不再递增 revision。
        this.snapshot = null;
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IMainTaskRepository): void {
        this.repo = repository;
    }

    /** 弹窗还活着吗（异步回来时页面可能已被关掉）。 */
    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }

    // 取数与渲染

    /** 重跑一遍「取数 → 铺界面」。 */
    async refresh(): Promise<void> {
        await this.reload();
    }

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        const snapshot = await this.repo.loadFirst();
        if (!this.alive || revision !== this.loadRevision) return;
        this.snapshot = snapshot;
        this.present();
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        this.presentTitle(snapshot);
        this.presentRewards(snapshot);
    }

    // 铺界面

    private presentTitle(snapshot: IMainTaskSnapshot): void {
        // 无条件写：同一实例会被不同任务复用，条件式赋值会留下上一条任务的标题。
        this.taskTitle.string = snapshot.configured ? snapshot.detailTitle : '';
    }

    /**
     * 奖励格。
     *
     * FGUI 原稿是 `<list name="list_item" layout="flow_hz" align="center" vAlign="middle">`：
     * **横向流式、每行各自居中、整块垂直居中**。`taskMain` 表里 `reward` 长度只有 1 或 2
     * （实测 49 行：18 行 1 个 / 31 行 2 个），但这里仍按「每行 4 列、最多 2 行」摆满
     * 预置的 8 个槽位 —— 策划以后把奖励加到 8 个也不用改 prefab。
     *
     * 几何由 `RewardList` 的 `cc.Layout`（GRID、4 列、110×110 格）负责，代码只切槽位显隐。
     */
    private presentRewards(snapshot: IMainTaskSnapshot): void {
        const slots = this.rewardSlots;
        const count = Math.min(snapshot.rewards.length, slots.length);

        for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index];
            if (index >= count) {
                // 多出来的槽位一律藏掉（不是「留着空的」）
                slot.node.active = false;
                continue;
            }
            slot.node.active = true;
            const reward = snapshot.rewards[index];
            slot.render({ resId: reward.resId, amount: reward.number });
        }
    }

    // 交互

    /**
     * 「前往」。
     *
     * 老端 `LayerMainTaskDetailUI.goto()`：
     * ```js
     * const taskId = vo.GetCmd().resId;
     * if (taskId === 500002) { JumpType(HERO) + 切到宝石页 }
     * else if (taskId === 500001 || 500004 || 500007) { JumpType(FIGHT) + 最新章节引导 }
     * else { JumpType(vo.GetRef().goto) }
     * this.unload();                                       // 跳转后关窗
     * ```
     * 本工程**没有接 `CtrlJumpView`**（与礼包 / 七日狂欢 / 征收同一处置）⇒ 只提示不跳转、
     * **也不关窗**（照抄 `unload()` 会变成「点了前往，弹窗没了，什么都没发生」）。
     */
    private onGoClick(): void {
        Toast.show(MAIN_TASK_TEXTS.jumpNotWired);
    }
}
