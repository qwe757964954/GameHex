import { _decorator, Button, Component, Node } from 'cc';
import { celebrationRepository } from './CelebrationRepository';
import type { ICelebrationSnapshot } from './CelebrationRepository';
import { OSRankPage } from './OSRankPage';

const { ccclass, property } = _decorator;

/**
 * 主界面「开服庆典」入口按钮，挂在 `assets/resources/ui/main/ArenaRoot.prefab` 根下的 `OSRankEntry`。
 *
 * 与 `HangEntryButton` / `ChatEntryButton` 同类：竞技页的常驻 HUD，随 `ArenaRoot` 实例化 / 销毁；
 * 位置用 `cc.Widget`（RIGHT | BOTTOM）表达，不写死 position。老端在「章节选择」页右下角，
 * 本工程按约定改挂竞技页 HUD，只沿用尺寸 90×100，落点与 `ChatEntry` 同一条右列。
 *
 * 显隐跟着 `snapshot.enabled`（≈ 老端 `ModelCelebration.Enabled()`，落在 `CmdRankItem` 时间窗内）；
 * `RedDot` 跟 `snapshot.rd !== 0`，与页内「庆典目标」页签同一个值。
 *
 * prefab 里 `OSRankEntry._active` 必须烘 `true`：烘 false 会让 `onLoad` 不执行、`refresh()` 不跑，
 * 活动开着也永远不显示，且不报错。烘 true 后由 `applySnapshot()` 每趟无条件改写。
 */

@ccclass('OSRankEntryButton')
export class OSRankEntryButton extends Component {
    @property({ type: Node, tooltip: 'RedDot：红点占位（老端 开服冲榜.组件_红点，值 = GetRd()）' })
    redDot: Node = null!;

    protected onLoad(): void {
        // 监听挂在节点上：cc.Button 的 click 本来就是 node.emit 出来的，点击区在根节点 100×100。
        this.node.on(Button.EventType.CLICK, this.onClick, this);
        void this.refresh();
    }

    /** 打开庆典主容器。`PopupManager` 同类单实例，连点不会叠出第二个面板。 */
    onClick(): void {
        void OSRankPage.open();
    }

    /** 重读一次数据并铺一次。 */
    async refresh(): Promise<void> {
        this.applySnapshot(await celebrationRepository.load());
    }

    /** 用给定快照铺一次，`refresh()` 的同步核心；探针可注入替身快照验证可见态。 */
    applySnapshot(snapshot: ICelebrationSnapshot): void {
        // active 无条件写：prefab 烘的是 true（为了 onLoad 能跑），只翻转时写会让首次 false 短路。
        this.node.active = snapshot.enabled;
        this.redDot.active = snapshot.rd !== 0;
    }
}
