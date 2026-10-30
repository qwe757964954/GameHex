import { _decorator, Component, Label, Sprite, UIOpacity, UITransform, type SpriteFrame } from 'cc';
import {
    territoryGainContentX,
    territoryGainFx,
    type ITerritoryGainFx,
} from '../model/TerritoryResourceGain';

const { ccclass, property } = _decorator;

/**
 * 领地「资源获得」读数 —— **icon + 数字从起点升起、边升边淡出**。
 *
 *  挂在 `ui/territory/TerritoryResourceGain.prefab` 的根上，由 `TerritoryMapView` 池化复用：
 *  每次 `play()` 前调用方先 `setPosition` 定好起点，本类只负责从起点往上飘。
 *
 *  ⚠️ 起点**不是格心**：2026-10-16 row17 起它是「**喷发原点**（= 点击地块的中心点）
 *  往上 `TERRITORY_GAIN_START_LIFT_PX`(40px)」—— 需求原话「图标和数字 ui 增加上移的动画
 *  放在例子效果坐标点的上方间隔 40px」。喷发那半句在同目录 `TerritoryGainBurst`。
 *
 *  表现参数全部在 `model/TerritoryResourceGain`（纯函数、零 cc），本文件只做**逐帧写节点**，
 *  不自己算曲线 —— 与 `TerritoryHexFlip` 同一套路（真源单一，单测直接测纯函数）。
 *
 * ⚠️ **不建 tween**：飘字是池化节点，`tween` 挂在复用节点上会在回收后继续跑
 *  （见规则 106 / 247）；逐帧 `step(dt)` 由 `TerritoryMapView.update` 统一推进，
 *  回收时把 `elapsed` 置 -1 即可，没有需要显式销毁的定时器。
 */
@ccclass('TerritoryResourceGainView')
export class TerritoryResourceGainView extends Component {
    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：资源图标（银币 / 体力）' })
    iconSprite: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Amount：+N 数值' })
    amountLabel: Label = null;

    @property({ type: UIOpacity, group: '节点引用', tooltip: '挂在根节点上的 cc.UIOpacity（整条一起淡出）' })
    opacity: UIOpacity = null;

    /** < 0 = 空闲（可被复用）。 */
    private elapsed = -1;
    private baseY = 0;

    /**
     * 从**节点当前的 y** 起飘。
     *
     * ⚠️ 起点必须在 `play()` **之前**由调用方写好：本类每帧写的是「起点 + 位移」，
     * 池化复用时上一次的位移还留在节点上，不重设起点就会越飘越高。
     */
    play(frame: SpriteFrame | null, amount: number): void {
        this.baseY = this.node.position.y;
        this.elapsed = 0;
        this.node.active = true;
        if (this.iconSprite.spriteFrame !== frame) this.iconSprite.spriteFrame = frame;
        const text = `+${Math.max(0, Math.round(amount))}`;
        if (this.amountLabel.string !== text) this.amountLabel.string = text;
        this.layoutContent();
        this.apply(territoryGainFx(0) as ITerritoryGainFx);
    }

    /**
     * 按**本次文本的实测宽度**把 icon + 数字整组重新居中（组中心恒在节点原点）。
     *
     * 几何全在 `territoryGainContentX`（纯函数，单测直接测）；这里只负责读两个宽度、
     * 逼一次 Label 排版、把结果写回节点。每次 `play()` 都重算，任何位数都居中。
     *
     * ⚠️ 必须先 `updateRenderData(true)`：`overflow = NONE` 时 Label 是**延迟**把实测尺寸
     * 写回 `UITransform` 的，不逼一下读到的是上一句的宽度（看着像"数字跳到一半"）。
     */
    private layoutContent(): void {
        const icon = this.iconSprite?.node;
        const amount = this.amountLabel?.node;
        if (!icon || !amount) return;
        const iconSize = icon.getComponent(UITransform);
        const amountSize = amount.getComponent(UITransform);
        if (!iconSize || !amountSize) return;
        this.amountLabel.updateRenderData(true);
        // 宽度为 0 / NaN（首帧还没排版）⇒ 返回 null，保持 prefab 摆位，别把整组甩到左边。
        const x = territoryGainContentX(
            iconSize.width,
            amountSize.width,
            iconSize.anchorX,
            amountSize.anchorX,
        );
        if (!x) return;
        icon.setPosition(x.iconX, icon.position.y, 0);
        amount.setPosition(x.textX, amount.position.y, 0);
    }

    /** 每帧推进。@returns 是否还在播（false = 已播完，调用方可回收）。 */
    step(dt: number): boolean {
        if (this.elapsed < 0) return false;
        this.elapsed += dt;
        const fx = territoryGainFx(this.elapsed);
        if (!fx) {
            this.stop();
            return false;
        }
        this.apply(fx);
        return true;
    }

    /** 立刻收尾（换章 / 重渲染前调）：节点回池，位置留给下次 play 重设。 */
    stop(): void {
        this.elapsed = -1;
        this.node.active = false;
    }

    private apply(fx: ITerritoryGainFx): void {
        const node = this.node;
        node.setPosition(node.position.x, this.baseY + fx.offsetY, 0);
        node.setScale(fx.scale, fx.scale, 1);
        const alpha = Math.max(0, Math.min(255, Math.round(fx.opacity * 255)));
        if (this.opacity.opacity !== alpha) this.opacity.opacity = alpha;
    }
}
