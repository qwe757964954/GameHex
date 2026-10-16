import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame, Tween, tween, UITransform, Vec3 } from 'cc';
import type { ActivityBoxPhase } from './LayerActivityTable';

const { ccclass, property } = _decorator;

/** 宝箱三态 → 要用的图（宿主预加载好再传进来）。 */
export interface IActivityBoxArt {
    readonly taken: SpriteFrame | null;
    readonly claimable: SpriteFrame | null;
    readonly locked: SpriteFrame | null;
}

/** 呼吸动效一圈的时长（秒）；FGUI `t0` transition 是 48 帧 @ 24fps = 2s。 */
const BREATH_PERIOD = 2;
const BREATH_SCALE_MAX = 1.1;
const BREATH_SCALE_MIN = 0.9;

const WHITE = new Color(255, 255, 255, 255);
const LOCKED_TINT = new Color(190, 190, 190, 255);

/**
 * 周活跃进度条上的**一个宝箱**（72×92，运行时由 `LayerActivityPage` 从模板 clone 出来）。
 *
 * 结构对齐 FGUI `活动/自定义组件/组件_活动_宝箱item.xml`：
 *   宝箱按钮（`by0/by1/by2` 三张脸，`状态` 控制器互斥）+ 达标积分（`lab_value`）
 *   + 已领取对勾（`tag_gou`，`scale=0.5`）+ 可领取红点 + 「可领取」字。
 *
 * ## ⚠️ 不再复刻 FGUI 的「定宽片段链」进度条
 *
 *  FGUI 里进度条不是一根，而是**每个宝箱各带一段 110px 定宽、pivot 在右端**的片段，
 *  靠 `item.node.zIndex = 100 - index` 让前面的宝箱盖住后一段的溢出（老端
 *  `TabDayChallengeActTask.InitList`）。那是"美术片段只有定宽"年代的糊法：
 *  段与段之间不是按 `cost` 比例的，档位间隔一旦不等长，画出来的进度条长度就是错的。
 *  （同项目七日狂欢同一套：`SevenDay.prefab / BoxBar / Box*`，每箱自带 100px 片段。）
 *
 *  这里改成：**进度条是页面上的独立一层**（`BarBg`/`BarFill` 九宫拉伸，宽度 = `barRatioOf`），
 *  宝箱按 `chestRatioOf` 定位在条上。视觉一致（一根连续条 + 等距宝箱），
 *  且和档位间隔无关 —— 判定函数都在 `LayerActivityTable`，可单测。
 *  条宽 / 节点宽 / 宝箱图尺寸的互相约束见 `LayerActivityLayout.ACTIVITY_BAR_WIDTH`。
 *
 * ## 呼吸动效
 *
 *  FGUI 那个 `autoPlayRepeat="-1"` 的 scale 1→1.1→1→0.9→1 是**无条件常驻**的。
 *  这里只在「可领取」时呼吸（其余两态静态），并在切态时**停掉 tween、把 scale 绝对写回 1**
 *  —— 否则宝箱被复用到别的档位时会带着半截缩放（规则 10 同款缺陷）。
 */
@ccclass('ActivityProgressBox')
export class ActivityProgressBox extends Component {
    @property({ type: Node, tooltip: 'ChestBtn：宝箱本体（挂 cc.Button，呼吸动效作用在它身上）' })
    chestButton: Node = null!;

