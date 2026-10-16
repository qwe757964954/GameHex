import { _decorator, Button, Component, Node } from 'cc';
import { celebrationRepository } from './CelebrationRepository';
import type { ICelebrationSnapshot } from './CelebrationRepository';
import { OSRankPage } from './OSRankPage';

const { ccclass, property } = _decorator;

/**
 * 主界面「开服庆典」入口按钮
 * —— 挂在 `assets/resources/ui/main/ArenaRoot.prefab`（竞技页）根下 `OSRankEntry`。
 *
 * 与 `hang/HangEntryButton.ts` / `chat/ChatEntryButton.ts` 同一类：**竞技页自己的常驻 HUD**，
 * 随 `ArenaRoot` 一起实例化 / 销毁 ⇒ 切到别的页时不显示。位置用 `cc.Widget`（`RIGHT | BOTTOM`）
 * 表达，**不写死 `position`**。
 *
 * ## 老端它挂在哪（不是"主界面"，是"章节选择"里的一个角落）
 *
 * `主界面_战斗/组件/关卡/章节宝箱/组件_战斗_章节选择.xml` 第 86 行：
 *
 * ```xml
 * <component name="开服冲榜" src="t9zv1x4h640" fileName="组件/按钮/按钮_公共_通用.xml"
 *            xy="608,553" size="90,100">
 * ```
 *
 * 而 `组件_战斗_章节选择` 自己挂在主界面的 `xy=(0,196) size=720,1000` 上
 * ⇒ 屏上框 `left = 608`、`top = 749`、`size = 90×100`（右边缘 698、底边 849）。
 *
 * 行为（`GObjChapterSelect.refreshOSRankBtn()`）：
 *
 * ```ts
 * btn.visible = ModelCelebration.Enabled();          // 落在 CmdRankItem 时间窗内
 * rd.OnRDUpdate(ModelCelebration.GetRd());           // 红点 = GetRd()
 * btn.onClick(() => CtrlMgr.CtrlRank.openLayerOSRank());
 * ```
 *
 * ## ⚠️ 位置**有意**不等于老端的 (608,553)
 *
 * 老端那 90×100 的按钮是摆在**章节选择页**右下角（那页有自己的底板与关卡列表）。
 * 按约定本入口改挂 `ArenaRoot`（竞技页）的 HUD —— **换页了，就不能照抄另一页的坐标**
 * （照抄会压在竞技页的地图/按钮上）。所以这里只沿用老端的**尺寸 90×100**
 * （与 `ChatEntry` 的 `Btn` 恰好同规格），落点按 HUD 惯例：与 `ChatEntry` 同一条右列，
 * 往上让开一个身高 + 12px ⇒ `right = 15`（= `ChatEntry.right`）、`bottom = 264`。
 *
 * ## 可见性 / 红点
 *
 * | 处 | 口径 |
 * |---|---|
 * | 整块显隐 | `snapshot.enabled`（≈ 老端 `ModelCelebration.Enabled()`：落在 `CmdRankItem` 时间窗内） |
 * | `RedDot` | `snapshot.rd !== 0`（= 老端 `GetRd()`，与页内「庆典目标」页签的红点是**同一个值**） |
 *
 * 🔴 **prefab 里 `OSRankEntry._active` 必须烘 `true`**（规则 86）：
 * 烘 `false` ⇒ `onLoad` 永不执行 ⇒ `refresh()` 永不执行 ⇒ 就算活动真的开着也**永远不显示**
 * （死锁，且一条错都不报）。烘 `true` 后由 `applySnapshot()` 每趟**无条件**改写（规则 82）。
 *
 * 端到端探针因此走**注入式**（与 `HangEntryButton` 同一处置）：离线预览里
 * `CmdRankItem` 缓存是空的 ⇒ `enabled` 恒 `false` ⇒ 界面上根本看不到这个按钮。
 * 这是**与老端一致**的行为（老端 `Enabled()` 同样返回 false），不是漏迁。
 *
 * ## 没有摇摆动画
 *
 * `快速扫荡`（`HangEntry`）有 FGUI 转场 `t0` 要复刻，本入口原稿**没有转场** ⇒ 不做。
 * 别"顺手加一个呼吸/摇摆"：那会让两个 HUD 入口的视觉权重不对等。
 */

@ccclass('OSRankEntryButton')
export class OSRankEntryButton extends Component {
    @property({ type: Node, tooltip: 'RedDot：红点占位（老端 `开服冲榜.组件_红点`，值 = `GetRd()`）' })
    redDot: Node = null!;

    protected onLoad(): void {
        // ⚠️ 监听挂在**节点**上（`cc.Button` 的 click 本来就是 `node.emit` 出来的）。
        // 点击区在根节点：`OSRankEntry` 的 100×100 把图标框住，
        // 不然点图标边缘会没反应（与 `HangEntryButton` 同一处置）。
        const button = this.node.getComponent(Button);
        if (!button) {
            // 缺 `cc.Button` 时 `Button.EventType.CLICK` 永远不会被 emit，
            // 表现是「点了毫无反应且不报错」。
            console.error(`[Celebration] ${this.node.name} 上没有 cc.Button，主界面入口点击不会生效`);
        } else {
            button.node.on(Button.EventType.CLICK, this.onClick, this);
        }
        void this.refresh();
    }

    /**
     * ⚠️ **不写 `off(...)`**（规则 71）：同节点组件按 `_components` 序销毁，`cc.Button` 排在
     * 脚本前面 ⇒ 它先被 destruct、`node` own property 被置 null ⇒
     * `this.node.getComponent(Button).node.off(...)` 抛 `TypeError` 并**中断整条销毁链**。
     * 不 `off` 是安全的：`Node._onPreDestroyBase` 会先清空监听。
     */
    protected onDestroy(): void {
        this.unscheduleAllCallbacks();
    }

    /** 打开庆典主容器。`PopupManager` 同类单实例 ⇒ 连点不会叠出第二个面板。 */
    onClick(): void {
        void OSRankPage.open();
    }

    /** 重读一次数据并铺一次。 */
    async refresh(): Promise<void> {
        this.applySnapshot(await celebrationRepository.load());
    }

    /**
     * 用给定快照铺一次 —— `refresh()` 的**同步核心**。
     *
     * 单独暴露是为了让端到端探针（`tmp/_celebration_probe.mjs`）能注入替身快照：
     * 离线预览里 `enabled` 恒 `false`（见文件头），不注入就永远验不到「可见态」。
     */
    applySnapshot(snapshot: ICelebrationSnapshot): void {
        // 🔴 `active` **无条件写**（规则 82）：prefab 里烘的是 `true`（为了 `onLoad` 能跑起来），
        //    一旦写成「只在翻转时写」，首次 `false === 缓存初值` 就会短路。
        //    代价可忽略：`cc.Node.active` 的 setter 自己会早退。
        this.node.active = snapshot.enabled;
        if (this.redDot) this.redDot.active = snapshot.rd !== 0;
    }
}
