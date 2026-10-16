/**
 * 「联盟任务」的**进度宝箱** —— FGUI `主界面_联盟/任务/组件_联盟_宝箱.xml`
 * （`ui/League/LeagueTaskBox.prefab`，根 **90×100**：组件原生 90×78，面板上的实例写 `size="90,100"`）。
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `按钮_章节宝箱`（`按钮_公共_通用自动大小_变暗`，`(-6,-20) 100×100`） | `Box`（`cc.Sprite` + `cc.Button`） | 三态图运行时换 |
 * | `lab_value`（`(44,84) 90×42`，28px `#ede5ae` bold 描边 2 `faceDilate=1`） | `Value` | 里程碑数字 |
 * | `n67`（`tag_gou` 70×70，`scale 0.5`） | `Check` | 只在「已领取」页 |
 * | `com_rd`（`组件_公用_红点`，`(60,0)` 30×30） | `RedDot` | 只在「可领取」页 |
 * | 过渡 `t0`（`autoPlayRepeat=-1`） | 本类的呼吸 tween | 见下 |
 *
 * ## 三态由 `状态` controller 一把驱动（**图名里的数字不是状态名**）
 *
 * FGUI `pages="2,不可领取,1,可领取,0,已领取"` + `gearIcon values="zb0|zb1|zb2"`：
 *
 * | controller 页 | 状态 | 图 |
 * |---|---|---|
 * | 2 | 不可领取 | **`zb0`** |
 * | 1 | 可领取 | `zb1` |
 * | 0 | 已领取 | `zb2` |
 *
 * ⇒ `zb0` 是「不可领取」、`zb2` 是「已领取」（见 `LeagueArt.LEAGUE_ART_TASK_BOX_LOCKED` 的说明）。
 * 状态本身由 `LeagueTable.leagueTaskBoxState()` 算好，本类只做「三态 → 图 / 子节点显隐」的落地。
 *
 * ## 点击的三支（老端 `setBoxState` 里的 `onClick`）
 *
 * | 状态 | 点击行为 |
 * |---|---|
 * | 可领取 | `RequestTaskUnionGetProgressReward(LeagueTask)` ⇒ 交给宿主发包 |
 * | 不可领取 | **弹奖励浮框**（让玩家看到「到 N 个任务就能领这个」）⇒ 交给宿主显示 |
 * | 已领取 | 什么都不做（老端的 `onClick` 里没有这一支） |
 *
 * ⚠️ **本类不决定"点下去干什么"**，只把「点到了哪个宝箱」告诉宿主（`onBoxClick`）——
 *    因为「弹浮框」要动面板级的 `Reward` 节点、发包要走 Repository，两者都不属于这一层。
 *
 * ## 呼吸动画（FGUI 过渡 `t0`）
 *
 * `t0` 的 4 段都是 `按钮_章节宝箱` 的 Scale：`1→1.1→1→0.9→1`，每段 12 帧、
 * `autoPlayRepeat="-1"`（无限循环）。FGUI 帧率按 24fps 算 ⇒ 每段 **0.5s**、一轮 2s。
 * 用 `cc.tween` 复刻；`onDestroy` 里 `Tween.stopAllByTarget` 收干净（虚拟列表销毁槽位时不留悬挂 tween）。
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame, Tween, Vec3, tween } from 'cc';
import { RedDot } from '../common/RedDot';
import type { ILeagueTaskBoxView } from './LeagueTable';

const { ccclass, property } = _decorator;

/** FGUI 过渡每段的时长（12 帧 @24fps）。 */
const BREATH_SEGMENT_SECONDS = 0.5;

@ccclass('LeagueTaskBox')
export class LeagueTaskBox extends Component {
    @property({ type: Sprite, tooltip: '按钮_章节宝箱：宝箱图（zb0 不可领取 / zb1 可领取 / zb2 已领取）' })
    chest: Sprite = null!;

    @property({ type: Label, tooltip: 'lab_value：里程碑数字（3 / 5 / 8）' })
    valueLabel: Label = null!;

    @property({ type: Node, tooltip: 'n67：已领取对勾（仅「已领取」页）' })
    checkMark: Node = null!;

    @property({ type: Node, tooltip: 'com_rd：可领取红点（仅「可领取」页）' })
    redDot: Node = null!;

    /** 点到这个宝箱（无论什么状态都会回调，由宿主按状态分三支）。 */
    onBoxClick: ((view: ILeagueTaskBoxView) => void) | null = null;

