import { _decorator, Button, Component, Label, Node } from 'cc';
import { Toast } from '../common/Toast';
import { MainTaskDetailPage } from './MainTaskDetailPage';
import { mainTaskRepository } from './MainTaskRepository';
import type { IMainTaskRepository, IMainTaskSnapshot } from './MainTaskRepository';
import { MAIN_TASK_TEXTS } from './MainTaskTexts';

const { ccclass, property } = _decorator;

/**
 * 主界面「主线任务」入口 —— 老端 FGUI `主界面_战斗/组件/关卡/组件_战斗_主线任务.xml`
 * （本体 225×84，实例在 `组件_战斗_章节选择` 里被覆写成 **231×84**）。
 *
 * 装配代码与「10级领取」在**同一个方法**里（`GObjChapterSelect.onMainTaskChange()`），
 * 一前一后：
 *
 * ```js
 * let first = ModelVO.VOMainTaskBag.GetFirstVO();            // ← 本组件
 * com_mainTask.tm("lab_task").setText(`${first.GetTitle()}\n(${first.GetValue()}/${first.GetMaxValue()})`)
 * com_mainTask.setClick(() => {
 *     if (first.CanBeReward()) { CtrlMainTask.RequestReward(first.GetCmd().resId) }  // 可领 ⇒ 直接领
 *     else { CtrlMainTask.OpenTaskDetail() }                                        // 否则 ⇒ 弹详情
 * }, this)
 * reddot.OnRDUpdate(canReward ? 1 : 0)                       // 只有可领才亮
 * com_mainTask.visible = true / false
 *
 * let heroTaskVo = ModelVO.VOMainTaskBag.GetHeroVO();        // ← 「10级领取」（GetHeroEntry）
 * ```
 *
 * ## 与「10级领取」的三点区别（别把两个组件混成一个）
 *
 * | | 本组件 | `GetHeroEntry`（10级领取） |
 * |---|---|---|
 * | 数据源 | `GetFirstVO()` —— 排除 `targetType = 99`、按 `preResId` 升序 | `GetHeroVO()` —— **只要** `targetType = 99` |
 * | 缓存缺失时 | 选不出来 ⇒ **整块隐藏** | 兜底 `EMPTY_TASK_STATE` ⇒ 显示 `(0/10)` |
 * | 点击 | 可领 ⇒ 领奖；否则 ⇒ **弹详情弹窗** | 可领 ⇒ 领奖；否则 ⇒ 弹**奖励物品**详情 |
 *
 * ## ⚠️ 显隐归属（别加 `onEnable` 自动刷新）
 *
 * 与 `GetHeroEntry` / `ChatEntryButton` / `HangEntryButton` / `OSRankEntryButton` 同一口径：
 * 宿主 `ArenaRoot`（竞技页）由 `MainTabHost.showPage()` **整页实例化 / 销毁**
 * （`MainTabHost.ts:112`）⇒ 每次切回竞技 tab，`onLoad` 都会重跑一次 `refresh()`。
 * 本组件**自己**写 `node.active`（`applySnapshot` 里无条件写，规则 82/86）；
 * 若在 `onEnable` 里再调 `refresh()` 会形成互相触发，而且**隐藏之后就再也没人把它点亮**
 * （`applySnapshot` 在 inactive 时不执行）。
 *
 * ## prefab 上的两条硬约束
 *
 * · 本节点 `_active` **必须烘 `true`**（规则 86）：`onLoad` 只在激活时跑，而 `refresh()`
 *   就在 `onLoad` 里 —— 烘 `false` = 永不刷新的死锁，且一条错都不报。
 * · 根节点是 FGUI `<component extention="Button">` ⇒ 迁过来**有** `cc.Button`；
 *   但代码仍按「有没有 `cc.Button`」分流（规则 81b），`<loader>` 型节点换过来也不会踩死按钮。
 */
@ccclass('MainTaskEntry')
export class MainTaskEntry extends Component {
    @property({ type: Label, tooltip: 'Label：两行文案「任务名\\n(x/y)」（老端 `lab_task`）' })
    label: Label = null!;

    @property({ type: Node, tooltip: 'RedDot：可领取红点（只有 `FINISH` 才亮）' })
    redDot: Node = null!;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IMainTaskRepository = mainTaskRepository;
    /** 当前快照。 */
    private snapshot: IMainTaskSnapshot | null = null;
    /** 每次 refresh 递增，用来丢弃过期的异步结果。 */
    private revision = 0;
    /** 领奖请求进行中（防连点）。 */
    private busy = false;

    protected onLoad(): void {
        this.bindClick();
        void this.refresh();
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IMainTaskRepository): void {
        this.repo = repository;
    }

    /** 读表 + 读缓存 → 铺入口。宿主（`ArenaRoot`）重建本页时 `onLoad` 会再调一次。 */
    async refresh(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.repo.loadFirst();
        if (!this.isAlive() || revision !== this.revision) return;
        this.snapshot = snapshot;
        this.applySnapshot(snapshot);
    }

    /**
     * 把快照铺到入口上。
     *
     * ⚠️ 每一处都**无条件写**（规则 82）：本节点 `_active` 烘的是 `true`（规则 86 要求），
     * 「只在翻转时写」会在首次「新值 === 缓存初值」时短路 ⇒ 该藏的时候藏不掉。
     */
    applySnapshot(snapshot: IMainTaskSnapshot): void {
        this.node.active = snapshot.visible;
        // 无条件写（规则 82）：入口只有两行文案，`string` 赋值零成本。
        if (this.label) this.label.string = snapshot.configured ? snapshot.entryLabel : '';
        if (this.redDot) this.redDot.active = snapshot.showRedDot;
    }

    /** 节点还活着吗（异步回来时宿主可能已被销毁）。 */
    private isAlive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /**
     * 挂点击。
     *
     * ⚠️ FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**（规则 81b）：
     * 那种节点上绑 `Button.EventType.CLICK` 是**静默死按钮**。反过来 `<component>` 形态的
     * 按钮迁过来**有** `cc.Button`，绑 `TOUCH_END` 会绕过 `interactable`。按实际组件分流。
     */
    private bindClick(): void {
        const button = this.node.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, this.onEntryClick, this);
            return;
        }
        this.node.on(Node.EventType.TOUCH_END, this.onEntryClick, this);
    }

    private onEntryClick(): void {
        void this.onClick();
    }

    /** 老端口径：可领 ⇒ 直接领奖；否则 ⇒ 弹任务详情。 */
    private async onClick(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot || !snapshot.configured) return;
        if (snapshot.canClaim) {
            await this.claim();
            return;
        }
        await MainTaskDetailPage.open({});
    }

    private async claim(): Promise<void> {
        const snapshot = this.snapshot;
        if (!snapshot || this.busy) return;
        this.busy = true;
        try {
            const result = await this.repo.claim(snapshot.resId, this);
            if (!this.isAlive()) return;
            if (result === 'ok') {
                Toast.show(MAIN_TASK_TEXTS.claimed);
                await this.refresh();
                return;
            }
            // 'offline' 与 'failed' 分开提示：前者一个包都没发（`GameNet.isConnected === false`），
            // 说「领取失败」会让人以为服务端拒了。
            Toast.show(result === 'offline' ? MAIN_TASK_TEXTS.offlineWarn : MAIN_TASK_TEXTS.claimFailed);
        } finally {
            this.busy = false;
        }
    }
}