    @property({ type: Sprite, tooltip: 'ChestBtn/Bg：宝箱图（按状态换 by0/by1/by2）' })
    chestIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'ChestBtn/Check：已领取对勾（默认隐藏）' })
    checkMark: Node = null!;

    @property({ type: Node, tooltip: 'ChestBtn/RedDot：可领取红点（默认隐藏）' })
    redDot: Node = null!;

    @property({ type: Label, tooltip: 'ChestBtn/Hint：可领取时显示「可领取」' })
    hintLabel: Label = null!;

    @property({ type: Label, tooltip: 'CostLabel：达标积分（FGUI `lab_value`）' })
    costLabel: Label = null!;

    /** 宝箱点击回调，由宿主在铺的时候重设。 */
    onClick: (() => void) | null = null;

    private breathing = false;

    protected onLoad(): void {
        this.chestButton.on(Node.EventType.TOUCH_END, this.emitClick, this);
    }

    private emitClick(): void {
        this.onClick?.();
    }

    /**
     * 把宝箱图的画布尺寸定下来（宿主在 clone 之后按 `LayerActivityLayout` 调）。
     *
     * ⚠️ 必须先 `sizeMode = CUSTOM` 再 `setContentSize`：
     *   `Sprite` 的 `_sizeMode` 默认是 `TRIMMED`，`spriteFrame` 的 setter 会走
     *   `_applySpriteSize()` 把宿主节点尺寸**回写成贴图原始尺寸**（100×100）。
     *   不关掉这个回写，`render()` 每次换脸都会把尺寸冲回 100 ⇒ 8 个宝箱互相叠。
     */
    applyArtSize(size: number): void {
        if (!(size > 0)) return;
        this.chestIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        this.chestIcon.node.getComponent(UITransform)?.setContentSize(size, size);
    }

    /**
     * 铺一个宝箱。
     *
     * @param cost 达标所需积分（`dayChallengeActTaskProgress.cost`）
     * @param phase 三态
     * @param art  三张宝箱脸（宿主预加载）
     * @param hintText 可领取时的提示文案（`ACTIVITY_TEXTS`）
     */
    render(cost: number, phase: ActivityBoxPhase, art: IActivityBoxArt, hintText: string): void {
        this.costLabel.string = String(cost);

        const face = phase === 'taken' ? art.taken : phase === 'claimable' ? art.claimable : art.locked;
        if (face) this.chestIcon.spriteFrame = face;

        // 三态一律绝对赋值（宝箱会被反复复用）
        this.checkMark.active = phase === 'taken';
        this.redDot.active = phase === 'claimable';
        this.hintLabel.string = phase === 'claimable' ? hintText : '';

        this.stopBreath();
        if (phase === 'claimable') this.startBreath();
        // 不可领取再压暗一档：FGUI 只是整块换 `by2` 那张脸，三态的差异在暗底框上不够明显
        this.chestIcon.color = phase === 'locked' ? LOCKED_TINT : WHITE;
    }

    private startBreath(): void {
        if (this.breathing) return;
        this.breathing = true;
        const quarter = BREATH_PERIOD / 4;
        tween(this.chestButton)
            .to(quarter, { scale: new Vec3(BREATH_SCALE_MAX, BREATH_SCALE_MAX, 1) })
            .to(quarter, { scale: new Vec3(1, 1, 1) })
            .to(quarter, { scale: new Vec3(BREATH_SCALE_MIN, BREATH_SCALE_MIN, 1) })
            .to(quarter, { scale: new Vec3(1, 1, 1) })
            .union()
            .repeatForever()
            .start();
    }

    private stopBreath(): void {
        if (!this.breathing) return;
        this.breathing = false;
        if (!this.chestButton) return;
        Tween.stopAllByTarget(this.chestButton);
        // ⚠️ 这里**必须**判 `isValid`：宝箱是随宿主节点一起销毁的，`onDestroy` 跑到这时
        //    子节点 `chestButton` 内部存缩放/位置的 `Vec3` 已经被释放，`setScale` 直接抛
        //    `TypeError: Cannot set properties of null (setting 'x')`。
        //    而 `onDestroy` 是在 `Node._destroyImmediate` 里被调的 —— 抛出去会**中断销毁流程**：
        //    节点留在父节点的 `children` 里没被摘掉，下一趟 `rebuildBoxes` 又 `destroy()` 一次
        //    （控制台「You are trying to destroy a object twice or more」），
        //    并且每趟重铺都会**少一个宝箱**（实测 8 → 7 → 6）。
        //    这个 bug 只有真的重铺过才现形：领奖后 / 打开两次都会走到，单测碰不到（依赖 cc）。
        if (this.chestButton.isValid) this.chestButton.setScale(1, 1, 1);
    }

    /** `repeatForever` 的 tween 必须显式停，别等节点销毁。 */
    onDestroy(): void {
        this.stopBreath();
    }
}