    /** 当前铺在这个宝箱上的数据（`null` = 没铺）。 */
    private current: ILeagueTaskBoxView | null = null;
    private bound = false;

    protected onLoad(): void {
        const button = this.chest ? this.chest.getComponent(Button) : null;
        if (button) button.node.on(Button.EventType.CLICK, this.onClick, this);
        else if (this.chest) this.chest.node.on(Node.EventType.TOUCH_END, this.onClick, this);
        else console.warn('[LeagueTaskBox] Box 缺失，点击不会生效');

        this.startBreathing();
    }

    protected onDestroy(): void {
        // ⚠️⚠️ 这里**只能碰还活着的引用**：`chest`（`cc.Sprite`）挂在**子节点 `Box`** 上，
        //    而子节点比本组件所在的壳节点**先**销毁 ⇒ 走到这儿时 `this.chest._node`
        //    已经是 `null`。而 `Component.getComponent()` 内部就是
        //    `this._node!.getComponent(type)` ⇒ 直接抛
        //    `TypeError: Cannot read properties of null (reading 'getComponent')`。
        //    真引擎实测（`tmp/_task_shots.mjs` 里换面板时 destroy 旧节点）：预览页直接弹红框，
        //    **每次关面板必崩**。
        //    ⇒ ① 只读 `chest.node` 这个**可空**引用（读属性不抛），为 null 就跳过；
        //       ② **不手动 `off()` 事件**（销毁期 `getComponent` 不可用；事件监听随节点销毁
        //          由引擎清 —— 同 `LeagueDiscountPage.onDestroy` 的口径）。
        const node = this.chest ? this.chest.node : null;
        // ⚠️ 必须停：tween 会持有节点引用，节点被销毁后还在跑会报 `target is invalid`
        if (node) Tween.stopAllByTarget(node);
        this.current = null;
        this.onBoxClick = null;
    }

    /** 当前宝箱的序号（没铺数据时 = 0）。 */
    get boxId(): number {
        return this.current?.id ?? 0;
    }

    /**
     * 铺一个宝箱（所有状态**绝对赋值**）。
     *
     * @param view  宝箱视图（`null` ⇒ 藏掉整个宝箱）
     * @param frame 宝箱图帧（`null` ⇒ **保留** prefab 上的静态图，不清成空白）
     */
    render(view: ILeagueTaskBoxView | null, frame: SpriteFrame | null): void {
        this.current = view;

        if (!view) {
            this.node.active = false;
            return;
        }
        this.node.active = true;

        if (frame && this.chest) this.chest.spriteFrame = frame;
        if (this.valueLabel) this.valueLabel.string = String(view.milestone);
        if (this.checkMark) this.checkMark.active = view.state === 'rewarded';

        // 红点走共用组件（`ui/common/RedDot.prefab`）。绑的是实例根节点，
        // 组件运行时取（跨嵌套 prefab 边界取不到内部组件）。
        const dot = this.redDot ? this.redDot.getComponent(RedDot) : null;
        if (dot) dot.setRedDot(view.state === 'canReward' ? 1 : 0);
        else if (this.redDot) this.redDot.active = view.state === 'canReward';
    }

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 复刻 FGUI 过渡 `t0`：`1 → 1.1 → 1 → 0.9 → 1`，无限循环。
     *
     * ⚠️ 缩放挂在 `Box`（宝箱按钮）上、不是本节点上 —— FGUI 的过渡 `target="n60_32bee27d"`
     *    就是那颗按钮。乱挪会连带 `Value` / `Check` / `RedDot` 一起脉动。
     */
    private startBreathing(): void {
        if (!this.chest) return;
        const node = this.chest.node;
        const one = new Vec3(1, 1, 1);
        tween(node)
            .to(BREATH_SEGMENT_SECONDS, { scale: new Vec3(1.1, 1.1, 1) })
            .to(BREATH_SEGMENT_SECONDS, { scale: one.clone() })
            .to(BREATH_SEGMENT_SECONDS, { scale: new Vec3(0.9, 0.9, 1) })
            .to(BREATH_SEGMENT_SECONDS, { scale: one.clone() })
            .union()
            .repeatForever()
            .start();
    }

    private readonly onClick = (): void => {
        const view = this.current;
        if (!view) return;
        if (this.onBoxClick) this.onBoxClick(view);
    };
}
