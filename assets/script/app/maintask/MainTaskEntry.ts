import { _decorator, Button, Component, Label } from 'cc';
import { RedDot } from '../common/RedDot';
import { Toast } from '../common/Toast';
import { MainTaskDetailPage } from './MainTaskDetailPage';
import { mainTaskRepository, subscribeMainTaskChange } from './MainTaskRepository';
import type { IMainTaskRepository, IMainTaskSnapshot } from './MainTaskRepository';
import { MAIN_TASK_TEXTS } from './MainTaskTexts';
import { GameNet } from '../net/GameNet';

const { ccclass, property } = _decorator;

/**
 * 主界面左侧任务入口，挂在 BottomHud 下随底部安全区域布局。
 * 可领取时直接领奖，否则打开详情；红点与显隐继续由任务快照驱动。
 * 根节点必须初始激活，让 onLoad 能加载快照；不在 onEnable 重复刷新，
 * 避免 applySnapshot 的显隐赋值反复触发加载。
 */
@ccclass('MainTaskEntry')
export class MainTaskEntry extends Component {
    /**
     * 新手引导门控：`false` 时入口强制隐藏（由 `GuideComposition` 按进度写，见 `TASK_ENTRY_UNLOCK_STEP`）。
     *
     * 需求（2026-11-18 第 26 条）：引导走到 8-1（主线任务那一步）任务按钮才出现 ——
     * 前面几步连「任务」这个概念都还没介绍，提前露出会让玩家点进一个和引导无关的系统。
     * 默认 `true`：非引导场景（老玩家 / 引导已结束）不受影响。
     * 用**静态字段**而不是构造参数：入口随 tab 页反复重建，静态值能跨实例守住。
     */
    static guideUnlocked = true;

    @property({ type: Label, tooltip: 'Label: task entry title' })
    label: Label = null!;

    @property({ type: RedDot, tooltip: 'RedDot：可领取红点（通用 `RedDot`，只有 `FINISH` 才亮）' })
    redDot: RedDot = null!;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IMainTaskRepository = mainTaskRepository;
    /** 当前快照。 */
    private snapshot: IMainTaskSnapshot | null = null;
    /** 每次 refresh 递增，用来丢弃过期的异步结果。 */
    private revision = 0;
    /** `CmdTask` 缓存订阅的退订函数（`onDestroy` 必须摘掉）。 */
    private unsubscribe: (() => void) | null = null;
    /** 领奖请求进行中（防连点）。 */
    private busy = false;

    protected onDestroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        GameNet.instance.removeCaller(this);
    }

    protected onLoad(): void {
        this.bindClick();
        // 入口常驻：翻地块 / 战斗结算把 `CmdTask.count`、`rewardState` 推下来时本页不会重建，
        // 只读一次会让红点与「点入口直接领奖」永远停在打开页面那一刻的快照。
        this.unsubscribe = subscribeMainTaskChange(this, this.onTaskCacheChanged);
        void this.refresh();
    }

    /** `CmdTask` 缓存变化 → 重读整条快照（revision 保证并发时最后一次生效）。 */
    private readonly onTaskCacheChanged = (): void => {
        void this.refresh();
    };

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
     * 每一处都**无条件写**：本节点 `_active` 烘的是 `true`，
     * 「只在翻转时写」会在首次「新值 === 缓存初值」时短路 ⇒ 该藏的时候藏不掉。
     */
    applySnapshot(snapshot: IMainTaskSnapshot): void {
        // 引导没走到「任务」那一步之前一律藏着（见 `guideUnlocked`）。
        this.node.active = snapshot.visible && MainTaskEntry.guideUnlocked;
        // 入口固定显示短标题，任务名与进度由详情弹窗展示。
        this.label.string = snapshot.configured ? MAIN_TASK_TEXTS.entryLabel : '';
        // 红点走工程通用 `RedDot`（与七格页签 / 活动入口同款），布尔直接喂给组件归一化。
        this.redDot.setRedDot(snapshot.showRedDot);
    }

    /** 节点还活着吗（异步回来时宿主可能已被销毁）。 */
    private isAlive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /**
     * 挂点击。
     *
     * FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**：
     * 那种节点上绑 `Button.EventType.CLICK` 是**静默死按钮**。反过来 `<component>` 形态的
     * 按钮迁过来**有** `cc.Button`，绑 `TOUCH_END` 会绕过 `interactable`。按实际组件分流。
     */
    private bindClick(): void {
        const button = this.node.getComponent(Button);
        button.node.on(Button.EventType.CLICK, this.onEntryClick, this);
    }

    private onEntryClick(): void {
        void this.onClick();
    }

    /** 老端口径：可领 ⇒ 直接领奖；否则 ⇒ 弹任务详情。 */
    private async onClick(): Promise<void> {
        const snapshot = this.snapshot;
        // 快照还没到 / 没有可展示的任务时**也把面板打开**。
        //
        // 8-1 的完成条件就是「玩家点开面板」（`pageOpened:task`），而这一步入口是被引导
        // 强制立起来的（`GuideComposition.applyTaskEntryGate`：先显示、再按快照校正）。
        // 这里若按老口径直接 return，玩家点到的就是个死按钮 —— 8-1 永久卡住。
        // 非引导期不会多出副作用：没配任务时 `applySnapshot` 本来就把入口关掉了（点不到）。
        if (!snapshot || !snapshot.configured) {
            await MainTaskDetailPage.open({});
            return;
        }
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
