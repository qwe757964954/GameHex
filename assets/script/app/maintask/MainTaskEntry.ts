import { _decorator, Button, Component, Label, Node } from 'cc';
import { Toast } from '../common/Toast';
import { MainTaskDetailPage } from './MainTaskDetailPage';
import { mainTaskRepository } from './MainTaskRepository';
import type { IMainTaskRepository, IMainTaskSnapshot } from './MainTaskRepository';
import { MAIN_TASK_TEXTS } from './MainTaskTexts';

const { ccclass, property } = _decorator;

/**
 * 主界面左侧任务入口，挂在 BottomHud 下随底部安全区域布局。
 * 可领取时直接领奖，否则打开详情；红点与显隐继续由任务快照驱动。
 * 根节点必须初始激活，让 onLoad 能加载快照；不在 onEnable 重复刷新，
 * 避免 applySnapshot 的显隐赋值反复触发加载。
 */
@ccclass('MainTaskEntry')
export class MainTaskEntry extends Component {
    @property({ type: Label, tooltip: 'Label: task entry title' })
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
        // 入口固定显示短标题，任务名与进度由详情弹窗展示。
        if (this.label) this.label.string = snapshot.configured ? MAIN_TASK_TEXTS.entryLabel : '';
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
