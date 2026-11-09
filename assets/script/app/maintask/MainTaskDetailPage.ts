import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { Toast } from '../common/Toast';
import { RewardItemView } from '../common/RewardItemView';
import { mainTaskRepository } from './MainTaskRepository';
import type { IMainTaskRepository, IMainTaskSnapshot } from './MainTaskRepository';
import { MAIN_TASK_TEXTS } from './MainTaskTexts';

const { ccclass, property } = _decorator;

/**
 * 奖励格边长 —— FGUI `list_item` 的 `defaultItem` 是
 * `ui://主界面_角色/组件_角色_道具分页item`（**110×110**，里面 `com_goods` 是 100×100
 * 的 `物品框` 实例、`xy="5,5"`）⇒ 槽位间距取 110，格内复用公共奖励框。
 */
const SLOT_SIZE = 110;
/** 一行最多几个 —— FGUI `list_item` 视口宽 442 ÷ 110 = 4.02 ⇒ 4 个。 */
const SLOT_COLUMNS = 4;
/** 视口尺寸（FGUI `list_item` 的 `size="442,266"`）—— 居中排布要用，且必须与 prefab 一致。 */
const VIEW_W = 442;
const VIEW_H = 266;

/**
 * 「任务详情」弹窗 —— 老端 `LayerMainTaskDetail`（`LayerMainTaskDetailUI`），
 * FGUI `主界面_战斗/组件/关卡/详情/组件_战斗_主线任务详情.xml`（720×1280，与画布 1:1）。
 *
 * 版面（自上而下）：
 *   公共弹窗底（590×627）+ 标题缎带「任务详情」+ 关闭按钮
 *   标题下装饰条 + 任务标题 `任务名 (x/y)`
 *   奖励格（横向流式、居中）
 *   「前往」按钮
 *
 * ## 数据来源（老端口径：**自己读，不从入口传**）
 *
 * 老端 `LayerMainTaskDetailUI.initView()` 每次都现调 `VOMainTaskBag.GetFirstVO()`，
 * 并在 `initListener()` 里监听 `VOMainTaskBag.OnChanged` 事件重刷。所以本弹窗**不接收
 * 入口的 snapshot**（入口下一秒的状态可能就变了），`onOpen` 里自己 `loadFirst()`。
 *
 * ⚠️ 本工程**没有** `VOMainTaskBag.OnChanged` 那套事件总线 ⇒ 「弹窗开着的时候服务端推了新
 * 进度」不会自动重刷。现有等价物是关掉重开（`MainTaskEntry.refresh()` 走同一份数据）。
 *
 * ## ⚠️ 老端本界面**不发请求**
 *
 * `CtrlMainTask.OpenTaskDetail()` 只做 `_LayerMainTaskDetail.load()`，全部内容来自
 * 本地表 + `CmdTask` 缓存。所以本类也**不造假的刷新请求** —— 表 / 缓存读不到就显示空态，
 * 编辑器预览 / 离线都能打开，不白屏、不报错。
 *
 * ## 有意偏离：`goto()` **不关窗**
 *
 * 老端 `goto()` 末尾是 `this.unload()`（跳转 + 关窗）。本工程没接 `CtrlJumpView` 那套
 * 跳转链路（与礼包 / 七日狂欢 / 征收同一处置：留接线口 + 提示，不硬编路由），
 * 若照抄 `unload()` 就是「点了前往，弹窗没了，什么也没发生」⇒ 这里**只提示不关窗**。
 */
@ccclass('MainTaskDetailPage')
export class MainTaskDetailPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/MainTask/`）：热更新 zip 内路径
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

    // ============================================================
    // 生命周期
    // ============================================================

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
        this.snapshot = null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 让在途的 load / present 直接作废（它们醒来时页面已经关了）。
        this.loadRevision += 1;
        this.snapshot = null;
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IMainTaskRepository): void {
        this.repo = repository;
    }

    /** 弹窗还活着吗（异步回来时页面可能已被关掉）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

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

    // ---------- 铺界面 ----------

    private presentTitle(snapshot: IMainTaskSnapshot): void {
        // 无条件写（规则 82）：同一实例会被不同任务复用，条件式赋值会留下上一条任务的标题。
        if (this.taskTitle) this.taskTitle.string = snapshot.configured ? snapshot.detailTitle : '';
    }

    /**
     * 奖励格。
     *
     * FGUI 原稿是 `<list name="list_item" layout="flow_hz" align="center" vAlign="middle">`：
     * **横向流式、每行各自居中、整块垂直居中**。`taskMain` 表里 `reward` 长度只有 1 或 2
     * （实测 49 行：18 行 1 个 / 31 行 2 个），但这里仍按「每行 4 列、最多 2 行」摆满
     * 预置的 8 个槽位 —— 策划以后把奖励加到 8 个也不用改 prefab。
     *
     * 几何（唯一出处 = FGUI `list_item` 的 `size="442,266"` + `align/vAlign`）：
     *   行内起始 `left = (VIEW_W − 行内个数 × 110) / 2`
     *   整块起始 `top  = (VIEW_H − 行数 × 110) / 2`
     * 坐标写进 `rewardList` 的局部空间（它的原点是**左上角**，Cocos y 向上 ⇒ 取负）。
     */
    private presentRewards(snapshot: IMainTaskSnapshot): void {
        const slots = this.rewardSlots;
        const count = Math.min(snapshot.rewards.length, slots.length);
        const rows = Math.max(Math.ceil(count / SLOT_COLUMNS), 1);
        const top = (VIEW_H - rows * SLOT_SIZE) / 2;

        for (let index = 0; index < slots.length; index += 1) {
            const slot = slots[index];
            if (index >= count) {
                // 多出来的槽位一律藏掉（不是「留着空的」）
                slot.node.active = false;
                continue;
            }
            const row = Math.floor(index / SLOT_COLUMNS);
            const col = index % SLOT_COLUMNS;
            const inRow = Math.min(count - row * SLOT_COLUMNS, SLOT_COLUMNS);
            const left = (VIEW_W - inRow * SLOT_SIZE) / 2;

            slot.node.active = true;
            slot.node.setPosition(
                left + col * SLOT_SIZE + SLOT_SIZE / 2,
                -(top + row * SLOT_SIZE + SLOT_SIZE / 2),
                0,
            );

            const reward = snapshot.rewards[index];
            slot.render({ resId: reward.resId, amount: reward.number });
        }
    }

    // ---------- 交互 ----------

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
